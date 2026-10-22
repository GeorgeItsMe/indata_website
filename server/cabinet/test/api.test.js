"use strict";
// npm test (node --test test/api.test.js)
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp, progress, hashPassword } = require("../app.js");

const ORIGIN = "https://app.indata.group";
let server;
let base;
let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cabinet-"));
  // Первый администратор — как после cli.js create-admin.
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify({
    users: [{ id: "admin0001", login: "admin", name: "Админ", role: "admin", password: hashPassword("admin-pass-123"), createdAt: "" }],
    projects: [],
    sessions: [],
  }));
  const handle = createApp({ dataDir, origins: [ORIGIN], secureCookie: false, log: { error() {} } });
  server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Мини-клиент с cookie, как браузер.
function client(ip = "10.0.0.1") {
  let cookie = "";
  return async function call(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined && !Buffer.isBuffer(body) ? { "content-type": "application/json" } : {}),
        "x-real-ip": ip,
        ...headers,
      },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const type = res.headers.get("content-type") || "";
    return { status: res.status, headers: res.headers, json: type.includes("json") ? await res.json() : null, raw: type.includes("json") ? null : Buffer.from(await res.arrayBuffer()) };
  };
}

let admin;
let clientA;
let clientB;
let project;

test("вход администратора и закрытые маршруты", async () => {
  const anon = client("10.0.0.9");
  assert.equal((await anon("GET", "/api/me")).json.user, null);
  assert.equal((await anon("GET", "/api/projects")).status, 401);
  admin = client();
  assert.equal((await admin("POST", "/api/login", { login: "admin", password: "wrong" })).status, 401);
  const ok = await admin("POST", "/api/login", { login: "Admin", password: "admin-pass-123" });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.role, "admin");
  assert.equal(ok.json.user.password, undefined, "хеш пароля не уходит наружу");
  assert.match(ok.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
  assert.equal((await admin("GET", "/api/me")).json.user.login, "admin");
});

test("админ заводит клиентов и проект", async () => {
  const a = await admin("POST", "/api/admin/users", { name: "Иван", company: "Empire", login: "empire" });
  assert.equal(a.status, 201);
  assert.equal(a.json.password.length, 12);
  assert.equal((await admin("POST", "/api/admin/users", { name: "Дубль", login: "EMPIRE" })).status, 409);
  assert.equal((await admin("POST", "/api/admin/users", { name: "X", login: "a b" })).status, 400);
  const b = await admin("POST", "/api/admin/users", { name: "Пётр", login: "other" });

  clientA = { ...a.json, call: client("10.0.0.2") };
  clientB = { ...b.json, call: client("10.0.0.3") };

  const p = await admin("POST", "/api/admin/projects", { title: "Доработка платформы", clientIds: [clientA.user.id] });
  assert.equal(p.status, 201);
  project = p.json.project;
  assert.deepEqual(project.stages.map((s) => s.status), ["active", "todo", "todo", "todo", "todo"]);
  assert.equal((await admin("POST", "/api/admin/projects", { title: "X", clientIds: ["nope"] })).status, 400);
});

test("админ ведёт этапы, оплаты, ленту и файлы", async () => {
  const stages = project.stages.map((s, i) => ({ ...s, status: i < 2 ? "done" : i === 2 ? "active" : "todo", end: i === 2 ? "2026-11-20" : "" }));
  const payments = [
    { title: "Предоплата 50%", amount: 300000, due: "2026-10-25", paid: true },
    { title: "Остаток", amount: "300000", due: "2026-11-25", paid: false },
  ];
  const r = await admin("PATCH", `/api/admin/projects/${project.id}`, { stages, payments, summary: "Приложение и панель менеджера" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.project.stages[2].end, "2026-11-20");
  assert.equal(r.json.project.payments[1].amount, 300000);
  assert.match(r.json.project.payments[0].paidAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.json.project.stages[0].id, project.stages[0].id, "id этапов сохраняются");
  assert.equal((await admin("PATCH", `/api/admin/projects/${project.id}`, { stages: [{ title: "x", end: "20.11.2026" }] })).status, 400);

  const u = await admin("POST", `/api/admin/projects/${project.id}/updates`, {
    title: "Сдали дизайн магазина", text: "Макеты в Figma", links: [{ label: "Макеты", url: "https://figma.com/x" }],
  });
  assert.equal(u.status, 201);
  assert.equal((await admin("POST", `/api/admin/projects/${project.id}/updates`, { title: "x", links: [{ url: "javascript:alert(1)" }] })).status, 400);

  const pdf = Buffer.from("%PDF-1.4 test");
  const f = await admin("POST", `/api/admin/projects/${project.id}/files`, pdf, {
    "content-type": "application/pdf", "x-filename": encodeURIComponent("КП Empire.pdf"),
  });
  assert.equal(f.status, 201, JSON.stringify(f.json));
  const html = await admin("POST", `/api/admin/projects/${project.id}/files`, Buffer.from("<script>alert(1)</script>"), {
    "content-type": "text/html", "x-filename": "evil.html",
  });
  project = html.json.project;
  assert.equal(project.files.length, 2);
});

test("клиент видит только свои проекты и только читает", async () => {
  const a = clientA.call;
  assert.equal((await a("POST", "/api/login", { login: "empire", password: clientA.password })).status, 200);
  const list = await a("GET", "/api/projects");
  assert.equal(list.json.projects.length, 1);
  assert.equal(list.json.projects[0].progress, 50); // 2 готово + 0.5 из 5
  assert.equal(list.json.projects[0].stage, "Разработка");
  const full = await a("GET", `/api/projects/${project.id}`);
  assert.equal(full.json.project.updates[0].title, "Сдали дизайн магазина");
  assert.equal(full.json.project.clientIds, undefined, "клиент не видит, кому ещё открыт проект");

  const [pdf, evil] = full.json.project.files;
  const dl = await a("GET", `/api/projects/${project.id}/files/${pdf.id}`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get("content-type"), "application/pdf");
  assert.equal(dl.raw.toString(), "%PDF-1.4 test");
  const dlEvil = await a("GET", `/api/projects/${project.id}/files/${evil.id}`);
  assert.equal(dlEvil.headers.get("content-type"), "application/octet-stream", "HTML не исполняется на нашем домене");
  assert.match(dlEvil.headers.get("content-disposition"), /^attachment/);

  assert.equal((await a("GET", "/api/admin/users")).status, 403);
  assert.equal((await a("PATCH", `/api/admin/projects/${project.id}`, { title: "взлом" })).status, 403);

  const b = clientB.call;
  await b("POST", "/api/login", { login: "other", password: clientB.password });
  assert.equal((await b("GET", "/api/projects")).json.projects.length, 0);
  assert.equal((await b("GET", `/api/projects/${project.id}`)).status, 404);
  assert.equal((await b("GET", `/api/projects/${project.id}/files/${pdf.id}`)).status, 404);
});

test("созвоны: запись и договорённости", async () => {
  const add = await admin("POST", `/api/admin/projects/${project.id}/meetings`, {
    date: "2026-10-22", title: "Старт проекта", agreements: "Старт 26 октября\nЭтап 1 до 25 ноября",
  });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  const meeting = add.json.project.meetings[0];
  assert.equal(meeting.recordingUrl, "");
  assert.equal((await admin("PATCH", `/api/admin/projects/${project.id}/meetings/${meeting.id}`, { ...meeting, recordingUrl: "javascript:alert(1)" })).status, 400);
  const upd = await admin("PATCH", `/api/admin/projects/${project.id}/meetings/${meeting.id}`, { ...meeting, recordingUrl: "https://disk.yandex.ru/i/rec" });
  assert.equal(upd.json.project.meetings[0].recordingUrl, "https://disk.yandex.ru/i/rec");
  assert.equal(upd.json.project.meetings[0].id, meeting.id);
  await admin("POST", `/api/admin/projects/${project.id}/meetings`, { date: "2026-10-22", title: "Второй в тот же день" });

  const seen = await clientA.call("GET", `/api/projects/${project.id}`);
  assert.deepEqual(seen.json.project.meetings.map((m) => m.title), ["Второй в тот же день", "Старт проекта"]);
  assert.equal((await clientA.call("POST", `/api/admin/projects/${project.id}/meetings`, { title: "x" })).status, 403);

  const del = await admin("DELETE", `/api/admin/projects/${project.id}/meetings/${meeting.id}`);
  assert.equal(del.json.project.meetings.length, 1);
  assert.equal((await admin("PATCH", `/api/admin/projects/${project.id}/meetings/${meeting.id}`, meeting)).status, 404);
});

test("задачи для заказчика: клиент отмечает, админ ведёт", async () => {
  const add = (body) => admin("POST", `/api/admin/projects/${project.id}/tasks`, body);
  assert.equal((await add({ title: "" })).status, 400);
  assert.equal((await add({ title: "x", url: "javascript:1" })).status, 400);
  await add({ title: "Передать графику", text: "Персонаж и предметы" });
  await add({ title: "Согласовать формат онлайн-покера", due: "2026-10-26", url: "https://figma.com/x" });
  const r = await add({ title: "Подписать допсоглашение", due: "2026-10-24" });
  assert.deepEqual(r.json.project.tasks.map((t) => t.title), ["Подписать допсоглашение", "Согласовать формат онлайн-покера", "Передать графику"], "по сроку, без срока в конце");

  const a = clientA.call;
  const list = await a("GET", "/api/projects");
  assert.equal(list.json.projects[0].openTasks, 3);
  const task = r.json.project.tasks[0];
  const done = await a("POST", `/api/projects/${project.id}/tasks/${task.id}/done`, { done: true });
  assert.equal(done.status, 200);
  const t = done.json.project.tasks.find((x) => x.id === task.id);
  assert.equal(t.done, true);
  assert.equal(t.doneBy, "Иван");
  assert.equal(done.json.project.tasks.at(-1).id, task.id, "выполненные внизу");
  assert.equal((await a("GET", "/api/projects")).json.projects[0].openTasks, 2);

  assert.equal((await a("POST", `/api/admin/projects/${project.id}/tasks`, { title: "x" })).status, 403);
  assert.equal((await a("DELETE", `/api/admin/projects/${project.id}/tasks/${task.id}`)).status, 403);
  assert.equal((await clientB.call("POST", `/api/projects/${project.id}/tasks/${task.id}/done`, { done: true })).status, 404);
  assert.equal((await a("POST", `/api/projects/${project.id}/tasks/nope/done`, { done: true })).status, 404);

  const undo = await a("POST", `/api/projects/${project.id}/tasks/${task.id}/done`, { done: false });
  assert.equal(undo.json.project.tasks[0].doneBy, "");
  const edit = await admin("PATCH", `/api/admin/projects/${project.id}/tasks/${task.id}`, { title: "Подписать допсоглашение №2", due: "2026-10-25" });
  assert.equal(edit.json.project.tasks[0].title, "Подписать допсоглашение №2");
  const del = await admin("DELETE", `/api/admin/projects/${project.id}/tasks/${task.id}`);
  assert.equal(del.json.project.tasks.length, 2);
});

test("смена пароля, сброс и блокировка закрывают сессии", async () => {
  const a = clientA.call;
  assert.equal((await a("POST", "/api/password", { current: "wrong", next: "new-password-1" })).status, 400);
  assert.equal((await a("POST", "/api/password", { current: clientA.password, next: "short" })).status, 400);
  assert.equal((await a("POST", "/api/password", { current: clientA.password, next: "new-password-1" })).status, 200);
  assert.equal((await a("GET", "/api/projects")).status, 200, "текущая сессия живёт");

  const reset = await admin("POST", `/api/admin/users/${clientA.user.id}/password`);
  assert.equal(reset.status, 200);
  assert.equal((await a("GET", "/api/projects")).status, 401, "после сброса старая сессия закрыта");
  assert.equal((await a("POST", "/api/login", { login: "empire", password: reset.json.password })).status, 200);

  await admin("PATCH", `/api/admin/users/${clientA.user.id}`, { disabled: true });
  assert.equal((await a("GET", "/api/projects")).status, 401);
  assert.equal((await a("GET", "/api/me")).json.user, null);
  assert.equal((await a("POST", "/api/login", { login: "empire", password: reset.json.password })).status, 401);
  await admin("PATCH", `/api/admin/users/${clientA.user.id}`, { disabled: false });
});

test("защита: чужой Origin, перебор пароля, большие тела", async () => {
  const r = await admin("PATCH", `/api/admin/projects/${project.id}`, { title: "x" }, { origin: "https://evil.example" });
  assert.equal(r.status, 403);
  assert.equal((await admin("PATCH", `/api/admin/projects/${project.id}`, { title: "Доработка платформы" }, { origin: ORIGIN })).status, 200);

  const bot = client("10.9.9.9");
  for (let i = 0; i < 10; i++) await bot("POST", "/api/login", { login: "admin", password: `guess${i}` });
  assert.equal((await bot("POST", "/api/login", { login: "admin", password: "admin-pass-123" })).status, 429);

  const big = await admin("PATCH", `/api/admin/projects/${project.id}`, { summary: "x".repeat(300 * 1024) });
  assert.equal(big.status, 413);
});

test("интерфейс и статика", async () => {
  const anon = client();
  for (const url of ["/", "/login", "/p/abc", "/admin/p/abc"]) {
    const r = await anon("GET", url);
    assert.equal(r.status, 200, url);
    assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
  }
  assert.equal((await anon("GET", "/app.js")).status, 200);
  assert.equal((await anon("GET", "/favicon.ico")).status, 404, "без SITE_DIR иконки сайта нет");
  assert.equal((await anon("GET", "/server.js")).status, 404);
  assert.equal((await anon("GET", "/fonts/../server.js")).status, 404);
  assert.equal((await anon("GET", "/data/db.json")).status, 404);
});

test("данные переживают перезапуск", () => {
  const db = JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8"));
  assert.equal(db.projects[0].payments.length, 2);
  assert.ok(db.sessions.every((s) => !("token" in s)), "в базе только хеши токенов");
  assert.equal((fs.statSync(path.join(dataDir, "db.json")).mode & 0o777).toString(8), "600");
  assert.equal(progress([]), 0);
});
