// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const BOT_TOKEN = (Deno.env.get("TELEGRAM_BOT_TOKEN") || "").trim();
const JWT_SECRET = (Deno.env.get("JWT_SECRET") || "").trim();
const MAX_AUTH_AGE_SEC = 24 * 60 * 60;

const encoder = new TextEncoder();

function base64UrlEncode(input: Uint8Array): string {
  let str = "";
  for (let i = 0; i < input.length; i++) str += String.fromCharCode(input[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const encPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const data = `${encHeader}.${encPayload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return `${data}.${base64UrlEncode(new Uint8Array(sig))}`;
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

  if (!BOT_TOKEN || !JWT_SECRET) {
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

  const token = await signJwt({
    iss: "supabase",
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
    iat: now,
    exp: now + 60 * 60 * 24, // 24h
  });

  // Возвращаем минимум + user (для сайта, чтобы можно было зарегистрировать name без Mini App)
  return jsonResponse({
    token,
    user_id: userId,
    user: {
      id: userId,
      first_name: safeString(user.first_name),
      last_name: safeString(user.last_name),
      username: safeString(user.username),
      photo_url: safeString(user.photo_url),
      auth_date: authDate,
    },
  });
});
