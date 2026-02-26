// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TELEGRAM_HELP_BOT_TOKEN = (Deno.env.get("TELEGRAM_HELP_BOT_TOKEN") || "").trim();
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "").trim();
const JWT_SECRET = (Deno.env.get("JWT_SECRET") || "").trim();
const HELP_NOTIFY_SHARED_KEY = (Deno.env.get("HELP_NOTIFY_SHARED_KEY") || "f050f0aa-91dc-46c1-b761-2e1030af5b49").trim();
const MINIAPP_URL = (Deno.env.get("MINIAPP_URL") || "https://t.me/DPSRADARDPR180bot").trim();
const TELEGRAM_MINIAPP_SHORT_NAME = (Deno.env.get("TELEGRAM_MINIAPP_SHORT_NAME") || "").trim();
const TELEGRAM_MAIN_BOT_USERNAME = (Deno.env.get("TELEGRAM_MAIN_BOT_USERNAME") || "").replace(/^@/, "").trim();

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization, x-help-key, apikey",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

function base64UrlToUint8Array(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyJwtHs256(token: string, secret: string): Promise<Record<string, any> | null> {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const data = new TextEncoder().encode(`${h}.${p}`);
    const sig = await crypto.subtle.sign("HMAC", key, data);
    const sigBytes = new Uint8Array(sig);
    const gotBytes = base64UrlToUint8Array(s);
    if (!timingSafeEqual(sigBytes, gotBytes)) return null;

    const payloadJson = new TextDecoder().decode(base64UrlToUint8Array(p));
    const payload = JSON.parse(payloadJson);

    const now = Math.floor(Date.now() / 1000);
    const exp = Number(payload?.exp || 0);
    if (!exp || exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

function toLabel(type: string): string {
  const labels: Record<string, string> = {
    sos: "SOS / Нужна помощь",
    dps: "Экипаж ДПС",
    specbat: "Спецполк",
    dtp: "ДТП",
    danger: "Опасность",
    traffic_jam: "Пробка / Затор",
    works: "Дорожные работы"
  };
  return labels[type] || "Дорожное событие";
}

function normalizeType(input: string): string {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "specpolk" || raw === "special_police" || raw === "specialpolice") return "specbat";
  return raw;
}

function parseParts(value: string): string[] {
  const raw = String(value || "").trim();
  if (!raw) return [];
  return raw.split("|").map((s) => s.trim()).filter(Boolean);
}

function formatRelativeMinutes(createdAtMs: number, nowMs: number): string {
  const diffMs = Math.max(0, nowMs - (Number(createdAtMs) || 0));
  const diffMin = Math.max(0, Math.floor(diffMs / (60 * 1000)));
  if (diffMin <= 0) return "только что";
  if (diffMin === 1) return "1 мин. назад";
  if (diffMin < 5) return `${diffMin} мин. назад`;
  if (diffMin < 60) return `${diffMin} мин. назад`;
  const diffH = Math.floor(diffMin / 60);
  return diffH === 1 ? "1 ч. назад" : `${diffH} ч. назад`;
}

function buildNotificationText(params: {
  type: string;
  comment: string;
  placeText: string;
  mapUrl: string;
  createdAtMs: number;
  direction: string;
}): string {
  const { type, comment, placeText, mapUrl, createdAtMs, direction } = params;
  const locationText = placeText || "не указано";
  const nowMs = Date.now();

  if (type === "sos") {
    const parts = parseParts(comment);
    const helpType = parts[0] || comment || "не указано";
    const helpComment = parts[1] || "";
    return [
      "🆘 Кнопка SOS (Приоритет: ВЫСОКИЙ)",
      "Здесь важна конкретика и геолокация.",
      "",
      "🆘 ТРЕБУЕТСЯ ПОМОЩЬ!",
      "",
      `Тип: ${helpType}`,
      `Место: ${locationText}`,
      helpComment ? `Комментарий: "${helpComment}".` : "Комментарий: не указан.",
      "",
      `📍 ${mapUrl}`,
      "",
      "Кто рядом — выручайте! SafeDrive 180 своих не бросает."
    ].join("\n");
  }

  if (type === "dps") {
    const status = comment || "не указан";
    const rel = formatRelativeMinutes(createdAtMs, nowMs);
    return [
      "🚔 ДПС (Приоритет: СРЕДНИЙ)",
      "Кратко и по делу, чтобы не отвлекать от руля.",
      "",
      "🚔 ВНИМАНИЕ: ЭКИПАЖ ДПС",
      "",
      `Локация: ${locationText}`,
      `Статус: ${status}`,
      `Время: Добавлено ${rel}.`,
      "",
      "Соблюдайте ПДД и будьте внимательны."
    ].join("\n");
  }

  if (type === "specbat") {
    const parts = parseParts(comment);
    const dir = direction || parts[0] || "не указано";
    const info = parts[1] || (parts.length === 1 ? parts[0] : "") || "не указано";
    return [
      "🛡 СПЕЦПОЛК (Приоритет: ВЫСОКИЙ)",
      "Это важная информация, её стоит выделять визуально.",
      "",
      "🚨 ВНИМАНИЕ: СПЕЦПОЛК",
      "",
      `Место: ${locationText}`,
      `Направление: ${dir}`,
      `Инфо: ${info}`,
      "",
      "Предупредите знакомых водителей!"
    ].join("\n");
  }

  const typeLabel = toLabel(type);
  return [
    "📢 ВНИМАНИЕ: НУЖНА ПОМОЩЬ!",
    `📍 Место: ${locationText}`,
    `🛠 Тип: ${typeLabel}${comment ? ` / ${comment}` : ""}`,
    "👤 Водитель: Участник"
  ].join("\n");
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildMiniappUrl(base: string, markerId: number, lat: number, lon: number): string {
  const payload = markerId > 0 ? `marker_${markerId}` : "map";
  const buildByBotUsername = (username: string) => {
    const bot = String(username || "").replace(/^@/, "").trim();
    if (!bot) return "";
    if (TELEGRAM_MINIAPP_SHORT_NAME) {
      return `https://t.me/${bot}/${encodeURIComponent(TELEGRAM_MINIAPP_SHORT_NAME)}?startapp=${encodeURIComponent(payload)}`;
    }
    return `https://t.me/${bot}?startapp=${encodeURIComponent(payload)}`;
  };

  if (TELEGRAM_MAIN_BOT_USERNAME) {
    const direct = buildByBotUsername(TELEGRAM_MAIN_BOT_USERNAME);
    if (direct) return direct;
  }

  try {
    const url = new URL(base);
    const host = url.hostname.toLowerCase();
    const isTelegramLink = host === "t.me" || host === "telegram.me";

    if (isTelegramLink) {
      const path = url.pathname.replace(/^\/+/, "").trim();

      if (path) {
        const botName = path.split("/")[0];
        const direct = buildByBotUsername(botName);
        if (direct) return direct;
      }

      url.searchParams.set("startapp", payload);
      return url.toString();
    }

    if (markerId > 0) url.searchParams.set("marker_id", String(markerId));
    if (Number.isFinite(lat)) url.searchParams.set("lat", String(lat));
    if (Number.isFinite(lon)) url.searchParams.set("lon", String(lon));
    return url.toString();
  } catch {
    return base;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);

  if (!TELEGRAM_HELP_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Missing env config" }, 500);
  }

  if (!JWT_SECRET && !HELP_NOTIFY_SHARED_KEY) {
    return jsonResponse({ error: "Missing env config" }, 500);
  }

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  let sub = "";

  if (token && JWT_SECRET) {
    const payload = await verifyJwtHs256(token, JWT_SECRET);
    sub = String(payload?.sub || "").trim();
  }

  if (!sub && HELP_NOTIFY_SHARED_KEY) {
    const helpKey = String(req.headers.get("x-help-key") || "").trim();
    const left = new TextEncoder().encode(helpKey);
    const right = new TextEncoder().encode(HELP_NOTIFY_SHARED_KEY);
    if (timingSafeEqual(left, right)) {
      sub = "shared-key";
    }
  }

  if (!sub) return jsonResponse({ error: "Unauthorized" }, 401);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const markerId = Number(body?.markerId || 0);
  const type = normalizeType(String(body?.type || ""));
  const comment = String(body?.comment || "").trim();
  const driverName = String(body?.driverName || "Водитель");
  const driverRank = String(body?.driverRank || "Участник");
  const placeText = String(body?.placeText || "").trim();
  const direction = String(body?.direction || "").trim();
  const createdAtMs = Number(body?.createdAtMs || body?.created_at_ms || body?.ts || 0);
  const lat = Number(body?.lat);
  const lon = Number(body?.lon);

  const helpTypes = new Set(["sos", "dps", "specbat", "dtp", "danger", "traffic_jam", "works"]);
  if (!helpTypes.has(type)) {
    return jsonResponse({ ok: true, skipped: true, reason: "not-help-type" });
  }

  const bypassRadiusForSos = true;

  const q = new URL(`${SUPABASE_URL}/rest/v1/telegram_help_subscribers`);
  q.searchParams.set("select", "chat_id,is_active,radius_km,home_lat,home_lon");
  q.searchParams.set("is_active", "eq.true");

  const subscribersResp = await fetch(q.toString(), {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });

  if (!subscribersResp.ok) {
    return jsonResponse({ error: "Failed to load subscribers", status: subscribersResp.status }, 500);
  }

  const subscribers = await subscribersResp.json() as Array<{
    chat_id: string;
    is_active: boolean;
    radius_km?: number | null;
    home_lat?: number | null;
    home_lon?: number | null;
  }>;

  const locationText = placeText || (Number.isFinite(lat) && Number.isFinite(lon)
    ? `${lat.toFixed(5)}, ${lon.toFixed(5)}`
    : "не указано");
  const mapUrl = buildMiniappUrl(
    MINIAPP_URL,
    markerId,
    Number.isFinite(lat) ? Number(lat) : NaN,
    Number.isFinite(lon) ? Number(lon) : NaN
  );

  const text = buildNotificationText({
    type,
    comment,
    placeText: locationText,
    mapUrl,
    createdAtMs: Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : Date.now(),
    direction
  });

  let sent = 0;
  let skippedByRadius = 0;
  let failed = 0;
  const errors: Array<{ chat_id: string; status: number; body: string }> = [];
  for (const s of subscribers) {
    const chatId = String(s.chat_id || "").trim();
    if (!chatId) continue;

    if (
      Number.isFinite(lat) && Number.isFinite(lon) &&
      Number.isFinite(Number(s.home_lat)) && Number.isFinite(Number(s.home_lon))
    ) {
      if (type === "sos" && bypassRadiusForSos) {
        // Для SOS всегда отправляем, даже если подписчик вне заданного радиуса
      } else {
      const radius = Number(s.radius_km || 10);
      const distance = haversineKm(Number(lat), Number(lon), Number(s.home_lat), Number(s.home_lon));
      if (distance > radius) {
        skippedByRadius += 1;
        continue;
      }
      }
    }

    const tgResp = await fetch(`https://api.telegram.org/bot${TELEGRAM_HELP_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: {
          inline_keyboard: [[
            { text: "📍 Посмотреть на карте", url: mapUrl }
          ]]
        },
        disable_web_page_preview: true
      })
    });

    if (tgResp.ok) {
      sent += 1;
    } else {
      failed += 1;
      let errBody = "";
      try { errBody = await tgResp.text(); } catch { errBody = ""; }
      errors.push({ chat_id: chatId, status: tgResp.status, body: errBody.slice(0, 300) });
    }
  }

  return jsonResponse({
    ok: true,
    sent,
    failed,
    skippedByRadius,
    subscribersCount: subscribers.length,
    markerId,
    type,
    mapUrl,
    errors
  });
});
