
import {
  ArrowRight,
  Bot,
  ChevronDown,
  Loader2,
  MapPinned,
  Plane,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

const quickPrompts = [
  "Find a tour",
  "Plan a family holiday",
  "Suggest a trip under ₹80,000",
];

type TourResult = {
  id: number;
  slug: string;
  title: string;
  destination: { name: string; country: string } | null;
  durationDays: number;
  durationNights: number;
  priceFrom: number | string;
  imageUrl: string | null;
  availability: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  tours?: TourResult[];
};

type AIResponse = {
  reply: string;
  conversationId: string | null;
  tours: TourResult[];
  providerStatus: "model" | "fallback";
};

const welcomeMessage: ChatMessage = {
  role: "assistant",
  content:
    "Welcome to the AeroFly travel desk! ✈️ Tell me where you'd like to go, your budget, travel dates, or preferred travel style. I'll help you explore our published tours and plan your next step.",
};

export default function FloatingTravelConcierge() {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);

  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isOpen, messages, busy]);

  const resetConversation = () => {
    if (busy) return;

    // Starting a new chat creates a new conversation on the next send.
    // The existing server-side conversation is not deleted.
    setConversationId(null);
    setMessages([
      {
        role: "assistant",
        content:
          "Let's plan something new! Where would you like to travel, and what budget or trip duration do you have in mind?",
      },
    ]);
    setMessage("");
    inputRef.current?.focus();
  };

  async function searchFallback(query: string): Promise<TourResult[]> {
    const { data, error } = await supabase
      .from("tours")
      .select(
        'id,slug,title,"durationDays","durationNights","priceFrom","imageUrl",availability,destinations!tours_destination_fk(name,country)',
      )
      .eq("status", "published")
      .limit(50);

    if (error || !data) return [];

    const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];

    return data
      .map((row) => {
        const destination = Array.isArray(row.destinations)
          ? (row.destinations[0] ?? null)
          : row.destinations;

        const searchable = [
          row.title,
          destination?.name,
          destination?.country,
        ]
          .join(" ")
          .toLowerCase();

        const score = terms.reduce(
          (total, term) =>
            total + (term.length >= 3 && searchable.includes(term) ? 1 : 0),
          0,
        );

        return {
          id: row.id,
          slug: row.slug,
          title: row.title,
          destination,
          durationDays: row.durationDays,
          durationNights: row.durationNights,
          priceFrom: row.priceFrom,
          imageUrl: row.imageUrl,
          availability: row.availability,
          score,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ ...tour }) => tour);
  }

  async function getAIErrorMessage(error: unknown): Promise<string> {
    const fallback = "The travel assistant couldn't respond. Please try again.";

    if (!error || typeof error !== "object") return fallback;

    const err = error as { message?: string; context?: unknown };

    if (err.context instanceof Response) {
      try {
        const body = await err.context.clone().json();

        if (typeof body?.error === "string" && body.error.trim()) {
          return body.error;
        }

        if (typeof body?.message === "string" && body.message.trim()) {
          return body.message;
        }
      } catch {
        // Use the friendly fallback if the response isn't JSON.
      }
    }

    if (
      typeof err.message === "string" &&
      err.message.trim() &&
      !/functionshttperror|non-2xx|failed to send a request/i.test(
        err.message,
      )
    ) {
      return err.message;
    }

    return fallback;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = message.trim();

    if (trimmed.length < 2 || busy) {
      if (!busy) toast.error("Please enter a message with at least 2 characters.");
      return;
    }

    const previousMessages = messages
      .filter(
        (item) => item.role === "user" || item.role === "assistant",
      )
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));

    setMessages((current) => [
      ...current,
      { role: "user", content: trimmed },
    ]);
    setMessage("");
    setBusy(true);

    try {
      const { data, error } = await supabase.functions.invoke<AIResponse>(
        "ai-travel",
        {
          body: {
            message: trimmed,
            history: previousMessages,
            conversationId,
          },
        },
      );

      if (error || !data || typeof data.reply !== "string") {
        throw new Error(error?.message ?? "AI response unavailable");
      }

      setConversationId(data.conversationId ?? conversationId);

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.reply,
          tours: data.tours ?? [],
        },
      ]);

      if (data.providerStatus === "fallback") {
        toast.info("Showing catalogue-based travel assistance.");
      }
    } catch (error) {
      const errorMessage = await getAIErrorMessage(error);
      const fallbackTours = await searchFallback(trimmed).catch(() => []);

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: fallbackTours.length
            ? "The AI assistant couldn't answer just now, so I've searched the published AeroFly catalogue instead. These are catalogue matches, not confirmed departures. Please contact our team to verify dates and final prices."
            : "The AI assistant and catalogue search are temporarily unavailable. You can browse our published tours or send a custom request to our travel team.",
          tours: fallbackTours,
        },
      ]);

      toast.error(errorMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-4 z-[100] flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {isOpen && (
        <section
          aria-label="AeroFly Travel Concierge"
          className="flex h-[min(640px,calc(100dvh-112px))] w-[min(390px,calc(100vw-24px))] flex-col overflow-hidden rounded-[24px] border border-[#eadfd6] bg-white shadow-[0_24px_80px_rgba(31,29,26,.24)]"
        >
          {/* Branded header */}
          <header className="flex shrink-0 items-center gap-3 bg-[#f26b35] px-4 py-4 text-white">
            <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-[#f26b35] shadow-sm">
              <Plane size={22} />
              <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full border-2 border-[#f26b35] bg-[#2d8b57] text-[8px]">
                ✓
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate font-['Manrope'] text-sm font-extrabold">
                AeroFly Travel Concierge
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-white/85">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                Here to help with your journey
              </div>
            </div>

            <button
              type="button"
              onClick={resetConversation}
              disabled={busy}
              aria-label="Start a new conversation"
              title="New conversation"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white/90 transition hover:bg-white/15 disabled:opacity-40"
            >
              <RotateCcw size={16} />
            </button>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Minimise travel chat"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white/90 transition hover:bg-white/15"
            >
              <ChevronDown size={21} />
            </button>
          </header>

          {/* Context label */}
          <div className="flex shrink-0 items-center gap-2 border-b border-[#eee7df] bg-[#fffaf6] px-4 py-2.5">
            <MapPinned size={14} className="text-[#c94d1c]" />
            <span className="text-[10px] font-semibold text-[#77736c]">
              Published tours · Starting prices · Travel guidance
            </span>
          </div>

          {/* Conversation */}
          <div
            className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[#f8f6f2] px-3 py-4 sm:px-4"
            aria-live="polite"
            aria-busy={busy}
          >
            {messages.map((item, index) => (
              <div key={`${index}-${item.role}`}>
                <div
                  className={`flex ${
                    item.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {item.role === "assistant" && (
                    <div className="mr-2 mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-[#ffeadf] text-[#c94d1c]">
                      <Bot size={15} />
                    </div>
                  )}

                  <div
                    className={`max-w-[84%] rounded-2xl px-3.5 py-3 text-[12px] leading-6 ${
                      item.role === "user"
                        ? "rounded-br-md bg-[#f26b35] text-white"
                        : "rounded-bl-md bg-white text-[#5d5d57] shadow-sm"
                    }`}
                  >
                    {item.role === "assistant" ? (
                      <Streamdown>{item.content}</Streamdown>
                    ) : (
                      <p className="whitespace-pre-wrap">{item.content}</p>
                    )}
                  </div>
                </div>

                {item.tours && item.tours.length > 0 && (
                  <div className="ml-9 mt-3 grid gap-2.5">
                    {item.tours.map((tour) => (
                      <Link
                        key={tour.id}
                        href={`/tours/${tour.slug}`}
                        onClick={() => setIsOpen(false)}
                        className="flex gap-3 rounded-xl border border-[#e8e4dd] bg-white p-3 transition hover:border-[#f26b35]"
                      >
                        {tour.imageUrl ? (
                          <img
                            src={tour.imageUrl}
                            alt=""
                            loading="lazy"
                            className="h-[68px] w-[68px] shrink-0 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="grid h-[68px] w-[68px] shrink-0 place-items-center rounded-lg bg-[#fff0e8] text-[#c94d1c]">
                            <Plane size={20} />
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 font-['Manrope'] text-xs font-extrabold text-[#242422]">
                            {tour.title}
                          </div>
                          <p className="mt-1 text-[10px] text-[#77736c]">
                            {tour.destination
                              ? `${tour.destination.name}, ${tour.destination.country}`
                              : "AeroFly tour"}
                          </p>
                          <p className="mt-1 text-[10px] text-[#77736c]">
                            {tour.durationDays} days · {tour.durationNights} nights
                          </p>
                          <p className="mt-1 text-[11px] font-bold text-[#c94d1c]">
                            {Number.isFinite(Number(tour.priceFrom))
                              ? `From ₹${Number(tour.priceFrom).toLocaleString("en-IN")}`
                              : "Contact us for pricing"}
                          </p>
                        </div>
                        <ArrowRight
                          size={14}
                          className="mt-1 shrink-0 text-[#c94d1c]"
                        />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 pl-9 text-[11px] text-[#92928b]">
                <Loader2 size={14} className="animate-spin text-[#f26b35]" />
                Checking the AeroFly catalogue…
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick prompts only before the first user message */}
          {messages.filter((item) => item.role === "user").length === 0 && (
            <div className="shrink-0 border-t border-[#eee7df] bg-white px-3 pb-3 pt-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[.12em] text-[#77736c]">
                Start exploring
              </p>
              <div className="flex flex-wrap gap-2">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setMessage(prompt)}
                    disabled={busy}
                    className="rounded-full border border-[#eadfd6] bg-[#fffaf6] px-3 py-2 text-left text-[10px] font-semibold text-[#5d5d57] transition hover:border-[#f26b35] hover:text-[#c94d1c] disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message composer */}
          <form
            onSubmit={submit}
            className="flex shrink-0 items-center gap-2 border-t border-[#eee7df] bg-white p-3"
          >
            <input
              ref={inputRef}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#e8e4dd] bg-[#faf9f7] px-3 text-[12px] text-[#242422] outline-none transition placeholder:text-[#92928b] focus:border-[#f26b35] focus:ring-2 focus:ring-[#f26b35]/10"
              value={message}
              maxLength={1200}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Where would you like to go?"
              aria-label="Message the AeroFly travel assistant"
              disabled={busy}
            />
            <button
              type="submit"
              aria-label="Send message"
              disabled={message.trim().length < 2 || busy}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#f26b35] text-white transition hover:bg-[#d95624] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </form>

          <div className="shrink-0 bg-white pb-2 text-center text-[9px] text-[#92928b]">
            Helpful travel guidance · Bookings require team confirmation
          </div>
        </section>
      )}

     {/* Floating travel-themed toggle */}
<button
  type="button"
  onClick={() => setIsOpen((current) => !current)}
  aria-label={isOpen ? "Close AeroFly travel chat" : "Open AeroFly travel chat"}
  aria-expanded={isOpen}
  // title="Chat with AeroFly"
  className={`group relative flex h-14 items-center justify-center rounded-full border border-white/25 bg-[#f26b35] text-white shadow-[0_10px_35px_rgba(194,76,30,.38)] transition-all duration-300 hover:bg-[#d95624] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f26b35]/30 ${
    isOpen ? "w-14" : "w-14 hover:w-48"
  }`}
>
  {!isOpen ? <Plane
    size={23}
    className="shrink-0 transition-transform duration-300 group-hover:-rotate-16"
  /> : (
    <X
    size={23}
    className="shrink-0 transition-transform duration-300 hover:scale-120"
  />
  )}

  {!isOpen && (
    <span className="max-w-0 shrink-0 overflow-hidden whitespace-nowrap text-sm font-semibold opacity-0 transition-all duration-300 group-hover:ml-2 group-hover:max-w-36 group-hover:opacity-100">
      Chat with AeroFly
    </span>
  )}
</button>
    </div>
  );
}
