// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "").trim();

const TELEGRAM_HELP_BOT_TOKEN = (Deno.env.get("TELEGRAM_HELP_BOT_TOKEN") || "").trim();
const MINIAPP_URL = (Deno.env.get("MINIAPP_URL") || "https://t.me/DPSRADARDPR180bot").trim();
const TELEGRAM_MAIN_BOT_USERNAME = (Deno.env.get("TELEGRAM_MAIN_BOT_USERNAME") || "").replace(/^@/, "").trim();
const TELEGRAM_MINIAPP_SHORT_NAME = (Deno.env.get("TELEGRAM_MINIAPP_SHORT_NAME") || "").trim();

// Source switched from MCHS RSS to Open-Meteo (current conditions).
// Defaults are for Donetsk.
const OPEN_METEO_LAT = Number(Deno.env.get("OPEN_METEO_LAT") || "48.0142");
const OPEN_METEO_LON = Number(Deno.env.get("OPEN_METEO_LON") || "37.8028");
const OPEN_METEO_TIMEZONE = (Deno.env.get("OPEN_METEO_TIMEZONE") || "auto").trim();
const OPEN_METEO_LOCATION_LABEL = (Deno.env.get("OPEN_METEO_LOCATION_LABEL") || "📍 ДНР, РОССИЯ | ДОНЕЦК 🇷🇺").trim();
const OPEN_METEO_CITY_LABEL = (Deno.env.get("OPEN_METEO_CITY_LABEL") || "Донецк, ДНР, Россия").trim();
const OPEN_METEO_API_BASE = (Deno.env.get("OPEN_METEO_API_BASE") || "https://api.open-meteo.com/v1/forecast").trim();
const OPEN_METEO_SCHEDULE_TZ = (Deno.env.get("OPEN_METEO_SCHEDULE_TZ") || "Europe/Moscow").trim();
const OPEN_METEO_WINDOW_MINUTES = Math.max(1, Math.min(30, Number(Deno.env.get("OPEN_METEO_WINDOW_MINUTES") || "10")));

const SCHEDULE_CURRENT_HOURS = [5, 12, 17];
const SCHEDULE_FORECAST_HOUR = 21;

// Legacy (kept for backward compatibility with the old push endpoint).
const MCHS_RSS_URL = (Deno.env.get("MCHS_RSS_URL") || "").trim();
const MCHS_CRON_SECRET = (Deno.env.get("MCHS_CRON_SECRET") || "").trim();

function corsHeaders() {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers": "content-type, authorization, x-cron-secret",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Content-Type": "application/json"
	};
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

function stripHtml(html: string): string {
	return String(html || "")
		.replace(/<\/?p[^>]*>/gi, "\n")
		.replace(/<br\s*\/?\s*>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/\s+\n/g, "\n")
		.replace(/\n\s+/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/\s{2,}/g, " ")
		.trim();
}

function parseTag(block: string, tag: string): string {
	const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
	const m = block.match(re);
	return m ? String(m[1] || "").trim() : "";
}

function parseAttr(block: string, tag: string, attr: string): string {
	const re = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]+)"[^>]*>`, "i");
	const m = block.match(re);
	return m ? String(m[1] || "").trim() : "";
}

function parseItems(rssXml: string) {
	const xml = String(rssXml || "");
	const items: any[] = [];
	const itemRe = /<item>([\s\S]*?)<\/item>/gi;
	let m: RegExpExecArray | null = null;
	while ((m = itemRe.exec(xml))) {
		const itemBlock = m[1] || "";
		const title = stripHtml(parseTag(itemBlock, "title"));
		const pubDateRaw = parseTag(itemBlock, "pubDate");
		const link = stripHtml(parseTag(itemBlock, "link"));
		const fullTextHtml = parseTag(itemBlock, "yandex:full-text") || parseTag(itemBlock, "full-text");
		const enclosureUrl = parseAttr(itemBlock, "enclosure", "url");

		let pubDateIso: string | null = null;
		const pubMs = Date.parse(pubDateRaw);
		if (Number.isFinite(pubMs)) pubDateIso = new Date(pubMs).toISOString();

		const fullText = stripHtml(fullTextHtml);
		const paragraphs = fullText.split(/\n{2,}|\n-\s+/).map((s) => s.trim()).filter(Boolean);
		const hazardText = paragraphs[0] || title || "";
		const recommendationText = paragraphs.slice(1).join("\n").trim() || null;

		items.push({
			title: title || "Штормовое предупреждение",
			source_link: link || null,
			pub_date: pubDateIso,
			hazard_text: hazardText,
			recommendation_text: recommendationText,
			full_text: fullText || hazardText,
			image_url: enclosureUrl || null
		});
	}
	return items;
}

async function sha256Hex(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function dbUpsertAlerts(alerts: any[]) {
	if (!alerts.length) return { inserted: 0, rows: [] as any[] };

	const rows = [];
	for (const a of alerts) {
		const stableKey = String(a.source_key || `${a.source_link || ""}|${a.pub_date || ""}`);
		const sourceHash = await sha256Hex(`alert|${stableKey}`);
		rows.push({
			source_hash: sourceHash,
			title: a.title,
			source_link: a.source_link,
			pub_date: a.pub_date,
			hazard_text: a.hazard_text,
			recommendation_text: a.recommendation_text,
			full_text: a.full_text,
			image_url: a.image_url,
			is_sent: false,
			sent_at: null,
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString()
		});
	}

	const url = `${SUPABASE_URL}/rest/v1/mchs_alerts?on_conflict=source_hash`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			// IMPORTANT: ignore duplicates so we don't flip is_sent back to false and re-send.
			Prefer: "resolution=ignore-duplicates,return=representation",
			apikey: SERVICE_ROLE_KEY,
			Authorization: `Bearer ${SERVICE_ROLE_KEY}`
		},
		body: JSON.stringify(rows)
	});
	if (!res.ok) {
		const txt = await res.text().catch(() => "");
		throw new Error(`db upsert failed: ${res.status} ${txt}`);
	}
	const saved = await res.json();
	return { inserted: Array.isArray(saved) ? saved.length : 0, rows: Array.isArray(saved) ? saved : [] };
}

async function dbListAlerts(limit = 8) {
	const safeLimit = Math.max(1, Math.min(20, Number(limit) || 8));
	const url = new URL(`${SUPABASE_URL}/rest/v1/mchs_alerts`);
	url.searchParams.set("select", "id,title,source_link,pub_date,created_at,hazard_text,recommendation_text,full_text,image_url");
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

async function dbListUnsentAlerts(limit = 5) {
	const safeLimit = Math.max(1, Math.min(10, Number(limit) || 5));
	const url = new URL(`${SUPABASE_URL}/rest/v1/mchs_alerts`);
	url.searchParams.set("select", "id,title,source_link,pub_date,hazard_text,recommendation_text,full_text");
	url.searchParams.set("is_sent", "eq.false");
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

async function dbMarkSent(ids: number[]) {
	if (!ids.length) return;
	const url = new URL(`${SUPABASE_URL}/rest/v1/mchs_alerts`);
	url.searchParams.set("id", `in.(${ids.join(",")})`);
	const res = await fetch(url.toString(), {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
			apikey: SERVICE_ROLE_KEY,
			Authorization: `Bearer ${SERVICE_ROLE_KEY}`
		},
		body: JSON.stringify({ is_sent: true, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
	});
	if (!res.ok) {
		const txt = await res.text().catch(() => "");
		console.warn("mark sent failed", res.status, txt);
	}
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
	return base;
}

async function tgSend(chatId: string, text: string, buttonText?: string, buttonUrl?: string) {
	const url = `https://api.telegram.org/bot${TELEGRAM_HELP_BOT_TOKEN}/sendMessage`;
	const payload: any = {
		chat_id: chatId,
		text,
		disable_web_page_preview: true
	};
	if (buttonText && buttonUrl) {
		payload.reply_markup = {
			inline_keyboard: [[{ text: buttonText, url: buttonUrl }]]
		};
	}
	await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload)
	});
}

function buildTelegramText(alert: any): string {
	const full = String(alert?.full_text || "").trim();
	if (full) return full;
	const title = String(alert?.title || "Погода").trim();
	const hazard = String(alert?.hazard_text || "").trim();
	const rec = String(alert?.recommendation_text || "").trim();
	const d = String(alert?.pub_date || "").slice(0, 16).replace("T", " ");
	return [title, d ? `(Данные на ${d.replace("-", ".").replace("-", ".").slice(0, 10)} — ${d.slice(11)})` : "", hazard, rec].filter(Boolean).join("\n");
}

function roundTo(value: any, step: number) {
	const n = Number(value);
	if (!Number.isFinite(n)) return null;
	const s = Number(step) || 1;
	return Math.round(n / s) * s;
}

function formatSignedInt(n: number | null) {
	if (!Number.isFinite(Number(n))) return "?";
	const i = Math.round(Number(n));
	return i > 0 ? `+${i}` : String(i);
}

function buildOpenMeteoUrl(): string {
	const u = new URL(OPEN_METEO_API_BASE);
	u.searchParams.set("latitude", String(OPEN_METEO_LAT));
	u.searchParams.set("longitude", String(OPEN_METEO_LON));
	u.searchParams.set(
		"current",
		[
			"temperature_2m",
			"apparent_temperature",
			"relative_humidity_2m",
			"precipitation",
			"weather_code",
			"wind_speed_10m",
			"wind_gusts_10m",
			"visibility"
		].join(",")
	);
	u.searchParams.set("timezone", OPEN_METEO_TIMEZONE || "auto");
	u.searchParams.set("wind_speed_unit", "kmh");
	u.searchParams.set("forecast_days", "1");
	return u.toString();
}

function buildOpenMeteoForecastUrl(): string {
	const u = new URL(OPEN_METEO_API_BASE);
	u.searchParams.set("latitude", String(OPEN_METEO_LAT));
	u.searchParams.set("longitude", String(OPEN_METEO_LON));
	u.searchParams.set(
		"daily",
		[
			"weather_code",
			"temperature_2m_max",
			"temperature_2m_min",
			"precipitation_sum",
			"wind_speed_10m_max"
		].join(",")
	);
	u.searchParams.set("timezone", OPEN_METEO_TIMEZONE || "auto");
	u.searchParams.set("wind_speed_unit", "kmh");
	u.searchParams.set("forecast_days", "2");
	return u.toString();
}

function ddmmyyyy(dateStr: string) {
	// dateStr is expected like 2026-02-17T22:45
	const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
	if (!m) return null;
	return { yyyy: m[1], mm: m[2], dd: m[3], hh: m[4], min: m[5] };
}

function buildRoadStatus(tempC: number | null, humidity: number | null, precipitationMm: number | null) {
	const t = Number(tempC);
	const h = Number(humidity);
	const p = Number(precipitationMm);
	const cold = Number.isFinite(t) && t <= 0;
	const veryHumid = Number.isFinite(h) && h >= 85;
	const precip = Number.isFinite(p) && p > 0.0;
	if (cold && (veryHumid || precip)) {
		return {
			label: "⚠️ ОПАСНО: ГОЛОЛЕД",
			note: "Наблюдается высокая влажность при отрицательной температуре. Будьте предельно внимательны на мостах и съездах!"
		};
	}
	return { label: "✅ НОРМА", note: "" };
}

function buildVisibilityStatus(visibilityMeters: number | null) {
	const v = Number(visibilityMeters);
	if (!Number.isFinite(v)) return { label: "?", note: "" };
	if (v < 1000) {
		return { label: "(Ограничена)", note: "Дымка/Туман. Рекомендуем включить противотуманные фары." };
	}
	if (v < 3000) {
		return { label: "(Снижена)", note: "Возможна дымка. Держите дистанцию и снижайте скорость." };
	}
	return { label: "(Хорошая)", note: "" };
}

function buildWindLabel(windKmh: number | null, gustKmh: number | null) {
	const w = Number(windKmh);
	const g = Number(gustKmh);
	if (!Number.isFinite(w)) return "";
	const isGusty = (Number.isFinite(g) && g >= Math.max(25, w * 1.3)) || w >= 18;
	return isGusty ? "(Порывистый)" : "";
}

function buildPrecipLine(precipitationMm: number | null) {
	const p = Number(precipitationMm);
	if (!Number.isFinite(p) || p <= 0.0) return "Не ожидаются";
	const rounded = Math.round(p * 10) / 10;
	return `${rounded} мм`;
}

function getNowPartsInTz(tz: string) {
	const d = new Date();
	const parts = new Intl.DateTimeFormat("ru-RU", {
		timeZone: tz || "Europe/Moscow",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false
	}).formatToParts(d);
	const byType: Record<string, string> = {};
	for (const p of parts) {
		if (p.type !== "literal") byType[p.type] = p.value;
	}
	return {
		yyyy: byType.year,
		mm: byType.month,
		dd: byType.day,
		hh: Number(byType.hour),
		min: Number(byType.minute),
		dateKey: `${byType.year}${byType.month}${byType.day}`
	};
}

function isWithinWindow(targetHour: number, minute: number) {
	return minute >= 0 && minute < OPEN_METEO_WINDOW_MINUTES && Number(targetHour) >= 0;
}

function monthGenRuUpper(mm: string) {
	const map = {
		"01": "ЯНВАРЯ",
		"02": "ФЕВРАЛЯ",
		"03": "МАРТА",
		"04": "АПРЕЛЯ",
		"05": "МАЯ",
		"06": "ИЮНЯ",
		"07": "ИЮЛЯ",
		"08": "АВГУСТА",
		"09": "СЕНТЯБРЯ",
		"10": "ОКТЯБРЯ",
		"11": "НОЯБРЯ",
		"12": "ДЕКАБРЯ"
	} as any;
	return map[String(mm || "")] || "";
}

function weatherCodeRu(code: number | null) {
	const c = Number(code);
	if (!Number.isFinite(c)) return "Неизвестно";
	if (c === 0) return "Ясно";
	if (c === 1) return "Преимущественно ясно";
	if (c === 2) return "Переменная облачность";
	if (c === 3) return "Пасмурно";
	if (c === 45 || c === 48) return "Туман";
	if (c >= 51 && c <= 57) return "Морось";
	if (c >= 61 && c <= 67) return "Дождь";
	if (c >= 71 && c <= 77) return "Снег";
	if (c >= 80 && c <= 82) return "Ливни";
	if (c === 85 || c === 86) return "Снегопад";
	if (c === 95) return "Гроза";
	if (c === 96 || c === 99) return "Гроза с градом";
	return "Осадки";
}

function buildRoadForecast(dailyMinC: number | null, precipSumMm: number | null) {
	const tmin = Number(dailyMinC);
	const p = Number(precipSumMm);
	const hasPrecip = Number.isFinite(p) && p > 0;
	if (!hasPrecip) {
		if (Number.isFinite(tmin) && tmin <= 0) {
			return "✅ Дорога будет сухой, но возможна утренняя изморозь.";
		}
		return "✅ Дорога будет сухой.";
	}
	if (Number.isFinite(tmin) && tmin < 0) return "⚠️ Возможен гололёд/слякоть из‑за осадков и минусовой температуры.";
	return "⚠️ Возможна мокрая дорога из‑за осадков."
}

function buildForecastTelegramMessage(tomorrow: { dd: string; mm: string; yyyy: string }, daily: any) {
	const month = monthGenRuUpper(tomorrow.mm);
	const dayNum = Number(tomorrow.dd);
	const header = `📅 ПРОГНОЗ НА ЗАВТРА | ${dayNum} ${month} 🇷🇺`;

	const tmax = daily?.temperature_2m_max;
	const tmin = daily?.temperature_2m_min;
	const precip = daily?.precipitation_sum;
	const wmax = daily?.wind_speed_10m_max;
	const code = daily?.weather_code;
	const state = weatherCodeRu(code);
	const hasPrecip = Number.isFinite(Number(precip)) && Number(precip) > 0;
	const cond = hasPrecip ? `${state}, возможны осадки` : `${state}, без осадков`;
	const road = buildRoadForecast(tmin, precip);

	const lines = [
		header,
		OPEN_METEO_CITY_LABEL,
		"",
		`🌡 ДЕНЬ: ${formatSignedInt(tmax)}°C`,
		`🌙 НОЧЬ: ${formatSignedInt(tmin)}°C`,
		`☁️ СОСТОЯНИЕ: ${cond}`,
		`🛣 ДОРОЖНЫЙ ПРОГНОЗ: ${road}`,
		Number.isFinite(Number(wmax)) ? `💨 ВЕТЕР: до ${Math.round(Number(wmax))} км/ч` : "💨 ВЕТЕР: ?"
	];
	return lines.join("\n").trim();
}

function buildWeatherTelegramMessage(snapshot: any) {
	const when = ddmmyyyy(String(snapshot?.time || "")) || null;
	const dtLine = when ? `(Данные на ${when.dd}.${when.mm}.${when.yyyy} — ${when.hh}:${when.min})` : "";

	const t = snapshot?.temperature_2m;
	const feels = snapshot?.apparent_temperature;
	const humidity = snapshot?.relative_humidity_2m;
	const precip = snapshot?.precipitation;
	const vis = snapshot?.visibility;
	const wind = snapshot?.wind_speed_10m;
	const gust = snapshot?.wind_gusts_10m;

	const road = buildRoadStatus(t, humidity, precip);
	const visStatus = buildVisibilityStatus(vis);
	const windLabel = buildWindLabel(wind, gust);
	const precipText = buildPrecipLine(precip);

	const lines = [
		OPEN_METEO_LOCATION_LABEL,
		dtLine,
		"",
		`🌡 ТЕМПЕРАТУРА: ${formatSignedInt(t)}°C (ощущается как ${formatSignedInt(feels)}°C)`,
		`🛣 ДОРОГА: ${road.label}`,
		road.note ? road.note : "",
		"",
		Number.isFinite(Number(vis))
			? `👁 ВИДИМОСТЬ: ${Math.round(Number(vis))} м ${visStatus.label}`.trim()
			: "👁 ВИДИМОСТЬ: ?",
		visStatus.note ? visStatus.note : "",
		"",
		Number.isFinite(Number(wind))
			? `💨 ВЕТЕР: ${Math.round(Number(wind))} км/ч ${windLabel}`.trim()
			: "💨 ВЕТЕР: ?",
		`🌊 ОСАДКИ: ${precipText}`
	]
		.filter((s) => s !== null && s !== undefined)
		.map((s) => String(s));

	return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function syncFromOpenMeteo() {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 8000);
	const res = await fetch(buildOpenMeteoUrl(), {
		headers: { "User-Agent": "SafeDrive180/1.0", "Accept": "application/json" },
		signal: ctrl.signal
	}).catch((e) => {
		throw new Error(`Open-Meteo fetch failed: ${e?.message || e}`);
	});
	clearTimeout(t);
	const json = await res.json().catch(() => null);
	if (!res.ok || !json) {
		const txt = JSON.stringify(json || {}).slice(0, 200);
		return { ok: false, error: `Open-Meteo fetch failed: ${res.status}`, details: txt };
	}
	const current = json?.current || {};
	const time = String(current?.time || "");
	if (!time) return { ok: false, error: "Open-Meteo: missing current.time" };

	// Quantize values to avoid spamming on tiny fluctuations.
	const q = {
		time,
		temperature_2m: roundTo(current?.temperature_2m, 1),
		apparent_temperature: roundTo(current?.apparent_temperature, 1),
		relative_humidity_2m: roundTo(current?.relative_humidity_2m, 1),
		precipitation: roundTo(current?.precipitation, 0.1),
		weather_code: roundTo(current?.weather_code, 1),
		wind_speed_10m: roundTo(current?.wind_speed_10m, 1),
		wind_gusts_10m: roundTo(current?.wind_gusts_10m, 1),
		visibility: roundTo(current?.visibility, 100)
	};

	const msg = buildWeatherTelegramMessage(q);
	const road = buildRoadStatus(q.temperature_2m, q.relative_humidity_2m, q.precipitation);
	const visStatus = buildVisibilityStatus(q.visibility);

	const sourceKey = await sha256Hex(JSON.stringify({
		loc: OPEN_METEO_LOCATION_LABEL,
		t: q.temperature_2m,
		f: q.apparent_temperature,
		h: q.relative_humidity_2m,
		p: q.precipitation,
		w: q.wind_speed_10m,
		g: q.wind_gusts_10m,
		v: q.visibility,
		road: road.label,
		vis: visStatus.label
	}));

	const alerts = [{
		source_key: `open-meteo|debug|current|${sourceKey}`,
		title: "Погода: Донецк",
		source_link: "https://open-meteo.com/",
		pub_date: new Date().toISOString(),
		hazard_text: `🛣 ДОРОГА: ${road.label}`,
		recommendation_text: (road.note || visStatus.note || "").trim() || null,
		full_text: msg,
		image_url: null
	}];

	const saved = await dbUpsertAlerts(alerts);
	return { ok: true, fetched: 1, inserted: saved.inserted };
}

async function syncForecastForTomorrow(sourceKey: string) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 8000);
	const res = await fetch(buildOpenMeteoForecastUrl(), {
		headers: { "User-Agent": "SafeDrive180/1.0", "Accept": "application/json" },
		signal: ctrl.signal
	}).catch((e) => {
		throw new Error(`Open-Meteo forecast fetch failed: ${e?.message || e}`);
	});
	clearTimeout(t);
	const json = await res.json().catch(() => null);
	if (!res.ok || !json) {
		const txt = JSON.stringify(json || {}).slice(0, 200);
		return { ok: false, error: `Open-Meteo forecast fetch failed: ${res.status}`, details: txt };
	}
	const times: string[] = Array.isArray(json?.daily?.time) ? json.daily.time : [];
	if (times.length < 2) return { ok: false, error: "Open-Meteo: missing daily.time" };
	const tomorrowDate = String(times[1] || ""); // YYYY-MM-DD
	const m = tomorrowDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!m) return { ok: false, error: "Open-Meteo: invalid daily.time" };
	const idx = 1;
	const daily = {
		weather_code: Array.isArray(json?.daily?.weather_code) ? json.daily.weather_code[idx] : null,
		temperature_2m_max: Array.isArray(json?.daily?.temperature_2m_max) ? json.daily.temperature_2m_max[idx] : null,
		temperature_2m_min: Array.isArray(json?.daily?.temperature_2m_min) ? json.daily.temperature_2m_min[idx] : null,
		precipitation_sum: Array.isArray(json?.daily?.precipitation_sum) ? json.daily.precipitation_sum[idx] : null,
		wind_speed_10m_max: Array.isArray(json?.daily?.wind_speed_10m_max) ? json.daily.wind_speed_10m_max[idx] : null
	};
	const msg = buildForecastTelegramMessage({ yyyy: m[1], mm: m[2], dd: m[3] }, daily);
	const road = buildRoadForecast(daily.temperature_2m_min, daily.precipitation_sum);
	const alerts = [{
		source_key: sourceKey,
		title: "Прогноз на завтра: Донецк",
		source_link: "https://open-meteo.com/",
		pub_date: new Date().toISOString(),
		hazard_text: "📅 Прогноз на завтра",
		recommendation_text: road,
		full_text: msg,
		image_url: null
	}];
	const saved = await dbUpsertAlerts(alerts);
	return { ok: true, fetched: 1, inserted: saved.inserted };
}

async function syncScheduledSnapshot(force: boolean) {
	const now = getNowPartsInTz(OPEN_METEO_SCHEDULE_TZ);
	const hour = Number(now.hh);
	const minute = Number(now.min);
	const dateKey = String(now.dateKey);

	const isForecast = hour === SCHEDULE_FORECAST_HOUR;
	const isCurrent = SCHEDULE_CURRENT_HOURS.includes(hour);
	if (!force) {
		if (!(isForecast || isCurrent)) return { ok: true, skipped: true, reason: "not-scheduled" };
		if (!isWithinWindow(hour, minute)) return { ok: true, skipped: true, reason: "out-of-window" };
	}

	if (isForecast) {
		const sourceKey = `open-meteo|schedule|forecast|${dateKey}|21`;
		return await syncForecastForTomorrow(sourceKey);
	}
	if (isCurrent) {
		const sourceKey = `open-meteo|schedule|current|${dateKey}|${String(hour).padStart(2, "0")}`;
		// Same API call as debug sync, but with a deterministic per-slot key.
		const ctrl = new AbortController();
		const t = setTimeout(() => ctrl.abort(), 8000);
		const res = await fetch(buildOpenMeteoUrl(), {
			headers: { "User-Agent": "SafeDrive180/1.0", "Accept": "application/json" },
			signal: ctrl.signal
		}).catch((e) => {
			throw new Error(`Open-Meteo fetch failed: ${e?.message || e}`);
		});
		clearTimeout(t);
		const json = await res.json().catch(() => null);
		if (!res.ok || !json) {
			const txt = JSON.stringify(json || {}).slice(0, 200);
			return { ok: false, error: `Open-Meteo fetch failed: ${res.status}`, details: txt };
		}
		const current = json?.current || {};
		const q = {
			time: String(current?.time || ""),
			temperature_2m: roundTo(current?.temperature_2m, 1),
			apparent_temperature: roundTo(current?.apparent_temperature, 1),
			relative_humidity_2m: roundTo(current?.relative_humidity_2m, 1),
			precipitation: roundTo(current?.precipitation, 0.1),
			weather_code: roundTo(current?.weather_code, 1),
			wind_speed_10m: roundTo(current?.wind_speed_10m, 1),
			wind_gusts_10m: roundTo(current?.wind_gusts_10m, 1),
			visibility: roundTo(current?.visibility, 100)
		};
		const msg = buildWeatherTelegramMessage(q);
		const road = buildRoadStatus(q.temperature_2m, q.relative_humidity_2m, q.precipitation);
		const visStatus = buildVisibilityStatus(q.visibility);
		const alerts = [{
			source_key: sourceKey,
			title: "Погода: Донецк",
			source_link: "https://open-meteo.com/",
			pub_date: new Date().toISOString(),
			hazard_text: `🛣 ДОРОГА: ${road.label}`,
			recommendation_text: (road.note || visStatus.note || "").trim() || null,
			full_text: msg,
			image_url: null
		}];
		const saved = await dbUpsertAlerts(alerts);
		return { ok: true, fetched: 1, inserted: saved.inserted };
	}

	// If forced and not matching any slot, default to debug current.
	return await syncFromOpenMeteo();
}

serve(async (req) => {
	if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

	if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
		return jsonResponse({ ok: false, error: "Missing env config" }, 500);
	}

	const url = new URL(req.url);
	const action = (url.searchParams.get("action") || "feed").toLowerCase();
	const limit = Number(url.searchParams.get("limit") || 8);
	const incomingSecret = (req.headers.get("x-cron-secret") || url.searchParams.get("cron_secret") || "").trim();

	try {
		if (action === "feed") {
			// Public endpoint for the app.
			const alerts = await dbListAlerts(limit);
			return jsonResponse({ ok: true, alerts });
		}

		if (action === "sync") {
			if (!MCHS_CRON_SECRET) {
				return jsonResponse({ ok: false, error: "Missing MCHS_CRON_SECRET" }, 500);
			}
			if (incomingSecret !== MCHS_CRON_SECRET) {
				return jsonResponse({ ok: false, error: "Forbidden" }, 403);
			}
			const kind = (url.searchParams.get("kind") || "current").toLowerCase();
			if (kind === "forecast") {
				const now = getNowPartsInTz(OPEN_METEO_SCHEDULE_TZ);
				const sourceKey = `open-meteo|debug|forecast|${now.dateKey}`;
				const r = await syncForecastForTomorrow(sourceKey);
				return jsonResponse(r as any);
			}
			const r = await syncFromOpenMeteo();
			return jsonResponse(r as any);
		}

		if (action === "push") {
			// Push RSS XML from outside (workaround if edge runtime can't reach .gov.ru).
			if (!MCHS_CRON_SECRET) {
				return jsonResponse({ ok: false, error: "Missing MCHS_CRON_SECRET" }, 500);
			}
			if (incomingSecret !== MCHS_CRON_SECRET) {
				return jsonResponse({ ok: false, error: "Forbidden" }, 403);
			}
			let body: any = null;
			try {
				body = await req.json();
			} catch {
				return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
			}
			const rssXml = String(body?.rss || body?.rssXml || "");
			if (!rssXml || rssXml.length < 20) {
				return jsonResponse({ ok: false, error: "Missing rss XML" }, 400);
			}
			const items = parseItems(rssXml);
			const saved = await dbUpsertAlerts(items);
			return jsonResponse({ ok: true, fetched: items.length, inserted: saved.inserted });
		}

		if (action === "cron") {
			// Sync + send unsent alerts to Telegram subscribers.
			if (!MCHS_CRON_SECRET) {
				return jsonResponse({ ok: false, error: "Missing MCHS_CRON_SECRET" }, 500);
			}
			if (incomingSecret !== MCHS_CRON_SECRET) {
				return jsonResponse({ ok: false, error: "Forbidden" }, 403);
			}
			if (!TELEGRAM_HELP_BOT_TOKEN) {
				return jsonResponse({ ok: false, error: "Missing TELEGRAM_HELP_BOT_TOKEN" }, 500);
			}
			const force = ["1", "true", "yes"].includes(String(url.searchParams.get("force") || "").toLowerCase());
			let syncError: string | null = null;
			let syncResult: any = null;
			try {
				syncResult = await syncScheduledSnapshot(force);
				if (!syncResult?.ok) syncError = String(syncResult?.error || "sync failed");
			} catch (e) {
				syncError = String(e?.message || e || "sync failed");
			}
			const unsent = await dbListUnsentAlerts(5);
			if (!unsent.length) {
				return jsonResponse({ ok: true, sent: 0, reason: syncResult?.reason || "no-unsent", syncError });
			}
			const recipients = await dbSelectActiveSubscribers();
			const mapUrl = buildMiniappOpenUrl(MINIAPP_URL);
			let delivered = 0;

			for (const alert of unsent) {
				const text = buildTelegramText(alert);
				for (const chatId of recipients) {
					try {
						const btnUrl = alert?.source_link || mapUrl;
						const btnText = alert?.source_link ? "🔗 Открыть предупреждение" : "📍 Открыть карту";
						await tgSend(chatId, text, btnText, btnUrl);
						delivered += 1;
					} catch {
						// ignore
					}
				}
			}

			await dbMarkSent(unsent.map((u: any) => Number(u.id)).filter((n: number) => Number.isFinite(n) && n > 0));
			return jsonResponse({ ok: true, alerts: unsent.length, recipients: recipients.length, delivered, syncError });
		}

		return jsonResponse({ ok: false, error: "Unknown action" }, 400);
	} catch (e) {
		console.error("mchs-auto error:", e);
		const message = String(e?.message || e || "Internal error");
		return jsonResponse({ ok: false, error: message.slice(0, 500) }, 500);
	}
});

