/**
 * GOOGLE MAPS FRONTEND INTEGRATION - ESSENTIAL GUIDE
 *
 * USAGE FROM PARENT COMPONENT:
 * ======
 *
 * const mapRef = useRef<google.maps.Map | null>(null);
 *
 * <MapView
 *   initialCenter={{ lat: 40.7128, lng: -74.0060 }}
 *   initialZoom={15}
 *   onMapReady={(map) => {
 *     mapRef.current = map; // Store to control map from parent anytime, google map itself is in charge of the re-rendering, not react state.
 * </MapView>
 *
 * ======
 * Available Libraries and Core Features:
 * -------------------------------
 * 📍 MARKER (from `marker` library)
 * - Attaches to map using { map, position }
 * new google.maps.marker.AdvancedMarkerElement({
 *   map,
 *   position: { lat: 37.7749, lng: -122.4194 },
 *   title: "San Francisco",
 * });
 *
 * -------------------------------
 * 🏢 PLACES (from `places` library)
 * - Does not attach directly to map; use data with your map manually.
 * const place = new google.maps.places.Place({ id: PLACE_ID });
 * await place.fetchFields({ fields: ["displayName", "location"] });
 * map.setCenter(place.location);
 * new google.maps.marker.AdvancedMarkerElement({ map, position: place.location });
 *
 * -------------------------------
 * 🧭 GEOCODER (from `geocoding` library)
 * - Standalone service; manually apply results to map.
 * const geocoder = new google.maps.Geocoder();
 * geocoder.geocode({ address: "New York" }, (results, status) => {
 *   if (status === "OK" && results[0]) {
 *     map.setCenter(results[0].geometry.location);
 *     new google.maps.marker.AdvancedMarkerElement({
 *       map,
 *       position: results[0].geometry.location,
 *     });
 *   }
 * });
 *
 * -------------------------------
 * 📐 GEOMETRY (from `geometry` library)
 * - Pure utility functions; not attached to map.
 * const dist = google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
 *
 * -------------------------------
 * 🛣️ ROUTES (from `routes` library)
 * - Combines DirectionsService (standalone) + DirectionsRenderer (map-attached)
 * const directionsService = new google.maps.DirectionsService();
 * const directionsRenderer = new google.maps.DirectionsRenderer({ map });
 * directionsService.route(
 *   { origin, destination, travelMode: "DRIVING" },
 *   (res, status) => status === "OK" && directionsRenderer.setDirections(res)
 * );
 *
 * -------------------------------
 * 🌦️ MAP LAYERS (attach directly to map)
 * - new google.maps.TrafficLayer().setMap(map);
 * - new google.maps.TransitLayer().setMap(map);
 * - new google.maps.BicyclingLayer().setMap(map);
 *
 * -------------------------------
 * ✅ SUMMARY
 * - “map-attached” → AdvancedMarkerElement, DirectionsRenderer, Layers.
 * - “standalone” → Geocoder, DirectionsService, DistanceMatrixService, ElevationService.
 * - “data-only” → Place, Geometry utilities.
 */

/// <reference types="@types/google.maps" />


import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { cn } from "@/lib/utils";

export interface MapViewProps {
  className?: string;
  initialCenter?: {
    lat: number;
    lng: number;
  };
  initialZoom?: number;
  onMapReady?: (map: L.Map) => void;
  height?: number;
}

interface MapInitializerProps {
  initialCenter: L.LatLngExpression;
  initialZoom: number;
  onMapReady?: (map: L.Map) => void;
}

function MapInitializer({
  initialCenter,
  initialZoom,
  onMapReady,
}: MapInitializerProps) {
  const map = useMap();
  const callbackRef = useRef(onMapReady);

  useEffect(() => {
    callbackRef.current = onMapReady;
  }, [onMapReady]);

  useEffect(() => {
    map.setView(initialCenter, initialZoom);
    callbackRef.current?.(map);
  }, [map, initialCenter, initialZoom]);

  return null;
}

export function MapView({
  className,
  initialCenter = {
    lat: 20.5937,
    lng: 78.9629,
  },
  initialZoom = 5,
  onMapReady,
  height = 500,
}: MapViewProps) {
  const [mapError, setMapError] = useState<string | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const handleMapReady = useCallback(
    (map: L.Map) => {
      mapRef.current = map;
      setMapError(null);
      onMapReady?.(map);
    },
    [onMapReady],
  );

  useEffect(() => {
    return () => {
      mapRef.current = null;
    };
  }, []);

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg"
      style={{ height: `${height}px` }}
    >
      <div
        className={cn("h-full w-full", className)}
        aria-label="Interactive map"
      >
        <MapContainer
          center={[initialCenter.lat, initialCenter.lng]}
          zoom={initialZoom}
          scrollWheelZoom
          zoomControl
          attributionControl
          style={{ height: "100%", width: "100%" }}
          whenReady={() => {
            // Leaflet's map is initialized before this callback runs.
            // MapInitializer supplies the actual map instance to the parent.
          }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
            eventHandlers={{
              tileerror: () => {
                setMapError(
                  "Some map tiles could not be loaded. Check your connection and try again.",
                );
              },
              load: () => {
                setMapError(null);
              },
            }}
          />

          <MapInitializer
            initialCenter={[initialCenter.lat, initialCenter.lng]}
            initialZoom={initialZoom}
            onMapReady={handleMapReady}
          />
        </MapContainer>
      </div>

      {mapError && (
        <div
          role="status"
          className="absolute bottom-3 left-3 right-3 z-[1000] rounded-md bg-white/95 p-3 text-sm text-[#77736c] shadow"
        >
          {mapError}
        </div>
      )}
    </div>
  );
}

export default MapView;
