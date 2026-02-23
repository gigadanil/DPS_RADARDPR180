// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const BOT_TOKEN = (Deno.env.get("TELEGRAM_BOT_TOKEN") || "").trim();
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE_KEY = (Deno.env.get("SERVICE_ROLE_KEY") || "").trim();
const MAX_AUTH_AGE_SEC = 24 * 60 * 60;

const encoder = new TextEncoder();

// HMAC-SHA256 в формате Hex
async function hmacHex(key: CryptoKey, msg: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function derivePassword(tgUserId: string): Promise<string> {
  // Детерминированный пароль, завязанный на BOT_TOKEN (секрет) + Telegram userId.
  // Никаких внешних секретов/конфига не требуется.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${BOT_TOKEN}:tg:${tgUserId}:sd180`)
  );
  // 64 hex chars — подходит как пароль.
  return bytesToHex(digest);
}

function tgEmail(tgUserId: string): string {
  // Валидный email, чтобы заводить пользователя в Supabase Auth.
  return `tg_${String(tgUserId)}@telegram.local`;
}

async function ensureSupabaseUserExists(email: string, password: string, tgUserId: string) {
  // Пробуем создать пользователя. Если уже существует — Supabase вернет 422, это ок.
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

  // Уже существует (обычно 422) — не считаем ошибкой.
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

function parseRawPairs(initData: string): Array<{ key: string; value: string }> {
  return initData
    .split("&")
    .map((part) => {
      const eq = part.indexOf("=");
      const key = eq === -1 ? part : part.slice(0, eq);
      const value = eq === -1 ? "" : part.slice(eq + 1);
      return { key, value };
    })
    .filter((pair) => pair.key.length > 0);
}

function buildDataCheckString(
  pairs: Array<{ key: string; value: string }>,
  { includeSignature, decodeValues }: { includeSignature: boolean; decodeValues: boolean }
): string {
  const prepared = pairs
    .filter((pair) => pair.key !== "hash")
    .filter((pair) => includeSignature || pair.key !== "signature")
    .map((pair) => {
      if (!decodeValues) return pair;
      try {
        return {
          key: pair.key,
          value: decodeURIComponent(pair.value.replace(/\+/g, "%20"))
        };
      } catch {
        return pair;
      }
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return prepared.map((pair) => `${pair.key}=${pair.value}`).join("\n");
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
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      }
    });
  }

  if (!BOT_TOKEN || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Missing Config" }, 500);
  }

  let initData = "";
  try {
    const body = await req.json();
    initData = String(body?.initData || "");
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!initData) return jsonResponse({ error: "Missing initData" }, 400);

  console.log("RAW initData received:", initData);
  console.log("initData length:", initData.length);

  // Парсим raw initData
  const hashMatch = initData.match(/hash=([a-f0-9]+)/);
  const hash = hashMatch ? hashMatch[1] : null;
  
  if (!hash) return jsonResponse({ error: "Missing hash" }, 400);

  const rawPairs = parseRawPairs(initData);
  const candidates = [
    {
      name: "decoded_without_signature",
      dataCheckString: buildDataCheckString(rawPairs, { includeSignature: false, decodeValues: true })
    },
    {
      name: "decoded_with_signature",
      dataCheckString: buildDataCheckString(rawPairs, { includeSignature: true, decodeValues: true })
    },
    {
      name: "raw_without_signature",
      dataCheckString: buildDataCheckString(rawPairs, { includeSignature: false, decodeValues: false })
    },
    {
      name: "raw_with_signature",
      dataCheckString: buildDataCheckString(rawPairs, { includeSignature: true, decodeValues: false })
    }
  ];

  // 4. ВАЛИДАЦИЯ (АЛГОРИТМ TELEGRAM)
  // Правильно: secret_key = HMAC-SHA256("WebAppData", BOT_TOKEN)
  const webAppDataKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const secretKeyBytes = await crypto.subtle.sign("HMAC", webAppDataKey, encoder.encode(BOT_TOKEN));
  
  const finalKey = await crypto.subtle.importKey(
    "raw",
    secretKeyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const computedByVariant: Record<string, string> = {};
  for (const variant of candidates) {
    computedByVariant[variant.name] = await hmacHex(finalKey, variant.dataCheckString);
  }

  const matchedVariant = Object.entries(computedByVariant).find(([, digest]) => digest === hash)?.[0] ?? null;

  console.log("FULL BOT_TOKEN DEBUG:", {
    fullToken: BOT_TOKEN,
    length: BOT_TOKEN.length,
    first20Chars: BOT_TOKEN.substring(0, 20),
    last20Chars: BOT_TOKEN.substring(BOT_TOKEN.length - 20)
  });

  console.log("Hash comparison:", {
    computedByVariant,
    expected: hash,
    match: Boolean(matchedVariant),
    matchedVariant,
    botTokenLength: BOT_TOKEN.length,
    botTokenEnd: BOT_TOKEN.slice(-10)
  });

  if (!matchedVariant) {
    console.error("Auth Failed. Candidate strings:", candidates.map(c => ({ name: c.name, dataCheckString: c.dataCheckString })));
    return jsonResponse({ error: "Invalid hash", debug: { computedByVariant, expected: hash } }, 401);
  }

  // 3. ИЗВЛЕЧЕНИЕ ДАННЫХ И ГЕНЕРАЦИЯ JWT
  const authDateMatch = initData.match(/auth_date=(\d+)/);
  const authDate = authDateMatch ? Number(authDateMatch[1]) : 0;
  const now = Math.floor(Date.now() / 1000);

  if (now - authDate > MAX_AUTH_AGE_SEC) {
    return jsonResponse({ error: "Session expired" }, 401);
  }
  
  // Извлекаем user - нужно декодировать URL-encoded значение
  const userMatch = initData.match(/user=([^&]+)/);
  let userId = "";
  if (userMatch) {
    try {
      const userStr = decodeURIComponent(userMatch[1]);
      const user = JSON.parse(userStr);
      userId = String(user.id || "");
    } catch {
      return jsonResponse({ error: "Invalid user field" }, 400);
    }
  }

  // Вместо самоподписанного JWT (который Supabase может не принимать из-за ключей/алгоритма)
  // выпускаем настоящий access_token через Supabase Auth (GoTrue).
  try {
    const email = tgEmail(userId);
    const password = await derivePassword(userId);

    let session;
    try {
      session = await signInWithPassword(email, password);
    } catch (e) {
      // Если пользователь еще не создан — создаем и пробуем снова.
      await ensureSupabaseUserExists(email, password, userId);
      session = await signInWithPassword(email, password);
    }

    const exp = now + (session.expires_in ? Math.max(0, session.expires_in) : 24 * 60 * 60);
    return jsonResponse({ token: session.access_token, user_id: userId, exp });
  } catch (e) {
    return jsonResponse({ error: String(e?.message || e || "Auth error") }, 500);
  }
});