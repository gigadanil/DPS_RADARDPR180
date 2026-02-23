// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const BOT_TOKEN = (Deno.env.get("TELEGRAM_BOT_TOKEN") || "").trim();
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE_KEY = (Deno.env.get("SERVICE_ROLE_KEY") || "").trim();
const MAX_AUTH_AGE_SEC = 24 * 60 * 60;

const encoder = new TextEncoder();

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function derivePassword(tgUserId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${BOT_TOKEN}:tg:${tgUserId}:sd180`)
  );
  return bytesToHex(digest);
}

function tgEmail(tgUserId: string): string {
  return `tg_${String(tgUserId)}@telegram.local`;
}

async function ensureSupabaseUserExists(email: string, password: string, tgUserId: string) {
  const url = `${SUPABASE_URL}/auth/v1/admin/users`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { telegram_user_id: String(tgUserId) }
    })
  });

  if (res.ok) return;
  if (res.status === 422) return;
  const t = await res.text().catch(() => "");
  throw new Error(`auth.admin createUser failed (${res.status}): ${t || "empty"}`);
}

async function signInWithPassword(email: string, password: string) {
  const url = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY
    },
    body: JSON.stringify({ email, password })
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    const msg = JSON.stringify(json || {});
    throw new Error(`auth token failed (${res.status}): ${msg}`);
  }
  return {
    access_token: String(json.access_token),
    expires_in: Number(json.expires_in || 0)
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function safeString(v: unknown): string {
  return String(v ?? "");
}

function buildDataCheckString(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload)
    .filter(([k]) => k !== "hash")
    .filter(([, v]) => typeof v !== "undefined" && v !== null)
    .map(([k, v]) => [k, safeString(v)] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  return entries.map(([k, v]) => `${k}=${v}`).join("\n");
}

async function sha256Bytes(text: string): Promise<ArrayBuffer> {
  return await crypto.subtle.digest("SHA-256", encoder.encode(text));
}

async function hmacHex(keyBytes: ArrayBuffer, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (!BOT_TOKEN || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Missing Config" }, 500);
  }

  let user: Record<string, unknown> = {};
  try {
    const body = await req.json();
    user = (body?.user && typeof body.user === "object") ? body.user : {};
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const hash = safeString(user.hash).toLowerCase();
  const authDate = Number(user.auth_date || 0);
  const userId = safeString(user.id);

  if (!hash) return jsonResponse({ error: "Missing hash" }, 400);
  if (!authDate) return jsonResponse({ error: "Missing auth_date" }, 400);
  if (!userId) return jsonResponse({ error: "Missing id" }, 400);

  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > MAX_AUTH_AGE_SEC) {
    return jsonResponse({ error: "Session expired" }, 401);
  }

  // Telegram Login Widget validation:
  // secret_key = SHA256(bot_token)
  // hash = HMAC-SHA256(data_check_string, secret_key)
  const dataCheckString = buildDataCheckString(user);
  const secretKey = await sha256Bytes(BOT_TOKEN);
  const computed = await hmacHex(secretKey, dataCheckString);

  if (computed !== hash) {
    return jsonResponse({ error: "Invalid hash" }, 401);
  }

  try {
    const email = tgEmail(userId);
    const password = await derivePassword(userId);

    let session;
    try {
      session = await signInWithPassword(email, password);
    } catch (e) {
      await ensureSupabaseUserExists(email, password, userId);
      session = await signInWithPassword(email, password);
    }

    const exp = now + (session.expires_in ? Math.max(0, session.expires_in) : 24 * 60 * 60);

    // Возвращаем минимум + user (для сайта, чтобы можно было зарегистрировать name без Mini App)
    return jsonResponse({
      token: session.access_token,
      user_id: userId,
      exp,
      user: {
        id: userId,
        first_name: safeString(user.first_name),
        last_name: safeString(user.last_name),
        username: safeString(user.username),
        photo_url: safeString(user.photo_url),
        auth_date: authDate,
      },
    });
  } catch (e) {
    return jsonResponse({ error: String(e?.message || e || "Auth error") }, 500);
  }
});
