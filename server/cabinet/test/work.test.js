"use strict";
// Внутренняя часть: задачи, спринты, вики, доски и живые обновления. npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp, hashPassword } = require("../app.js");
const { keyFromTitle } = require("../work.js");

const ORIGIN = "https://app.indata.group";
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
let server;
let handle;
let base;
let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cabinet-work-"));
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify({
    users: [{ id: "admin0001", login: "admin", name: "Админ", role: "admin", password: hashPassword("admin-pass-123"), createdAt: "" }],
    projects: [],
    sessions: [],
  }));
  handle = createApp({ dataDir, origins: [ORIGIN], secureCookie: false, log: { error() {} } });
  server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  handle.close();
  server.closeAllConnections();
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function client(ip) {
  let cookie = "";
  const call = async (method, url, body, headers = {}) => {
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
  // Поток событий: next(name) ждёт событие с этим именем и возвращает его данные.
  call.events = async (url) => {
    const ctrl = new AbortController();
    const res = await fetch(base + url, { headers: { cookie, "x-real-ip": ip }, signal: ctrl.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/event-stream/);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    return {
      async next(name) {
        for (;;) {
          let cut;
          while ((cut = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, cut);
            buf = buf.slice(cut + 2);
            const event = /^event: (.+)$/m.exec(chunk)?.[1];
            const data = /^data: (.+)$/m.exec(chunk)?.[1];
            if (event === name) return JSON.parse(data);
          }
          const { value, done } = await reader.read();
          if (done) throw new Error("stream closed");
          buf += decoder.decode(value, { stream: true });
        }
      },
      close: () => ctrl.abort(),
    };
  };
  return call;
}

async function login(ip, loginName, password) {
  const call = client(ip);
  const res = await call("POST", "/api/login", { login: loginName, password });
  assert.equal(res.status, 200, `вход ${loginName}: ${JSON.stringify(res.json)}`);
  return call;
}

let admin;
let dev;
let pm;
let customer;
let outsider;
let p1;
let p2;
let devUser;
let pmUser;

test("ключ проекта из названия", () => {
  assert.equal(keyFromTitle("Доработки 2: онлайн-покер"), "D2OP");
  assert.equal(keyFromTitle("Сайт"), "SAJ");
  assert.equal(keyFromTitle("MangoFish"), "MAN");
  assert.equal(keyFromTitle("1С интеграция"), "INT");
});

test("роль разработчика: внутренняя часть своих проектов, кабинет клиента только читает", async () => {
  admin = await login("10.1.0.1", "admin", "admin-pass-123");
  p1 = (await admin("POST", "/api/admin/projects", { title: "Доработки 2: онлайн-покер" })).json.project;
  p2 = (await admin("POST", "/api/admin/projects", { title: "Сайт" })).json.project;
  await admin("PATCH", `/api/admin/projects/${p1.id}`, { payments: [{ title: "Аванс", amount: 100000, paid: false }] });

  const d = await admin("POST", "/api/admin/users", { name: "Дев", login: "dev", role: "developer", projectIds: [p1.id] });
  assert.equal(d.status, 201);
  assert.deepEqual(d.json.user.projectIds, [p1.id]);
  assert.equal(d.json.user.hide, undefined);
  devUser = d.json.user;
  const m = await admin("POST", "/api/admin/users", { name: "ПМ", login: "pmanager", role: "manager", projectIds: [p1.id, p2.id] });
  pmUser = m.json.user;
  const c = await admin("POST", "/api/admin/users", { name: "Клиент", login: "client", projectIds: [p1.id] });
  const o = await admin("POST", "/api/admin/users", { name: "Без проектов", login: "nobody", role: "developer" });

  dev = await login("10.1.0.2", "dev", d.json.password);
  pm = await login("10.1.0.3", "pmanager", m.json.password);
  customer = await login("10.1.0.4", "client", c.json.password);
  outsider = await login("10.1.0.5", "nobody", o.json.password);

  const spaces = await dev("GET", "/api/work/projects");
  assert.equal(spaces.status, 200);
  assert.deepEqual(spaces.json.projects.map((x) => x.key), ["D2OP"]);
  assert.ok(spaces.json.team.some((u) => u.login === "dev"));
  assert.equal((await dev("GET", `/api/work/projects/${p2.id}`)).status, 404);
  assert.equal((await customer("GET", "/api/work/projects")).status, 403, "клиенту внутренняя часть закрыта");
  assert.deepEqual((await outsider("GET", "/api/work/projects")).json.projects, []);

  const view = await dev("GET", `/api/projects/${p1.id}`);
  assert.equal(view.status, 200);
  assert.equal(view.json.project.payments, undefined, "денег разработчик не видит");
  assert.equal((await dev("PATCH", `/api/admin/projects/${p1.id}`, { title: "X" })).status, 403);
  assert.equal((await dev("GET", "/api/admin/users")).status, 403);
  assert.equal((await dev("GET", `/api/projects/${p2.id}`)).status, 404);

  // Смена роли разработчика на клиента снимает projectIds.
  const switched = await admin("PATCH", `/api/admin/users/${o.json.user.id}`, { role: "client", projectIds: [] });
  assert.equal(switched.json.user.role, "client");
  const back = await admin("PATCH", `/api/admin/users/${o.json.user.id}`, { role: "developer", projectIds: [] });
  assert.deepEqual(back.json.user.projectIds, []);
  outsider = await login("10.1.0.5", "nobody", (await admin("POST", `/api/admin/users/${o.json.user.id}/password`)).json.password);
});

let epic;
let task;
let bug;

test("задачи: ключи, поля, история, порядок", async () => {
  const e = await pm("POST", `/api/work/projects/${p1.id}/issues`, { title: "Онлайн-покер", type: "epic", start: "2026-11-01", due: "2026-12-15" });
  assert.equal(e.status, 201);
  epic = e.json.issue;
  assert.equal(epic.key, "D2OP-1");
  assert.equal(epic.reporterId, pmUser.id);

  const t = await pm("POST", `/api/work/projects/${p1.id}/issues`, {
    title: "Лобби столов", assigneeId: devUser.id, epicId: epic.id, priority: "high", labels: ["front", "front", " "], estimate: 6.1,
  });
  task = t.json.issue;
  assert.equal(task.key, "D2OP-2");
  assert.deepEqual(task.labels, ["front"]);
  assert.equal(task.estimate, 6, "оценка округляется до 15 минут");
  assert.equal(task.status, "todo");

  assert.equal((await pm("POST", `/api/work/projects/${p1.id}/issues`, { title: "" })).status, 400);
  assert.equal((await pm("POST", `/api/work/projects/${p1.id}/issues`, { title: "X", type: "nope" })).status, 400);
  const clientUser = (await admin("GET", "/api/admin/users")).json.users.find((u) => u.login === "client");
  assert.equal((await pm("POST", `/api/work/projects/${p1.id}/issues`, { title: "X", assigneeId: clientUser.id })).status, 400, "клиенту задачу не назначить");
  assert.equal((await pm("POST", `/api/work/projects/${p1.id}/issues`, { title: "X", epicId: task.id })).status, 400, "эпиком может быть только эпик");
  assert.equal((await outsider("POST", `/api/work/projects/${p1.id}/issues`, { title: "X" })).status, 404);

  bug = (await dev("POST", `/api/work/projects/${p1.id}/issues`, { title: "Падает вход", type: "bug", place: { before: task.id } })).json.issue;
  const list = (await dev("GET", `/api/work/projects/${p1.id}`)).json;
  assert.deepEqual(list.issues.map((i) => i.key), ["D2OP-1", "D2OP-3", "D2OP-2"], "баг встал перед задачей");
  assert.ok(list.members.includes(devUser.id) && list.members.includes(pmUser.id));
  assert.equal(list.project.key, "D2OP");
  assert.equal(list.project.canManage, false);

  const moved = await dev("PATCH", `/api/work/issues/${task.id}`, { status: "progress" });
  assert.equal(moved.json.issue.status, "progress");
  await dev("PATCH", `/api/work/issues/${task.id}`, { status: "review" });
  const done = await dev("PATCH", `/api/work/issues/${task.id}`, { status: "done", place: { after: bug.id } });
  assert.ok(done.json.issue.doneAt);
  const statusHistory = done.json.issue.history.filter((x) => x.field === "status");
  assert.equal(statusHistory.length, 1, "быстрые смены статуса — одна запись");
  assert.deepEqual([statusHistory[0].from, statusHistory[0].to], ["todo", "done"]);
  const reopened = await dev("PATCH", `/api/work/issues/${task.id}`, { status: "progress", checklist: [{ text: "Вёрстка" }, { text: "API", done: true }] });
  assert.equal(reopened.json.issue.doneAt, "");
  assert.deepEqual(reopened.json.issue.checks, { done: 1, total: 2 });

  const byKey = await dev("GET", "/api/work/issue-by-key/d2op-2");
  assert.equal(byKey.json.issue.id, task.id);
  assert.equal((await outsider("GET", "/api/work/issue-by-key/D2OP-2")).status, 404);

  // Эпик перестал быть эпиком — задачи из него выходят.
  await pm("PATCH", `/api/work/issues/${epic.id}`, { type: "story" });
  assert.equal((await pm("GET", `/api/work/issues/${task.id}`)).json.issue.epicId, "");
  await pm("PATCH", `/api/work/issues/${epic.id}`, { type: "epic" });
  await pm("PATCH", `/api/work/issues/${task.id}`, { epicId: epic.id });
});

test("комментарии, время и вложения", async () => {
  const c = await pm("POST", `/api/work/issues/${task.id}/comments`, { text: "Посмотри макет" });
  assert.equal(c.status, 201);
  const comment = c.json.issue.comments[0];
  assert.equal((await dev("PATCH", `/api/work/issues/${task.id}/comments/${comment.id}`, { text: "чужой" })).status, 403);
  assert.equal((await pm("PATCH", `/api/work/issues/${task.id}/comments/${comment.id}`, { text: "Посмотри макет в Figma" })).json.issue.comments[0].editedAt.length > 0, true);
  assert.equal((await dev("DELETE", `/api/work/issues/${task.id}/comments/${comment.id}`)).status, 403);

  assert.equal((await dev("POST", `/api/work/issues/${task.id}/worklogs`, { hours: 0 })).status, 400);
  assert.equal((await dev("POST", `/api/work/issues/${task.id}/worklogs`, { hours: 30 })).status, 400);
  const w = await dev("POST", `/api/work/issues/${task.id}/worklogs`, { hours: 2.5, date: "2026-10-29", note: "Вёрстка лобби" });
  assert.equal(w.json.issue.spent, 2.5);
  const logs = (await pm("GET", `/api/work/projects/${p1.id}/worklogs`)).json.worklogs;
  assert.equal(logs[0].key, "D2OP-2");
  assert.equal((await pm("DELETE", `/api/work/issues/${task.id}/worklogs/${logs[0].id}`)).status, 403, "чужое время удаляет только админ");

  const up = await dev("POST", `/api/work/issues/${task.id}/files`, PNG, { "content-type": "image/png", "x-filename": encodeURIComponent("экран.png") });
  assert.equal(up.status, 201);
  const file = up.json.file;
  const got = await pm("GET", `/api/work/issues/${task.id}/files/${file.id}`);
  assert.equal(got.headers.get("content-type"), "image/png");
  assert.ok(got.raw.equals(PNG));
  assert.equal((await outsider("GET", `/api/work/issues/${task.id}/files/${file.id}`)).status, 404);
});

test("удалить задачу может автор или менеджер", async () => {
  assert.equal((await dev("DELETE", `/api/work/issues/${epic.id}`)).status, 403);
  const tmp = (await dev("POST", `/api/work/projects/${p1.id}/issues`, { title: "Временная" })).json.issue;
  assert.equal((await dev("DELETE", `/api/work/issues/${tmp.id}`)).status, 200);
  assert.equal((await dev("GET", `/api/work/issues/${tmp.id}`)).status, 404);
});

test("спринты: старт, один активный, завершение с переносом", async () => {
  const s1 = (await pm("POST", `/api/work/projects/${p1.id}/sprints`, { goal: "Лобби" })).json.sprint;
  assert.equal(s1.name, "D2OP Спринт 1");
  assert.equal(s1.state, "planned");
  const s2 = (await pm("POST", `/api/work/projects/${p1.id}/sprints`, {})).json.sprint;
  await pm("PATCH", `/api/work/issues/${task.id}`, { sprintId: s1.id, estimate: 8 });
  await pm("PATCH", `/api/work/issues/${bug.id}`, { sprintId: s1.id, status: "done", estimate: 2 });

  const started = await pm("POST", `/api/work/sprints/${s1.id}/start`, { start: "2026-10-26", end: "2026-11-08" });
  assert.equal(started.json.sprint.state, "active");
  assert.equal((await pm("POST", `/api/work/sprints/${s2.id}/start`, {})).status, 409, "активный спринт один");
  assert.equal((await pm("POST", `/api/work/sprints/${s1.id}/complete`, { moveTo: s1.id })).status, 400);

  const closed = await dev("POST", `/api/work/sprints/${s1.id}/complete`, { moveTo: s2.id });
  assert.equal(closed.json.sprint.state, "closed");
  assert.deepEqual(closed.json.sprint.stats, { total: 2, done: 1, estimate: 10, doneEstimate: 2 });
  const after = (await pm("GET", `/api/work/projects/${p1.id}`)).json.issues;
  assert.equal(after.find((i) => i.id === task.id).sprintId, s2.id, "незавершённая ушла в следующий спринт");
  assert.equal(after.find((i) => i.id === bug.id).sprintId, s1.id, "сделанная осталась в закрытом");
  assert.equal((await pm("PATCH", `/api/work/issues/${task.id}`, { sprintId: s1.id })).status, 400, "в закрытый спринт нельзя");

  assert.equal((await pm("DELETE", `/api/work/sprints/${s2.id}`)).status, 200);
  assert.equal((await pm("GET", `/api/work/issues/${task.id}`)).json.issue.sprintId, "");
});

test("вики: дерево, версии, защита от затирания чужих правок", async () => {
  const root = (await pm("POST", `/api/work/projects/${p1.id}/pages`, { title: "Техническое задание", body: "# ТЗ\n\nПервая версия" })).json.page;
  const child = (await dev("POST", `/api/work/projects/${p1.id}/pages`, { title: "API", parentId: root.id })).json.page;
  assert.equal(child.parentId, root.id);
  assert.equal((await dev("PATCH", `/api/work/pages/${root.id}`, { parentId: child.id })).status, 400, "в свою подстраницу нельзя");

  const edited = await dev("PATCH", `/api/work/pages/${root.id}`, { body: "# ТЗ\n\nВторая версия", base: root.updatedAt });
  assert.equal(edited.status, 200);
  assert.equal(edited.json.page.versions.length, 1);
  assert.equal((await pm("PATCH", `/api/work/pages/${root.id}`, { body: "моя", base: root.updatedAt })).status, 409, "страницу уже поменяли");
  const old = await pm("GET", `/api/work/pages/${root.id}/versions/0`);
  assert.equal(old.json.version.body, "# ТЗ\n\nПервая версия");
  assert.equal(old.json.version.by, "ПМ");

  const img = await dev("POST", `/api/work/pages/${root.id}/files`, Buffer.from("<svg/>"), { "content-type": "image/png", "x-filename": "x.png" });
  assert.equal(img.status, 400, "картинка проверяется по содержимому");

  assert.equal((await dev("DELETE", `/api/work/pages/${root.id}`)).status, 403, "удаляет автор или менеджер");
  assert.equal((await pm("DELETE", `/api/work/pages/${root.id}`)).status, 200);
  const pages = (await dev("GET", `/api/work/projects/${p1.id}/pages`)).json.pages;
  assert.deepEqual(pages.map((x) => [x.title, x.parentId]), [["API", ""]], "подстраница поднялась наверх");
});

test("моя работа и поиск", async () => {
  await pm("PATCH", `/api/work/issues/${task.id}`, { priority: "urgent" });
  await pm("POST", `/api/work/issues/${task.id}/comments`, { text: "Срочно к релизу" });
  const me = (await dev("GET", "/api/work/me")).json;
  assert.ok(me.assigned.some((i) => i.key === "D2OP-2" && i.projectTitle === "Доработки 2: онлайн-покер"));
  assert.ok(me.feed.some((x) => x.kind === "change" && x.field === "priority" && x.to === "urgent" && x.by === "ПМ"));
  assert.ok(me.feed.some((x) => x.kind === "comment" && x.text === "Срочно к релизу"));
  assert.ok(!me.feed.some((x) => x.by === "Дев"), "свои действия в ленту не попадают");
  assert.equal(me.worklogs[0].hours, 2.5);

  const byKey = (await dev("GET", "/api/work/search?q=d2op-2")).json;
  assert.equal(byKey.issues[0].key, "D2OP-2");
  assert.equal((await dev("GET", `/api/work/search?q=${encodeURIComponent("лобби")}`)).json.issues[0].id, task.id);
  assert.deepEqual((await outsider("GET", "/api/work/search?q=d2op")).json.issues, []);
});

let board;

test("доски: шаблон, операции, проверка объектов, доступ", async () => {
  const created = await dev("POST", "/api/work/boards", { projectId: p1.id, title: "Ретро спринта", template: "retro" });
  assert.equal(created.status, 201);
  board = created.json.board;
  assert.ok(board.count >= 6);
  assert.equal(board.project.key, "D2OP");
  assert.equal((await outsider("GET", `/api/work/boards/${board.id}`)).status, 404);
  assert.equal((await outsider("POST", "/api/work/boards", { projectId: p1.id, title: "X" })).status, 404);
  const general = await outsider("POST", "/api/work/boards", { title: "Общая" });
  assert.equal(general.json.board.projectId, "");
  assert.ok((await dev("GET", "/api/work/boards")).json.boards.some((b) => b.title === "Общая"), "общие доски видит вся команда");
  assert.equal((await customer("GET", "/api/work/boards")).status, 403);

  const loaded = await pm("GET", `/api/work/boards/${board.id}`);
  assert.equal(loaded.json.version, 0);
  const sticky = { id: "stk00001", type: "sticky", x: 10, y: 20, w: 200, h: 200, text: "Идея", color: "yellow", z: 5 };
  const r = await pm("POST", `/api/work/boards/${board.id}/ops`, { client: "tab-pm", ops: [{ op: "put", item: sticky }, { op: "put", item: { id: "iss00001", type: "issue", x: 300, y: 0, w: 260, h: 120, issueId: task.id } }] });
  assert.equal(r.json.version, 1);
  const bad = await pm("POST", `/api/work/boards/${board.id}/ops`, { client: "tab-pm", ops: [{ op: "del", id: "stk00001" }, { op: "put", item: { id: "x", type: "sticky" } }] });
  assert.equal(bad.status, 400);
  const items = (await pm("GET", `/api/work/boards/${board.id}`)).json;
  assert.ok(items.items.some((it) => it.id === "stk00001"), "пачка с ошибкой не применилась частично");
  assert.equal(items.issues[0].key, "D2OP-2", "карточка задачи приходит вместе с доской");
  assert.ok(items.team.some((u) => u.login === "dev") && !items.team.some((u) => u.login === "client"), "имена команды для карточек, без клиентов");

  const clamp = await pm("POST", `/api/work/boards/${board.id}/ops`, { client: "tab-pm", ops: [{ op: "put", item: { id: "pen00001", type: "pen", x: 1e300, y: 0, points: [0, 0, 10, 10.123], color: "javascript:alert(1)" } }] });
  assert.equal(clamp.status, 200);
  const pen = (await pm("GET", `/api/work/boards/${board.id}`)).json.items.find((it) => it.id === "pen00001");
  assert.equal(pen.x, 1e6);
  assert.equal(pen.color, "black");
  assert.deepEqual(pen.points, [0, 0, 10, 10.1]);
  assert.equal((await pm("POST", `/api/work/boards/${board.id}/ops`, { ops: [{ op: "put", item: { id: "img00001", type: "image", x: 0, y: 0, fileId: "nofile00" } }] })).status, 400, "картинка только из файлов доски");

  const up = await pm("POST", `/api/work/boards/${board.id}/files`, PNG, { "content-type": "image/png", "x-filename": "shot.png" });
  assert.equal(up.status, 201);
  assert.equal((await pm("POST", `/api/work/boards/${board.id}/ops`, { ops: [{ op: "put", item: { id: "img00001", type: "image", x: 0, y: 0, w: 100, h: 100, fileId: up.json.file.id } }] })).status, 200);
  assert.equal((await pm("POST", `/api/work/boards/${board.id}/files`, Buffer.from("GIF89a"), { "content-type": "image/png", "x-filename": "x.png" })).status, 400);
});

test("живые обновления: операции доски, курсоры, присутствие, задачи проекта", async () => {
  const stream = await dev.events(`/api/work/boards/${board.id}/events?client=tab-dev`);
  const hello = await stream.next("hello");
  assert.equal(typeof hello.version, "number");
  const presence = await stream.next("presence");
  assert.ok(presence.members.some((x) => x.name === "Дев"));

  await pm("POST", `/api/work/boards/${board.id}/ops`, { client: "tab-pm", seq: "batch-1", ops: [{ op: "del", id: "stk00001" }] });
  const ops = await stream.next("ops");
  assert.equal(ops.client, "tab-pm");
  assert.equal(ops.seq, "batch-1", "вкладка узнаёт эхо своей пачки");
  assert.equal(ops.by, "ПМ");
  assert.deepEqual(ops.ops, [{ op: "del", id: "stk00001" }]);
  assert.equal(ops.version, hello.version + 1);

  await pm("POST", `/api/work/boards/${board.id}/cursor`, { client: "tab-pm", x: 12.5, y: -4 });
  const cursor = await stream.next("cursor");
  assert.deepEqual([cursor.name, cursor.x, cursor.y], ["ПМ", 12.5, -4]);
  stream.close();

  const issues = await pm.events(`/api/work/projects/${p1.id}/events?client=tab-pm`);
  await issues.next("presence");
  await dev("PATCH", `/api/work/issues/${task.id}`, { status: "review" }, { "x-client": "tab-dev" });
  const ev = await issues.next("issues");
  assert.deepEqual([ev.client, ev.by, ev.ids], ["tab-dev", "Дев", [task.id]]);
  issues.close();

  assert.equal((await outsider("GET", `/api/work/projects/${p1.id}/events`)).status, 404);
});

test("связи задач, WIP-лимиты, упоминания и непрочитанное", async () => {
  const blocker = (await pm("POST", `/api/work/projects/${p1.id}/issues`, { title: "API столов" })).json.issue;
  const linked = await pm("POST", `/api/work/issues/${blocker.id}/links`, { type: "blocks", issueId: task.id });
  assert.equal(linked.status, 201);
  assert.deepEqual(linked.json.issue.links.map((l) => [l.type, l.direction, l.issue.key]), [["blocks", "out", task.key]]);
  assert.equal((await pm("POST", `/api/work/issues/${blocker.id}/links`, { type: "blocks", issueId: task.id })).status, 409);
  assert.equal((await pm("POST", `/api/work/issues/${blocker.id}/links`, { type: "nope", issueId: task.id })).status, 400);
  assert.equal((await pm("POST", `/api/work/issues/${blocker.id}/links`, { type: "relates", issueId: blocker.id })).status, 400, "сама с собой не связывается");
  const target = (await dev("GET", `/api/work/issues/${task.id}`)).json.issue;
  assert.deepEqual(target.links.map((l) => [l.type, l.direction, l.issue.key, l.ownerId]), [["blocks", "in", blocker.key, blocker.id]]);
  assert.equal(target.blocked, true, "задачу блокирует незавершённая");
  await pm("PATCH", `/api/work/issues/${blocker.id}`, { status: "done" });
  assert.equal((await dev("GET", `/api/work/issues/${task.id}`)).json.issue.blocked, false);
  const linkId = target.links[0].id;
  assert.equal((await dev("DELETE", `/api/work/issues/${blocker.id}/links/${linkId}`)).status, 200);
  await pm("POST", `/api/work/issues/${blocker.id}/links`, { type: "relates", issueId: task.id });
  await pm("DELETE", `/api/work/issues/${blocker.id}`);
  assert.deepEqual((await dev("GET", `/api/work/issues/${task.id}`)).json.issue.links, [], "связи удалённой задачи исчезают");

  assert.equal((await dev("PATCH", `/api/work/projects/${p1.id}`, { wip: { progress: 3 } })).status, 403, "лимиты ставит менеджер");
  assert.equal((await pm("PATCH", `/api/work/projects/${p1.id}`, { wip: { progress: 100 } })).status, 400);
  assert.deepEqual((await pm("PATCH", `/api/work/projects/${p1.id}`, { wip: { progress: 3, review: 0 } })).json.project.wip, { progress: 3 });

  await dev("POST", "/api/work/seen");
  const other = (await pm("POST", `/api/work/projects/${p1.id}/issues`, { title: "Чужая задача" })).json.issue;
  await pm("POST", `/api/work/issues/${other.id}/comments`, { text: "@dev глянь, пожалуйста" });
  await pm("POST", `/api/work/issues/${other.id}/comments`, { text: "без упоминания" });
  const me = (await dev("GET", "/api/work/me")).json;
  assert.ok(me.feed.some((x) => x.kind === "mention" && x.issue.id === other.id), "упоминание в чужой задаче попадает в ленту");
  assert.ok(!me.feed.some((x) => x.text === "без упоминания"), "чужие задачи без упоминания — нет");
  assert.ok(me.seenAt);
  assert.equal((await dev("GET", "/api/work/unread")).json.count, 1);
  await dev("POST", "/api/work/seen");
  assert.equal((await dev("GET", "/api/work/unread")).json.count, 0);
});

test("доска: голосование точками и общий таймер", async () => {
  await pm("POST", `/api/work/boards/${board.id}/ops`, { client: "tab-pm", ops: [{ op: "put", item: { id: "vote0001", type: "sticky", x: 0, y: 0, w: 200, h: 200, text: "Идея" } }] });
  const stream = await dev.events(`/api/work/boards/${board.id}/events?client=tab-dev`);
  await stream.next("hello");
  assert.deepEqual((await dev("POST", `/api/work/boards/${board.id}/vote`, { itemId: "vote0001" })).json.votes, [devUser.id]);
  assert.deepEqual((await stream.next("ops")).ops[0].item.votes, [devUser.id]);
  await pm("POST", `/api/work/boards/${board.id}/vote`, { itemId: "vote0001" });
  // Перенос стикера со старой копией не стирает голоса.
  await dev("POST", `/api/work/boards/${board.id}/ops`, { client: "tab-dev", ops: [{ op: "put", item: { id: "vote0001", type: "sticky", x: 50, y: 0, w: 200, h: 200, text: "Идея", votes: [] } }] });
  let item = (await pm("GET", `/api/work/boards/${board.id}`)).json.items.find((it) => it.id === "vote0001");
  assert.deepEqual([item.x, item.votes.length], [50, 2]);
  await dev("POST", `/api/work/boards/${board.id}/vote`, { itemId: "vote0001" });
  item = (await pm("GET", `/api/work/boards/${board.id}`)).json.items.find((it) => it.id === "vote0001");
  assert.deepEqual(item.votes, [pmUser.id], "повторный голос снимает свой");
  assert.equal((await dev("POST", `/api/work/boards/${board.id}/vote`, { itemId: "nothing0" })).status, 404);

  const t = await pm("POST", `/api/work/boards/${board.id}/timer`, { seconds: 300 });
  assert.equal(t.json.timer.total, 300);
  const ev = await stream.next("timer");
  assert.equal(ev.timer.by, "ПМ");
  assert.ok(ev.timer.left > 290000 && ev.timer.left <= 300000);
  assert.equal((await dev("GET", `/api/work/boards/${board.id}`)).json.board.timer.total, 300);
  assert.equal((await pm("POST", `/api/work/boards/${board.id}/timer`, { seconds: 5000 })).status, 400);
  assert.equal((await pm("POST", `/api/work/boards/${board.id}/timer`, { seconds: 0 })).json.timer, null);
  stream.close();
});

test("доска сохраняется на диск и переживает перезапуск", async () => {
  handle.flush();
  const again = createApp({ dataDir, origins: [ORIGIN], secureCookie: false, log: { error() {} } });
  const srv = http.createServer(again);
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const loginRes = await fetch(`http://127.0.0.1:${srv.address().port}/api/login`, {
    method: "POST", headers: { "content-type": "application/json", "x-real-ip": "10.1.0.9" }, body: JSON.stringify({ login: "admin", password: "admin-pass-123" }),
  });
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];
  const res = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/work/boards/${board.id}`, { headers: { cookie } })).json();
  assert.ok(res.items.some((it) => it.id === "pen00001"));
  assert.ok(!res.items.some((it) => it.id === "stk00001"));
  assert.ok(res.version >= 4);
  again.close();
  srv.close();
});

test("удаление проекта убирает задачи, вики и доски", async () => {
  assert.equal((await admin("DELETE", `/api/admin/projects/${p1.id}`)).status, 200);
  assert.equal((await pm("GET", `/api/work/issues/${task.id}`)).status, 404);
  assert.equal((await pm("GET", `/api/work/boards/${board.id}`)).status, 404);
  const db = JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8"));
  assert.equal(db.issues.length, 0);
  assert.equal(db.pages.length, 0);
  assert.equal(db.sprints.length, 0);
  assert.deepEqual(db.boards.map((b) => b.title), ["Общая"]);
  assert.ok(!fs.existsSync(path.join(dataDir, "files", `board-${board.id}`)));
});
