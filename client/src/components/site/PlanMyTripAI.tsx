import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Loader2, Send, Sparkles, ArrowRight} from "lucide-react";
import { useState} from "react";
import { Link } from "wouter";
import { supabase } from "@/lib/supabase";

type Tour = {
  id: number;
  slug: string;
  title: string;
  destination: { name: string; country: string } | null;
  durationDays: number;
  durationNights: number;
  priceFrom: number | string;
  imageUrl: string | null;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  tours?: Tour[];
};

const suggestions = [
  "Plan a 5-day family trip under ₹80,000",
  "Suggest a honeymoon destination",
  "Explore international tours from Pune",
];

export default function PlanMyTripAI() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Namaste! I'm your AeroFly AI travel assistant. Tell me where you'd like to go, your budget, trip duration, or the kind of holiday you have in mind. I'll help you explore our published tours.",
    },
  ]);
  const [error, setError] = useState("");

  async function send(text?: string) {
  const question = (text ?? input).trim();

    if (question.length < 3 || busy) return;

    const history = messages.slice(-8).map(({ role, content }) => ({
      role,
      content,
    }));

    setMessages((current) => [
      ...current,
      { role: "user", content: question },
    ]);
    setInput("");
    setBusy(true);
    setError("");

    try {
      const { data, error: invokeError } =
        await supabase.functions.invoke("ai-travel", {
          body: {
            message: question,
            history,
            conversationId,
          },
        });

      if (invokeError) throw invokeError;
      if (!data || typeof data.reply !== "string") {
        throw new Error("The AI service returned an invalid response.");
      }

      setConversationId(data.conversationId ?? conversationId);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.reply,
          tours: Array.isArray(data.tours) ? data.tours : [],
        },
      ]);
    } catch {
      setError(
        "The AI assistant could not respond right now. Please retry or use the trip enquiry form below.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <section className="overflow-hidden rounded-[28px] border border-[#e8e0d5] bg-white shadow-sm">
      <div className="bg-[#242320] p-6 text-white sm:p-9">
        <div className="flex items-center gap-2 text-[#ffad89]">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#f26b35] text-white">
            <Bot size={19} />
          </div>
          <span className="text-xs font-bold uppercase tracking-[.16em]">
            AeroFly AI Travel Guide
          </span>
          <Sparkles size={15} />
        </div>

        <h2 className="display mt-5 text-3xl font-extrabold sm:text-4xl">
          Let's plan a trip that's yours.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
          Chat about your destination, budget, travel dates and preferences.
          Explore published AeroFly tours before sending a trip request.
        </p>
      </div>

      <div className="p-4 sm:p-6">
        <div
          className="max-h-[480px] min-h-[220px] space-y-4 overflow-y-auto"
          aria-live="polite"
          aria-busy={busy}
        >
          {messages.map((message, index) => (
            <div key={`${index}-${message.role}`}>
              <div
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                    message.role === "user"
                      ? "bg-[#f26b35] text-white"
                      : "bg-[#f7f5f1] text-[#4f4c46]"
                  }`}
                >

<div className="min-w-0 text-sm leading-7 text-foreground">
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      h1: ({ children }) => (
        <h2 className="mb-3 mt-5 text-xl font-bold">{children}</h2>
      ),
      h2: ({ children }) => (
        <h3 className="mb-2 mt-5 text-lg font-semibold">{children}</h3>
      ),
      h3: ({ children }) => (
        <h4 className="mb-2 mt-4 font-semibold">{children}</h4>
      ),
      p: ({ children }) => (
        <p className="mb-3 last:mb-0">{children}</p>
      ),
      ul: ({ children }) => (
        <ul className="mb-4 list-disc space-y-2 pl-5">{children}</ul>
      ),
      ol: ({ children }) => (
        <ol className="mb-4 list-decimal space-y-2 pl-5">{children}</ol>
      ),
      strong: ({ children }) => (
        <strong className="font-semibold text-foreground">{children}</strong>
      ),
      table: ({ children }) => (
        <div className="my-4 w-full overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[600px] border-collapse text-left text-sm">
            {children}
          </table>
        </div>
      ),
      thead: ({ children }) => (
        <thead className="bg-muted">{children}</thead>
      ),
      th: ({ children }) => (
        <th className="border-b px-4 py-3 font-semibold">{children}</th>
      ),
      td: ({ children }) => (
        <td className="border-b px-4 py-3 align-top">{children}</td>
      ),
      a: ({ children, href }) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary underline underline-offset-4"
        >
          {children}
        </a>
      ),
    }}
  >
    {message.content}
  </ReactMarkdown>
</div>
                </div>
              </div>

              {message.tours && message.tours.length > 0 && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {message.tours.map((tour) => (
                    <Link
                      key={tour.id}
                      href={`/tours/${tour.slug}`}
                      className="flex gap-3 rounded-xl border border-[#e8e0d5] p-3 transition hover:border-[#f26b35]"
                    >
                      {tour.imageUrl ? (
                        <img
                          src={tour.imageUrl}
                          alt=""
                          loading="lazy"
                          className="h-20 w-20 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="grid h-20 w-20 shrink-0 place-items-center rounded-lg bg-[#f3ede5]">
                          <Bot size={22} />
                        </div>
                      )}

                      <div className="min-w-0">
                        <p className="text-sm font-bold">{tour.title}</p>
                        <p className="mt-1 text-xs text-[#77736c]">
                          {tour.destination
                            ? `${tour.destination.name}, ${tour.destination.country}`
                            : "AeroFly tour"}
                        </p>
                        <p className="mt-1 text-xs text-[#77736c]">
                          {tour.durationDays} days · {tour.durationNights} nights
                        </p>
                        <p className="mt-1 text-xs font-bold text-[#c94d1c]">
                          {Number.isFinite(Number(tour.priceFrom))
                            ? `From ₹${Number(tour.priceFrom).toLocaleString("en-IN")}`
                            : "Contact us for pricing"}
                        </p>
                        <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold">
                          View tour <ArrowRight size={12} />
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="flex items-center gap-2 text-sm text-[#77736c]">
              <Loader2 size={16} className="animate-spin text-[#f26b35]" />
              Checking your travel options…
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={busy}
              onClick={() => {
                void send(suggestion);
              }}
              className="rounded-full border border-[#e8e0d5] px-3 py-2 text-left text-xs font-semibold hover:border-[#f26b35] disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>

        <form
          onSubmit={() => void send()}
          className="mt-4 flex items-center gap-2 border-t border-[#eee9e1] pt-4"
        >
          <input
            className="field min-w-0 flex-1"
            value={input}
            maxLength={1200}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Tell me about your ideal trip…"
            aria-label="Message the AI travel planner"
            disabled={busy}
          />
          <button
            type="submit"
            className="btn btn-primary shrink-0"
            disabled={busy || input.trim().length < 3}
            aria-label="Send message"
          >
            {busy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            <span className="hidden sm:inline">Ask AI</span>
          </button>
        </form>

        <p className="mt-3 text-xs leading-5 text-[#77736c]">
          Tour prices are starting prices. Departure availability and final
          quotations must be confirmed by the AeroFly team.
        </p>
      </div>
    </section>
    </>
  );
}
