import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Ban,
  Eye,
  History,
  Pencil,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type RecordType = "offer" | "booking";
type BookingRecord = {
  id: number;
  recordType: RecordType;
  reference: string;
  customerId: string;
  destination: string;
  travelDates: string;
  travellers: number;
  amount: number;
  currency: string;
  status: string;
  paymentStatus: string;
  notes: string;
  createdAt: string;
  staffId: string;
  version: number;
  archivedAt: string | null;
};

type OfferEvent = {
  id: number;
  action: string;
  actor_type: string;
  message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

const db = supabase as any;

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency || "INR",
    maximumFractionDigits: 2,
  }).format(amount || 0);

const dateLabel = (value: string) => {
  if (!value) return "Not provided";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

const normalize = (value: unknown) =>
  String(value ?? "").toLowerCase().replaceAll("_", " ").trim();

function StatusPill({ value }: { value: string }) {
  const status = normalize(value) || "unknown";
  const positive = [
    "accepted",
    "confirmed",
    "paid",
    "completed",
    "succeeded",
  ].includes(status);
  const negative = [
    "cancelled",
    "rejected",
    "expired",
    "failed",
  ].includes(status);

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${
        positive
          ? "bg-emerald-50 text-emerald-700"
          : negative
            ? "bg-red-50 text-red-700"
            : "bg-amber-50 text-amber-800"
      }`}
    >
      {status}
    </span>
  );
}

export default function AdminBookingsWorkspace() {
  const [records, setRecords] = useState<BookingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<BookingRecord | null>(null);
  const [editing, setEditing] = useState<BookingRecord | null>(null);
  const [history, setHistory] = useState<OfferEvent[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] =
  useState<BookingRecord | null>(null);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [offersResult, bookingsResult] = await Promise.all([
        db.from("quotations").select("*").order("createdAt", {
          ascending: false,
        }),
        db.from("bookings").select("*").order("createdAt", {
          ascending: false,
        }),
      ]);

      if (offersResult.error) throw offersResult.error;
      if (bookingsResult.error) throw bookingsResult.error;

      const offers: BookingRecord[] = (offersResult.data ?? []).map(
        (row: any) => ({
          id: Number(row.id),
          recordType: "offer",
          reference: row.reference ?? `QT-${row.id}`,
          customerId: row.customer_auth_id ?? "",
          destination: row.destination ?? "",
          travelDates: row.travelDates ?? "",
          travellers: Number(row.travellers ?? 0),
          amount: Number(row.total ?? 0),
          currency: row.currency ?? "INR",
          status:
            row.proposal_status ??
            row.customer_response ??
            row.status ??
            "unknown",
          paymentStatus: row.customer_response ?? "awaiting_response",
          notes: row.notes ?? "",
          createdAt: row.createdAt ?? row.issued_at ?? "",
          staffId: row.issued_by ?? row.createdBy ?? "",
          version: Number(row.offer_version ?? 1),
          archivedAt: row.archived_at ?? null,
        }),
      );

      const bookings: BookingRecord[] = (bookingsResult.data ?? []).map(
        (row: any) => ({
          id: Number(row.id),
          recordType: "booking",
          reference: row.reference ?? `BK-${row.id}`,
          customerId: row.customer_auth_id ?? "",
          destination: row.destination ?? "",
          travelDates: row.travelDates ?? "",
          travellers: Number(row.travellers ?? 0),
          amount: Number(row.amount ?? 0),
          currency: row.currency ?? "INR",
          status: row.bookingStatus ?? "unknown",
          paymentStatus: row.paymentStatus ?? "pending",
          notes: row.cancellation_reason ?? "",
          createdAt: row.createdAt ?? "",
          staffId: row.assigned_auth_id ?? row.assignedTo ?? "",
          version: 1,
          archivedAt: row.archived_at ?? null,
        }),
      );

      setRecords(
        [...offers, ...bookings].sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime(),
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load bookings. Check Supabase permissions and schema.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const filtered = useMemo(() => {
    return records.filter((record) => {
      if (!showArchived && record.archivedAt) return false;
      if (showArchived && !record.archivedAt) return false;

      const searchable = [
        record.reference,
        record.destination,
        record.customerId,
        record.staffId,
        record.status,
        record.recordType,
      ]
        .join(" ")
        .toLowerCase();

      if (!searchable.includes(search.toLowerCase())) return false;

      if (filter === "offers" && record.recordType !== "offer") return false;
      if (filter === "bookings" && record.recordType !== "booking")
        return false;

      if (filter === "pending") {
        const state = normalize(record.status);
        if (
          !["sent", "issued", "draft", "awaiting response", "pending",
            "edit requested", "changes requested"].includes(state)
        ) {
          return false;
        }
      }

      if (filter === "cancelled") {
        const state = normalize(record.status);
        if (!["cancelled", "withdrawn"].includes(state)) return false;
      }

      if (filter === "confirmed") {
        const state = normalize(record.status);
        if (!["confirmed", "accepted", "completed"].includes(state))
          return false;
      }

      return true;
    });
  }, [records, search, filter, showArchived]);

  async function viewHistory(record: BookingRecord) {
    setSelected(record);
    setHistory([]);
    setError("");

    if (record.recordType !== "offer") return;

    const { data, error: historyError } = await db
      .from("booking_offer_events")
      .select("id, action, actor_type, message, metadata, created_at")
      .eq("quotation_id", record.id)
      .order("created_at", { ascending: false });

    if (historyError) {
      setError(historyError.message);
      return;
    }

    setHistory(data ?? []);
  }

  async function archiveRecord(record: BookingRecord) {
    if (
      !window.confirm(
        `Archive ${record.reference}? It will leave the active list but remain in the database.`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const { error: rpcError } = await db.rpc(
        "admin_archive_booking_record",
        {
          p_record_type: record.recordType,
          p_record_id: record.id,
        },
      );

      if (rpcError) throw rpcError;

      setSelected(null);
      setNotice(`${record.reference} was archived.`);
      await loadRecords();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to archive this record.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;

    const form = new FormData(event.currentTarget);
    const total = Number(form.get("total"));
    const travellers = Number(form.get("travellers"));

    if (!Number.isFinite(total) || total <= 0) {
      setError("Enter a valid offer amount.");
      return;
    }

    if (!Number.isInteger(travellers) || travellers < 1) {
      setError("Enter a valid traveller count.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const { error: rpcError } = await db.rpc(
        "admin_update_booking_offer",
        {
          p_quotation_id: editing.id,
          p_destination: String(form.get("destination") ?? "").trim(),
          p_travel_dates: String(form.get("travelDates") ?? "").trim(),
          p_travellers: travellers,
          p_total: total,
          p_notes: String(form.get("notes") ?? ""),
        },
      );

      if (rpcError) throw rpcError;

      setEditing(null);
      setNotice(
        `${editing.reference} was updated and its offer version was incremented.`,
      );
      await loadRecords();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update this offer.",
      );
    } finally {
      setBusy(false);
    }
  }

  const activeCount = records.filter((r) => !r.archivedAt).length;
  const offerCount = records.filter(
    (r) => r.recordType === "offer" && !r.archivedAt,
  ).length;
  const bookingCount = records.filter(
    (r) => r.recordType === "booking" && !r.archivedAt,
  ).length;

  return (
    <section className="mt-7 space-y-5">
      <header className="rounded-xl border border-[#ead8cc] bg-[#fff8f3] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#c94d1c]">
              AeroFly Tours · Operations
            </p>
            <h2 className="mt-2 font-['Manrope'] text-2xl font-extrabold">
              Bookings & offer history
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#77736c]">
              Track staff-issued offers, customer responses, confirmed bookings,
              cancellations and previous activity.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadRecords()}
            disabled={loading || busy}
            className="inline-flex items-center gap-2 rounded-lg border border-[#deded9] bg-white px-4 py-2 text-xs font-bold disabled:opacity-50"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            ["Active records", activeCount],
            ["Offers", offerCount],
            ["Bookings", bookingCount],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-[#eee1d8] bg-white p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#92928b]">
                {label}
              </div>
              <div className="mt-2 text-2xl font-extrabold">{value}</div>
            </div>
          ))}
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {notice && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-[#deded9] bg-white p-4 lg:flex-row">
        <label className="relative min-w-0 flex-1">
          <Search size={15} className="absolute left-3 top-3 text-[#92928b]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reference, destination, customer ID or staff ID"
            className="w-full rounded-lg border border-[#deded9] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#f26b35]"
          />
        </label>

        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-[#deded9] bg-white px-3 py-2 text-sm"
        >
          <option value="all">All records</option>
          <option value="offers">Offers only</option>
          <option value="bookings">Bookings only</option>
          <option value="pending">Awaiting response / pending</option>
          <option value="confirmed">Accepted / confirmed</option>
          <option value="cancelled">Cancelled / withdrawn</option>
        </select>

        <label className="flex items-center gap-2 px-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Archived
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#deded9] bg-white">
        {loading ? (
          <div className="p-12 text-center text-sm text-[#77736c]">
            Loading booking records…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="font-bold">No matching records</p>
            <p className="mt-2 text-sm text-[#92928b]">
              Try a different search or status filter.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#ecece8]">
            {filtered.map((record) => (
              <article
                key={`${record.recordType}-${record.id}`}
                className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[1.4fr_1fr_.8fr_auto] xl:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold">
                      {record.reference}
                    </span>
                    <span className="rounded-full bg-[#f4f4f1] px-2 py-1 text-[9px] font-bold uppercase tracking-wide">
                      {record.recordType}
                    </span>
                    {record.archivedAt && (
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-[9px] font-bold">
                        Archived
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-sm font-semibold">
                    {record.destination || "Destination not provided"}
                  </div>
                  <div className="mt-1 text-xs text-[#77736c]">
                    Travel: {dateLabel(record.travelDates)} ·{" "}
                    {record.travellers} travellers
                  </div>
                  <div className="mt-1 break-all text-[10px] text-[#92928b]">
                    Customer ID: {record.customerId || "Not linked"}
                  </div>
                  <div className="mt-1 break-all text-[10px] text-[#92928b]">
                    Created by: {record.staffId || "Not recorded"}
                  </div>
                </div>

                <div>
                  <StatusPill value={record.status} />
                  <div className="mt-2 text-sm font-bold">
                    {money(record.amount, record.currency)}
                  </div>
                  <div className="mt-1 text-[10px] text-[#92928b]">
                    Payment: {normalize(record.paymentStatus)}
                  </div>
                </div>

                <div className="text-xs text-[#77736c]">
                  <div>Created: {dateLabel(record.createdAt)}</div>
                  {record.recordType === "offer" && (
                    <div className="mt-1">Offer version: {record.version}</div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 xl:justify-end">
                  <button
                    type="button"
                    onClick={() => void viewHistory(record)}
                    title="View details and history"
                    className="rounded-lg border border-[#deded9] p-2 hover:bg-[#f8f8f5]"
                  >
                    <Eye size={15} />
                  </button>

                  {record.recordType === "offer" &&
                    !record.archivedAt &&
                    ["sent", "issued", "viewed", "edit requested"].includes(
                      normalize(record.status),
                    ) && (
                      <button
                        type="button"
                        onClick={() => {
                          setError("");
                          setEditing(record);
                        }}
                        title="Edit offer"
                        className="rounded-lg border border-[#deded9] p-2 hover:bg-[#fff8f3]"
                      >
                        <Pencil size={15} />
                      </button>
                    )}

                  {!record.archivedAt &&
                    !["cancelled", "completed", "rejected", "expired"].includes(
                      normalize(record.status),
                    ) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(record);
                          setReason("");
                          setError("");
                        }}
                        title="Cancel"
                        className="rounded-lg border border-red-200 p-2 text-red-700 hover:bg-red-50"
                      >
                        <Ban size={15} />
                      </button>
                    )}

                  {!record.archivedAt && (
                    <button
                      type="button"
                      onClick={() => void archiveRecord(record)}
                      disabled={busy}
                      title="Archive"
                      className="rounded-lg border border-[#deded9] p-2 hover:bg-[#f8f8f5] disabled:opacity-50"
                    >
                      <Archive size={15} />
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#c94d1c]">
                  Record details
                </p>
                <h3 className="mt-1 text-xl font-extrabold">
                  {selected.reference}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close details"
                className="rounded-lg border p-2"
              >
                <X size={16} />
              </button>
            </div>

            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              {[
                ["Type", selected.recordType],
                ["Destination", selected.destination || "Not provided"],
                ["Travel dates", selected.travelDates || "Not provided"],
                ["Travellers", String(selected.travellers)],
                ["Amount", money(selected.amount, selected.currency)],
                ["Status", normalize(selected.status)],
                ["Payment", normalize(selected.paymentStatus)],
                ["Customer ID", selected.customerId || "Not linked"],
                ["Staff ID", selected.staffId || "Not recorded"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-[#f8f8f5] p-3">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[#92928b]">
                    {label}
                  </dt>
                  <dd className="mt-1 break-words text-sm font-semibold">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            {selected.notes && (
              <div className="mt-4 rounded-lg border p-3">
                <div className="text-xs font-bold">Notes / reason</div>
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {selected.notes}
                </p>
              </div>
            )}

            {selected.recordType === "offer" && (
              <div className="mt-6">
                <h4 className="flex items-center gap-2 font-bold">
                  <History size={16} />
                  Offer activity
                </h4>
                {history.length ? (
                  <div className="mt-3 space-y-3">
                    {history.map((event) => (
                      <div key={event.id} className="border-l-2 border-[#f26b35] pl-3">
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="text-sm font-bold">
                            {normalize(event.action)}
                          </span>
                          <span className="text-[10px] text-[#92928b]">
                            {dateLabel(event.created_at)}
                          </span>
                        </div>
                        {event.message && (
                          <p className="mt-1 text-xs text-[#77736c]">
                            {event.message}
                          </p>
                        )}
                        <p className="mt-1 text-[10px] text-[#92928b]">
                          Actor: {event.actor_type}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[#92928b]">
                    No offer events were found, or the current user cannot read
                    the event history.
                  </p>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg bg-[#222321] px-4 py-2.5 text-sm font-bold text-white"
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}

      {cancelling && !cancelling.archivedAt && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <section className="w-full max-w-lg rounded-t-2xl bg-white p-5 sm:rounded-2xl sm:p-7">
            <h3 className="text-xl font-extrabold">
              Cancel {cancelling.reference}
            </h3>
            <p className="mt-2 text-sm text-[#77736c]">
              Enter a reason. The cancellation will be recorded in the database.
              Any refund must be reviewed separately in Finance.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              rows={4}
              placeholder="Reason for cancellation…"
              className="mt-4 w-full rounded-lg border border-[#deded9] p-3 text-sm outline-none focus:border-[#f26b35]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setReason("");
                }}
                className="rounded-lg border px-4 py-2 text-sm font-bold"
              >
                Keep record
              </button>
              <button
                type="button"
                onClick={() => {
                  setCancelling(selected);
                  setReason("");
                  setError("");
                }}
                disabled={busy || reason.trim().length < 3}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {busy ? "Cancelling…" : "Confirm cancellation"}
              </button>
            </div>
          </section>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <form
            onSubmit={saveEdit}
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl sm:p-7"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#c94d1c]">
                  Edit offer
                </p>
                <h3 className="mt-1 text-xl font-extrabold">
                  {editing.reference}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Close edit form"
                className="rounded-lg border p-2"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block text-xs font-bold">
                Destination
                <input
                  name="destination"
                  required
                  maxLength={300}
                  defaultValue={editing.destination}
                  className="mt-1.5 w-full rounded-lg border p-3 text-sm font-normal"
                />
              </label>

              <label className="block text-xs font-bold">
                Travel dates
                <input
                  name="travelDates"
                  required
                  maxLength={300}
                  defaultValue={editing.travelDates}
                  className="mt-1.5 w-full rounded-lg border p-3 text-sm font-normal"
                />
              </label>

              <label className="block text-xs font-bold">
                Number of travellers
                <input
                  name="travellers"
                  type="number"
                  min={1}
                  max={100}
                  required
                  defaultValue={editing.travellers}
                  className="mt-1.5 w-full rounded-lg border p-3 text-sm font-normal"
                />
              </label>

              <label className="block text-xs font-bold">
                Total ({editing.currency})
                <input
                  name="total"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  defaultValue={editing.amount}
                  className="mt-1.5 w-full rounded-lg border p-3 text-sm font-normal"
                />
              </label>

              <label className="block text-xs font-bold">
                Notes
                <textarea
                  name="notes"
                  rows={3}
                  defaultValue={editing.notes}
                  className="mt-1.5 w-full rounded-lg border p-3 text-sm font-normal"
                />
              </label>
            </div>

            <div className="mt-6 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              Saving will increment the offer version and return it to awaiting
              customer response. Offers with payment records cannot be edited
              through this form.
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg border px-4 py-2.5 text-sm font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-[#f26b35] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save new offer version"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}