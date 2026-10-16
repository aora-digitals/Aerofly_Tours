import { ArrowRight, Bot, Loader2, RotateCcw, Send } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  loadRecommendationContext,
  scoreTours,
  trackRecommendationEvent,
} from "@/lib/recommendations";

// import AIConversationHistory from "@/components/site/AIConversationHistory";
// import AITravelDiscoveryPanel from "@/components/site/AITravelDiscoveryPanel";

const prompts = [
  "A 5-day Dubai trip for two",
  "Something slow in Kerala",
  "A family holiday under ₹80,000",
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

export default function AITripConcierge() {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Welcome to the AeroFly travel desk! Tell me your destination, budget, trip duration, or preferred travel style. I'll help you explore our published tours and identify the next step.",
    },
  ]);

  const personalizeTours = async (
  candidates: TourResult[],
): Promise<TourResult[]> => {
  if (!user?.id || candidates.length < 2) {
    return candidates;
  }

  try {
    const context = await loadRecommendationContext(
      user.id,
    );

    if (!context.preferences?.personalization_enabled) {
      return candidates;
    }

    const scored = scoreTours(
      candidates.map((tour) => ({
        ...tour,
        destination: tour.destination?.name ?? "",
        country: tour.destination?.country ?? "",
        status: "published",
      })),
      context.preferences,
      {
        wishlistIds: context.wishlistIds,
        recentlyViewedIds: context.recentlyViewedIds,
        dismissedIds: context.dismissedIds,
        limit: Math.min(5, candidates.length),
      },
    );

    const byId = new Map(
      candidates.map((tour) => [tour.id, tour]),
    );

    return scored
      .map((item) => byId.get(Number(item.tour.id)))
      .filter(
        (tour): tour is TourResult =>
          Boolean(tour),
      );
  } catch {
    // Personalization must never break the AI response.
    return candidates;
  }
};

  const resetConversation = () => {
    if (busy) return;
    setConversationId(null);
    setMessages([
      {
        role: "assistant",
        content:
          "Let's start a fresh trip search. Where would you like to go, and what budget or duration do you have in mind?",
      },
    ]);
  };

  const searchFallback = async (query: string): Promise<TourResult[]> => {
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
      .map(({...tour }) => tour);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    const trimmed = message.trim();
    if (trimmed.length < 2 || busy) {
        toast.error("Please enter a message with at least 2 characters.");
        return;
    }
    const previousMessages = messages
      .filter((item) => item.role === "user" || item.role === "assistant")
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

      let responseTours: TourResult[] = Array.isArray(data.tours)
  ? data.tours
  : [];

if (responseTours.length === 0) {
  responseTours = await searchFallback(trimmed);
}
      
      const selectedTours = await personalizeTours(
  responseTours,
);
      setMessages((current) => [
  ...current,
  {
    role: "assistant",
    content:
      selectedTours.length > 0 &&
      (!Array.isArray(data.tours) || data.tours.length === 0)
        ? `${data.reply}\n\nHere are some published AeroFly tours to explore. These are catalogue matches, not confirmed availability.`
        : data.reply,
    tours: selectedTours,
  },
]);

      if (data.providerStatus === "fallback") {
        toast.info("Showing catalogue-based assistance.");
      }
    
} catch (error) {
  const errorMessage = await getAIErrorMessage(error);

  let fallbackTours: TourResult[];

  try {
    fallbackTours = await searchFallback(trimmed);
  } catch {
    fallbackTours = [];
  }

  const selectedFallbackTours =
    await personalizeTours(fallbackTours);

  setMessages((current) => [
    ...current,
    {
      role: "assistant",
      content: selectedFallbackTours.length
        ? "I couldn't get a response from the AI provider, so I've searched the published AeroFly catalogue instead. These are catalogue matches, not confirmed departures. Please contact our team to verify your dates and final price."
        : "I couldn't retrieve any published tours right now. Please try again or browse our tour catalogue.",
      tours: selectedFallbackTours,
    },
  ]);

  toast.error(errorMessage);
} finally {
  setBusy(false);
}

  };

  async function getAIErrorMessage(error: unknown): Promise<string> {
  const fallback = "The AI assistant couldn't respond. Please try again.";

  if (!error || typeof error !== "object") {
    return fallback;
  }

  const err = error as {
    message?: string;
    context?: unknown;
  };

  // Supabase FunctionsHttpError usually stores the HTTP Response here.
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
      // The response wasn't JSON; use a friendly fallback below.
    }
  }

  // Handle a structured error if one was returned directly.
  if (
    typeof err.message === "string" &&
    err.message.trim() &&
    !/functionshttperror|non-2xx|failed to send a request/i.test(err.message)
  ) {
    return err.message;
  }

  return fallback;
}

  return (
    <section className="overflow-hidden rounded-[28px] bg-[#20201e] text-white shadow-[0_24px_70px_rgba(31,29,26,.18)]">
      <div className="grid lg:grid-cols-[.8fr_1.2fr]">
        <div className="relative overflow-hidden p-7 sm:p-10">
          <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[#f26b35]/20 blur-2xl" />

          <div className="relative">
            <div className="flex items-center gap-2 text-[#ffac88]">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-[#f26b35] text-white">
                <Bot size={17} />
              </div>
              <span className="eyebrow text-[#ffac88]">
                AeroFly AI travel desk
              </span>
            </div>

            <h2 className="display mt-7 text-4xl font-extrabold sm:text-5xl">
              A smarter way to start your trip.
            </h2>

            <p className="mt-5 max-w-[390px] text-[14px] leading-7 text-white/70">
              Explore published tours, compare trip durations and starting
              prices, and get help planning your next journey.
            </p>

            <div className="mt-8 flex flex-wrap gap-2">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setMessage(prompt)}
                  disabled={busy}
                  className="rounded-full border border-white/15 px-3 py-2 text-left text-[11px] font-semibold text-white/80 transition hover:border-[#f26b35] hover:text-white disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>

            <Link
              href="/plan-my-trip"
              className="mt-8 inline-flex items-center gap-2 text-[12px] font-bold text-[#ffac88] hover:text-white"
            >
              Prefer a human itinerary? <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        <div className="bg-white p-4 text-[#242422] sm:p-6">
          <div className="flex h-[520px] flex-col rounded-2xl bg-[#f7f5f1] p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 border-b border-[#e8e4dd] pb-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77736c]">
                  AI travel assistant
                </div>
                <div className="mt-1 text-[10px] text-[#77736c]">
                  Published catalogue · Starting prices
                </div>
              </div>

              <button
                type="button"
                onClick={resetConversation}
                disabled={busy}
                aria-label="Start a new conversation"
                title="New conversation"
                className="rounded-lg p-2 text-[#77736c] hover:bg-white disabled:opacity-40"
              >
                <RotateCcw size={15} />
              </button>
            </div>

            <div
              className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4"
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
                    <div
                      className={`max-w-[92%] rounded-2xl px-4 py-3 text-[12px] leading-6 ${
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
                    <div className="mt-3 grid gap-3">
                      {item.tours.map((tour) => (
                        <Link
  key={tour.id}
  href={`/tours/${tour.slug}`}
  onClick={() => {
    if (user?.id) {
      void trackRecommendationEvent(
        user.id,
        tour.id,
        "click",
        "ai_assistant",
      );
    }
  }}
  className="flex gap-3 rounded-xl border border-[#e8e4dd] bg-white p-3 transition hover:border-[#f26b35]"
>
                          {tour.imageUrl ? (
                            <img
                              src={tour.imageUrl}
                              alt=""
                              loading="lazy"
                              className="h-20 w-20 shrink-0 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-lg bg-[#f3ede5] text-[#c94d1c]">
                              <Bot size={20} />
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="font-['Manrope'] text-sm font-extrabold">
                              {tour.title}
                            </div>
                            <p className="mt-1 text-[11px] text-[#77736c]">
                              {tour.destination
                                ? `${tour.destination.name}, ${tour.destination.country}`
                                : "AeroFly tour"}
                            </p>
                            <p className="mt-1 text-[11px] text-[#77736c]">
                              {tour.durationDays} days · {tour.durationNights}{" "}
                              nights
                            </p>
                            <p className="mt-1 text-xs font-bold text-[#c94d1c]">
                              {Number.isFinite(Number(tour.priceFrom))
                                ? `From ₹${Number(tour.priceFrom).toLocaleString("en-IN")}`
                                : "Contact us for pricing"}
                            </p>
                            <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-[#55534e]">
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
                <div className="flex items-center gap-2 text-[11px] text-[#92928b]">
                  <Loader2 size={14} className="animate-spin text-[#f26b35]" />
                  Checking the AeroFly catalogue…
                </div>
              )}
            </div>

            <form
              onSubmit={submit}
              className="flex items-center gap-2 border-t border-[#e8e4dd] pt-3"
            >
              <input
                className="field min-h-10 flex-1 border-0 bg-white text-[12px]"
                value={message}
                maxLength={1200}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Try: a quiet 4-day beach break"
                aria-label="Message the AeroFly travel assistant"
                disabled={busy}
              />
              <button
                type="submit"
                aria-label="Ask AeroFly AI"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#20201e] text-white transition hover:bg-[#f26b35] disabled:opacity-40"
                disabled={message.trim().length < 2 || busy}
              >
                {busy ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Send size={15} />
                )}
              </button>
            </form>
          </div>
        </div>
        {/* <div className="mt-5">
  <AIConversationHistory
    onOpen={(id, savedMessages) => {
      setConversationId(id);
      setMessages([
        {
          role: "assistant",
          content: "Your saved travel conversation has been restored.",
        },
        ...savedMessages.map(({ role, content }) => ({
          role,
          content,
        })),
      ]);
    }}
  />
</div> */}

{/* <div className="min-w-0">
    <AITravelDiscoveryPanel />
  </div> */}
      </div>
    </section>
  );
}
