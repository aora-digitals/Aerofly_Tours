
import {
  Clock3,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquare,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type SavedMessage = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type Props = {
  onOpen: (
    conversationId: string,
    messages: SavedMessage[],
  ) => void;
};

const MAX_CONVERSATIONS = 30;

function readableTitle(title: string | null | undefined): string {
  const normalized = title?.trim();

  if (
    normalized &&
    normalized !== "New travel conversation" &&
    normalized !== "New conversation"
  ) {
    return normalized;
  }

  return "";
}

function titleFromMessage(content: string | undefined): string {
  if (!content?.trim()) return "Travel conversation";

  const normalized = content.trim().replace(/\s+/g, " ");

  return normalized.length > 65
    ? `${normalized.slice(0, 62).trimEnd()}…`
    : normalized;
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AIConversationHistory({ onOpen }: Props) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");

    try {
      const { data: auth, error: authError } =
        await supabase.auth.getUser();

      if (authError || !auth.user) {
        setItems([]);
        setPage(0);
        setError("Sign in to access saved travel conversations.");
        return;
      }

      const { data, error: queryError } = await supabase
        .from("ai_conversations")
        .select("id,title,created_at,updated_at")
        .eq("user_id", auth.user.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(MAX_CONVERSATIONS);

      if (queryError) throw queryError;

      const conversations = (data ?? []) as Conversation[];

      if (!conversations.length) {
        setItems([]);
        setPage(0);
        return;
      }

      // Use the first user message as a fallback when the stored
      // title is empty or still has the database default.
      const ids = conversations.map((item) => item.id);

      const { data: messageRows, error: messagesError } =
        await supabase
          .from("ai_messages")
          .select("conversation_id,role,content,created_at")
          .in("conversation_id", ids)
          .eq("role", "user")
          .order("created_at", { ascending: true });

      if (messagesError) throw messagesError;

      const firstMessageByConversation = new Map<string, string>();

      for (const row of messageRows ?? []) {
        if (
          !firstMessageByConversation.has(row.conversation_id) &&
          typeof row.content === "string"
        ) {
          firstMessageByConversation.set(
            row.conversation_id,
            row.content,
          );
        }
      }

      const titledConversations = conversations.map((item) => {
        const savedTitle = readableTitle(item.title);
        const firstMessage = firstMessageByConversation.get(item.id);

        return {
          ...item,
          title:
            savedTitle ||
            titleFromMessage(firstMessage),
        };
      });

      setItems(titledConversations);
      setPage((current) =>
        Math.min(
          current,
          Math.max(0, titledConversations.length - 1),
        ),
      );
    } catch {
      setError("Conversation history is temporarily unavailable.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = items.length;
  const currentItem = items[page] ?? null;

  async function openConversation(id: string) {
    if (opening || deleting) return;

    setOpening(id);
    setError("");

    try {
      const { data: auth, error: authError } =
        await supabase.auth.getUser();

      if (authError || !auth.user) {
        throw new Error("Please sign in again.");
      }

      // Verify ownership before loading any messages.
      const { data: conversation, error: ownerError } =
        await supabase
          .from("ai_conversations")
          .select("id")
          .eq("id", id)
          .eq("user_id", auth.user.id)
          .is("deleted_at", null)
          .maybeSingle();

      if (ownerError || !conversation) {
        throw new Error("Conversation not found or access denied.");
      }

      const { data, error: messagesError } = await supabase
        .from("ai_messages")
        .select("role,content,created_at")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true })
        .limit(200);

      if (messagesError) throw messagesError;

      const savedMessages: SavedMessage[] = (data ?? [])
        .filter(
          (message) =>
            (message.role === "user" ||
              message.role === "assistant") &&
            typeof message.content === "string",
        )
        .map((message) => ({
          role: message.role as SavedMessage["role"],
          content: message.content,
          created_at: message.created_at,
        }));

      onOpen(id, savedMessages);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to open this conversation.",
      );
    } finally {
      setOpening(null);
    }
  }

  async function deleteConversation(item: Conversation) {
    if (deleting || opening) return;

    const confirmed = window.confirm(
      `Delete "${item.title}" and its saved messages? This cannot be undone.`,
    );

    if (!confirmed) return;

    setDeleting(item.id);
    setError("");

    try {
      const { data: auth, error: authError } =
        await supabase.auth.getUser();

      if (authError || !auth.user) {
        throw new Error("Please sign in again.");
      }

      const { data: ownedConversation, error: ownerError } =
        await supabase
          .from("ai_conversations")
          .select("id")
          .eq("id", item.id)
          .eq("user_id", auth.user.id)
          .is("deleted_at", null)
          .maybeSingle();

      if (ownerError || !ownedConversation) {
        throw new Error("Conversation not found or access denied.");
      }

      const { error: deleteError } = await supabase
        .from("ai_conversations")
        .delete()
        .eq("id", item.id)
        .eq("user_id", auth.user.id);

      if (deleteError) throw deleteError;

      const remaining = items.filter((row) => row.id !== item.id);
      setItems(remaining);

      // Keep the current page valid after deleting its conversation.
      setPage((current) =>
        Math.min(current, Math.max(0, remaining.length - 1)),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to delete the conversation. Please retry.",
      );
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section
      className="rounded-2xl border border-[#e8e4dd] bg-white p-4 sm:p-5"
      aria-label="Saved travel conversations"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock3 size={17} className="text-[#f26b35]" />
          <h3 className="font-['Manrope'] font-extrabold">
            Your travel conversations
          </h3>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          disabled={busy || Boolean(opening) || Boolean(deleting)}
          aria-label="Refresh conversation history"
          title="Refresh history"
          className="rounded-lg p-2 text-[#77736c] transition hover:bg-[#f7f5f1] disabled:opacity-40"
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <RefreshCw size={15} />
          )}
        </button>
      </div>

      {busy && (
        <div className="mt-5 flex items-center justify-center gap-2 py-8 text-sm text-[#77736c]">
          <Loader2 size={16} className="animate-spin text-[#f26b35]" />
          Loading conversations…
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-700"
        >
          {error}
        </div>
      )}

      {!busy && !error && !items.length && (
        <div className="mt-5 rounded-xl bg-[#f7f5f1] px-4 py-8 text-center">
          <MessageSquare
            size={25}
            className="mx-auto text-[#f26b35]"
          />
          <p className="mt-3 text-sm font-bold text-[#242422]">
            No saved conversations yet
          </p>
          <p className="mt-1 text-xs leading-5 text-[#77736c]">
            Your travel conversations will appear here after you chat
            with the AeroFly assistant while signed in.
          </p>
        </div>
      )}

      {!busy && currentItem && (
        <div className="mt-5">
          <div className="rounded-2xl border border-[#eee9e1] bg-[#faf8f5] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-[#c94d1c]">
                <MessageSquare size={18} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[.15em] text-[#a74720]">
                  Saved conversation
                </div>

                <h4 className="mt-1 break-words font-['Manrope'] text-base font-extrabold leading-6 text-[#242422]">
                  {currentItem.title}
                </h4>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#77736c]">
                  <span>
                    Updated {formatDate(currentItem.updated_at)}
                  </span>
                  <span>
                    Created {formatDate(currentItem.created_at)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <button
                type="button"
                disabled={Boolean(opening) || Boolean(deleting)}
                onClick={() => void openConversation(currentItem.id)}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#20201e] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#f26b35] disabled:opacity-50"
              >
                {opening === currentItem.id ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Opening…
                  </>
                ) : (
                  <>
                    <MessageSquare size={14} />
                    Open conversation
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={Boolean(opening) || Boolean(deleting)}
                onClick={() => void deleteConversation(currentItem)}
                aria-label={`Delete ${currentItem.title}`}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#e4dbcf] bg-white px-4 py-2.5 text-xs font-bold text-[#77736c] transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
              >
                {deleting === currentItem.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                Delete
              </button>
            </div>
          </div>

          {/* One conversation per page */}
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#eee9e1] pt-4">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0 || Boolean(opening) || Boolean(deleting)}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold text-[#55534e] transition hover:bg-[#f7f5f1] disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft size={15} />
              Previous
            </button>

            <span className="text-[11px] font-semibold text-[#77736c]" aria-live="polite">
              {page + 1} of {totalPages}
            </span>

            <button
              type="button"
              onClick={() =>
                setPage((current) =>
                  Math.min(totalPages - 1, current + 1),
                )
              }
              disabled={
                page >= totalPages - 1 ||
                Boolean(opening) ||
                Boolean(deleting)
              }
              className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold text-[#55534e] transition hover:bg-[#f7f5f1] disabled:cursor-not-allowed disabled:opacity-30"
            >
              Next
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
