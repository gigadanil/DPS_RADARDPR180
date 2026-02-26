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

  const fromUserMetadata = String(data.user?.user_metadata?.telegram_user_id || "").trim();
  const fromRawUserMetadata = String((data.user as any)?.raw_user_meta_data?.telegram_user_id || "").trim();
  let fromEmail = "";
  try {
    const email = String(data.user?.email || "").trim().toLowerCase();
    const m = email.match(/^tg_(\d+)@telegram\.local$/i);
    if (m?.[1]) fromEmail = m[1];
  } catch (_e) {}

  const tgId = fromUserMetadata || fromRawUserMetadata || fromEmail;
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

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const rawAction = String(payload?.action || "").trim().toLowerCase();
  const hasCode = !!String(payload?.code || payload?.p_code || "").trim();
  const hasUser = !!String(payload?.userId || payload?.p_user_id || "").trim();
  const hasAuthHeader = !!getBearerToken(req);

  let action = rawAction;
  if (!action) {
    // Совместимость со старыми/кэшированными клиентами:
    // если прилетел только код без action, трактуем как validate/claim.
    if (hasCode && hasUser) action = "claim";
    else if (hasCode && !hasAuthHeader) action = "validate";
    else action = "create";
  }

  // Публичные действия (до авторизации): проверка/применение кода ЗБТ
  if (action === "validate") {
    const code = String(payload?.code || payload?.p_code || "").trim().toUpperCase();
    if (!code) return jsonResponse({ error: "Missing code" }, 400);

    const { data, error } = await supabase
      .from("beta_invites")
      .select("id, code, is_active, max_uses, current_uses")
      .eq("code", code)
      .limit(1)
      .maybeSingle();

    if (error) return jsonResponse({ error: error.message }, 500);
    if (!data) return jsonResponse({ success: true, is_valid: false, message: "Код не найден" });
    if (!data.is_active) return jsonResponse({ success: true, is_valid: false, message: "Код отключен" });
    if (Number(data.current_uses || 0) >= Number(data.max_uses || 0)) {
      return jsonResponse({ success: true, is_valid: false, message: "Лимит использований исчерпан" });
    }

    return jsonResponse({
      success: true,
      is_valid: true,
      message: "Код валиден",
      invite: {
        id: data.id,
        code: data.code,
        max_uses: data.max_uses,
        current_uses: data.current_uses
      }
    });
  }

  if (action === "claim") {
    const code = String(payload?.code || payload?.p_code || "").trim().toUpperCase();
    const userId = String(payload?.userId || payload?.p_user_id || "").trim();
    if (!code) return jsonResponse({ error: "Missing code" }, 400);

    const { data, error } = await supabase
      .from("beta_invites")
      .select("id, is_active, max_uses, current_uses")
      .eq("code", code)
      .limit(1)
      .maybeSingle();

    if (error) return jsonResponse({ error: error.message }, 500);
    if (!data) return jsonResponse({ error: "Код не найден" }, 404);
    if (!data.is_active) return jsonResponse({ error: "Код отключен" }, 409);

    const currentUses = Number(data.current_uses || 0);
    const maxUses = Number(data.max_uses || 0);
    if (currentUses >= maxUses) {
      return jsonResponse({ error: "Лимит использований исчерпан" }, 409);
    }

    const { error: updateError } = await supabase
      .from("beta_invites")
      .update({ current_uses: currentUses + 1 })
      .eq("id", data.id)
      .eq("current_uses", currentUses);

    if (updateError) return jsonResponse({ error: updateError.message }, 500);

    return jsonResponse({ success: true, code, user_id: userId || null });
  }

  // Ниже — только админские действия
  const token = getBearerToken(req);
  let tgUserId = "";
  try {
    tgUserId = await getTelegramUserIdFromSupabaseAuth(supabase, token);
  } catch (e: any) {
    return jsonResponse({ error: String(e?.message || e || "Unauthorized") }, 401);
  }
  if (!ADMIN_IDS.has(tgUserId)) return jsonResponse({ error: "Admin only" }, 403);

  if (action === "list") {
    const { data, error } = await supabase
      .from("beta_invites")
      .select("id, code, max_uses, current_uses, is_active, created_at, description")
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ success: true, data: data || [] });
  }

  if (action === "deactivate") {
    const inviteId = Number(payload?.inviteId ?? payload?.id ?? 0);
    if (!Number.isFinite(inviteId) || inviteId <= 0) {
      return jsonResponse({ error: "Missing inviteId" }, 400);
    }

    const { error } = await supabase
      .from("beta_invites")
      .update({ is_active: false })
      .eq("id", inviteId);

    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ success: true, inviteId });
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
    created_by: tgUserId,
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
