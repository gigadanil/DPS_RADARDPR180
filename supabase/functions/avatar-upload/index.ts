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
    "Access-Control-Allow-Headers": "content-type, authorization, apikey",
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

function parseDataUrl(input: string): { mime: string; bytes: Uint8Array } {
  const raw = String(input || "").trim();
  const m = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\n\r]+)$/);
  if (!m) throw new Error("Invalid image data url");
  const mime = m[1].toLowerCase();
  const b64 = m[2].replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { mime, bytes: out };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ ok: false, error: "Missing env config" }, 500);
  }

  let userId = "";
  try {
    userId = await getUserIdFromAuth(req);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e?.message || e || "Unauthorized") }, 401);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const imageDataUrl = String(body?.image_data_url || "");
  if (!imageDataUrl) return jsonResponse({ ok: false, error: "Missing image_data_url" }, 400);

  let parsed;
  try {
    parsed = parseDataUrl(imageDataUrl);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e?.message || e) }, 400);
  }

  const bytes = parsed.bytes;
  if (!bytes?.length) return jsonResponse({ ok: false, error: "Empty image" }, 400);
  if (bytes.length > 5 * 1024 * 1024) return jsonResponse({ ok: false, error: "Image too large" }, 413);

  const ext = parsed.mime.includes("png") ? "png" : "jpg";
  const path = `${userId}/${Date.now()}.${ext}`;
  const bucketCandidates = ["avatars", "media", "uploads"];

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let lastError: any = null;
  for (const bucket of bucketCandidates) {
    const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
      upsert: true,
      contentType: parsed.mime
    });

    if (!error) {
      const publicData = supabase.storage.from(bucket).getPublicUrl(path);
      const publicUrl = String(publicData?.data?.publicUrl || "");
      if (!publicUrl) return jsonResponse({ ok: false, error: "Public URL unavailable" }, 500);
      return jsonResponse({ ok: true, public_url: publicUrl, bucket, path });
    }

    lastError = error;
    const msg = String(error?.message || error?.error || "").toLowerCase();
    const maybeMissingBucket = msg.includes("bucket") && msg.includes("not found");
    if (!maybeMissingBucket) {
      return jsonResponse({ ok: false, error: String(error?.message || error?.error || "Upload failed") }, 400);
    }
  }

  return jsonResponse({ ok: false, error: String(lastError?.message || "No storage bucket available") }, 400);
});
