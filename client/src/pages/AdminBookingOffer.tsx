
import { useMemo, useState, useEffect} from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type BookingOfferForm = {
  enquiryId: string;
  tourId: string;
  departureId: string;
  adults: string;
  children: string;
  infants: string;
  singleRooms: string;
  validUntil: string;
  discount: string;
  additionalFees: string;
  taxRate: string;
  inclusions: string;
  exclusions: string;
  specialConditions: string;
  cancellationTerms: string;
  paymentTerms: string;
  customerNotes: string;
  adultPrice: string;
  childPrice: string;
  infantPrice: string;
  singleSupplement: string;
  capacity: string;
    departureDate: string;
  returnDate: string;
  departureCity: string;
  destination: string;
travelDates: string;
};

type FieldOptions = {
  type?: string;
  required?: boolean;
  min?: string | number;
  max?: string | number;
  step?: string | number;
};


const datePlusDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const inputClass =
  "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:bg-neutral-100";

const parseLines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const formatMoney = (value: number) =>
  `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

export default function AdminBookingOffer() {
  const [, navigate] = useLocation();
  const [useManualDeparture, setUseManualDeparture] = useState(false);

const createManualDeparture = trpc.crm.createManualDeparture.useMutation();

  const [form, setForm] = useState<BookingOfferForm>({
    enquiryId:
      new URLSearchParams(window.location.search).get("enquiryId") ?? "",
    tourId: "",
    departureId: "",
    adults: "2",
    children: "0",
    infants: "0",
    singleRooms: "0",
    validUntil: datePlusDays(7),
    discount: "0",
    additionalFees: "0",
    taxRate: "0",
    inclusions: "",
    exclusions: "",
    specialConditions: "",
    cancellationTerms: "",
    paymentTerms: "",
    customerNotes: "",
    adultPrice: "",
    childPrice: "0",
    infantPrice: "0",
    singleSupplement: "0",
    capacity: "20",
    departureDate: "",
returnDate: "",
departureCity: "",
destination: "",
travelDates: "",
  });

  const set = <K extends keyof BookingOfferForm>(
    key: K,
    value: BookingOfferForm[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toursQuery = trpc.content.tours.useQuery({
    page: 1,
    pageSize: 48,
    sort: "newest",
  });

  const selectedTourId = form.tourId
    ? Number(form.tourId)
    : undefined;

  const departures = trpc.crm.departures.useQuery(
    { tourId: selectedTourId ?? 0 },
    {
      enabled:
        Number.isInteger(selectedTourId) &&
        Number(selectedTourId) > 0,
    },
  );

  const selectedTour = useMemo(
    () =>
      toursQuery.data?.items?.find(
        (tour) => Number(tour.id) === selectedTourId,
      ),
    [toursQuery.data?.items, selectedTourId],
  );

  const enquiryIdNumber = Number(form.enquiryId);

const enquiryQuery = trpc.crm.enquiry.useQuery(
  { id: enquiryIdNumber },
  {
    enabled:
      Number.isInteger(enquiryIdNumber) &&
      enquiryIdNumber > 0,
  },
);

const enquiry = enquiryQuery.data?.enquiry;

useEffect(() => {
  if (!enquiry) return;

  setForm((current) => ({
    ...current,
    tourId:
      enquiry.tourId != null
        ? String(enquiry.tourId)
        : current.tourId,
    destination: enquiry.destination ?? current.destination,
    travelDates: enquiry.travelDates ?? current.travelDates,
    adults: String(
      Math.max(1, Number(enquiry.travellers ?? current.adults)),
    ),
  }));
}, [enquiry]);

useEffect(() => {
  if (
    !departures.isLoading &&
    !departures.isError &&
    selectedTourId &&
    (departures.data?.length ?? 0) === 0
  ) {
    setUseManualDeparture(true);
  }
}, [
  departures.isLoading,
  departures.isError,
  departures.data,
  selectedTourId,
]);

  const issue = trpc.crm.issueOffer.useMutation({
    onSuccess: (result) => {
      if ("success" in result && result.success === false) {
        toast.error(
          "message" in result && typeof result.message === "string"
            ? result.message
            : "The booking offer could not be issued.",
        );
        return;
      }

      toast.success(
        `Offer ${result.reference} issued. Total: ${formatMoney(
          Number(result.total),
        )}`,
      );

      navigate("/admin/crm");
    },
    onError: (error) => {
      toast.error(error.message || "Unable to issue the booking offer.");
    },
  });

  const field = (
    label: string,
    key: keyof BookingOfferForm,
    options: FieldOptions = {},
  ) => (
    <label className="block" key={key}>
      <span className="mb-1.5 block text-xs font-bold text-neutral-600">
        {label}
      </span>

      <input
        className={inputClass}
        type={options.type ?? "text"}
        required={options.required}
        min={options.min}
        max={options.max}
        step={options.step}
        value={form[key]}
        onChange={(event) => set(key, event.target.value)}
      />
    </label>
  );

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
  event.preventDefault();

  const enquiryId = Number(form.enquiryId);
  const tourId = Number(form.tourId);

  if (!Number.isInteger(enquiryId) || enquiryId < 1) {
    toast.error("Open this form from a valid enquiry.");
    return;
  }

  if (!Number.isInteger(tourId) || tourId < 1) {
    toast.error("This enquiry must be linked to a valid tour.");
    return;
  }

  if (!enquiry || Number(enquiry.id) !== enquiryId) {
    toast.error("The enquiry has not finished loading. Try again.");
    return;
  }

  if (
    enquiry.tourId != null &&
    Number(enquiry.tourId) !== tourId
  ) {
    toast.error("The selected tour does not match this enquiry.");
    return;
  }

  if (
    departures.isLoading ||
    departures.isError
  ) {
    toast.error("Wait until the departures list has loaded successfully.");
    return;
  }

  const adults = Number(form.adults);
  const children = Number(form.children);
  const infants = Number(form.infants);
  const singleRooms = Number(form.singleRooms);
  const discount = Number(form.discount);
  const additionalFees = Number(form.additionalFees);
  const taxRate = Number(form.taxRate);

  if (
    !Number.isInteger(adults) || adults < 1 ||
    !Number.isInteger(children) || children < 0 ||
    !Number.isInteger(infants) || infants < 0 ||
    !Number.isInteger(singleRooms) || singleRooms < 0
  ) {
    toast.error("Check the traveller and room counts.");
    return;
  }

  if (
    ![discount, additionalFees, taxRate].every(Number.isFinite) ||
    discount < 0 ||
    additionalFees < 0 ||
    taxRate < 0 ||
    taxRate > 100
  ) {
    toast.error("Check the discount, fees and tax rate.");
    return;
  }

  const expiry = new Date(`${form.validUntil}T23:59:59`);

  if (
    !form.validUntil ||
    Number.isNaN(expiry.getTime()) ||
    expiry.getTime() <= Date.now()
  ) {
    toast.error("Choose a future offer expiry date.");
    return;
  }

  if (
    useManualDeparture &&
    form.returnDate &&
    form.returnDate < form.departureDate
  ) {
    toast.error("Return date cannot be before departure.");
    return;
  }

  try {
    let departureId: number;

    if (useManualDeparture) {
      const adultPrice = Number(form.adultPrice);
      const childPrice = Number(form.childPrice);
      const infantPrice = Number(form.infantPrice);
      const singleSupplement = Number(form.singleSupplement);
      const capacity = Number(form.capacity);

      if (
        !form.departureDate ||
        !Number.isFinite(adultPrice) || adultPrice <= 0 ||
        !Number.isFinite(childPrice) || childPrice < 0 ||
        !Number.isFinite(infantPrice) || infantPrice < 0 ||
        !Number.isFinite(singleSupplement) || singleSupplement < 0 ||
        !Number.isInteger(capacity) || capacity < adults + children + infants
      ) {
        toast.error(
          "Enter valid departure dates, prices and enough seats for all travellers.",
        );
        return;
      }

      departureId = await createManualDeparture.mutateAsync({
        tourId,
        departureDate: form.departureDate,
        returnDate: form.returnDate || undefined,
        departureCity: form.departureCity.trim() || undefined,
        adultPrice,
        childPrice,
        infantPrice,
        singleSupplement,
        capacity,
      });
    } else {
      departureId = Number(form.departureId);

      const departure = departures.data?.find(
        (item) => Number(item.id) === departureId,
      );

      if (
        !Number.isInteger(departureId) ||
        departureId < 1 ||
        !departure
      ) {
        toast.error("Select a valid departure.");
        return;
      }

      if (Number(departure.tourId) !== tourId) {
        toast.error("The departure does not belong to the selected tour.");
        return;
      }
    }

    issue.mutate({
      enquiryId,
      departureId,
      adults,
      children,
      infants,
      singleRooms,
      discount,
      additionalFees,
      taxRate,
      validUntil: expiry.toISOString(),
      inclusions: parseLines(form.inclusions),
      exclusions: parseLines(form.exclusions),
      specialConditions: form.specialConditions.trim() || undefined,
      cancellationTerms: form.cancellationTerms.trim() || undefined,
      paymentTerms: form.paymentTerms.trim() || undefined,
      customerNotes: form.customerNotes.trim() || undefined,
    });
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : "Unable to prepare the booking offer.",
    );
  }
};

  return (
    <div className="min-h-screen bg-[#fbfaf8] px-4 py-8 text-[#242321] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/admin/crm"
          className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-orange-700"
        >
          <ArrowLeft size={16} />
          Back to CRM
        </Link>

        <div className="mt-5">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-orange-700">
            Sales &amp; counselling
          </p>

          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
            Issue a booking offer
          </h1>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
            Select a tour and an existing departure, then enter the
            traveller details and authorised adjustments. The customer
            receives the proposal in their profile and must accept it
            before payment becomes available.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="mt-7 space-y-6 rounded-2xl border border-neutral-200 bg-white p-5 sm:p-7"
        >
          <section className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
  <h2 className="text-base font-bold">Enquiry and tour</h2>

  {enquiryQuery.isLoading ? (
    <p className="mt-2 text-sm text-neutral-600">
      Loading enquiry details…
    </p>
  ) : enquiryQuery.isError || !enquiry ? (
    <p className="mt-2 text-sm text-red-700">
      Unable to load this enquiry. Return to CRM and open the offer
      from the correct enquiry.
    </p>
  ) : (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <div>
        <p className="text-xs text-neutral-500">Enquiry ID</p>
        <p className="font-semibold">{enquiry.id}</p>
      </div>

      <div>
        <p className="text-xs text-neutral-500">Customer</p>
        <p className="font-semibold">{enquiry.name}</p>
      </div>

      <div>
        <p className="text-xs text-neutral-500">Tour</p>
        <p className="font-semibold">
          {selectedTour?.title ??
            (enquiry.tourId
              ? `Tour #${enquiry.tourId}`
              : enquiry.destination || "No tour linked")}
        </p>
      </div>

      <div>
        <p className="text-xs text-neutral-500">Requested travel dates</p>
        <p className="font-semibold">
          {enquiry.travelDates || "Not specified"}
        </p>
      </div>

      <div>
        <p className="text-xs text-neutral-500">Travellers requested</p>
        <p className="font-semibold">{enquiry.travellers ?? "Not specified"}</p>
      </div>
    </div>
  )}
</section>

          <section>
            <h2 className="mb-4 text-base font-bold">Adjustments</h2>

            <p className="mb-4 text-sm text-neutral-600">
              Base rates should come from the departure record. Enter only
              authorised adjustments.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              {field("Approved discount (₹)", "discount", {
                type: "number",
                required: true,
                min: 0,
                step: 0.01,
              })}

              {field("Additional fees (₹)", "additionalFees", {
                type: "number",
                required: true,
                min: 0,
                step: 0.01,
              })}

              {field("Tax rate (%)", "taxRate", {
                type: "number",
                required: true,
                min: 0,
                max: 100,
                step: 0.01,
              })}
            </div>
          </section>

          
          <section className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <h2 className="text-base font-bold">Departure details</h2>

            <p className="mt-1 text-sm text-neutral-600">
              Select an existing departure or create one manually if no
              suitable departure is available.
            </p>

            <label className="mt-4 flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={useManualDeparture}
                onChange={(event) => {
                  setUseManualDeparture(event.target.checked);
                  set("departureId", "");
                }}
              />
              Create a new departure manually
            </label>

            {useManualDeparture ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-neutral-600">
                    Departure date
                  </span>
                  <input
                    type="date"
                    required
                    min={new Date().toISOString().slice(0, 10)}
                    className={inputClass}
                    value={form.departureDate}
                    onChange={(event) =>
                      set("departureDate", event.target.value)
                    }
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-neutral-600">
                    Return date
                  </span>
                  <input
                    type="date"
                    required
                    min={form.departureDate || new Date().toISOString().slice(0, 10)}
                    className={inputClass}
                    value={form.returnDate}
                    onChange={(event) =>
                      set("returnDate", event.target.value)
                    }
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-neutral-600">
                    Departure city
                  </span>
                  <input
                    type="text"
                    required
                    maxLength={150}
                    className={inputClass}
                    value={form.departureCity}
                    onChange={(event) =>
                      set("departureCity", event.target.value)
                    }
                    placeholder="e.g. Pune"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-neutral-600">
                    Adult price (₹)
                  </span>
                  <input
                    type="number"
                    required
                    min={0}
                    step="0.01"
                    className={inputClass}
                    value={form.adultPrice}
                    onChange={(event) =>
                      set("adultPrice", event.target.value)
                    }
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-neutral-600">
                    Child price (₹)
                  </span>
                  <input
                    type="number"
                    required
                    min={0}
                    step="0.01"
                    className={inputClass}
                    value={form.childPrice}
                    onChange={(event) =>
                      set("childPrice", event.target.value)
                    }
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-neutral-600">
                    Infant price (₹)
                  </span>
                  <input
                    type="number"
                    required
                    min={0}
                    step="0.01"
                    className={inputClass}
                    value={form.infantPrice}
                    onChange={(event) =>
                      set("infantPrice", event.target.value)
                    }
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-neutral-600">
                    Single supplement (₹)
                  </span>
                  <input
                    type="number"
                    required
                    min={0}
                    step="0.01"
                    className={inputClass}
                    value={form.singleSupplement}
                    onChange={(event) =>
                      set("singleSupplement", event.target.value)
                    }
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-neutral-600">
                    Total capacity
                  </span>
                  <input
                    type="number"
                    required
                    min={1}
                    step={1}
                    className={inputClass}
                    value={form.capacity}
                    onChange={(event) =>
                      set("capacity", event.target.value)
                    }
                  />
                </label>
              </div>
            ) : (
              <div className="mt-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-neutral-600">
                    Existing departure
                  </span>
                  <select
                    required
                    className={inputClass}
                    value={form.departureId}
                    onChange={(event) =>
                      set("departureId", event.target.value)
                    }
                    disabled={departures.isLoading || departures.isError}
                  >
                    <option value="">
                      {departures.isLoading
                        ? "Loading departures…"
                        : departures.isError
                          ? "Unable to load departures"
                          : "Select a departure"}
                    </option>

                    {(departures.data ?? []).map((departure) => (
                      <option key={departure.id} value={String(departure.id)}>
                        {departure.departure_date}
                        {departure.return_date
                          ? ` — Return: ${departure.return_date}`
                          : ""}
                        {` — ${departure.status}`}
                      </option>
                    ))}
                  </select>
                </label>

                {!departures.isLoading &&
                  !departures.isError &&
                  (departures.data ?? []).length === 0 && (
                    <p className="mt-2 text-sm text-amber-800">
                      No existing departures were found. Select “Create a
                      new departure manually” above.
                    </p>
                  )}
              </div>
            )}
          </section>


          <section>
            <h2 className="mb-4 text-base font-bold">Terms and notes</h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-neutral-600">
                  Inclusions (one per line)
                </span>

                <textarea
                  rows={4}
                  maxLength={5000}
                  className={inputClass}
                  value={form.inclusions}
                  onChange={(event) =>
                    set("inclusions", event.target.value)
                  }
                  placeholder={"Accommodation\nBreakfast\nAirport transfers"}
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-neutral-600">
                  Exclusions (one per line)
                </span>

                <textarea
                  rows={4}
                  maxLength={5000}
                  className={inputClass}
                  value={form.exclusions}
                  onChange={(event) =>
                    set("exclusions", event.target.value)
                  }
                  placeholder={"Personal expenses\nOptional activities"}
                />
              </label>

              {(
                [
                  ["Special conditions", "specialConditions"],
                  ["Cancellation terms", "cancellationTerms"],
                  ["Payment terms", "paymentTerms"],
                ] as const
              ).map(([label, key]) => (
                <label key={key} className="block">
                  <span className="mb-1.5 block text-xs font-bold text-neutral-600">
                    {label}
                  </span>

                  <textarea
                    rows={3}
                    maxLength={3000}
                    className={inputClass}
                    value={form[key]}
                    onChange={(event) => set(key, event.target.value)}
                  />
                </label>
              ))}

              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-bold text-neutral-600">
                  Customer-visible consultant notes
                </span>

                <textarea
                  rows={3}
                  maxLength={3000}
                  className={inputClass}
                  value={form.customerNotes}
                  onChange={(event) =>
                    set("customerNotes", event.target.value)
                  }
                  placeholder="Clarify what is included, excluded, or subject to confirmation."
                />
              </label>
            </div>
          </section>

          <div className="flex flex-col-reverse gap-3 border-t border-neutral-100 pt-5 sm:flex-row sm:justify-end">
            <Link
              href="/admin/crm"
              className="rounded-full border border-neutral-300 px-5 py-2.5 text-center text-sm font-semibold"
            >
              Return to CRM
            </Link>

            <button
              type="submit"
              disabled={
  issue.isPending ||
  createManualDeparture.isPending ||
  departures.isLoading ||
  departures.isError ||
  !enquiry ||
  !form.tourId ||
  (!useManualDeparture && !form.departureId)
}
              className="rounded-full bg-orange-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {issue.isPending
                ? "Issuing offer…"
                : "Issue offer to customer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
