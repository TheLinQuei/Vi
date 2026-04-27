/**
 * Open-Meteo weather (no API key).
 * Ported from legacy `vi-discord-bot/src/modules/weather.ts` (WMO table + rich `current` panel),
 * extended for Vi autonomy (`WeatherSummaryV1`, `isNotable`).
 */

export type WeatherSummaryV1 = {
  at: string;
  locationQuery: string;
  displayLocation: string;
  latitude: number;
  longitude: number;
  tempC: number;
  tempF: number;
  weatherCode: number;
  windSpeedMs?: number;
  windGustMs?: number;
  windDirectionDeg?: number;
  apparentTempC?: number;
  relativeHumidityPct?: number;
  cloudCoverPct?: number;
  summary: string;
  /** True for severe / disruptive conditions (webhook receivers may alert). */
  isNotable: boolean;
};

/** WMO code → phrase (legacy bot table). */
const WMO: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "moderate drizzle",
  55: "dense drizzle",
  56: "freezing drizzle",
  57: "freezing drizzle (dense)",
  61: "light rain",
  63: "moderate rain",
  65: "heavy rain",
  66: "freezing rain (light)",
  67: "freezing rain (heavy)",
  71: "light snow",
  73: "moderate snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light rain showers",
  81: "moderate rain showers",
  82: "violent rain showers",
  85: "light snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with small hail",
  99: "thunderstorm with large hail",
};

function cToF(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

function degToDir(deg?: number): string {
  if (deg == null || Number.isNaN(deg)) return "—";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return dirs[idx] ?? "—";
}

function computeNotable(input: { code: number; tempC: number; windMs: number; gustMs: number }): boolean {
  if (input.tempC <= -12 || input.tempC >= 38) return true;
  if (input.windMs >= 20 || input.gustMs >= 25) return true;
  if (input.code >= 95) return true;
  if ([82, 86, 99, 96, 65, 75, 77, 56, 57, 66, 67].includes(input.code)) return true;
  return false;
}

type GeoHit = {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  timezone?: string;
};

async function geocode(query: string): Promise<GeoHit | null> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const r = await fetch(url.toString());
  if (!r.ok) return null;
  const j = (await r.json()) as { results?: GeoHit[] };
  const hit = j?.results?.[0];
  if (!hit) return null;
  return hit;
}

export async function fetchWeatherForLocation(location: string): Promise<WeatherSummaryV1> {
  const trimmed = location.trim();
  if (!trimmed) {
    throw new Error("weather_location_empty");
  }

  const geo = await geocode(trimmed);
  if (!geo) {
    throw new Error("geocoding_no_results");
  }

  const displayLocation = `${geo.name}${geo.admin1 ? `, ${geo.admin1}` : ""}${geo.country ? `, ${geo.country}` : ""}`;

  const params = new URLSearchParams({
    latitude: String(geo.latitude),
    longitude: String(geo.longitude),
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,rain,snowfall,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code",
    timezone: geo.timezone ?? "auto",
    wind_speed_unit: "ms",
  });
  const wxUrl = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

  const wxRes = await fetch(wxUrl);
  if (!wxRes.ok) {
    throw new Error(`forecast_http_${wxRes.status}`);
  }
  const j = (await wxRes.json()) as {
    current?: Record<string, number | string | null | undefined>;
  };
  const c = j?.current;
  if (!c || typeof c.temperature_2m !== "number" || typeof c.weather_code !== "number") {
    throw new Error("forecast_no_current");
  }

  const tempC = c.temperature_2m;
  const tempF = cToF(tempC);
  const windMs = typeof c.wind_speed_10m === "number" ? c.wind_speed_10m : 0;
  const gustMs = typeof c.wind_gusts_10m === "number" ? c.wind_gusts_10m : 0;
  const windDir = typeof c.wind_direction_10m === "number" ? c.wind_direction_10m : undefined;
  const hum = typeof c.relative_humidity_2m === "number" ? c.relative_humidity_2m : undefined;
  const clouds = typeof c.cloud_cover === "number" ? c.cloud_cover : undefined;
  const apparent = typeof c.apparent_temperature === "number" ? c.apparent_temperature : undefined;
  const code = c.weather_code as number;
  const cond = WMO[code] ?? `weather code ${code}`;
  const dir = degToDir(windDir);
  const isNotable = computeNotable({ code, tempC, windMs, gustMs: gustMs || windMs });

  const summary = [
    `${cond}, ${tempF}°F (${tempC.toFixed(1)}°C)`,
    hum != null ? `humidity ${hum}%` : null,
    `wind ${windMs.toFixed(1)} m/s (${dir})`,
    gustMs ? `gusts ${gustMs.toFixed(1)} m/s` : null,
    clouds != null ? `clouds ${clouds}%` : null,
  ]
    .filter(Boolean)
    .join(". ");

  return {
    at: new Date().toISOString(),
    locationQuery: trimmed,
    displayLocation,
    latitude: geo.latitude,
    longitude: geo.longitude,
    tempC,
    tempF,
    weatherCode: code,
    windSpeedMs: windMs,
    windGustMs: gustMs || undefined,
    windDirectionDeg: windDir,
    apparentTempC: apparent,
    relativeHumidityPct: hum,
    cloudCoverPct: clouds,
    summary,
    isNotable,
  };
}

/** Human-readable line for chat (legacy `getCurrentWeather` shape). */
export async function getCurrentWeatherLine(place: string): Promise<string> {
  try {
    const w = await fetchWeatherForLocation(place);
    return `**${w.displayLocation}**: ${w.summary}${w.isNotable ? " _(notable conditions)_" : ""}`;
  } catch {
    return `I couldn't load weather for **${place.trim()}**. Try a city and region (e.g. Chicago, IL).`;
  }
}
