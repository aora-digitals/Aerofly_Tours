import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileText,
  MessageSquare,
  PencilLine,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { trpc } from "@/lib/trpc";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const money = (value: unknown, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));

const statusLabel: Record<string, string> = {
  DRAFT: "Draft",
  ISSUED: "Awaiting your response",
  EDIT_REQUESTED: "Changes requested",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  WITHDRAWN: "Withdrawn",
};

type RazorpaySuccessResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpaySuccessResponse) => void;
  modal?: {
    ondismiss?: () => void;
  };
};

type RazorpayInstance = {
  open: () => void;
  on: (
    event: "payment.failed",
    handler: (response: {
      error?: { description?: string };
    }) => void,
  ) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]',
    );

    const script = existing ?? document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;

    script.onload = () => {
      if (window.Razorpay) resolve();
      else reject(new Error("Razorpay Checkout could not be loaded."));
    };

    script.onerror = () =>
      reject(new Error("Unable to load Razorpay Checkout."));

    if (!existing) document.head.appendChild(script);
  });
}

export default function CustomerOffers() {
  const utils = trpc.useUtils();
  const offersQuery = trpc.customer.offers.useQuery(undefined, { retry: 1 });
  const [messageByOffer, setMessageByOffer] = useState<Record<number, string>>(
    {},
  );
  const [editingOffer, setEditingOffer] = useState<number | null>(null);
  const [checkoutKeys, setCheckoutKeys] = useState<Record<number, string>>({});


  const startCheckout = (quotationId: number) => {
  const idempotencyKey =
    checkoutKeys[quotationId] ?? window.crypto.randomUUID();

  if (!checkoutKeys[quotationId]) {
    setCheckoutKeys((current) => ({
      ...current,
      [quotationId]: idempotencyKey,
    }));
  }

  checkout.mutate({ quotationId, idempotencyKey });
};

  const respond = trpc.customer.respondToOffer.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.customer.offers.invalidate(),
        utils.customer.dashboard.invalidate(),
      ]);
      const action = (result as { action?: string } | null)?.action;
      if (action === "accepted")
        toast.success(
          "Offer accepted. Your booking is now available in My Bookings.",
        );
      else if (action === "changes_requested")
        toast.success(
          "Your requested changes have been sent to the travel consultant.",
        );
      else if (action === "cancelled")
        toast.success(
          "Cancellation recorded. Any payment/refund will be reviewed separately by the team.",
        );
      else toast.success("Your response has been recorded.");
      setEditingOffer(null);
    },
    onError: (error) =>
      toast.error(error.message || "Unable to update this offer."),
  });

  
type PaymentCreateResult = {
  paymentReference: string;
  provider: "stripe" | "razorpay" | "mock";
  providerOrderId: string;
  checkoutUrl?: string | null;
  clientKey?: string | null;
  amountMinor: number;
  currency: string;
  status: string;
};

const checkout = useMutation({
  mutationFn: async ({
    quotationId,
    idempotencyKey,
  }: {
    quotationId: number;
    idempotencyKey: string;
  }): Promise<PaymentCreateResult> => {
    const { data, error } = await supabase.functions.invoke(
      "payment-create",
      {
        body: { quotationId, idempotencyKey },
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );

    if (error) throw new Error(error.message);

    if (!data || data.error) {
      throw new Error(data?.error || "Unable to initialize payment.");
    }

    return data as PaymentCreateResult;
  },

  onSuccess: async (result) => {
    if (result.provider === "stripe") {
      if (!result.checkoutUrl) {
        toast.error("Stripe did not return a checkout URL.");
        return;
      }

      window.location.assign(result.checkoutUrl);
      return;
    }

    if (result.provider === "razorpay") {
      if (!result.clientKey || !result.providerOrderId) {
        toast.error("Razorpay order details are incomplete.");
        return;
      }

      try {
        await loadRazorpayScript();

        if (!window.Razorpay) {
          throw new Error("Razorpay Checkout is unavailable.");
        }

        const razorpay = new window.Razorpay({
          key: result.clientKey,
          amount: result.amountMinor,
          currency: result.currency,
          name: "AeroFly Tours",
          description: "Booking payment",
          order_id: result.providerOrderId,

          handler: (_response) => {
            // Do not mark the payment successful in the browser.
            // The verified Razorpay webhook controls payment status.
            toast.success(
              "Payment submitted. Your payment status will update after verification.",
            );
          },

          modal: {
            ondismiss: () => {
              toast.message(
                "Checkout closed. Your booking offer remains available.",
              );
            },
          },
        });

        razorpay.on("payment.failed", (response) => {
          toast.error(
            response.error?.description || "The payment was not completed.",
          );
        });

        razorpay.open();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to open Razorpay Checkout.",
        );
      }

      return;
    }

    toast.error("The selected payment provider is not enabled.");
  },

  onError: (error) => {
    toast.error(error.message || "Unable to start payment.");
  },
});


  const offers = useMemo(() => {
    const rows = offersQuery.data ?? [];
    const latestByEnquiry = new Map<number, (typeof rows)[number]>();

    for (const offer of rows) {
      const enquiryId = Number(offer.enquiryId);

      // Offers without an enquiry link are retained separately.
      if (!Number.isInteger(enquiryId) || enquiryId < 1) {
        latestByEnquiry.set(-Number(offer.id), offer);
        continue;
      }

      const current = latestByEnquiry.get(enquiryId);
      const currentVersion = Number(current?.offer_version ?? 0);
      const candidateVersion = Number(offer.offer_version ?? 0);

      if (
        !current ||
        candidateVersion > currentVersion ||
        (candidateVersion === currentVersion &&
          new Date(offer.createdAt).getTime() >
            new Date(current.createdAt).getTime())
      ) {
        latestByEnquiry.set(enquiryId, offer);
      }
    }

    return [...latestByEnquiry.values()].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [offersQuery.data]);

  const runAction = (
    quotationId: number,
    action: "accept" | "reject" | "request_changes" | "cancel",
  ) => {
    const message = messageByOffer[quotationId]?.trim() || undefined;
    if (action === "request_changes" && !message) {
      toast.error(
        "Describe the changes you would like the consultant to make.",
      );
      setEditingOffer(quotationId);
      return;
    }
    if (
      action === "reject" &&
      !window.confirm(
        "Reject this booking offer? You can contact your consultant if you change your mind.",
      )
    )
      return;
    if (
      action === "cancel" &&
      !window.confirm(
        "Cancel this offer/booking? Any completed payment will not be refunded automatically.",
      )
    )
      return;
    respond.mutate({ quotationId, action, message });
  };

  return (
    <div className="min-h-screen bg-[#fbfaf8] text-[#242321]">
      <Header />
      <main className="mx-auto min-h-[65vh] w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-orange-700">
              Your travel consultant
            </p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Booking offers
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">
              AeroFly staff prepare your trip offer after discussing your
              requirements. Review the details here, request changes, accept, or
              reject it. Payment is available after acceptance.
            </p>
          </div>
          <Link
            href="/dashboard/enquiries"
            className="inline-flex items-center gap-2 self-start rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold hover:border-orange-600 sm:self-auto"
          >
            <MessageSquare size={16} /> View my enquiries
          </Link>
        </div>

        {offersQuery.isLoading && (
          <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-sm text-neutral-600">
            Loading your offers…
          </div>
        )}
        {offersQuery.isError && (
          <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
            <AlertCircle size={19} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold">We could not load your offers.</p>
              <p className="mt-1">
                Please refresh the page or contact your travel consultant.
              </p>
              <button
                className="mt-3 underline"
                onClick={() => void offersQuery.refetch()}
              >
                Try again
              </button>
            </div>
          </div>
        )}
        {!offersQuery.isLoading &&
          !offersQuery.isError &&
          offers.length === 0 && (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-14 text-center">
              <FileText className="mx-auto text-orange-700" size={34} />
              <h2 className="mt-4 text-xl font-bold">No booking offers yet</h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-neutral-600">
                Once our team has discussed your enquiry and prepared an offer,
                it will appear here. You can continue browsing tours or contact
                us for a callback.
              </p>
              <Link
                href="/tours"
                className="mt-5 inline-flex rounded-full bg-[#242321] px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-700"
              >
                Explore tours
              </Link>
            </div>
          )}

        <div className="space-y-5">
          {offers.map((offer) => {
            const status = String(
              offer.customer_response ?? "awaiting_response",
            );
            const details = (offer.booking_details ?? {}) as {
              tourTitle?: string;
              cancellationTerms?: string;
              paymentTerms?: string;
              departureCity?: string;
              departureDate?: string;
              returnDate?: string;
              travellerNames?: string[];
            };
            const canRespond =
              ["awaiting_response", "changes_requested"].includes(status) &&
              ["sent", "viewed"].includes(String(offer.status));
            const accepted =
              status === "accepted" && offer.status === "accepted";
            const cancelledOrRejected =
              ["cancelled", "rejected"].includes(status) ||
              offer.status === "rejected" ||
              offer.status === "expired";
            return (
              <article
                key={offer.id}
                className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm"
              >
                <div className="flex flex-col gap-4 border-b border-neutral-100 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-800">
                        {offer.reference}
                      </span>

                      <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-700">
                        Version {offer.offer_version ?? 1}
                      </span>

                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${accepted ? "bg-emerald-50 text-emerald-800" : cancelledOrRejected ? "bg-neutral-100 text-neutral-600" : "bg-amber-50 text-amber-800"}`}
                      >
                        {offer.status === "expired"
                          ? "Expired"
                          : (statusLabel[status] ?? String(offer.status))}
                      </span>
                    </div>
                    <h2 className="mt-3 text-xl font-bold">
                      {details.tourTitle || offer.destination || "Custom trip"}
                    </h2>
                    <p className="mt-1 text-sm text-neutral-600">
                      {offer.destination} · {offer["travelDates"]} ·{" "}
                      {offer.travellers} traveller
                      {offer.travellers === 1 ? "" : "s"}
                    </p>
                    {(details.departureCity ||
                      details.departureDate ||
                      details.returnDate) && (
                      <p className="mt-1 text-xs text-neutral-500">
                        {details.departureCity
                          ? `From ${details.departureCity}`
                          : ""}
                        {details.departureDate
                          ? ` · Departure ${details.departureDate}`
                          : ""}
                        {details.returnDate
                          ? ` · Return ${details.returnDate}`
                          : ""}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-neutral-500">
                      Issued{" "}
                      {offer["sentAt"]
                        ? new Date(offer["sentAt"]).toLocaleDateString()
                        : "date unavailable"}
                      {offer["validUntil"]
                        ? ` · Valid until ${new Date(offer["validUntil"]).toLocaleDateString()}`
                        : ""}
                    </p>
                  </div>
                  <div className="sm:text-right">
                    <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                      Total offer
                    </p>
                    <p className="mt-1 text-2xl font-extrabold">
                      {money(offer.total, offer.currency)}
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                      Taxes {money(offer.taxes, offer.currency)} · Discount{" "}
                      {money(offer.discount, offer.currency)}
                    </p>
                  </div>
                </div>

                <div className="grid gap-6 p-5 sm:grid-cols-[1.3fr_.7fr] sm:p-6">
                  <div>
                    <h3 className="mb-3 text-sm font-bold">Price breakdown</h3>
                    <div className="overflow-x-auto rounded-xl border border-neutral-100">
                      <table className="w-full min-w-[360px] text-left text-sm">
                        <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                          <tr>
                            <th className="px-3 py-2.5">Description</th>
                            <th className="px-3 py-2.5 text-right">Qty</th>
                            <th className="px-3 py-2.5 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(offer.items ?? []).map((item) => (
                            <tr
                              key={item.id}
                              className="border-t border-neutral-100"
                            >
                              <td className="px-3 py-3">{item.description}</td>
                              <td className="px-3 py-3 text-right">
                                {item.quantity}
                              </td>
                              <td className="px-3 py-3 text-right font-medium">
                                {money(item.lineTotal, offer.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-neutral-200">
                            <td className="px-3 py-3 font-semibold" colSpan={2}>
                              Total
                            </td>
                            <td className="px-3 py-3 text-right font-semibold">
                              {money(offer.total, offer.currency)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    {offer.notes && (
                      <div className="mt-4 rounded-xl bg-neutral-50 p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                          Consultant's notes
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                          {offer.notes}
                        </p>
                      </div>
                    )}
                    {details.paymentTerms && (
                      <div className="mt-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                          Payment terms
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-neutral-700">
                          {details.paymentTerms}
                        </p>
                      </div>
                    )}
                    {details.cancellationTerms && (
                      <div className="mt-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                          Cancellation terms
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-neutral-700">
                          {details.cancellationTerms}
                        </p>
                      </div>
                    )}
                    {details.travellerNames?.length ? (
                      <div className="mt-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                          Traveller names
                        </p>
                        <ul className="mt-1 list-inside list-disc text-sm leading-6 text-neutral-700">
                          {details.travellerNames.map((name, index) => (
                            <li key={`${name}-${index}`}>{name}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {offer.customer_response_note && (
                      <div className="mt-4 rounded-xl border border-orange-100 bg-orange-50 p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-orange-800">
                          Your last response
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm">
                          {offer.customer_response_note}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl bg-[#fbfaf8] p-4 sm:p-5">
                    <h3 className="text-sm font-bold">Your next step</h3>
                    {canRespond && (
                      <>
                        <p className="mt-2 text-sm leading-6 text-neutral-600">
                          Accept this offer to create your booking and continue
                          to payment, or send your consultant any changes you
                          need.
                        </p>
                        {editingOffer === offer.id && (
                          <label className="mt-4 block">
                            <span className="mb-1.5 block text-xs font-bold text-neutral-600">
                              What should be changed?
                            </span>
                            <textarea
                              value={messageByOffer[offer.id] ?? ""}
                              onChange={(e) =>
                                setMessageByOffer((old) => ({
                                  ...old,
                                  [offer.id]: e.target.value,
                                }))
                              }
                              rows={4}
                              maxLength={2000}
                              className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-sm outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-100"
                              placeholder="e.g. Change the departure date, hotel category, traveller count, or payment schedule."
                            />
                          </label>
                        )}
                        <div className="mt-4 grid gap-2">
                          <button
                            disabled={respond.isPending}
                            onClick={() => runAction(offer.id, "accept")}
                            className="inline-flex items-center justify-center gap-2 rounded-full bg-orange-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-orange-800 disabled:opacity-50"
                          >
                            <CheckCircle2 size={16} /> Accept offer
                          </button>
                          {editingOffer === offer.id ? (
                            <>
                              <button
                                disabled={respond.isPending}
                                onClick={() =>
                                  runAction(offer.id, "request_changes")
                                }
                                className="inline-flex items-center justify-center gap-2 rounded-full border border-orange-700 px-4 py-2.5 text-sm font-bold text-orange-800 disabled:opacity-50"
                              >
                                <PencilLine size={16} /> Send change request
                              </button>
                              <button
                                onClick={() => setEditingOffer(null)}
                                className="rounded-full px-4 py-2 text-sm font-semibold text-neutral-600"
                              >
                                Keep current offer
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setEditingOffer(offer.id)}
                              className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-semibold hover:border-orange-700"
                            >
                              <PencilLine size={16} /> Request edits
                            </button>
                          )}
                          <button
                            disabled={respond.isPending}
                            onClick={() => runAction(offer.id, "reject")}
                            className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
                          >
                            <XCircle size={16} /> Reject offer
                          </button>
                        </div>
                      </>
                    )}
                    {accepted && (
                      <>
                        <p className="mt-2 text-sm leading-6 text-neutral-600">
                          You accepted this offer. Your booking has been
                          created; complete the payment step to proceed.
                        </p>
                        {offer["bookingId"] && (
                          <p className="mt-3 rounded-lg bg-white p-3 text-xs text-neutral-600">
                            Booking reference:{" "}
                            <strong>{`BK-${offer["bookingId"]}`}</strong>
                          </p>
                        )}
                       <button
  disabled={checkout.isPending}
  onClick={() => startCheckout(offer.id)}
  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-orange-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-orange-800 disabled:opacity-50"
>
  <CreditCard size={16} />{" "}
  {checkout.isPending
    ? "Opening secure checkout…"
    : "Continue to payment"}
</button>
                        <button
                          disabled={respond.isPending}
                          onClick={() => runAction(offer.id, "cancel")}
                          className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:border-red-400 hover:text-red-700"
                        >
                          <XCircle size={16} /> Cancel booking
                        </button>
                      </>
                    )}
                    {status === "changes_requested" && (
                      <p className="mt-3 flex gap-2 text-sm leading-6 text-amber-800">
                        <Clock3 size={17} className="mt-0.5 shrink-0" />
                        Your consultant is revising this offer. The updated
                        version will replace the current offer here.
                      </p>
                    )}
                    {cancelledOrRejected && (
                      <p className="mt-3 flex gap-2 text-sm leading-6 text-neutral-600">
                        <AlertCircle size={17} className="mt-0.5 shrink-0" />{" "}
                        This offer is no longer active. Contact your consultant
                        if you need a new offer.
                      </p>
                    )}
                    {accepted && (
                      <p className="mt-4 flex gap-2 text-xs leading-5 text-neutral-500">
                        <AlertCircle size={15} className="mt-0.5 shrink-0" />{" "}
                        Cancellation does not automatically issue a refund. Any
                        paid amount is reviewed by AeroFly staff.
                      </p>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </main>
      <Footer />
    </div>
  );
}
