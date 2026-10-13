import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { convertFromInr, getMinorUnitAmount } from "./currency";

const authorizationMocks = vi.hoisted(() => ({
  hasDatabaseWorkspacePermission: vi.fn(),
  hasDatabasePermission: vi.fn(),
  hasGlobalDatabasePermission: vi.fn(),
}));

vi.mock("./_core/workspaceAuthorization", () => ({
  ...authorizationMocks,
}));

type TestRole =
  | "user"
  | "owner"
  | "admin"
  | "manager"
  | "marketing"
  | "counsellor";

const roleFromToken = (
  token: string | null | undefined,
): TestRole | null => {
  const match = token?.match(/^test-role:(.+)$/);
  return (match?.[1] as TestRole | undefined) ?? null;
};

beforeEach(() => {
  vi.clearAllMocks();

  authorizationMocks.hasDatabaseWorkspacePermission
    .mockImplementation(async (token, permission) => {
      const role = roleFromToken(token);

      if (role === "owner" || role === "admin") {
        return true;
      }

      if (role === "marketing") {
        return ["overview", "catalogue"].includes(permission);
      }

      if (role === "counsellor") {
        return permission === "quotes";
      }

      if (role === "manager") {
        return ["finance", "enquiries"].includes(permission);
      }

      return false;
    });

  authorizationMocks.hasDatabasePermission
    .mockImplementation(async (token, permissions) => {
      const role = roleFromToken(token);

      return (
        (role === "owner" || role === "admin") &&
        permissions.includes("roles.manage")
      );
    });

  authorizationMocks.hasGlobalDatabasePermission
    .mockImplementation(async (token, permissions) => {
      const role = roleFromToken(token);

      if (role === "owner" || role === "admin") {
        return true;
      }

      if (role === "marketing") {
        return permissions.includes("admin.dashboard.read");
      }

      if (role === "counsellor") {
        return permissions.includes("bookings.read");
      }

      return false;
    });
});

type TestUser = NonNullable<TrpcContext["user"]>;
function context(role: TestUser["role"]): TrpcContext {
  const now = new Date();
  const user: TestUser = { id: 42, openId: "aerofly-test", email: "test@example.com", name: "Test Traveller", loginMethod: "test", role, createdAt: now, updatedAt: now, lastSignedIn: now };
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"],supabaseAccessToken: `test-role:${role}`, };
}

describe("AeroFly business guardrails", () => {
  it("blocks non-admin users from the operations overview", async () => {
    const caller = appRouter.createCaller(context("user"));
    await expect(caller.admin.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.admin.catalogue.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects incomplete enquiry requests before database work", async () => {
    const caller = appRouter.createCaller(context("user"));
    await expect(caller.enquiries.create({ name: "A", email: "not-an-email", phone: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects unsafe tour slugs before an admin mutation reaches the database", async () => {
    const caller = appRouter.createCaller(context("admin"));
    await expect(caller.admin.catalogue.createTour({
      slug: "Dubai City Lights",
      title: "Dubai City Lights",
      destinationId: 1,
      categoryId: 1,
      durationDays: 5,
      durationNights: 4,
      priceFrom: 64900,
      overview: "A considered Dubai itinerary balancing iconic city moments with space to discover the city at your own pace.",
      imageUrl: "https://example.com/dubai.jpg",
      status: "draft",
      featured: false,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects empty AI trip prompts before invoking the model", async () => {
    const caller = appRouter.createCaller(context("user"));
    await expect(caller.ai.tripPlanner({ message: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lets legacy admin accounts retain owner-level catalogue access", async () => {
    const caller = appRouter.createCaller(context("admin"));
    await expect(caller.admin.catalogue.list()).resolves.toBeDefined();
  });

  it("keeps marketing focused on its own workspace scope", async () => {
    const caller = appRouter.createCaller(context("marketing"));
    await expect(caller.admin.overview()).resolves.toBeDefined();
    await expect(caller.admin.catalogue.list()).resolves.toBeDefined();
    await expect(caller.admin.team.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("prevents counsellors from changing catalogue data", async () => {
    const caller = appRouter.createCaller(context("counsellor"));
    await expect(caller.admin.catalogue.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("prevents an owner from changing roles through the legacy endpoint", async () => {
  const caller = appRouter.createCaller(context("owner"));

  await expect(
    caller.admin.team.updateRole({
      id: 42,
      role: "staff",
    }),
  ).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
});

  it("lets counsellors work the sales pipeline but blocks finance controls", async () => {
    const caller = appRouter.createCaller(context("counsellor"));
    await expect(caller.admin.sales.dashboard()).resolves.toBeDefined();
    await expect(caller.admin.finance.dashboard()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires every payment to be linked to a booking or quotation", async () => {
    const caller = appRouter.createCaller(context("manager"));
    await expect(caller.admin.finance.recordPayment({ amount: 1000, method: "upi" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects invalid customer checkout references before starting Stripe", async () => {
    const caller = appRouter.createCaller(context("user"));
    await expect(caller.customer.createCheckout({ quotationId: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("converts INR amounts with correct minor-unit handling", () => {
    expect(convertFromInr(10000, "USD", 0.012)).toBe(120);
    expect(convertFromInr(10000, "JPY", 1.65)).toBe(16500);
    expect(getMinorUnitAmount(120, "USD")).toBe(12000);
    expect(getMinorUnitAmount(16500, "JPY")).toBe(16500);
  });

  it("rejects malformed requested checkout currencies before Stripe", async () => {
    const caller = appRouter.createCaller(context("user"));
    await expect(caller.customer.createCheckout({ quotationId: 1, requestedCurrency: "US" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("keeps refund controls behind the finance permission", async () => {
    const caller = appRouter.createCaller(context("counsellor"));
    await expect(caller.admin.finance.refundPayment({ paymentId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps monthly Stripe revenue reports behind the finance permission", async () => {
    const caller = appRouter.createCaller(context("counsellor"));
    await expect(caller.admin.finance.monthlyStripeRevenue({ year: 2026, month: 9 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects invalid monthly report periods before querying the ledger", async () => {
    const caller = appRouter.createCaller(context("manager"));
    await expect(caller.admin.finance.monthlyStripeRevenue({ year: 2026, month: 13 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects incomplete callback requests before database work", async () => {
    const caller = appRouter.createCaller(context("user"));
    await expect(caller.callback.request({ name: "A", email: "bad", phone: "",reason: "Test callback request", })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects incomplete appointment requests before database work", async () => {
    const caller = appRouter.createCaller(context("user"));
    await expect(caller.appointment.book({ name: "Test Traveller", email: "test@example.com", phone: "+919999999999", mode: "phone", purpose: "Trip planning" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("keeps customer-care queue management behind the enquiries permission", async () => {
    const counsellor = appRouter.createCaller(context("counsellor"));
    await expect(counsellor.admin.support.dashboard()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const manager = appRouter.createCaller(context("manager"));
    await expect(manager.admin.support.dashboard()).resolves.toBeDefined();
  });
});
