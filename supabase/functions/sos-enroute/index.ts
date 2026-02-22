// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "").trim();
const JWT_SECRET = (Deno.env.get("JWT_SECRET") || "").trim();
const TELEGRAM_HELP_BOT_TOKEN = (Deno.env.get("TELEGRAM_HELP_BOT_TOKEN") || "").trim();

const encoder = new TextEncoder();

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

async function tgSendMessage(chatId: string, text: string, replyMarkup?: Record<string, unknown>) {
  if (!TELEGRAM_HELP_BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_HELP_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
      disable_web_page_preview: true
    })
  }).catch(() => {});
}

async function getChatIdByUserId(supabase: any, userId: string): Promise<string | null> {
  const id = String(userId || "").trim();
  if (!id) return null;
  const { data } = await supabase
    .from("telegram_help_subscribers")
    .select("chat_id")
    .eq("user_id", id)
    .limit(1)
    .maybeSingle();
  const chatId = String(data?.chat_id || "").trim();
  return chatId || null;
}

async function getDriverName(supabase: any, userId: string): Promise<string | null> {
  const id = String(userId || "").trim();
  if (!id) return null;
  const { data } = await supabase
    .from("drivers")
    .select("name")
    .eq("user_id", id)
    .limit(1)
    .maybeSingle();
  const name = String(data?.name || "").trim();
  return name || null;
}

function buildRescuerText(markerId: number) {
  return [
    "🏎 Ты принял вызов!",
    "Поспеши, человек ждет помощи. Когда будешь у него, нажми кнопку ниже.",
    "",
    `SOS ID: ${markerId}`
  ].join("\n");
}

function buildVictimText(rescuerName: string) {
  return [
    "🆘 Помощь уже близко!",
    `Пользователь ${rescuerName} откликнулся на твой сигнал SOS и уже направляется к тебе.`,
    "",
    "Не паникуй, ты не один. Оставайся на связи!"
  ].join("\n");
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ ok: false, error: "Missing env config" }, 500);
  }

  if (!TELEGRAM_HELP_BOT_TOKEN) {
    // Not fatal for list, but required for notifications.
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const url = new URL(req.url);
  const action = (url.searchParams.get("action") || "list").toLowerCase();

  // Both list/add require a valid user (so we know who pressed "I’m on my way")
  let userId = "";
  try {
    userId = await getUserIdFromAuth(req);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e?.message || e || "Unauthorized") }, 401);
  }

  try {
    if (action === "add") {
      if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
      const body = await req.json().catch(() => ({}));
      const markerId = Number(body?.markerId ?? body?.marker_id ?? 0);
      if (!Number.isFinite(markerId) || markerId <= 0) return jsonResponse({ ok: false, error: "Missing markerId" }, 400);

      // Prevent marking yourself for your own SOS
      const { data: marker } = await supabase.from("markers").select("id,type,author_id").eq("id", markerId).maybeSingle();
      if (!marker) return jsonResponse({ ok: false, error: "Marker not found" }, 404);
      if (String(marker.type) !== "sos") return jsonResponse({ ok: false, error: "Only SOS markers" }, 400);
      if (String(marker.author_id) === String(userId)) return jsonResponse({ ok: false, error: "Cannot enroute own SOS" }, 400);

      // Dedupe: only notify on first press
      const { data: existing } = await supabase
        .from("sos_enroute")
        .select("id")
        .eq("marker_id", markerId)
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (existing?.id) return jsonResponse({ ok: true, markerId, userId, already: true });

      let insertErr: any = null;
      // Try with status fields (if migrated)
      {
        const { error } = await supabase
          .from("sos_enroute")
          .insert([{ marker_id: markerId, user_id: userId, status: "enroute" }]);
        insertErr = error;
      }
      if (insertErr) {
        // Fallback for older schema (no status column)
        const { error } = await supabase
          .from("sos_enroute")
          .insert([{ marker_id: markerId, user_id: userId }]);
        if (error) return jsonResponse({ ok: false, error: error.message }, 400);
      }

      const rescuerName = (await getDriverName(supabase, userId)) || `#${userId}`;
      const victimUserId = String(marker.author_id || "").trim();

      const rescuerChat = (await getChatIdByUserId(supabase, userId)) || userId;
      const victimChat = victimUserId ? ((await getChatIdByUserId(supabase, victimUserId)) || victimUserId) : null;

      // Message to rescuer with callback button
      await tgSendMessage(rescuerChat, buildRescuerText(markerId), {
        inline_keyboard: [[
          { text: "📍 Я НА МЕСТЕ", callback_data: `sos_arrived:${markerId}` }
        ]]
      });

      // Message to victim
      if (victimChat) {
        await tgSendMessage(victimChat, buildVictimText(rescuerName));
      }

      return jsonResponse({ ok: true, markerId, userId, notified: true });
    }

    if (action === "list") {
      // Accept marker IDs via POST (preferred) or GET marker_ids=1,2,3
      let markerIds: number[] = [];
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        markerIds = Array.isArray(body?.markerIds) ? body.markerIds : [];
      } else {
        const raw = String(url.searchParams.get("marker_ids") || "").trim();
        markerIds = raw
          ? raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
          : [];
      }

      markerIds = [...new Set(markerIds)].slice(0, 200);
      if (!markerIds.length) return jsonResponse({ ok: true, items: [], byMarker: {} });

      const { data: rows, error } = await supabase
        .from("sos_enroute")
        .select("marker_id,user_id,created_at")
        .in("marker_id", markerIds)
        .order("created_at", { ascending: false })
        .limit(5000);

      if (error) return jsonResponse({ ok: false, error: error.message }, 400);

      const responders = new Set((rows || []).map((r: any) => String(r.user_id || "").trim()).filter(Boolean));
      const responderIds = [...responders];

      const nameById: Record<string, string> = {};
      if (responderIds.length) {
        const { data: drivers } = await supabase.from("drivers").select("user_id,name").in("user_id", responderIds);
        if (Array.isArray(drivers)) {
          drivers.forEach((d: any) => {
            const id = String(d.user_id || "").trim();
            if (!id) return;
            nameById[id] = String(d.name || "").trim() || id;
          });
        }
      }

      const byMarker: Record<string, { userId: string; name: string; createdAt: string }[]> = {};
      (rows || []).forEach((r: any) => {
        const mid = String(r.marker_id);
        const rid = String(r.user_id || "").trim();
        if (!mid || !rid) return;
        if (!byMarker[mid]) byMarker[mid] = [];
        byMarker[mid].push({ userId: rid, name: nameById[rid] || rid, createdAt: r.created_at || null });
      });

      return jsonResponse({ ok: true, byMarker });
    }

    return jsonResponse({ ok: false, error: "Unknown action" }, 400);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e?.message || e || "Internal error") }, 500);
  }
});
