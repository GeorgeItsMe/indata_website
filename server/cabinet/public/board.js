/* Доски для схем, мозговых штурмов и ретро (как Miro): бесконечный холст со стикерами, фигурами, текстом,
   стрелками между объектами, рисунком от руки, рамками, картинками и карточками задач трекера.
   Правят вместе: изменения уходят операциями, чужие приходят через живое подключение, видны курсоры коллег.
   Свои неотправленные правки защищены: чужая операция по тому же объекту применяется, только если сервер
   принял её позже нашей. */
(() => {
  "use strict";

  const I = window.InData;
  const W = I.work;
  const { h, link, btn, api, errorText, toast, navigate, loading, CLIENT, plural, backLink } = I;
  const { svg, ico, tool, typeIcon, avatar, statusPill, ago, dialog, upload, copyText } = W;

  /* ---------- Цвета ---------- */
  const FILL = {
    yellow: "#fff2a8", orange: "#ffd9b8", red: "#ffc4bf", pink: "#ffd1e6", violet: "#ded6fd", blue: "#cbe2ff", cyan: "#c3f0ee",
    green: "#cdeec6", lime: "#e8f5b0", gray: "#ebebe8", white: "#ffffff", black: "#262626", none: "transparent",
  };
  const INK = {
    yellow: "#d99a00", orange: "#eb6834", red: "#e34948", pink: "#d55181", violet: "#6250d6", blue: "#2a78d6", cyan: "#14a39a",
    green: "#1f9d55", lime: "#7aa500", gray: "#8f8f8a", white: "#ffffff", black: "#262626", none: "transparent",
  };
  const STICKY_COLORS = ["yellow", "orange", "pink", "violet", "blue", "cyan", "green", "lime", "gray", "white"];
  const SHAPE_FILLS = ["white", "yellow", "orange", "pink", "violet", "blue", "cyan", "green", "gray", "black", "none"];
  const INK_COLORS = ["black", "gray", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "pink"];
  const COLOR_NAMES = {
    yellow: "жёлтый", orange: "оранжевый", red: "красный", pink: "розовый", violet: "фиолетовый", blue: "синий", cyan: "бирюзовый",
    green: "зелёный", lime: "салатовый", gray: "серый", white: "белый", black: "чёрный", none: "без заливки",
  };
  const fill = (c) => (c && c.startsWith("#") ? c : FILL[c] || FILL.white);
  const ink = (c) => (c && c.startsWith("#") ? c : INK[c] || INK.black);
  const SHAPES = [["rect", "Прямоугольник"], ["round", "Скруглённый"], ["ellipse", "Эллипс"], ["diamond", "Ромб"], ["triangle", "Треугольник"]];
  const TEMPLATES = [["", "Пустая доска", "Чистый холст"], ["retro", "Ретроспектива", "Что получилось, что мешало, что попробуем"], ["cjm", "Путь пользователя", "Этапы и наблюдения на каждом"], ["brainstorm", "Мозговой штурм", "Тема в центре, идеи вокруг"]];

  const TOOL_ICONS = {
    select: "M4 2.5l9 5.4-4 1.1 2.5 4.4-1.6 1-2.5-4.4L4.5 13z",
    hand: "M5.5 8.5V4a1 1 0 0 1 2 0v3.5m0-4.5a1 1 0 0 1 2 0v4.5m0-3.5a1 1 0 0 1 2 0V8m0-2a1 1 0 0 1 2 0v4.5A4.5 4.5 0 0 1 9 15h-.5a4 4 0 0 1-3.2-1.6L2.6 10a1 1 0 0 1 1.6-1.2L5.5 10.5",
    sticky: "M3 3h10v6.5L9.5 13H3zM9.5 13V9.5H13",
    text: "M3.5 4.5V3h9v1.5M8 3v10M6 13h4",
    shape: "M2.5 8.5h6v5h-6zM11 2.5a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z",
    line: "M3 13L13 3M8.5 3H13v4.5",
    pen: "M2.5 13s1.5-5 4-5 1.5 4 4 4 3-6 3-9",
    frame: "M4.5 2v12M11.5 2v12M2 4.5h12M2 11.5h12",
    image: "M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3M10.5 6.5h.01",
    issue: "M3 3h10v10H3zM5.5 8.2l1.8 1.8 3.4-3.6",
    undo: "M5 6.5h5a3 3 0 0 1 0 6H7M5 6.5 7.5 4M5 6.5 7.5 9",
    redo: "M11 6.5H6a3 3 0 0 0 0 6h3M11 6.5 8.5 4M11 6.5 8.5 9",
    fit: "M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10",
    front: "M5.5 5.5h8v8h-8zM2.5 10.5v-8h8",
    back: "M2.5 2.5h8v8h-8zM13.5 5.5v8h-8",
    copy: "M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3",
    lock: "M4 7.5h8v6H4zM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5",
    help: "M6 6a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5M8 12h.01",
  };
  const icon = (name) => svg("svg", { viewBox: "0 0 16 16", class: "ico", "aria-hidden": "true" }, svg("path", { d: TOOL_ICONS[name] }));
  const TOOLS = [
    ["select", "Выделение", "V"], ["hand", "Рука: двигать холст", "H"], ["sticky", "Стикер", "N"], ["text", "Текст", "T"],
    ["shape", "Фигура", "R"], ["line", "Стрелка", "L"], ["pen", "Карандаш", "P"], ["frame", "Рамка", "F"],
  ];
  const KEY_TOOLS = { v: "select", h: "hand", n: "sticky", t: "text", r: "shape", o: "shape", l: "line", a: "line", p: "pen", f: "frame" };
  const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  const BOX_TYPES = new Set(["sticky", "text", "shape", "frame", "image", "issue"]);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  /* ---------- Список досок проекта ---------- */
  async function viewBoards(alive, id) {
    loading();
    const [data, { boards }] = await Promise.all([W.loadSpace(id), api("GET", `/api/work/boards?project=${encodeURIComponent(id)}`)]);
    if (!alive()) return;
    I.root.replaceChildren(...W.spaceShell(data, "boards", {},
      h("div", { class: "section-head mt-24" },
        h("p", { class: "muted", text: "Схемы, user flow, ретро и мозговые штурмы. Правите вместе в реальном времени, стикер можно превратить в задачу." }),
        btn("Новая доска", { small: true, onclick: () => newBoard(id) })),
      boards.length
        ? h("div", { class: "board-cards" }, boards.map(boardCard))
        : h("div", { class: "empty-state" },
          h("h2", { class: "h2", text: "Досок пока нет" }),
          h("p", { class: "lead", text: "Начните с шаблона: ретроспектива, путь пользователя или мозговой штурм." }),
          h("div", { class: "actions mt-24" }, btn("Новая доска", { onclick: () => newBoard(id) })))));
  }
  const boardCard = (b) => link(`/work/b/${b.id}`, { class: "card board-card" },
    h("div", { class: "board-card__art", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i")),
    h("h3", { class: "board-card__title", text: b.title }),
    h("p", { class: "mono", text: `${b.count} ${plural(b.count, "объект", "объекта", "объектов")} · ${b.updatedBy || b.createdBy} · ${ago(b.updatedAt)}` }));

  function newBoard(projectId) {
    const title = h("input", { class: "input", maxlength: "160", required: true, placeholder: "Например, «Ретро спринта 4» или «Флоу оплаты»" });
    let template = "";
    const picks = h("div", { class: "templates" }, TEMPLATES.map(([key, label, sub]) => h("button", {
      class: `template template--big${key === template ? " is-on" : ""}`, type: "button", "data-key": key,
      onclick: () => {
        template = key;
        for (const b of picks.children) b.classList.toggle("is-on", b.dataset.key === key);
        if (!title.value.trim() && key) title.value = label;
      },
    }, h("b", { text: label }), h("small", { class: "muted", text: sub }))));
    const submit = btn("Создать доску", { type: "submit" });
    let ui;
    ui = dialog(projectId ? "Новая доска" : "Новая общая доска", h("form", {
      class: "form",
      async onsubmit(e) {
        e.preventDefault();
        submit.disabled = true;
        try {
          const { board } = await api("POST", "/api/work/boards", { title: title.value, projectId, template });
          ui.close(true);
          navigate(`/work/b/${board.id}`);
        } catch (err) {
          toast(errorText(err));
          submit.disabled = false;
        }
      },
    },
    h("label", { class: "field" }, h("span", { text: "Название" }), title),
    h("div", { class: "field" }, h("span", { text: "Шаблон" }), picks),
    projectId ? null : h("p", { class: "muted", text: "Общую доску видит вся команда, без привязки к проекту." }),
    h("div", { class: "actions" }, submit)), { wide: true });
    setTimeout(() => title.focus());
  }

  /* ---------- Доска ---------- */
  async function viewWhiteboard(alive, id) {
    loading();
    const res = await api("GET", `/api/work/boards/${id}`);
    if (!alive()) return;
    let board = res.board;
    W.rememberTeam(res.team);
    const items = new Map(res.items.map((it) => [it.id, it]));
    const issues = new Map(res.issues.map((i) => [i.id, i]));
    let version = res.version;
    const nodes = new Map();
    let view = { x: 0, y: 0, z: 1 };
    let tool = "select";
    let shapeKind = "rect";
    let selection = new Set();
    let editing = null;      // id объекта, текст которого правим
    let action = null;       // текущее действие мышью
    let spaceDown = false;
    let members = [];
    const undoStack = [];
    const redoStack = [];
    let clipboard = null;
    document.body.classList.add("is-fullscreen");

    /* --- Разметка --- */
    const world = h("div", { class: "wb-world" });
    const selLayer = h("div", { class: "wb-sel" });
    world.append(selLayer);
    const viewEl = h("div", { class: "wb-view", tabindex: "0", "aria-label": "Холст доски" }, world);
    const cursorsEl = h("div", { class: "wb-cursors", "aria-hidden": "true" });
    const ctxBar = h("div", { class: "wb-ctx", hidden: true });
    const statusEl = h("span", { class: "wb-status mono", text: "Сохранено" });
    const zoomLabel = h("button", { class: "wb-zoom__label mono", type: "button", title: "100% (Shift+0)", onclick: () => zoomTo(1) });
    const presenceEl = h("div", { class: "wb-presence" });
    const titleInput = h("input", { class: "wb-title", value: board.title, maxlength: "160", "aria-label": "Название доски" });
    titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") titleInput.blur(); });
    titleInput.addEventListener("blur", async () => {
      const v = titleInput.value.trim();
      if (!v || v === board.title) { titleInput.value = board.title; return; }
      try {
        board = { ...board, ...(await api("PATCH", `/api/work/boards/${id}`, { title: v })).board };
        toast("Доска переименована");
      } catch (err) {
        toast(errorText(err));
      }
    });
    const toolButtons = new Map();
    const shapeMenu = h("div", { class: "wb-menu", hidden: true }, SHAPES.map(([k, label]) => h("button", {
      class: "wb-menu__item", type: "button", title: label, "aria-label": label,
      onclick: () => { shapeKind = k; setTool("shape"); shapeMenu.hidden = true; },
    }, shapeGlyph(k))));
    let penColor = "black";
    let penWidth = 3;
    const penMenu = h("div", { class: "wb-menu wb-menu--pen", hidden: true });
    const drawPenMenu = () => penMenu.replaceChildren(
      ...INK_COLORS.slice(0, 8).map((c) => h("button", { class: `wb-swatch${penColor === c ? " is-on" : ""}`, type: "button", title: COLOR_NAMES[c], "aria-label": COLOR_NAMES[c], vars: { "--c": INK[c] }, onclick: () => { penColor = c; drawPenMenu(); } })),
      ...[[2, "Тонкий"], [4, "Средний"], [8, "Толстый"]].map(([w, label]) => h("button", { class: `wb-menu__item${penWidth === w ? " is-on" : ""}`, type: "button", title: label, "aria-label": label, onclick: () => { penWidth = w; drawPenMenu(); } }, h("i", { class: "wb-pen-dot", vars: { "--d": `${w + 2}px` } }))));
    drawPenMenu();
    const toolsEl = h("div", { class: "wb-tools", role: "toolbar", "aria-label": "Инструменты" },
      TOOLS.map(([key, label, hotkey]) => {
        const b = h("button", {
          class: "wb-tool", type: "button", title: `${label} (${hotkey})`, "aria-label": label,
          onclick: () => {
            const again = tool === key;
            setTool(key);
            if (key === "shape") shapeMenu.hidden = again && !shapeMenu.hidden;
            if (key === "pen") penMenu.hidden = again && !penMenu.hidden;
          },
        }, icon(key));
        toolButtons.set(key, b);
        return b;
      }),
      shapeMenu,
      penMenu,
      h("span", { class: "wb-tools__sep" }),
      h("button", { class: "wb-tool", type: "button", title: "Картинка", "aria-label": "Добавить картинку", onclick: () => picker.click() }, icon("image")),
      h("button", { class: "wb-tool", type: "button", title: "Карточка задачи", "aria-label": "Карточка задачи", onclick: () => insertIssueDialog() }, icon("issue")),
      h("span", { class: "wb-tools__sep" }),
      h("button", { class: "wb-tool", type: "button", title: "Отменить (Ctrl+Z)", "aria-label": "Отменить", onclick: () => undo() }, icon("undo")),
      h("button", { class: "wb-tool", type: "button", title: "Повторить (Ctrl+Shift+Z)", "aria-label": "Повторить", onclick: () => redo() }, icon("redo")));
    const picker = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", multiple: true, hidden: true, onchange: (e) => { addImages([...e.target.files], viewCenter()); e.target.value = ""; } });
    const back = board.project ? `/work/p/${board.project.id}/boards` : "/work";
    const top = h("header", { class: "wb-top" },
      h("div", { class: "wb-top__left" },
        backLink(back, board.project ? board.project.title : "Моя работа"),
        titleInput),
      h("div", { class: "wb-top__right" },
        presenceEl,
        statusEl,
        h("div", { class: "wb-zoom" },
          h("button", { class: "icon-btn", type: "button", title: "Отдалить (−)", "aria-label": "Отдалить", text: "−", onclick: () => zoomBy(1 / 1.2) }),
          zoomLabel,
          h("button", { class: "icon-btn", type: "button", title: "Приблизить (+)", "aria-label": "Приблизить", text: "+", onclick: () => zoomBy(1.2) }),
          h("button", { class: "icon-btn", type: "button", title: "Показать всё (Shift+1)", "aria-label": "Показать всё", onclick: () => fit() }, icon("fit"))),
        h("button", { class: "icon-btn", type: "button", title: "Скопировать ссылку", "aria-label": "Скопировать ссылку", onclick: () => copyText(location.href) }, ico("link")),
        h("button", { class: "icon-btn", type: "button", title: "Горячие клавиши", "aria-label": "Горячие клавиши", onclick: () => help() }, icon("help")),
        board.canManage ? h("button", { class: "icon-btn icon-btn--danger", type: "button", title: "Удалить доску", "aria-label": "Удалить доску", onclick: removeBoard }, ico("trash")) : null));
    const app = h("div", { class: "wb" }, top, h("div", { class: "wb-stage" }, viewEl, cursorsEl, ctxBar, toolsEl, picker));
    I.root.replaceChildren(app);

    /* --- Вид: перенос и масштаб --- */
    const VIEW_KEY = `wb:view:${id}`;
    function setView(next, { save = true } = {}) {
      view = { x: next.x, y: next.y, z: Math.min(4, Math.max(0.08, next.z)) };
      world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
      viewEl.style.setProperty("--gs", `${24 * view.z}px`);
      viewEl.style.setProperty("--gx", `${view.x}px`);
      viewEl.style.setProperty("--gy", `${view.y}px`);
      viewEl.style.setProperty("--inv", String(1 / view.z));
      viewEl.classList.toggle("is-far", view.z < 0.35);
      zoomLabel.textContent = `${Math.round(view.z * 100)}%`;
      drawCursors();
      placeCtx();
      if (save) {
        clearTimeout(setView.timer);
        setView.timer = setTimeout(() => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch {} }, 300);
      }
    }
    const rect = () => viewEl.getBoundingClientRect();
    const toWorld = (cx, cy) => {
      const r = rect();
      return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z };
    };
    const viewCenter = () => {
      const r = rect();
      return toWorld(r.left + r.width / 2, r.top + r.height / 2);
    };
    function zoomAt(cx, cy, z) {
      const r = rect();
      const nz = Math.min(4, Math.max(0.08, z));
      const wx = (cx - r.left - view.x) / view.z;
      const wy = (cy - r.top - view.y) / view.z;
      setView({ x: cx - r.left - wx * nz, y: cy - r.top - wy * nz, z: nz });
    }
    const zoomBy = (k) => {
      const r = rect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, view.z * k);
    };
    const zoomTo = (z) => {
      const r = rect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, z);
    };
    function fit(ids = null) {
      const list = ids ? [...ids].map((x) => items.get(x)).filter(Boolean) : [...items.values()];
      const r = rect();
      if (!list.length) return setView({ x: r.width / 2, y: r.height / 2, z: 1 });
      const b = bboxOf(list);
      const pad = 80;
      const z = Math.min(1.5, Math.max(0.08, Math.min((r.width - pad * 2) / Math.max(1, b.w), (r.height - pad * 2) / Math.max(1, b.h))));
      setView({ x: r.width / 2 - (b.x + b.w / 2) * z, y: r.height / 2 - (b.y + b.h / 2) * z, z });
    }

    /* --- Геометрия --- */
    function boxOf(it) {
      if (BOX_TYPES.has(it.type)) return { x: it.x, y: it.y, w: it.w, h: it.h };
      if (it.type === "pen") {
        let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
        for (let k = 0; k < it.points.length; k += 2) {
          minX = Math.min(minX, it.points[k]); maxX = Math.max(maxX, it.points[k]);
          minY = Math.min(minY, it.points[k + 1]); maxY = Math.max(maxY, it.points[k + 1]);
        }
        const pad = it.width / 2;
        return { x: it.x + minX - pad, y: it.y + minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
      }
      const [a, b] = lineEnds(it);
      return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
    }
    function bboxOf(list) {
      let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
      for (const it of list) {
        const b = boxOf(it);
        x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
      }
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    const center = (it) => {
      const b = boxOf(it);
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    };
    // Точка на краю объекта по направлению к toward: стрелка упирается в край, а не в центр.
    function edgePoint(it, toward, gap = 6) {
      const c = center(it);
      const dx = toward.x - c.x;
      const dy = toward.y - c.y;
      if (!dx && !dy) return c;
      let t;
      if (it.type === "shape" && it.shape === "ellipse") t = 1 / Math.sqrt((dx * dx) / ((it.w / 2) ** 2) + (dy * dy) / ((it.h / 2) ** 2));
      else if (it.type === "shape" && it.shape === "diamond") t = 1 / (Math.abs(dx) / (it.w / 2) + Math.abs(dy) / (it.h / 2));
      else t = Math.min((it.w / 2) / Math.abs(dx || 1e-9), (it.h / 2) / Math.abs(dy || 1e-9));
      const len = Math.hypot(dx, dy);
      return { x: c.x + dx * t + (dx / len) * gap, y: c.y + dy * t + (dy / len) * gap };
    }
    function lineEnds(it) {
      const A = it.from && items.get(it.from);
      const B = it.to && items.get(it.to);
      let a = { x: it.x, y: it.y };
      let b = { x: it.x2, y: it.y2 };
      const ca = A && BOX_TYPES.has(A.type) ? center(A) : a;
      const cb = B && BOX_TYPES.has(B.type) ? center(B) : b;
      if (A && BOX_TYPES.has(A.type)) a = edgePoint(A, it.elbow ? { x: cb.x, y: ca.y } : cb);
      if (B && BOX_TYPES.has(B.type)) b = edgePoint(B, it.elbow ? { x: cb.x, y: ca.y } : ca);
      return [a, b];
    }
    const maxZ = () => Math.max(0, ...[...items.values()].map((it) => it.z));
    const minZ = () => Math.min(0, ...[...items.values()].map((it) => it.z));
    const inside = (outer, it) => {
      const b = boxOf(it);
      return b.x >= outer.x && b.y >= outer.y && b.x + b.w <= outer.x + outer.w && b.y + b.h <= outer.y + outer.h;
    };

    /* --- Отрисовка объектов --- */
    function shapeGlyph(kind) {
      const d = { rect: "M2 3h12v10H2z", round: "M5 3h6a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z", ellipse: "M8 3a6 5 0 1 1 0 10A6 5 0 0 1 8 3z", diamond: "M8 2l6 6-6 6-6-6z", triangle: "M8 2.5l6.5 11h-13z" }[kind];
      return svg("svg", { viewBox: "0 0 16 16", class: "ico", "aria-hidden": "true" }, svg("path", { d }));
    }
    function shapePath(kind, w, hgt) {
      switch (kind) {
        case "round": {
          const r = Math.min(24, w / 4, hgt / 4);
          return `M${r},0H${w - r}Q${w},0 ${w},${r}V${hgt - r}Q${w},${hgt} ${w - r},${hgt}H${r}Q0,${hgt} 0,${hgt - r}V${r}Q0,0 ${r},0Z`;
        }
        case "ellipse": return `M${w / 2},0A${w / 2},${hgt / 2} 0 1 1 ${w / 2},${hgt}A${w / 2},${hgt / 2} 0 1 1 ${w / 2},0Z`;
        case "diamond": return `M${w / 2},0L${w},${hgt / 2}L${w / 2},${hgt}L0,${hgt / 2}Z`;
        case "triangle": return `M${w / 2},0L${w},${hgt}L0,${hgt}Z`;
        default: return `M0,0H${w}V${hgt}H0Z`;
      }
    }
    function createNode(it) {
      const base = { "data-id": it.id, "data-type": it.type };
      switch (it.type) {
        case "sticky": return h("div", { class: "wb-item wb-sticky", ...base }, h("div", { class: "wb-text" }));
        case "text": return h("div", { class: "wb-item wb-textbox", ...base }, h("div", { class: "wb-text" }));
        case "shape": return h("div", { class: "wb-item wb-shape", ...base }, svg("svg", { class: "wb-shape__svg", "aria-hidden": "true" }, svg("path", {})), h("div", { class: "wb-text" }));
        case "frame": return h("div", { class: "wb-item wb-frame", ...base }, h("div", { class: "wb-frame__title", "data-id": it.id }));
        case "image": return h("div", { class: "wb-item wb-image", ...base }, h("img", { alt: "", draggable: "false" }));
        case "issue": return h("div", { class: "wb-item wb-issue", ...base });
        default: { // line, pen
          const node = svg("svg", { class: "wb-item wb-vector", ...base });
          node.append(svg("path", { class: "wb-vector__hit", "data-id": it.id }), svg("path", { class: "wb-vector__path" }), svg("path", { class: "wb-vector__head" }), svg("text", { class: "wb-vector__label" }));
          return node;
        }
      }
    }
    function renderItem(it) {
      let node = nodes.get(it.id);
      if (!node) {
        node = createNode(it);
        nodes.set(it.id, node);
        world.insertBefore(node, selLayer);
      }
      node.style.zIndex = String(Math.round(Math.max(-1e6, Math.min(1e6, it.z))) + 1000000);
      node.classList.toggle("is-locked", Boolean(it.locked));
      if (BOX_TYPES.has(it.type)) {
        node.style.transform = `translate(${it.x}px, ${it.y}px)`;
        node.style.width = `${it.w}px`;
        if (it.type !== "text") node.style.height = `${it.h}px`;
      }
      const textEl = node.querySelector(":scope > .wb-text");
      if (textEl && editing !== it.id) textEl.textContent = it.text;
      switch (it.type) {
        case "sticky":
          node.style.background = fill(it.color);
          fitSticky(node, it);
          break;
        case "text":
          textEl.style.fontSize = `${it.size}px`;
          textEl.style.color = ink(it.color);
          textEl.style.fontWeight = it.bold ? "600" : "500";
          textEl.style.textAlign = it.align;
          node.classList.toggle("is-empty", !it.text && editing !== it.id);
          break;
        case "shape": {
          const s = node.querySelector(".wb-shape__svg");
          s.setAttribute("viewBox", `-2 -2 ${it.w + 4} ${it.h + 4}`);
          const p = s.querySelector("path");
          p.setAttribute("d", shapePath(it.shape, it.w, it.h));
          p.setAttribute("fill", fill(it.color));
          p.setAttribute("stroke", ink(it.stroke));
          p.setAttribute("stroke-width", it.stroke === "none" ? "0" : "2");
          textEl.style.fontSize = `${it.size}px`;
          textEl.style.color = it.color === "black" ? "#fff" : "#1a1a1a";
          node.classList.toggle("is-tri", it.shape === "triangle");
          break;
        }
        case "frame":
          node.style.background = it.color === "white" ? "#fff" : fill(it.color);
          node.querySelector(".wb-frame__title").textContent = it.text || "Рамка";
          break;
        case "image": {
          const img = node.querySelector("img");
          const src = `/api/work/boards/${id}/files/${it.fileId}`;
          if (img.getAttribute("src") !== src) img.src = src;
          break;
        }
        case "issue": renderIssueCard(node, it); break;
        case "line": renderLine(node, it); break;
        case "pen": renderPen(node, it); break;
      }
      if (it.type === "text") {
        // Высота текста — по содержимому; помним её локально для рамки выделения.
        const hgt = node.offsetHeight;
        if (hgt && Math.abs(hgt - it.h) > 1) it.h = hgt;
      }
      return node;
    }
    // Шрифт стикера подбирается под размер, как в Miro: меряем на скрытой копии.
    const measurer = h("div", { class: "wb-item wb-sticky wb-measure", "aria-hidden": "true" }, h("div", { class: "wb-text" }));
    world.append(measurer);
    function stickySize(it, text = it.text) {
      if (it.size) return it.size;
      const t = measurer.firstChild;
      measurer.style.width = `${it.w}px`;
      measurer.style.height = `${it.h}px`;
      t.textContent = text || " ";
      let size = Math.max(10, Math.min(44, Math.round(it.h / 5)));
      t.style.fontSize = `${size}px`;
      for (let k = 0; k < 30 && size > 8 && (t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1); k++) {
        size -= size > 20 ? 2 : 1;
        t.style.fontSize = `${size}px`;
      }
      return size;
    }
    function fitSticky(node, it) {
      const key = `${it.w}|${it.h}|${it.size}|${it.text}`;
      if (node.dataset.fit === key) return;
      node.dataset.fit = key;
      node.querySelector(".wb-text").style.fontSize = `${stickySize(it)}px`;
    }
    function renderIssueCard(node, it) {
      const i = issues.get(it.issueId);
      if (!i) {
        node.replaceChildren(h("p", { class: "wb-issue__missing", text: "Задача удалена или нет доступа" }));
        return;
      }
      node.classList.toggle("is-done", i.status === "done");
      node.replaceChildren(
        h("div", { class: "wb-issue__top" }, typeIcon(i.type), h("span", { class: "mono", text: i.key }), statusPill(i.status)),
        h("p", { class: "wb-issue__title", text: i.title }),
        h("div", { class: "wb-issue__foot" }, W.priorityIcon(i.priority), i.estimate ? h("span", { class: "mono", text: W.hrs(i.estimate) }) : null, avatar(i.assigneeId, { size: 24 })));
    }
    function placeVector(node, minX, minY, maxX, maxY, pad) {
      node.style.transform = `translate(${minX - pad}px, ${minY - pad}px)`;
      node.setAttribute("width", String(maxX - minX + pad * 2));
      node.setAttribute("height", String(maxY - minY + pad * 2));
      node.style.width = `${maxX - minX + pad * 2}px`;
      node.style.height = `${maxY - minY + pad * 2}px`;
    }
    function renderLine(node, it) {
      const [a, b] = lineEnds(it);
      const pts = it.elbow ? [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b] : [a, b];
      const pad = 24 + it.width * 3;
      const minX = Math.min(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y));
      const maxX = Math.max(...pts.map((p) => p.x));
      const maxY = Math.max(...pts.map((p) => p.y));
      placeVector(node, minX, minY, maxX, maxY, pad);
      const rel = pts.map((p) => ({ x: p.x - minX + pad, y: p.y - minY + pad }));
      const d = `M${rel.map((p) => `${p.x},${p.y}`).join("L")}`;
      const [hit, path, head, label] = node.children;
      hit.setAttribute("d", d);
      hit.setAttribute("stroke-width", String(Math.max(14, it.width + 12)));
      path.setAttribute("d", d);
      path.setAttribute("stroke", ink(it.color));
      path.setAttribute("stroke-width", String(it.width));
      path.setAttribute("stroke-dasharray", it.dash ? `${it.width * 4} ${it.width * 3}` : "");
      // Наконечники рисуем сами: маркеры SVG с CSS-переменными капризны.
      const size = 9 + it.width * 2;
      const arrow = (tip, from) => {
        const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
        const l = { x: tip.x - size * Math.cos(ang - 0.45), y: tip.y - size * Math.sin(ang - 0.45) };
        const r = { x: tip.x - size * Math.cos(ang + 0.45), y: tip.y - size * Math.sin(ang + 0.45) };
        return `M${l.x},${l.y}L${tip.x},${tip.y}L${r.x},${r.y}`;
      };
      const heads = [];
      if (it.end) heads.push(arrow(rel[rel.length - 1], rel[rel.length - 2]));
      if (it.start) heads.push(arrow(rel[0], rel[1]));
      head.setAttribute("d", heads.join(""));
      head.setAttribute("stroke", ink(it.color));
      head.setAttribute("stroke-width", String(it.width));
      const mid = it.elbow ? { x: rel[1].x, y: (rel[1].y + rel[2].y) / 2 } : { x: (rel[0].x + rel[1].x) / 2, y: (rel[0].y + rel[1].y) / 2 };
      label.setAttribute("x", String(mid.x));
      label.setAttribute("y", String(mid.y + 5));
      label.textContent = editing === it.id ? "" : it.text || "";
    }
    function renderPen(node, it) {
      const b = boxOf(it);
      const pad = 4;
      placeVector(node, b.x, b.y, b.x + b.w, b.y + b.h, pad);
      const ox = it.x - b.x + pad;
      const oy = it.y - b.y + pad;
      const p = it.points;
      let d = `M${p[0] + ox},${p[1] + oy}`;
      if (p.length === 2) d += `l0.1,0`;
      // Сглаживание: кривые через середины соседних точек.
      for (let k = 2; k < p.length - 2; k += 2) {
        const mx = (p[k] + p[k + 2]) / 2 + ox;
        const my = (p[k + 1] + p[k + 3]) / 2 + oy;
        d += `Q${p[k] + ox},${p[k + 1] + oy} ${mx},${my}`;
      }
      if (p.length > 2) d += `L${p[p.length - 2] + ox},${p[p.length - 1] + oy}`;
      const [hit, path, head] = node.children;
      hit.setAttribute("d", d);
      hit.setAttribute("stroke-width", String(Math.max(14, it.width + 10)));
      path.setAttribute("d", d);
      path.setAttribute("stroke", ink(it.color));
      path.setAttribute("stroke-width", String(it.width));
      head.setAttribute("d", "");
    }
    function removeNode(id2) {
      nodes.get(id2)?.remove();
      nodes.delete(id2);
    }
    // Объект поменялся: перерисовать его и стрелки, которые к нему прицеплены.
    function refresh(ids) {
      const set = new Set(ids);
      for (const x of ids) {
        const it = items.get(x);
        if (it) renderItem(it);
        else removeNode(x);
      }
      for (const it of items.values()) if (it.type === "line" && !set.has(it.id) && (set.has(it.from) || set.has(it.to))) renderItem(it);
      drawSelection();
    }
    function renderAll() {
      for (const x of [...nodes.keys()]) if (!items.has(x)) removeNode(x);
      for (const it of [...items.values()].filter((x) => x.type !== "line")) renderItem(it);
      for (const it of items.values()) if (it.type === "line") renderItem(it);
      drawSelection();
    }

    /* --- Выделение --- */
    function select(ids, { add = false } = {}) {
      selection = add ? new Set([...selection, ...ids]) : new Set(ids);
      for (const [x, node] of nodes) node.classList.toggle("is-selected", selection.has(x));
      drawSelection();
    }
    function drawSelection() {
      for (const x of [...selection]) if (!items.has(x)) selection.delete(x);
      selLayer.replaceChildren();
      if (!selection.size || action?.kind === "pen") { ctxBar.hidden = true; return; }
      const list = [...selection].map((x) => items.get(x));
      const single = list.length === 1 ? list[0] : null;
      if (single && single.type === "line") {
        const [a, b] = lineEnds(single);
        selLayer.append(
          h("div", { class: "wb-handle wb-handle--end", "data-handle": "a", vars: { "--x": `${a.x}px`, "--y": `${a.y}px` } }),
          h("div", { class: "wb-handle wb-handle--end", "data-handle": "b", vars: { "--x": `${b.x}px`, "--y": `${b.y}px` } }));
      } else {
        const b = bboxOf(list);
        const box = h("div", { class: "wb-selbox", vars: { "--x": `${b.x}px`, "--y": `${b.y}px`, "--w": `${b.w}px`, "--h": `${b.h}px` } });
        const resizable = single && BOX_TYPES.has(single.type) && !single.locked && single.type !== "issue";
        if (resizable) {
          const handles = single.type === "text" ? ["w", "e"] : ["nw", "ne", "sw", "se"];
          for (const k of handles) box.append(h("div", { class: `wb-handle wb-handle--${k}`, "data-handle": k }));
        }
        selLayer.append(box);
      }
      drawCtx(list);
    }

    /* --- Панель свойств над выделением --- */
    function drawCtx(list) {
      if (editing || !list.length || action) { ctxBar.hidden = true; return; }
      const types = new Set(list.map((it) => it.type));
      const one = types.size === 1 ? [...types][0] : null;
      const set = (patch, label = "") => change(list.map((it) => it.id), (it) => Object.assign(it, typeof patch === "function" ? patch(it) : patch), label);
      const swatches = (colors, key, palette) => h("div", { class: "wb-ctx__swatches" }, colors.map((c) => h("button", {
        class: `wb-swatch${list.every((it) => it[key] === c) ? " is-on" : ""}${c === "none" ? " is-none" : ""}`, type: "button", title: COLOR_NAMES[c], "aria-label": COLOR_NAMES[c],
        vars: { "--c": palette[c] },
        onclick: () => {
          if (one === "sticky") lastSticky = c; // следующий стикер будет того же цвета
          set({ [key]: c });
        },
      })));
      // Кнопка горит, если её значение совпадает с current или передан явный признак on.
      const seg = (options, current, onPick) => h("div", { class: "wb-ctx__seg" }, options.map(([v, label, title, on]) => h("button", {
        class: `wb-ctx__btn${(on ?? current === v) ? " is-on" : ""}`, type: "button", title: title || String(label), "aria-label": title || String(label), onclick: () => onPick(v),
      }, label)));
      const parts = [];
      if (one === "sticky") parts.push(swatches(STICKY_COLORS, "color", FILL), seg([[0, "Авто", "Шрифт по размеру"], [16, "S"], [24, "M"], [36, "L"]], list[0].size, (v) => set({ size: v })));
      if (one === "shape") {
        parts.push(seg(SHAPES.map(([k, label]) => [k, shapeGlyph(k), label]), list[0].shape, (v) => set({ shape: v })));
        parts.push(swatches(SHAPE_FILLS, "color", FILL));
        parts.push(h("label", { class: "wb-ctx__stroke", title: "Контур" }, h("span", { class: "mono", text: "контур" }), h("select", { class: "select select--sm", onchange: (e) => set({ stroke: e.target.value }) }, [...INK_COLORS, "none"].map((c) => h("option", { value: c, text: COLOR_NAMES[c], selected: list[0].stroke === c })))));
      }
      if (one === "text") {
        parts.push(swatches(INK_COLORS, "color", INK));
        parts.push(seg([[16, "S"], [24, "M"], [36, "L"], [56, "XL"]], list[0].size, (v) => set({ size: v })));
        parts.push(seg([[true, h("b", { text: "B" }), "Жирный"]], list[0].bold, () => set((it) => ({ bold: !it.bold }))));
        parts.push(seg([["left", "≡", "По левому краю"], ["center", "☰", "По центру"]], list[0].align, (v) => set({ align: v })));
      }
      if (one === "frame") parts.push(swatches(["white", "gray", "yellow", "blue", "green", "pink", "violet"], "color", FILL));
      if (one === "line") {
        parts.push(swatches(INK_COLORS, "color", INK));
        parts.push(seg([[1, "1"], [2, "2"], [4, "4"]], list[0].width, (v) => set({ width: v })));
        const all = (key) => list.every((it) => it[key]);
        parts.push(seg([["start", "←", "Стрелка в начале", all("start")], ["end", "→", "Стрелка в конце", all("end")]], "", (v) => set((it) => ({ [v]: !it[v] }))));
        parts.push(seg([["dash", "┄", "Пунктир", all("dash")], ["elbow", "┗", "Ломаная", all("elbow")]], "", (v) => set((it) => ({ [v]: !it[v] }))));
      }
      if (one === "pen") parts.push(swatches(INK_COLORS, "color", INK), seg([[2, "1"], [4, "2"], [8, "3"]], list[0].width, (v) => set({ width: v })));
      if (one === "issue" && list.length === 1) parts.push(btn("Открыть задачу", { small: true, variant: "light", onclick: () => openCardIssue(list[0]) }));
      if ((one === "sticky" || one === "text" || one === "shape") && list.length === 1 && board.projectId && list[0].text.trim()) {
        parts.push(btn("Сделать задачей", { small: true, onclick: () => toIssue(list[0]) }));
      }
      const locked = list.every((it) => it.locked);
      parts.push(h("div", { class: "wb-ctx__seg" },
        ctxTool("На передний план (])", "front", () => reorder(list, "front")),
        ctxTool("На задний план ([)", "back", () => reorder(list, "back")),
        ctxTool("Дублировать (Ctrl+D)", "copy", () => duplicate()),
        ctxTool(locked ? "Открепить" : "Закрепить на месте", "lock", () => set({ locked: !locked }, locked ? "Объект можно двигать" : "Объект закреплён"), locked),
        h("button", { class: "wb-ctx__btn wb-ctx__btn--danger", type: "button", title: "Удалить (Delete)", "aria-label": "Удалить", onclick: () => removeSelection() }, ico("trash"))));
      ctxBar.replaceChildren(...parts);
      ctxBar.hidden = false;
      placeCtx();
    }
    const ctxTool = (title, name, onclick, on = false) => h("button", { class: `wb-ctx__btn${on ? " is-on" : ""}`, type: "button", title, "aria-label": title, onclick }, icon(name));
    function placeCtx() {
      if (ctxBar.hidden || !selection.size) return;
      const b = bboxOf([...selection].map((x) => items.get(x)).filter(Boolean));
      const r = rect();
      const sx = b.x * view.z + view.x + (b.w * view.z) / 2;
      const sy = b.y * view.z + view.y;
      const w = ctxBar.offsetWidth;
      const left = Math.max(8, Math.min(r.width - w - 8, sx - w / 2));
      const topY = sy - ctxBar.offsetHeight - 14 < 8 ? (b.y + b.h) * view.z + view.y + 14 : sy - ctxBar.offsetHeight - 14;
      ctxBar.style.left = `${left}px`;
      ctxBar.style.top = `${Math.max(8, Math.min(r.height - ctxBar.offsetHeight - 8, topY))}px`;
    }

    /* --- Изменения, история, отправка --- */
    // change(ids, fn) — правка существующих; fn меняет копию объекта. Всё попадает в историю для Ctrl+Z.
    function change(ids, fn, message = "") {
      const before = ids.map((x) => clone(items.get(x)));
      const after = ids.map((x) => {
        const it = clone(items.get(x));
        fn(it);
        return it;
      });
      commit(before, after);
      if (message) toast(message);
    }
    function commit(before, after, { record = true } = {}) {
      const ops = [];
      const ids = [];
      for (let k = 0; k < after.length; k++) {
        const next = after[k];
        const prev = before[k];
        if (next) {
          items.set(next.id, next);
          ops.push({ op: "put", item: next });
          ids.push(next.id);
        } else if (prev) {
          items.delete(prev.id);
          ops.push({ op: "del", id: prev.id });
          ids.push(prev.id);
        }
      }
      if (!ops.length) return;
      if (record) {
        undoStack.push({ before, after });
        if (undoStack.length > 100) undoStack.shift();
        redoStack.length = 0;
      }
      refresh(ids);
      send(ops);
    }
    function undo() {
      const step = undoStack.pop();
      if (!step) return toast("Отменять нечего");
      redoStack.push(step);
      restore(step.before, step.after);
    }
    function redo() {
      const step = redoStack.pop();
      if (!step) return;
      undoStack.push(step);
      restore(step.after, step.before);
    }
    // Привести объекты шага к состоянию target (null — объекта нет); other — второе состояние шага, из него берём id.
    function restore(target, other) {
      const ids = target.map((x, k) => (x || other[k]).id);
      const current = ids.map((x) => (items.has(x) ? clone(items.get(x)) : null));
      commit(current, target.map((x) => (x ? clone(x) : null)), { record: false });
      select([...selection].filter((x) => items.has(x)));
    }

    let queue = [];
    let inflight = null;     // { seq, ids, acked, echoed }: пачка у сервера, ждём ответ и эхо
    let flushTimer = null;
    let retryMs = 1000;
    const pendingIds = () => new Set([...queue.map((op) => (op.op === "put" ? op.item.id : op.id)), ...(inflight ? inflight.ids : [])]);
    const buffered = [];     // чужие операции по нашим неотправленным объектам: { version, op }
    function setStatus(kind) {
      statusEl.textContent = { saved: "Сохранено", saving: "Сохраняем…", offline: "Нет связи, повторим" }[kind];
      statusEl.classList.toggle("is-offline", kind === "offline");
    }
    function send(ops) {
      queue.push(...ops);
      setStatus("saving");
      if (!flushTimer) flushTimer = setTimeout(flush, action ? 120 : 40);
    }
    async function flush() {
      flushTimer = null;
      if (inflight || !queue.length) return;
      // По каждому объекту важна только последняя операция.
      const last = new Map();
      for (const op of queue) last.set(op.op === "put" ? op.item.id : op.id, op);
      const all = [...last.values()];
      const batch = all.slice(0, 400);
      queue = all.slice(400);
      const seq = newId();
      const mine = { seq, ids: new Set(batch.map((op) => (op.op === "put" ? op.item.id : op.id))), acked: false, echoed: false };
      inflight = mine;
      try {
        await api("POST", `/api/work/boards/${id}/ops`, { client: CLIENT, seq, ops: batch });
        retryMs = 1000;
      } catch (err) {
        inflight = null;
        if (err.code === "network" || err.status >= 500) {
          queue = [...batch, ...queue];
          setStatus("offline");
          setTimeout(() => { if (!flushTimer) flush(); }, retryMs);
          retryMs = Math.min(15000, retryMs * 2);
          return;
        }
        toast(errorText(err));
        await resync();
        return;
      }
      mine.acked = true;
      if (mine.echoed) settle(mine);
      // Эхо не пришло (поток переподключается): не ждём, а перечитываем доску.
      else setTimeout(() => { if (inflight === mine) { settle(mine); resync(); } }, 2500);
    }
    function settle(batch) {
      if (inflight !== batch) return;
      inflight = null;
      if (queue.length) { if (!flushTimer) flushTimer = setTimeout(flush, 20); } else setStatus("saved");
    }

    /* --- Живые обновления --- */
    function onOps(ev) {
      if (ev.version <= version) return; // уже учтено при загрузке
      if (ev.version !== version + 1) { resync(); return; } // что-то пропустили
      version = ev.version;
      if (ev.client === CLIENT && inflight && ev.seq === inflight.seq) {
        // Своя пачка принята: чужие правки этих объектов, принятые сервером позже неё, применяем, раньше — отбрасываем.
        const batch = inflight;
        const later = [];
        for (let k = buffered.length - 1; k >= 0; k--) {
          const b = buffered[k];
          const key = b.op.op === "put" ? b.op.item.id : b.op.id;
          if (batch.ids.has(key) && !queue.some((op) => (op.op === "put" ? op.item.id : op.id) === key)) {
            if (b.version > ev.version) later.unshift(b.op);
            buffered.splice(k, 1);
          }
        }
        batch.echoed = true;
        if (batch.acked) settle(batch);
        if (later.length) applyRemote(later);
        return;
      }
      if (ev.client === CLIENT) return;
      const pend = pendingIds();
      const now = [];
      for (const op of ev.ops) {
        const key = op.op === "put" ? op.item.id : op.id;
        if (pend.has(key)) buffered.push({ version: ev.version, op });
        else now.push(op);
      }
      if (now.length) applyRemote(now);
    }
    function applyRemote(ops) {
      const ids = [];
      for (const op of ops) {
        if (op.op === "put") {
          if (editing === op.item.id) continue; // текст правим прямо сейчас: не сбиваем
          items.set(op.item.id, op.item);
          ids.push(op.item.id);
        } else {
          items.delete(op.id);
          ids.push(op.id);
        }
      }
      const unknownIssues = ops.filter((op) => op.op === "put" && op.item.type === "issue" && !issues.has(op.item.issueId));
      refresh(ids);
      if (unknownIssues.length) refreshIssues();
    }
    async function resync() {
      try {
        const fresh = await api("GET", `/api/work/boards/${id}`);
        const pend = pendingIds();
        for (const x of [...items.keys()]) if (!pend.has(x) && !fresh.items.some((it) => it.id === x)) items.delete(x);
        for (const it of fresh.items) if (!pend.has(it.id) && editing !== it.id) items.set(it.id, it);
        for (const i of fresh.issues) issues.set(i.id, i);
        version = fresh.version;
        buffered.length = 0;
        renderAll();
      } catch (err) {
        if (err.status === 404) gone();
      }
    }
    function gone() {
      toast("Доску удалили");
      navigate(back, { replace: true, force: true });
    }

    // Курсоры коллег: в координатах доски, рисуем поверх в экранных.
    const cursors = new Map();
    function drawCursors() {
      const now = Date.now();
      for (const [client, c] of cursors) {
        if (c.gone || now - c.t > 10000) {
          c.el.remove();
          cursors.delete(client);
          continue;
        }
        c.el.style.transform = `translate(${c.x * view.z + view.x}px, ${c.y * view.z + view.y}px)`;
      }
    }
    const cursorTimer = setInterval(drawCursors, 3000);
    I.onLeave(() => clearInterval(cursorTimer));
    function onCursor(ev) {
      let c = cursors.get(ev.client);
      if (!c) {
        const color = ["#2a78d6", "#eb6834", "#1baf7a", "#6250d6", "#e87ba4", "#008300"][cursors.size % 6];
        c = { el: h("div", { class: "wb-cursor", vars: { "--c": color } }, svg("svg", { viewBox: "0 0 16 16", "aria-hidden": "true" }, svg("path", { d: "M2 1.5l11 6-4.6 1.2L6 13.5z" })), h("span", { text: ev.name })) };
        cursors.set(ev.client, c);
        cursorsEl.append(c.el);
      }
      Object.assign(c, { x: ev.x, y: ev.y, t: Date.now(), gone: ev.gone });
      drawCursors();
    }
    let lastCursor = 0;
    let cursorPending = null;
    let cursorTail = null;
    function sendCursor(p, gone = false) {
      if (members.length < 2) return; // одни на доске — никому не шлём
      cursorPending = { client: CLIENT, x: Math.round(p.x), y: Math.round(p.y), gone };
      const wait = 90 - (Date.now() - lastCursor);
      if (wait > 0 && !gone) {
        if (!cursorTail) cursorTail = setTimeout(() => { cursorTail = null; if (cursorPending) sendCursor(cursorPending, cursorPending.gone); }, wait);
        return;
      }
      lastCursor = Date.now();
      const body = cursorPending;
      cursorPending = null;
      api("POST", `/api/work/boards/${id}/cursor`, body).catch(() => {});
    }
    W.live(`/api/work/boards/${id}/events?client=${CLIENT}`, {
      hello: (ev) => { if (ev.version !== version) resync(); },
      ops: onOps,
      cursor: onCursor,
      presence: (ev) => {
        members = ev.members;
        const others = members.filter((m) => m.userId !== I.me().id);
        presenceEl.replaceChildren(...others.slice(0, 6).map((m) => avatar(m.userId, { size: 28 })), others.length ? "" : h("span", { class: "mono muted", text: "вы одни" }));
        presenceEl.title = others.length ? `Сейчас на доске: ${others.map((m) => m.name).join(", ")}` : "";
      },
      meta: (ev) => {
        board = { ...board, ...ev.board };
        if (document.activeElement !== titleInput) titleInput.value = board.title;
      },
      deleted: gone,
    }, { onResync: resync });

    /* --- Создание объектов --- */
    function create(list, { edit = false } = {}) {
      let z = maxZ();
      const made = list.map((it) => ({ ...it, id: it.id || newId(), z: it.z ?? (it.type === "frame" ? minZ() - 1 : ++z) }));
      commit(made.map(() => null), made);
      select(made.map((it) => it.id));
      // После pointerdown браузер ещё переводит фокус на холст: правку начинаем следующим тиком.
      if (edit && made.length === 1) setTimeout(() => startEdit(made[0].id), 0);
      return made;
    }
    const defaults = {
      sticky: (p) => ({ type: "sticky", x: p.x - 100, y: p.y - 100, w: 200, h: 200, text: "", color: lastSticky, size: 0 }),
      text: (p) => ({ type: "text", x: p.x - 10, y: p.y - 18, w: 320, h: 36, text: "", color: "black", size: 24, bold: false, align: "left" }),
      shape: (p, w = 200, hgt = 120) => ({ type: "shape", shape: shapeKind, x: p.x, y: p.y, w, h: hgt, text: "", color: "white", stroke: "black", size: 18 }),
      frame: (p, w = 800, hgt = 560) => ({ type: "frame", x: p.x, y: p.y, w, h: hgt, text: "Рамка", color: "white" }),
    };
    let lastSticky = "yellow";

    async function addImages(files, at) {
      let k = 0;
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        if (file.size > 10 * 1024 * 1024) { toast(`${file.name}: больше 10 МБ`); continue; }
        try {
          toast("Загружаем картинку…");
          const { file: meta } = await upload(`/api/work/boards/${id}/files`, file);
          const size = await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => resolve({ w: 400, h: 300 });
            img.src = `/api/work/boards/${id}/files/${meta.id}`;
          });
          const scale = Math.min(1, 640 / Math.max(size.w, size.h));
          const w = Math.max(40, Math.round(size.w * scale));
          const hgt = Math.max(40, Math.round(size.h * scale));
          create([{ type: "image", x: at.x - w / 2 + k * 30, y: at.y - hgt / 2 + k * 30, w, h: hgt, fileId: meta.id }]);
          k++;
        } catch (err) {
          toast(errorText(err));
        }
      }
    }

    async function refreshIssues() {
      try {
        const fresh = await api("GET", `/api/work/boards/${id}`);
        for (const i of fresh.issues) issues.set(i.id, i);
        for (const it of items.values()) if (it.type === "issue") renderItem(it);
      } catch {}
    }
    // Карточки задач освежаем, когда вкладка снова видна.
    const onVisible = () => { if (!document.hidden && [...items.values()].some((it) => it.type === "issue")) refreshIssues(); };
    document.addEventListener("visibilitychange", onVisible);
    I.onLeave(() => document.removeEventListener("visibilitychange", onVisible));

    function openCardIssue(it) {
      W.openIssue(it.issueId, {
        onChange: (issue, removed) => {
          if (removed) issues.delete(issue.id);
          else issues.set(issue.id, { ...issues.get(issue.id), ...issue });
          for (const x of items.values()) if (x.type === "issue" && x.issueId === issue.id) renderItem(x);
        },
      });
    }
    function insertIssueDialog(at = viewCenter()) {
      const input = h("input", { class: "input", type: "search", placeholder: "Ключ или название задачи", "aria-label": "Найти задачу" });
      const out = h("div", { class: "search-box__results" }, h("p", { class: "empty empty--small", text: board.project ? `Например, ${board.project.key}-1` : "Поиск по задачам всех ваших проектов." }));
      let timer;
      let ui;
      const run = async () => {
        const q = input.value.trim();
        if (!q) return;
        try {
          const res = await api("GET", `/api/work/search?q=${encodeURIComponent(q)}`);
          out.replaceChildren(...(res.issues.length ? res.issues.map((i) => h("button", {
            class: "search-row", type: "button",
            onclick: () => {
              issues.set(i.id, i);
              create([{ type: "issue", issueId: i.id, x: at.x - 140, y: at.y - 64, w: 280, h: 128 }]);
              ui.close(true);
            },
          }, typeIcon(i.type), h("span", { class: "mono", text: i.key }), h("span", { class: "search-row__title", text: i.title }), statusPill(i.status))) : [h("p", { class: "empty empty--small", text: "Не нашли." })]));
        } catch (err) {
          out.replaceChildren(h("p", { class: "empty empty--small", text: errorText(err) }));
        }
      };
      input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 160); });
      ui = dialog("Карточка задачи на доску", h("div", { class: "stack" }, input, out));
      setTimeout(() => input.focus());
    }
    // Стикер или текст становится задачей проекта, на его месте — карточка задачи.
    async function toIssue(it) {
      const [first, ...rest] = it.text.trim().split("\n");
      try {
        const { issue } = await api("POST", `/api/work/projects/${board.projectId}/issues`, { title: first.slice(0, 300), description: rest.join("\n").trim() });
        issues.set(issue.id, issue);
        const card = { id: newId(), type: "issue", issueId: issue.id, x: it.x, y: it.y, w: 280, h: 128, z: it.z };
        commit([clone(it), null], [null, card]);
        for (const line of items.values()) {
          if (line.type === "line" && (line.from === it.id || line.to === it.id)) change([line.id], (l) => { if (l.from === it.id) l.from = card.id; if (l.to === it.id) l.to = card.id; });
        }
        select([card.id]);
        toast(`Создана ${issue.key}`);
      } catch (err) {
        toast(errorText(err));
      }
    }

    function reorder(list, where) {
      const sorted = [...list].sort((a, b) => a.z - b.z);
      let z = where === "front" ? maxZ() : minZ();
      const ids = (where === "front" ? sorted : sorted.reverse()).map((it) => it.id);
      const map = new Map(ids.map((x) => [x, where === "front" ? ++z : --z]));
      change(ids, (it) => { it.z = map.get(it.id); });
    }
    function removeSelection() {
      if (!selection.size) return;
      const ids = [...selection];
      // Стрелки, прицепленные к удаляемым объектам, тоже убираем.
      for (const it of items.values()) if (it.type === "line" && (selection.has(it.from) || selection.has(it.to))) ids.push(it.id);
      const unique = [...new Set(ids)];
      commit(unique.map((x) => clone(items.get(x))), unique.map(() => null));
      select([]);
    }
    function copyItems(ids) {
      const set = new Set(ids);
      // Стрелки между копируемыми объектами копируются вместе с ними.
      for (const it of items.values()) if (it.type === "line" && set.has(it.from) && set.has(it.to)) set.add(it.id);
      return [...set].map((x) => clone(items.get(x))).filter(Boolean);
    }
    function pasteItems(list, offset = 30) {
      const remap = new Map(list.map((it) => [it.id, newId()]));
      let z = maxZ();
      const made = list.map((it) => {
        const copy = { ...clone(it), id: remap.get(it.id), z: it.type === "frame" ? it.z : ++z };
        copy.x += offset;
        copy.y += offset;
        if (copy.type === "line") {
          copy.x2 += offset;
          copy.y2 += offset;
          copy.from = remap.get(copy.from) || "";
          copy.to = remap.get(copy.to) || "";
        }
        delete copy.locked;
        return copy;
      });
      commit(made.map(() => null), made);
      select(made.filter((it) => it.type !== "line" || (!it.from && !it.to)).map((it) => it.id));
      return made;
    }
    const duplicate = () => { if (selection.size) pasteItems(copyItems([...selection])); };

    /* --- Правка текста прямо на доске --- */
    function startEdit(itemId) {
      const it = items.get(itemId);
      if (!it || it.locked || !["sticky", "text", "shape", "frame", "line"].includes(it.type)) return;
      finishEdit();
      editing = itemId;
      ctxBar.hidden = true;
      const node = nodes.get(itemId);
      const before = clone(it);
      const area = h("textarea", { class: `wb-edit wb-edit--${it.type}`, spellcheck: "true", maxlength: it.type === "frame" || it.type === "line" ? "200" : "5000" });
      area.value = it.text;
      let host;
      if (it.type === "frame") {
        host = node.querySelector(".wb-frame__title");
        host.textContent = "";
      } else if (it.type === "line") {
        const [a, b] = lineEnds(it);
        host = h("div", { class: "wb-line-edit", vars: { "--x": `${(a.x + b.x) / 2}px`, "--y": `${(a.y + b.y) / 2}px` } });
        world.append(host);
        node.querySelector(".wb-vector__label").textContent = "";
      } else {
        host = node.querySelector(":scope > .wb-text");
        host.textContent = "";
        node.classList.add("is-editing");
        area.style.fontSize = host.style.fontSize;
        area.style.textAlign = host.style.textAlign;
        area.style.color = host.style.color;
        area.style.fontWeight = host.style.fontWeight;
      }
      host.append(area);
      const onInput = () => {
        it.text = area.value;
        if (it.type === "sticky") area.style.fontSize = `${stickySize(it, area.value)}px`;
      };
      area.addEventListener("input", onInput);
      area.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter") || (e.key === "Enter" && (it.type === "frame" || it.type === "line"))) {
          e.preventDefault();
          finishEdit();
        }
      });
      area.addEventListener("blur", () => setTimeout(() => { if (editing === itemId) finishEdit(); }, 0));
      area.focus();
      area.select();
      finishEdit.current = () => {
        editing = null;
        node.classList.remove("is-editing");
        if (it.type === "line") host.remove();
        const text = area.value;
        area.remove();
        const after = { ...clone(before), text };
        if (it.type === "text") {
          renderItem({ ...after });
          after.h = nodes.get(itemId)?.offsetHeight || after.h;
        }
        if (nodes.get(itemId)) delete nodes.get(itemId).dataset.fit;
        if (it.type === "text" && !text.trim()) {
          items.set(itemId, before);
          commit([before], [null], { record: Boolean(before.text) });
          select([]);
          return;
        }
        items.set(itemId, before);
        if (text !== before.text || after.h !== before.h) commit([before], [after]);
        else renderItem(before);
        drawSelection();
      };
    }
    function finishEdit() {
      const fn = finishEdit.current;
      finishEdit.current = null;
      if (fn) fn();
    }

    /* --- Мышь и касания --- */
    const pointers = new Map(); // для щипка двумя пальцами
    let pinch = null;
    function setTool(next) {
      tool = next;
      for (const [k, b] of toolButtons) b.classList.toggle("is-on", k === tool);
      shapeMenu.hidden = next !== "shape";
      penMenu.hidden = next !== "pen";
      viewEl.dataset.tool = tool;
      if (tool !== "select") select([]);
    }
    setTool("select");

    viewEl.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".wb-edit")) return;
      viewEl.focus({ preventScroll: true });
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        // Два пальца: масштаб и перенос, текущее действие отменяем.
        action = null;
        const [p1, p2] = [...pointers.values()];
        pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), cx: (p1.x + p2.x) / 2, cy: (p1.y + p2.y) / 2, view: { ...view } };
        return;
      }
      if (editing) finishEdit();
      const p = toWorld(e.clientX, e.clientY);
      const handle = e.target.dataset.handle;
      const targetEl = e.target.closest("[data-id]");
      const target = targetEl ? items.get(targetEl.dataset.id) : null;
      const pan = e.button === 1 || spaceDown || tool === "hand" || (e.pointerType === "touch" && !target && tool === "select");
      viewEl.setPointerCapture(e.pointerId);
      if (pan) {
        action = { kind: "pan", sx: e.clientX, sy: e.clientY, view: { ...view } };
        viewEl.classList.add("is-panning");
        return;
      }
      if (e.button !== 0) return;
      if (handle && selection.size === 1) {
        const it = items.get([...selection][0]);
        action = { kind: handle === "a" || handle === "b" ? "endpoint" : "resize", handle, id: it.id, before: clone(it), start: p };
        return;
      }
      if (tool === "pen") {
        action = { kind: "pen", origin: p, points: [0, 0], node: null };
        ctxBar.hidden = true;
        return;
      }
      if (tool === "line") {
        const from = target && BOX_TYPES.has(target.type) ? target.id : "";
        action = { kind: "draw-line", from, start: p, temp: null };
        return;
      }
      if (tool === "shape" || tool === "frame") {
        action = { kind: "draw-box", type: tool, start: p };
        return;
      }
      if (tool === "sticky" || tool === "text") {
        create([defaults[tool](p)], { edit: true });
        setTool("select");
        return;
      }
      // Выделение
      if (target) {
        if (e.shiftKey) {
          const next = new Set(selection);
          if (next.has(target.id)) next.delete(target.id);
          else next.add(target.id);
          select([...next]);
          return;
        }
        if (!selection.has(target.id)) select([target.id]);
        let ids = [...selection].filter((x) => !items.get(x)?.locked);
        if (!ids.length) return;
        let copies = null;
        if (e.altKey) { // Alt + перетаскивание — тащим копию; в историю она попадёт одним шагом при отпускании
          const made = pasteItems(copyItems(ids), 0);
          undoStack.pop();
          copies = made.map((it) => it.id);
          ids = copies;
        }
        // Рамка тащит за собой всё, что в ней лежит.
        const extra = [];
        for (const x of ids) {
          const it = items.get(x);
          if (it.type === "frame" && !copies) for (const other of items.values()) if (other.id !== x && !ids.includes(other.id) && !other.locked && inside(it, other)) extra.push(other.id);
        }
        const all = [...new Set([...ids, ...extra])];
        action = { kind: "move", start: p, ids: all, before: all.map((x) => clone(items.get(x))), moved: false, copies };
        return;
      }
      action = { kind: "marquee", start: p, add: e.shiftKey, base: new Set(e.shiftKey ? selection : []), el: null };
      if (!e.shiftKey) select([]);
    });

    viewEl.addEventListener("pointermove", (e) => {
      const p = toWorld(e.clientX, e.clientY);
      sendCursor(p);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        const r = rect();
        const z = Math.min(4, Math.max(0.08, pinch.view.z * (d / pinch.d)));
        const wx = (pinch.cx - r.left - pinch.view.x) / pinch.view.z;
        const wy = (pinch.cy - r.top - pinch.view.y) / pinch.view.z;
        setView({ x: cx - r.left - wx * z, y: cy - r.top - wy * z, z });
        return;
      }
      if (!action) return;
      switch (action.kind) {
        case "pan":
          setView({ x: action.view.x + e.clientX - action.sx, y: action.view.y + e.clientY - action.sy, z: view.z });
          break;
        case "move": {
          const dx = p.x - action.start.x;
          const dy = p.y - action.start.y;
          if (!action.moved && Math.hypot(dx * view.z, dy * view.z) < 3) return;
          action.moved = true;
          ctxBar.hidden = true;
          action.before.forEach((b) => {
            const it = items.get(b.id);
            if (!it) return;
            it.x = b.x + dx;
            it.y = b.y + dy;
            if (it.type === "line") {
              it.x2 = b.x2 + dx;
              it.y2 = b.y2 + dy;
            }
          });
          refresh(action.ids);
          // Коллеги видят перенос сразу, без истории (в историю — по отпусканию).
          send(action.ids.map((x) => ({ op: "put", item: items.get(x) })));
          break;
        }
        case "resize": {
          const it = items.get(action.id);
          const b = action.before;
          const dx = p.x - action.start.x;
          const dy = p.y - action.start.y;
          const k = action.handle;
          let { x, y, w, h: hgt } = b;
          if (k.includes("e")) w = b.w + dx;
          if (k.includes("s")) hgt = b.h + dy;
          if (k.includes("w")) { w = b.w - dx; x = b.x + dx; }
          if (k.includes("n")) { hgt = b.h - dy; y = b.y + dy; }
          // Картинки и стикеры сохраняют пропорции; Shift — для всех.
          if ((e.shiftKey || it.type === "image" || it.type === "sticky") && k.length === 2) {
            const ratio = b.w / b.h;
            if (Math.abs(w / b.w) > Math.abs(hgt / b.h)) hgt = w / ratio;
            else w = hgt * ratio;
            if (k.includes("w")) x = b.x + b.w - w;
            if (k.includes("n")) y = b.y + b.h - hgt;
          }
          const min = it.type === "text" ? 40 : 20;
          if (w < min) { if (k.includes("w")) x -= min - w; w = min; }
          if (hgt < min && it.type !== "text") { if (k.includes("n")) y -= min - hgt; hgt = min; }
          Object.assign(it, { x, y, w, ...(it.type === "text" ? {} : { h: hgt }) });
          refresh([it.id]);
          send([{ op: "put", item: it }]);
          break;
        }
        case "endpoint": {
          const it = items.get(action.id);
          const over = hitBox(e, it.id);
          const key = action.handle === "a" ? "from" : "to";
          if (over) it[key] = over.id;
          else {
            it[key] = "";
            if (action.handle === "a") { it.x = p.x; it.y = p.y; } else { it.x2 = p.x; it.y2 = p.y; }
          }
          highlight(over?.id);
          refresh([it.id]);
          break;
        }
        case "draw-line": {
          const over = hitBox(e, null);
          const to = over && over.id !== action.from ? over.id : "";
          if (!action.temp) {
            action.temp = { id: newId(), type: "line", x: action.start.x, y: action.start.y, x2: p.x, y2: p.y, from: action.from, to, color: "black", width: 2, start: false, end: true, dash: false, elbow: false, text: "", z: maxZ() + 1 };
            items.set(action.temp.id, action.temp);
          }
          Object.assign(action.temp, { x2: p.x, y2: p.y, to });
          highlight(to);
          refresh([action.temp.id]);
          break;
        }
        case "draw-box": {
          const x = Math.min(p.x, action.start.x);
          const y = Math.min(p.y, action.start.y);
          const w = Math.abs(p.x - action.start.x);
          const hgt = Math.abs(p.y - action.start.y);
          if (!action.temp && w * view.z < 4 && hgt * view.z < 4) return;
          if (!action.temp) {
            action.temp = { id: newId(), ...defaults[action.type]({ x, y }), z: action.type === "frame" ? minZ() - 1 : maxZ() + 1 };
            items.set(action.temp.id, action.temp);
          }
          Object.assign(action.temp, { x, y, w: Math.max(20, w), h: Math.max(20, hgt) });
          refresh([action.temp.id]);
          break;
        }
        case "pen": {
          const last = action.points.length - 2;
          const px = p.x - action.origin.x;
          const py = p.y - action.origin.y;
          if (Math.hypot((px - action.points[last]) * view.z, (py - action.points[last + 1]) * view.z) < 2.5) return;
          if (action.points.length >= 7998) return;
          action.points.push(Math.round(px * 10) / 10, Math.round(py * 10) / 10);
          if (!action.temp) {
            action.temp = { id: newId(), type: "pen", x: action.origin.x, y: action.origin.y, points: action.points, color: penColor, width: penWidth, z: maxZ() + 1 };
            items.set(action.temp.id, action.temp);
          }
          action.temp.points = action.points;
          refresh([action.temp.id]);
          break;
        }
        case "marquee": {
          const x = Math.min(p.x, action.start.x);
          const y = Math.min(p.y, action.start.y);
          const w = Math.abs(p.x - action.start.x);
          const hgt = Math.abs(p.y - action.start.y);
          if (!action.el) {
            action.el = h("div", { class: "wb-marquee" });
            world.append(action.el);
          }
          action.el.style.transform = `translate(${x}px, ${y}px)`;
          action.el.style.width = `${w}px`;
          action.el.style.height = `${hgt}px`;
          const box = { x, y, w, h: hgt };
          const hits = [...items.values()].filter((it) => {
            const b = boxOf(it);
            return b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y && !(it.type === "frame" && !inside(box, it));
          }).map((it) => it.id);
          select([...action.base, ...hits]);
          break;
        }
      }
    });
    function hitBox(e, except) {
      const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.closest?.("[data-id]") && x.closest("[data-id]").dataset.id !== except && !x.closest(".wb-sel"));
      const it = el && items.get(el.closest("[data-id]").dataset.id);
      return it && BOX_TYPES.has(it.type) && it.id !== except ? it : null;
    }
    function highlight(itemId) {
      for (const node of world.querySelectorAll(".is-target")) node.classList.remove("is-target");
      if (itemId) nodes.get(itemId)?.classList.add("is-target");
    }

    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      if (pinch) {
        if (pointers.size < 2) pinch = null;
        return;
      }
      if (!action) return;
      const a = action;
      action = null;
      viewEl.classList.remove("is-panning");
      highlight(null);
      switch (a.kind) {
        case "move":
          if (a.copies) commit(a.copies.map(() => null), a.copies.map((x) => clone(items.get(x))));
          else if (a.moved) {
            const after = a.ids.map((x) => clone(items.get(x)));
            undoStack.push({ before: a.before, after });
            redoStack.length = 0;
            send(after.map((it) => ({ op: "put", item: it })));
          }
          drawSelection();
          break;
        case "resize":
        case "endpoint": {
          const it = clone(items.get(a.id));
          items.set(a.id, a.before);
          commit([a.before], [it]);
          break;
        }
        case "draw-line":
          if (a.temp) {
            const it = clone(a.temp);
            items.delete(it.id);
            if (Math.hypot(it.x2 - it.x, it.y2 - it.y) < 4 && !it.to) { removeNode(it.id); break; }
            create([it]);
            setTool("select");
            select([it.id]);
          }
          break;
        case "draw-box": {
          const p = toWorld(e.clientX, e.clientY);
          let it;
          if (a.temp) {
            it = clone(a.temp);
            items.delete(it.id);
          } else {
            const base = a.type === "frame" ? defaults.frame(p) : defaults.shape(p);
            it = { ...base, x: p.x - base.w / 2, y: p.y - base.h / 2 };
          }
          create([it], { edit: a.type === "shape" && !a.temp });
          setTool("select");
          break;
        }
        case "pen":
          if (a.temp) {
            const it = clone(a.temp);
            items.delete(it.id);
            create([it]);
            select([]);
          }
          break;
        case "marquee":
          a.el?.remove();
          drawSelection();
          break;
        default:
          break;
      }
    };
    viewEl.addEventListener("pointerup", endPointer);
    viewEl.addEventListener("pointercancel", endPointer);
    viewEl.addEventListener("pointerleave", () => sendCursor({ x: 0, y: 0 }, true));

    // Холст захватывает указатель, и клики приходят ему самому: объект ищем по точке.
    const itemAt = (cx, cy) => {
      const el = document.elementsFromPoint(cx, cy).find((x) => x.closest?.("[data-id]") && !x.closest(".wb-sel") && x.closest(".wb-world"));
      return el ? items.get(el.closest("[data-id]").dataset.id) : null;
    };
    viewEl.addEventListener("dblclick", (e) => {
      const it = itemAt(e.clientX, e.clientY);
      if (it?.type === "issue") return openCardIssue(it);
      if (it) return startEdit(it.id);
      // Двойной клик по пустому месту — новый стикер.
      if (tool === "select") create([defaults.sticky(toWorld(e.clientX, e.clientY))], { edit: true });
    });

    viewEl.addEventListener("wheel", (e) => {
      e.preventDefault();
      // Щипок на тачпаде приходит как колесо с Ctrl и мелкими шагами, колесо мыши — крупными: ограничиваем шаг.
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, view.z * Math.exp(-Math.max(-40, Math.min(40, e.deltaY * (e.deltaMode ? 16 : 1))) * 0.01));
      else setView({ x: view.x - (e.shiftKey ? e.deltaY : e.deltaX), y: view.y - (e.shiftKey ? 0 : e.deltaY), z: view.z });
    }, { passive: false });

    viewEl.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
    viewEl.addEventListener("drop", (e) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      addImages([...e.dataTransfer.files], toWorld(e.clientX, e.clientY));
    });

    /* --- Клавиатура и буфер обмена --- */
    const onKeyDown = (e) => {
      if (document.body.classList.contains("has-overlay") || editing) return;
      if (W.typing(document.activeElement) && document.activeElement !== viewEl) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (e.key === " " && !spaceDown) { spaceDown = true; viewEl.classList.add("is-space"); e.preventDefault(); return; }
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === "y") { e.preventDefault(); redo(); return; }
      if (mod && k === "a") { e.preventDefault(); select([...items.keys()]); return; }
      if (mod && k === "d") { e.preventDefault(); duplicate(); return; }
      if (mod && (k === "c" || k === "x")) {
        if (!selection.size) return;
        clipboard = copyItems([...selection]);
        clipboardText = `indata-board:${JSON.stringify(clipboard)}`;
        try { navigator.clipboard.writeText(clipboardText).catch(() => {}); } catch {}
        if (k === "x") removeSelection();
        e.preventDefault();
        return;
      }
      if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomBy(1.2); return; }
      if (mod && e.key === "-") { e.preventDefault(); zoomBy(1 / 1.2); return; }
      if (mod) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeSelection(); return; }
      if (e.key === "Escape") { select([]); setTool("select"); return; }
      if (e.key === "Enter" && selection.size === 1) { e.preventDefault(); startEdit([...selection][0]); return; }
      if (e.shiftKey && (e.code === "Digit1")) { e.preventDefault(); fit(); return; }
      if (e.shiftKey && (e.code === "Digit2") && selection.size) { e.preventDefault(); fit(selection); return; }
      if (e.shiftKey && (e.code === "Digit0")) { e.preventDefault(); zoomTo(1); return; }
      if (e.key === "+" || e.key === "=") { zoomBy(1.2); return; }
      if (e.key === "-") { zoomBy(1 / 1.2); return; }
      if (e.key === "]" && selection.size) { reorder([...selection].map((x) => items.get(x)), "front"); return; }
      if (e.key === "[" && selection.size) { reorder([...selection].map((x) => items.get(x)), "back"); return; }
      if (e.key.startsWith("Arrow") && selection.size) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        change([...selection].filter((x) => !items.get(x).locked), (it) => {
          it.x += dx;
          it.y += dy;
          if (it.type === "line") { it.x2 += dx; it.y2 += dy; }
        });
        return;
      }
      if (KEY_TOOLS[k] && !e.altKey) {
        if (k === "o") shapeKind = "ellipse";
        if (k === "r") shapeKind = "rect";
        setTool(KEY_TOOLS[k]);
      }
    };
    const onKeyUp = (e) => { if (e.key === " ") { spaceDown = false; viewEl.classList.remove("is-space"); } };
    let clipboardText = "";
    const onPaste = async (e) => {
      if (editing || (W.typing(document.activeElement) && document.activeElement !== viewEl) || document.body.classList.contains("has-overlay")) return;
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        addImages(files, viewCenter());
        return;
      }
      const text = e.clipboardData?.getData("text/plain") || "";
      e.preventDefault();
      if (clipboard && text === clipboardText) { pasteItems(clipboard); return; }
      if (text.startsWith("indata-board:")) {
        // С другой доски: картинки остаются там, где загружены, остальное переносим.
        try {
          const list = JSON.parse(text.slice("indata-board:".length)).filter((it) => it && it.type !== "image");
          if (list.length) pasteItems(list);
        } catch {}
        return;
      }
      if (clipboard && !text) { pasteItems(clipboard); return; }
      if (text.trim()) {
        // Несколько строк — несколько стикеров рядом, как при вставке списка в Miro.
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 40);
        const c = viewCenter();
        const cols = Math.ceil(Math.sqrt(lines.length));
        create(lines.map((line, k) => ({ ...defaults.sticky({ x: c.x + (k % cols) * 220 - ((cols - 1) * 220) / 2, y: c.y + Math.floor(k / cols) * 220 }), text: line.slice(0, 5000) })));
      }
    };
    const onBlur = () => { spaceDown = false; viewEl.classList.remove("is-space"); };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("paste", onPaste);
    window.addEventListener("blur", onBlur);
    const onResize = () => { placeCtx(); drawCursors(); };
    window.addEventListener("resize", onResize);
    I.onLeave(() => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      if (queue.length) flush();
    });
    // Уходим с несохранёнными правками — спросим.
    I.setLeaveGuard((unload) => !(queue.length || inflight) || (!unload && confirm("Изменения ещё отправляются. Уйти со страницы?")));

    async function removeBoard() {
      if (!confirm(`Удалить доску «${board.title}» со всеми объектами? Это нельзя отменить.`)) return;
      try {
        await api("DELETE", `/api/work/boards/${id}`);
        toast("Доска удалена");
        I.setLeaveGuard(null);
        navigate(back, { replace: true });
      } catch (err) {
        toast(errorText(err));
      }
    }

    function help() {
      const rows = [
        ["V", "Выделение"], ["H или пробел", "Двигать холст"], ["N", "Стикер (или двойной клик по пустому месту)"], ["T", "Текст"],
        ["R / O", "Прямоугольник / эллипс"], ["L", "Стрелка: тяните от объекта к объекту"], ["P", "Карандаш"], ["F", "Рамка"],
        ["Enter", "Править текст выделенного"], ["Ctrl+Z / Ctrl+Shift+Z", "Отменить / повторить"], ["Ctrl+C, Ctrl+V, Ctrl+D", "Копировать, вставить, дублировать"],
        ["Alt + перетащить", "Перетащить копию"], ["Delete", "Удалить"], ["[ / ]", "Назад / вперёд по слоям"], ["Стрелки", "Сдвинуть на 1 px, с Shift на 10"],
        ["Ctrl + колесо, щипок", "Масштаб"], ["Shift+1 / Shift+2 / Shift+0", "Всё / выделенное / 100%"],
        ["Ctrl+V", "Вставить картинку или текст: каждая строка станет стикером"],
      ];
      dialog("Горячие клавиши", h("dl", { class: "keys" }, rows.map(([k, v]) => h("div", {}, h("dt", { class: "mono", text: k }), h("dd", { text: v })))), { wide: true });
    }

    /* --- Старт --- */
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(VIEW_KEY) || "null"); } catch {}
    renderAll();
    if (saved && Number.isFinite(saved.z)) setView(saved, { save: false });
    else fit();
    viewEl.focus({ preventScroll: true });
  }

  I.addRoutes([
    { re: /^\/work\/p\/([\w-]+)\/boards$/, view: viewBoards, access: "team" },
    { re: /^\/work\/b\/([\w-]+)$/, view: viewWhiteboard, access: "team" },
  ]);
  W.newBoard = newBoard;
})();
