import {
  useEffect,
  useState,
} from "react";

import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileText,
  LogOut,
  MessageCircle,
  Plane,
  Receipt,
  UserRound,
} from "lucide-react";

import { Link } from "wouter";
import { toast } from "sonner";

import { useAuth } from "@/_core/hooks/useAuth";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { trpc } from "@/lib/trpc";

import { useCurrency } from "@/contexts/CurrencyContext";
import CustomerCareBooking from "@/components/site/CustomerCareBooking";

export default function CustomerDashboard() {
  const {
    user,
    loading,
    isAuthenticated,
    logout,
  } = useAuth();

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = trpc.customer.dashboard.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: 1,
  });

  const [careOpen, setCareOpen] =
    useState(false);

  const {
    currency,
    format,
    checkoutNotice,
  } = useCurrency();

  const checkout =
    trpc.customer.createCheckout.useMutation({
      onSuccess: (result) => {
        if (result.url) {
          toast.success(
            "Opening secure Stripe checkout"
          );

          window.open(
            result.url,
            "_blank",
            "noopener,noreferrer"
          );

          return;
        }

        toast.error(
          "Unable to create the secure checkout session."
        );
      },

      onError: (checkoutError) => {
        toast.error(
          checkoutError.message ||
            "Unable to start checkout."
        );
      },
    });

  /*
   * Show payment return messages.
   *
   * Stripe redirects back to the dashboard with:
   * ?payment=success
   * ?payment=cancelled
   */
  useEffect(() => {
    const status = new URLSearchParams(
      window.location.search
    ).get("payment");

    if (status === "success") {
      toast.success(
        "Payment received. Your AeroFly travel desk will confirm the next step shortly."
      );

      return;
    }

    if (status === "cancelled") {
      toast.message(
        "Checkout was cancelled. Your quotation is still available here."
      );
    }
  }, []);

  /*
   * ----------------------------------------------------------
   * Loading
   * ----------------------------------------------------------
   */

  if (
    loading ||
    (isAuthenticated && isLoading)
  ) {
    return (
      <div className="min-h-screen">
        <Header />

        <main className="bg-[#f3ede5]">
          <div className="container py-32 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#f26b35] border-t-transparent" />

            <p className="mt-5 text-[14px] text-[#6f6c66]">
              Loading your travel desk…
            </p>
          </div>
        </main>

        <Footer />
      </div>
    );
  }

  /*
   * ----------------------------------------------------------
   * Unauthenticated state
   *
   * Supabase Auth is now the primary authentication system.
   * Do NOT call the old startLogin() function here.
   * ----------------------------------------------------------
   */

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen">
        <Header />

        <main className="bg-[#f3ede5]">
          <div className="container grid min-h-[650px] place-items-center py-20">
            <div className="card w-full max-w-[440px] p-9 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#fff0e8] text-[#f26b35]">
                <UserRound size={23} />
              </div>

              <div className="eyebrow mt-7">
                Customer travel desk
              </div>

              <h1 className="mt-3 font-['Manrope'] text-3xl font-extrabold tracking-[-.04em]">
                Your travel desk,
                <br />
                in one place.
              </h1>

              <p className="mt-4 text-[14px] leading-6 text-[#6f6c66]">
                Sign in to view enquiries,
                quotations, secure payments,
                upcoming trips and receipts.
              </p>

              <button
                type="button"
                onClick={() => {
                  window.location.assign(
                    "/login?next=%2Fdashboard"
                  );
                }}
                className="btn btn-primary mt-7 w-full"
              >
                Sign in to AeroFly
                <ArrowRight size={15} />
              </button>

              <Link
                href="/"
                className="mt-5 inline-block text-[11px] font-bold text-[#77736c] hover:text-[#c94d1c]"
              >
                Back to AeroFly
              </Link>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    );
  }

  /*
   * ----------------------------------------------------------
   * Error state
   * ----------------------------------------------------------
   */

  if (isError) {
    return (
      <div className="min-h-screen">
        <Header />

        <main className="bg-[#f3ede5]">
          <div className="container grid min-h-[650px] place-items-center py-20">
            <div className="card w-full max-w-[500px] p-9 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#fff0ec] text-[#b14a34]">
                <AlertCircle size={23} />
              </div>

              <div className="eyebrow mt-7">
                Travel desk unavailable
              </div>

              <h1 className="mt-3 font-['Manrope'] text-3xl font-extrabold">
                We could not load your dashboard.
              </h1>

              <p className="mt-4 text-[14px] leading-6 text-[#6f6c66]">
                Your account is still secure. Please
                try again. If the problem continues,
                contact the AeroFly travel desk.
              </p>

              {error?.message && (
                <p className="mt-4 rounded-lg bg-[#f7f4ef] p-3 text-left text-[11px] leading-5 text-[#77736c]">
                  {error.message}
                </p>
              )}

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    void refetch();
                  }}
                  className="btn btn-primary flex-1"
                >
                  Try again
                  <ArrowRight size={15} />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void logout();
                  }}
                  className="btn btn-ghost flex-1"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    );
  }

  /*
   * ----------------------------------------------------------
   * Dashboard data
   * ----------------------------------------------------------
   */

  const enquiries = data?.enquiries ?? [];
  const bookings = data?.bookings ?? [];
  const quotations = data?.quotations ?? [];
  const payments = data?.payments ?? [];
  const callbacks = data?.callbacks ?? [];
  const appointments = data?.appointments ?? [];

  const openEnquiries = enquiries.filter(
    (enquiry) =>
      enquiry.status !== "completed" &&
      enquiry.status !== "cancelled"
  );

  const firstName =
    user?.name?.trim().split(/\s+/)[0] ||
    "traveller";

  /*
   * ----------------------------------------------------------
   * Dashboard
   * ----------------------------------------------------------
   */

  return (
    <div className="min-h-screen">
      <Header />

      <main className="bg-[#f3ede5] py-12 sm:py-16">
        <div className="container">

          {/* ==================================================
              HEADER
              ================================================== */}

          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <div className="eyebrow">
                Customer travel desk
              </div>

              <h1 className="display mt-3 text-4xl font-extrabold sm:text-6xl">
                Good to see you,{" "}
                {firstName}.
              </h1>

              <p className="mt-4 text-[14px] text-[#6f6c66]">
                Here’s where your AeroFly journey picks
                up.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                void logout();
              }}
              className="flex items-center gap-2 text-[12px] font-bold text-[#6f6c66] transition-colors hover:text-[#c94d1c]"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>

          {/* ==================================================
              SUMMARY CARDS
              ================================================== */}

          <div className="mt-10 grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <DashboardCard
              icon={Plane}
              label="Upcoming trips"
              value={String(bookings.length)}
            />

            <DashboardCard
              icon={FileText}
              label="Open enquiries"
              value={String(
                openEnquiries.length
              )}
            />

            <DashboardCard
              icon={Receipt}
              label="Quotations"
              value={String(
                quotations.length
              )}
            />

            <DashboardCard
              icon={CreditCard}
              label="Payments"
              value={String(
                payments.length
              )}
            />
          </div>

          {/* ==================================================
              CUSTOMER CARE
              ================================================== */}

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <section className="card bg-[#fbfaf8] p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="eyebrow">
                    Customer care
                  </div>

                  <h2 className="mt-2 font-['Manrope'] text-xl font-extrabold">
                    Need a person?
                  </h2>

                  <p className="mt-2 text-[12px] leading-5 text-[#6f6c66]">
                    Request a callback or book a
                    focused planning appointment.
                  </p>
                </div>

                <MessageCircle
                  size={19}
                  className="text-[#f26b35]"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setCareOpen(true);
                }}
                className="btn btn-primary mt-5 min-h-9 px-3 text-[11px]"
              >
                Callback or appointment
                <ArrowRight size={13} />
              </button>
            </section>

            <section className="card bg-[#fbfaf8] p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="eyebrow">
                    Your requests
                  </div>

                  <h2 className="mt-2 font-['Manrope'] text-xl font-extrabold">
                    Care status
                  </h2>
                </div>

                <CalendarDays
                  size={19}
                  className="text-[#f26b35]"
                />
              </div>

              <div className="mt-4 space-y-3 text-[12px] text-[#6f6c66]">
                <div className="flex items-center justify-between gap-4">
                  <span>Callbacks</span>

                  <strong className="font-bold text-[#262624]">
                    {callbacks.length
                      ? callbacks[0].status
                      : "None yet"}
                  </strong>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span>
                    Appointments
                  </span>

                  <strong className="font-bold text-[#262624]">
                    {appointments.length
                      ? appointments[0].status
                      : "None yet"}
                  </strong>
                </div>
              </div>
            </section>
          </div>

          {/* ==================================================
              QUOTATIONS + CHECKOUT
              ================================================== */}

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
            <section className="card bg-[#fbfaf8] p-6 sm:p-8">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <div className="eyebrow">
                    Your quotations
                  </div>

                  <h2 className="mt-2 font-['Manrope'] text-2xl font-extrabold">
                    Choose your next step.
                  </h2>
                </div>

                <Link
                  href="/plan-my-trip"
                  className="btn btn-dark min-h-9 px-3 text-[11px]"
                >
                  New request
                </Link>
              </div>

              {quotations.length === 0 ? (
                <Empty
                  label="No quotations yet"
                  copy="When your AeroFly advisor prepares an offer, it will appear here for review and secure payment."
                />
              ) : (
                <div className="mt-7 space-y-3">
                  {quotations.map(
                    (quote) => (
                      <div
                        key={quote.id}
                        className="rounded-xl border border-[#e8e4dd] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-['Manrope'] text-[15px] font-extrabold">
                              {quote.destination}
                            </div>

                            <div className="mt-1 text-[12px] text-[#77736c]">
                              {quote.reference}
                              {" · "}
                              {quote.travelDates}
                              {" · "}
                              {quote.travellers}{" "}
                              traveller
                              {quote.travellers ===
                              1
                                ? ""
                                : "s"}
                            </div>
                          </div>

                          <QuoteStatus
                            status={
                              quote.status
                            }
                          />
                        </div>

                        <div className="mt-4 flex flex-col justify-between gap-4 border-t border-[#eee9e1] pt-4 sm:flex-row sm:items-center">
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[.13em] text-[#92928b]">
                              Total
                            </span>

                            <div className="mt-1 font-['Manrope'] text-lg font-extrabold">
                              {format(
                                Number(
                                  quote.total
                                )
                              )}
                            </div>

                            <div className="mt-1 text-[10px] font-normal text-[#92928b]">
                              {currency} display ·
                              checkout support
                              is checked at
                              payment
                            </div>
                          </div>

                          {quote.status ===
                            "accepted" && (
                            <button
                              type="button"
                              onClick={() => {
                                checkout.mutate(
                                  {
                                    quotationId:
                                      quote.id,
                                    requestedCurrency:
                                      currency,
                                  }
                                );
                              }}
                              disabled={
                                checkout.isPending
                              }
                              className="btn btn-primary"
                            >
                              <CreditCard
                                size={15}
                              />

                              {checkout.isPending
                                ? "Preparing checkout…"
                                : "Pay securely"}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </section>

            {/* ==================================================
                CHECKOUT INFORMATION
                ================================================== */}

            <aside className="card bg-[#20201e] p-7 text-white">
              <div className="eyebrow text-[#ffac88]">
                Secure customer checkout
              </div>

              <h2 className="mt-3 font-['Manrope'] text-2xl font-extrabold">
                Pay only when your quote is ready.
              </h2>

              <p className="mt-4 text-[13px] leading-6 text-white/65">
                Payments are handled by Stripe in
                a secure checkout window. AeroFly
                never sees or stores your full card
                details.
              </p>

              {checkoutNotice && (
                <div className="mt-4 rounded-lg bg-[#fff7df] p-3 text-[11px] leading-5 text-[#8b671c]">
                  {checkoutNotice}
                </div>
              )}

              <div className="mt-7 space-y-3 text-[12px] text-white/70">
                <CheckoutFeature>
                  Card and supported wallet checkout
                </CheckoutFeature>

                <CheckoutFeature>
                  Automatic booking confirmation
                  after payment
                </CheckoutFeature>

                <CheckoutFeature>
                  Receipt and payment status in this
                  desk
                </CheckoutFeature>
              </div>
            </aside>
          </div>

          {/* ==================================================
              PAYMENT HISTORY
              ================================================== */}

          <section className="card mt-6 bg-[#fbfaf8] p-6 sm:p-8">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <div className="eyebrow">
                  Payment history
                </div>

                <h2 className="mt-2 font-['Manrope'] text-2xl font-extrabold">
                  Your receipts and status.
                </h2>
              </div>

              <div className="flex items-center gap-3">
                <Link
                  href="/payment-status"
                  className="btn btn-ghost min-h-8 px-3 text-[11px]"
                >
                  Full status
                </Link>

                <CreditCard
                  size={19}
                  className="text-[#f26b35]"
                />
              </div>
            </div>

            {payments.length === 0 ? (
              <Empty
                label="No payments yet"
                copy="Completed online payments and receipts will appear here."
              />
            ) : (
              <div className="mt-7 overflow-hidden rounded-xl border border-[#e8e4dd]">
                {/* Desktop header */}
                <div className="hidden grid-cols-[1.1fr_1fr_.8fr_.8fr] gap-4 bg-[#f3ede5] px-4 py-3 text-[10px] font-bold uppercase tracking-[.12em] text-[#92928b] sm:grid">
                  <span>Reference</span>
                  <span>Journey</span>
                  <span>Date</span>
                  <span className="text-right">
                    Status
                  </span>
                </div>

                <div className="divide-y divide-[#eee9e1]">
                  {payments.map((payment) => (
  <PaymentRow
    key={payment?.payment?.id}
    payment={payment}
    format={format}
  />
))}
                </div>
              </div>
            )}
          </section>

          {/* ==================================================
              EMPTY / INFORMATIONAL FOOTER
              ================================================== */}

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <InfoCard
              icon={Plane}
              title="Your journey"
              copy="Keep your trip details, requests and booking activity together."
              href="/tours"
              label="Explore tours"
            />

            <InfoCard
              icon={Clock3}
              title="Need help?"
              copy="Our travel desk can help with planning, callbacks and appointments."
              onClick={() => {
                setCareOpen(true);
              }}
              label="Contact customer care"
            />

            <InfoCard
              icon={Receipt}
              title="Payment status"
              copy="Review payment progress and receipts from your customer workspace."
              href="/payment-status"
              label="View payments"
            />
          </div>
        </div>
      </main>

      <Footer />

      {/* ======================================================
          CUSTOMER CARE MODAL
          ====================================================== */}

      {careOpen && (
        <CustomerCareBooking
          open={careOpen}
          onClose={() => setCareOpen(false)}
        />
      )}
    </div>
  );
}

/* ============================================================
   Dashboard summary card
   ============================================================ */

type DashboardCardProps = {
  icon: React.ComponentType<{
    size?: number;
    className?: string;
  }>;
  label: string;
  value: string;
};

function DashboardCard({
  icon: Icon,
  label,
  value,
}: DashboardCardProps) {
  return (
    <div className="card bg-[#fbfaf8] p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[.13em] text-[#92928b]">
            {label}
          </div>

          <div className="mt-2 font-['Manrope'] text-3xl font-extrabold tracking-[-.04em]">
            {value}
          </div>
        </div>

        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fff0e8] text-[#f26b35]">
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Quote status
   ============================================================ */

type QuoteStatusProps = {
  status: string;
};

function QuoteStatus({
  status,
}: QuoteStatusProps) {
  const normalized =
    status.toLowerCase();

  const className =
    normalized === "accepted"
      ? "bg-[#e9f5ed] text-[#3f7b4b]"
      : normalized === "rejected"
        ? "bg-[#fff0ec] text-[#b14a34]"
        : "bg-[#fff0e8] text-[#c94d1c]";

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.11em] ${className}`}
    >
      {status}
    </span>
  );
}

/* ============================================================
   Payment row
   ============================================================ */

type PaymentRowProps = {
  payment: {
    payment: {
      id: number;
      reference: string;
      bookingId: number | null;
      quotationId: number | null;
      receivedBy: number;
      amount: string;
      settlementCurrency: string;
      method: "upi" | "bank_transfer" | "card" | "cash" | "other";
      createdAt: Date;
      [key: string]: unknown;
    };
    quotation: {
      id: number;
      reference?: string | null;
      destination?: string | null;
      [key: string]: unknown;
    } | null;
    booking: {
      id: number;
      reference?: string | null;
      [key: string]: unknown;
    } | null;
  };
  format: (amount: number) => string;
};

function PaymentRow({ payment, format }: PaymentRowProps) {
  const record = payment.payment;

  const quotation = payment.quotation;
  const booking = payment.booking;

  const journey =
    quotation?.destination ??
    booking?.reference ??
    quotation?.reference ??
    "AeroFly booking";

  const date = new Date(record.createdAt);

  return (
    <div className="grid gap-3 border-t border-[#eee9e1] px-4 py-4 sm:grid-cols-[1.1fr_1fr_.8fr_.8fr] sm:items-center">
      <div>
        <div className="font-semibold text-[#20201e]">
          {record.reference}
        </div>

        <div className="mt-1 text-[10px] text-[#92928b]">
          {record.method.replace("_", " ")}
        </div>
      </div>

      <div className="text-[12px] text-[#6f6c66]">
        {journey}
      </div>

      <div className="text-[12px] text-[#6f6c66]">
        {date.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}
      </div>

      <div className="sm:text-right">
        <div className="font-['Manrope'] font-extrabold text-[#20201e]">
          {format(Number(record.amount))}
        </div>

        <div className="mt-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#3f7b4b]">
          Received
        </div>
      </div>
    </div>
  );
}

// function PaymentRow({
//   payment,
//   format,
// }: PaymentRowProps) {
//   const rawDate =
//     payment.createdAt ??
//     payment.date;

//   const formattedDate = rawDate
//     ? formatDate(rawDate)
//     : "—";

//   const paymentStatus =
//     payment.status || "unknown";

//   const statusClass =
//     paymentStatus.toLowerCase() ===
//     "paid"
//       ? "bg-[#e9f5ed] text-[#3f7b4b]"
//       : paymentStatus.toLowerCase() ===
//           "succeeded"
//         ? "bg-[#e9f5ed] text-[#3f7b4b]"
//         : paymentStatus.toLowerCase() ===
//             "failed"
//           ? "bg-[#fff0ec] text-[#b14a34]"
//           : paymentStatus.toLowerCase() ===
//               "cancelled"
//             ? "bg-[#f0efec] text-[#77736c]"
//             : "bg-[#fff0e8] text-[#c94d1c]";

//   return (
//     <div className="grid gap-3 px-4 py-4 sm:grid-cols-[1.1fr_1fr_.8fr_.8fr] sm:items-center sm:gap-4">
//       {/* Reference */}
//       <div>
//         <div className="text-[10px] font-bold uppercase tracking-[.1em] text-[#92928b] sm:hidden">
//           Reference
//         </div>

//         <div className="mt-1 font-['Manrope'] text-[13px] font-extrabold sm:mt-0">
//           {payment.reference ||
//             payment.id}
//         </div>

//         {payment.amount !==
//           undefined &&
//           payment.amount !== null && (
//             <div className="mt-1 text-[11px] text-[#77736c]">
//               {format(
//                 Number(payment.amount)
//               )}
//               {payment.currency
//                 ? ` ${payment.currency}`
//                 : ""}
//             </div>
//           )}
//       </div>

//       {/* Journey */}
//       <div>
//         <div className="text-[10px] font-bold uppercase tracking-[.1em] text-[#92928b] sm:hidden">
//           Journey
//         </div>

//         <div className="mt-1 text-[12px] text-[#6f6c66] sm:mt-0">
//           {payment.destination ||
//             payment.quotationId ||
//             "AeroFly booking"}
//         </div>
//       </div>

//       {/* Date */}
//       <div>
//         <div className="text-[10px] font-bold uppercase tracking-[.1em] text-[#92928b] sm:hidden">
//           Date
//         </div>

//         <div className="mt-1 text-[12px] text-[#6f6c66] sm:mt-0">
//           {formattedDate}
//         </div>
//       </div>

//       {/* Status */}
//       <div className="sm:text-right">
//         <div className="text-[10px] font-bold uppercase tracking-[.1em] text-[#92928b] sm:hidden">
//           Status
//         </div>

//         <span
//           className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em] sm:mt-0 ${statusClass}`}
//         >
//           {paymentStatus}
//         </span>
//       </div>
//     </div>
//   );
// }

/* ============================================================
   Checkout feature
   ============================================================ */

function CheckoutFeature({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <CheckCircle2
        size={15}
        className="shrink-0 text-[#a9d2ad]"
      />

      <span>{children}</span>
    </div>
  );
}

/* ============================================================
   Empty state
   ============================================================ */

function Empty({
  label,
  copy,
}: {
  label: string;
  copy: string;
}) {
  return (
    <div className="mt-7 rounded-xl border border-dashed border-[#ded8cf] bg-[#f8f5f0] p-7 text-center">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-white text-[#f26b35]">
        <FileText size={17} />
      </div>

      <h3 className="mt-4 font-['Manrope'] text-[14px] font-extrabold">
        {label}
      </h3>

      <p className="mx-auto mt-2 max-w-[440px] text-[12px] leading-5 text-[#77736c]">
        {copy}
      </p>
    </div>
  );
}

/* ============================================================
   Informational card
   ============================================================ */

type InfoCardProps = {
  icon: React.ComponentType<{
    size?: number;
    className?: string;
  }>;
  title: string;
  copy: string;
  href?: string;
  label: string;
  onClick?: () => void;
};

function InfoCard({
  icon: Icon,
  title,
  copy,
  href,
  label,
  onClick,
}: InfoCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-[#fff0e8] text-[#f26b35]">
          <Icon size={18} />
        </div>

        <ArrowRight
          size={15}
          className="text-[#aaa49b]"
        />
      </div>

      <h3 className="mt-5 font-['Manrope'] text-[15px] font-extrabold">
        {title}
      </h3>

      <p className="mt-2 text-[12px] leading-5 text-[#77736c]">
        {copy}
      </p>

      <div className="mt-4 text-[11px] font-bold text-[#c94d1c]">
        {label}
      </div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="card bg-[#fbfaf8] p-5 transition-transform hover:-translate-y-0.5"
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="card bg-[#fbfaf8] p-5 text-left transition-transform hover:-translate-y-0.5"
    >
      {content}
    </button>
  );
}

/* ============================================================
   Date formatting
   ============================================================ */

function formatDate(
  value: string | Date
): string {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(date.getTime())
  ) {
    return String(value);
  }

  return new Intl.DateTimeFormat(
    "en-IN",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  ).format(date);
}