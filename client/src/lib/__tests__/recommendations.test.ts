import { describe, expect, it } from "vitest";
import { scoreTours } from "../recommendation-scoring";

const tours = [
  {
    id: 1,
    slug: "kerala-family",
    title: "Kerala Family Escape",
    destination: "Kerala",
    country: "India",
    durationDays: 6,
    priceFrom: 35000,
    rating: 4.8,
    reviewCount: 50,
    featured: false,
    status: "published",
    availability: "On request",
    category: "Family",
    tags: ["nature", "family"],
    kind: "domestic",
  },
  {
    id: 2,
    slug: "japan-culture",
    title: "Japan Culture Trail",
    destination: "Japan",
    country: "Japan",
    durationDays: 8,
    priceFrom: 180000,
    rating: 4.9,
    reviewCount: 80,
    featured: true,
    status: "published",
    availability: "On request",
    category: "Culture",
    tags: ["culture", "food"],
    kind: "international",
  },
  {
    id: 3,
    slug: "sold-out",
    title: "Sold Out Escape",
    destination: "Kerala",
    country: "India",
    durationDays: 5,
    priceFrom: 20000,
    rating: 4.7,
    reviewCount: 20,
    status: "published",
    availability: "Sold out",
    category: "Family",
    kind: "domestic",
  },
  {
    id: 4,
    slug: "draft",
    title: "Draft Tour",
    destination: "Kerala",
    country: "India",
    durationDays: 5,
    priceFrom: 20000,
    rating: 4.7,
    reviewCount: 20,
    status: "draft",
    category: "Family",
    kind: "domestic",
  },
];

describe("scoreTours", () => {
  it("ranks destination, interests, and budget matches higher", () => {
    const ranked = scoreTours(tours, {
      personalization_enabled: true,
      preferred_destinations: ["Kerala"],
      interests: ["family"],
      travel_styles: [],
      budget_min: 20000,
      budget_max: 50000,
      travel_scope: "domestic",
    });

    expect(ranked[0]?.tour.id).toBe(1);

    expect(ranked[0]?.reasons.join(" ")).toContain(
      "preferred destinations",
    );
  });

  it("excludes unpublished, unavailable, and dismissed tours", () => {
    const ranked = scoreTours(
      tours,
      { personalization_enabled: true },
      {
        dismissedIds: [1],
        limit: 10,
      },
    );

    expect(
      ranked.map((item) => item.tour.id),
    ).toEqual([2]);
  });

  it("provides a fallback ranking when personalization is disabled", () => {
    const ranked = scoreTours(tours, null, {
      limit: 10,
    });

    expect(ranked.length).toBe(2);

    expect(
      ranked.every(
        (item) => item.reasons.length > 0,
      ),
    ).toBe(true);
  });
});