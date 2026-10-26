"use strict";
/* Кабинет клиента InData (app.indata.group): API и раздача интерфейса.
   Клиент видит свои проекты: этапы, задачи для него, созвоны с договорённостями, ленту обновлений,
   оплаты и документы.
   Администратор заводит клиентов и проекты и ведёт их. */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createStore } = require("./store.js");
const { hashPassword, checkPassword, generatePassword, createSessions, createLimiter } = require("./auth.js");

const JSON_LIMIT = 256 * 1024;
const FILE_LIMIT = 25 * 1024 * 1024;
const STATUSES = ["todo", "active", "done"];
// Блоки проекта, которые можно скрыть от менеджера. Оплаты и суммы менеджер не видит никогда.
const BLOCKS = ["tasks", "meetings", "updates", "files"];
const DEFAULT_STAGES = ["Аналитика", "Дизайн", "Разработка", "Тестирование", "Запуск"];
// Эти типы браузер может показать сам; остальное отдаём как поток байт, чтобы загруженный
// HTML или SVG не исполнился на нашем домене.
const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);
const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
    + "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code) => { throw new HttpError(status, code); };

function createApp({ dataDir = null, publicDir = path.join(__dirname, "public"), siteDir = null,
  bookingsFile = null, origins = [], secureCookie = true, now = Date.now, log = console } = {}) {
  const store = createStore(dataDir);
  const { db } = store;
  const sessions = createSessions(store, now);
  const limiter = createLimiter({ now });
  const routes = [];
  const route = (method, pattern, handler, access = "user", { rawBody = false } = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; })}$`);
    routes.push({ method, re, keys, handler, access, rawBody });
  };

  /* ---------- Представления ---------- */
  const publicUser = (u) => ({
    id: u.id, login: u.login, name: u.name, company: u.company || "", contact: u.contact || "", role: u.role,
    disabled: Boolean(u.disabled), createdAt: u.createdAt,
    ...(u.role === "manager" ? { projectIds: u.projectIds || [], hide: u.hide || [] } : {}),
  });

  /* ---------- Права ----------
     admin   — всё.
     client  — читает проекты, где он в clientIds, отмечает свои задачи.
     manager — свои проекты (projectIds): правит этапы, задачи, созвоны, ленту и документы, кроме скрытых
               блоков (hide). Денег не видит, людьми и доступами не управляет, проекты не создаёт и не удаляет. */
  const isAdmin = (u) => u.role === "admin";
  const isManager = (u) => u.role === "manager";
  const hides = (u, block) => isManager(u) && (block === "payments" || (u.hide || []).includes(block));
  const clientNames = (p) => p.clientIds.map((id) => db.users.find((u) => u.id === id)).filter(Boolean);

  function projectView(p, user) {
    const view = {
      id: p.id, title: p.title, summary: p.summary, folder: p.folder || "", updatedAt: p.updatedAt,
      // Процент можно поставить вручную; иначе он считается по статусам этапов.
      progress: projectProgress(p), progressAuto: progress(p.stages), progressManual: Number.isInteger(p.progressOverride),
      stages: p.stages, payments: p.payments,
      updates: newestFirst(p.updates),
      meetings: newestFirst(p.meetings || []),
      tasks: tasksOrder(p.tasks || []),
      files: p.files.map(({ id, name, size, type, uploadedAt }) => ({ id, name, size, type, uploadedAt })),
    };
    if (isAdmin(user)) {
      view.clientIds = p.clientIds;
      view.clients = clientNames(p).map(publicUser);
    }
    if (isManager(user)) {
      view.clients = clientNames(p).map((u) => ({ name: u.name, company: u.company || "" }));
      for (const block of ["payments", ...BLOCKS]) if (hides(user, block)) delete view[block];
    }
    return view;
  }

  function projectSummary(p, user) {
    const { stages } = p;
    const active = stages.find((s) => s.status === "active");
    return {
      id: p.id, title: p.title, summary: p.summary, folder: p.folder || "", updatedAt: p.updatedAt,
      progress: projectProgress(p),
      ...(hides(user, "payments") ? {} : {
        total: p.payments.reduce((n, x) => n + x.amount, 0),
        paid: p.payments.filter((x) => x.paid).reduce((n, x) => n + x.amount, 0),
      }),
      ...(hides(user, "tasks") ? {} : { openTasks: (p.tasks || []).filter((t) => !t.done && t.side !== "team").length }),
      stage: active ? active.title : stages.every((s) => s.status === "done") && stages.length ? "Готово" : "",
      ...(user.role === "client" ? {} : { clients: clientNames(p).map((u) => u.name) }),
    };
  }

  const canSee = (user, p) => isAdmin(user)
    || (isManager(user) ? (user.projectIds || []).includes(p.id) : p.clientIds.includes(user.id));
  function findProject(user, id) {
    const p = db.projects.find((x) => x.id === id);
    if (!p || !canSee(user, p)) fail(404, "not_found");
    return p;
  }
  // Проект, который пользователь вправе править в части block.
  function findEditable(user, id, block) {
    const p = findProject(user, id);
    if (!isAdmin(user) && (!isManager(user) || hides(user, block))) fail(403, "forbidden");
    return p;
  }
  const touch = (p) => { p.updatedAt = new Date(now()).toISOString(); };

  /* ---------- Вход ---------- */
  route("POST", "/api/login", async ({ body, ip }) => {
    const login = str(body.login, 64).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    if (limiter.blocked(ip, login && `login:${login}`)) fail(429, "rate");
    const user = db.users.find((u) => u.login === login);
    if (!user || user.disabled || !password || !checkPassword(password, user.password)) {
      limiter.fail(ip, login && `login:${login}`);
      fail(401, "credentials");
    }
    limiter.reset(`login:${login}`);
    const { token, maxAge } = sessions.create(user.id);
    return { body: { user: publicUser(user) }, cookie: { token, maxAge } };
  }, "public");

  route("POST", "/api/logout", async ({ token }) => {
    sessions.destroy(token);
    return { body: { ok: true }, cookie: { token: "", maxAge: 0 } };
  }, "public");

  route("GET", "/api/me", async ({ user }) => ({ body: { user: user ? publicUser(user) : null } }), "optional");

  route("POST", "/api/password", async ({ user, body }) => {
    const next = typeof body.next === "string" ? body.next : "";
    if (!checkPassword(typeof body.current === "string" ? body.current : "", user.password)) fail(400, "current");
    if (next.length < 8 || next.length > 200) fail(400, "weak");
    user.password = hashPassword(next);
    // Все устройства выходят, а это получает новую сессию.
    db.sessions = db.sessions.filter((s) => s.userId !== user.id);
    return { body: { ok: true }, cookie: sessions.create(user.id) };
  });

  /* ---------- Проекты: просмотр ---------- */
  // По папкам, внутри по названию: «Доработки 1», «Доработки 2», «Сайт».
  route("GET", "/api/projects", async ({ user }) => ({
    body: {
      projects: db.projects.filter((p) => canSee(user, p))
        .sort((a, b) => (a.folder || "").localeCompare(b.folder || "", "ru") || a.title.localeCompare(b.title, "ru"))
        .map((p) => projectSummary(p, user)),
    },
  }));

  route("GET", "/api/projects/:id", async ({ user, params }) => ({
    body: { project: projectView(findProject(user, params.id), user) },
  }));

  route("GET", "/api/projects/:id/files/:fileId", async ({ user, params }) => {
    const p = findProject(user, params.id);
    if (hides(user, "files")) fail(404, "not_found");
    const meta = p.files.find((f) => f.id === params.fileId);
    const data = meta && store.readFile(meta.id);
    if (!data) fail(404, "not_found");
    const inline = INLINE_TYPES.has(meta.type);
    return {
      raw: data,
      headers: {
        "Content-Type": inline ? meta.type : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
        "Cache-Control": "private, no-store",
      },
    };
  });

  /* ---------- Админка: клиенты ---------- */
  route("GET", "/api/admin/users", async () => ({ body: { users: db.users.map(publicUser) } }), "admin");

  route("POST", "/api/admin/users", async ({ body }) => {
    const user = {
      id: store.id(),
      login: loginOf(body.login),
      name: required(str(body.name, 120), "name"),
      company: str(body.company, 120),
      contact: str(body.contact, 120),
      role: ["admin", "manager"].includes(body.role) ? body.role : "client",
      createdAt: new Date(now()).toISOString(),
    };
    if (user.role === "manager") {
      user.projectIds = projectIdsOf(body.projectIds ?? []);
      user.hide = hideOf(body.hide ?? []);
    }
    if (db.users.some((u) => u.login === user.login)) fail(409, "login_taken");
    const password = generatePassword();
    user.password = hashPassword(password);
    db.users.push(user);
    store.save();
    return { status: 201, body: { user: publicUser(user), password } };
  }, "admin");

  route("PATCH", "/api/admin/users/:id", async ({ user: me, params, body }) => {
    const user = db.users.find((u) => u.id === params.id) || fail(404, "not_found");
    if ("name" in body) user.name = required(str(body.name, 120), "name");
    if ("company" in body) user.company = str(body.company, 120);
    if ("contact" in body) user.contact = str(body.contact, 120);
    // Смена роли: себе нельзя; менеджеру сразу задаются проекты, у остальных доступ по проектам снимается.
    if ("role" in body && body.role !== user.role) {
      if (user.id === me.id) fail(400, "self");
      if (!["client", "manager", "admin"].includes(body.role)) fail(400, "role");
      user.role = body.role;
      if (user.role === "manager") {
        user.projectIds = projectIdsOf(body.projectIds ?? []);
        user.hide = hideOf(body.hide ?? []);
      } else {
        delete user.projectIds;
        delete user.hide;
      }
      if (user.role !== "client") for (const p of db.projects) p.clientIds = p.clientIds.filter((id) => id !== user.id);
    }
    if (user.role === "manager" && "projectIds" in body) user.projectIds = projectIdsOf(body.projectIds);
    if (user.role === "manager" && "hide" in body) user.hide = hideOf(body.hide);
    if ("login" in body) {
      const login = loginOf(body.login);
      if (db.users.some((u) => u.login === login && u.id !== user.id)) fail(409, "login_taken");
      user.login = login;
    }
    if ("disabled" in body) {
      if (user.id === me.id) fail(400, "self");
      user.disabled = Boolean(body.disabled);
      if (user.disabled) sessions.destroyAllFor(user.id);
    }
    store.save();
    return { body: { user: publicUser(user) } };
  }, "admin");

  route("POST", "/api/admin/users/:id/password", async ({ params }) => {
    const user = db.users.find((u) => u.id === params.id) || fail(404, "not_found");
    const password = generatePassword();
    user.password = hashPassword(password);
    sessions.destroyAllFor(user.id);
    return { body: { password } };
  }, "admin");

  route("DELETE", "/api/admin/users/:id", async ({ user: me, params }) => {
    if (params.id === me.id) fail(400, "self");
    const i = db.users.findIndex((u) => u.id === params.id);
    if (i < 0) fail(404, "not_found");
    db.users.splice(i, 1);
    for (const p of db.projects) p.clientIds = p.clientIds.filter((id) => id !== params.id);
    sessions.destroyAllFor(params.id); // сохраняет базу
    return { body: { ok: true } };
  }, "admin");

  /* ---------- Админка: заявки на звонок с indata.group ----------
     Их пишет обработчик записи (server/booking) в свой JSON-файл; кабинет только читает его,
     чтобы заявки были видны даже тогда, когда уведомление в Telegram не дошло. */
  route("GET", "/api/admin/bookings", async () => {
    if (!bookingsFile) return { body: { bookings: [], configured: false } };
    let items = [];
    try {
      items = JSON.parse(fs.readFileSync(bookingsFile, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    const bookings = items
      .filter((b) => b && Number.isFinite(b.start))
      .map((b) => ({
        start: new Date(b.start).toISOString(),
        when: b.startMsk || "",
        name: String(b.name || ""),
        email: String(b.email || ""),
        contact: String(b.contact || ""),
        notes: String(b.notes || ""),
        timezoneLabel: String(b.timezoneLabel || ""),
        createdAt: String(b.createdAt || ""),
        notified: !b.pending,
      }))
      .sort((a, b) => b.start.localeCompare(a.start));
    return { body: { bookings, configured: true } };
  }, "admin");

  /* ---------- Админка: проекты ---------- */
  route("POST", "/api/admin/projects", async ({ body }) => {
    const p = {
      id: store.id(),
      title: required(str(body.title, 160), "title"),
      summary: str(body.summary, 600),
      folder: str(body.folder, 120),
      clientIds: clientIdsOf(body.clientIds ?? []),
      stages: DEFAULT_STAGES.map((title, i) => ({ id: store.id(), title, status: i === 0 ? "active" : "todo", start: "", end: "", note: "" })),
      payments: [],
      updates: [],
      meetings: [],
      tasks: [],
      files: [],
      createdAt: new Date(now()).toISOString(),
    };
    touch(p);
    db.projects.push(p);
    store.save();
    return { status: 201, body: { project: projectView(p, { role: "admin" }) } };
  }, "admin");

  // Этапы и оплаты редактируются целиком: форма в админке отправляет весь список.
  route("PATCH", "/api/admin/projects/:id", async ({ user, params, body }) => {
    const p = findEditable(user, params.id, "project");
    if (!isAdmin(user) && ["folder", "clientIds", "payments"].some((k) => k in body)) fail(403, "forbidden");
    if ("title" in body) p.title = required(str(body.title, 160), "title");
    if ("summary" in body) p.summary = str(body.summary, 600);
    if ("folder" in body) p.folder = str(body.folder, 120);
    if ("progress" in body) {
      if (body.progress === null || body.progress === "") delete p.progressOverride;
      else {
        const n = Number(body.progress);
        if (!Number.isInteger(n) || n < 0 || n > 100) fail(400, "progress");
        p.progressOverride = n;
      }
    }
    if ("clientIds" in body) p.clientIds = clientIdsOf(body.clientIds);
    if ("stages" in body) p.stages = list(body.stages, 20).map((s) => ({
      id: idOf(s.id),
      title: required(str(s.title, 80), "stage_title"),
      status: STATUSES.includes(s.status) ? s.status : "todo",
      start: dateOf(s.start),
      end: dateOf(s.end),
      note: str(s.note, 300),
    }));
    if ("payments" in body) p.payments = list(body.payments, 30).map((x) => ({
      id: idOf(x.id),
      title: required(str(x.title, 120), "payment_title"),
      amount: amountOf(x.amount),
      due: dateOf(x.due),
      paid: Boolean(x.paid),
      paidAt: !x.paid ? "" : x.paidAt === undefined ? new Date(now()).toISOString().slice(0, 10) : dateOf(x.paidAt),
    }));
    touch(p);
    store.save();
    return { body: { project: projectView(p, user) } };
  }, "staff");

  route("DELETE", "/api/admin/projects/:id", async ({ user, params }) => {
    const p = findProject(user, params.id);
    for (const f of p.files) store.deleteFile(f.id);
    db.projects.splice(db.projects.indexOf(p), 1);
    for (const u of db.users) if (u.projectIds) u.projectIds = u.projectIds.filter((x) => x !== p.id);
    store.save();
    return { body: { ok: true } };
  }, "admin");

  route("POST", "/api/admin/projects/:id/updates", async ({ user, params, body }) => {
    const p = findEditable(user, params.id, "updates");
    const update = {
      id: store.id(),
      date: dateOf(body.date) || new Date(now()).toISOString().slice(0, 10),
      title: required(str(body.title, 160), "update_title"),
      text: str(body.text, 5000),
      links: list(body.links ?? [], 10).map((l) => ({ label: str(l.label, 80), url: urlOf(l.url) })),
    };
    p.updates.push(update);
    touch(p);
    store.save();
    return { status: 201, body: { project: projectView(p, user) } };
  }, "staff");

  route("DELETE", "/api/admin/projects/:id/updates/:updateId", async ({ user, params }) => {
    const p = findEditable(user, params.id, "updates");
    p.updates = p.updates.filter((u) => u.id !== params.updateId);
    touch(p);
    store.save();
    return { body: { project: projectView(p, user) } };
  }, "staff");

  // Созвоны: дата, тема, ссылка на запись и договорённости (по одной в строке).
  const meetingOf = (body, id) => ({
    id,
    date: dateOf(body.date) || new Date(now()).toISOString().slice(0, 10),
    title: str(body.title, 160) || "Созвон",
    recordingUrl: body.recordingUrl ? urlOf(body.recordingUrl) : "",
    agreements: str(body.agreements, 5000),
  });

  route("POST", "/api/admin/projects/:id/meetings", async ({ user, params, body }) => {
    const p = findEditable(user, params.id, "meetings");
    p.meetings = [...(p.meetings || []), meetingOf(body, store.id())];
    touch(p);
    store.save();
    return { status: 201, body: { project: projectView(p, user) } };
  }, "staff");

  route("PATCH", "/api/admin/projects/:id/meetings/:meetingId", async ({ user, params, body }) => {
    const p = findEditable(user, params.id, "meetings");
    const i = (p.meetings || []).findIndex((m) => m.id === params.meetingId);
    if (i < 0) fail(404, "not_found");
    p.meetings[i] = meetingOf(body, params.meetingId);
    touch(p);
    store.save();
    return { body: { project: projectView(p, user) } };
  }, "staff");

  route("DELETE", "/api/admin/projects/:id/meetings/:meetingId", async ({ user, params }) => {
    const p = findEditable(user, params.id, "meetings");
    p.meetings = (p.meetings || []).filter((m) => m.id !== params.meetingId);
    touch(p);
    store.save();
    return { body: { project: projectView(p, user) } };
  }, "staff");

  // Задачи: что сделать клубу (side "client") и нам (side "team"), по разделам чек-листа (group).
  // Клиент отмечает только свои пункты, наши видит. Комментировать могут все, кто видит проект.
  const taskFields = (body) => ({
    title: required(str(body.title, 200), "task_title"),
    text: str(body.text, 2000),
    due: dateOf(body.due),
    url: body.url ? urlOf(body.url) : "",
    group: str(body.group, 120),
    side: body.side === "team" ? "team" : "client",
  });
  const findTask = (p, taskId) => (p.tasks || []).find((t) => t.id === taskId) || fail(404, "not_found");

  route("POST", "/api/admin/projects/:id/tasks", async ({ user, params, body }) => {
    const p = findEditable(user, params.id, "tasks");
    p.tasks = [...(p.tasks || []), { id: store.id(), ...taskFields(body), done: false, doneAt: "", doneBy: "", comments: [], createdAt: new Date(now()).toISOString() }];
    touch(p);
    store.save();
    return { status: 201, body: { project: projectView(p, user) } };
  }, "staff");

  route("PATCH", "/api/admin/projects/:id/tasks/:taskId", async ({ user, params, body }) => {
    const p = findEditable(user, params.id, "tasks");
    const task = findTask(p, params.taskId);
    Object.assign(task, taskFields({ group: task.group, side: task.side, ...body }));
    touch(p);
    store.save();
    return { body: { project: projectView(p, user) } };
  }, "staff");

  route("DELETE", "/api/admin/projects/:id/tasks/:taskId", async ({ user, params }) => {
    const p = findEditable(user, params.id, "tasks");
    findTask(p, params.taskId);
    p.tasks = p.tasks.filter((t) => t.id !== params.taskId);
    touch(p);
    store.save();
    return { body: { project: projectView(p, user) } };
  }, "staff");

  route("POST", "/api/projects/:id/tasks/:taskId/done", async ({ user, params, body }) => {
    const p = findProject(user, params.id);
    if (hides(user, "tasks")) fail(403, "forbidden");
    const task = findTask(p, params.taskId);
    if (user.role === "client" && task.side === "team") fail(403, "forbidden");
    task.done = Boolean(body.done);
    task.doneAt = task.done ? new Date(now()).toISOString() : "";
    task.doneBy = task.done ? user.name : "";
    touch(p);
    store.save();
    return { body: { project: projectView(p, user) } };
  });

  route("POST", "/api/projects/:id/tasks/:taskId/comments", async ({ user, params, body }) => {
    const p = findProject(user, params.id);
    if (hides(user, "tasks")) fail(403, "forbidden");
    const task = findTask(p, params.taskId);
    const text = required(str(body.text, 2000), "comment");
    task.comments = [...(task.comments || []), {
      id: store.id(), text, author: user.name, authorId: user.id, role: user.role, at: new Date(now()).toISOString(),
    }];
    touch(p);
    store.save();
    return { status: 201, body: { project: projectView(p, user) } };
  });

  // Удалить комментарий может автор или админ.
  route("DELETE", "/api/projects/:id/tasks/:taskId/comments/:commentId", async ({ user, params }) => {
    const p = findProject(user, params.id);
    if (hides(user, "tasks")) fail(403, "forbidden");
    const task = findTask(p, params.taskId);
    const comment = (task.comments || []).find((c) => c.id === params.commentId) || fail(404, "not_found");
    if (!isAdmin(user) && comment.authorId !== user.id) fail(403, "forbidden");
    task.comments = task.comments.filter((c) => c !== comment);
    touch(p);
    store.save();
    return { body: { project: projectView(p, user) } };
  });

  // Файл приходит телом запроса как есть, имя — в заголовке X-Filename (encodeURIComponent).
  route("POST", "/api/admin/projects/:id/files", async ({ user, params, req }) => {
    const p = findEditable(user, params.id, "files");
    let name;
    try {
      name = decodeURIComponent(String(req.headers["x-filename"] || ""));
    } catch {
      fail(400, "filename");
    }
    name = name.replace(/[\\/\0\r\n]/g, "_").trim().slice(0, 160);
    if (!name) fail(400, "filename");
    const data = await readBody(req, FILE_LIMIT);
    if (!data.length) fail(400, "empty");
    const meta = {
      id: store.id(),
      name,
      size: data.length,
      type: String(req.headers["content-type"] || "application/octet-stream").split(";")[0].trim().slice(0, 100),
      uploadedAt: new Date(now()).toISOString(),
    };
    store.writeFile(meta.id, data);
    p.files.push(meta);
    touch(p);
    store.save();
    return { status: 201, body: { project: projectView(p, user) } };
  }, "staff", { rawBody: true });

  route("DELETE", "/api/admin/projects/:id/files/:fileId", async ({ user, params }) => {
    const p = findEditable(user, params.id, "files");
    const meta = p.files.find((f) => f.id === params.fileId) || fail(404, "not_found");
    store.deleteFile(meta.id);
    p.files = p.files.filter((f) => f !== meta);
    touch(p);
    store.save();
    return { body: { project: projectView(p, user) } };
  }, "staff");

  /* ---------- Проверка полей ---------- */
  function str(v, max) {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
  }
  function required(v, field) {
    if (!v) fail(400, `required:${field}`);
    return v;
  }
  function loginOf(v) {
    const login = str(v, 64).toLowerCase();
    if (!/^[a-z0-9][a-z0-9._@-]{2,63}$/.test(login)) fail(400, "login");
    return login;
  }
  function list(v, max) {
    if (!Array.isArray(v) || v.length > max) fail(400, "list");
    return v.map((x) => (x && typeof x === "object" ? x : fail(400, "list")));
  }
  function dateOf(v) {
    if (v === undefined || v === null || v === "") return "";
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) fail(400, "date");
    return v;
  }
  function amountOf(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e10) fail(400, "amount");
    return Math.round(n);
  }
  function urlOf(v) {
    const url = str(v, 500);
    if (!/^https?:\/\/[^\s]+$/i.test(url)) fail(400, "url");
    return url;
  }
  function idOf(v) {
    return typeof v === "string" && /^[\w-]{6,32}$/.test(v) ? v : store.id();
  }
  function projectIdsOf(v) {
    if (!Array.isArray(v)) fail(400, "projectIds");
    const ids = [...new Set(v)];
    if (!ids.every((id) => db.projects.some((p) => p.id === id))) fail(400, "projectIds");
    return ids;
  }
  function hideOf(v) {
    if (!Array.isArray(v)) fail(400, "hide");
    return [...new Set(v)].filter((b) => BLOCKS.includes(b));
  }
  function clientIdsOf(v) {
    if (!Array.isArray(v)) fail(400, "clientIds");
    const ids = [...new Set(v)];
    if (!ids.every((id) => db.users.some((u) => u.id === id && u.role === "client"))) fail(400, "clientIds");
    return ids;
  }

  /* ---------- HTTP ---------- */
  const staticCache = new Map();
  function staticFile(urlPath) {
    let bases;
    if (urlPath === "/favicon.svg" || urlPath === "/favicon.ico" || urlPath.startsWith("/fonts/")) {
      bases = [siteDir, publicDir]; // шрифты и иконку берём с сайта, чтобы не держать копии
    } else if (urlPath === "/app.css" || urlPath === "/app.js") {
      bases = [publicDir];
    } else if (!path.extname(urlPath)) {
      urlPath = "/index.html"; // маршруты интерфейса: /, /login, /p/…, /admin…
      bases = [publicDir];
    } else {
      return null;
    }
    for (const base of bases.filter(Boolean)) {
      const root = path.resolve(base);
      const file = path.resolve(root, `.${urlPath}`);
      if (!file.startsWith(root + path.sep)) continue;
      const entry = loadStatic(file);
      if (entry) return entry;
    }
    return null;
  }

  function loadStatic(file) {
    try {
      const stat = fs.statSync(file);
      const hit = staticCache.get(file);
      if (hit && hit.mtime === stat.mtimeMs) return hit;
      const data = fs.readFileSync(file);
      const entry = {
        data,
        mtime: stat.mtimeMs,
        etag: `"${crypto.createHash("sha1").update(data).digest("base64url")}"`,
        type: STATIC_TYPES[path.extname(file)] || "application/octet-stream",
      };
      staticCache.set(file, entry);
      return entry;
    } catch {
      return null;
    }
  }

  function send(res, status, headers, body) {
    res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
    res.end(body);
  }
  const sendJson = (res, status, body, extra = {}) => send(res, status, {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra,
  }, JSON.stringify(body));

  function cookieHeader({ token, maxAge }) {
    return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAge)}${secureCookie ? "; Secure" : ""}`;
  }

  return async function handle(req, res) {
    const url = new URL(req.url, "http://local");
    const ip = String(req.headers["x-real-ip"] || req.socket.remoteAddress || "");
    try {
      if (!url.pathname.startsWith("/api/")) {
        if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method" });
        const file = staticFile(url.pathname);
        if (!file) return send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
        const headers = { "Content-Type": file.type, "Cache-Control": "no-cache", ETag: file.etag };
        if (req.headers["if-none-match"] === file.etag) return send(res, 304, headers);
        return send(res, 200, headers, req.method === "HEAD" ? undefined : file.data);
      }

      const match = routes.map((r) => ({ r, m: r.method === req.method && r.re.exec(url.pathname) })).find((x) => x.m);
      if (!match) return sendJson(res, 404, { error: "not_found" });
      const { r, m } = match;

      // Чужие сайты не могут слать нам изменения от имени вошедшего пользователя.
      const origin = req.headers.origin;
      if (req.method !== "GET" && origin && origins.length && !origins.includes(origin)) fail(403, "origin");

      const token = parseCookies(req.headers.cookie).sid || "";
      const user = sessions.user(token);
      if (r.access !== "public" && r.access !== "optional" && !user) fail(401, "auth");
      if (r.access === "admin" && !isAdmin(user)) fail(403, "admin");
      if (r.access === "staff" && !isAdmin(user) && !isManager(user)) fail(403, "admin");

      let body = {};
      if (!r.rawBody && req.method !== "GET" && req.method !== "DELETE") {
        const raw = await readBody(req, JSON_LIMIT);
        if (raw.length) {
          try {
            body = JSON.parse(raw.toString("utf8"));
          } catch {
            fail(400, "json");
          }
          if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "json");
        }
      }

      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const out = await r.handler({ req, user, token, body, params, ip });
      if (out.raw) return send(res, 200, out.headers, out.raw);
      const extra = out.cookie ? { "Set-Cookie": cookieHeader(out.cookie) } : {};
      return sendJson(res, out.status || 200, out.body, extra);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.code });
      log.error(err);
      return sendJson(res, 500, { error: "server" });
    }
  };
}

// Свежие сверху; в один день выше та запись, что добавлена позже.
function newestFirst(list) {
  return list.map((x, i) => [x, i]).sort(([a, i], [b, j]) => b.date.localeCompare(a.date) || j - i).map(([x]) => x);
}

// Сначала открытые: по сроку, без срока в конце; потом выполненные, свежие сверху.
function tasksOrder(tasks) {
  const open = tasks.filter((t) => !t.done).map((t, i) => [t, i])
    .sort(([a, i], [b, j]) => (a.due || "9999").localeCompare(b.due || "9999") || i - j).map(([t]) => t);
  const done = tasks.filter((t) => t.done).sort((a, b) => b.doneAt.localeCompare(a.doneAt));
  return [...open, ...done];
}

function projectProgress(p) {
  return Number.isInteger(p.progressOverride) ? p.progressOverride : progress(p.stages);
}

function progress(stages) {
  if (!stages.length) return 0;
  const done = stages.reduce((n, s) => n + (s.status === "done" ? 1 : s.status === "active" ? 0.5 : 0), 0);
  return Math.round((done / stages.length) * 100);
}

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (over) return; // дочитываем вхолостую, чтобы клиент получил ответ 413, а не обрыв
      if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(new HttpError(413, "too_large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

module.exports = { createApp, progress, hashPassword, generatePassword };
