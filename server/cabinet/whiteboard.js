"use strict";
/* Доски для схем, мозговых штурмов и ретро (как Miro): стикеры, фигуры, текст, стрелки между объектами,
   рисунок от руки, рамки, картинки и карточки задач трекера. Несколько человек правят доску одновременно:
   изменения приходят операциями («положить объект», «убрать объект»), сервер проверяет их, применяет
   и рассылает остальным через hub. Содержимое доски лежит отдельным файлом, в db.json только описание. */

const ITEM_TYPES = ["sticky", "text", "shape", "frame", "line", "pen", "image", "issue"];
const SHAPES = ["rect", "round", "ellipse", "diamond", "triangle"];
const COLORS = ["yellow", "orange", "red", "pink", "violet", "blue", "cyan", "green", "lime", "gray", "white", "black", "none"];
const MAX_ITEMS = 5000;
const MAX_OPS = 500;
const C = 1e6; // координаты доски ограничены, чтобы никто не уронил отрисовку числами вроде 1e300
const IMAGE_LIMIT = 10 * 1024 * 1024;
const PERSIST_MS = 1000;
// В приватном режиме новые стикеры, тексты и фигуры видит только автор, пока режим не выключат.
const PRIVATE_TYPES = new Set(["sticky", "text", "shape"]);

function registerBoards(ctx) {
  const { route, db, store, now, fail, v, isAdmin, isTeam, canWork, hub, sessions, readUpload, fileResponse, imageType, work } = ctx;
  const { str, required } = v;
  const iso = () => new Date(now()).toISOString();
  const nameOf = (id) => db.users.find((u) => u.id === id)?.name || "";
  const docs = new Map(); // id доски → { items: Map, version, timer }

  /* ---------- Хранение ---------- */
  const fileKey = (id) => `board-${id}`;
  function docOf(board) {
    let d = docs.get(board.id);
    if (!d) {
      const raw = store.readFile(fileKey(board.id));
      const data = raw ? JSON.parse(raw.toString("utf8")) : { version: 0, items: [] };
      d = { items: new Map(data.items.map((it) => [it.id, it])), version: data.version || 0, timer: null };
      docs.set(board.id, d);
    }
    return d;
  }
  const persist = (id, d) => store.writeFile(fileKey(id), Buffer.from(JSON.stringify({ version: d.version, items: [...d.items.values()] })));
  // Во время перетаскивания операции идут потоком: пишем на диск не чаще раза в секунду.
  function schedule(board, d) {
    if (d.timer) return;
    d.timer = setTimeout(() => {
      d.timer = null;
      persist(board.id, d);
      store.save(); // описание доски: кто и когда правил, сколько объектов
    }, PERSIST_MS);
    d.timer.unref?.();
  }
  function flush() {
    for (const [id, d] of docs) {
      if (!d.timer) continue;
      clearTimeout(d.timer);
      d.timer = null;
      persist(id, d);
    }
    store.save();
  }

  /* ---------- Доступ ---------- */
  // Доска проекта видна тем, кто работает в проекте; общая (без проекта) — всей команде.
  const canOpen = (user, b) => {
    if (!b.projectId) return isTeam(user);
    const p = db.projects.find((x) => x.id === b.projectId);
    return Boolean(p && canWork(user, p));
  };
  function findBoard(user, id) {
    const b = db.boards.find((x) => x.id === id);
    if (!b || !canOpen(user, b)) fail(404, "not_found");
    return b;
  }
  const canManage = (user, b) => isAdmin(user) || user.role === "manager" || b.createdBy === user.id;
  function boardMeta(b) {
    const p = b.projectId ? db.projects.find((x) => x.id === b.projectId) : null;
    if (p) work.ensureKey(p);
    const timer = b.timer && Date.parse(b.timer.endsAt) > now() ? { ...b.timer, left: Date.parse(b.timer.endsAt) - now() } : null;
    return {
      id: b.id, projectId: b.projectId, title: b.title, count: b.count || 0, timer, privateMode: b.privateMode || null,
      createdAt: b.createdAt, createdBy: nameOf(b.createdBy), updatedAt: b.updatedAt, updatedBy: nameOf(b.updatedBy),
      project: p ? { id: p.id, title: p.title, key: p.key } : null,
    };
  }

  /* ---------- Проверка объектов ---------- */
  const num = (value, lo, hi, def = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  };
  const color = (value, def) => (typeof value === "string" && (COLORS.includes(value) || /^#[0-9a-f]{6}$/i.test(value)) ? value : def);
  const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
  const ref = (value) => (typeof value === "string" && /^[\w-]{4,40}$/.test(value) ? value : "");

  function itemOf(raw, board) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(400, "item");
    const id = ref(raw.id) || fail(400, "item");
    if (!ITEM_TYPES.includes(raw.type)) fail(400, "item");
    const it = { id, type: raw.type, x: num(raw.x, -C, C), y: num(raw.y, -C, C), z: num(raw.z, -1e9, 1e9) };
    if (raw.type !== "line" && raw.type !== "pen") Object.assign(it, { w: num(raw.w, 4, 1e5, 100), h: num(raw.h, 4, 1e5, 100) });
    switch (raw.type) {
      case "sticky":
        // size 0 — шрифт подбирается под размер стикера, как в Miro
        Object.assign(it, { text: text(raw.text, 5000), color: color(raw.color, "yellow"), size: num(raw.size, 0, 200, 0) });
        break;
      case "text":
        Object.assign(it, {
          text: text(raw.text, 10000), color: color(raw.color, "black"), size: num(raw.size, 8, 400, 24),
          bold: Boolean(raw.bold), align: ["left", "center", "right"].includes(raw.align) ? raw.align : "left",
        });
        break;
      case "shape":
        Object.assign(it, {
          shape: SHAPES.includes(raw.shape) ? raw.shape : "rect", text: text(raw.text, 5000),
          color: color(raw.color, "white"), stroke: color(raw.stroke, "black"), size: num(raw.size, 8, 200, 18),
        });
        break;
      case "frame":
        Object.assign(it, { text: text(raw.text, 200), color: color(raw.color, "white") });
        break;
      case "line":
        Object.assign(it, {
          x2: num(raw.x2, -C, C), y2: num(raw.y2, -C, C), from: ref(raw.from), to: ref(raw.to),
          color: color(raw.color, "black"), width: num(raw.width, 1, 40, 2),
          start: Boolean(raw.start), end: raw.end !== false, dash: Boolean(raw.dash), elbow: Boolean(raw.elbow), text: text(raw.text, 200),
        });
        break;
      case "pen":
        if (!Array.isArray(raw.points) || raw.points.length < 2 || raw.points.length > 8000 || raw.points.length % 2) fail(400, "item");
        Object.assign(it, {
          points: raw.points.map((n) => Math.round(num(n, -C, C) * 10) / 10),
          color: color(raw.color, "black"), width: num(raw.width, 1, 80, 3),
        });
        break;
      case "image":
        it.fileId = ref(raw.fileId);
        if (!board.files.some((f) => f.id === it.fileId)) fail(400, "item");
        break;
      case "issue":
        it.issueId = ref(raw.issueId) || fail(400, "item");
        break;
    }
    if (raw.locked) it.locked = true;
    return it;
  }

  // Чужой скрытый объект приходит без текста и голосов: видно, что коллега пишет, но не что.
  const mask = (it, viewerId) => (it.hidden && it.hidden !== viewerId ? { ...it, text: "", votes: undefined, masked: true } : it);
  const viewOps = (ops) => (meta) => ops.map((op) => (op.op === "put" ? { op: "put", item: mask(op.item, meta.userId) } : op));
  const ownsOrOpen = (it, user) => !it?.hidden || it.hidden === user.id;

  // Сначала проверяем всю пачку, потом применяем: ошибка в одной операции не оставляет доску наполовину изменённой.
  function apply(board, d, ops, user) {
    if (!Array.isArray(ops) || !ops.length || ops.length > MAX_OPS) fail(400, "ops");
    const clean = ops.map((op) => {
      if (op && op.op === "put") return { op: "put", item: itemOf(op.item, board) };
      if (op && op.op === "del") return { op: "del", id: ref(op.id) || fail(400, "op") };
      return fail(400, "op");
    });
    for (const op of clean) {
      const prev = d.items.get(op.op === "put" ? op.item.id : op.id);
      if (!ownsOrOpen(prev, user)) fail(403, "private");
      if (op.op !== "put") continue;
      if (prev?.hidden) op.item.hidden = prev.hidden;
      else if (!prev && board.privateMode && PRIVATE_TYPES.has(op.item.type)) op.item.hidden = user.id;
    }
    const adds = new Set(clean.filter((op) => op.op === "put" && !d.items.has(op.item.id)).map((op) => op.item.id));
    if (d.items.size + adds.size > MAX_ITEMS) fail(400, "board_full");
    for (const op of clean) {
      if (op.op === "put") {
        // Голоса меняются только отдельным запросом: перенос стикера не должен стирать чужие голоса.
        const prev = d.items.get(op.item.id);
        if (prev?.votes?.length) op.item.votes = prev.votes;
        d.items.set(op.item.id, op.item);
      } else d.items.delete(op.id);
    }
    d.version += 1;
    return clean;
  }

  /* ---------- Шаблоны ---------- */
  function template(name) {
    let z = 0;
    const id = () => store.id();
    const sticky = (x, y, textValue, colorValue = "yellow") => ({ id: id(), type: "sticky", x, y, w: 200, h: 200, z: ++z, text: textValue, color: colorValue, size: 0 });
    const label = (x, y, w, textValue, size = 40) => ({ id: id(), type: "text", x, y, w, h: size * 1.5, z: ++z, text: textValue, color: "black", size, bold: true, align: "left" });
    const frame = (x, y, w, h, textValue, colorValue = "white") => ({ id: id(), type: "frame", x, y, w, h, z: -1000 + ++z, text: textValue, color: colorValue });
    if (name === "retro") {
      const cols = [["Что получилось", "green"], ["Что мешало", "pink"], ["Что попробуем", "blue"]];
      return [
        label(0, -120, 1200, "Ретроспектива спринта"),
        ...cols.flatMap(([title, c], k) => [
          frame(k * 700, 0, 640, 900, title),
          sticky(k * 700 + 40, 60, k === 2 ? "Одно действие, один ответственный" : "Пишите по одной мысли на стикер", c),
        ]),
      ];
    }
    if (name === "cjm") {
      const stages = ["Узнал", "Выбрал", "Оплатил", "Пользуется", "Рекомендует"];
      const rows = ["Действия", "Мысли", "Эмоции", "Боли", "Идеи"];
      return [
        label(0, -140, 1400, "Путь пользователя"),
        frame(-260, -40, 260 + stages.length * 240 + 20, rows.length * 240 + 220, "Этапы и наблюдения"),
        ...stages.map((s, k) => sticky(k * 240 + 20, 0, s, "orange")),
        ...rows.map((r, k) => label(-240, 240 + k * 240 + 70, 220, r, 28)),
      ];
    }
    if (name === "brainstorm") {
      const center = { id: id(), type: "shape", shape: "ellipse", x: 500, y: 400, w: 320, h: 200, z: ++z, text: "Тема", color: "yellow", stroke: "black", size: 32 };
      const around = [[100, 60], [900, 60], [1180, 400], [900, 760], [100, 760], [-180, 400]].map(([x, y]) => sticky(x, y, "", "white"));
      return [
        center,
        ...around,
        ...around.map((s) => ({ id: id(), type: "line", x: 0, y: 0, x2: 0, y2: 0, from: center.id, to: s.id, color: "gray", width: 2, start: false, end: false, dash: true, elbow: false, text: "", z: -500 + ++z })),
      ];
    }
    return [];
  }

  /* ---------- Маршруты ---------- */
  route("GET", "/api/work/boards", async ({ user, query }) => {
    const pid = str(query.get("project"), 40);
    const list = db.boards.filter((b) => canOpen(user, b) && (query.has("project") ? b.projectId === pid : true));
    return { body: { boards: list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(boardMeta) } };
  }, "team");

  route("POST", "/api/work/boards", async ({ user, body }) => {
    const projectId = body.projectId ? work.findSpace(user, String(body.projectId)).id : "";
    const at = iso();
    const b = { id: store.id(), projectId, title: required(str(body.title, 160), "title"), createdAt: at, createdBy: user.id, updatedAt: at, updatedBy: user.id, count: 0, files: [] };
    const items = template(str(body.template, 20));
    const d = { items: new Map(items.map((it) => [it.id, it])), version: 0, timer: null };
    b.count = d.items.size;
    docs.set(b.id, d);
    persist(b.id, d);
    db.boards.push(b);
    store.save();
    return { status: 201, body: { board: boardMeta(b) } };
  }, "team");

  route("PATCH", "/api/work/boards/:id", async ({ user, params, body }) => {
    const b = findBoard(user, params.id);
    if ("title" in body) b.title = required(str(body.title, 160), "title");
    b.updatedAt = iso();
    b.updatedBy = user.id;
    store.save();
    hub.publish(`board:${b.id}`, "meta", { board: boardMeta(b) });
    return { body: { board: boardMeta(b) } };
  }, "team");

  route("DELETE", "/api/work/boards/:id", async ({ user, params }) => {
    const b = findBoard(user, params.id);
    if (!canManage(user, b)) fail(403, "forbidden");
    const d = docs.get(b.id);
    if (d?.timer) clearTimeout(d.timer);
    docs.delete(b.id);
    store.deleteFile(fileKey(b.id));
    for (const f of b.files) store.deleteFile(f.id);
    db.boards.splice(db.boards.indexOf(b), 1);
    store.save();
    hub.publish(`board:${b.id}`, "deleted", {});
    return { body: { ok: true } };
  }, "team");

  // Доска целиком и карточки задач, которые на ней лежат.
  route("GET", "/api/work/boards/:id", async ({ user, params }) => {
    const b = findBoard(user, params.id);
    const d = docOf(b);
    const items = [...d.items.values()];
    const ids = new Set(items.filter((it) => it.type === "issue").map((it) => it.issueId));
    const issues = [];
    for (const issueId of ids) {
      const i = db.issues.find((x) => x.id === issueId);
      const p = i && db.projects.find((x) => x.id === i.projectId);
      if (p && canWork(user, p)) issues.push(work.summary(i, (work.ensureKey(p), p)));
    }
    const team = db.users.filter(isTeam).map((u) => ({ id: u.id, name: u.name, login: u.login, role: u.role, disabled: Boolean(u.disabled) }));
    return { body: { board: { ...boardMeta(b), canManage: canManage(user, b) }, items: items.map((it) => mask(it, user.id)), version: d.version, issues, team } };
  }, "team");

  route("POST", "/api/work/boards/:id/ops", async ({ user, params, body }) => {
    const b = findBoard(user, params.id);
    const d = docOf(b);
    const client = str(body.client, 40);
    const seq = str(body.seq, 40); // номер пачки: вкладка узнаёт своё эхо и чужие правки, пришедшие после
    const ops = apply(b, d, body.ops, user);
    b.count = d.items.size;
    b.updatedAt = iso();
    b.updatedBy = user.id;
    schedule(b, d);
    const payload = { version: d.version, client, seq, by: user.name };
    hub.publish(`board:${b.id}`, "ops", null, { view: (meta) => ({ ...payload, ops: viewOps(ops)(meta) }) });
    return { body: { version: d.version } };
  }, "team");

  route("GET", "/api/work/boards/:id/events", async ({ user, params, query, token }) => {
    const b = findBoard(user, params.id);
    const d = docOf(b);
    const client = str(query.get("client"), 40);
    return {
      sse: (req, res) => hub.open(`board:${b.id}`, req, res, { client, userId: user.id, name: user.name }, {
        hello: { version: d.version },
        alive: () => sessions.user(token)?.id === user.id && db.boards.includes(b) && canOpen(user, b),
      }),
    };
  }, "team");

  // Голосование точками, как на ретро в Miro: повторный голос снимает свой.
  route("POST", "/api/work/boards/:id/vote", async ({ user, params, body }) => {
    const b = findBoard(user, params.id);
    const d = docOf(b);
    const it = d.items.get(ref(body.itemId)) || fail(404, "not_found");
    if (!["sticky", "shape", "text", "image", "issue"].includes(it.type)) fail(400, "item");
    if (!ownsOrOpen(it, user)) fail(403, "private");
    const votes = new Set(it.votes || []);
    if (votes.has(user.id)) votes.delete(user.id);
    else votes.add(user.id);
    const next = { ...it, votes: [...votes].slice(0, 200) };
    if (!next.votes.length) delete next.votes;
    d.items.set(it.id, next);
    d.version += 1;
    b.updatedAt = iso();
    b.updatedBy = user.id;
    schedule(b, d);
    const payload = { version: d.version, client: "", seq: "", by: user.name };
    hub.publish(`board:${b.id}`, "ops", null, { view: (meta) => ({ ...payload, ops: viewOps([{ op: "put", item: next }])(meta) }) });
    return { body: { version: d.version, votes: next.votes || [] } };
  }, "team");

  // Приватный режим, как в Miro на ретро: пишут каждый сам, потом открывают всем разом.
  route("POST", "/api/work/boards/:id/private", async ({ user, params, body }) => {
    const b = findBoard(user, params.id);
    const d = docOf(b);
    if (body.on) {
      b.privateMode = { by: user.name, at: iso() };
    } else {
      b.privateMode = null;
      const opened = [];
      for (const it of d.items.values()) {
        if (!it.hidden) continue;
        const next = { ...it };
        delete next.hidden;
        d.items.set(it.id, next);
        opened.push({ op: "put", item: next });
      }
      if (opened.length) {
        d.version += 1;
        schedule(b, d);
        hub.publish(`board:${b.id}`, "ops", { version: d.version, client: "", seq: "", by: user.name, ops: opened });
      }
    }
    store.save();
    hub.publish(`board:${b.id}`, "private", { privateMode: b.privateMode, by: user.name });
    return { body: { privateMode: b.privateMode } };
  }, "team");

  // Общий таймер доски: видят все, кто открыл доску. seconds = 0 — остановить.
  route("POST", "/api/work/boards/:id/timer", async ({ user, params, body }) => {
    const b = findBoard(user, params.id);
    const seconds = Math.round(Number(body.seconds) || 0);
    if (seconds < 0 || seconds > 3600) fail(400, "timer");
    b.timer = seconds ? { endsAt: new Date(now() + seconds * 1000).toISOString(), total: seconds, by: user.name } : null;
    store.save();
    const timer = boardMeta(b).timer;
    hub.publish(`board:${b.id}`, "timer", { timer, by: user.name });
    return { body: { timer } };
  }, "team");

  // Курсоры не сохраняются: только расходятся остальным.
  route("POST", "/api/work/boards/:id/cursor", async ({ user, params, body }) => {
    const b = findBoard(user, params.id);
    const client = str(body.client, 40);
    hub.publish(`board:${b.id}`, "cursor", { client, userId: user.id, name: user.name, x: num(body.x, -C, C), y: num(body.y, -C, C), gone: Boolean(body.gone) }, { except: client });
    return { body: { ok: true } };
  }, "team");

  route("POST", "/api/work/boards/:id/files", async ({ user, params, req }) => {
    const b = findBoard(user, params.id);
    if (b.files.length >= 500) fail(400, "files_limit");
    const { name, data, type } = await readUpload(req, IMAGE_LIMIT);
    if (!imageType(type, data)) fail(400, "image_type");
    const meta = { id: store.id(), name, size: data.length, type, by: user.id, uploadedAt: iso() };
    store.writeFile(meta.id, data);
    b.files.push(meta);
    store.save();
    return { status: 201, body: { file: meta } };
  }, "team", { rawBody: true });

  route("GET", "/api/work/boards/:id/files/:fileId", async ({ user, params }) => {
    const b = findBoard(user, params.id);
    const meta = b.files.find((f) => f.id === params.fileId);
    const data = meta && store.readFile(meta.id);
    if (!data) fail(404, "not_found");
    return fileResponse(meta, data, "private, max-age=31536000, immutable");
  }, "team");

  function removeProject(pid) {
    for (const b of db.boards.filter((x) => x.projectId === pid)) {
      const d = docs.get(b.id);
      if (d?.timer) clearTimeout(d.timer);
      docs.delete(b.id);
      store.deleteFile(fileKey(b.id));
      for (const f of b.files) store.deleteFile(f.id);
    }
    db.boards = db.boards.filter((b) => b.projectId !== pid);
  }

  return { flush, removeProject };
}

module.exports = { registerBoards };
