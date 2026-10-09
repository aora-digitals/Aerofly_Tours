
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const todayPlusSeven = () => {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const inputClass =
  "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-100";

const parseLines = (value: string) =>
  value.split("\n").map((line) => line.trim()).filter(Boolean);

export default function AdminBookingOffer() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);

  const [form, setForm] = useState({
    enquiryId: params.get("enquiryId") ?? "",
    departureId: "",
    adults: "2",
    children: "0",
    infants: "0",
    singleRooms: "0",
    discount: "0",
    additionalFees: "0",
    taxRate: "0",
    validUntil: todayPlusSeven(),
    inclusions: "",
    exclusions: "",
    specialConditions: "",
    cancellationTerms: "",
    paymentTerms: "",
    customerNotes: "",
  });

  const departures = trpc.crm.departures.useQuery();

  const selectedDeparture = useMemo(
    () =>
      departures.data?.find(
        (departure) => String(departure.id) === form.departureId,
      ),
    [departures.data, form.departureId],
  );

  const issue = trpc.crm.issueOffer.useMutation({
    onSuccess: (result) => {
  if ("success" in result && result.success === false) {
    toast.error(
      "message" in result && typeof result.message === "string"
        ? result.message
        : "This offer has expired.",
    );
    return;
  }

  toast.success(
    `Offer ${result.reference} issued. Total: ₹${Number(result.total).toLocaleString("en-IN")}`,
  );
  navigate("/admin/crm");
},
    onError: (error) =>
      toast.error(error.message || "Unable to issue the offer."),
  });

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const numberValue = (key: keyof typeof form) => Number(form[key]);

  const field = (
    label: string,
    key: keyof typeof form,
    options?: {
      type?: string;
      required?: boolean;
      min?: number;
      step?: number;
    },
  ) => (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-neutral-600">
        {label}
      </span>
      <input
        className={inputClass}
        type={options?.type ?? "text"}
        required={options?.required}
        min={options?.min}
        step={options?.step}
        value={form[key]}
        onChange={(event) => set(key, event.target.value)}
      />
    </label>
  );

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const enquiryId = Number(form.enquiryId);
    const departureId = Number(form.departureId);
    const adults = numberValue("adults");
    const children = numberValue("children");
    const infants = numberValue("infants");
    const singleRooms = numberValue("singleRooms");
    const discount = numberValue("discount");
    const additionalFees = numberValue("additionalFees");
    const taxRate = numberValue("taxRate");

    if (!Number.isInteger(enquiryId) || enquiryId < 1) {
      toast.error("Enter a valid enquiry ID.");
      return;
    }

    if (!Number.isInteger(departureId) || departureId < 1) {
      toast.error("Select a departure.");
      return;
    }

    if (
      !Number.isInteger(adults) ||
      adults < 1 ||
      !Number.isInteger(children) ||
      children < 0 ||
      !Number.isInteger(infants) ||
      infants < 0 ||
      !Number.isInteger(singleRooms) ||
      singleRooms < 0
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

    // Interpret the chosen date as the end of that day in local time.
    const expiry = new Date(`${form.validUntil}T23:59:59`);
    if (!form.validUntil || Number.isNaN(expiry.getTime()) || expiry <= new Date()) {
      toast.error("Choose a future offer expiry date.");
      return;
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
            Sales & counselling
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
            Issue a booking offer
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
            Select an existing departure and traveller counts. Prices and
            capacity are validated by Supabase when the offer is issued.
            The customer must accept the offer before proceeding to payment.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="mt-7 space-y-6 rounded-2xl border border-neutral-200 bg-white p-5 sm:p-7"
        >
          <section>
            <h2 className="mb-4 text-base font-bold">Enquiry and departure</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("Enquiry ID", "enquiryId", {
                type: "number",
                required: true,
                min: 1,
              })}

              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-neutral-600">
                  Available departure
                </span>
                <select
                  className={inputClass}
                  required
                  value={form.departureId}
                  disabled={departures.isLoading}
                  onChange={(event) => set("departureId", event.target.value)}
                >
                  <option value="">
                    {departures.isLoading
                      ? "Loading departures…"
                      : "Select a departure"}
                  </option>
                  {departures.data?.map((departure) => (
                    <option key={departure.id} value={departure.id}>
                      {departure.tourTitle} — {departure.departure_date}
                      {departure.return_date
                        ? ` to ${departure.return_date}`
                        : ""}
                      {departure.departure_city
                        ? ` (${departure.departure_city})`
                        : ""}
                      {` · ${departure.seats_available ?? "Capacity unset"} seats`}
                    </option>
                  ))}
                </select>
                {departures.isError && (
                  <span className="mt-1 block text-xs text-red-700">
                    Could not load departures. Refresh and try again.
                  </span>
                )}
              </label>

              {selectedDeparture && (
                <div className="rounded-xl bg-orange-50 p-4 text-sm sm:col-span-2">
                  <p className="font-bold">
                    {selectedDeparture.tourTitle}
                  </p>
                  <p className="mt-1 text-neutral-700">
                    Adult: ₹{Number(selectedDeparture.adult_price).toLocaleString("en-IN")}
                    {" · "}Child: ₹{Number(selectedDeparture.child_price).toLocaleString("en-IN")}
                    {" · "}Infant: ₹{Number(selectedDeparture.infant_price).toLocaleString("en-IN")}
                    {" · "}Single-room supplement: ₹{Number(selectedDeparture.single_supplement ?? 0).toLocaleString("en-IN")}
                  </p>
                  <p className="mt-1 text-xs text-neutral-600">
                    Final pricing and seat availability are rechecked by the
                    database on submission.
                  </p>
                </div>
              )}

              {field("Adults", "adults", {
                type: "number",
                required: true,
                min: 1,
                step: 1,
              })}
              {field("Children", "children", {
                type: "number",
                required: true,
                min: 0,
                step: 1,
              })}
              {field("Infants", "infants", {
                type: "number",
                required: true,
                min: 0,
                step: 1,
              })}
              {field("Single-room supplements", "singleRooms", {
                type: "number",
                required: true,
                min: 0,
                step: 1,
              })}
              {field("Offer valid until", "validUntil", {
                type: "date",
                required: true,
              })}
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-base font-bold">Adjustments</h2>
            <p className="mb-4 text-sm text-neutral-600">
              Base rates come from the departure record. Only enter authorised
              adjustments here.
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
                step: 0.01,
              })}
            </div>
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
                  onChange={(event) => set("inclusions", event.target.value)}
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
                  onChange={(event) => set("exclusions", event.target.value)}
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
                  onChange={(event) => set("customerNotes", event.target.value)}
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
                departures.isLoading ||
                departures.isError ||
                !form.departureId
              }
              className="rounded-full bg-orange-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-orange-800 disabled:opacity-50"
            >
              {issue.isPending ? "Issuing offer…" : "Issue offer to customer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
