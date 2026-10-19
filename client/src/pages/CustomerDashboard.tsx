import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  Eye,
  FileText,
  Heart,
  ListChecks,
  Loader2,
  Plane,
  RefreshCw,
  FileCheck2,
  MessageCircle,
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import CustomerLayout from "@/components/customer/CustomerLayout";
import TourCard from "@/components/site/TourCard";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import {
  getCustomerActivity,
  getCustomerOperationalData,
  getRecentlyViewedTours,
  getWishlist,
  type CustomerActivity,
} from "@/lib/customer";
import { trpc } from "@/lib/trpc";
import PersonalizedTourRecommendations from "@/components/site/PersonalizedTourRecommendations";

export default function CustomerDashboard() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>({
    enquiries: [],
    callbacks: [],
    appointments: [],
    bookings: [],
    wishlist: [],
    recentlyViewed: [],
    activity: [],
    unreadNotifications: 0,
  });

  const { data: catalogue } = trpc.content.home.useQuery(undefined, {
    staleTime: 60_000,
  });

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [
        operational,
        wishlist,
        recentlyViewed,
        activity,
        notificationCount,
      ] = await Promise.all([
        getCustomerOperationalData(user.id),
        getWishlist(user.id),
        getRecentlyViewedTours(user.id),
        getCustomerActivity(user.id, 8),
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("recipient_user_id", user.id)
          .eq("is_read", false),
      ]);
      setData({
        ...operational,
        wishlist,
        recentlyViewed,
        activity,
        unreadNotifications: notificationCount.error
          ? 0
          : (notificationCount.count ?? 0),
      });
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Unable to load your customer dashboard.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (authLoading) return <CustomerLoading />;
  if (!isAuthenticated || !user) {
    window.location.assign("/login?next=%2Fdashboard");
    return null;
  }

  const firstName = user.name?.trim().split(/\s+/)[0] || "traveller";
  const openEnquiries = data.enquiries.filter(
    (item: any) => !["completed", "cancelled"].includes(item.status),
  );
  const upcomingAppointments = data.appointments
    .filter(
      (item: any) =>
        ["requested", "confirmed"].includes(item.status) &&
        new Date(item.appointmentAt).getTime() >= Date.now(),
    )
    .slice(0, 3);
  const upcomingBookings = data.bookings
    .filter(
      (item: any) => !["cancelled", "completed"].includes(item.bookingStatus),
    )
    .slice(0, 3);

  const offersQuery = trpc.customer.offers.useQuery(undefined, {
    enabled: Boolean(user && isAuthenticated),
    refetchOnWindowFocus: true,
  });

  const pendingOffers = (offersQuery.data ?? []).filter(
    (offer) =>
      ["awaiting_response", "changes_requested"].includes(
        String(offer.customer_response ?? "awaiting_response"),
      ) && ["sent", "viewed"].includes(String(offer.status)),
  );

  return (
    <CustomerLayout>
      <div className="space-y-6">
        <header className="flex flex-col justify-between gap-4 rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6 sm:flex-row sm:items-end sm:p-8">
          <div>
            <div className="eyebrow">Customer travel desk</div>
            <h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">
              Good to see you, {firstName}.
            </h1>
            <p className="mt-3 max-w-2xl text-[14px] leading-6 text-[#6f6c66]">
              Manage your AeroFly profile, preferences, saved journeys and
              conversations with our travel desk.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
            className="gap-2 rounded-full"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />{" "}
            Refresh
          </Button>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
            <div className="font-bold">We could not load your dashboard.</div>
            <p className="mt-1">{error}</p>
            <Button onClick={() => void load()} className="mt-4">
              Try again
            </Button>
          </div>
        )}

        {loading ? (
          <DashboardSkeleton />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                icon={Plane}
                label="Upcoming bookings"
                value={upcomingBookings.length}
                href="/dashboard/bookings"
              />
              <Metric
                icon={FileText}
                label="Open enquiries"
                value={openEnquiries.length}
                href="/dashboard/enquiries"
              />
              <Metric
                icon={Heart}
                label="Wishlist"
                value={data.wishlist.length}
                href="/dashboard/wishlist"
              />
              <Metric
                icon={Eye}
                label="Recently viewed"
                value={data.recentlyViewed.length}
                href="/dashboard/recently-viewed"
              />
            </div>

            <section className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold">Booking offers</h2>
                  <p className="mt-1 text-sm text-[#6f6c66]">
                    Review proposals from your AeroFly travel consultant.
                  </p>
                </div>

                <Link
                  href="/dashboard/offers"
                  className="text-sm font-bold text-orange-700 hover:text-orange-800"
                >
                  View all offers
                </Link>
              </div>

              {offersQuery.isLoading ? (
                <p className="mt-4 text-sm text-neutral-600">
                  Loading your offers…
                </p>
              ) : offersQuery.isError ? (
                <button
                  type="button"
                  onClick={() => void offersQuery.refetch()}
                  className="mt-4 text-sm font-semibold text-red-700 underline"
                >
                  Unable to load offers. Retry.
                </button>
              ) : pendingOffers.length === 0 ? (
                <p className="mt-4 text-sm text-neutral-600">
                  You have no offers awaiting a response.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {pendingOffers.slice(0, 3).map((offer) => {
                    const details = offer.booking_details as {
                      tourTitle?: string;
                      departureDate?: string;
                      returnDate?: string;
                    } | null;

                    return (
                      <div
                        key={offer.id}
                        className="rounded-xl border border-neutral-200 bg-white p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-bold">
                              {details?.tourTitle ||
                                offer.destination ||
                                "Travel offer"}
                            </p>
                            <p className="mt-1 text-xs text-neutral-500">
                              Reference: {offer.reference}
                            </p>
                            {details?.departureDate && (
                              <p className="mt-1 text-sm text-neutral-600">
                                Departure: {details.departureDate}
                                {details.returnDate
                                  ? ` – ${details.returnDate}`
                                  : ""}
                              </p>
                            )}
                          </div>

                          <p className="font-extrabold">
                            ₹{Number(offer.total).toLocaleString("en-IN")}
                          </p>
                        </div>

                        <p className="mt-2 text-sm font-semibold text-amber-700">
                          {offer.customer_response === "changes_requested"
                            ? "Changes requested"
                            : "Awaiting your response"}
                        </p>

                        <Link
                          href="/dashboard/offers"
                          className="mt-3 inline-flex rounded-full bg-orange-700 px-4 py-2 text-sm font-bold text-white hover:bg-orange-800"
                        >
                          Review offer
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <Link
                href="/dashboard/travel-assistance"
                className="group rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-5 transition hover:border-[#f26b35]"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff0e8] text-[#c94d1c]">
                    <FileCheck2 size={19} />
                  </span>
                  <div>
                    <h2 className="font-extrabold">
                      Visa & passport assistance
                    </h2>
                    <p className="mt-1 text-sm text-[#6f6c66]">
                      Submit applications, upload documents and track updates.
                    </p>
                  </div>
                  <ArrowRight
                    size={16}
                    className="ml-auto shrink-0 transition group-hover:translate-x-1"
                  />
                </div>
              </Link>
              <Link
                href="/dashboard/support"
                className="group rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-5 transition hover:border-[#f26b35]"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff0e8] text-[#c94d1c]">
                    <MessageCircle size={19} />
                  </span>
                  <div>
                    <h2 className="font-extrabold">Customer support</h2>
                    <p className="mt-1 text-sm text-[#6f6c66]">
                      Create a ticket and follow replies from the AeroFly team.
                    </p>
                  </div>
                  <ArrowRight
                    size={16}
                    className="ml-auto shrink-0 transition group-hover:translate-x-1"
                  />
                </div>
              </Link>
            </section>

            <section className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-5">
              <div className="eyebrow">Quick actions</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/tours" className="btn btn-ghost">
                  Explore tours <ArrowRight size={14} />
                </Link>
                <Link href="/dashboard/profile" className="btn btn-ghost">
                  Update profile
                </Link>
                <Link href="/dashboard/wishlist" className="btn btn-ghost">
                  View wishlist
                </Link>
                <Link href="/contact" className="btn btn-ghost">
                  Contact AeroFly
                </Link>
              </div>
            </section>

            <div className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
              <section className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6 sm:p-7">
                <SectionHeading
                  eyebrow="Upcoming travel"
                  title="Your next journeys"
                  href="/dashboard/bookings"
                />
                {upcomingBookings.length === 0 ? (
                  <Empty
                    title="No upcoming bookings"
                    copy="Your confirmed journeys will appear here. Booking checkout remains part of the next platform phase."
                    href="/tours"
                    action="Explore tours"
                  />
                ) : (
                  <div className="mt-5 space-y-3">
                    {upcomingBookings.map((booking: any) => (
                      <div
                        key={booking.id}
                        className="rounded-xl border border-[#eee9e1] p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="font-extrabold">
                              {booking.destination || "AeroFly journey"}
                            </div>
                            <div className="mt-1 text-xs text-[#77736c]">
                              {booking.reference} ·{" "}
                              {booking.travelDates || "Dates to be confirmed"}
                            </div>
                          </div>
                          <Status value={booking.bookingStatus} />
                          <Link href="/dashboard/offers" className="text-[11px] font-bold text-[#c94d1c]">
          Check <ArrowRight size={12} className="inline" />
        </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-[#e8e4dd] bg-[#20201e] p-6 text-white sm:p-7">
                <div className="eyebrow text-[#ffac88]">
                  Personalization foundation
                </div>
                <h2 className="mt-2 text-2xl font-extrabold">
                  Tell us how you like to travel.
                </h2>
                <p className="mt-3 text-[13px] leading-6 text-white/65">
                  Your preferences, saved tours and recent activity will later
                  power AeroFly recommendations.
                </p>
                <Link
                  href="/dashboard/preferences"
                  className="btn btn-primary mt-6"
                >
                  Set preferences <ArrowRight size={14} />
                </Link>
              </section>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6">
                <SectionHeading
                  eyebrow="Enquiries"
                  title="Recent conversations"
                  href="/dashboard/enquiries"
                />
                {data.enquiries.length === 0 ? (
                  <Empty
                    title="No enquiries yet"
                    copy="Ask AeroFly to shape a route around your dates and travel style."
                    href="/tours"
                    action="Explore tours"
                  />
                ) : (
                  <div className="mt-5 space-y-3">
                    {data.enquiries.slice(0, 4).map((item: any) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-[#eee9e1] p-4"
                      >
                        <div className="flex justify-between gap-3">
                          <div>
                            <div className="font-bold">
                              {item.destination || "Custom trip"}
                            </div>
                            <div className="mt-1 text-xs text-[#77736c]">
                              {item.reference} ·{" "}
                              {new Date(item.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                          <Status value={item.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6">
                <SectionHeading
                  eyebrow="Appointments & callbacks"
                  title="Your support requests"
                />
                {upcomingAppointments.length === 0 &&
                data.callbacks.length === 0 ? (
                  <Empty
                    title="Nothing scheduled"
                    copy="Request a callback or appointment when you need help from the travel desk."
                    href="/contact"
                    action="Contact AeroFly"
                  />
                ) : (
                  <div className="mt-5 space-y-3">
                    {upcomingAppointments.map((item: any) => (
                      <div
                        key={`a-${item.id}`}
                        className="rounded-xl border border-[#eee9e1] p-4"
                      >
                        <div className="flex items-center gap-3">
                          <CalendarDays size={16} className="text-[#f26b35]" />
                          <div>
                            <div className="font-bold">
                              Appointment · {item.mode}
                            </div>
                            <div className="mt-1 text-xs text-[#77736c]">
                              {new Date(item.appointmentAt).toLocaleString()} ·{" "}
                              {item.status}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {data.callbacks.slice(0, 2).map((item: any) => (
                      <div
                        key={`c-${item.id}`}
                        className="rounded-xl border border-[#eee9e1] p-4"
                      >
                        <div className="flex items-center gap-3">
                          <Clock3 size={16} className="text-[#f26b35]" />
                          <div>
                            <div className="font-bold">Callback request</div>
                            <div className="mt-1 text-xs text-[#77736c]">
                              {item.reference} · {item.status}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <section className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6">
              <PersonalizedTourRecommendations
                tours={[
                  ...(catalogue?.featuredTours ?? []),
                  ...(catalogue?.trendingTours ?? []),
                  ...(catalogue?.domesticTours ?? []),
                  ...(catalogue?.internationalTours ?? []),
                ]}
                title="Recommended for you"
                source="dashboard"
                limit={3}
              />
            </section>

            <section className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6">
              <SectionHeading
                eyebrow="Notifications"
                title="Travel desk updates"
                href="/dashboard/notifications"
              />
              <div className="mt-5 rounded-xl bg-[#f8f4ee] p-4 text-[12px] leading-5 text-[#6f6c66]">
                <span className="font-bold text-[#20201e]">
                  {data.unreadNotifications} unread notification
                  {data.unreadNotifications === 1 ? "" : "s"}.
                </span>{" "}
                Booking proposals, payment updates, travel-document requests and
                support replies appear here.{" "}
                <Link
                  href="/dashboard/notifications"
                  className="ml-1 font-bold text-[#c94d1c] underline"
                >
                  Open notification centre
                </Link>
              </div>
            </section>

            <section className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6">
              <SectionHeading
                eyebrow="Saved journeys"
                title="Your wishlist"
                href="/dashboard/wishlist"
              />
              {data.wishlist.length === 0 ? (
                <Empty
                  title="Your wishlist is empty"
                  copy="Save tours you want to compare later."
                  href="/tours"
                  action="Browse tours"
                />
              ) : (
                <div className="mt-5 grid gap-5 md:grid-cols-2">
                  {data.wishlist
                    .slice(0, 2)
                    .map(
                      (item: any) =>
                        item.tours && (
                          <TourCard key={item.id} tour={mapTour(item.tours)} />
                        ),
                    )}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6">
              <SectionHeading
                eyebrow="Recent activity"
                title="Your AeroFly trail"
                href="/dashboard/activity"
              />
              {data.activity.length === 0 ? (
                <Empty
                  title="No recent activity"
                  copy="Tour views, wishlist actions and customer interactions will appear here."
                />
              ) : (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {data.activity.slice(0, 6).map((item: CustomerActivity) => (
                    <ActivityRow key={item.id} activity={item} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </CustomerLayout>
  );
}

function Metric({ icon: Icon, label, value, href }: any) {
  return (
    <Link href={href}>
      <div className="cursor-pointer rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-5 transition hover:-translate-y-0.5 hover:shadow-sm">
        <div className="flex items-center justify-between">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff0e8] text-[#f26b35]">
            <Icon size={18} />
          </div>
          <ArrowRight size={15} className="text-[#aaa49c]" />
        </div>
        <div className="mt-5 text-2xl font-extrabold">{value}</div>
        <div className="mt-1 text-[11px] font-bold uppercase tracking-[.12em] text-[#92928b]">
          {label}
        </div>
      </div>
    </Link>
  );
}

function SectionHeading({ eyebrow, title, href }: any) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="mt-1 text-2xl font-extrabold">{title}</h2>
      </div>
      {href && (
        <Link href={href} className="text-[11px] font-bold text-[#c94d1c]">
          View all <ArrowRight size={12} className="inline" />
        </Link>
      )}
    </div>
  );
}

function Empty({ title, copy, href, action }: any) {
  return (
    <div className="mt-5 rounded-xl border border-dashed border-[#ddd5ca] bg-[#fbf8f3] p-6">
      <div className="font-bold">{title}</div>
      <p className="mt-1 text-[12px] leading-5 text-[#77736c]">{copy}</p>
      {href && (
        <Link href={href} className="btn btn-ghost mt-4 inline-flex">
          {action}
        </Link>
      )}
    </div>
  );
}

function Status({ value }: { value: string | null }) {
  return (
    <span className="rounded-full bg-[#f3ede5] px-2.5 py-1 text-[10px] font-bold capitalize text-[#6f6c66]">
      {String(value || "pending").replaceAll("_", " ")}
    </span>
  );
}

function ActivityRow({ activity }: { activity: CustomerActivity }) {
  return (
    <div className="flex gap-3 rounded-xl border border-[#eee9e1] p-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#fff0e8] text-[#f26b35]">
        <ListChecks size={15} />
      </div>
      <div className="min-w-0">
        <div className="text-[12px] font-bold capitalize">
          {activity.activity_type.replaceAll("_", " ")}
        </div>
        <div className="mt-1 text-[11px] text-[#77736c]">
          {new Date(activity.created_at).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

function mapTour(tour: any) {
  return {
    slug: tour.slug,
    title: tour.title,
    destination: tour.destinations?.name ?? "",
    country: tour.destinations?.country ?? "",
    durationDays: tour.durationDays,
    durationNights: tour.durationNights,
    priceFrom: tour.priceFrom,
    originalPrice: tour.originalPrice,
    rating: tour.rating ?? 0,
    reviewCount: tour.reviewCount ?? 0,
    imageUrl: tour.imageUrl ?? "",
    tags: tour.tags,
    category: tour.tour_categories?.name,
    availability: tour.availability,
  };
}

function CustomerLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#f3ede5]">
      <div className="text-center">
        <Loader2 className="mx-auto animate-spin text-[#f26b35]" />
        <p className="mt-3 text-sm text-[#6f6c66]">
          Loading your AeroFly account…
        </p>
      </div>
    </div>
  );
}
function DashboardSkeleton() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-white/70" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-2xl bg-white/70" />
    </div>
  );
}
