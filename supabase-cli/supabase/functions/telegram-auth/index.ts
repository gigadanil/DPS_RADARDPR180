import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const JWT_SECRET = Deno.env.get("JWT_SECRET") || "";
const MAX_AUTH_AGE_SEC = 24 * 60 * 60;

const encoder = new TextEncoder();

function base64UrlEncode(input: Uint8Array): string {
  let str = "";
  for (let i = 0; i < input.length; i++) str += String.fromCharCode(input[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const buf = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return new Uint8Array(hash);
}

async function hmacHex(keyBytes: Uint8Array, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(msg));
  const bytes = new Uint8Array(sig);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
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
  const encSig = base64UrlEncode(new Uint8Array(sig));
  return `${data}.${encSig}`;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    }
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return jsonResponse({}, 204);

  if (!BOT_TOKEN || !JWT_SECRET) {
    return jsonResponse({ error: "Missing TELEGRAM_BOT_TOKEN or JWT_SECRET" }, 500);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let initData = "";
  try {
    const text = await req.text();
    if (text) {
      const parsed = JSON.parse(text);
      initData = String(parsed?.initData || "");
    }
  } catch (_e) {
    initData = "";
  }

  if (!initData) return jsonResponse({ error: "Missing initData" }, 400);

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return jsonResponse({ error: "Missing hash" }, 400);

  params.delete("hash");
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = await sha256Bytes(BOT_TOKEN);
  const computed = await hmacHex(secret, dataCheckString);
  if (computed !== hash) return jsonResponse({ error: "Invalid hash" }, 401);

  const authDate = Number(params.get("auth_date") || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!authDate || nowSec - authDate > MAX_AUTH_AGE_SEC) {
    return jsonResponse({ error: "Auth date expired" }, 401);
  }

  let userId = "";
  try {
    const user = JSON.parse(params.get("user") || "{}") as { id?: number | string };
    userId = String(user?.id || "");
  } catch (_e) {
    userId = "";
  }

  if (!userId) return jsonResponse({ error: "Missing user id" }, 400);

  const exp = nowSec + 60 * 60;
  const token = await signJwt({
    iss: "supabase",
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
    iat: nowSec,
    exp
  });

  return jsonResponse({ token, exp, user_id: userId });
});
