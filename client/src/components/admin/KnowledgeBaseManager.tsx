
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertCircle,
  BookOpen,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

type KnowledgeDocument = {
  id: string;
  title: string;
  slug: string;
  category: string;
  visibility: string;
  status: string;
  indexing_status: string;
  indexing_error: string | null;
  chunk_count: number;
  source_url: string | null;
  updated_at: string;
};

type Draft = {
  id?: string;
  title: string;
  slug: string;
  category: string;
  content: string;
  visibility: string;
  status: string;
  source_url: string;
};

const emptyDraft: Draft = {
  title: "",
  slug: "",
  category: "faq",
  content: "",
  visibility: "public",
  status: "draft",
  source_url: "",
};

const categories = [
  "faq",
  "tour",
  "destination",
  "visa",
  "policy",
  "company",
  "other",
];

export default function KnowledgeBaseManager() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke(
      "knowledge-base",
      { body },
    );

    if (error) throw error;
    if (data?.error) throw new Error(String(data.error));

    return data;
  }, []);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const result = await invoke({ action: "list" });
      setDocuments(result.documents ?? []);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load documents.",
      );
    } finally {
      setLoading(false);
    }
  }, [invoke]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  function updateDraft(key: keyof Draft, value: string) {
    setDraft((previous) => ({
      ...previous,
      [key]: value,
      ...(key === "title" && !previous.id
        ? {
            slug: value
              .toLowerCase()
              .trim()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, ""),
          }
        : {}),
    }));
  }

  async function editDocument(document: KnowledgeDocument) {
    try {
      const { data, error } = await supabase
        .from("knowledge_documents")
        .select(
          "id,title,slug,category,content,visibility,status,source_url",
        )
        .eq("id", document.id)
        .single();

      if (error) throw error;

      setDraft({
        ...data,
        source_url: data.source_url ?? "",
      });

      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Unable to open document.",
      );
    }
  }

  async function saveDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);

    try {
      await invoke({
        action: "save",
        document: {
          ...draft,
          source_url: draft.source_url || null,
        },
      });

      toast.success("Document saved and indexed.");
      setDraft(emptyDraft);
      await loadDocuments();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Document save failed.",
      );
      await loadDocuments();
    } finally {
      setSaving(false);
    }
  }

  async function reindexDocument(id: string) {
    try {
      await invoke({ action: "reindex", id });
      toast.success("Re-indexing completed.");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Re-indexing failed.",
      );
    } finally {
      await loadDocuments();
    }
  }

  async function deleteDocument(id: string) {
    if (!window.confirm("Delete this document and its chunks permanently?")) {
      return;
    }

    try {
      await invoke({ action: "delete", id });

      if (draft.id === id) setDraft(emptyDraft);

      toast.success("Document deleted.");
      await loadDocuments();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Deletion failed.",
      );
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-orange-600" />
          <h1 className="text-2xl font-semibold">AI Knowledge Base</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Manage verified FAQs, tours, destination guides, visa guidance,
          travel policies, and company information.
        </p>
      </header>

      {error && (
        <div className="flex gap-2 rounded-md border border-destructive/40 p-3">
          <AlertCircle className="h-4 w-4" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      <form
        onSubmit={saveDocument}
        className="space-y-4 rounded-xl border p-4 md:p-6"
      >
        <h2 className="text-lg font-medium">
          {draft.id ? "Edit document" : "Create document"}
        </h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              required
              minLength={3}
              maxLength={240}
              value={draft.title}
              onChange={(event) => updateDraft("title", event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Slug</Label>
            <Input
              required
              value={draft.slug}
              onChange={(event) => updateDraft("slug", event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Select
              value={draft.category}
              onValueChange={(value) => updateDraft("category", value)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Visibility</Label>
            <Select
              value={draft.visibility}
              onValueChange={(value) => updateDraft("visibility", value)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public AI knowledge</SelectItem>
                <SelectItem value="staff">Staff only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Publication status</Label>
            <Select
              value={draft.status}
              onValueChange={(value) => updateDraft("status", value)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="unpublished">Unpublished</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Source URL</Label>
            <Input
              type="url"
              value={draft.source_url}
              placeholder="https://..."
              onChange={(event) =>
                updateDraft("source_url", event.target.value)
              }
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Verified document content</Label>
          <Textarea
            required
            minLength={1}
            maxLength={200000}
            rows={10}
            value={draft.content}
            placeholder="Enter verified company or travel information."
            onChange={(event) =>
              updateDraft("content", event.target.value)
            }
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving and indexing..." : "Save and index"}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => setDraft(emptyDraft)}
          >
            Clear
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Public AI retrieval only includes published documents whose
          indexing has completed successfully.
        </p>
      </form>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Documents</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadDocuments()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : documents.length === 0 ? (
          <p className="rounded-lg border p-6 text-sm text-muted-foreground">
            No knowledge documents yet.
          </p>
        ) : (
          <div className="space-y-3">
            {documents.map((document) => (
              <article
                key={document.id}
                className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0 space-y-2">
                  <h3 className="font-medium">{document.title}</h3>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{document.category}</Badge>
                    <Badge variant="secondary">{document.status}</Badge>
                    <Badge variant="outline">
                      {document.indexing_status}
                    </Badge>
                    <Badge variant="secondary">{document.visibility}</Badge>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {document.chunk_count} chunks · Updated{" "}
                    {new Date(document.updated_at).toLocaleString()}
                  </p>

                  {document.indexing_error && (
                    <p className="text-sm text-destructive">
                      {document.indexing_error}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void editDocument(document)}
                  >
                    Edit
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void reindexDocument(document.id)}
                  >
                    <RefreshCw className="mr-1 h-3 w-3" />
                    Re-index
                  </Button>

                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void deleteDocument(document.id)}
                    aria-label={`Delete ${document.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
