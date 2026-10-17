import { describe, expect, it } from "vitest";
import {
  formatMoney,
  convertIndicativeFromInr,
  isSupportedCurrency,
} from "../currency";
import {
  resolveTranslatedField,
  translate,
} from "../../i18n/translations";
import { filterToursByKind } from "../tourClassification";

describe("Phase 14 localization and currency", () => {
  it("provides English and Marathi UI labels", () => {
    expect(translate("en", "nav_india")).toBe("India Tours");
    expect(translate("mr", "nav_india")).toBe("भारत सहली");
  });

  it("falls back to English for draft translations", () => {
    expect(
      resolveTranslatedField(
        "mr",
        "Kerala Family Tour",
        "केरळ सहल",
        "draft",
      ),
    ).toEqual({
      value: "Kerala Family Tour",
      usedFallback: true,
    });
  });

  it("uses published translations", () => {
    expect(
      resolveTranslatedField(
        "mr",
        "Kerala Family Tour",
        "केरळ सहल",
        "published",
      ),
    ).toEqual({
      value: "केरळ सहल",
      usedFallback: false,
    });
  });

  it("requires review metadata for sensitive content", () => {
    expect(
      resolveTranslatedField(
        "mr",
        "Visa information",
        "मसुदा व्हिसा मजकूर",
        "published",
        true,
      ).usedFallback,
    ).toBe(true);
  });

  it("formats INR and converts indicative amounts", () => {
    expect(formatMoney(1234.5, "INR")).toContain("1,234.50");
    expect(convertIndicativeFromInr(100, 0.012, "USD")).toBe(1.2);
    expect(convertIndicativeFromInr(100, 0.65, "JPY")).toBe(65);
  });

  it("rejects unsupported currencies", () => {
    expect(isSupportedCurrency("EUR")).toBe(true);
    expect(isSupportedCurrency("XYZ")).toBe(false);
    expect(() => formatMoney(10, "XYZ")).toThrow();
  });

  it("filters tours independently of language and currency", () => {
    const tours = [
      { id: 1, tour_kind: "domestic", status: "published" },
      { id: 2, tour_kind: "international", status: "published" },
      { id: 3, tour_kind: "international", status: "draft" },
    ];

    expect(
      filterToursByKind(tours, "domestic").map((t) => t.id),
    ).toEqual([1]);

    expect(
      filterToursByKind(tours, "international").map((t) => t.id),
    ).toEqual([2]);
  });
});