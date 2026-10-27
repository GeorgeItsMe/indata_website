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
  fs.writeFileSync(path.join(dataDir, "bookings.json"), JSON.stringify([
    { name: "Клиент", email: "c@example.com", contact: "@client", notes: "", start: Date.UTC(2026, 9, 30, 7), startMsk: "пятница, 30 октября, 10:00–10:15 МСК", createdAt: "2026-10-25T10:00:00Z", pending: true },
    { name: "Ранний", email: "e@example.com", contact: "", notes: "Сайт", start: Date.UTC(2026, 9, 22, 11, 30), createdAt: "2026-10-22T07:57:00Z" },
  ]));
  const handle = createApp({ dataDir, bookingsFile: path.join(dataDir, "bookings.json"), origins: [ORIGIN], secureCookie: false, log: { error() {} } });
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
  const a = await admin("POST", "/api/admin/users", { name: "Иван", company: "Empire", login: "empire", contact: "@ivan" });
  assert.equal(a.status, 201);
  assert.equal(a.json.user.contact, "@ivan");
  const edited = await admin("PATCH", `/api/admin/users/${a.json.user.id}`, { contact: "+7 900 000-00-00", name: "Иван" });
  assert.equal(edited.json.user.contact, "+7 900 000-00-00");
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

test("папки, суммы и оплата без даты", async () => {
  const folder = "Empire Poker Club";
  await admin("PATCH", `/api/admin/projects/${project.id}`, { folder });
  const site = (await admin("POST", "/api/admin/projects", { title: "Сайт клуба", folder, clientIds: [clientA.user.id] })).json.project;
  assert.equal(site.folder, folder);
  const r = await admin("PATCH", `/api/admin/projects/${site.id}`, {
    payments: [
      { title: "Аванс", amount: 85000, paid: true, paidAt: "" },
      { title: "Остаток", amount: 85000, paid: false },
      { title: "Сегодня", amount: 1000, paid: true },
    ],
  });
  assert.deepEqual(r.json.project.payments.map((x) => x.paidAt.length), [0, 0, 10], "пустая дата остаётся пустой, без даты — сегодня");
  const list = (await clientA.call("GET", "/api/projects")).json.projects;
  assert.deepEqual(list.map((x) => x.title), ["Доработка платформы", "Сайт клуба"], "по названию внутри папки");
  const s = list.find((x) => x.id === site.id);
  assert.equal(s.total, 171000);
  assert.equal(s.paid, 86000);
  assert.equal(s.folder, folder);
  await admin("DELETE", `/api/admin/projects/${site.id}`);
});

test("менеджер проекта: свои проекты, без денег и скрытых блоков", async () => {
  const other = (await admin("POST", "/api/admin/projects", { title: "Чужой проект" })).json.project;
  assert.equal((await admin("POST", "/api/admin/users", { name: "ПМ", login: "pm-bad", role: "manager", projectIds: ["nope"] })).status, 400);
  const created = await admin("POST", "/api/admin/users", {
    name: "Ольга", login: "olga.pm", role: "manager", projectIds: [project.id], hide: ["files", "money", "files"],
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.json.user.hide, ["files"], "лишние значения отбрасываются");
  const pm = client("10.0.0.7");
  await pm("POST", "/api/login", { login: "olga.pm", password: created.json.password });

  const list = (await pm("GET", "/api/projects")).json.projects;
  assert.deepEqual(list.map((x) => x.id), [project.id], "только свои проекты");
  assert.equal(list[0].total, undefined, "суммы не видно");
  assert.equal(list[0].paid, undefined);
  const view = (await pm("GET", `/api/projects/${project.id}`)).json.project;
  assert.equal(view.payments, undefined, "оплаты не отдаются");
  assert.equal(view.files, undefined, "скрытый блок не отдаётся");
  assert.ok(Array.isArray(view.tasks) && Array.isArray(view.meetings));
  assert.equal(view.clientIds, undefined);
  assert.equal((await pm("GET", `/api/projects/${other.id}`)).status, 404);

  // Правит этапы и задачи, но не деньги, доступы и скрытое
  const stages = view.stages.map((x) => ({ ...x, note: "от ПМ" }));
  const r = await pm("PATCH", `/api/admin/projects/${project.id}`, { stages });
  assert.equal(r.status, 200);
  assert.equal(r.json.project.payments, undefined, "и в ответе на правку денег нет");
  assert.equal((await pm("PATCH", `/api/admin/projects/${project.id}`, { payments: [] })).status, 403);
  assert.equal((await pm("PATCH", `/api/admin/projects/${project.id}`, { clientIds: [] })).status, 403);
  assert.equal((await pm("PATCH", `/api/admin/projects/${project.id}`, { folder: "x" })).status, 403);
  assert.equal((await pm("POST", `/api/admin/projects/${project.id}/tasks`, { title: "От ПМ" })).status, 201);
  assert.equal((await pm("POST", `/api/admin/projects/${project.id}/files`, Buffer.from("x"), { "x-filename": "a.txt" })).status, 403);
  const fileId = (await admin("GET", `/api/projects/${project.id}`)).json.project.files[0].id;
  assert.equal((await pm("GET", `/api/projects/${project.id}/files/${fileId}`)).status, 404);
  assert.equal((await pm("PATCH", `/api/admin/projects/${other.id}`, { stages })).status, 404);
  assert.equal((await pm("POST", "/api/admin/projects", { title: "x" })).status, 403);
  assert.equal((await pm("DELETE", `/api/admin/projects/${project.id}`)).status, 403);
  assert.equal((await pm("GET", "/api/admin/users")).status, 403);

  // Админ открывает файлы и даёт второй проект
  const edited = await admin("PATCH", `/api/admin/users/${created.json.user.id}`, { hide: [], projectIds: [project.id, other.id] });
  assert.deepEqual(edited.json.user.projectIds, [project.id, other.id]);
  assert.ok(Array.isArray((await pm("GET", `/api/projects/${project.id}`)).json.project.files));
  assert.equal((await pm("GET", "/api/projects")).json.projects.length, 2);
  await admin("DELETE", `/api/admin/projects/${other.id}`);
  assert.deepEqual((await pm("GET", "/api/me")).json.user.projectIds, [project.id], "удалённый проект пропадает у менеджера");
});

test("доступ клиента к проектам выставляется в карточке человека", async () => {
  const second = (await admin("POST", "/api/admin/projects", { title: "Сайт" })).json.project;
  const made = await admin("POST", "/api/admin/users", { name: "Гость", login: "guest", projectIds: [second.id] });
  assert.equal(made.status, 201);
  assert.deepEqual(made.json.user.projectIds, [second.id]);
  assert.deepEqual((await admin("GET", `/api/projects/${second.id}`)).json.project.clientIds, [made.json.user.id]);
  assert.equal((await admin("POST", "/api/admin/users", { name: "Х", login: "guest-bad", projectIds: ["nope"] })).status, 400);
  assert.equal((await admin("GET", "/api/admin/users")).json.users.some((u) => u.login === "guest-bad"), false, "с ошибкой никого не заводим");

  const g = client("10.0.0.7");
  await g("POST", "/api/login", { login: "guest", password: made.json.password });
  assert.deepEqual((await g("GET", "/api/projects")).json.projects.map((x) => x.id), [second.id]);
  assert.equal((await g("GET", `/api/projects/${project.id}`)).status, 404);

  const moved = await admin("PATCH", `/api/admin/users/${made.json.user.id}`, { projectIds: [project.id] });
  assert.deepEqual(moved.json.user.projectIds, [project.id]);
  assert.deepEqual((await g("GET", "/api/projects")).json.projects.map((x) => x.id), [project.id], "доступ меняется сразу");
  assert.deepEqual((await admin("GET", `/api/projects/${project.id}`)).json.project.clientIds, [clientA.user.id, made.json.user.id], "другие клиенты проекта остаются");

  await admin("DELETE", `/api/admin/users/${made.json.user.id}`);
  await admin("DELETE", `/api/admin/projects/${second.id}`);
});

test("логотип проекта: только картинка, видят те, кому открыт проект", async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("logo")]);
  assert.equal((await admin("PUT", `/api/admin/projects/${project.id}/logo`, Buffer.from("<svg/>"), { "content-type": "image/svg+xml" })).status, 400);
  assert.equal((await admin("PUT", `/api/admin/projects/${project.id}/logo`, Buffer.from("<html>"), { "content-type": "image/png" })).status, 400, "тип проверяем по байтам");
  const big = await admin("PUT", `/api/admin/projects/${project.id}/logo`, Buffer.concat([png, Buffer.alloc(1024 * 1024)]), { "content-type": "image/png" });
  assert.equal(big.status, 413);
  assert.equal(big.json.error, "logo_large");

  const r = await admin("PUT", `/api/admin/projects/${project.id}/logo`, png, { "content-type": "image/png" });
  assert.equal(r.status, 200);
  const logo = r.json.project.logo;
  assert.match(logo, /^[\w-]+$/);
  assert.equal((await clientA.call("GET", "/api/projects")).json.projects[0].logo, logo, "логотип есть в списке проектов");
  const img = await clientA.call("GET", `/api/projects/${project.id}/logo`);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.deepEqual(img.raw, png);
  assert.equal((await clientB.call("GET", `/api/projects/${project.id}/logo`)).status, 404, "чужой клиент не видит");
  assert.equal((await clientA.call("PUT", `/api/admin/projects/${project.id}/logo`, png, { "content-type": "image/png" })).status, 403);

  const again = await admin("PUT", `/api/admin/projects/${project.id}/logo`, png, { "content-type": "image/png" });
  assert.notEqual(again.json.project.logo, logo, "новая картинка, новый адрес");
  assert.equal((await admin("DELETE", `/api/admin/projects/${project.id}/logo`)).json.project.logo, "");
  assert.equal((await clientA.call("GET", `/api/projects/${project.id}/logo`)).status, 404);
});

test("папки людей: создать, переложить, переименовать, удалить", async () => {
  const made = await admin("POST", "/api/admin/people-folders", { name: "Empire" });
  assert.equal(made.status, 201);
  assert.deepEqual(made.json.folders, ["Empire"]);
  assert.equal((await admin("POST", "/api/admin/people-folders", { name: "Empire" })).status, 409);
  assert.equal((await admin("POST", "/api/admin/people-folders", { name: " " })).status, 400);

  const moved = await admin("PATCH", `/api/admin/users/${clientA.user.id}`, { folder: "Empire" });
  assert.equal(moved.json.user.folder, "Empire");
  const added = await admin("POST", "/api/admin/users", { name: "Подрядчик", login: "contractor", folder: "Подрядчики" });
  assert.equal(added.json.user.folder, "Подрядчики");
  assert.deepEqual((await admin("GET", "/api/admin/users")).json.folders, ["Empire", "Подрядчики"], "новая папка из карточки попадает в список");
  assert.equal((await clientA.call("GET", "/api/me")).json.user.folder, undefined, "клиент не видит, в какой он папке");
  assert.equal((await clientA.call("POST", "/api/admin/people-folders", { name: "x" })).status, 403);

  assert.equal((await admin("POST", "/api/admin/people-folders/rename", { from: "Empire", to: "Подрядчики" })).status, 409);
  const renamed = await admin("POST", "/api/admin/people-folders/rename", { from: "Empire", to: "Empire Poker Club" });
  assert.deepEqual(renamed.json.folders, ["Empire Poker Club", "Подрядчики"], "порядок папок сохраняется");
  assert.equal(renamed.json.users.find((u) => u.id === clientA.user.id).folder, "Empire Poker Club");

  const order = await admin("POST", "/api/admin/people-folders/order", { folders: ["Подрядчики", "Empire Poker Club"] });
  assert.deepEqual(order.json.folders, ["Подрядчики", "Empire Poker Club"]);
  assert.equal((await admin("POST", "/api/admin/people-folders/order", { folders: ["Подрядчики"] })).status, 400, "папку не потерять");
  assert.equal((await admin("POST", "/api/admin/people-folders/order", { folders: ["Подрядчики", "Подрядчики"] })).status, 400);
  assert.equal((await admin("POST", "/api/admin/people-folders/order", { folders: ["Подрядчики", "Чужая"] })).status, 400);

  const removed = await admin("POST", "/api/admin/people-folders/delete", { name: "Empire Poker Club" });
  assert.deepEqual(removed.json.folders, ["Подрядчики"]);
  assert.equal(removed.json.users.find((u) => u.id === clientA.user.id).folder, "", "человек остаётся, просто без папки");
  assert.equal((await clientA.call("GET", "/api/projects")).json.projects.length, 1, "на доступ к проектам папка не влияет");

  await admin("DELETE", `/api/admin/users/${added.json.user.id}`);
  await admin("POST", "/api/admin/people-folders/delete", { name: "Подрядчики" });
});

test("ссылки в документах", async () => {
  const r = await admin("POST", `/api/admin/projects/${project.id}/links`, { name: "Макеты в Figma", url: "https://figma.com/design/x" });
  assert.equal(r.status, 201);
  const [link] = r.json.project.links;
  assert.equal(link.name, "Макеты в Figma");
  assert.equal((await admin("POST", `/api/admin/projects/${project.id}/links`, { name: "x", url: "javascript:alert(1)" })).status, 400);
  assert.equal((await admin("POST", `/api/admin/projects/${project.id}/links`, { url: "https://a.ru" })).status, 400);
  assert.deepEqual((await clientA.call("GET", `/api/projects/${project.id}`)).json.project.links.map((l) => l.url), ["https://figma.com/design/x"]);
  assert.equal((await clientA.call("POST", `/api/admin/projects/${project.id}/links`, { name: "x", url: "https://a.ru" })).status, 403);
  assert.equal((await admin("DELETE", `/api/admin/projects/${project.id}/links/${link.id}`)).json.project.links.length, 0);
});

test("заявки на звонок видит только админ", async () => {
  const r = await admin("GET", "/api/admin/bookings");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.bookings.map((b) => b.name), ["Клиент", "Ранний"], "свежие по времени звонка сверху");
  assert.equal(r.json.bookings[0].notified, false, "видно, что уведомление не дошло");
  assert.equal((await clientA.call("GET", "/api/admin/bookings")).status, 403);
});

test("смена роли: админ становится менеджером без смены пароля", async () => {
  const made = await admin("POST", "/api/admin/users", { name: "Второй админ", login: "admin2", role: "admin" });
  const a2 = client("10.0.0.8");
  await a2("POST", "/api/login", { login: "admin2", password: made.json.password });
  assert.ok((await a2("GET", "/api/admin/users")).status === 200, "пока админ");
  const r = await admin("PATCH", `/api/admin/users/${made.json.user.id}`, { role: "manager", projectIds: [project.id] });
  assert.equal(r.json.user.role, "manager");
  assert.deepEqual(r.json.user.projectIds, [project.id]);
  assert.equal((await a2("GET", "/api/admin/users")).status, 403, "та же сессия, но уже без админки");
  assert.deepEqual((await a2("GET", "/api/projects")).json.projects.map((x) => x.id), [project.id]);
  assert.equal((await a2("GET", `/api/projects/${project.id}`)).json.project.payments, undefined);
  assert.equal((await admin("PATCH", `/api/admin/users/admin0001`, { role: "client" })).status, 400, "себе роль не меняем");
  await admin("DELETE", `/api/admin/users/${made.json.user.id}`);
});

test("процент проекта можно поставить вручную", async () => {
  const auto = (await admin("GET", `/api/projects/${project.id}`)).json.project.progressAuto;
  const r = await admin("PATCH", `/api/admin/projects/${project.id}`, { progress: 37 });
  assert.equal(r.json.project.progress, 37);
  assert.equal(r.json.project.progressManual, true);
  assert.equal((await clientA.call("GET", "/api/projects")).json.projects.find((x) => x.id === project.id).progress, 37);
  assert.equal((await admin("PATCH", `/api/admin/projects/${project.id}`, { progress: 150 })).status, 400);
  assert.equal((await admin("PATCH", `/api/admin/projects/${project.id}`, { progress: 12.5 })).status, 400);
  const back = await admin("PATCH", `/api/admin/projects/${project.id}`, { progress: null });
  assert.equal(back.json.project.progress, auto, "пусто — снова по этапам");
  assert.equal(back.json.project.progressManual, false);
});

test("чек-лист: разделы, наши пункты и комментарии", async () => {
  const add = (body) => admin("POST", `/api/admin/projects/${project.id}/tasks`, body);
  await add({ title: "Выбрать SMS-сервис", group: "Вход по SMS", side: "client" });
  const r = await add({ title: "Сравнить SMS-сервисы", group: "Вход по SMS", side: "team" });
  const team = r.json.project.tasks.find((t) => t.title === "Сравнить SMS-сервисы");
  assert.equal(team.side, "team");
  assert.deepEqual(team.comments, []);
  const before = (await clientA.call("GET", "/api/projects")).json.projects.find((x) => x.id === project.id).openTasks;

  // Клиент не отмечает наши пункты, но комментирует
  assert.equal((await clientA.call("POST", `/api/projects/${project.id}/tasks/${team.id}/done`, { done: true })).status, 403);
  const c = await clientA.call("POST", `/api/projects/${project.id}/tasks/${team.id}/comments`, { text: "Нам важна цена на МТС" });
  assert.equal(c.status, 201);
  const comment = c.json.project.tasks.find((t) => t.id === team.id).comments[0];
  assert.equal(comment.author, "Иван");
  assert.equal((await clientA.call("POST", `/api/projects/${project.id}/tasks/${team.id}/comments`, { text: "  " })).status, 400);
  assert.equal((await clientB.call("POST", `/api/projects/${project.id}/tasks/${team.id}/comments`, { text: "чужой" })).status, 404);

  // Наш пункт отмечает админ; счётчик клиента считает только пункты клуба
  assert.equal((await admin("POST", `/api/projects/${project.id}/tasks/${team.id}/done`, { done: true })).status, 200);
  const after = (await clientA.call("GET", "/api/projects")).json.projects.find((x) => x.id === project.id).openTasks;
  assert.equal(after, before, "наши пункты не входят в «Нужно от вас»");

  // Правка без группы и стороны их не сбрасывает
  const edited = await admin("PATCH", `/api/admin/projects/${project.id}/tasks/${team.id}`, { title: "Сравнить 4 SMS-сервиса" });
  const t2 = edited.json.project.tasks.find((t) => t.id === team.id);
  assert.equal(t2.group, "Вход по SMS");
  assert.equal(t2.side, "team");

  // Удалить комментарий может автор, чужой клиент не может
  assert.equal((await clientA.call("DELETE", `/api/projects/${project.id}/tasks/${team.id}/comments/${comment.id}`)).status, 200);
});

test("разделы чек-листа: переименовать и удалить", async () => {
  const add = (body) => admin("POST", `/api/admin/projects/${project.id}/tasks`, body);
  await add({ title: "Пункт 1", group: "Раздел А", side: "client" });
  await add({ title: "Пункт 2", group: "Раздел А", side: "team" });
  const ren = await admin("POST", `/api/admin/projects/${project.id}/task-groups/rename`, { from: "Раздел А", to: "Раздел Б" });
  assert.equal(ren.status, 200);
  assert.equal(ren.json.project.tasks.filter((x) => x.group === "Раздел Б").length, 2);
  assert.equal((await admin("POST", `/api/admin/projects/${project.id}/task-groups/rename`, { from: "Нет такого", to: "X" })).status, 404);
  assert.equal((await admin("POST", `/api/admin/projects/${project.id}/task-groups/rename`, { from: "Раздел Б", to: " " })).status, 400);
  assert.equal((await clientA.call("POST", `/api/admin/projects/${project.id}/task-groups/delete`, { group: "Раздел Б" })).status, 403);
  const del = await admin("POST", `/api/admin/projects/${project.id}/task-groups/delete`, { group: "Раздел Б" });
  assert.equal(del.json.project.tasks.some((x) => x.group === "Раздел Б"), false);
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
