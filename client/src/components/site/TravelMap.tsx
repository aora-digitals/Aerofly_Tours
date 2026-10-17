
import { useCallback, useEffect, useMemo, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  AlertCircle,
  ExternalLink,
  Eye,
  MapPin,
  Navigation,
  Route,
  Search,
} from "lucide-react";

import {
  hasValidCoordinates,
  haversineKm,
} from "./travelMapUtils";

export {
  hasValidCoordinates,
  haversineKm,
} from "./travelMapUtils";

export type MapPoint = {
  id: string | number;
  name: string;
  lat: number | null | undefined;
  lng: number | null | undefined;
  type?:
    | "destination"
    | "attraction"
    | "hotel"
    | "airport"
    | "transport_hub"
    | "itinerary"
    | "other";
  description?: string | null;
  imageUrl?: string | null;
  href?: string;
  day?: number | null;
  country?: string | null;
  source?: string | null;
  visible?: boolean;
};

type TravelMode = "driving" | "walking" | "bicycling" | "transit";

type ValidMapPoint = MapPoint & {
  lat: number;
  lng: number;
};

type TravelMapProps = {
  points: MapPoint[];
  title?: string;
  category?: string;
  onCategoryChange?: (category: string) => void;
  showRoute?: boolean;
  showStreetView?: boolean;
  height?: number;
};

type RouteResult = {
  distance: number;
  duration: number;
  geometry: {
    coordinates: [number, number][];
  };
};

const DEFAULT_CENTER: L.LatLngExpression = [20.5937, 78.9629];

const OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving";

const typeLabels: Record<string, string> = {
  destination: "Destination",
  attraction: "Attraction",
  hotel: "Hotel",
  airport: "Airport",
  transport_hub: "Transport hub",
  itinerary: "Itinerary stop",
  other: "Place",
};


function isValidMapPoint(point: MapPoint): point is ValidMapPoint {
  return hasValidCoordinates(point);
}


function createMarkerIcon(
  type: MapPoint["type"],
  selected = false,
): L.DivIcon {
  const label =
    type === "airport"
      ? "✈"
      : type === "hotel"
        ? "H"
        : type === "transport_hub"
          ? "T"
          : type === "attraction"
            ? "A"
            : "•";

  const background = selected ? "#ea580c" : "#c94d1c";

  return L.divIcon({
    className: "aerofly-leaflet-marker",
    html: `<span style="
      display:flex;
      align-items:center;
      justify-content:center;
      width:30px;
      height:30px;
      border:2px solid #fff;
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:${background};
      color:#fff;
      font-weight:800;
      font-size:14px;
      box-shadow:0 2px 6px #0004;
    "><span style="transform:rotate(45deg)">${label}</span></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  });
}

function createClusterIcon(count: number): L.DivIcon {
  return L.divIcon({
    className: "aerofly-leaflet-cluster",
    html: `<span style="
      display:flex;
      width:36px;
      height:36px;
      align-items:center;
      justify-content:center;
      border:3px solid white;
      border-radius:50%;
      background:#c94d1c;
      color:white;
      font-size:13px;
      font-weight:800;
      box-shadow:0 2px 7px #0004;
    ">${count}</span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

/**
 * Fits the map when the filtered location set changes.
 * A normal marker/list selection will not reset the user's zoom.
 */
function MapAutoFit({
  points,
  fitKey,
}: {
  points: ValidMapPoint[];
  fitKey: string;
}) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;

    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 13);
      return;
    }

    const bounds = L.latLngBounds(
      points.map((point) => [point.lat, point.lng] as L.LatLngTuple),
    );

    map.fitBounds(bounds, {
      padding: [32, 32],
      maxZoom: 13,
    });
  }, [map, fitKey]); // fitKey represents the filtered location set

  return null;
}

/**
 * Tracks zoom for marker clustering.
 */
function MapZoomTracker({
  onZoomChange,
}: {
  onZoomChange: (zoom: number) => void;
}) {
  const map = useMapEvents({
    zoomend() {
      onZoomChange(map.getZoom());
    },
  });

  useEffect(() => {
    onZoomChange(map.getZoom());
  }, [map, onZoomChange]);

  return null;
}

/**
 * Moves the map when the user selects a location from the list.
 */
function MapSelectionController({
  point,
}: {
  point: ValidMapPoint | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!point) return;

    map.flyTo(
      [point.lat, point.lng],
      Math.max(map.getZoom(), 12),
      { duration: 0.45 },
    );
  }, [map, point?.id, point?.lat, point?.lng]);

  return null;
}

/**
 * Renders individual markers or simple grid-based clusters.
 * This avoids adding another clustering dependency.
 */
function MapMarkers({
  points,
  zoom,
  selectedId,
  onSelect,
}: {
  points: ValidMapPoint[];
  zoom: number;
  selectedId: string | number | null;
  onSelect: (point: ValidMapPoint) => void;
}) {
  const map = useMap();

  const groups = useMemo(() => {
    const grid =
      points.length > 35
        ? zoom < 5
          ? 2
          : zoom < 8
            ? 0.5
            : zoom < 11
              ? 0.08
              : 0
        : 0;

    const grouped = new Map<string, ValidMapPoint[]>();

    points.forEach((point) => {
      const key =
        grid > 0
          ? `${Math.round(point.lat / grid)}:${Math.round(point.lng / grid)}`
          : String(point.id);

      const current = grouped.get(key) ?? [];
      current.push(point);
      grouped.set(key, current);
    });

    return Array.from(grouped.entries()).map(([key, group]) => {
      const lat =
        group.reduce((sum, point) => sum + point.lat, 0) / group.length;
      const lng =
        group.reduce((sum, point) => sum + point.lng, 0) / group.length;

      return {
        key,
        points: group,
        position: [lat, lng] as L.LatLngTuple,
        isCluster: group.length > 1,
      };
    });
  }, [points, zoom]);

  return (
    <>
      {groups.map((group) => {
        if (group.isCluster) {
          return (
            <Marker
              key={group.key}
              position={group.position}
              icon={createClusterIcon(group.points.length)}
              title={`${group.points.length} locations — zoom in`}
              eventHandlers={{
                click: () => {
                  const bounds = L.latLngBounds(
                    group.points.map(
                      (point) => [point.lat, point.lng] as L.LatLngTuple,
                    ),
                  );

                  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
                },
              }}
            >
              <Popup>
                <strong>{group.points.length} locations</strong>
                <p>Zoom in to explore individual locations.</p>
              </Popup>
            </Marker>
          );
        }

        const point = group.points[0];

        return (
          <Marker
            key={String(point.id)}
            position={[point.lat, point.lng]}
            icon={createMarkerIcon(point.type, selectedId === point.id)}
            eventHandlers={{
              click: () => {
                onSelect(point);
                map.panTo([point.lat, point.lng]);
              },
            }}
          >
            <Popup>
              <div className="max-w-56 space-y-1">
                <strong>{point.name}</strong>
                <div>{typeLabels[point.type ?? "other"]}</div>
                {point.country && <div>{point.country}</div>}
                {point.day != null && <div>Day {point.day}</div>}
                {point.description && <p>{point.description}</p>}
                {point.href && (
                  <a
                    href={point.href}
                    className="text-orange-700 underline"
                  >
                    Open details
                  </a>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

function formatDistance(metres: number): string {
  return metres >= 1000
    ? `${(metres / 1000).toFixed(1)} km`
    : `${Math.round(metres)} m`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);

  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes
    ? `${hours} hr ${remainingMinutes} min`
    : `${hours} hr`;
}

export default function TravelMap({
  points,
  title = "Explore on the map",
  category = "all",
  onCategoryChange,
  showRoute = false,
  showStreetView = true,
  height = 430,
}: TravelMapProps) {
  const [mapZoom, setMapZoom] = useState(5);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<TravelMode>("driving");

  const [routeMessage, setRouteMessage] = useState("");
  const [routeInfo, setRouteInfo] = useState<{
    distance: string;
    duration: string;
  } | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<L.LatLngExpression[]>(
    [],
  );
  const [routeLoading, setRouteLoading] = useState(false);

  const [streetViewOpen, setStreetViewOpen] = useState(false);

  const visiblePoints = useMemo(
    () => points.filter((point) => point.visible !== false),
    [points],
  );

  const validPoints = useMemo(
    () => visiblePoints.filter(isValidMapPoint),
    [visiblePoints],
  );

  const allFilteredPoints = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return visiblePoints
      .filter((point) => {
        const searchableText = [
          point.name,
          point.country ?? "",
          point.description ?? "",
          typeLabels[point.type ?? "other"],
        ]
          .join(" ")
          .toLowerCase();

        return (
          searchableText.includes(normalizedQuery) &&
          (category === "all" || point.type === category)
        );
      })
      .slice(0, 300);
  }, [visiblePoints, query, category]);

  const filteredPoints = useMemo(
    () => allFilteredPoints.filter(isValidMapPoint).slice(0, 150),
    [allFilteredPoints],
  );

  const selected =
    allFilteredPoints.find((point) => point.id === selectedId) ??
    allFilteredPoints[0] ??
    null;

  const selectedValidPoint =
    selected && isValidMapPoint(selected) ? selected : null;

  const fitKey = useMemo(
    () => filteredPoints.map((point) => String(point.id)).join("|"),
    [filteredPoints],
  );

  const handleZoomChange = useCallback((zoom: number) => {
    setMapZoom(zoom);
  }, []);

  const selectPoint = useCallback((point: MapPoint) => {
    setSelectedId(point.id);
    setStreetViewOpen(false);
  }, []);

  useEffect(() => {
    // A previous route must not remain displayed after filters change.
    setRouteGeometry([]);
    setRouteInfo(null);
    setRouteMessage("");
  }, [fitKey, mode]);

  async function plotRoute() {
    if (filteredPoints.length < 2) {
      setRouteMessage(
        "At least two stops with valid coordinates are required.",
      );
      return;
    }

    if (mode !== "driving") {
      setRouteMessage(
        "The configured free OSRM endpoint supports driving routes only. " +
          "Walking, cycling and transit routing require a separate routing provider.",
      );
      return;
    }

    const routeStops = filteredPoints.slice(0, 10);

    setRouteLoading(true);
    setRouteMessage("Requesting a driving route…");
    setRouteInfo(null);
    setRouteGeometry([]);

    const controller = new AbortController();

    try {
      // OSRM requires longitude,latitude pairs.
      const coordinates = routeStops
        .map((point) => `${point.lng},${point.lat}`)
        .join(";");

      const url = new URL(
        `${OSRM_ROUTE_URL}/${coordinates}`,
      );

      url.searchParams.set("overview", "full");
      url.searchParams.set("geometries", "geojson");
      url.searchParams.set("steps", "false");

      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Routing service returned HTTP ${response.status}.`);
      }

      const data: {
        code?: string;
        message?: string;
        routes?: RouteResult[];
      } = await response.json();

      const route = data.routes?.[0];

      if (data.code !== "Ok" || !route?.geometry?.coordinates?.length) {
        throw new Error(
          data.message || "No driving route was returned for these stops.",
        );
      }

      // GeoJSON coordinates are [longitude, latitude].
      setRouteGeometry(
        route.geometry.coordinates.map(
          ([longitude, latitude]) =>
            [latitude, longitude] as L.LatLngExpression,
        ),
      );

      setRouteInfo({
        distance: formatDistance(route.distance),
        duration: formatDuration(route.duration),
      });

      setRouteMessage(
        "Distance and duration are estimates returned by the routing service. " +
          "Actual travel times may vary." +
          (filteredPoints.length > routeStops.length
            ? " The route uses the first 10 mapped stops."
            : ""),
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;

      setRouteGeometry([]);
      setRouteInfo(null);
      setRouteMessage(
        error instanceof Error
          ? error.message
          : "Unable to calculate this route. Try again later.",
      );
    } finally {
      setRouteLoading(false);
    }
  }

  function openStreetLevelView() {
    if (!selectedValidPoint) return;

    const url = new URL("https://www.mapillary.com/app/");
    url.searchParams.set("lat", String(selectedValidPoint.lat));
    url.searchParams.set("lng", String(selectedValidPoint.lng));
    url.searchParams.set("z", "17");

    window.open(url.toString(), "_blank", "noopener,noreferrer");
    setStreetViewOpen(true);
  }

  function openDirections() {
    if (!selectedValidPoint) return;

    const url = new URL("https://www.openstreetmap.org/");
    url.searchParams.set("mlat", String(selectedValidPoint.lat));
    url.searchParams.set("mlon", String(selectedValidPoint.lng));
    url.hash =
      `map=16/${selectedValidPoint.lat}/${selectedValidPoint.lng}`;

    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }

  const nearestPoint = useMemo(() => {
    if (!selectedValidPoint) return null;

    return validPoints
      .filter((point) => point.id !== selectedValidPoint.id)
      .map((point) => ({
        point,
        distance: haversineKm(selectedValidPoint, point),
      }))
      .sort((a, b) => a.distance - b.distance)[0] ?? null;
  }, [selectedValidPoint, validPoints]);

  return (
    <section
      className="rounded-2xl border border-[#e8e4dd] bg-white p-4 sm:p-5"
      aria-label={title}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Destination tools</div>
          <h2 className="mt-1 font-['Manrope'] text-xl font-extrabold">
            {title}
          </h2>
          <p className="mt-1 text-xs text-[#77736c]">
            Only locations with valid coordinates are plotted. Locations
            without coordinates remain available in the list.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="map-point-search">
            Search locations
          </label>

          <div className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="absolute left-3 top-3 text-[#908b83]"
            />
            <input
              id="map-point-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="field !min-h-10 !py-2 !pl-9"
              placeholder="Search locations"
            />
          </div>

          {onCategoryChange && (
            <>
              <label className="sr-only" htmlFor="map-point-category">
                Filter map locations
              </label>
              <select
                id="map-point-category"
                className="field !min-h-10 !py-2"
                value={category}
                onChange={(event) => onCategoryChange(event.target.value)}
              >
                <option value="all">All types</option>
                <option value="destination">Destinations</option>
                <option value="attraction">Attractions</option>
                <option value="hotel">Hotels</option>
                <option value="airport">Airports</option>
                <option value="transport_hub">Transport hubs</option>
                <option value="itinerary">Itinerary stops</option>
                <option value="other">Other places</option>
              </select>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_.7fr]">
        <div className="min-w-0">
          <div
            className="relative z-0 overflow-hidden rounded-xl border border-[#e8e4dd]"
            style={{ height }}
          >
            <MapContainer
              center={DEFAULT_CENTER}
              zoom={5}
              scrollWheelZoom
              style={{ height: "100%", width: "100%" }}
              attributionControl
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxZoom={19}
              />

              <MapAutoFit points={filteredPoints} fitKey={fitKey} />

              <MapZoomTracker onZoomChange={handleZoomChange} />

              <MapSelectionController point={selectedValidPoint} />

              <MapMarkers
                points={filteredPoints}
                zoom={mapZoom}
                selectedId={selectedId}
                onSelect={selectPoint}
              />

              {routeGeometry.length > 0 && (
                <Polyline
                  positions={routeGeometry}
                  pathOptions={{
                    color: "#ea580c",
                    weight: 5,
                    opacity: 0.9,
                  }}
                />
              )}
            </MapContainer>
          </div>

          {showRoute && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label
                className="text-xs font-semibold"
                htmlFor="route-mode"
              >
                Route mode
              </label>

              <select
                id="route-mode"
                className="field !min-h-10 !py-2"
                value={mode}
                onChange={(event) =>
                  setMode(event.target.value as TravelMode)
                }
              >
                <option value="driving">Driving — in-app route</option>
                <option value="walking">Walking — provider needed</option>
                <option value="bicycling">Cycling — provider needed</option>
                <option value="transit">Transit — provider needed</option>
              </select>

              <button
                type="button"
                className="btn btn-dark !py-2"
                onClick={plotRoute}
                disabled={routeLoading || filteredPoints.length < 2}
              >
                <Route size={14} aria-hidden="true" />
                {routeLoading ? "Calculating…" : "Get route"}
              </button>

              {routeInfo && (
                <span className="text-xs font-semibold" role="status">
                  {routeInfo.distance} · {routeInfo.duration}
                </span>
              )}
            </div>
          )}

          {routeMessage && (
            <p className="mt-2 text-xs text-[#77736c]" role="status">
              {routeMessage}
            </p>
          )}

          {showStreetView && (
            <div className="mt-3 rounded-xl bg-[#f8f5f0] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn btn-secondary !py-2"
                  disabled={!selectedValidPoint}
                  onClick={openStreetLevelView}
                >
                  <Eye size={15} aria-hidden="true" />
                  Explore street-level imagery
                </button>

                <button
                  type="button"
                  className="btn btn-secondary !py-2"
                  disabled={!selectedValidPoint}
                  onClick={openDirections}
                >
                  <Navigation size={14} aria-hidden="true" />
                  Open location in OpenStreetMap
                </button>
              </div>

              {streetViewOpen && selectedValidPoint && (
                <p className="mt-2 text-xs text-[#77736c]" role="status">
                  Mapillary has opened in a new tab. Street-level imagery
                  coverage varies by location. If no imagery is available,
                  use the destination photo below.
                </p>
              )}

              <p className="mt-2 text-xs text-[#77736c]">
                Street-level imagery is provided separately by Mapillary.
                It is not embedded in this map and may not be available
                everywhere.
              </p>
            </div>
          )}
        </div>

        <aside className="flex min-h-[300px] min-w-0 flex-col">
          {selected ? (
            <div className="rounded-xl bg-[#f8f5f0] p-4">
              {selected.imageUrl && (
                <img
                  src={selected.imageUrl}
                  alt={selected.name}
                  loading="lazy"
                  className="mb-3 aspect-[16/9] w-full rounded-lg object-cover"
                />
              )}

              <div className="text-[10px] font-bold uppercase tracking-widest text-[#c94d1c]">
                {typeLabels[selected.type ?? "other"]}
                {selected.day != null ? ` · Day ${selected.day}` : ""}
              </div>

              <h3 className="mt-1 text-lg font-extrabold">
                {selected.name}
              </h3>

              {selected.country && (
                <p className="mt-1 text-xs text-[#77736c]">
                  {selected.country}
                </p>
              )}

              {selected.description && (
                <p className="mt-2 text-sm leading-6 text-[#77736c]">
                  {selected.description}
                </p>
              )}

              {selected.source && (
                <p className="mt-2 text-[10px] text-[#908b83]">
                  Location source: {selected.source}
                </p>
              )}

              {selectedValidPoint && nearestPoint && (
                <p className="mt-2 text-xs text-[#77736c]">
                  Nearest mapped place: {nearestPoint.point.name} ·
                  approximately {nearestPoint.distance.toFixed(1)} km
                  straight-line distance
                </p>
              )}

              {!selectedValidPoint && (
                <p className="mt-2 flex items-start gap-2 text-xs text-[#8a4b1d]">
                  <AlertCircle size={14} aria-hidden="true" />
                  Coordinates are unavailable. This location cannot be
                  plotted until valid coordinates are added.
                </p>
              )}

              {selected.href && (
                <a
                  className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-[#c94d1c]"
                  href={selected.href}
                >
                  Open details <ExternalLink size={13} aria-hidden="true" />
                </a>
              )}

              {selectedValidPoint && (
                <a
                  className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-[#77736c]"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`https://www.openstreetmap.org/?mlat=${selectedValidPoint.lat}&mlon=${selectedValidPoint.lng}#map=16/${selectedValidPoint.lat}/${selectedValidPoint.lng}`}
                >
                  <Navigation size={13} aria-hidden="true" />
                  View location in OpenStreetMap
                </a>
              )}
            </div>
          ) : (
            <div className="rounded-xl bg-[#f8f5f0] p-5 text-sm text-[#77736c]">
              No locations match this filter.
            </div>
          )}


<div
  className="mt-3 flex min-h-[280px] flex-1 flex-col overflow-hidden rounded-xl border border-[#eee9e1] bg-white"
  aria-label="Map location list"
>
  <div className="flex shrink-0 items-center justify-between border-b border-[#eee9e1] bg-[#faf9f6] px-4 py-3">
    <span className="text-sm font-bold text-[#20201e]">
      All locations
    </span>
    <span className="rounded-full bg-[#f26b35]/10 px-2.5 py-1 text-xs font-bold text-[#c94d1c]">
      {allFilteredPoints.length}
    </span>
  </div>

  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    {allFilteredPoints.length > 0 ? (
      allFilteredPoints.map((point) => {
        const isSelected = selected?.id === point.id;
        const hasCoordinates = isValidMapPoint(point);

        return (
          <button
            key={String(point.id)}
            type="button"
            onClick={() => selectPoint(point)}
            aria-pressed={isSelected}
            className={`flex w-full items-start gap-3 border-b border-[#eee9e1] px-4 py-3.5 text-left transition last:border-b-0 ${
              isSelected
                ? "bg-[#fff0e8]"
                : "bg-white hover:bg-[#fff8f3]"
            }`}
          >
            <span
              className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${
                isSelected
                  ? "bg-[#f26b35] text-white"
                  : "bg-[#f5f2ed] text-[#f26b35]"
              }`}
            >
              <MapPin size={15} aria-hidden="true" />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block break-words text-sm font-bold text-[#20201e]">
                {point.name}
              </span>

              <span className="mt-1 block text-xs leading-5 text-[#77736c]">
                {typeLabels[point.type ?? "other"]}
                {point.day != null ? ` · Day ${point.day}` : ""}
                {!hasCoordinates ? " · Coordinates missing" : ""}
              </span>
            </span>

            {isSelected && (
              <span className="shrink-0 self-center text-[10px] font-extrabold text-[#c94d1c]">
                SELECTED
              </span>
            )}
          </button>
        );
      })
    ) : (
      <p className="p-5 text-sm leading-6 text-[#77736c]">
        No locations match this filter. Try another category or clear
        your filters.
      </p>
    )}
  </div>
</div>


          {validPoints.length === 0 && (
            <p className="mt-2 flex items-start gap-2 text-xs text-[#8a4b1d]">
              <AlertCircle size={14} aria-hidden="true" />
              Map pins are hidden until locations have valid coordinates.
              Authorized staff can maintain coordinates in the admin
              map-locations page.
            </p>
          )}
        </aside>
      </div>

      <p className="mt-3 text-[10px] leading-5 text-[#77736c]">
        Map data © OpenStreetMap contributors. The standard OpenStreetMap
        tile service is community-operated and subject to its usage policy.
        Driving routes are estimates returned by OSRM. Street-level
        imagery is provided separately and may not be available for every
        location.
      </p>
    </section>
  );
}
