// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TELEGRAM_HELP_BOT_TOKEN = (Deno.env.get("TELEGRAM_HELP_BOT_TOKEN") || "").trim();
const SERVICE_ROLE_KEY = (Deno.env.get("SERVICE_ROLE_KEY") || "").trim();
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const WEBHOOK_SECRET = (Deno.env.get("TELEGRAM_HELP_WEBHOOK_SECRET") || "").trim();
const MINIAPP_URL = (Deno.env.get("MINIAPP_URL") || "https://t.me/DPSRADARDPR180bot").trim();
const TELEGRAM_MINIAPP_SHORT_NAME = (Deno.env.get("TELEGRAM_MINIAPP_SHORT_NAME") || "").trim();
const TELEGRAM_MAIN_BOT_USERNAME = (Deno.env.get("TELEGRAM_MAIN_BOT_USERNAME") || "").replace(/^@/, "").trim();
const ABOUT_BUTTON_TEXT = "🛡 О проекте";
const ABOUT_PROJECT_TEXT = [
  "🛡 SafeDrive 180 — Дороги под контролем",
  "",
  "Что такое SafeDrive 180?",
  "Это интерактивная карта и система оповещений для водителей нашего региона. Проект создан, чтобы каждый из нас знал о ситуации на дороге раньше, чем попадет в пробку или гололед.",
  "",
  "Кто это делает?",
  "За разработкой стоит один человек — я, студент, пишущий код под псевдонимом DjokerDPR. Я сам занимаюсь всем: от дизайна интерфейса до настройки серверов и парсинга данных МЧС.",
  "",
  "Что вы найдете в проекте:",
  "",
  "📍 Живая карта: Актуальные метки ДТП, опасностей и постов ДПС в реальном времени.",
  "🆘 Кнопка SOS: Возможность быстро запросить помощь, если вы застряли или сломались.",
  "⚡️ Оповещения МЧС: Мгновенные штормовые предупреждения (сейчас в процессе доработки до идеала).",
  "🔊 Голосовой штурман: (В разработке) Бот будет сам озвучивать важные события, чтобы вы не отвлекались от руля.",
  "",
  "Почему это важно?",
  "Я делаю этот сервис «от своих для своих». Здесь нет корпоративной цензуры или лишнего шума — только то, что реально помогает водителю выжить и сохранить машину на наших непростых дорогах.",
  "",
  "Текущий статус:",
  "Сейчас проект находится на финальном этапе техобслуживания. Я завершаю настройку безопасности данных и жду восстановления стабильного интернета от провайдера, чтобы залить финальное обновление кода.",
  "",
  "Присоединяйтесь к сообществу и следите за обновлениями. Вместе мы сделаем наши поездки безопаснее!",
  "",
  "Ваш DjokerDPR. 🏎️💨🧱"
].join("\n");
const ADMIN_IDS = new Set(
  String(Deno.env.get("TELEGRAM_HELP_ADMIN_IDS") || "5118431735")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization, x-telegram-bot-api-secret-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

async function tgSendMessage(chatId: string, text: string, replyMarkup?: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${TELEGRAM_HELP_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
      disable_web_page_preview: true
    })
  });
}

async function tgAnswerCallbackQuery(callbackQueryId: string, text?: string, showAlert = false) {
  const id = String(callbackQueryId || "").trim();
  if (!id) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_HELP_BOT_TOKEN}/answerCallbackQuery`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: id,
      ...(text ? { text } : {}),
      ...(showAlert ? { show_alert: true } : {})
    })
  }).catch(() => {});
}

async function tgEditMessageReplyMarkup(chatId: string, messageId: number, replyMarkup?: Record<string, unknown>) {
  const cid = String(chatId || "").trim();
  const mid = Number(messageId);
  if (!cid || !Number.isFinite(mid) || mid <= 0) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_HELP_BOT_TOKEN}/editMessageReplyMarkup`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: cid,
      message_id: mid,
      reply_markup: replyMarkup ?? { inline_keyboard: [] }
    })
  }).catch(() => {});
}

async function tgSendMessageWithButton(chatId: string, text: string, buttonText: string, buttonUrl: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_HELP_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [[
          { text: buttonText, url: buttonUrl }
        ]]
      },
      disable_web_page_preview: true
    })
  });
}

async function dbSelectSubscriber(chatId: string) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/telegram_help_subscribers`);
  url.searchParams.set("select", "chat_id,user_id,radius_km,is_active,home_lat,home_lon,updated_at");
  url.searchParams.set("chat_id", `eq.${chatId}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    }
  });

  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function dbSelectSubscriberByUserId(userId: string) {
  const uid = String(userId || "").trim();
  if (!uid) return null;

  const url = new URL(`${SUPABASE_URL}/rest/v1/telegram_help_subscribers`);
  url.searchParams.set("select", "chat_id,user_id,is_active");
  url.searchParams.set("user_id", `eq.${uid}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    }
  });

  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function dbSelectMarkerById(markerId: number) {
  const id = Number(markerId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const url = new URL(`${SUPABASE_URL}/rest/v1/markers`);
  url.searchParams.set("select", "id,type,author_id");
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    }
  });

  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function dbSelectDriverName(userId: string): Promise<string | null> {
  const uid = String(userId || "").trim();
  if (!uid) return null;

  const url = new URL(`${SUPABASE_URL}/rest/v1/drivers`);
  url.searchParams.set("select", "name");
  url.searchParams.set("user_id", `eq.${uid}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    }
  });
  if (!res.ok) return null;
  const rows = await res.json();
  const name = Array.isArray(rows) && rows.length ? String(rows[0]?.name || "").trim() : "";
  return name || null;
}

async function dbMarkSosArrived(markerId: number, userId: string): Promise<boolean> {
  const mid = Number(markerId);
  const uid = String(userId || "").trim();
  if (!Number.isFinite(mid) || mid <= 0 || !uid) return false;

  const url = new URL(`${SUPABASE_URL}/rest/v1/sos_enroute`);
  url.searchParams.set("marker_id", `eq.${mid}`);
  url.searchParams.set("user_id", `eq.${uid}`);

  // Try new schema (status/arrived_at)
  const patch = { status: "arrived", arrived_at: new Date().toISOString() };
  let res = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify(patch)
  });

  if (!res.ok) {
    // Fallback for older schema: do nothing, but don't fail the whole flow.
    return false;
  }

  try {
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return true;
  }
}

async function dbHasSosEnrouteRow(markerId: number, userId: string): Promise<boolean> {
  const mid = Number(markerId);
  const uid = String(userId || "").trim();
  if (!Number.isFinite(mid) || mid <= 0 || !uid) return false;

  const url = new URL(`${SUPABASE_URL}/rest/v1/sos_enroute`);
  url.searchParams.set("select", "id");
  url.searchParams.set("marker_id", `eq.${mid}`);
  url.searchParams.set("user_id", `eq.${uid}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    }
  });

  if (!res.ok) return false;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

async function dbSelectActiveSubscribers() {
  const url = new URL(`${SUPABASE_URL}/rest/v1/telegram_help_subscribers`);
  url.searchParams.set("select", "chat_id");
  url.searchParams.set("is_active", "eq.true");

  const res = await fetch(url.toString(), {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    }
  });

  if (!res.ok) return [];
  const rows = await res.json();
  return Array.isArray(rows) ? rows.map((r: any) => String(r.chat_id || "").trim()).filter(Boolean) : [];
}

async function dbUpsertSubscriber(row: Record<string, unknown>) {
  const url = `${SUPABASE_URL}/rest/v1/telegram_help_subscribers?on_conflict=chat_id`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify([row])
  });
  return res.ok;
}

async function dbUpdateSubscriber(chatId: string, patch: Record<string, unknown>) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/telegram_help_subscribers`);
  url.searchParams.set("chat_id", `eq.${chatId}`);
  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  return res.ok;
}

async function dbListMchsAlerts(limit = 10) {
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 10));
  const url = new URL(`${SUPABASE_URL}/rest/v1/mchs_alerts`);
  url.searchParams.set("select", "id,title,pub_date,created_at");
  url.searchParams.set("order", "pub_date.desc,created_at.desc");
  url.searchParams.set("limit", String(safeLimit));

  const res = await fetch(url.toString(), {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    }
  });

  if (!res.ok) return [];
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

async function dbDeleteMchsAlertById(id: number) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/mchs_alerts`);
  url.searchParams.set("id", `eq.${id}`);
  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    }
  });
  return res.ok;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function dbInsertManualMchsAlert(eventText: string, recommendationText: string) {
  const sourceHash = await sha256Hex(`manual|${new Date().toISOString()}|${eventText}|${recommendationText}`);
  const url = `${SUPABASE_URL}/rest/v1/mchs_alerts`;
  const body = [{
    source_hash: sourceHash,
    title: "Обновление SafeDrive",
    source_link: null,
    pub_date: new Date().toISOString(),
    hazard_text: eventText,
    recommendation_text: recommendationText,
    full_text: `${eventText}. ${recommendationText}`,
    image_url: null,
    is_sent: true,
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }];

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function parseCommand(text: string) {
  const normalized = String(text || "").trim();
  if (!normalized.startsWith("/")) return { cmd: "", arg: "" };
  const firstSpace = normalized.indexOf(" ");
  const first = firstSpace >= 0 ? normalized.slice(0, firstSpace) : normalized;
  const cmd = first.split("@")[0].toLowerCase();
  const arg = firstSpace >= 0 ? normalized.slice(firstSpace + 1).trim() : "";
  return { cmd, arg };
}

function buildMchsAlert(arg: string) {
  const now = new Date();
  const dateRu = now.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

  let eventText = "Сильный туман, видимость 50-100 метров.";
  let recommendationText = "Соблюдайте дистанцию, включите противотуманные фары. Берегите себя!";

  if (arg && arg.includes("|")) {
    const parts = arg.split("|").map((s) => s.trim());
    if (parts[0]) eventText = parts[0];
    if (parts[1]) recommendationText = parts[1];
  }

  const text = [
    "⚠️ ЭКСТРЕННОЕ ПРЕДУПРЕЖДЕНИЕ МЧС",
    `📅 На сегодня: ${dateRu}`,
    `🌨 Событие: ${eventText}`,
    `🛣 Рекомендация: ${recommendationText}`
  ].join("\n");

  return text;
}

function parseMchsManual(arg: string) {
  const raw = String(arg || "").trim();
  if (!raw) {
    return {
      eventText: "Обновление сервиса SafeDrive.",
      recommendationText: "Проверьте обновления приложения и будьте внимательны на дороге."
    };
  }

  if (raw.includes("|")) {
    const [eventText, recommendationText] = raw.split("|").map((s) => s.trim());
    return {
      eventText: eventText || "Обновление сервиса SafeDrive.",
      recommendationText: recommendationText || "Проверьте обновления приложения и будьте внимательны на дороге."
    };
  }

  return {
    eventText: raw,
    recommendationText: "Следите за сообщениями в разделе «Уведомления» приложения SafeDrive."
  };
}

function buildMiniappOpenUrl(base: string): string {
  const buildByBotUsername = (username: string) => {
    const bot = String(username || "").replace(/^@/, "").trim();
    if (!bot) return "";
    if (TELEGRAM_MINIAPP_SHORT_NAME) {
      return `https://t.me/${bot}/${encodeURIComponent(TELEGRAM_MINIAPP_SHORT_NAME)}?startapp=map`;
    }
    return `https://t.me/${bot}?startapp=map`;
  };

  if (TELEGRAM_MAIN_BOT_USERNAME) {
    const direct = buildByBotUsername(TELEGRAM_MAIN_BOT_USERNAME);
    if (direct) return direct;
  }

  try {
    const url = new URL(base);
    const host = url.hostname.toLowerCase();
    const isTelegramLink = host === "t.me" || host === "telegram.me";

    if (isTelegramLink) {
      const path = url.pathname.replace(/^\/+/, "").trim();
      if (path) {
        const botName = path.split("/")[0];
        const direct = buildByBotUsername(botName);
        if (direct) return direct;
      }
      url.searchParams.set("startapp", "map");
      return url.toString();
    }

    return url.toString();
  } catch {
    return base;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405);

  if (!TELEGRAM_HELP_BOT_TOKEN || !SERVICE_ROLE_KEY || !SUPABASE_URL) {
    return jsonResponse({ ok: false, error: "Missing env config" }, 500);
  }

  if (!WEBHOOK_SECRET) {
    return jsonResponse({ ok: false, error: "Missing TELEGRAM_HELP_WEBHOOK_SECRET" }, 500);
  }

  const incoming = req.headers.get("x-telegram-bot-api-secret-token") || "";
  if (incoming !== WEBHOOK_SECRET) {
    return jsonResponse({ ok: false, error: "Invalid webhook secret" }, 401);
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  const callbackQuery = body?.callback_query;
  if (callbackQuery) {
    const callbackQueryId = String(callbackQuery?.id || "").trim();
    const fromId = String(callbackQuery?.from?.id || "").trim();
    const data = String(callbackQuery?.data || "").trim();
    const chatId = String(callbackQuery?.message?.chat?.id || "").trim();
    const messageId = Number(callbackQuery?.message?.message_id || 0);

    if (!data) {
      await tgAnswerCallbackQuery(callbackQueryId);
      return jsonResponse({ ok: true, action: "callback-empty" });
    }

    if (data.startsWith("sos_arrived:")) {
      const markerId = Number(data.slice("sos_arrived:".length));
      if (!Number.isFinite(markerId) || markerId <= 0) {
        await tgAnswerCallbackQuery(callbackQueryId, "Ошибка: неверный SOS ID");
        return jsonResponse({ ok: true, action: "sos-arrived-invalid" });
      }

      const marker = await dbSelectMarkerById(markerId);
      if (!marker || String(marker?.type || "") !== "sos") {
        await tgAnswerCallbackQuery(callbackQueryId, "Ошибка: SOS не найден");
        return jsonResponse({ ok: true, action: "sos-arrived-not-found" });
      }

      const hasRow = await dbHasSosEnrouteRow(markerId, fromId);
      if (!hasRow) {
        await tgAnswerCallbackQuery(callbackQueryId, "Сначала нажмите «Я в пути» ✅");
        return jsonResponse({ ok: true, action: "sos-arrived-no-row" });
      }

      // Mark arrived (best-effort; requires migrated schema)
      await dbMarkSosArrived(markerId, fromId);

      // Remove button to avoid repeated taps
      if (chatId && Number.isFinite(messageId) && messageId > 0) {
        await tgEditMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      }

      const rescuerName = (await dbSelectDriverName(fromId)) || `#${fromId}`;
      const victimUserId = String(marker?.author_id || "").trim();

      // Popup to rescuer (on-screen toast/alert)
      await tgAnswerCallbackQuery(
        callbackQueryId,
        "Мужик, ты лучший! Спасибо за взаимовыручку. DjokerDPR и сообщество ценят твой поступок. 🤝",
        true
      );

      // Notify victim
      if (victimUserId) {
        const victimSub = await dbSelectSubscriberByUserId(victimUserId);
        const victimChat = String(victimSub?.chat_id || victimUserId).trim();
        if (victimChat) {
          await tgSendMessage(
            victimChat,
            [
              "✅ Помощь прибыла!",
              `Спасатель ${rescuerName} уже рядом.`,
              "Спасибо, что пользуешься SafeDrive 180!"
            ].join("\n")
          );
        }
      }

      // (Popup already shown above)
      return jsonResponse({ ok: true, action: "sos-arrived", markerId });
    }

    await tgAnswerCallbackQuery(callbackQueryId);
    return jsonResponse({ ok: true, action: "callback-ignored" });
  }

  const message = body?.message || body?.edited_message;
  const text = String(message?.text || "");
  const chatId = String(message?.chat?.id || "").trim();
  const fromId = String(message?.from?.id || "").trim();
  const normalizedText = text.trim();
  const location = message?.location;

  if (!chatId) {
    return jsonResponse({ ok: true, skipped: true });
  }

  const { cmd, arg } = parseCommand(text);
  const isAboutRequest = normalizedText === ABOUT_BUTTON_TEXT || cmd === "/about";

  try {
    // Location update (sent via Telegram request_location button)
    if (location && chatId) {
      const lat = Number(location?.latitude);
      const lon = Number(location?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        await tgSendMessage(chatId, "⚠️ Не удалось прочитать геопозицию. Попробуйте ещё раз: /sethome");
        return jsonResponse({ ok: true, action: "sethome-invalid" });
      }

      const existing = await dbSelectSubscriber(chatId);
      if (existing) {
        await dbUpdateSubscriber(chatId, { home_lat: lat, home_lon: lon, is_active: true, user_id: fromId });
      } else {
        await dbUpsertSubscriber({
          user_id: fromId,
          chat_id: chatId,
          is_active: true,
          radius_km: 10,
          home_lat: lat,
          home_lon: lon,
          updated_at: new Date().toISOString()
        });
      }

      await tgSendMessage(chatId, `✅ Опорная точка сохранена: ${lat.toFixed(5)}, ${lon.toFixed(5)}\nТеперь уведомления ДПС/Спецполк будут приходить по радиусу.`);
      return jsonResponse({ ok: true, action: "sethome", lat, lon });
    }

    if (isAboutRequest) {
      await tgSendMessage(chatId, ABOUT_PROJECT_TEXT);
      return jsonResponse({ ok: true, action: "about" });
    }

    if (!text.startsWith("/")) {
      return jsonResponse({ ok: true, skipped: true });
    }

    if (cmd === "/start") {
      const existing = await dbSelectSubscriber(chatId);
      const radius = Number(existing?.radius_km || 10);
      await dbUpsertSubscriber({
        user_id: fromId,
        chat_id: chatId,
        is_active: true,
        radius_km: Math.max(1, Math.min(100, radius || 10)),
        updated_at: new Date().toISOString()
      });

      await tgSendMessage(
        chatId,
        "✅ Вы подписаны на уведомления взаимопомощи.\n\n" +
          "Команды:\n" +
          "/about — о проекте\n" +
          "/sethome — задать опорную точку (для радиуса)\n" +
          "/radius 10 — изменить радиус в км\n" +
          "/stop — отключить уведомления\n" +
          "/start — включить снова",
        {
          keyboard: [[{ text: ABOUT_BUTTON_TEXT }]],
          resize_keyboard: true
        }
      );

      return jsonResponse({ ok: true, action: "start" });
    }

    if (cmd === "/status") {
      const existing = await dbSelectSubscriber(chatId);
      if (!existing) {
        await tgSendMessage(
          chatId,
          "ℹ️ Вы ещё не подписаны. Отправьте /start, чтобы включить уведомления."
        );
        return jsonResponse({ ok: true, action: "status", subscribed: false });
      }

      const lat = existing?.home_lat;
      const lon = existing?.home_lon;
      const latNum = Number(lat);
      const lonNum = Number(lon);
      const hasCoords = Number.isFinite(latNum) && Number.isFinite(lonNum) && !(Math.abs(latNum) < 1e-9 && Math.abs(lonNum) < 1e-9);
      const coordsText = hasCoords ? `${latNum.toFixed(5)}, ${lonNum.toFixed(5)}` : "не заданы";

      await tgSendMessage(
        chatId,
        [
          "📌 Статус подписки SafeDrive",
          `chat_id: ${String(existing?.chat_id || "")}`,
          `user_id: ${String(existing?.user_id || "")}`,
          `Активно: ${existing?.is_active ? "да" : "нет"}`,
          `Радиус: ${Number(existing?.radius_km || 10)} км`,
          `Опорная точка: ${coordsText}`,
          "",
          "Команды:",
          "/radius 10 — изменить радиус",
          "/stop — отключить",
          "/start — включить"
        ].join("\n")
      );
      return jsonResponse({ ok: true, action: "status", subscribed: true });
    }

    if (cmd === "/sethome") {
      await tgSendMessage(
        chatId,
        "📍 Отправьте вашу геопозицию, чтобы бот понимал центр радиуса уведомлений.\n\nНажмите кнопку ниже:",
        {
          keyboard: [[{ text: "📍 Отправить геопозицию", request_location: true }]],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      );
      return jsonResponse({ ok: true, action: "sethome-request" });
    }

    if (cmd === "/stop") {
      await dbUpdateSubscriber(chatId, { is_active: false });
      await tgSendMessage(chatId, "⏸ Уведомления отключены. Для включения отправьте /start");
      return jsonResponse({ ok: true, action: "stop" });
    }

    if (cmd === "/radius") {
      const parsed = Number(arg);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
        await tgSendMessage(chatId, "⚠️ Используйте: /radius 1..100\nПример: /radius 15");
        return jsonResponse({ ok: true, action: "radius-invalid" });
      }
      const radius = Math.round(parsed);
      const existing = await dbSelectSubscriber(chatId);
      if (existing) {
        await dbUpdateSubscriber(chatId, { radius_km: radius, is_active: true, user_id: fromId });
      } else {
        await dbUpsertSubscriber({
          user_id: fromId,
          chat_id: chatId,
          is_active: true,
          radius_km: radius,
          updated_at: new Date().toISOString()
        });
      }
      await tgSendMessage(chatId, `✅ Радиус уведомлений обновлён: ${radius} км`);
      return jsonResponse({ ok: true, action: "radius", radius });
    }

    if (cmd === "/mchs") {
      if (!ADMIN_IDS.has(fromId)) {
        await tgSendMessage(chatId, "⛔ Команда доступна только администраторам.");
        return jsonResponse({ ok: true, action: "mchs-forbidden" });
      }

      const text = buildMchsAlert(arg);
      const mapUrl = buildMiniappOpenUrl(MINIAPP_URL);
      const recipients = await dbSelectActiveSubscribers();
      let sent = 0;

      for (const targetChatId of recipients) {
        try {
          await tgSendMessageWithButton(targetChatId, text, "📍 Открыть карту SafeDrive 180", mapUrl);
          sent += 1;
        } catch {
          // ignore individual failures
        }
      }

      await tgSendMessage(chatId, `✅ Рассылка МЧС выполнена. Доставлено: ${sent}/${recipients.length}\n🔗 mapUrl: ${mapUrl}`);
      return jsonResponse({ ok: true, action: "mchs", sent, total: recipients.length, mapUrl });
    }

    if (cmd === "/mchslist") {
      if (!ADMIN_IDS.has(fromId)) {
        await tgSendMessage(chatId, "⛔ Команда доступна только администраторам.");
        return jsonResponse({ ok: true, action: "mchslist-forbidden" });
      }

      const limit = Number(arg || 10);
      const rows = await dbListMchsAlerts(limit);
      if (!rows.length) {
        await tgSendMessage(chatId, "ℹ️ Список МЧС уведомлений пуст.");
        return jsonResponse({ ok: true, action: "mchslist", count: 0 });
      }

      const text = rows.map((r: any) => {
        const d = r?.pub_date || r?.created_at || "";
        return `#${r.id} • ${String(r.title || "Без заголовка")} • ${String(d).slice(0, 16).replace("T", " ")}`;
      }).join("\n");

      await tgSendMessage(chatId, `📋 Последние МЧС уведомления:\n${text}`);
      return jsonResponse({ ok: true, action: "mchslist", count: rows.length });
    }

    if (cmd === "/mchsdel") {
      if (!ADMIN_IDS.has(fromId)) {
        await tgSendMessage(chatId, "⛔ Команда доступна только администраторам.");
        return jsonResponse({ ok: true, action: "mchsdel-forbidden" });
      }

      const id = Number(arg || 0);
      if (!Number.isFinite(id) || id <= 0) {
        await tgSendMessage(chatId, "⚠️ Используйте: /mchsdel ID\nПример: /mchsdel 15");
        return jsonResponse({ ok: true, action: "mchsdel-invalid" });
      }

      const ok = await dbDeleteMchsAlertById(id);
      await tgSendMessage(chatId, ok ? `✅ Уведомление #${id} удалено.` : `⚠️ Не удалось удалить #${id}.`);
      return jsonResponse({ ok: true, action: "mchsdel", id, deleted: ok });
    }

    if (cmd === "/mchsadd") {
      if (!ADMIN_IDS.has(fromId)) {
        await tgSendMessage(chatId, "⛔ Команда доступна только администраторам.");
        return jsonResponse({ ok: true, action: "mchsadd-forbidden" });
      }

      const { eventText, recommendationText } = parseMchsManual(arg);
      const text = [
        "⚠️ ВАЖНОЕ ОБНОВЛЕНИЕ SAFEDRIVE",
        `📅 На сегодня: ${new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`,
        `📰 Событие: ${eventText}`,
        `🛣 Рекомендация: ${recommendationText}`
      ].join("\n");

      const mapUrl = buildMiniappOpenUrl(MINIAPP_URL);
      const recipients = await dbSelectActiveSubscribers();
      let sent = 0;

      for (const targetChatId of recipients) {
        try {
          await tgSendMessageWithButton(targetChatId, text, "📍 Открыть карту SafeDrive 180", mapUrl);
          sent += 1;
        } catch {
          // ignore individual failures
        }
      }

      const inserted = await dbInsertManualMchsAlert(eventText, recommendationText);
      const insertedId = Number(inserted?.id || 0);
      await tgSendMessage(chatId, `✅ Ручное уведомление отправлено: ${sent}/${recipients.length}${insertedId ? `\nID: ${insertedId}` : ""}`);
      return jsonResponse({ ok: true, action: "mchsadd", sent, total: recipients.length, insertedId });
    }

    await tgSendMessage(
      chatId,
      "ℹ️ Доступные команды:\n/start — включить уведомления\n/status — статус подписки\n/sethome — задать опорную точку\n/about — о проекте\n/stop — отключить уведомления\n/radius 10 — радиус в км\n/mchs Событие|Рекомендация — экстренная рассылка (админ)\n/mchsadd Событие|Рекомендация — ручное уведомление (админ)\n/mchslist [N] — список последних МЧС уведомлений (админ)\n/mchsdel ID — удалить уведомление (админ)"
    );
    return jsonResponse({ ok: true, action: "help" });
  } catch (e) {
    console.error("help-subscribe error:", e);
    return jsonResponse({ ok: false, error: "Internal error" }, 500);
  }
});
