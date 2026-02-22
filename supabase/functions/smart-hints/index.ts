// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "").trim();
const JWT_SECRET = (Deno.env.get("JWT_SECRET") || "").trim();

const encoder = new TextEncoder();

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

function base64UrlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifyJwtHs256(token: string) {
  if (!token) throw new Error("Missing token");
  if (!JWT_SECRET) throw new Error("Missing JWT_SECRET");

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT");
  const [h, p, s] = parts;

  const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(h)));
  if (header?.alg !== "HS256") throw new Error("Unsupported alg");

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(s),
    encoder.encode(`${h}.${p}`)
  );
  if (!ok) throw new Error("Invalid signature");

  const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(p)));
  const now = Math.floor(Date.now() / 1000);
  if (payload?.exp && Number(payload.exp) < now) throw new Error("Token expired");
  return payload as Record<string, unknown>;
}

async function getUserIdFromAuth(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) throw new Error("Missing Authorization");
  const token = authHeader.slice("Bearer ".length).trim();
  const payload = await verifyJwtHs256(token);
  const sub = String(payload?.sub || "").trim();
  if (!sub) throw new Error("Invalid token payload");
  return sub;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getWeekdayHourBucketMsk(tsMs: number, bucketHours: number) {
  const safeBucket = Math.max(1, Math.min(6, Math.floor(bucketHours) || 2));
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "short",
    hour: "2-digit",
    hour12: false
  }).formatToParts(new Date(tsMs));

  let weekday = "";
  let hour = 0;
  for (const p of parts) {
    if (p.type === "weekday") weekday = String(p.value || "").toLowerCase();
    if (p.type === "hour") hour = Number(p.value);
  }

  const bucket = Math.floor((Number.isFinite(hour) ? hour : 0) / safeBucket);
  return { weekday, hour, bucket, bucketHours: safeBucket };
}

function quantize(val: number, step: number) {
  const s = Number(step) || 0.003;
  return Math.round(val / s) * s;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ ok: false, error: "Missing env config" }, 500);
  }

  try {
    await getUserIdFromAuth(req);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e?.message || e || "Unauthorized") }, 401);
  }

  const url = new URL(req.url);
  const action = (url.searchParams.get("action") || "check").toLowerCase();
  if (!new Set(["check", "analyze"]).has(action)) return jsonResponse({ ok: false, error: "Unknown action" }, 400);

  const body = await req.json().catch(() => ({}));
  const lat = Number(body?.lat);
  const lon = Number(body?.lon);
  const tsMs = Number(body?.ts_ms ?? body?.ts ?? Date.now());

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return jsonResponse({ ok: false, error: "Missing lat/lon" }, 400);
  }

  const windowDays = Math.max(7, Math.min(60, Number(body?.window_days) || 30));
  const minCount = Math.max(3, Math.min(30, Number(body?.min_count) || 5));
  const bucketHours = Math.max(1, Math.min(6, Number(body?.bucket_hours) || 2));

  const triggerRadiusMeters = Math.max(150, Math.min(1500, Number(body?.trigger_radius_m) || 450));
  const fetchRadiusMeters = Math.max(triggerRadiusMeters, Math.min(8000, Number(body?.fetch_radius_m) || 2500));

  const recentHours = Math.max(1, Math.min(6, Number(body?.recent_hours) || 3));
  const analyzeRadiusMeters = Math.max(120, Math.min(2000, Number(body?.analyze_radius_m) || 420));

  const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Fetch recent patrol markers (bounded only by time + type; we filter spatially in code).
  // This is intentionally conservative to avoid requiring schema migrations.
  const { data: rows, error } = await supabase
    .from("markers")
    .select("id,type,ts,coords")
    .in("type", ["dps", "specbat"])
    .gte("ts", sinceMs)
    .order("ts", { ascending: false })
    .limit(5000);

  if (error) return jsonResponse({ ok: false, error: error.message }, 400);

  const nowParts = getWeekdayHourBucketMsk(tsMs, bucketHours);
  if (!nowParts.weekday) return jsonResponse({ ok: true, hint: null });

  // Pre-filter spatially around the user to keep clustering cheap.
  // Bounding box in degrees.
  const latDelta = fetchRadiusMeters / 111000;
  const lonDelta = fetchRadiusMeters / (111000 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));

  const candidates: { lat: number; lon: number; type: string; ts: number }[] = [];
  for (const r of rows || []) {
    const coords = r?.coords;
    if (!coords || !Array.isArray(coords) || coords.length < 2) continue;
    const mLat = Number(coords[0]);
    const mLon = Number(coords[1]);
    if (!Number.isFinite(mLat) || !Number.isFinite(mLon)) continue;
    if (mLat < lat - latDelta || mLat > lat + latDelta) continue;
    if (mLon < lon - lonDelta || mLon > lon + lonDelta) continue;
    const dist = haversineMeters(lat, lon, mLat, mLon);
    if (dist > fetchRadiusMeters) continue;

    const mTs = Number(r?.ts);
    if (!Number.isFinite(mTs)) continue;
    candidates.push({ lat: mLat, lon: mLon, type: String(r?.type || "").trim(), ts: mTs });
  }

  if (!candidates.length) return jsonResponse({ ok: true, hint: null, debug: { reason: "no_candidates" } });

  // Count occurrences by quantized location + weekday bucket.
  const stepDeg = 0.003; // ~300m
  type BucketStats = { count: number; specbat: number; dps: number; lat: number; lon: number };
  const counts = new Map<string, BucketStats>();

  for (const m of candidates) {
    const t = getWeekdayHourBucketMsk(m.ts, bucketHours);
    if (t.weekday !== nowParts.weekday) continue;
    if (t.bucket !== nowParts.bucket) continue;

    const qLat = quantize(m.lat, stepDeg);
    const qLon = quantize(m.lon, stepDeg);
    const key = `${qLat.toFixed(4)},${qLon.toFixed(4)}`;

    const cur = counts.get(key) || { count: 0, specbat: 0, dps: 0, lat: qLat, lon: qLon };
    cur.count += 1;
    if (m.type === "specbat") cur.specbat += 1;
    if (m.type === "dps") cur.dps += 1;
    counts.set(key, cur);
  }

  let bestKey = "";
  let best: BucketStats | null = null;
  for (const [k, v] of counts.entries()) {
    if (!best || v.count > best.count) {
      best = v;
      bestKey = k;
    }
  }

  if (!best || best.count < minCount) {
    return jsonResponse({ ok: true, hint: null, debug: { reason: "below_threshold", bestCount: best?.count || 0 } });
  }

  const distToCenter = haversineMeters(lat, lon, best.lat, best.lon);
  if (distToCenter > triggerRadiusMeters) {
    return jsonResponse({ ok: true, hint: null, debug: { reason: "not_close_enough", distToCenter } });
  }

  const majority = best.specbat >= best.dps ? "specbat" : "dps";
  const label = majority === "specbat" ? "экипажи Спецполка" : "посты ДПС";
  const title = "🧠 Подсказка";
  const bodyText = `На этом участке часто фиксируются ${label} в это время (≈${best.count} раз за ${windowDays} дн.). Будьте бдительны.`;

  const voiceText = `На этом участке часто фиксируются ${label} в это время. Сбавьте скорость.`;

  const hintKey = `smart:${majority}:${nowParts.weekday}:${nowParts.bucket}:${bestKey}`;

  if (action === "check") {
    return jsonResponse({
      ok: true,
      hint: {
        key: hintKey,
        title,
        body: bodyText,
        voice: voiceText
      }
    });
  }

  // action=analyze: return stats for the nearest quantized cell ("засада" точка)
  // Use the "best" cell as center of interest.
  const sinceRecentMs = Date.now() - recentHours * 60 * 60 * 1000;
  let recentDps = 0;
  let recentSpecbat = 0;

  const peakCounts = new Map<number, { count: number; dps: number; specbat: number }>();

  for (const m of candidates) {
    const distToCell = haversineMeters(best.lat, best.lon, m.lat, m.lon);
    if (distToCell > analyzeRadiusMeters) continue;

    if (m.ts >= sinceRecentMs) {
      if (m.type === "dps") recentDps += 1;
      if (m.type === "specbat") recentSpecbat += 1;
    }

    const t = getWeekdayHourBucketMsk(m.ts, bucketHours);
    const bucketIdx = t.bucket; // 0..(24/bucketHours-1)
    const cur = peakCounts.get(bucketIdx) || { count: 0, dps: 0, specbat: 0 };
    cur.count += 1;
    if (m.type === "dps") cur.dps += 1;
    if (m.type === "specbat") cur.specbat += 1;
    peakCounts.set(bucketIdx, cur);
  }

  let bestBucket = -1;
  let bestBucketCount = 0;
  for (const [b, v] of peakCounts.entries()) {
    if (v.count > bestBucketCount) {
      bestBucket = b;
      bestBucketCount = v.count;
    }
  }

  const peakStartHour = bestBucket >= 0 ? bestBucket * bucketHours : null;
  const peakEndHour = bestBucket >= 0 ? (bestBucket + 1) * bucketHours : null;

  const recentTotal = recentDps + recentSpecbat;
  // Heuristic probability: higher if we saw more recent confirmations.
  const probability = Math.max(5, Math.min(95, Math.round(30 + recentTotal * 18)));

  return jsonResponse({
    ok: true,
    analyze: {
      center: { lat: best.lat, lon: best.lon },
      recent_hours: recentHours,
      recent: { total: recentTotal, dps: recentDps, specbat: recentSpecbat },
      probability,
      peak: bestBucket >= 0 ? {
        bucket_hours: bucketHours,
        start: String(peakStartHour).padStart(2, "0") + ":00",
        end: String(peakEndHour).padStart(2, "0") + ":00",
        count: bestBucketCount
      } : null
    }
  });
});
