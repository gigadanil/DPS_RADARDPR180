// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "").trim();
const ADMIN_IDS = new Set(
  (Deno.env.get("TELEGRAM_ADMIN_IDS") || "5118431735")
    .split(",")
    .map((id: any) => String(id).trim())
    .filter(Boolean)
);

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

function getBearerToken(req: Request): string {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return "";
  return authHeader.slice("Bearer ".length).trim();
}

async function getTelegramUserIdFromSupabaseAuth(supabase: any, accessToken: string): Promise<string> {
  if (!accessToken) throw new Error("Missing token");

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) {
    throw new Error("Unauthorized");
  }

  const tgId = String(data.user?.user_metadata?.telegram_user_id || "").trim();
  if (!tgId) throw new Error("Missing telegram_user_id");
  return tgId;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Missing env config" }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const token = getBearerToken(req);
  let tgUserId = "";
  try {
    tgUserId = await getTelegramUserIdFromSupabaseAuth(supabase, token);
  } catch (e: any) {
    return jsonResponse({ error: String(e?.message || e || "Unauthorized") }, 401);
  }
  if (!ADMIN_IDS.has(tgUserId)) return jsonResponse({ error: "Admin only" }, 403);

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
    updated_by: tgUserId,
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
