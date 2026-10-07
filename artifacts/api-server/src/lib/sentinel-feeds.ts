import { createHash } from "node:crypto";
import type { FloodReading, Incident, LocationResult, WeatherReading } from "@workspace/api-zod";
import { demoState } from "./sentinel-demo";
import { calculateRiskScore, priorityForRisk } from "./sentinel-risk";

const KADAPA = { lat: 14.4673, lng: 78.8242 };
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { value: unknown; expiresAt: number; savedAt: string }>();
let lastNominatimAt = 0;

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function setSource(id: string, status: "LIVE" | "STALE" | "ERROR" | "SIMULATED" | "DISABLED", message: string, error?: string): void {
  const source = demoState.dataSources.find((item) => item.id === id);
  if (!source) return;
  source.status = status;
  source.message = message;
  source.lastError = error ?? null;
  if (status === "LIVE") source.lastSuccessAt = new Date();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Public data source returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

function cachedValue<T>(key: string): T | null {
  const item = cache.get(key);
  return item && item.expiresAt > Date.now() ? (item.value as T) : null;
}

function savedValue<T>(key: string): { value: T; savedAt: string } | null {
  const item = cache.get(key);
  return item ? { value: item.value as T, savedAt: item.savedAt } : null;
}

function saveCache(key: string, value: unknown): void {
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS, savedAt: new Date().toISOString() });
}

export async function readWeather(
  lat = KADAPA.lat,
  lng = KADAPA.lng,
  location = "Kadapa district",
): Promise<WeatherReading> {
  const key = `weather:${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = cachedValue<WeatherReading>(key);
  if (cached) return { ...cached, location, sourceStatus: "LIVE" };
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,pressure_msl",
    hourly: "precipitation",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
    forecast_days: "1",
    past_days: "1",
    timezone: "auto",
  }).toString();
  try {
    const data = await fetchJson<{
      current?: Record<string, number | string>;
      daily?: Record<string, number[]>;
      hourly?: Record<string, number[]>;
    }>(url.toString());
    const current = data.current ?? {};
    const hourlyRain = data.hourly?.precipitation ?? [];
    const rain24h = hourlyRain.slice(-24).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const reading: WeatherReading = {
      location,
      temperatureC: Number(current.temperature_2m ?? 0),
      precipitationMm: Number(current.precipitation ?? rain24h),
      windKph: Number(current.wind_speed_10m ?? 0),
      humidityPercent: Number(current.relative_humidity_2m ?? 0),
      pressureHpa: Number(current.pressure_msl ?? 0),
      forecastHighC: Number(data.daily?.temperature_2m_max?.[0] ?? current.temperature_2m ?? 0),
      forecastLowC: Number(data.daily?.temperature_2m_min?.[0] ?? current.temperature_2m ?? 0),
      forecastPrecipitationMm: Number(data.daily?.precipitation_sum?.[0] ?? 0),
      source: "Open-Meteo",
      sourceStatus: "LIVE",
      updatedAt: new Date(),
      classification: "FORECAST",
      message: `Live public forecast at ${lat.toFixed(3)}, ${lng.toFixed(3)}. 24-hour precipitation is calculated from the available hourly feed.`,
    };
    saveCache(key, reading);
    setSource("open-meteo-weather", "LIVE", "Open-Meteo forecast queried successfully.");
    return reading;
  } catch (error) {
    const saved = savedValue<WeatherReading>(key);
    if (saved) {
      setSource("open-meteo-weather", "STALE", `Showing the last successful observation from ${saved.savedAt}.`);
      return { ...saved.value, location, sourceStatus: "STALE", message: `Stale public feed. Last success: ${saved.savedAt}.` };
    }
    setSource("open-meteo-weather", "ERROR", "Live weather unavailable; showing simulated scenario values.", String(error));
    return { ...demoState.weather, location };
  }
}

export async function readFlood(
  lat = KADAPA.lat,
  lng = KADAPA.lng,
  location = "Penna river corridor · Kadapa",
): Promise<FloodReading> {
  const key = `flood:${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = cachedValue<FloodReading>(key);
  if (cached) return { ...cached, location, sourceStatus: "LIVE" };
  const url = new URL("https://flood-api.open-meteo.com/v1/flood");
  url.search = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    daily: "river_discharge",
    forecast_days: "7",
    timezone: "auto",
  }).toString();
  try {
    const data = await fetchJson<{ daily?: { river_discharge?: number[] } }>(url.toString());
    const discharges = data.daily?.river_discharge?.map(Number).filter(Number.isFinite) ?? [];
    if (!discharges.length) throw new Error("Flood model returned no discharge forecast.");
    const first = discharges[0] ?? 0;
    const last = discharges.at(-1) ?? first;
    const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
    const trend = changePct > 8 ? "RISING" : changePct < -8 ? "FALLING" : "STEADY";
    const riskLevel = changePct > 35 ? "HIGH" : changePct > 12 ? "MODERATE" : "LOW";
    const [weather, ..._] = await Promise.all([readWeather(lat, lng, location)]);
    const reading: FloodReading = {
      location,
      riverLevelM: null,
      riverDischargeM3s: first,
      trend,
      rainfall24hMm: weather.precipitationMm,
      riskLevel,
      source: "Open-Meteo Flood / GloFAS forecast",
      sourceStatus: "LIVE",
      updatedAt: new Date(),
      classification: "FORECAST",
      message: "Forecast discharge is in m³/s, not a local river-gauge level. Trend-based screening is not an official flood warning.",
    };
    saveCache(key, reading);
    setSource("open-meteo-flood", "LIVE", "Open-Meteo flood forecast queried successfully.");
    return reading;
  } catch (error) {
    const saved = savedValue<FloodReading>(key);
    if (saved) {
      setSource("open-meteo-flood", "STALE", `Showing the last successful forecast from ${saved.savedAt}.`);
      return { ...saved.value, location, sourceStatus: "STALE", message: `Stale model forecast. Last success: ${saved.savedAt}.` };
    }
    setSource("open-meteo-flood", "ERROR", "Live flood forecast unavailable; showing simulated scenario values.", String(error));
    return { ...demoState.flood, location };
  }
}

function xmlTag(xml: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escapedName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedName}>`, "i"));
  return (match?.[1] ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export async function readPublicIncidents(): Promise<Incident[]> {
  const cacheKey = "public:incidents:feed";
  const cached = cachedValue<Incident[]>(cacheKey);
  if (cached) return cached;
  const result: Incident[] = [];
  try {
    const response = await fetch("https://www.gdacs.org/xml/rss.xml", {
      headers: { accept: "application/rss+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`GDACS returned HTTP ${response.status}`);
    const xml = await response.text();
    for (const item of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
      const body = item[1] ?? "";
      const title = xmlTag(body, "title");
      const description = xmlTag(body, "description");
      const lat = Number(xmlTag(body, "geo:lat"));
      const lng = Number(xmlTag(body, "geo:long"));
      if (!title || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const guid = xmlTag(body, "guid") || xmlTag(body, "link") || title;
      const severity: Incident["severity"] = /\bred\b/i.test(`${title} ${description}`) ? "HIGH" : "MODERATE";
      const riskScore = calculateRiskScore({ severity, externalHazardPoints: severity === "HIGH" ? 7 : 3 });
      const type: Incident["type"] = /flood/i.test(title) ? "FLOOD" : /cyclone|storm/i.test(title) ? "STORM" : /fire/i.test(title) ? "FIRE" : "OTHER";
      result.push({
        id: stableUuid(`gdacs:${guid}`),
        title: title.slice(0, 160),
        type,
        severity,
        status: "ACTIVE",
        priority: priorityForRisk(riskScore, severity),
        description: description.slice(0, 700) || "GDACS public event alert. Consult the linked source for current details.",
        location: xmlTag(body, "gdacs:country") || "Global event feed",
        lat,
        lng,
        riskScore,
        estimatedPopulation: 0,
        assignedTeamId: null,
        source: "GDACS public RSS",
        classification: "OBSERVED",
        riskFactors: ["Public event feed", "Impact estimate not independently verified"],
        updatedAt: new Date(),
      });
      if (result.length >= 80) break;
    }
    setSource("gdacs", "LIVE", `Fetched ${result.length} public GDACS event(s).`);
  } catch (error) {
    setSource("gdacs", "ERROR", "GDACS feed unavailable. No current events were inferred.", String(error));
  }

  try {
    const geojson = await fetchJson<{
      features?: Array<{
        id?: string;
        properties?: { title?: string; place?: string; mag?: number; time?: number; url?: string };
        geometry?: { coordinates?: number[] };
      }>;
    }>("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
    for (const feature of geojson.features ?? []) {
      const properties = feature.properties ?? {};
      const coordinates = feature.geometry?.coordinates ?? [];
      const lng = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      const magnitude = Number(properties.mag);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(magnitude)) continue;
      const severity: Incident["severity"] = magnitude >= 6 ? "CRITICAL" : magnitude >= 5 ? "HIGH" : magnitude >= 3.5 ? "MODERATE" : "LOW";
      const riskScore = Math.min(100, Math.round(magnitude * 13));
      result.push({
        id: stableUuid(`usgs:${feature.id ?? `${properties.time}:${properties.title}`}`),
        title: `M${magnitude.toFixed(1)} earthquake · ${properties.place ?? "location not stated"}`,
        type: "EARTHQUAKE",
        severity,
        status: "ACTIVE",
        priority: priorityForRisk(riskScore, severity),
        description: `${properties.title ?? "Earthquake event"} Public feed record only; no local damage or impact is inferred. ${properties.url ?? ""}`.trim(),
        location: properties.place ?? "USGS event location",
        lat,
        lng,
        riskScore,
        estimatedPopulation: 0,
        assignedTeamId: null,
        source: "USGS public earthquake feed",
        classification: "OBSERVED",
        riskFactors: [`Magnitude ${magnitude.toFixed(1)}`, "Population impact not estimated"],
        updatedAt: properties.time ? new Date(properties.time) : new Date(),
      });
    }
    setSource("usgs", "LIVE", `Fetched ${geojson.features?.length ?? 0} public USGS earthquake event(s).`);
  } catch (error) {
    setSource("usgs", "ERROR", "USGS feed unavailable. No current earthquakes were inferred.", String(error));
  }
  if (result.length > 0) {
    saveCache(cacheKey, result);
  }
  return result;
}

export async function searchLocations(query: string): Promise<LocationResult[]> {
  const key = `geocode:${query.trim().toLowerCase()}`;
  const cached = cachedValue<LocationResult[]>(key);
  if (cached) return cached;
  const waitFor = Math.max(0, 1_000 - (Date.now() - lastNominatimAt));
  if (waitFor) await new Promise((resolve) => setTimeout(resolve, waitFor));
  lastNominatimAt = Date.now();
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({ format: "jsonv2", q: query, limit: "6", addressdetails: "1" }).toString();
  let results: LocationResult[] = [];
  try {
    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        "user-agent": "SENTINEL-disaster-response/1.0 (location search)",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Location search returned HTTP ${response.status}`);
    const places = (await response.json()) as Array<{
      display_name?: string;
      lat?: string;
      lon?: string;
      name?: string;
      address?: Record<string, string>;
    }>;
    results = places
      .map((place) => ({
        name: place.name || place.address?.city || place.address?.town || place.address?.village || place.display_name?.split(",")[0] || "Location",
        displayName: place.display_name ?? "",
        lat: Number(place.lat),
        lng: Number(place.lon),
      }))
      .filter((place) => place.displayName && Number.isFinite(place.lat) && Number.isFinite(place.lng));
    setSource("nominatim", "LIVE", `Found ${results.length} public location result(s).`);
  } catch (error) {
    setSource("nominatim", "ERROR", "Public address search is unavailable; matching local demo locations remain searchable.", String(error));
  }
  const normalizedQuery = query.trim().toLowerCase();
  const localLocations: LocationResult[] = [
    ...demoState.incidents.map((item) => ({ name: item.location, detail: item.title, lat: item.lat, lng: item.lng })),
    ...demoState.zones.map((item) => ({ name: item.location, detail: item.name, lat: item.lat, lng: item.lng })),
    ...demoState.shelters.map((item) => ({ name: item.location, detail: item.name, lat: item.lat, lng: item.lng })),
    ...demoState.teams.map((item) => ({ name: item.location, detail: item.name, lat: item.lat, lng: item.lng })),
  ]
    .filter((item) => `${item.name} ${item.detail}`.toLowerCase().includes(normalizedQuery))
    .map((item) => ({
      name: item.name,
      displayName: `SIMULATED operational record · ${item.detail}`,
      lat: item.lat,
      lng: item.lng,
    }));
  const mergedResults = [...results, ...localLocations].slice(0, 10);
  if (results.length === 0 && localLocations.length > 0) {
    setSource("nominatim", "SIMULATED", "Showing matching demo record locations because public address search is unavailable.");
  }
  saveCache(key, mergedResults);
  return mergedResults;
}

export function isWithinRadius(
  point: { lat: number; lng: number },
  center: { lat: number; lng: number },
  radiusKm: number,
): boolean {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(point.lat - center.lat);
  const dLng = radians(point.lng - center.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(center.lat)) * Math.cos(radians(point.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= radiusKm;
}
