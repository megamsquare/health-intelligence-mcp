import { TtlCache } from '../lib/cache.js';

export interface SpecialistResult {
  name: string;
  address: string;
  rating: number | null;
  distance_km: number | null;
  maps_url: string;
  specialty: string;
}

// Geocode results are stable — cache for 1 hour.
const geocodeCache = new TtlCache<string, { lat: number; lng: number }>(60 * 60_000);
// Specialist results change occasionally — cache for 30 minutes.
const specialistCache = new TtlCache<string, SpecialistResult[]>(30 * 60_000);

export async function findNearbySpecialists(
  location: string,
  specialty: string,
  radius_km: number
): Promise<SpecialistResult[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not configured');

  const specialistKey = `${location.toLowerCase()}:${specialty.toLowerCase()}:${radius_km}`;
  const cachedResults = specialistCache.get(specialistKey);
  if (cachedResults) return cachedResults;

  const locationKey = location.toLowerCase().trim();
  let coords = geocodeCache.get(locationKey);

  if (!coords) {
    const geocodeRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${key}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!geocodeRes.ok) throw new Error(`Geocoding returned ${geocodeRes.status}`);
    const geocodeJson = (await geocodeRes.json()) as { results?: any[] };
    if (!geocodeJson.results?.length) {
      throw new Error(`Could not geocode "${location}" — try a more specific address or city name`);
    }
    coords = geocodeJson.results[0].geometry.location as { lat: number; lng: number };
    geocodeCache.set(locationKey, coords);
  }

  const { lat, lng } = coords;
  const radiusMeters = Math.round(radius_km * 1000);

  const nearbyRes = await fetch(
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json?` +
      `location=${lat},${lng}&radius=${radiusMeters}&keyword=${encodeURIComponent(specialty)}&type=hospital&key=${key}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!nearbyRes.ok) throw new Error(`Places search returned ${nearbyRes.status}`);
  const nearbyJson = (await nearbyRes.json()) as { results?: any[] };

  const results = (nearbyJson.results ?? []).slice(0, 10).map((place: any) => {
    const pLat: number = place.geometry?.location?.lat;
    const pLng: number = place.geometry?.location?.lng;
    const distance = pLat && pLng ? haversineKm(lat, lng, pLat, pLng) : null;
    return {
      name: place.name,
      address: place.vicinity ?? 'Address unavailable',
      rating: place.rating ?? null,
      distance_km: distance !== null ? Math.round(distance * 10) / 10 : null,
      maps_url: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
      specialty,
    };
  });

  specialistCache.set(specialistKey, results);
  return results;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
