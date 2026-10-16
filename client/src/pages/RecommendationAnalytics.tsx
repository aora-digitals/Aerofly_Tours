import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  BarChart3,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { supabase } from "@/lib/supabase";

type Analytics = {
  period?: { from: string; to: string };
  activity?: Record<string, number>;
  recommendations?: {
    impressions: number;
    clicks: number;
    dismissals: number;
    click_through_rate: number;
  };
  popular_tours?: Array<{
    tour_id: number;
    title: string;
    interactions: number;
  }>;
  popular_destinations?: Array<{
    destination: string;
    interactions: number;
  }>;
  popular_categories?: Array<{
    category: string;
    interactions: number;
  }>;
  customer_interests?: Array<{
    interest: string;
    customers: number;
  }>;
  enquiry_funnel?: {
    enquiries: number;
    proposals: number;
    accepted_proposals: number;
  };
};

export default function RecommendationAnalytics() {
  const { user, loading: authLoading } = useAuth();

  const [from, setFrom] = useState(() =>
    new Date(Date.now() - 29 * 86400000)
      .toISOString()
      .slice(0, 10),
  );

  const [to, setTo] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  const [organizationId, setOrganizationId] =
    useState("");

  const [data, setData] = useState<Analytics | null>(
    null,
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canReadReports = Boolean(
    user?.permissions?.includes("reports.read"),
  );

  const orgs = user?.organizationIds ?? [];

  useEffect(() => {
    if (!organizationId && orgs.length > 0) {
      setOrganizationId(orgs[0]);
    }
  }, [organizationId, orgs]);

  async function load() {
    if (!canReadReports) {
      setError(
        "Your account does not have the reports.read permission.",
      );
      return;
    }

    if (!from || !to || from > to) {
      setError("Choose a valid date range.");
      return;
    }

    const duration =
      new Date(`${to}T23:59:59Z`).getTime() -
      new Date(`${from}T00:00:00Z`).getTime();

    if (duration > 366 * 86400000) {
      setError(
        "The maximum reporting period is 366 days.",
      );
      return;
    }

    setLoading(true);
    setError("");

    const { data: result, error: rpcError } =
      await supabase.rpc(
        "phase13_recommendation_analytics",
        {
          p_from: new Date(
            `${from}T00:00:00.000Z`,
          ).toISOString(),
          p_to: new Date(
            `${to}T23:59:59.999Z`,
          ).toISOString(),
          p_organization_id: organizationId || null,
        },
      );

    setLoading(false);

    if (rpcError) {
      setError(
        "Analytics could not be loaded. Verify your report permission, organization scope, and that the Phase 13 migration is applied.",
      );
      setData(null);
      return;
    }

    setData(result as Analytics);
  }

  useEffect(() => {
    if (
      !authLoading &&
      canReadReports &&
      (orgs.length === 0 || organizationId)
    ) {
      void load();
    }

  }, [
    authLoading,
    canReadReports,
    organizationId,
    orgs.length,
  ]);

  if (authLoading) {
    return (
      <main className="container py-20">
        Loading workspace…
      </main>
    );
  }

  if (!user || !canReadReports) {
    return (
      <main className="container max-w-2xl py-20">
        <h1 className="display text-3xl font-extrabold">
          Analytics access restricted
        </h1>

        <p className="mt-3 text-sm text-[#77736c]">
          An authorized staff account with reports.read
          permission is required.
        </p>

        <Link
          href="/admin"
          className="btn btn-primary mt-5"
        >
          Return to workspace
        </Link>
      </main>
    );
  }

  const activity = data?.activity ?? {};

  const funnel = data?.enquiry_funnel ?? {
    enquiries: 0,
    proposals: 0,
    accepted_proposals: 0,
  };

  const metrics = [
    ["Tour views", activity.tour_viewed ?? 0],
    ["Catalogue searches", activity.tour_search ?? 0],
    ["Wishlist additions", activity.wishlist_added ?? 0],
    [
      "Enquiries submitted",
      activity.enquiry_submitted ?? 0,
    ],
    [
      "Recommendation impressions",
      data?.recommendations?.impressions ?? 0,
    ],
    [
      "Recommendation clicks",
      data?.recommendations?.clicks ?? 0,
    ],
    [
      "Recommendation CTR",
      `${data?.recommendations?.click_through_rate ?? 0}%`,
    ],
    ["Proposal acceptances", funnel.accepted_proposals],
  ] as const;

  return (
    <div className="min-h-screen bg-[#f4f4f1] text-[#222321]">
      <main className="container max-w-6xl py-8 sm:py-12">
        <Link
          href="/admin"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#77736c]"
        >
          <ArrowLeft size={15} />
          Admin workspace
        </Link>

        <header className="mt-5 flex flex-col justify-between gap-4 rounded-2xl border border-[#e8e4dd] bg-white p-6 sm:flex-row sm:items-end">
          <div>
            <div className="eyebrow flex items-center gap-2">
              <BarChart3 size={14} />
              Phase 13 analytics
            </div>

            <h1 className="display mt-2 text-4xl font-extrabold">
              Engagement & recommendations
            </h1>

            <p className="mt-2 max-w-xl text-sm text-[#77736c]">
              Aggregate metrics only. Customer-level
              activity and personal identifiers are not
              exposed.
            </p>
          </div>

          <button
            onClick={() => void load()}
            disabled={loading}
            className="btn btn-dark"
          >
            <RefreshCw
              size={15}
              className={loading ? "animate-spin" : ""}
            />
            Refresh
          </button>
        </header>

        <section className="mt-5 rounded-2xl border border-[#e8e4dd] bg-white p-5">
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_1.5fr_auto] md:items-end">
            <label className="text-xs font-bold">
              From
              <input
                className="field mt-2"
                type="date"
                value={from}
                max={to}
                onChange={(event) =>
                  setFrom(event.target.value)
                }
              />
            </label>

            <label className="text-xs font-bold">
              To
              <input
                className="field mt-2"
                type="date"
                value={to}
                min={from}
                max={new Date()
                  .toISOString()
                  .slice(0, 10)}
                onChange={(event) =>
                  setTo(event.target.value)
                }
              />
            </label>

            <label className="text-xs font-bold">
              Organization scope
              <select
                className="field mt-2"
                value={organizationId}
                onChange={(event) =>
                  setOrganizationId(event.target.value)
                }
              >
                {orgs.length === 0 ? (
                  <option value="">
                    My permitted reporting scope
                  </option>
                ) : (
                  <option value="" disabled>
                    Choose an organization
                  </option>
                )}

                {orgs.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>

            <button
              className="btn btn-primary"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? (
                <LoaderCircle
                  size={15}
                  className="animate-spin"
                />
              ) : (
                "Apply filters"
              )}
            </button>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
        </section>

        {loading && !data ? (
          <div className="mt-6 rounded-xl bg-white p-8 text-sm text-[#77736c]">
            Loading analytics…
          </div>
        ) : data ? (
          <>
            <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {metrics.map(([label, value]) => (
                <article
                  key={label}
                  className="rounded-xl border border-[#e8e4dd] bg-white p-5"
                >
                  <div className="text-xs font-semibold text-[#77736c]">
                    {label}
                  </div>

                  <div className="mt-2 font-['Manrope'] text-3xl font-extrabold">
                    {typeof value === "number"
                      ? value.toLocaleString("en-IN")
                      : value}
                  </div>
                </article>
              ))}
            </section>

            <section className="mt-5 grid gap-5 lg:grid-cols-2">
              <article className="rounded-2xl border border-[#e8e4dd] bg-white p-6">
                <h2 className="font-['Manrope'] text-xl font-extrabold">
                  Enquiry funnel
                </h2>

                <div className="mt-5 space-y-4">
                  {(
                    [
                      ["Enquiries", funnel.enquiries],
                      ["Proposals", funnel.proposals],
                      [
                        "Accepted proposals",
                        funnel.accepted_proposals,
                      ],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <div className="flex justify-between text-sm">
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>

                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eee9e1]">
                        <div
                          className="h-full rounded-full bg-[#f26b35]"
                          style={{
                            width: `${
                              Math.min(
                                100,
                                funnel.enquiries
                                  ? (value /
                                      funnel.enquiries) *
                                      100
                                  : 0,
                              )
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <p className="mt-4 text-xs text-[#908b83]">
                  Proposal counts use existing quotations.
                  Acceptance counts use the existing accepted
                  timestamp.
                </p>
              </article>

              <article className="rounded-2xl border border-[#e8e4dd] bg-white p-6">
                <h2 className="font-['Manrope'] text-xl font-extrabold">
                  Most interacted-with tours
                </h2>

                {(data.popular_tours ?? []).length ? (
                  <div className="mt-4 divide-y divide-[#eee9e1]">
                    {data.popular_tours?.map((tour) => (
                      <div
                        key={tour.tour_id}
                        className="flex items-center justify-between gap-3 py-3"
                      >
                        <span className="text-sm font-semibold">
                          {tour.title}
                        </span>

                        <span className="rounded-full bg-[#fff0e8] px-3 py-1 text-xs font-bold text-[#c94d1c]">
                          {tour.interactions}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-[#77736c]">
                    No recommendation interactions recorded
                    for this period.
                  </p>
                )}
              </article>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}