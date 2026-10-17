import { describe, expect, it } from "vitest";
import {
  getMinorUnitAmount,
  resolvePayableCurrency,
} from "./currency";

describe("Accepted proposal currency invariants", () => {
  it("does not change an INR proposal when USD is selected for display", () => {
    expect(resolvePayableCurrency("INR", "USD")).toMatchObject({
      currency: "INR",
    });
  });

  it("preserves an accepted EUR proposal", () => {
    expect(resolvePayableCurrency("EUR", "INR").currency).toBe("EUR");
  });

  it("converts decimal amounts into minor units", () => {
    expect(getMinorUnitAmount("1234.56", "INR")).toBe(123456);
    expect(getMinorUnitAmount("1234.565", "USD")).toBe(123457);
    expect(getMinorUnitAmount("16500", "JPY")).toBe(16500);
  });

  it("rejects unsupported online payment currencies", () => {
    expect(() =>
      resolvePayableCurrency("THB", "INR"),
    ).toThrow(/Staff must review and reissue/);
  });
});