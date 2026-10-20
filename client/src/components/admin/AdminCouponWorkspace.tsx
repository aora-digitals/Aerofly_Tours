
import { useState } from "react";
import {
  BadgePercent,
  Check,
  Edit3,
  LoaderCircle,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Coupon = {
  id: number;
  code: string;
  description?: string | null;
  discount_type: "percent" | "fixed";
  discount_value: number | string;
  max_discount?: number | string | null;
  min_subtotal: number | string;
  starts_at: string;
  expires_at?: string | null;
  usage_limit?: number | null;
  per_customer_limit: number;
  usage_count: number;
  is_active: boolean;
};

type FormState = {
  id?: number;
  code: string;
  description: string;
  discountType: "percent" | "fixed";
  discountValue: string;
  maxDiscount: string;
  minSubtotal: string;
  startsAt: string;
  expiresAt: string;
  usageLimit: string;
  perCustomerLimit: string;
  isActive: boolean;
};

const blankForm = (): FormState => ({
  code: "",
  description: "",
  discountType: "percent",
  discountValue: "10",
  maxDiscount: "",
  minSubtotal: "0",
  startsAt: new Date(
    Date.now() - new Date().getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 16),
  expiresAt: "",
  usageLimit: "",
  perCustomerLimit: "1",
  isActive: true,
});

const money = (value: number | string) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const localInput = (value?: string | null) =>
  value
    ? new Date(
        new Date(value).getTime() -
          new Date(value).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "";

export default function AdminCouponWorkspace() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<FormState>(blankForm());
  const [editing, setEditing] = useState(false);

  const coupons = trpc.admin.coupons.list.useQuery(
    undefined,
    { retry: 1 },
  );

  const save = trpc.admin.coupons.save.useMutation({
    onSuccess: async () => {
      await utils.admin.coupons.list.invalidate();
      toast.success("Coupon saved successfully.");
      setForm(blankForm());
      setEditing(false);
    },
    onError: (error) => {
      toast.error(error.message || "Unable to save coupon.");
    },
  });

  const toggle = trpc.admin.coupons.setActive.useMutation({
    onSuccess: async () => {
      await utils.admin.coupons.list.invalidate();
      toast.success("Coupon status updated.");
    },
    onError: (error) => {
      toast.error(error.message || "Unable to update coupon.");
    },
  });

  const set = <K extends keyof FormState>(
    key: K,
    value: FormState[K],
  ) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const edit = (coupon: Coupon) => {
    setForm({
      id: coupon.id,
      code: coupon.code,
      description: coupon.description ?? "",
      discountType: coupon.discount_type,
      discountValue: String(coupon.discount_value),
      maxDiscount:
        coupon.max_discount == null
          ? ""
          : String(coupon.max_discount),
      minSubtotal: String(coupon.min_subtotal),
      startsAt: localInput(coupon.starts_at),
      expiresAt: localInput(coupon.expires_at),
      usageLimit:
        coupon.usage_limit == null
          ? ""
          : String(coupon.usage_limit),
      perCustomerLimit: String(coupon.per_customer_limit),
      isActive: coupon.is_active,
    });

    setEditing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    save.mutate({
      id: form.id,
      code: form.code.trim().toUpperCase(),
      description: form.description || undefined,
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      maxDiscount:
        form.maxDiscount === ""
          ? undefined
          : Number(form.maxDiscount),
      minSubtotal: Number(form.minSubtotal),
      startsAt: new Date(form.startsAt).toISOString(),
      expiresAt: form.expiresAt
        ? new Date(form.expiresAt).toISOString()
        : undefined,
      usageLimit:
        form.usageLimit === ""
          ? undefined
          : Number(form.usageLimit),
      perCustomerLimit: Number(form.perCustomerLimit),
      isActive: form.isActive,
    });
  };

  return (
    <div className="space-y-6 text-[#25231f]">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-orange-700">
            Promotions
          </p>
          <h2 className="mt-1 text-2xl font-extrabold">
            Coupon management
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
            Create controlled discount codes for direct customer
            bookings. Coupons are validated server-side and cannot
            change staff-issued quotations.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void coupons.refetch()}
          className="inline-flex items-center gap-2 self-start rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold"
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>

      <form
        onSubmit={submit}
        className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <div className="mb-4 flex items-center gap-2">
          <BadgePercent className="text-orange-700" />
          <h3 className="font-bold">
            {editing ? `Edit ${form.code}` : "Create a coupon"}
          </h3>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs font-bold text-neutral-600">
            Coupon code *
            <input
              required
              minLength={3}
              maxLength={40}
              pattern="[A-Za-z0-9_-]+"
              value={form.code}
              onChange={(event) =>
                set("code", event.target.value.toUpperCase())
              }
              placeholder="AERO10"
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm font-medium uppercase"
            />
          </label>

          <label className="text-xs font-bold text-neutral-600">
            Discount type
            <select
              value={form.discountType}
              onChange={(event) =>
                set(
                  "discountType",
                  event.target.value as FormState["discountType"],
                )
              }
              className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm"
            >
              <option value="percent">Percentage (%)</option>
              <option value="fixed">Fixed amount (₹)</option>
            </select>
          </label>

          <label className="text-xs font-bold text-neutral-600">
            Discount value *
            <input
              required
              type="number"
              min="0.01"
              max={form.discountType === "percent" ? 100 : undefined}
              step="0.01"
              value={form.discountValue}
              onChange={(event) =>
                set("discountValue", event.target.value)
              }
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
            />
          </label>

          <label className="text-xs font-bold text-neutral-600">
            Maximum discount (₹)
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.maxDiscount}
              onChange={(event) =>
                set("maxDiscount", event.target.value)
              }
              placeholder="No cap"
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
            />
          </label>

          <label className="text-xs font-bold text-neutral-600">
            Minimum booking subtotal (₹)
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={form.minSubtotal}
              onChange={(event) =>
                set("minSubtotal", event.target.value)
              }
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
            />
          </label>

          <label className="text-xs font-bold text-neutral-600">
            Total redemption limit
            <input
              type="number"
              min="1"
              step="1"
              value={form.usageLimit}
              onChange={(event) =>
                set("usageLimit", event.target.value)
              }
              placeholder="Unlimited"
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
            />
          </label>

          <label className="text-xs font-bold text-neutral-600">
            Uses per customer *
            <input
              required
              type="number"
              min="1"
              max="100"
              step="1"
              value={form.perCustomerLimit}
              onChange={(event) =>
                set("perCustomerLimit", event.target.value)
              }
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
            />
          </label>

          <label className="text-xs font-bold text-neutral-600">
            Starts at *
            <input
              required
              type="datetime-local"
              value={form.startsAt}
              onChange={(event) =>
                set("startsAt", event.target.value)
              }
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
            />
          </label>

          <label className="text-xs font-bold text-neutral-600">
            Expires at
            <input
              type="datetime-local"
              value={form.expiresAt}
              onChange={(event) =>
                set("expiresAt", event.target.value)
              }
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
            />
          </label>

          <label className="text-xs font-bold text-neutral-600 sm:col-span-2 lg:col-span-3">
            Description
            <input
              maxLength={500}
              value={form.description}
              onChange={(event) =>
                set("description", event.target.value)
              }
              placeholder="For example: festive season discount for direct bookings"
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm font-normal"
            />
          </label>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) =>
              set("isActive", event.target.checked)
            }
            className="accent-orange-700"
          />
          Active and available to customers
        </label>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            disabled={save.isPending}
            className="inline-flex items-center gap-2 rounded-full bg-orange-700 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {save.isPending ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Check size={16} />
            )}
            {editing ? "Save changes" : "Create coupon"}
          </button>

          {editing && (
            <button
              type="button"
              onClick={() => {
                setForm(blankForm());
                setEditing(false);
              }}
              className="rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-semibold"
            >
              Cancel edit
            </button>
          )}
        </div>
      </form>

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-100 px-5 py-4">
          <h3 className="font-bold">Existing coupons</h3>
          <p className="mt-1 text-xs text-neutral-500">
            Redemption count and activation status update from the database.
          </p>
        </div>

        {coupons.isLoading ? (
          <div className="p-6 text-sm text-neutral-500">
            Loading coupons…
          </div>
        ) : coupons.isError ? (
          <div className="p-6 text-sm text-red-700">
            Could not load coupons. Confirm your account has owner/admin
            access and the migration has been applied.
          </div>
        ) : (coupons.data ?? []).length === 0 ? (
          <div className="p-8 text-center text-sm text-neutral-500">
            No coupons created yet.
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {(coupons.data as Coupon[]).map((coupon) => (
              <div
                key={coupon.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-lg bg-orange-50 px-3 py-1 font-mono text-sm font-extrabold text-orange-800">
                      {coupon.code}
                    </span>

                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                        coupon.is_active
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {coupon.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>

                  <p className="mt-2 text-sm font-semibold">
                    {coupon.discount_type === "percent"
                      ? `${Number(coupon.discount_value)}% off`
                      : `${money(coupon.discount_value)} off`}
                    {coupon.max_discount != null
                      ? ` · max ${money(coupon.max_discount)}`
                      : ""}
                    {" · "}
                    min spend {money(coupon.min_subtotal)}
                  </p>

                  <p className="mt-1 text-xs text-neutral-500">
                    Used {coupon.usage_count}
                    {coupon.usage_limit == null
                      ? " times"
                      : ` / ${coupon.usage_limit}`}
                    {" · "}
                    {coupon.expires_at
                      ? `Expires ${new Date(coupon.expires_at).toLocaleString()}`
                      : "No expiry"}
                    {coupon.description
                      ? ` · ${coupon.description}`
                      : ""}
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => edit(coupon)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-2 text-xs font-bold"
                  >
                    <Edit3 size={14} />
                    Edit
                  </button>

                  <button
                    type="button"
                    disabled={toggle.isPending}
                    onClick={() =>
                      toggle.mutate({
                        id: coupon.id,
                        isActive: !coupon.is_active,
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-2 text-xs font-bold"
                  >
                    {coupon.is_active ? (
                      <ToggleRight size={15} />
                    ) : (
                      <ToggleLeft size={15} />
                    )}
                    {coupon.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
