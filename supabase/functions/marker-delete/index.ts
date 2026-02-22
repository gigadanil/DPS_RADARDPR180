import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Проверка, является ли пользователь администратором
function isAdmin(userId: string): boolean {
  return userId === "5118431735";
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, authorization",
      "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS"
    }
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return jsonResponse({}, 204);

  if (req.method !== "DELETE" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Получаем JWT токен из заголовка Authorization
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing or invalid authorization token" }, 401);
  }

  const token = authHeader.replace("Bearer ", "");
  
  // Создаём клиент с JWT токеном пользователя (не service_role!)
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${token}` }
    }
  });

  // Получаем данные пользователя из JWT
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    return jsonResponse({ error: "Invalid or expired token" }, 401);
  }

  const userId = user.id;

  let markerId: number;
  try {
    const body = await req.json();
    markerId = Number(body?.marker_id || 0);
  } catch (_e) {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  if (!markerId) {
    return jsonResponse({ error: "Missing marker_id" }, 400);
  }

  // Проверяем, что метка принадлежит пользователю или он админ
  const { data: marker, error: fetchError } = await supabase
    .from("markers")
    .select("author_id")
    .eq("id", markerId)
    .single();

  if (fetchError || !marker) {
    return jsonResponse({ error: "Marker not found" }, 404);
  }

  const isOwner = marker.author_id === userId;
  const isUserAdmin = isAdmin(userId);

  if (!isOwner && !isUserAdmin) {
    return jsonResponse({ error: "Permission denied: you can only delete your own markers" }, 403);
  }

  // Удаляем метку (RLS политики применятся автоматически)
  const { error } = await supabase
    .from("markers")
    .delete()
    .eq("id", markerId);

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({ 
    success: true, 
    message: "Marker deleted",
    deleted_by: isUserAdmin ? "admin" : "owner"
  });
});
