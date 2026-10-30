"use strict";
/* Рабочее пространство команды InData — то, что обычно живёт в Jira и Confluence:
   задачи с типами, статусами, приоритетами и исполнителями, канбан-доска, бэклог со спринтами, эпики и роадмап,
   учёт времени, вики проекта, поиск и лента «что изменилось в моих задачах».
   Клиенты сюда не попадают: админ видит всё, менеджер и разработчик — проекты из своих projectIds.
   Доски для схем (как Miro) — в whiteboard.js. */

const TYPES = ["task", "bug", "story", "epic"];
const STATUSES = ["todo", "progress", "review", "test", "done"];
const PRIORITIES = ["urgent", "high", "medium", "low"];
const HISTORY_MAX = 300;
const VERSIONS_MAX = 30;
const FILE_LIMIT = 25 * 1024 * 1024;
const IMAGE_LIMIT = 10 * 1024 * 1024;
const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
// Изменения этих полей пишутся в историю задачи.
const TRACKED = ["title", "type", "status", "priority", "assigneeId", "sprintId", "epicId", "estimate", "due", "start", "labels", "description"];
const DAY = 24 * 60 * 60 * 1000;
const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "j", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

// Ключ проекта для номеров задач: «Доработки 2: онлайн-покер» → D2OP, «Сайт» → SAJ.
function keyFromTitle(title) {
  const latin = [...String(title).toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join("");
  const words = latin.split(/[^a-z0-9]+/).filter(Boolean);
  let key = words.map((w) => (/^\d+$/.test(w) ? w : w[0])).join("").toUpperCase().replace(/^\d+/, "");
  if (key.length < 2) key = (words.find((w) => /^[a-z]/.test(w)) || "prj").slice(0, 3).toUpperCase();
  return key.slice(0, 6);
}

function registerWork(ctx) {
  const { route, db, store, now, fail, v, isAdmin, isTeam, canWork, canSee, hub, sessions, readUpload, fileResponse, imageType } = ctx;
  const { str, required, dateOf, idOf, list } = v;
  const iso = () => new Date(now()).toISOString();
  const nameOf = (id) => db.users.find((u) => u.id === id)?.name || "";
  const canManage = (u) => isAdmin(u) || u.role === "manager";

  /* ---------- Проекты как пространства ---------- */
  function ensureKey(p) {
    if (p.key) return;
    const base = keyFromTitle(p.title);
    let key = base;
    for (let n = 2; db.projects.some((x) => x !== p && x.key === key); n++) key = `${base.slice(0, 8)}${n}`;
    p.key = key;
    p.issueSeq = p.issueSeq || 0;
    store.save();
  }
  function findSpace(user, id) {
    const p = db.projects.find((x) => x.id === id);
    if (!p || !canWork(user, p)) fail(404, "not_found");
    ensureKey(p);
    return p;
  }
  const spaces = (user) => db.projects.filter((p) => canWork(user, p)).map((p) => (ensureKey(p), p));
  const issuesOf = (pid) => db.issues.filter((i) => i.projectId === pid);
  const activeSprint = (pid) => db.sprints.find((s) => s.projectId === pid && s.state === "active") || null;
  const teamUser = (u) => ({ id: u.id, name: u.name, login: u.login, role: u.role, disabled: Boolean(u.disabled) });
  // Все люди команды (чтобы показать имя даже бывшего исполнителя) и те, кому можно назначать задачи проекта.
  const team = () => db.users.filter(isTeam).map(teamUser);
  const membersOf = (p) => db.users.filter((u) => isTeam(u) && !u.disabled && canWork(u, p)).map((u) => u.id);

  function spaceSummary(p, user) {
    const list = issuesOf(p.id).filter((i) => i.type !== "epic");
    const sprint = activeSprint(p.id);
    return {
      id: p.id, title: p.title, key: p.key, folder: p.folder || "", logo: p.logo?.id || "",
      open: list.filter((i) => i.status !== "done").length,
      mine: list.filter((i) => i.status !== "done" && i.assigneeId === user.id).length,
      sprint: sprint ? { id: sprint.id, name: sprint.name, end: sprint.end } : null,
      members: membersOf(p).length,
      updatedAt: list.reduce((max, i) => (i.updatedAt > max ? i.updatedAt : max), ""),
    };
  }
  const spaceView = (p, user) => ({
    id: p.id, title: p.title, key: p.key, folder: p.folder || "", logo: p.logo?.id || "", summary: p.summary || "",
    canManage: canManage(user), clientView: canSee(user, p),
  });

  /* ---------- Задачи ---------- */
  const keyOf = (p, i) => `${p.key}-${i.number}`;
  const hours = (n) => Math.round(n * 100) / 100;
  const spentOf = (i) => hours(i.worklogs.reduce((n, w) => n + w.hours, 0));
  const summary = (i, p) => ({
    id: i.id, key: keyOf(p, i), number: i.number, projectId: i.projectId, type: i.type, title: i.title, status: i.status,
    priority: i.priority, assigneeId: i.assigneeId, reporterId: i.reporterId, labels: i.labels, estimate: i.estimate,
    spent: spentOf(i), due: i.due, start: i.start, epicId: i.epicId, sprintId: i.sprintId, rank: i.rank,
    checks: { done: i.checklist.filter((c) => c.done).length, total: i.checklist.length },
    comments: i.comments.length, files: i.files.length, createdAt: i.createdAt, updatedAt: i.updatedAt, doneAt: i.doneAt,
  });
  const full = (i, p) => ({
    ...summary(i, p),
    description: i.description,
    checklist: i.checklist,
    comments: i.comments,
    worklogs: [...i.worklogs].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at)),
    files: i.files,
    history: [...i.history].reverse(),
    project: { id: p.id, key: p.key, title: p.title },
  });
  function findIssue(user, id) {
    const i = db.issues.find((x) => x.id === id);
    const p = i && db.projects.find((x) => x.id === i.projectId);
    if (!p || !canWork(user, p)) fail(404, "not_found");
    ensureKey(p);
    return { i, p };
  }
  // Остальные вкладки и доски проекта узнают об изменении сразу; свою вкладку (client) не дёргаем.
  const changed = (p, client, user, ids) => hub.publish(`project:${p.id}`, "issues", { client, by: user.name, ids });

  function fieldsOf(body, p, i) {
    const out = {};
    if ("title" in body) out.title = required(str(body.title, 300), "title");
    if ("type" in body) out.type = TYPES.includes(body.type) ? body.type : fail(400, "type");
    if ("status" in body) out.status = STATUSES.includes(body.status) ? body.status : fail(400, "status");
    if ("priority" in body) out.priority = PRIORITIES.includes(body.priority) ? body.priority : fail(400, "priority");
    if ("description" in body) out.description = typeof body.description === "string" ? body.description.slice(0, 50000) : fail(400, "description");
    if ("assigneeId" in body) out.assigneeId = assigneeOf(body.assigneeId, p);
    if ("labels" in body) out.labels = labelsOf(body.labels);
    if ("estimate" in body) out.estimate = hoursOf(body.estimate, { nullable: true, max: 10000 });
    if ("due" in body) out.due = dateOf(body.due);
    if ("start" in body) out.start = dateOf(body.start);
    if ("epicId" in body) out.epicId = epicOf(body.epicId, p, i);
    if ("sprintId" in body) out.sprintId = sprintOf(body.sprintId, p);
    if ("checklist" in body) {
      out.checklist = list(body.checklist, 100).map((c) => ({ id: idOf(c.id), text: required(str(c.text, 300), "check"), done: Boolean(c.done) }));
    }
    return out;
  }
  function assigneeOf(id, p) {
    if (id === "" || id === null) return "";
    const u = db.users.find((x) => x.id === id);
    if (!u || !isTeam(u) || u.disabled || !canWork(u, p)) fail(400, "assignee");
    return id;
  }
  function labelsOf(value) {
    if (!Array.isArray(value) || value.length > 10) fail(400, "labels");
    return [...new Set(value.map((l) => str(l, 40)).filter(Boolean))];
  }
  function hoursOf(value, { nullable = false, min = 0, max = 24 } = {}) {
    if (nullable && (value === null || value === "")) return null;
    const n = Number(value);
    if (value === null || value === "" || !Number.isFinite(n) || n < min || n > max) fail(400, "hours");
    return Math.round(n * 4) / 4; // с точностью до 15 минут
  }
  function epicOf(id, p, i) {
    if (!id) return "";
    const e = db.issues.find((x) => x.id === id && x.projectId === p.id && x.type === "epic");
    if (!e || (i && e.id === i.id)) fail(400, "epic");
    return id;
  }
  function sprintOf(id, p) {
    if (!id) return "";
    if (!db.sprints.some((s) => s.id === id && s.projectId === p.id && s.state !== "closed")) fail(400, "sprint");
    return id;
  }

  // Порядок задач — дробный ранг: перетащенная задача встаёт между соседями, остальные не трогаем.
  function place(i, p, target) {
    const refId = typeof target.before === "string" ? target.before : typeof target.after === "string" ? target.after : "";
    const ordered = issuesOf(p.id).filter((x) => x !== i).sort((a, b) => a.rank - b.rank);
    const k = ordered.findIndex((x) => x.id === refId);
    if (k < 0) fail(400, "place");
    const [lo, hi] = target.before === refId ? [ordered[k - 1]?.rank, ordered[k].rank] : [ordered[k].rank, ordered[k + 1]?.rank];
    if (lo !== undefined && hi !== undefined && hi - lo < 1e-6) {
      ordered.forEach((x, n) => { x.rank = (n + 1) * 1000; }); // ранги слиплись: перенумеровываем по порядку
      return place(i, p, target);
    }
    i.rank = lo === undefined ? hi - 1000 : hi === undefined ? lo + 1000 : (lo + hi) / 2;
  }

  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  // Несколько правок одного поля подряд (тот же человек, пара минут) — одна запись в истории.
  function track(i, user, field, from, to) {
    const last = i.history[i.history.length - 1];
    if (last && last.by === user.id && last.field === field && now() - Date.parse(last.at) < 2 * 60 * 1000) {
      if (field !== "description") last.to = to;
      last.at = iso();
      if (field !== "description" && same(last.from, last.to)) i.history.pop();
      return;
    }
    i.history.push({ at: iso(), by: user.id, field, ...(field === "description" ? {} : { from, to }) });
    if (i.history.length > HISTORY_MAX) i.history.splice(0, i.history.length - HISTORY_MAX);
  }

  function update(i, p, user, f) {
    const type = f.type ?? i.type;
    if (type === "epic") f.epicId = ""; // эпик не вкладывается в другой эпик
    if (i.type === "epic" && type !== "epic") for (const x of issuesOf(p.id)) if (x.epicId === i.id) x.epicId = "";
    for (const field of TRACKED) if (field in f && !same(i[field], f[field])) track(i, user, field, i[field], f[field]);
    if ("status" in f && f.status !== i.status) i.doneAt = f.status === "done" ? iso() : "";
    Object.assign(i, f);
    i.updatedAt = iso();
  }

  route("GET", "/api/work/projects", async ({ user }) => ({
    body: {
      projects: spaces(user)
        .sort((a, b) => (a.folder || "").localeCompare(b.folder || "", "ru") || a.title.localeCompare(b.title, "ru"))
        .map((p) => spaceSummary(p, user)),
      team: team(),
    },
  }), "team");

  // Всё, что нужно доске, бэклогу, списку, роадмапу и отчётам, одним запросом.
  route("GET", "/api/work/projects/:id", async ({ user, params }) => {
    const p = findSpace(user, params.id);
    return {
      body: {
        project: spaceView(p, user),
        issues: issuesOf(p.id).sort((a, b) => a.rank - b.rank).map((i) => summary(i, p)),
        sprints: db.sprints.filter((s) => s.projectId === p.id),
        team: team(),
        members: membersOf(p),
      },
    };
  }, "team");

  route("PATCH", "/api/work/projects/:id", async ({ user, params, body }) => {
    const p = findSpace(user, params.id);
    if (!canManage(user)) fail(403, "forbidden");
    if ("key" in body) {
      const key = str(body.key, 10).toUpperCase();
      if (!KEY_RE.test(key)) fail(400, "key");
      if (db.projects.some((x) => x !== p && x.key === key)) fail(409, "key_taken");
      p.key = key;
    }
    store.save();
    return { body: { project: spaceView(p, user) } };
  }, "team");

  route("GET", "/api/work/projects/:id/events", async ({ user, params, query, token }) => {
    const p = findSpace(user, params.id);
    const client = str(query.get("client"), 40);
    return {
      sse: (req, res) => hub.open(`project:${p.id}`, req, res, { client, userId: user.id, name: user.name }, {
        alive: () => sessions.user(token)?.id === user.id && canWork(user, p),
      }),
    };
  }, "team");

  route("POST", "/api/work/projects/:id/issues", async ({ user, params, body, client }) => {
    const p = findSpace(user, params.id);
    const f = fieldsOf({ type: "task", status: "todo", priority: "medium", ...body }, p, null);
    if (!f.title) fail(400, "required:title");
    if (f.type === "epic") f.epicId = "";
    const at = iso();
    const i = {
      id: store.id(), projectId: p.id, number: (p.issueSeq = (p.issueSeq || 0) + 1),
      description: "", assigneeId: "", reporterId: user.id, labels: [], estimate: null, due: "", start: "", epicId: "", sprintId: "",
      rank: Math.max(0, ...issuesOf(p.id).map((x) => x.rank)) + 1000,
      checklist: [], comments: [], worklogs: [], files: [], history: [],
      createdAt: at, updatedAt: at, doneAt: "",
      ...f,
    };
    if (i.status === "done") i.doneAt = at;
    db.issues.push(i);
    if (body.place && typeof body.place === "object") place(i, p, body.place);
    store.save();
    changed(p, client, user, [i.id]);
    return { status: 201, body: { issue: full(i, p) } };
  }, "team");

  route("GET", "/api/work/issues/:id", async ({ user, params }) => {
    const { i, p } = findIssue(user, params.id);
    return { body: { issue: full(i, p) } };
  }, "team");

  // Ссылка вида /work/i/D2OP-12, как /browse/KEY-12 в Jira.
  route("GET", "/api/work/issue-by-key/:key", async ({ user, params }) => {
    const m = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/.exec(params.key);
    if (!m) fail(404, "not_found");
    const p = spaces(user).find((x) => x.key === m[1].toUpperCase());
    const i = p && db.issues.find((x) => x.projectId === p.id && x.number === Number(m[2]));
    if (!i) fail(404, "not_found");
    return { body: { issue: full(i, p) } };
  }, "team");

  route("PATCH", "/api/work/issues/:id", async ({ user, params, body, client }) => {
    const { i, p } = findIssue(user, params.id);
    update(i, p, user, fieldsOf(body, p, i));
    if (body.place && typeof body.place === "object") place(i, p, body.place);
    store.save();
    changed(p, client, user, [i.id]);
    return { body: { issue: full(i, p) } };
  }, "team");

  // Удаляют админ, менеджер или автор задачи.
  route("DELETE", "/api/work/issues/:id", async ({ user, params, client }) => {
    const { i, p } = findIssue(user, params.id);
    if (!canManage(user) && i.reporterId !== user.id) fail(403, "forbidden");
    for (const f of i.files) store.deleteFile(f.id);
    for (const x of issuesOf(p.id)) if (x.epicId === i.id) x.epicId = "";
    db.issues.splice(db.issues.indexOf(i), 1);
    store.save();
    changed(p, client, user, [i.id]);
    return { body: { ok: true } };
  }, "team");

  /* Комментарии */
  route("POST", "/api/work/issues/:id/comments", async ({ user, params, body, client }) => {
    const { i, p } = findIssue(user, params.id);
    const at = iso();
    i.comments.push({ id: store.id(), authorId: user.id, text: required(str(body.text, 5000), "comment"), at, editedAt: "" });
    i.updatedAt = at;
    store.save();
    changed(p, client, user, [i.id]);
    return { status: 201, body: { issue: full(i, p) } };
  }, "team");

  route("PATCH", "/api/work/issues/:id/comments/:commentId", async ({ user, params, body, client }) => {
    const { i, p } = findIssue(user, params.id);
    const c = i.comments.find((x) => x.id === params.commentId) || fail(404, "not_found");
    if (c.authorId !== user.id) fail(403, "forbidden");
    c.text = required(str(body.text, 5000), "comment");
    c.editedAt = iso();
    store.save();
    changed(p, client, user, [i.id]);
    return { body: { issue: full(i, p) } };
  }, "team");

  route("DELETE", "/api/work/issues/:id/comments/:commentId", async ({ user, params, client }) => {
    const { i, p } = findIssue(user, params.id);
    const c = i.comments.find((x) => x.id === params.commentId) || fail(404, "not_found");
    if (c.authorId !== user.id && !isAdmin(user)) fail(403, "forbidden");
    i.comments = i.comments.filter((x) => x !== c);
    store.save();
    changed(p, client, user, [i.id]);
    return { body: { issue: full(i, p) } };
  }, "team");

  /* Учёт времени */
  route("POST", "/api/work/issues/:id/worklogs", async ({ user, params, body, client }) => {
    const { i, p } = findIssue(user, params.id);
    i.worklogs.push({
      id: store.id(), userId: user.id, hours: hoursOf(body.hours, { min: 0.25 }), date: dateOf(body.date) || iso().slice(0, 10),
      note: str(body.note, 300), at: iso(),
    });
    i.updatedAt = iso();
    store.save();
    changed(p, client, user, [i.id]);
    return { status: 201, body: { issue: full(i, p) } };
  }, "team");

  route("DELETE", "/api/work/issues/:id/worklogs/:logId", async ({ user, params, client }) => {
    const { i, p } = findIssue(user, params.id);
    const w = i.worklogs.find((x) => x.id === params.logId) || fail(404, "not_found");
    if (w.userId !== user.id && !isAdmin(user)) fail(403, "forbidden");
    i.worklogs = i.worklogs.filter((x) => x !== w);
    store.save();
    changed(p, client, user, [i.id]);
    return { body: { issue: full(i, p) } };
  }, "team");

  route("GET", "/api/work/projects/:id/worklogs", async ({ user, params }) => {
    const p = findSpace(user, params.id);
    const logs = [];
    for (const i of issuesOf(p.id)) {
      for (const w of i.worklogs) logs.push({ ...w, issueId: i.id, key: keyOf(p, i), title: i.title, epicId: i.epicId });
    }
    return { body: { worklogs: logs.sort((a, b) => b.date.localeCompare(a.date)) } };
  }, "team");

  /* Вложения */
  route("POST", "/api/work/issues/:id/files", async ({ user, params, req, client }) => {
    const { i, p } = findIssue(user, params.id);
    if (i.files.length >= 50) fail(400, "files_limit");
    const { name, data, type } = await readUpload(req, FILE_LIMIT);
    const meta = { id: store.id(), name, size: data.length, type, by: user.id, uploadedAt: iso() };
    store.writeFile(meta.id, data);
    i.files.push(meta);
    i.updatedAt = iso();
    store.save();
    changed(p, client, user, [i.id]);
    return { status: 201, body: { issue: full(i, p), file: meta } };
  }, "team", { rawBody: true });

  route("GET", "/api/work/issues/:id/files/:fileId", async ({ user, params }) => {
    const { i } = findIssue(user, params.id);
    const meta = i.files.find((f) => f.id === params.fileId);
    const data = meta && store.readFile(meta.id);
    if (!data) fail(404, "not_found");
    return fileResponse(meta, data);
  }, "team");

  route("DELETE", "/api/work/issues/:id/files/:fileId", async ({ user, params, client }) => {
    const { i, p } = findIssue(user, params.id);
    const meta = i.files.find((f) => f.id === params.fileId) || fail(404, "not_found");
    if (meta.by !== user.id && !canManage(user)) fail(403, "forbidden");
    store.deleteFile(meta.id);
    i.files = i.files.filter((f) => f !== meta);
    store.save();
    changed(p, client, user, [i.id]);
    return { body: { issue: full(i, p) } };
  }, "team");

  /* ---------- Спринты ----------
     planned → active → closed. Активный спринт у проекта один; доска показывает его задачи.
     Без активного спринта доска работает как канбан: все задачи вне запланированных спринтов. */
  const findSprint = (user, id) => {
    const s = db.sprints.find((x) => x.id === id) || fail(404, "not_found");
    return { s, p: findSpace(user, s.projectId) };
  };
  const sprintFields = (body) => ({
    ...("name" in body ? { name: required(str(body.name, 80), "name") } : {}),
    ...("goal" in body ? { goal: str(body.goal, 500) } : {}),
    ...("start" in body ? { start: dateOf(body.start) } : {}),
    ...("end" in body ? { end: dateOf(body.end) } : {}),
  });

  route("POST", "/api/work/projects/:id/sprints", async ({ user, params, body, client }) => {
    const p = findSpace(user, params.id);
    const n = db.sprints.filter((s) => s.projectId === p.id).length + 1;
    const s = { id: store.id(), projectId: p.id, name: `${p.key} Спринт ${n}`, goal: "", start: "", end: "", state: "planned", createdAt: iso(), ...sprintFields(body) };
    db.sprints.push(s);
    store.save();
    changed(p, client, user, []);
    return { status: 201, body: { sprint: s } };
  }, "team");

  route("PATCH", "/api/work/sprints/:id", async ({ user, params, body, client }) => {
    const { s, p } = findSprint(user, params.id);
    Object.assign(s, sprintFields(body));
    store.save();
    changed(p, client, user, []);
    return { body: { sprint: s } };
  }, "team");

  route("POST", "/api/work/sprints/:id/start", async ({ user, params, body, client }) => {
    const { s, p } = findSprint(user, params.id);
    if (s.state !== "planned") fail(400, "sprint_state");
    if (activeSprint(p.id)) fail(409, "sprint_active");
    Object.assign(s, sprintFields(body), { state: "active", startedAt: iso() });
    if (!s.start) s.start = iso().slice(0, 10);
    if (!s.end) s.end = new Date(Date.parse(s.start) + 14 * DAY).toISOString().slice(0, 10);
    if (s.end < s.start) fail(400, "date");
    store.save();
    changed(p, client, user, []);
    return { body: { sprint: s } };
  }, "team");

  // Незавершённые задачи уходят в бэклог или в другой запланированный спринт; итоги остаются для отчёта по скорости.
  route("POST", "/api/work/sprints/:id/complete", async ({ user, params, body, client }) => {
    const { s, p } = findSprint(user, params.id);
    if (s.state !== "active") fail(400, "sprint_state");
    const moveTo = body.moveTo ? sprintOf(body.moveTo, p) : "";
    if (moveTo === s.id) fail(400, "sprint");
    const list = issuesOf(p.id).filter((i) => i.sprintId === s.id);
    const done = list.filter((i) => i.status === "done");
    const est = (arr) => hours(arr.reduce((n, i) => n + (i.estimate || 0), 0));
    s.stats = { total: list.length, done: done.length, estimate: est(list), doneEstimate: est(done) };
    for (const i of list) if (i.status !== "done") update(i, p, user, { sprintId: moveTo });
    Object.assign(s, { state: "closed", closedAt: iso() });
    store.save();
    changed(p, client, user, list.map((i) => i.id));
    return { body: { sprint: s } };
  }, "team");

  route("DELETE", "/api/work/sprints/:id", async ({ user, params, client }) => {
    const { s, p } = findSprint(user, params.id);
    if (s.state === "closed") fail(400, "sprint_state");
    const list = issuesOf(p.id).filter((i) => i.sprintId === s.id);
    for (const i of list) update(i, p, user, { sprintId: "" });
    db.sprints.splice(db.sprints.indexOf(s), 1);
    store.save();
    changed(p, client, user, list.map((i) => i.id));
    return { body: { ok: true } };
  }, "team");

  /* ---------- Вики ----------
     Страницы деревом, текст в Markdown. Перед правкой прежний текст уходит в версии. Если страницу успел
     сохранить кто-то другой, сервер отвечает 409, чтобы не затереть чужие правки. */
  const pageMeta = (pg) => ({
    id: pg.id, projectId: pg.projectId, parentId: pg.parentId, title: pg.title, order: pg.order,
    createdBy: pg.createdBy, updatedAt: pg.updatedAt, updatedBy: nameOf(pg.updatedBy),
  });
  const pagesOf = (pid) => db.pages.filter((pg) => pg.projectId === pid);
  function findPage(user, id) {
    const pg = db.pages.find((x) => x.id === id);
    if (!pg) fail(404, "not_found");
    return { pg, p: findSpace(user, pg.projectId) };
  }
  const pageFull = (pg, p) => ({
    ...pageMeta(pg), body: pg.body, files: pg.files,
    versions: pg.versions.map((x, n) => ({ n, at: x.at, by: nameOf(x.by), title: x.title })).reverse(),
    project: { id: p.id, key: p.key, title: p.title },
  });
  function parentOf(id, p, pg = null) {
    if (!id) return "";
    let cur = db.pages.find((x) => x.id === id && x.projectId === p.id);
    if (!cur) fail(400, "parent");
    for (let guard = 0; cur; guard++) { // страницу нельзя вложить в саму себя или в свою подстраницу
      if ((pg && cur.id === pg.id) || guard > 1000) fail(400, "parent");
      cur = db.pages.find((x) => x.id === cur.parentId);
    }
    return id;
  }
  const nextOrder = (pid, parentId) => Math.max(0, ...pagesOf(pid).filter((x) => x.parentId === parentId).map((x) => x.order)) + 1;

  route("GET", "/api/work/projects/:id/pages", async ({ user, params }) => {
    const p = findSpace(user, params.id);
    return { body: { pages: pagesOf(p.id).map(pageMeta) } };
  }, "team");

  route("POST", "/api/work/projects/:id/pages", async ({ user, params, body }) => {
    const p = findSpace(user, params.id);
    const parentId = parentOf(body.parentId, p);
    const at = iso();
    const pg = {
      id: store.id(), projectId: p.id, parentId, order: nextOrder(p.id, parentId),
      title: required(str(body.title, 200), "title"), body: typeof body.body === "string" ? body.body.slice(0, 200000) : "",
      createdAt: at, createdBy: user.id, updatedAt: at, updatedBy: user.id, versions: [], files: [],
    };
    db.pages.push(pg);
    store.save();
    return { status: 201, body: { page: pageFull(pg, p) } };
  }, "team");

  route("GET", "/api/work/pages/:id", async ({ user, params }) => {
    const { pg, p } = findPage(user, params.id);
    return { body: { page: pageFull(pg, p) } };
  }, "team");

  route("GET", "/api/work/pages/:id/versions/:n", async ({ user, params }) => {
    const { pg } = findPage(user, params.id);
    const ver = pg.versions[Number(params.n)] || fail(404, "not_found");
    return { body: { version: { ...ver, by: nameOf(ver.by) } } };
  }, "team");

  route("PATCH", "/api/work/pages/:id", async ({ user, params, body }) => {
    const { pg, p } = findPage(user, params.id);
    const editsText = "title" in body || "body" in body;
    if (editsText && body.base && body.base !== pg.updatedAt) fail(409, "conflict");
    const title = "title" in body ? required(str(body.title, 200), "title") : pg.title;
    const text = "body" in body ? (typeof body.body === "string" ? body.body.slice(0, 200000) : fail(400, "body")) : pg.body;
    if ("parentId" in body) {
      const parentId = parentOf(body.parentId, p, pg);
      if (parentId !== pg.parentId) Object.assign(pg, { parentId, order: nextOrder(p.id, parentId) });
    }
    if ("order" in body && Number.isFinite(Number(body.order))) pg.order = Number(body.order);
    if (title !== pg.title || text !== pg.body) {
      pg.versions.push({ at: pg.updatedAt, by: pg.updatedBy, title: pg.title, body: pg.body });
      if (pg.versions.length > VERSIONS_MAX) pg.versions.splice(0, pg.versions.length - VERSIONS_MAX);
      Object.assign(pg, { title, body: text, updatedAt: iso(), updatedBy: user.id });
    }
    store.save();
    return { body: { page: pageFull(pg, p) } };
  }, "team");

  // Подстраницы удалённой страницы поднимаются на её место.
  route("DELETE", "/api/work/pages/:id", async ({ user, params }) => {
    const { pg } = findPage(user, params.id);
    if (!canManage(user) && pg.createdBy !== user.id) fail(403, "forbidden");
    for (const x of db.pages) if (x.parentId === pg.id) x.parentId = pg.parentId;
    for (const f of pg.files) store.deleteFile(f.id);
    db.pages.splice(db.pages.indexOf(pg), 1);
    store.save();
    return { body: { ok: true } };
  }, "team");

  // Картинки, вставленные в текст страницы.
  route("POST", "/api/work/pages/:id/files", async ({ user, params, req }) => {
    const { pg } = findPage(user, params.id);
    const { name, data, type } = await readUpload(req, IMAGE_LIMIT);
    if (!imageType(type, data)) fail(400, "image_type");
    const meta = { id: store.id(), name, size: data.length, type, by: user.id, uploadedAt: iso() };
    store.writeFile(meta.id, data);
    pg.files.push(meta);
    store.save();
    return { status: 201, body: { file: meta } };
  }, "team", { rawBody: true });

  route("GET", "/api/work/pages/:id/files/:fileId", async ({ user, params }) => {
    const { pg } = findPage(user, params.id);
    const meta = pg.files.find((f) => f.id === params.fileId);
    const data = meta && store.readFile(meta.id);
    if (!data) fail(404, "not_found");
    return fileResponse(meta, data, "private, max-age=31536000, immutable");
  }, "team");

  /* ---------- Моя работа ---------- */
  route("GET", "/api/work/me", async ({ user }) => {
    const mine = spaces(user);
    const byId = new Map(mine.map((p) => [p.id, p]));
    const all = db.issues.filter((i) => byId.has(i.projectId));
    const since = now() - 14 * DAY;
    const recentDone = (i) => i.status !== "done" || Date.parse(i.doneAt || i.updatedAt) > now() - 7 * DAY;
    const brief = (i) => ({ ...summary(i, byId.get(i.projectId)), projectTitle: byId.get(i.projectId).title });

    // Что другие сделали с моими задачами (где я исполнитель или автор) за две недели.
    const feed = [];
    for (const i of all.filter((x) => x.assigneeId === user.id || x.reporterId === user.id)) {
      const issue = { id: i.id, key: keyOf(byId.get(i.projectId), i), title: i.title, type: i.type };
      for (const h of i.history) if (h.by !== user.id && Date.parse(h.at) > since) feed.push({ kind: "change", at: h.at, by: nameOf(h.by), field: h.field, from: h.from, to: h.to, issue });
      for (const c of i.comments) if (c.authorId !== user.id && Date.parse(c.at) > since) feed.push({ kind: "comment", at: c.at, by: nameOf(c.authorId), text: c.text.slice(0, 280), issue });
      if (i.reporterId !== user.id && i.assigneeId === user.id && Date.parse(i.createdAt) > since && !i.history.some((h) => h.field === "assigneeId")) {
        feed.push({ kind: "created", at: i.createdAt, by: nameOf(i.reporterId), issue });
      }
    }
    const worklogs = [];
    for (const i of all) {
      for (const w of i.worklogs) if (w.userId === user.id && Date.parse(w.date) > since) worklogs.push({ ...w, key: keyOf(byId.get(i.projectId), i), title: i.title, issueId: i.id });
    }
    const recent = [
      ...db.pages.filter((pg) => byId.has(pg.projectId)).map((pg) => ({ kind: "page", id: pg.id, title: pg.title, projectId: pg.projectId, at: pg.updatedAt, by: nameOf(pg.updatedBy) })),
      ...db.boards.filter((b) => (b.projectId ? byId.has(b.projectId) : true)).map((b) => ({ kind: "board", id: b.id, title: b.title, projectId: b.projectId, at: b.updatedAt, by: nameOf(b.updatedBy) })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
    return {
      body: {
        projects: mine.sort((a, b) => a.title.localeCompare(b.title, "ru")).map((p) => spaceSummary(p, user)),
        assigned: all.filter((i) => i.assigneeId === user.id && i.type !== "epic" && recentDone(i)).map(brief),
        reported: all.filter((i) => i.reporterId === user.id && i.assigneeId !== user.id && i.status !== "done" && i.type !== "epic").map(brief),
        feed: feed.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40),
        worklogs,
        recent,
        team: team(),
      },
    };
  }, "team");

  /* ---------- Поиск: задачи по ключу и названию, страницы вики, доски ---------- */
  route("GET", "/api/work/search", async ({ user, query }) => {
    const q = str(query.get("q"), 100).toLowerCase();
    if (!q) return { body: { issues: [], pages: [], boards: [] } };
    const byId = new Map(spaces(user).map((p) => [p.id, p]));
    const issues = db.issues
      .filter((i) => byId.has(i.projectId))
      .map((i) => ({ i, key: keyOf(byId.get(i.projectId), i).toLowerCase() }))
      .filter(({ i, key }) => key === q || key.startsWith(q) || i.title.toLowerCase().includes(q))
      .sort((a, b) => (b.key === q) - (a.key === q) || b.i.updatedAt.localeCompare(a.i.updatedAt))
      .slice(0, 10)
      .map(({ i }) => ({ ...summary(i, byId.get(i.projectId)), projectTitle: byId.get(i.projectId).title }));
    const pages = db.pages
      .filter((pg) => byId.has(pg.projectId) && (pg.title.toLowerCase().includes(q) || pg.body.toLowerCase().includes(q)))
      .slice(0, 6)
      .map((pg) => {
        const at = pg.body.toLowerCase().indexOf(q);
        return { id: pg.id, title: pg.title, projectId: pg.projectId, projectTitle: byId.get(pg.projectId).title, snippet: at < 0 ? "" : pg.body.slice(Math.max(0, at - 40), at + 80).replace(/\s+/g, " ") };
      });
    const boards = db.boards
      .filter((b) => (b.projectId ? byId.has(b.projectId) : true) && b.title.toLowerCase().includes(q))
      .slice(0, 6)
      .map((b) => ({ id: b.id, title: b.title, projectId: b.projectId, projectTitle: b.projectId ? byId.get(b.projectId).title : "" }));
    return { body: { issues, pages, boards } };
  }, "team");

  // Проект удалён: его задачи, спринты и вики уходят вместе с ним.
  function removeProject(pid) {
    for (const i of issuesOf(pid)) for (const f of i.files) store.deleteFile(f.id);
    for (const pg of pagesOf(pid)) for (const f of pg.files) store.deleteFile(f.id);
    db.issues = db.issues.filter((i) => i.projectId !== pid);
    db.sprints = db.sprints.filter((s) => s.projectId !== pid);
    db.pages = db.pages.filter((pg) => pg.projectId !== pid);
  }

  return { removeProject, findSpace, findIssue, summary, ensureKey };
}

module.exports = { registerWork, keyFromTitle };
