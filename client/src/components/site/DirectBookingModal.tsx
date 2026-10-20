
import { useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  LoaderCircle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

type Departure = {
  id: number;
  departure_date: string;
  return_date?: string | null;
  label?: string | null;
  seats_available?: number | null;
  status?: string;
  adult_price?: number | null;
  child_price?: number | null;
  infant_price?: number | null;
  price_from?: number | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  tour: {
    id: number;
    title: string;
    destination?: string | null;
    priceFrom?: number | string | null;
    departures?: Departure[];
  };
};

const money = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);

export default function DirectBookingModal({
  open,
  onClose,
  tour,
}: Props) {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [departureId, setDepartureId] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [travellerNames, setTravellerNames] = useState("");
  const [notes, setNotes] = useState("");

  const departures = useMemo(
    () =>
      (tour.departures ?? []).filter(
        (departure) =>
          departure.status !== "sold_out" &&
          departure.status !== "cancelled" &&
          new Date(`${departure.departure_date}T00:00:00`) >=
            new Date(new Date().toDateString()),
      ),
    [tour.departures],
  );

  const basePrice = Number(tour.priceFrom ?? 0);

  const selectedDeparture = departures.find(
    (departure) => String(departure.id) === departureId,
  );

  const estimatedPrice =
    Number(
      selectedDeparture?.adult_price ??
        selectedDeparture?.price_from ??
        basePrice,
    ) *
      adults +
    Number(
      selectedDeparture?.child_price ??
        selectedDeparture?.price_from ??
        basePrice,
    ) *
      children +
    Number(selectedDeparture?.infant_price ?? 0) * infants;

  const book = trpc.customer.directBook.useMutation({
    onSuccess: (result) => {
      toast.success(`Booking created: ${result.bookingReference}`);
      onClose();

      navigate(
        `/dashboard/offers?booking=${encodeURIComponent(
          result.bookingReference,
        )}`,
      );
    },
    onError: (error) => {
      toast.error(
        error.message || "We could not create this booking.",
      );
    },
  });

  if (!open) return null;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isAuthenticated) {
      toast.info("Sign in to continue with your booking.");

      navigate(
        `/login?redirect=${encodeURIComponent(
          window.location.pathname,
        )}`,
      );
      return;
    }

    book.mutate({
      tourId: tour.id,
      departureId: departureId
        ? Number(departureId)
        : undefined,
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      adults,
      children,
      infants,
      travellerNames: travellerNames
        .split(/[,\n]/)
        .map((value) => value.trim())
        .filter(Boolean),
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          !book.isPending
        ) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="direct-booking-title"
        className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-neutral-100 bg-white p-5 sm:p-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-orange-700">
              Book directly
            </p>
            <h2
              id="direct-booking-title"
              className="mt-1 text-2xl font-extrabold text-neutral-900"
            >
              {tour.title}
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              {tour.destination || "AeroFly Tours"}
            </p>
          </div>

          <button
            type="button"
            aria-label="Close booking form"
            onClick={onClose}
            disabled={book.isPending}
            className="rounded-full p-2 text-neutral-500 hover:bg-neutral-100"
          >
            <X size={20} />
          </button>
        </div>

        <form
          onSubmit={submit}
          className="space-y-5 p-5 sm:p-6"
        >
          {!isAuthenticated && (
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
              Sign in before submitting your booking.
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-neutral-700">
              Contact name *
              <input
                required
                minLength={2}
                maxLength={160}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3 py-2.5 font-normal outline-none focus:border-orange-600"
              />
            </label>

            <label className="text-sm font-semibold text-neutral-700">
              Email address *
              <input
                required
                type="email"
                maxLength={320}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3 py-2.5 font-normal outline-none focus:border-orange-600"
              />
            </label>

            <label className="text-sm font-semibold text-neutral-700 sm:col-span-2">
              Phone number *
              <input
                required
                minLength={7}
                maxLength={40}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                autoComplete="tel"
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3 py-2.5 font-normal outline-none focus:border-orange-600"
              />
            </label>
          </div>

          <label className="block text-sm font-semibold text-neutral-700">
            Departure date
            <span className="font-normal text-neutral-500">
              {" "}
              (choose an available departure)
            </span>

            <select
              value={departureId}
              onChange={(event) =>
                setDepartureId(event.target.value)
              }
              className="mt-1.5 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-orange-600"
            >
              <option value="">
                Date to be confirmed by AeroFly
              </option>

              {departures.map((departure) => (
                <option
                  key={departure.id}
                  value={departure.id}
                >
                  {departure.label || departure.departure_date}
                  {departure.return_date
                    ? ` — ${departure.return_date}`
                    : ""}
                  {departure.seats_available != null
                    ? ` · ${departure.seats_available} seats left`
                    : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="text-sm font-semibold text-neutral-700">
              Adults *
              <input
                type="number"
                min={1}
                max={30}
                required
                value={adults}
                onChange={(event) =>
                  setAdults(Number(event.target.value))
                }
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3 py-2.5"
              />
            </label>

            <label className="text-sm font-semibold text-neutral-700">
              Children
              <input
                type="number"
                min={0}
                max={29}
                value={children}
                onChange={(event) =>
                  setChildren(Number(event.target.value))
                }
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3 py-2.5"
              />
            </label>

            <label className="text-sm font-semibold text-neutral-700">
              Infants
              <input
                type="number"
                min={0}
                max={29}
                value={infants}
                onChange={(event) =>
                  setInfants(Number(event.target.value))
                }
                className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3 py-2.5"
              />
            </label>
          </div>

          {adults + children + infants > 30 && (
            <p className="text-sm text-red-700">
              A maximum of 30 travellers is allowed per booking.
            </p>
          )}

          <label className="block text-sm font-semibold text-neutral-700">
            Traveller names
            <span className="font-normal text-neutral-500">
              {" "}
              (optional, comma separated)
            </span>
            <textarea
              value={travellerNames}
              onChange={(event) =>
                setTravellerNames(event.target.value)
              }
              rows={2}
              maxLength={3000}
              placeholder="Names as they appear on travel documents"
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3 py-2.5 font-normal"
            />
          </label>

          <label className="block text-sm font-semibold text-neutral-700">
            Special requests
            <span className="font-normal text-neutral-500">
              {" "}
              (optional)
            </span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Room preference or other notes"
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3 py-2.5 font-normal"
            />
          </label>

          <div className="flex items-center justify-between rounded-2xl bg-[#fff5ef] p-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                Estimated total
              </p>
              <p className="mt-1 text-xl font-extrabold text-neutral-900">
                {money(estimatedPrice)}
              </p>
              <p className="mt-1 text-xs text-neutral-600">
                The server calculates and validates the final price.
              </p>
            </div>

            <CalendarDays
              className="text-orange-700"
              size={25}
            />
          </div>

          <button
            type="submit"
            disabled={
              book.isPending ||
              adults + children + infants > 30
            }
            className="flex w-full items-center justify-center gap-2 rounded-full bg-orange-700 px-5 py-3.5 font-bold text-white transition hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {book.isPending ? (
              <>
                <LoaderCircle
                  size={18}
                  className="animate-spin"
                />
                Creating booking…
              </>
            ) : (
              <>
                <CheckCircle2 size={18} />
                Book now
              </>
            )}
          </button>

          <p className="text-center text-xs leading-5 text-neutral-500">
            Your booking will appear in My Bookings & Offers.
            Eligible coupons can be applied before payment.
          </p>
        </form>
      </section>
    </div>
  );
}
