import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_LOCATIONS = 5;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function locationKey(lat: number, lon: number) {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

function cleanLocations(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_LOCATIONS).map((raw: any) => {
    const latitude = Number(raw?.latitude);
    const longitude = Number(raw?.longitude);
    return {
      id: String(raw?.id ?? `${latitude},${longitude}`),
      name: String(raw?.name ?? "Cidade").slice(0, 120),
      admin1: String(raw?.admin1 ?? "").slice(0, 120),
      country: String(raw?.country ?? "").slice(0, 120),
      countryCode: String(raw?.countryCode ?? raw?.country_code ?? "").slice(0, 2).toUpperCase(),
      latitude,
      longitude,
      timezone: String(raw?.timezone ?? "auto").slice(0, 80)
    };
  }).filter((loc) => Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude) && Math.abs(loc.latitude) <= 90 && Math.abs(loc.longitude) <= 180);
}

async function requireUser(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function geocode(req: Request, payload: any) {
  const user = await requireUser(req);
  if (!user) return reply({ error: "UNAUTHORIZED" }, 401);

  const query = String(payload?.query || "").trim();
  if (query.length < 2 || query.length > 120) return reply({ error: "INVALID_QUERY" }, 400);

  const url = new URL(GEOCODING_URL);
  url.searchParams.set("name", query);
  url.searchParams.set("count", "20");
  url.searchParams.set("language", "pt");
  url.searchParams.set("format", "json");
  if (/^[A-Za-z]{2}$/.test(String(payload?.countryCode || ""))) url.searchParams.set("countryCode", String(payload.countryCode).toUpperCase());

  const response = await fetch(url);
  if (!response.ok) return reply({ error: "GEOCODING_PROVIDER_ERROR" }, 502);
  const json = await response.json();
  const rows = Array.isArray(json?.results) ? json.results : [];
  const results = rows.filter((r: any) => String(r?.feature_code || "").startsWith("PPL")).slice(0, 12).map((r: any) => ({
    id: String(r.id), name: String(r.name || ""), admin1: String(r.admin1 || ""), admin2: String(r.admin2 || ""), country: String(r.country || ""), countryCode: String(r.country_code || ""), latitude: Number(r.latitude), longitude: Number(r.longitude), timezone: String(r.timezone || "auto"), population: Number.isFinite(Number(r.population)) ? Number(r.population) : null, postcodes: Array.isArray(r.postcodes) ? r.postcodes.slice(0, 4) : [], featureCode: String(r.feature_code || "")
  }));
  return reply({ results });
}

async function locationsFromOverlayToken(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { error: "INVALID_TOKEN", locations: [] };
  const { data, error } = await admin.rpc("get_overlay_state", { p_token: token });
  if (error) return { error: "OVERLAY_STATE_ERROR", locations: [] };
  const row = Array.isArray(data) ? data[0] : data;
  const state = row?.program_state;
  if (!state || state.product !== "weather_overlay") return { error: "WEATHER_STATE_NOT_FOUND", locations: [] };
  return { error: null, locations: cleanLocations(state.locations) };
}

async function fetchProvider(locations: any[]) {
  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", locations.map((l) => l.latitude).join(","));
  url.searchParams.set("longitude", locations.map((l) => l.longitude).join(","));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
  const json = await response.json();
  const rows = Array.isArray(json) ? json : [json];
  const now = new Date().toISOString();
  return rows.map((row: any, index: number) => {
    const loc = locations[index];
    if (!loc) return null;
    return {
      location_key: locationKey(loc.latitude, loc.longitude), latitude: loc.latitude, longitude: loc.longitude, provider: "open_meteo", temperature: row.current?.temperature_2m ?? null, apparent_temperature: row.current?.apparent_temperature ?? null, humidity: row.current?.relative_humidity_2m ?? null, wind_speed: row.current?.wind_speed_10m ?? null, weather_code: row.current?.weather_code ?? row.daily?.weather_code?.[0] ?? null, is_day: row.current?.is_day === 1, temp_min: row.daily?.temperature_2m_min?.[0] ?? null, temp_max: row.daily?.temperature_2m_max?.[0] ?? null, source_time: row.current?.time ?? null, fetched_at: now, updated_at: now
    };
  }).filter(Boolean);
}

async function weatherFor(locations: any[]) {
  if (!locations.length) return [];
  const keys = locations.map((l) => locationKey(l.latitude, l.longitude));
  const { data: cached, error: cacheError } = await admin.from("weather_cache").select("location_key,latitude,longitude,provider,temperature,apparent_temperature,humidity,wind_speed,weather_code,is_day,temp_min,temp_max,source_time,fetched_at").in("location_key", keys);
  if (cacheError) console.error("weather_cache select", cacheError);
  const cacheMap = new Map((cached || []).map((row: any) => [row.location_key, row]));
  const staleLocations = locations.filter((loc) => {
    const row: any = cacheMap.get(locationKey(loc.latitude, loc.longitude));
    if (!row?.fetched_at) return true;
    return Date.now() - new Date(row.fetched_at).getTime() >= CACHE_TTL_MS;
  });

  if (staleLocations.length) {
    try {
      const fresh = await fetchProvider(staleLocations);
      if (fresh.length) {
        const { error } = await admin.from("weather_cache").upsert(fresh, { onConflict: "location_key" });
        if (error) console.error("weather_cache upsert", error);
        fresh.forEach((row: any) => cacheMap.set(row.location_key, row));
      }
    } catch (error) {
      console.error("weather provider", error);
      if (![...cacheMap.values()].length) throw error;
    }
  }

  return locations.map((loc) => {
    const key = locationKey(loc.latitude, loc.longitude);
    const row: any = cacheMap.get(key) || {};
    return { locationKey: key, latitude: loc.latitude, longitude: loc.longitude, temperature: row.temperature ?? null, apparent: row.apparent_temperature ?? null, humidity: row.humidity ?? null, wind: row.wind_speed ?? null, code: row.weather_code ?? null, isDay: row.is_day !== false, min: row.temp_min ?? null, max: row.temp_max ?? null, updatedAt: row.source_time || row.fetched_at || null, fetchedAt: row.fetched_at || null, provider: row.provider || "open_meteo" };
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
  let payload: any;
  try { payload = await req.json(); } catch { return reply({ error: "INVALID_JSON" }, 400); }
  try {
    const mode = String(payload?.mode || "");
    if (mode === "geocode") return await geocode(req, payload);
    let locations: any[] = [];
    if (mode === "overlay") {
      const loaded = await locationsFromOverlayToken(String(payload?.token || ""));
      if (loaded.error) return reply({ error: loaded.error }, loaded.error === "INVALID_TOKEN" ? 400 : 404);
      locations = loaded.locations;
    } else if (mode === "preview") {
      const user = await requireUser(req);
      if (!user) return reply({ error: "UNAUTHORIZED" }, 401);
      locations = cleanLocations(payload?.locations);
    } else return reply({ error: "INVALID_MODE" }, 400);
    const data = await weatherFor(locations);
    return reply({ data, cacheTtlSeconds: CACHE_TTL_MS / 1000 });
  } catch (error) {
    console.error("weather-api", error);
    return reply({ error: "WEATHER_BACKEND_ERROR" }, 500);
  }
});
