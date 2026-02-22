// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "").trim();
const JWT_SECRET = (Deno.env.get("JWT_SECRET") || "").trim();
const ADMIN_IDS = new Set(
  (Deno.env.get("TELEGRAM_ADMIN_IDS") || "5118431735")
    .split(",")
    .map((id: any) => String(id).trim())
    .filter(Boolean)
);

const encoder = new TextEncoder();

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders()
  });
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

async function getTelegramUserIdFromRequest(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) throw new Error("Missing or invalid authorization token");
  const token = authHeader.slice("Bearer ".length).trim();
  const payload = await verifyJwtHs256(token);
  const sub = String(payload?.sub || "").trim();
  if (!sub) throw new Error("Invalid token payload");
  return sub;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Missing env config" }, 500);
  }

  let userId = "";
  try {
    userId = await getTelegramUserIdFromRequest(req);
  } catch (e: any) {
    return jsonResponse({ error: String(e?.message || e || "Unauthorized") }, 401);
  }
  if (!ADMIN_IDS.has(userId)) return jsonResponse({ error: "Admin only" }, 403);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const activeInput = payload?.active ?? payload?.enable;
  if (typeof activeInput === "undefined") {
    return jsonResponse({ error: "Missing active flag" }, 400);
  }

  const active = Boolean(activeInput);
  const message = payload?.message ? String(payload.message).trim().slice(0, 200) : "⚠️ Техническое обслуживание. Приносим извинения.";
  const meta = {
    active,
    message,
    updated_by: userId,
    timestamp: Date.now()
  };

  if (active) {
    const { error } = await supabase.from("app_maintenance").upsert({
      key: "maintenance_mode",
      value: JSON.stringify(meta)
    }, { onConflict: "key" });
    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }
    return jsonResponse({ success: true, active: true, message });
  }

  const { error } = await supabase.from("app_maintenance").delete().eq("key", "maintenance_mode");
  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }
  return jsonResponse({ success: true, active: false });
});
