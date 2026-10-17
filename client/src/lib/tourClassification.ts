export type TourKind = "domestic" | "international";

export function normalizeTourKind(
  value: unknown,
): TourKind {
  return String(value ?? "").toLowerCase() ===
    "international"
    ? "international"
    : "domestic";
}

export function filterToursByKind<
  T extends {
    tour_kind?: string | null;
    tourKind?: string | null;
    kind?: string | null;
    status?: string | null;
  },
>(
  tours: T[],
  kind: TourKind | "all",
): T[] {
  return tours.filter((tour) => {
    const status = String(
      tour.status ?? "published",
    ).toLowerCase();

    if (
      status !== "published" &&
      status !== "active"
    ) {
      return false;
    }

    return (
      kind === "all" ||
      normalizeTourKind(
        tour.tour_kind ??
          tour.tourKind ??
          tour.kind,
      ) === kind
    );
  });
}