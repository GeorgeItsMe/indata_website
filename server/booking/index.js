"use strict";
/* Запись на звонок: создаёт встречу в Яндекс Телемосте и пишет команде и клиенту.
   Работает как Yandex Cloud Function (exports.handler) или обычным сервером (server.js).

   Переменные окружения:
     TELEMOST_TOKEN  OAuth-токен Яндекса с правом telemost-api:conferences.create
     ALLOWED_ORIGIN  с каких сайтов принимать заявки, через запятую: https://indata.group
     TEAM_EMAIL      куда присылать заявки
     SMTP_USER       ящик-отправитель на Яндекс 360, например hello@indata.group
     SMTP_PASS       пароль приложения для этого ящика
     SMTP_HOST       по умолчанию smtp.yandex.ru
     SMTP_PORT       по умолчанию 465
   Без SMTP_* письма не отправляются, заявка остаётся только в логах функции. */

const TELEMOST_API = "https://cloud-api.yandex.net/v1/telemost-api/conferences";
const TITLE = "Знакомство с InData";
const DURATION_MIN = 15;
const MAX_AHEAD_DAYS = 31;
const MIN = 60_000;

function createHandler({
  env = process.env,
  fetchImpl = fetch,
  sendMail = smtpSender(env),
  now = Date.now,
  log = console,
} = {}) {
  const origins = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const mailOn = Boolean(env.SMTP_USER && env.SMTP_PASS);

  async function createConference() {
    if (!env.TELEMOST_TOKEN) throw new Error("не задан TELEMOST_TOKEN");
    const res = await fetchImpl(TELEMOST_API, {
      method: "POST",
      headers: { Authorization: `OAuth ${env.TELEMOST_TOKEN}`, "Content-Type": "application/json" },
      // PUBLIC — без комнаты ожидания: клиент заходит по ссылке сразу.
      body: JSON.stringify({ waiting_room_level: "PUBLIC" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
    const { join_url: joinUrl } = await res.json();
    if (!joinUrl) throw new Error("в ответе нет join_url");
    return joinUrl;
  }

  return async function handler(event) {
    const origin = header(event, "origin");
    const allowed = origins.length === 0 || origins.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": allowed ? origin || "*" : origins[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const reply = (statusCode, body) => ({
      statusCode,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      body: body === undefined ? "" : JSON.stringify(body),
    });

    if (event.httpMethod === "OPTIONS") return reply(204);
    if (event.httpMethod !== "POST") return reply(405, { error: "method" });
    if (!allowed) return reply(403, { error: "origin" });

    let data;
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body;
      data = JSON.parse(raw || "");
    } catch {
      return reply(400, { error: "json" });
    }
    const booking = parseBooking(data);
    if (!booking) return reply(400, { error: "invalid" });
    const t = now();
    if (booking.start < t || booking.start > t + MAX_AHEAD_DAYS * 24 * 60 * MIN) return reply(409, { error: "slot" });

    // Заявка остаётся в логах функции, даже если почта не настроена или не сработала.
    log.info(JSON.stringify({ booking }));

    let joinUrl = null;
    try {
      joinUrl = await createConference();
    } catch (err) {
      log.error(`Телемост: ${err.message}`);
    }

    if (mailOn && env.TEAM_EMAIL) {
      try {
        await sendMail(teamLetter(booking, joinUrl, env));
      } catch (err) {
        // Команда не узнала о заявке — честно просим клиента отправить ещё раз.
        log.error(`Письмо команде: ${err.message}`);
        return reply(502, { error: "mail" });
      }
    }

    let emailed = false;
    if (mailOn) {
      try {
        await sendMail(clientLetter(booking, joinUrl, env, t));
        emailed = true;
      } catch (err) {
        log.error(`Письмо клиенту: ${err.message}`);
      }
    }

    return reply(200, { ok: true, joinUrl, emailed });
  };
}

/* ---------- Заявка ---------- */
function parseBooking(d) {
  if (!d || typeof d !== "object") return null;
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const booking = {
    name: str(d.name, 200),
    email: str(d.email, 200),
    contact: str(d.contact, 200),
    notes: str(d.notes, 3000),
    timezone: str(d.timezone, 64),
    timezoneLabel: str(d.timezoneLabel, 64),
    page: str(d.page, 500),
    start: Date.parse(d.start),
  };
  if (!booking.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email)) return null;
  if (!Number.isFinite(booking.start) || booking.start % (15 * MIN) !== 0) return null;
  if (!isZone(booking.timezone)) booking.timezone = "Europe/Moscow";
  return booking;
}

function isZone(tz) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function header(event, name) {
  const entry = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === name);
  return entry ? String(entry[1]) : "";
}

/* ---------- Письма ---------- */
const format = (ms, tz, opts) => new Intl.DateTimeFormat("ru-RU", { timeZone: tz, ...opts }).format(ms);

function when(ms, tz) {
  const time = (x) => format(x, tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const date = format(ms, tz, { weekday: "long", day: "numeric", month: "long" });
  return `${date}, ${time(ms)}–${time(ms + DURATION_MIN * MIN)}`;
}

// «среда, 21 октября, 10:00–10:15 МСК» или «…, 14:00–14:15, Новосибирск (GMT+7)»
const localWhen = (b) => (b.timezone === "Europe/Moscow"
  ? `${when(b.start, b.timezone)} МСК`
  : `${when(b.start, b.timezone)}, ${b.timezoneLabel || b.timezone}`);
const lines = (...rows) => rows.filter((row) => row !== null).join("\n");

function teamLetter(b, joinUrl, env) {
  const msk = `${when(b.start, "Europe/Moscow")} МСК`;
  return {
    to: env.TEAM_EMAIL,
    replyTo: b.email,
    subject: `Запись на звонок: ${b.name} — ${msk}`,
    text: lines(
      `Когда: ${msk}${b.timezone === "Europe/Moscow" ? "" : ` (у клиента ${b.timezoneLabel || b.timezone})`}`,
      `Телемост: ${joinUrl || "ссылка не создалась — создайте встречу вручную и отправьте клиенту"}`,
      "",
      `Имя: ${b.name}`,
      `Email: ${b.email}`,
      b.contact ? `Телефон / Telegram: ${b.contact}` : null,
      b.notes ? `\nО проекте:\n${b.notes}` : null,
      "",
      `Страница: ${b.page}`,
    ),
  };
}

function clientLetter(b, joinUrl, env, stamp) {
  const at = localWhen(b);
  return {
    to: b.email,
    replyTo: env.TEAM_EMAIL || undefined,
    subject: `Звонок с InData — ${at}`,
    text: lines(
      `${b.name}, здравствуйте!`,
      "",
      `Ждём вас на звонке: ${at}.`,
      joinUrl ? `Ссылка на встречу в Яндекс Телемосте: ${joinUrl}` : "Ссылку на встречу пришлём отдельным письмом.",
      "",
      "Если время не подходит, просто ответьте на это письмо — подберём другое.",
      "",
      "Команда InData",
    ),
    // Приглашение: почтовые клиенты предложат добавить встречу в календарь.
    icalEvent: { method: "REQUEST", filename: "invite.ics", content: invite(b, joinUrl, env.SMTP_USER, stamp) },
  };
}

/* ---------- Приглашение .ics ---------- */
function invite(b, joinUrl, organizer, stamp) {
  const utc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const cn = (s) => `"${s.replace(/["\r\n]/g, "")}"`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//InData//Booking//RU",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@indata.group`,
    `DTSTAMP:${utc(stamp)}`,
    `DTSTART:${utc(b.start)}`,
    `DTEND:${utc(b.start + DURATION_MIN * MIN)}`,
    `SUMMARY:${esc(TITLE)}`,
    `DESCRIPTION:${esc(joinUrl ? `Ссылка на встречу: ${joinUrl}` : "Ссылку на встречу пришлём отдельно.")}`,
    joinUrl ? `LOCATION:${esc(joinUrl)}` : null,
    joinUrl ? `URL:${joinUrl}` : null,
    `ORGANIZER;CN=InData:mailto:${organizer}`,
    `ATTENDEE;CN=${cn(b.name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${b.email}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((row) => row !== null).map(fold).join("\r\n");
}

// Строки .ics длиннее 75 байт переносятся с пробелом в начале продолжения (RFC 5545).
function fold(line) {
  const parts = [];
  let chunk = "";
  let size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(chunk);
      chunk = "";
      size = 0;
    }
    chunk += ch;
    size += n;
  }
  parts.push(chunk);
  return parts.join("\r\n ");
}

/* ---------- Почта ---------- */
function smtpSender(env) {
  let transport;
  return (letter) => {
    const port = Number(env.SMTP_PORT) || 465;
    transport ??= require("nodemailer").createTransport({
      host: env.SMTP_HOST || "smtp.yandex.ru",
      port,
      secure: port === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
    return transport.sendMail({ from: `InData <${env.SMTP_USER}>`, ...letter });
  };
}

module.exports = { createHandler, handler: createHandler() };
