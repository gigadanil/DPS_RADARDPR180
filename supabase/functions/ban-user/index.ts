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

function normalizeBanType(value: unknown): "temp" | "permanent" {
  const normalized = String(value || "temp").toLowerCase();
  return normalized === "permanent" ? "permanent" : "temp";
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

  const targetUserId = String(payload?.targetUserId ?? payload?.userId ?? "").trim();
  const bannedUntilInput = payload?.bannedUntil ?? payload?.banned_until;
  if (!targetUserId) {
    return jsonResponse({ error: "Missing targetUserId" }, 400);
  }
  if (!bannedUntilInput) {
    return jsonResponse({ error: "Missing bannedUntil" }, 400);
  }

  const bannedUntilDate = new Date(String(bannedUntilInput));
  if (Number.isNaN(bannedUntilDate.valueOf())) {
    return jsonResponse({ error: "Invalid bannedUntil value" }, 400);
  }

  const banType = normalizeBanType(payload?.banType ?? payload?.ban_type);
  const reason = payload?.reason ? String(payload.reason).trim().slice(0, 250) : null;

  const { error } = await supabase.rpc('ban_user_admin', {
    p_admin_user_id: user.id,
    p_target_user_id: targetUserId,
    p_banned_until: bannedUntilDate.toISOString(),
    p_ban_type: banType,
    p_reason: reason
  });

  if (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  return jsonResponse({ success: true, targetUserId, banType, bannedUntil: bannedUntilDate.toISOString() });
});
