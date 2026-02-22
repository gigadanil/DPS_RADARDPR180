import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ADMIN_IDS = new Set(
  (Deno.env.get("TELEGRAM_ADMIN_IDS") || "5118431735")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

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
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing or invalid authorization token" }, 401);
  }

  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonResponse({ error: "Invalid or expired token" }, 401);
  }
  if (!ADMIN_IDS.has(user.id)) {
    return jsonResponse({ error: "Admin only" }, 403);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const code = String(payload?.code || "").trim().toUpperCase();
  const maxUsesRaw = Number(payload?.maxUses ?? payload?.count ?? 1);
  const maxUses = Math.max(1, Math.min(100, Number.isFinite(maxUsesRaw) ? maxUsesRaw : 1));
  const description = payload?.description ? String(payload.description).trim().slice(0, 200) : null;
  const expiresInput = payload?.expiresAt ?? payload?.expires_at ?? null;

  if (!code) {
    return jsonResponse({ error: "Missing code" }, 400);
  }

  let expiresAt: string | null = null;
  if (expiresInput) {
    const parsed = new Date(expiresInput as string);
    if (!Number.isNaN(parsed.valueOf())) {
      expiresAt = parsed.toISOString();
    }
  }

  const row: Record<string, unknown> = {
    code,
    max_uses: maxUses,
    description,
    created_by: user.id,
    created_at: new Date().toISOString()
  };
  if (expiresAt) {
    row.expires_at = expiresAt;
  }

  const { error } = await supabase.from("beta_invites").insert(row);
  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return jsonResponse({ error: error.message }, status);
  }

  return jsonResponse({ success: true, code, max_uses: maxUses, description });
});
