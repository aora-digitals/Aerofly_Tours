
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("AI_ALLOWED_ORIGIN") ?? "https://aerofly.com";

const headers = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });

const categories = new Set([
  "faq", "tour", "destination", "visa", "policy", "company", "other",
]);

type DocumentInput = {
  id?: string;
  title?: string;
  slug?: string;
  category?: string;
  content?: string;
  visibility?: string;
  status?: string;
  source_url?: string | null;
  source_metadata?: Record<string, unknown>;
};

const safeText = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function splitChunks(text: string, size = 1800, overlap = 180): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length && chunks.length < 120) {
    let end = Math.min(text.length, start + size);

    if (end < text.length) {
      const boundary = text.lastIndexOf("\n", end);
      if (boundary > start + size * 0.6) end = boundary;
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}

async function embed(texts: string[]): Promise<number[][]> {
  const key = Deno.env.get("AI_API_KEY");
  const base = Deno.env.get("AI_BASE_URL");
  const model = Deno.env.get("AI_EMBEDDING_MODEL");

  if (!key || !base || !model) {
    throw new Error("Embedding provider is not configured.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(
      `${base.replace(/\/+$/, "")}/embeddings`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model, input: texts }),
      },
    );

    if (!response.ok) {
      throw new Error(`Embedding provider returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    const vectors = (payload.data ?? [])
      .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
      .map((item: { embedding: number[] }) => item.embedding);

    if (
      vectors.length !== texts.length ||
      vectors.some((vector: number[]) =>
        !Array.isArray(vector) ||
        vector.length !== 1536 ||
        vector.some((n) => !Number.isFinite(n))
      )
    ) {
      throw new Error("Embedding model must return 1536-dimensional vectors.");
    }

    return vectors;
  } finally {
    clearTimeout(timer);
  }
}

async function requireKnowledgeManager(request: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("authorization");

  if (!url || !anonKey || !serviceKey) {
    throw new Error("Supabase service is not configured.");
  }

  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Sign-in required.");
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser();

  if (authError || !authData.user) {
    throw new Error("Invalid session.");
  }

  const { data: allowed, error: permissionError } =
    await userClient.rpc("has_permission", {
      requested_permission: "knowledge.manage",
      requested_organization: null,
    });

  if (permissionError || allowed !== true) {
    throw new Error("Knowledge management permission required.");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { admin, userId: authData.user.id };
}

async function reindexDocument(
  db: SupabaseClient,
  documentId: string,
): Promise<number> {
  const { data: document, error } = await db
    .from("knowledge_documents")
    .select("id,title,category,content,source_url,source_metadata")
    .eq("id", documentId)
    .single();

  if (error || !document) throw new Error("Document not found.");

  await db.from("knowledge_documents").update({
    indexing_status: "processing",
    indexing_error: null,
  }).eq("id", documentId);

  try {
    const chunks = splitChunks(document.content);

    if (!chunks.length) throw new Error("Document has no indexable content.");

    // Clear old chunks before rebuilding. If rebuilding fails, the document
    // remains marked as an error and cannot be retrieved publicly.
    await db.from("knowledge_documents").update({
      indexing_status: "error",
      indexing_error: "Re-indexing incomplete.",
    }).eq("id", documentId);

    const { error: deleteError } = await db
      .from("knowledge_chunks")
      .delete()
      .eq("document_id", documentId);

    if (deleteError) throw new Error("Could not replace existing chunks.");

    for (let offset = 0; offset < chunks.length; offset += 8) {
      const batch = chunks.slice(offset, offset + 8);
      const vectors = await embed(batch);

      const rows = batch.map((content, index) => ({
        document_id: documentId,
        chunk_index: offset + index,
        content,
        token_estimate: Math.ceil(content.length / 4),
        embedding: JSON.stringify(vectors[index]),
        metadata: {
          title: document.title,
          category: document.category,
          source_url: document.source_url,
        },
      }));

      const { error: insertError } = await db
        .from("knowledge_chunks")
        .insert(rows);

      if (insertError) throw new Error("Could not store indexed chunks.");
    }

    const { error: updateError } = await db
      .from("knowledge_documents")
      .update({
        indexing_status: "indexed",
        indexing_error: null,
        chunk_count: chunks.length,
        content_sha256: await sha256(document.content),
      })
      .eq("id", documentId);

    if (updateError) throw new Error("Could not update indexing status.");

    return chunks.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Indexing failed";

    await db.from("knowledge_documents").update({
      indexing_status: "error",
      indexing_error: message.slice(0, 500),
      chunk_count: 0,
    }).eq("id", documentId);

    throw error;
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");

  if (origin && origin !== allowedOrigin) {
    return reply(403, { error: "Origin not allowed." });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  if (request.method !== "POST") {
    return reply(405, { error: "Method not allowed." });
  }

  try {
    const raw = await request.text();

    if (raw.length > 220_000) {
      return reply(413, { error: "Request too large." });
    }

    let body: Record<string, unknown>;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return reply(400, { error: "Expected a JSON object." });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return reply(400, { error: "Invalid JSON." });
    }

    const action = safeText(body.action, 24);

    // Public search never accepts document IDs or arbitrary table names.
    if (action === "search") {
      const query = safeText(body.query, 1200);

      if (query.length < 3) {
        return reply(400, { error: "Enter at least 3 characters." });
      }

      const url = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!url || !serviceKey) {
        return reply(503, { error: "Knowledge retrieval is not configured." });
      }

      const db = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const allowed = await db.rpc("phase10_ai_consume_rate_limit", {
        p_subject_hash: await sha256(
          `knowledge-search:${request.headers.get("cf-connecting-ip") ?? "unknown"}`,
        ),
        p_window_seconds: 60,
        p_max_requests: 20,
      });

      if (allowed.error) {
        return reply(503, { error: "Knowledge retrieval is temporarily unavailable." });
      }

      if (allowed.data !== true) {
        return reply(429, { error: "Too many searches. Please wait a minute." });
      }

      const [vector] = await embed([query]);

      const requestedCategory = safeText(body.category, 30);
      const { data, error } = await db.rpc("knowledge_match_public", {
        query_embedding: JSON.stringify(vector),
        match_count: 6,
        min_similarity: 0.72,
        filter_category: categories.has(requestedCategory)
          ? requestedCategory
          : null,
      });

      if (error) throw new Error("Knowledge retrieval failed.");

      return reply(200, {
        sources: (data ?? []).map((row: Record<string, unknown>) => ({
          title: row.title,
          category: row.category,
          content: row.content,
          source_url: row.source_url,
          similarity: row.similarity,
        })),
      });
    }

    const { admin, userId } = await requireKnowledgeManager(request);

    if (action === "list") {
      const { data, error } = await admin
        .from("knowledge_documents")
        .select(
          "id,title,slug,category,visibility,status,indexing_status,indexing_error,chunk_count,source_url,updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(200);

      if (error) throw new Error("Unable to list knowledge documents.");

      return reply(200, { documents: data ?? [] });
    }

    if (action === "save") {
      const input = (body.document ?? {}) as DocumentInput;
      const title = safeText(input.title, 240);
      const content = safeText(input.content, 200000);
      const slug = safeText(input.slug, 240)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-|-$/g, "");

      if (
        title.length < 3 ||
        !content ||
        !slug ||
        !categories.has(input.category ?? "")
      ) {
        return reply(400, {
          error: "Title, slug, category and content are required.",
        });
      }

      const status = ["draft", "published", "unpublished"].includes(
        input.status ?? "",
      ) ? input.status : "draft";

      const visibility = input.visibility === "staff" ? "staff" : "public";

      const row = {
        title,
        slug,
        content,
        category: input.category,
        visibility,
        status,
        source_url: safeText(input.source_url, 1000) || null,
        source_metadata: input.source_metadata ?? {},
        updated_by: userId,
        published_at: status === "published" ? new Date().toISOString() : null,
        indexing_status: "pending",
        indexing_error: null,
      };

      const result = input.id
        ? await admin.from("knowledge_documents")
          .update(row).eq("id", input.id).select("id").single()
        : await admin.from("knowledge_documents")
          .insert({ ...row, created_by: userId }).select("id").single();

      if (result.error || !result.data) {
        throw new Error("Could not save document. Check that its slug is unique.");
      }

      const chunkCount = await reindexDocument(admin, result.data.id);

      return reply(200, { id: result.data.id, chunk_count: chunkCount });
    }

    if (action === "reindex") {
      const id = safeText(body.id, 36);
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return reply(400, { error: "Invalid document ID." });
      }

      return reply(200, {
        id,
        chunk_count: await reindexDocument(admin, id),
      });
    }

    if (action === "delete") {
      const id = safeText(body.id, 36);

      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return reply(400, { error: "Invalid document ID." });
      }

      const { error } = await admin
        .from("knowledge_documents")
        .delete()
        .eq("id", id);

      if (error) throw new Error("Could not delete document.");

      return reply(200, { deleted: true });
    }

    return reply(400, { error: "Unsupported action." });
  
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Unknown error";

  const errorName =
    error instanceof Error ? error.name : "UnknownError";

  // Log the actual failure server-side, but never log credentials.
  const safeMessage = message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "[REDACTED]")
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 300);

  console.error(JSON.stringify({
    event: "knowledge_base_failure",
    error_name: errorName,
    error_message: safeMessage,
  }));

  if (message.includes("Sign-in") || message.includes("Invalid session")) {
    return reply(401, { error: message });
  }

  if (message.toLowerCase().includes("permission")) {
    return reply(403, { error: message });
  }

  if (message.includes("configured")) {
    return reply(503, { error: message });
  }

  return reply(500, {
    error: "Knowledge-base request failed.",
    error_id: crypto.randomUUID(),
  });
}

});
