// Запись на звонок: node test/booking.test.mjs (или npm test)
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { createHandler } = require("../index.js");
const FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "booking-")), "bookings.json");
const MIN = 60_000;
// «Сейчас» — понедельник 2026-10-26 08:00 МСК.
const now = () => Date.UTC(2026, 9, 26, 5, 0);
const slot = (d, h, m = 0) => new Date(Date.UTC(2026, 9, d, h - 3, m)).toISOString();
const sent = [];
const quiet = { info() {}, error(m) { sent.push(["err", m]); } };
const tgOk = async (text) => { sent.push(["tg", text]); };
const env = { ALLOWED_ORIGIN: "https://indata.group", BOOKINGS_FILE: FILE, TG_BOT_TOKEN: "x", TG_CHAT_ID: "1" };
const mk = (over = {}) => createHandler({ env, now, log: quiet, sendTelegram: tgOk, sendMail: async () => { throw new Error("no mail"); }, ...over });
const post = (h, body, ip = "1.1.1.1") => h({ httpMethod: "POST", headers: { origin: "https://indata.group", "x-real-ip": ip }, body: JSON.stringify(body) });
const get = async (h) => JSON.parse((await h({ httpMethod: "GET", headers: {} })).body).busy;
const req = (start, extra = {}) => ({ name: "Тест", email: "t@example.com", contact: "@t", notes: "", start, timezone: "Europe/Moscow", ...extra });

let h = mk();
assert.deepEqual(await get(h), []);
let r = await post(h, req(slot(27, 10)));
assert.equal(r.statusCode, 200, r.body);
assert.deepEqual(JSON.parse(r.body), { ok: true, joinUrl: null, emailed: false });
assert.match(sent.at(-1)[1], /Запись на звонок: Тест/);
assert.match(sent.at(-1)[1], /вторник, 27 октября, 10:00–10:15 МСК/);
assert.equal((await post(h, req(slot(27, 10)), "2.2.2.2")).statusCode, 409, "двойная запись");
assert.deepEqual(await get(h), [slot(27, 10)]);
assert.equal((await post(h, req(slot(31, 12)), "3.3.3.3")).statusCode, 409, "суббота");
assert.equal((await post(h, req(slot(27, 19)), "3.3.3.3")).statusCode, 409, "после 19:00");
assert.equal((await post(h, req(slot(27, 9, 30)), "3.3.3.3")).statusCode, 409, "до 10:00");
assert.equal((await post(h, req(slot(27, 18, 45)), "3.3.3.3")).statusCode, 200, "последний слот 18:45");
assert.equal((await post(h, req(slot(27, 11), { email: "bad" }), "4.4.4.4")).statusCode, 400);
assert.equal((await h({ httpMethod: "POST", headers: { origin: "https://evil.example" }, body: "{}" })).statusCode, 403);

// Telegram упал — заявка всё равно принята и сохранена, уведомление досылается повтором.
let tgUp = false;
const late = [];
const hFail = mk({ sendTelegram: async (text) => { if (!tgUp) throw new Error("tg down"); late.push(text); } });
const rf = await post(hFail, req(slot(28, 10)), "5.5.5.5");
assert.equal(rf.statusCode, 200, "клиент не теряется");
assert.ok((await get(hFail)).includes(slot(28, 10)), "слот занят");
assert.equal(await hFail.retryPending(), 0, "пока Telegram лежит — не отправлено");
tgUp = true;
assert.equal(await hFail.retryPending(), 1, "Telegram ожил — дослали");
assert.match(late[0], /^С задержкой\. Запись на звонок/);
assert.match(late[0], /уведомление тогда не отправилось/);
assert.equal(await hFail.retryPending(), 0, "второй раз не шлём");

// Ни одного канала — 503.
const hNone = createHandler({ env: { BOOKINGS_FILE: FILE }, now, log: quiet });
assert.equal((await post(hNone, req(slot(28, 11)))).statusCode, 503);

// Лимит: 5 заявок в час с одного IP.
const hRate = mk({ store: undefined, env: { ...env, BOOKINGS_FILE: "" } });
for (let i = 0; i < 5; i++) assert.notEqual((await post(hRate, req(slot(29, 10 + i)), "9.9.9.9")).statusCode, 429);
assert.equal((await post(hRate, req(slot(29, 16)), "9.9.9.9")).statusCode, 429);

// После перезапуска занятые слоты читаются из файла.
const h2 = mk();
assert.deepEqual(await get(h2), [slot(27, 10), slot(27, 18, 45), slot(28, 10)]);
assert.equal((await post(h2, req(slot(27, 10)), "6.6.6.6")).statusCode, 409);
assert.equal((fs.statSync(FILE).mode & 0o777).toString(8), "600");
console.log("all booking tests passed");
