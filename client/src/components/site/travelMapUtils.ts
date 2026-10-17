
export type CoordinatePoint = {
  lat: number | null | undefined;
  lng: number | null | undefined;
};

/**
 * Returns true only when both coordinates are finite numbers
 * within valid latitude and longitude bounds.
 */
export function hasValidCoordinates(
  point: CoordinatePoint,
): boolean {
  return (
    typeof point.lat === "number" &&
    Number.isFinite(point.lat) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    typeof point.lng === "number" &&
    Number.isFinite(point.lng) &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

/**
 * Calculates the great-circle distance between two coordinates.
 * Returns kilometres, not road distance.
 */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const radians = (value: number) => (value * Math.PI) / 180;

  const latDelta = radians(b.lat - a.lat);
  const lngDelta = radians(b.lng - a.lng);

  const value =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(a.lat)) *
      Math.cos(radians(b.lat)) *
      Math.sin(lngDelta / 2) ** 2;

  const boundedValue = Math.min(1, Math.max(0, value));

  return (
    6371 *
    2 *
    Math.atan2(
      Math.sqrt(boundedValue),
      Math.sqrt(1 - boundedValue),
    )
  );
}
