
import { describe, expect, it } from "vitest";
import {
  hasValidCoordinates,
  haversineKm,
} from "../travelMapUtils";

describe("hasValidCoordinates", () => {
  it("accepts valid coordinates", () => {
    expect(hasValidCoordinates({ lat: 19.076, lng: 72.8777 })).toBe(true);
  });

  it("accepts coordinates at valid boundaries", () => {
    expect(hasValidCoordinates({ lat: -90, lng: -180 })).toBe(true);
    expect(hasValidCoordinates({ lat: 90, lng: 180 })).toBe(true);
  });

  it("rejects missing coordinates", () => {
    expect(hasValidCoordinates({ lat: null, lng: 72 })).toBe(false);
    expect(hasValidCoordinates({ lat: 19, lng: undefined })).toBe(false);
  });

  it("rejects out-of-range coordinates", () => {
    expect(hasValidCoordinates({ lat: 91, lng: 0 })).toBe(false);
    expect(hasValidCoordinates({ lat: 0, lng: 181 })).toBe(false);
    expect(hasValidCoordinates({ lat: -91, lng: 0 })).toBe(false);
    expect(hasValidCoordinates({ lat: 0, lng: -181 })).toBe(false);
  });

  it("rejects NaN and infinite values", () => {
    expect(hasValidCoordinates({ lat: NaN, lng: 0 })).toBe(false);
    expect(hasValidCoordinates({ lat: 0, lng: Infinity })).toBe(false);
  });
});

describe("haversineKm", () => {
  it("returns zero for the same location", () => {
    expect(
      haversineKm(
        { lat: 19.076, lng: 72.8777 },
        { lat: 19.076, lng: 72.8777 },
      ),
    ).toBe(0);
  });

  it("calculates a reasonable distance between Mumbai and Pune", () => {
    const distance = haversineKm(
      { lat: 19.076, lng: 72.8777 },
      { lat: 18.5204, lng: 73.8567 },
    );

    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(160);
  });

  it("returns a positive distance for different locations", () => {
    expect(
      haversineKm(
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ),
    ).toBeGreaterThan(0);
  });
});
