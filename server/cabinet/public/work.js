/* Внутренняя часть кабинета для команды InData — то, что обычно разложено по Jira, Confluence и Miro:
   «Моя работа», пространства проектов с канбан-доской, бэклогом и спринтами, списком задач, карточка задачи
   (поля, описание в Markdown, чек-лист, файлы, комментарии, история, учёт времени), быстрый поиск.
   Роадмап и отчёты — plan.js, вики — wiki.js, доски для схем — board.js. Общие функции берутся из app.js. */
(() => {
  "use strict";

  const I = window.InData;
  const { h, link, btn, backLink, fmtDate, fileSize, today, plural, api, errorText, toast, navigate, shell, loading, CLIENT } = I;
  const me = () => I.me();

  const DAY = 24 * 60 * 60 * 1000;
  const TYPES = { task: "Задача", bug: "Баг", story: "История", epic: "Эпик" };
  const STATUSES = [["todo", "К работе"], ["progress", "В работе"], ["review", "Ревью"], ["test", "Тест"], ["done", "Готово"]];
  const STATUS = Object.fromEntries(STATUSES);
  const PRIORITIES = [["urgent", "Срочный"], ["high", "Высокий"], ["medium", "Средний"], ["low", "Низкий"]];
  const PRIORITY = Object.fromEntries(PRIORITIES);
  const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
  const FIELD_LABELS = {
    title: "Название", type: "Тип", status: "Статус", priority: "Приоритет", assigneeId: "Исполнитель", sprintId: "Спринт",
    epicId: "Эпик", estimate: "Оценка", due: "Срок", start: "Начало", labels: "Метки", description: "Описание",
  };
  Object.assign(I.ERRORS, {
    key: "Ключ: латиница и цифры, от 2 до 10 символов, первая буква",
    key_taken: "Такой ключ уже у другого проекта",
    sprint_active: "Сначала завершите активный спринт",
    sprint_state: "Спринт уже начат или завершён",
    sprint: "Этот спринт уже закрыт",
    conflict: "Страницу уже изменил кто-то другой",
    assignee: "Этому человеку нельзя назначать задачи этого проекта",
    epic: "Выберите эпик этого проекта",
    hours: "Проверьте часы: за одну запись от 0,25 до 24",
    image_type: "Картинка: PNG, JPEG, WebP или GIF",
    board_full: "На доске слишком много объектов",
    files_limit: "Слишком много файлов",
    parent: "Так переместить страницу нельзя",
    place: "Не получилось поставить задачу на это место",
    forbidden: "Недостаточно прав",
    link: "Так связать задачи нельзя",
    link_exists: "Такая связь уже есть",
    wip: "Лимит колонки: число от 1 до 99",
    timer: "Таймер: до 60 минут",
  });
  const LINK_LABELS = {
    blocks: ["блокирует", "заблокирована задачей"],
    relates: ["связана с", "связана с"],
    duplicates: ["дублирует", "дубликат у"],
  };

  /* ---------- Мелочи ---------- */
  const NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs = {}, ...children) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
    for (const c of children.flat(Infinity)) if (c) el.append(c);
    return el;
  }
  // Значки интерфейса: контур 1.6px, как стрелка «назад».
  const ICONS = {
    link: "M7 9.5a3 3 0 0 0 4.2.2l2-2a3 3 0 0 0-4.2-4.2l-.9.9M9 6.5a3 3 0 0 0-4.2-.2l-2 2a3 3 0 0 0 4.2 4.2l.9-.9",
    trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5",
    close: "M4 4l8 8M12 4l-8 8",
    plus: "M8 3v10M3 8h10",
    search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.6 10.6 14 14",
    clip: "M10.5 5.5 6 10a1.4 1.4 0 0 0 2 2l5-5a2.8 2.8 0 0 0-4-4L4 8a4.2 4.2 0 0 0 6 6l3.5-3.5",
    comment: "M3 3.5h10v7H7l-3 2.5v-2.5H3z",
    clock: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 5v3l2 1.5",
    check: "M3.5 8.5l3 3 6-7",
    chevron: "M6 4l4 4-4 4",
    grip: "M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01",
    board: "M2.5 3.5h11v9h-11zM6 3.5v9M10 3.5v9",
    page: "M4 2.5h5.5L12 5v8.5H4zM9.5 2.5V5H12",
    block: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM3.8 3.8l8.4 8.4",
    links: "M6 5.5H4.5a2.5 2.5 0 0 0 0 5H6M10 5.5h1.5a2.5 2.5 0 0 1 0 5H10M5.5 8h5",
  };
  const ico = (name, cls = "ico") => svg("svg", { viewBox: "0 0 16 16", class: cls, "aria-hidden": "true" }, svg("path", { d: ICONS[name] }));

  // Тип задачи — цветной квадратик со знаком, как в Jira: задача, баг, история, эпик.
  const TYPE_COLORS = { task: "#2a78d6", bug: "#e34948", story: "#1f9d55", epic: "#6250d6" };
  function typeIcon(type) {
    const glyph = {
      task: svg("path", { d: "M4.6 8.3l2.2 2.2 4.6-4.9", fill: "none", stroke: "#fff", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" }),
      bug: svg("circle", { cx: "8", cy: "8", r: "3", fill: "#fff" }),
      story: svg("path", { d: "M5.5 4h5v8L8 10.2 5.5 12z", fill: "#fff" }),
      epic: svg("path", { d: "M9 3 5 9h3l-1 4 4-6H8z", fill: "#fff" }),
    }[type];
    return svg("svg", { viewBox: "0 0 16 16", class: "type-icon", role: "img", "aria-label": TYPES[type] },
      svg("title", {}, TYPES[type]), svg("rect", { width: "16", height: "16", rx: "3.5", fill: TYPE_COLORS[type] }), glyph);
  }
  // Приоритет — стрелки: две вверх, одна вверх, черта, вниз.
  const PRIORITY_ICON = {
    urgent: ["#e34948", "M4 9l4-4 4 4M4 13l4-4 4 4"],
    high: ["#eb6834", "M4 10l4-4 4 4"],
    medium: ["#eda100", "M4 6.5h8M4 9.5h8"],
    low: ["#2a78d6", "M4 6l4 4 4-4"],
  };
  function priorityIcon(p) {
    const [color, d] = PRIORITY_ICON[p];
    return svg("svg", { viewBox: "0 0 16 16", class: "prio-icon", role: "img", "aria-label": `Приоритет: ${PRIORITY[p]}` },
      svg("title", {}, `Приоритет: ${PRIORITY[p]}`),
      svg("path", { d, fill: "none", stroke: color, "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" }));
  }

  const team = new Map(); // люди команды по id: имена в карточках, история, фильтры
  const knownKeys = new Set(); // ключи проектов: только их «KEY-12» в тексте становятся ссылками
  const rememberTeam = (list) => { for (const u of list || []) team.set(u.id, u); };
  const nameOf = (id) => (id ? team.get(id)?.name || "Бывший участник" : "");
  const AVATAR_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#6250d6", "#e87ba4", "#008300", "#eda100", "#e34948"];
  function avatar(id, { size = 24, title = true } = {}) {
    if (!id) return h("span", { class: "avatar avatar--none", vars: { "--size": `${size}px` }, title: title ? "Не назначен" : null, "aria-label": "Не назначен" });
    const name = nameOf(id);
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
    let hash = 0;
    for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return h("span", {
      class: "avatar", text: initials, title: title ? name : null, "aria-label": name,
      vars: { "--size": `${size}px`, "--bg": AVATAR_COLORS[hash % AVATAR_COLORS.length] },
    });
  }

  const hrs = (n) => `${String(Math.round(n * 100) / 100).replace(".", ",")} ч`;
  const addDays = (isoDate, n) => new Date(Date.parse(isoDate) + n * DAY).toISOString().slice(0, 10);
  const localDate = (iso) => {
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  function ago(iso) {
    if (!iso) return "";
    const diff = Date.now() - Date.parse(iso);
    if (diff < 60e3) return "только что";
    if (diff < 3600e3) return `${Math.round(diff / 60e3)} мин назад`;
    const d = new Date(iso);
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const day = localDate(iso);
    if (day === today()) return `сегодня в ${time}`;
    if (day === addDays(today(), -1)) return `вчера в ${time}`;
    return fmtDate(day);
  }
  const isOverdue = (i) => i.status !== "done" && i.due && i.due < today();
  const tool = (label, icon, onclick, danger = false) => h("button", {
    class: `icon-btn${danger ? " icon-btn--danger" : ""}`, type: "button", title: label, "aria-label": label,
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); onclick(e); },
  }, typeof icon === "string" && ICONS[icon] ? ico(icon) : icon);
  const typing = (el) => el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
  const select = (cls, options, value, onchange) => {
    const el = h("select", { class: `select select--sm ${cls}`, onchange: (e) => onchange(e.target.value, e) },
      options.map(([v, label]) => h("option", { value: v, text: label })));
    el.value = value;
    return el;
  };
  function download(name, text, type = "text/csv;charset=utf-8") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const upload = (url, file) => api("POST", url, file, { headers: { "X-Filename": encodeURIComponent(file.name || "image.png") } });
  async function copyText(text, message = "Ссылка скопирована") {
    try {
      await navigator.clipboard.writeText(text);
      toast(message);
    } catch {
      toast("Не получилось скопировать");
    }
  }

  // Подсказка логинов после «@» в поле текста: стрелки, Enter или Tab выбирают человека.
  function mentionAssist(area, people) {
    const wrap = h("div", { class: "mention-wrap" });
    const menu = h("div", { class: "mention-menu", hidden: true, role: "listbox" });
    let list = [];
    let cursor = 0;
    const token = () => /(^|[\s(])@([a-z0-9._-]*)$/i.exec(area.value.slice(0, area.selectionStart));
    function paint() {
      menu.replaceChildren(...list.map((u, k) => h("button", {
        class: `mention-menu__row${k === cursor ? " is-active" : ""}`, type: "button", role: "option",
        onmousedown: (e) => { e.preventDefault(); pick(u); },
      }, avatar(u.id, { size: 22 }), h("span", { text: u.name }), h("span", { class: "mono", text: `@${u.login}` }))));
      menu.hidden = !list.length;
    }
    function update() {
      const m = token();
      if (!m) { list = []; paint(); return; }
      const q = m[2].toLowerCase();
      list = people().filter((u) => u.login.toLowerCase().startsWith(q) || u.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))).slice(0, 6);
      cursor = 0;
      paint();
    }
    function pick(u) {
      const m = token();
      if (!m) return;
      const end = area.selectionStart;
      const start = end - m[2].length - 1;
      area.value = `${area.value.slice(0, start)}@${u.login} ${area.value.slice(end)}`;
      area.selectionStart = area.selectionEnd = start + u.login.length + 2;
      list = [];
      paint();
      area.dispatchEvent(new Event("input"));
      area.focus();
    }
    area.addEventListener("input", update);
    area.addEventListener("keydown", (e) => {
      if (menu.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); cursor = (cursor + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length; paint(); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopImmediatePropagation(); pick(list[cursor]); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); list = []; paint(); }
    }, true);
    area.addEventListener("blur", () => setTimeout(() => { list = []; paint(); }, 150));
    wrap.append(area, menu);
    return wrap;
  }

  /* ---------- Markdown ----------
     Описания задач, комментарии и вики. Только безопасный набор: заголовки, списки, чек-боксы, цитаты, код,
     таблицы, ссылки http(s) и внутренние, картинки только со своего сервера. Узлы строятся через DOM. */
  const INLINE = new RegExp([
    "(`[^`\\n]+`)",
    "(!\\[[^\\]\\n]*\\]\\([^)\\s]+\\))",
    "(\\[[^\\]\\n]+\\]\\([^)\\s]+\\))",
    "(\\*\\*[^*\\n]+\\*\\*)",
    "(~~[^~\\n]+~~)",
    "(\\*[^*\\s][^*\\n]*\\*|\\b_[^_\\s][^_\\n]*_\\b)",
    "(https?:\\/\\/[^\\s<>()]+[^\\s<>().,;:!?'\"»])",
    "(\\b[A-Z][A-Z0-9]{1,9}-\\d+\\b)",
    "((?<![\\w.@])@[a-z0-9][a-z0-9._-]{2,63})",
  ].join("|"), "gi");
  function safeLink(url, children) {
    if (/^\/(?!\/)/.test(url)) return link(url, { class: "md-link" }, ...children);
    if (/^https?:\/\//i.test(url)) return h("a", { class: "md-link", href: url, target: "_blank", rel: "noopener noreferrer" }, ...children);
    return h("span", {}, ...children);
  }
  function inline(text) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const [all, code, image, mdLink, bold, strike, italic, url, key, mention] = m;
      if (code) out.push(h("code", { text: code.slice(1, -1) }));
      else if (image) {
        const [, alt, src] = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(image);
        out.push(src.startsWith("/api/work/") ? h("a", { href: src, target: "_blank", rel: "noopener", class: "md-img-link" }, h("img", { class: "md-img", src, alt, loading: "lazy" })) : alt);
      } else if (mdLink) {
        const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(mdLink);
        out.push(safeLink(href, inline(label)));
      } else if (bold) out.push(h("strong", {}, ...inline(bold.slice(2, -2))));
      else if (strike) out.push(h("s", {}, ...inline(strike.slice(2, -2))));
      else if (italic) out.push(h("em", {}, ...inline(italic.slice(1, -1))));
      else if (url) out.push(safeLink(url, [url.replace(/^https?:\/\//, "").slice(0, 60)]));
      else if (key) out.push(knownKeys.has(key.split("-")[0]) && key === key.toUpperCase() ? link(`/work/i/${key}`, { class: "md-key" }, key) : key);
      else if (mention) {
        const login = mention.slice(1).toLowerCase();
        const u = [...team.values()].find((x) => x.login === login);
        out.push(u ? h("span", { class: `mention${u.id === me()?.id ? " is-me" : ""}`, title: u.name, text: mention }) : mention);
      }
      else out.push(all);
      last = m.index + all.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  const withBreaks = (text) => text.split("\n").flatMap((line, i) => (i ? [h("br"), ...inline(line)] : inline(line)));

  // onToggle(lineIndex, checked) — клик по чек-боксу в тексте меняет исходник.
  function markdown(src, { onToggle = null, cls = "" } = {}) {
    const out = h("div", { class: `md ${cls}` });
    const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
    const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || "");
    const isBlock = (l) => /^```/.test(l) || /^#{1,4}\s/.test(l) || /^>/.test(l) || LIST.test(l) || /^(-{3,}|\*{3,})\s*$/.test(l);
    const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (!line.trim()) { i++; continue; }
      if (/^```/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.append(h("pre", { class: "md-code" }, h("code", { text: buf.join("\n") })));
        continue;
      }
      if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
        out.append(h(`h${m[1].length + 1}`, {}, ...inline(m[2])));
        i++;
        continue;
      }
      if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.append(h("hr")); i++; continue; }
      if (/^>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
        out.append(h("blockquote", {}, ...withBreaks(buf.join("\n"))));
        continue;
      }
      if (/\|/.test(line) && isTableSep(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]));
        out.append(h("div", { class: "md-table" }, h("table", {},
          h("thead", {}, h("tr", {}, head.map((c) => h("th", {}, ...inline(c))))),
          h("tbody", {}, rows.map((r) => h("tr", {}, head.map((_, k) => h("td", {}, ...inline(r[k] || "")))))))));
        continue;
      }
      if (LIST.test(line)) {
        // Вложенность по отступу: стек списков.
        const stack = [];
        while (i < lines.length && LIST.test(lines[i])) {
          const [, indent, marker, rest] = LIST.exec(lines[i]);
          const level = Math.floor(indent.replace(/\t/g, "  ").length / 2);
          const ordered = /\d/.test(marker);
          while (stack.length > level + 1) stack.pop();
          while (stack.length < level + 1) {
            const list = h(ordered ? "ol" : "ul", {});
            const parentItem = stack.length ? stack[stack.length - 1].lastElementChild : null;
            (parentItem || out).append(list);
            if (!parentItem && stack.length) stack[stack.length - 1].append(list);
            stack.push(list);
          }
          const task = /^\[([ xX])\]\s+(.*)$/.exec(rest);
          const lineIndex = i;
          if (task) {
            const box = h("input", { type: "checkbox", checked: task[1] !== " ", disabled: !onToggle, onchange: (e) => onToggle(lineIndex, e.target.checked) });
            stack[stack.length - 1].append(h("li", { class: "md-task" }, h("label", {}, box, h("span", {}, ...inline(task[2])))));
          } else {
            stack[stack.length - 1].append(h("li", {}, ...inline(rest)));
          }
          i++;
        }
        continue;
      }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !isBlock(lines[i]) && !(/\|/.test(lines[i]) && isTableSep(lines[i + 1]))) buf.push(lines[i++]);
      out.append(h("p", {}, ...withBreaks(buf.join("\n"))));
    }
    return out;
  }
  const toggleTask = (src, lineIndex, checked) => {
    const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
    lines[lineIndex] = lines[lineIndex].replace(/\[([ xX])\]/, checked ? "[x]" : "[ ]");
    return lines.join("\n");
  };
  // Вставка картинки из буфера в поле Markdown: загружаем и подставляем ссылку на месте курсора.
  function pasteImages(textarea, uploadUrl, onDone = () => {}) {
    textarea.addEventListener("paste", async (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length || !uploadUrl) return;
      e.preventDefault();
      for (const file of files) {
        try {
          toast("Загружаем картинку…");
          const res = await upload(uploadUrl(), file);
          const meta = res.file;
          const md = `![${meta.name}](${uploadUrl()}/${meta.id})`;
          const { selectionStart: a, selectionEnd: b, value } = textarea;
          textarea.value = `${value.slice(0, a)}${md}${value.slice(b)}`;
          textarea.selectionStart = textarea.selectionEnd = a + md.length;
          textarea.dispatchEvent(new Event("input"));
          onDone(res);
          toast("Картинка вставлена");
        } catch (err) {
          toast(errorText(err));
        }
      }
    });
  }

  /* ---------- Окна поверх страницы ---------- */
  // kind: "modal" — по центру, "sheet" — панель справа (карточка задачи).
  function overlay(content, { kind = "modal", wide = false, canClose = () => true, onClose = () => {} } = {}) {
    const box = h("div", { class: `${kind}${wide ? ` ${kind}--wide` : ""}`, role: "dialog", "aria-modal": "true" }, content);
    const layer = h("div", { class: `overlay overlay--${kind}`, onmousedown: (e) => { if (e.target === layer) close(); } }, box);
    let open = true;
    function close(force = false) {
      if (!open || (!force && !canClose())) return false;
      open = false;
      layer.classList.add("is-closing");
      document.removeEventListener("keydown", onKey, true);
      setTimeout(() => layer.remove(), 180);
      document.body.classList.toggle("has-overlay", document.querySelectorAll(".overlay:not(.is-closing)").length > 0);
      onClose();
      return true;
    }
    function onKey(e) {
      if (e.key !== "Escape" || layer !== [...document.querySelectorAll(".overlay:not(.is-closing)")].pop()) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    }
    document.addEventListener("keydown", onKey, true);
    document.body.append(layer);
    document.body.classList.add("has-overlay");
    I.onLeave(() => close(true));
    return { close, box };
  }
  function dialog(title, body, { wide = false } = {}) {
    const holder = {};
    const ui = overlay(h("div", { class: "dialog" },
      h("div", { class: "dialog__head" }, h("h2", { class: "h2", text: title }), tool("Закрыть", "close", () => holder.close())),
      body), { wide });
    holder.close = ui.close;
    return ui;
  }

  /* ---------- Живые обновления ----------
     Одно подключение на экран; в фоновой вкладке через 30 секунд закрываем, чтобы не держать соединение,
     а при возврате открываем и перечитываем данные. */
  function live(url, handlers, { onResync = () => {} } = {}) {
    let es = null;
    let hideTimer = null;
    let closed = false;
    let opens = 0;
    function open() {
      if (es || closed) return;
      es = new EventSource(url);
      es.addEventListener("open", () => { if (opens++) onResync(); });
      for (const [name, fn] of Object.entries(handlers)) {
        es.addEventListener(name, (e) => {
          try {
            fn(JSON.parse(e.data));
          } catch (err) {
            console.error(err);
          }
        });
      }
    }
    const stop = () => {
      es?.close();
      es = null;
      opens = 0;
    };
    function onVisibility() {
      clearTimeout(hideTimer);
      if (document.hidden) hideTimer = setTimeout(stop, 30000);
      else if (!es) {
        open();
        onResync();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    open();
    const close = () => {
      closed = true;
      clearTimeout(hideTimer);
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    I.onLeave(close);
    return close;
  }
  function presence(members) {
    const others = members.filter((m) => m.userId !== me().id);
    if (!others.length) return null;
    return h("div", { class: "presence", title: `Сейчас здесь: ${others.map((m) => m.name).join(", ")}` },
      others.slice(0, 5).map((m) => avatar(m.userId, { size: 26 })),
      others.length > 5 ? h("span", { class: "presence__more mono", text: `+${others.length - 5}` }) : null);
  }

  // c — новая задача, / — поиск по экрану, Ctrl+K или ⌘K — общий поиск (только в рабочей части).
  // Обработчик один на всё время; экран лишь говорит, что делать, и при уходе это сбрасывается.
  let keys = null;
  function hotkeys({ create = null, focusSearch = null } = {}) {
    if (!keys) I.onLeave(() => { keys = null; });
    keys = { create, focusSearch };
  }
  document.addEventListener("keydown", (e) => {
    if (!keys || document.body.classList.contains("has-overlay")) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openSearch();
      return;
    }
    if (typing(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "c" && keys.create) { e.preventDefault(); keys.create(); }
    if (e.key === "/" && keys.focusSearch) { e.preventDefault(); keys.focusSearch(); }
  });

  /* ---------- Данные пространства ---------- */
  async function loadSpace(id) {
    const data = await api("GET", `/api/work/projects/${id}`);
    rememberTeam(data.team);
    knownKeys.add(data.project.key);
    return data;
  }
  // Ответ сервера по одной задаче подмешиваем в загруженный список, не перечитывая всё.
  function mergeIssue(data, issue, removed = false) {
    const k = data.issues.findIndex((x) => x.id === issue.id);
    if (removed) {
      if (k >= 0) data.issues.splice(k, 1);
      return;
    }
    const brief = { ...issue };
    for (const key of ["description", "checklist", "worklogs", "history", "project"]) delete brief[key];
    brief.comments = Array.isArray(issue.comments) ? issue.comments.length : issue.comments;
    brief.links = Array.isArray(issue.links) ? issue.links.length : issue.links;
    brief.files = Array.isArray(issue.files) ? issue.files.length : issue.files;
    if (k >= 0) data.issues[k] = brief;
    else data.issues.push(brief);
    data.issues.sort((a, b) => a.rank - b.rank);
  }
  const epicsOf = (data) => data.issues.filter((i) => i.type === "epic");
  const sprintName = (data, id) => (id ? data.sprints.find((s) => s.id === id)?.name || "Удалённый спринт" : "Бэклог");
  const labelsOf = (data) => [...new Set(data.issues.flatMap((i) => i.labels))].sort((a, b) => a.localeCompare(b, "ru"));

  // Шапка пространства: проект, ключ, вкладки как в Jira (доска, бэклог, список, роадмап, отчёты) и вики с досками.
  const SPACE_TABS = [["board", "Доска"], ["backlog", "Бэклог"], ["list", "Список"], ["roadmap", "Роадмап"], ["reports", "Отчёты"], ["wiki", "Вики"], ["boards", "Доски"]];
  function spaceShell(data, tab, { onCreated = null, wide = true } = {}, ...content) {
    const p = data.project;
    const base = `/work/p/${p.id}`;
    const create = () => createIssue({ space: data, onCreated: onCreated || ((issue) => openIssue(issue.id, { space: data })) });
    hotkeys({ create, focusSearch: () => document.querySelector(".js-filter-search")?.focus() });
    const head = h("div", { class: "space-head" },
      h("div", { class: "space-head__main" },
        backLink("/work", "Моя работа"),
        h("div", { class: "space-head__title" },
          p.logo ? h("img", { class: "space-head__logo", src: I.logoSrc(p), alt: "" }) : h("span", { class: "space-head__key", text: p.key.slice(0, 2) }),
          h("div", {},
            h("span", { class: "eyebrow mono" }, p.key, p.folder ? ` · ${p.folder}` : ""),
            h("h1", { class: "space-head__h1", text: p.title })))),
      h("div", { class: "actions" },
        btn("Поиск", { variant: "light", small: true, title: "Ctrl+K", onclick: openSearch }),
        p.clientView ? btn("Кабинет клиента", { href: `/p/${p.id}`, variant: "light", small: true }) : null,
        p.canManage ? btn("Настройки", { variant: "light", small: true, onclick: () => spaceSettings(data) }) : null,
        btn("Создать задачу", { small: true, title: "Клавиша C", onclick: create })));
    const nav = h("nav", { class: "subtabs space-tabs", "aria-label": "Разделы проекта" },
      SPACE_TABS.map(([key, label]) => link(`${base}/${key}`, { "aria-current": tab === key ? "page" : null }, label)));
    const nodes = shell(head, nav, ...content);
    if (wide) widen(nodes);
    return nodes;
  }

  function spaceSettings(data) {
    const key = h("input", { class: "input", value: data.project.key, maxlength: "10", required: true, autocapitalize: "characters", spellcheck: "false" });
    const wip = STATUSES.filter(([s]) => s !== "done").map(([s, label]) => [s, label, h("input", { class: "input input--sm", type: "number", min: "0", max: "99", step: "1", placeholder: "нет", value: data.project.wip[s] || "" })]);
    const error = h("p", { class: "form__error", hidden: true });
    const save = btn("Сохранить", { type: "submit" });
    const ui = dialog("Настройки проекта", h("form", {
      class: "form",
      async onsubmit(e) {
        e.preventDefault();
        save.disabled = true;
        try {
          const body = { wip: Object.fromEntries(wip.map(([s, , input]) => [s, Number(input.value || 0)])) };
          if (key.value.trim().toUpperCase() !== data.project.key) body.key = key.value;
          const res = await api("PATCH", `/api/work/projects/${data.project.id}`, body);
          knownKeys.add(res.project.key);
          ui.close(true);
          toast(body.key ? "Ключ изменён: номера задач теперь с ним" : "Настройки сохранены");
          navigate(location.pathname, { replace: true });
        } catch (err) {
          error.textContent = errorText(err);
          error.hidden = false;
          save.disabled = false;
        }
      },
    },
    h("label", { class: "field" }, h("span", { text: "Ключ задач, как в Jira: D2OP-12. Старые ссылки с прежним ключом перестанут открываться" }), key),
    h("div", { class: "field" },
      h("span", { text: "WIP-лимиты: сколько задач может одновременно стоять в колонке. Превышение подсвечивается на доске" }),
      h("div", { class: "wip-grid" }, wip.map(([, label, input]) => h("label", { class: "field" }, h("span", { text: label }), input)))),
    error,
    h("div", { class: "actions" }, save)));
    key.focus();
  }

  // Широкая раскладка: и шапка, и страница до 1440px.
  function widen(nodes) {
    nodes[0].classList.add("top--wide");
    nodes[nodes.length - 1].classList.add("page--wide");
  }

  /* ---------- Фильтры (общие для доски, бэклога и списка) ---------- */
  const filterState = new Map(); // по проекту: живут, пока открыт кабинет
  function filtersFor(projectId) {
    if (!filterState.has(projectId)) filterState.set(projectId, { q: "", people: new Set(), types: new Set(), label: "", epic: "", lanes: "none", hideDone: false });
    return filterState.get(projectId);
  }
  function applyFilters(list, f) {
    const q = f.q.trim().toLowerCase();
    return list.filter((i) => (!q || i.key.toLowerCase().includes(q) || i.title.toLowerCase().includes(q))
      && (!f.people.size || f.people.has(i.assigneeId || "none"))
      && (!f.types.size || f.types.has(i.type))
      && (!f.label || i.labels.includes(f.label))
      && (!f.epic || (f.epic === "none" ? !i.epicId : i.epicId === f.epic))
      && (!f.hideDone || i.status !== "done"));
  }
  function filterBar(data, f, redraw, { lanes = false, hideDone = false, extra = null } = {}) {
    const search = h("input", {
      class: "input input--sm filter-search js-filter-search", type: "search", value: f.q, placeholder: "Найти по ключу или названию", "aria-label": "Поиск задач",
      oninput: (e) => { f.q = e.target.value; redraw({ keepFocus: true }); },
      onkeydown: (e) => { if (e.key === "Escape") { f.q = ""; redraw(); } },
    });
    const people = [...new Set(data.issues.map((i) => i.assigneeId || "none"))].sort((a, b) => (a === me().id ? -1 : b === me().id ? 1 : nameOf(a).localeCompare(nameOf(b), "ru")));
    const toggle = (set, value) => { if (set.has(value)) set.delete(value); else set.add(value); redraw(); };
    const epics = epicsOf(data);
    const labels = labelsOf(data);
    const active = f.q || f.people.size || f.types.size || f.label || f.epic || f.hideDone;
    return h("div", { class: "filters" },
      search,
      h("div", { class: "filter-people", role: "group", "aria-label": "Исполнители" }, people.map((id) => h("button", {
        class: `filter-person${f.people.has(id) ? " is-on" : ""}`, type: "button", "aria-pressed": String(f.people.has(id)),
        title: id === "none" ? "Без исполнителя" : nameOf(id), onclick: () => toggle(f.people, id),
      }, avatar(id === "none" ? "" : id, { size: 28, title: false })))),
      h("div", { class: "filter-types", role: "group", "aria-label": "Типы" }, Object.keys(TYPES).filter((t) => t !== "epic").map((t) => h("button", {
        class: `chip-btn${f.types.has(t) ? " is-on" : ""}`, type: "button", "aria-pressed": String(f.types.has(t)), onclick: () => toggle(f.types, t),
      }, typeIcon(t), TYPES[t]))),
      epics.length ? select("filter-select", [["", "Все эпики"], ["none", "Без эпика"], ...epics.map((e) => [e.id, `${e.key} ${e.title}`])], f.epic, (v) => { f.epic = v; redraw(); }) : null,
      labels.length ? select("filter-select", [["", "Все метки"], ...labels.map((l) => [l, l])], f.label, (v) => { f.label = v; redraw(); }) : null,
      lanes ? select("filter-select", [["none", "Без дорожек"], ["people", "Дорожки: люди"], ["epic", "Дорожки: эпики"], ["priority", "Дорожки: приоритет"]], f.lanes, (v) => { f.lanes = v; redraw(); }) : null,
      hideDone ? h("label", { class: "check filter-check" }, h("input", { type: "checkbox", checked: f.hideDone, onchange: (e) => { f.hideDone = e.target.checked; redraw(); } }), "Скрыть готовые") : null,
      active ? h("button", { class: "link-btn filter-reset", type: "button", text: "Сбросить", onclick: () => { Object.assign(f, { q: "", label: "", epic: "", hideDone: false }); f.people.clear(); f.types.clear(); redraw(); } }) : null,
      extra);
  }
  // Перерисовка не должна выбивать курсор из поля поиска.
  function keepSearchFocus(fn) {
    const el = document.activeElement;
    const wasSearch = el?.classList.contains("js-filter-search");
    const pos = wasSearch ? el.selectionStart : 0;
    fn();
    if (wasSearch) {
      const next = document.querySelector(".js-filter-search");
      next?.focus();
      next?.setSelectionRange(pos, pos);
    }
  }

  /* ---------- Пилюли ---------- */
  const statusPill = (s) => h("span", { class: `status-pill is-${s}`, text: STATUS[s] });
  const epicChip = (data, id) => {
    const e = id && data.issues.find((x) => x.id === id);
    return e ? h("span", { class: "epic-chip", title: `Эпик ${e.key}`, text: e.title }) : null;
  };

  /* ---------- Карточка задачи ---------- */
  let openPanel = null; // открытая карточка: живые обновления её освежают
  // onLinks — связи поменялись: у второй задачи тоже меняется «заблокирована», экрану стоит перечитать данные.
  function openIssue(issueId, { space = null, onChange = () => {}, onLinks = () => {} } = {}) {
    const panel = issuePanel(issueId, { space, onChange, onLinks, onClose: () => ui.close() });
    const ui = overlay(panel.el, { kind: "sheet", canClose: panel.canClose, onClose: () => { if (openPanel === panel) openPanel = null; } });
    openPanel = panel;
    return panel;
  }

  function issuePanel(issueId, { space = null, onChange = () => {}, onLinks = () => {}, onClose = null, page = false } = {}) {
    const el = h("div", { class: `issue${page ? " issue--page" : ""}` }, h("p", { class: "loading mono", text: "Загружаем задачу…" }));
    let issue = null;
    let data = space;
    const ui = { tab: "comments", editDesc: false, desc: "", comment: "", editComment: null, commentEdit: "", logHours: "", logNote: "", logDate: today(), linkType: "blocks", linkOpen: false, linkQuery: "" };
    const people = () => data.members.map((id) => team.get(id)).filter(Boolean);

    async function load() {
      try {
        const res = await api("GET", `/api/work/issues/${issueId}`);
        issue = res.issue;
        if (!data || data.project.id !== issue.projectId) data = await loadSpace(issue.projectId);
        draw();
      } catch (err) {
        el.replaceChildren(h("p", { class: "empty", text: err.status === 404 ? "Задачу удалили или у вас нет к ней доступа." : errorText(err) }));
      }
    }
    function apply(next) {
      issue = next;
      mergeIssue(data, next);
      draw();
      onChange(next);
    }
    async function save(fields, message = "") {
      try {
        apply((await api("PATCH", `/api/work/issues/${issue.id}`, fields)).issue);
        if (message) toast(message);
        return true;
      } catch (err) {
        toast(errorText(err));
        draw();
        return false;
      }
    }
    async function call(method, url, body, message = "") {
      try {
        apply((await api(method, url, body)).issue);
        if (message) toast(message);
        return true;
      } catch (err) {
        toast(errorText(err));
        return false;
      }
    }

    function draw() {
      const scroller = el.closest(".sheet") || document.scrollingElement;
      const top = scroller.scrollTop;
      // Название над колонками: на телефоне поля (статус, исполнитель) встают сразу под ним.
      el.replaceChildren(head(), titleField(), h("div", { class: "issue__grid" },
        h("div", { class: "issue__main" }, issue.blocked ? blockedNote() : null, descBlock(), issue.type === "epic" ? epicBlock() : null, checklistBlock(), linksBlock(), filesBlock(), activityBlock()),
        h("aside", { class: "issue__side" }, fieldsBlock())));
      scroller.scrollTop = top;
    }

    const canDelete = () => me().role !== "developer" || issue.reporterId === me().id;
    function head() {
      const typeSel = select("type-select", Object.entries(TYPES), issue.type, (v) => save({ type: v }, `Тип: ${TYPES[v].toLowerCase()}`));
      return h("div", { class: "issue__head" },
        h("div", { class: "issue__crumbs" },
          link(`/work/p/${data.project.id}/board`, { class: "mono" }, data.project.title),
          h("span", { class: "mono", text: "/" }),
          h("span", { class: "type-pick" }, typeIcon(issue.type), typeSel),
          link(`/work/i/${issue.key}`, { class: "issue__key mono", title: "Открыть отдельной страницей" }, issue.key)),
        h("div", { class: "row-tools" },
          tool("Скопировать ссылку", "link", () => copyText(`${location.origin}/work/i/${issue.key}`)),
          canDelete() ? tool("Удалить задачу", "trash", remove, true) : null,
          onClose ? tool("Закрыть (Esc)", "close", onClose) : null));
    }
    async function remove() {
      if (!confirm(`Удалить ${issue.key} «${issue.title}»? Комментарии, файлы и время тоже удалятся.`)) return;
      try {
        await api("DELETE", `/api/work/issues/${issue.id}`);
        mergeIssue(data, issue, true);
        onChange(issue, true);
        toast(`${issue.key} удалена`);
        if (onClose) onClose(true);
        else navigate(`/work/p/${data.project.id}/board`);
      } catch (err) {
        toast(errorText(err));
      }
    }

    function titleField() {
      const area = h("textarea", { class: "issue__title", rows: "1", maxlength: "300", "aria-label": "Название задачи" });
      area.value = issue.title;
      const grow = () => { area.style.height = "auto"; area.style.height = `${area.scrollHeight}px`; };
      area.addEventListener("input", grow);
      area.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); area.blur(); }
        if (e.key === "Escape") { area.value = issue.title; area.blur(); }
      });
      area.addEventListener("blur", () => {
        const v = area.value.trim();
        if (!v) area.value = issue.title;
        else if (v !== issue.title) save({ title: v }, "Название сохранено");
      });
      requestAnimationFrame(grow);
      return area;
    }

    function descBlock() {
      if (ui.editDesc) {
        const area = h("textarea", { class: "textarea issue__desc-input", maxlength: "50000", placeholder: "Что нужно сделать, критерии готовности, ссылки на макеты" });
        area.value = ui.desc;
        area.addEventListener("input", () => { ui.desc = area.value; });
        area.addEventListener("keydown", (e) => {
          if ((e.metaKey || e.ctrlKey) && (e.key === "Enter" || e.key.toLowerCase() === "s")) { e.preventDefault(); submit(); }
          if (e.key === "Escape") { e.stopPropagation(); cancel(); }
        });
        pasteImages(area, () => `/api/work/issues/${issue.id}/files`, (res) => { issue = res.issue; mergeIssue(data, res.issue); });
        const areaBox = mentionAssist(area, people);
        const submit = async () => {
          if (await save({ description: ui.desc }, "Описание сохранено")) { ui.editDesc = false; draw(); }
        };
        const cancel = () => {
          if (ui.desc !== issue.description && !confirm("Отменить правки описания?")) return;
          ui.editDesc = false;
          draw();
        };
        setTimeout(() => area.focus());
        return h("section", { class: "issue__block" },
          h("h3", { class: "issue__label", text: "Описание" }),
          areaBox,
          h("p", { class: "md-hint mono", text: "Markdown: **жирный**, # заголовок, - список, - [ ] чек-бокс, ```код```. Картинку можно вставить из буфера. Ctrl+Enter сохраняет" }),
          h("div", { class: "actions" }, btn("Сохранить", { small: true, onclick: submit }), btn("Отмена", { small: true, variant: "light", onclick: cancel })));
      }
      const startEdit = () => { ui.editDesc = true; ui.desc = issue.description; draw(); };
      return h("section", { class: "issue__block" },
        h("div", { class: "issue__block-head" },
          h("h3", { class: "issue__label", text: "Описание" }),
          issue.description ? h("button", { class: "link-btn issue__edit", type: "button", text: "Изменить", onclick: startEdit }) : null),
        issue.description
          ? h("div", { class: "issue__desc", ondblclick: startEdit }, markdown(issue.description, { onToggle: (line, checked) => save({ description: toggleTask(issue.description, line, checked) }) }))
          : h("button", { class: "issue__placeholder", type: "button", text: "Добавить описание…", onclick: startEdit }));
    }

    function blockedNote() {
      const by = issue.links.filter((l) => l.type === "blocks" && l.direction === "in" && l.issue.status !== "done");
      return h("p", { class: "issue__blocked" }, ico("block"), "Заблокирована: ",
        by.map((l, k) => [k ? ", " : "", h("button", { class: "link-btn", type: "button", text: `${l.issue.key} ${l.issue.title}`, onclick: () => panelSwap(l.issue.id) })]));
    }

    // Связи, как в Jira: что блокирует эту задачу, что блокирует она, связанные и дубликаты.
    function linksBlock() {
      const groups = new Map();
      for (const l of issue.links) {
        const label = LINK_LABELS[l.type][l.direction === "out" ? 0 : 1];
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(l);
      }
      const remove = async (l) => {
        try {
          await api("DELETE", `/api/work/issues/${l.ownerId}/links/${l.id}`);
          await load();
          onChange(issue);
          onLinks();
          toast("Связь удалена");
        } catch (err) {
          toast(errorText(err));
        }
      };
      let form = null;
      if (ui.linkOpen) {
        const input = h("input", { class: "input input--sm", placeholder: "Ключ или название задачи этого проекта", value: ui.linkQuery });
        const results = h("div", { class: "link-results" });
        const find = () => {
          const q = input.value.trim().toLowerCase();
          const linked = new Set(issue.links.map((l) => l.issue.id));
          const hits = q ? data.issues.filter((x) => x.id !== issue.id && !linked.has(x.id) && (x.key.toLowerCase().includes(q) || x.title.toLowerCase().includes(q))).slice(0, 6) : [];
          results.replaceChildren(...hits.map((x) => h("button", { class: "search-row", type: "button", onclick: () => add(x) },
            typeIcon(x.type), h("span", { class: "mono", text: x.key }), h("span", { class: "search-row__title", text: x.title }), statusPill(x.status))));
        };
        const add = async (x) => {
          // «Заблокирована задачей X» хранится у X как «X блокирует эту».
          const [owner, target, type] = ui.linkType === "blocked" ? [x.id, issue.id, "blocks"] : [issue.id, x.id, ui.linkType];
          try {
            await api("POST", `/api/work/issues/${owner}/links`, { type, issueId: target });
            Object.assign(ui, { linkOpen: false, linkQuery: "" });
            await load();
            onChange(issue);
            onLinks();
            toast("Связь добавлена");
          } catch (err) {
            toast(errorText(err));
          }
        };
        input.addEventListener("input", () => { ui.linkQuery = input.value; find(); });
        input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); ui.linkOpen = false; draw(); } });
        setTimeout(() => { input.focus(); find(); });
        form = h("div", { class: "link-form-issue" },
          h("div", { class: "link-form-issue__row" },
            select("", [["blocks", "блокирует"], ["blocked", "заблокирована задачей"], ["relates", "связана с"], ["duplicates", "дублирует"]], ui.linkType, (v) => { ui.linkType = v; }),
            input,
            btn("Отмена", { small: true, variant: "light", onclick: () => { ui.linkOpen = false; draw(); } })),
          results);
      }
      return h("section", { class: "issue__block" },
        h("div", { class: "issue__block-head" },
          h("h3", { class: "issue__label", text: "Связи" }),
          ui.linkOpen ? null : h("button", { class: "link-btn issue__edit", type: "button", text: "Связать", onclick: () => { ui.linkOpen = true; draw(); } })),
        [...groups].map(([label, list]) => h("div", { class: "links-group" },
          h("p", { class: "links-group__title", text: label }),
          h("ul", { class: "mini-issues" }, list.map((l) => h("li", { class: "link-row" },
            h("button", { class: `mini-issue${l.issue.status === "done" ? " is-done" : ""}`, type: "button", onclick: () => panelSwap(l.issue.id) },
              typeIcon(l.issue.type), h("span", { class: "mini-issue__key mono", text: l.issue.key }), h("span", { class: "mini-issue__title", text: l.issue.title }), statusPill(l.issue.status)),
            tool("Убрать связь", "close", () => remove(l), true)))))),
        form,
        !issue.links.length && !form ? h("p", { class: "empty empty--small", text: "Нет связей. «Связать», чтобы отметить, что задача блокирует другую или дублирует её." }) : null);
    }

    function epicBlock() {
      const children = data.issues.filter((i) => i.epicId === issue.id);
      const done = children.filter((i) => i.status === "done").length;
      return h("section", { class: "issue__block" },
        h("div", { class: "issue__block-head" },
          h("h3", { class: "issue__label", text: "Задачи эпика" }),
          children.length ? h("span", { class: "mono", text: `${done} из ${children.length} готово` }) : null),
        children.length ? h("div", { class: "bar bar--thin" }, h("i", { vars: { "--p": `${Math.round((done / children.length) * 100)}%` } })) : null,
        children.length
          ? h("ul", { class: "mini-issues" }, children.map((c) => miniIssue(c, () => { panelSwap(c.id); })))
          : h("p", { class: "empty", text: "В эпике пока нет задач. Выберите эпик в карточке задачи или создайте новую." }),
        btn("Задача в этот эпик", { small: true, variant: "light", onclick: () => createIssue({ space: data, epicId: issue.id, onCreated: (x) => { mergeIssue(data, x); draw(); onChange(x); } }) }));
    }
    function panelSwap(id) {
      issueId = id;
      ui.editDesc = false;
      load();
    }

    function checklistBlock() {
      const items = issue.checklist;
      const done = items.filter((c) => c.done).length;
      const setList = (list, message) => save({ checklist: list.map(({ id, text, done: d }) => ({ id, text, done: d })) }, message);
      const input = h("input", { class: "input input--sm", maxlength: "300", placeholder: "Добавить пункт и Enter" });
      return h("section", { class: "issue__block" },
        h("div", { class: "issue__block-head" },
          h("h3", { class: "issue__label", text: "Чек-лист" }),
          items.length ? h("span", { class: "mono", text: `${done} из ${items.length}` }) : null),
        items.length ? h("div", { class: "bar bar--thin" }, h("i", { vars: { "--p": `${Math.round((done / items.length) * 100)}%` } })) : null,
        items.length ? h("ul", { class: "checks" }, items.map((c) => h("li", { class: `checks__row${c.done ? " is-done" : ""}` },
          h("label", { class: "check" },
            h("input", { type: "checkbox", checked: c.done, onchange: (e) => setList(items.map((x) => (x === c ? { ...x, done: e.target.checked } : x))) }),
            h("span", { text: c.text })),
          tool("Удалить пункт", "close", () => setList(items.filter((x) => x !== c)), true)))) : null,
        h("form", {
          class: "checks__add",
          onsubmit: (e) => {
            e.preventDefault();
            if (input.value.trim()) setList([...items, { text: input.value.trim(), done: false }]);
          },
        }, input));
    }

    function filesBlock() {
      // Файл уходит телом запроса как есть, имя — в заголовке X-Filename.
      const pick = async (files) => {
        for (const file of [...files]) {
          if (file.size > 25 * 1024 * 1024) { toast(`${file.name}: больше 25 МБ`); continue; }
          try {
            toast(`Загружаем ${file.name}…`);
            apply((await upload(`/api/work/issues/${issue.id}/files`, file)).issue);
            toast("Файл прикреплён");
          } catch (err) {
            toast(errorText(err));
          }
        }
      };
      const picker = h("input", { type: "file", multiple: true, hidden: true, onchange: (e) => pick(e.target.files) });
      const url = (f) => `/api/work/issues/${issue.id}/files/${f.id}`;
      const zone = h("section", {
        class: "issue__block issue__files",
        ondragover: (e) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); zone.classList.add("is-drop"); } },
        ondragleave: () => zone.classList.remove("is-drop"),
        ondrop: (e) => {
          if (!e.dataTransfer?.files.length) return;
          e.preventDefault();
          zone.classList.remove("is-drop");
          pick(e.dataTransfer.files);
        },
      },
      h("div", { class: "issue__block-head" },
        h("h3", { class: "issue__label", text: "Файлы" }),
        h("button", { class: "link-btn issue__edit", type: "button", onclick: () => picker.click() }, "Прикрепить")),
      picker,
      issue.files.length
        ? h("ul", { class: "files-grid" }, issue.files.map((f) => h("li", { class: "file-tile" },
          h("a", { href: url(f), target: "_blank", rel: "noopener", class: "file-tile__open" },
            f.type.startsWith("image/") ? h("img", { src: url(f), alt: "", loading: "lazy" }) : h("span", { class: "file__icon", text: (f.name.split(".").pop() || "файл").slice(0, 4) })),
          h("div", { class: "file-tile__meta" },
            h("a", { href: url(f), target: "_blank", rel: "noopener", class: "file-tile__name", text: f.name, title: f.name }),
            h("small", { class: "muted", text: `${fileSize(f.size)} · ${nameOf(f.by)}` })),
          tool("Удалить файл", "trash", () => { if (confirm(`Удалить файл «${f.name}»?`)) call("DELETE", url(f), undefined, "Файл удалён"); }, true))))
        : h("p", { class: "empty empty--small", text: "Перетащите файлы сюда или вставьте скриншот в описание." }));
      return zone;
    }

    function activityBlock() {
      const tabs = [["comments", `Комментарии${issue.comments.length ? ` · ${issue.comments.length}` : ""}`], ["history", "История"], ["time", `Время${issue.worklogs.length ? ` · ${hrs(issue.spent)}` : ""}`]];
      return h("section", { class: "issue__block" },
        h("div", { class: "seg", role: "tablist" }, tabs.map(([key, label]) => h("button", {
          class: `seg__btn${ui.tab === key ? " is-on" : ""}`, type: "button", role: "tab", "aria-selected": String(ui.tab === key),
          onclick: () => { ui.tab = key; draw(); }, text: label,
        }))),
        ui.tab === "comments" ? commentsBlock() : ui.tab === "history" ? historyBlock() : timeBlock());
    }

    function commentsBlock() {
      const area = h("textarea", { class: "textarea textarea--short", maxlength: "5000", placeholder: "Комментарий. @логин позовёт коллегу, Ctrl+Enter отправляет" });
      area.value = ui.comment;
      area.addEventListener("input", () => { ui.comment = area.value; });
      const send = btn("Отправить", { small: true, type: "submit" });
      const submit = async () => {
        if (!ui.comment.trim()) return area.focus();
        send.disabled = true;
        if (await call("POST", `/api/work/issues/${issue.id}/comments`, { text: ui.comment })) ui.comment = "";
        draw();
      };
      area.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); } });
      const list = [...issue.comments].reverse();
      return h("div", { class: "comments" },
        h("form", { class: "comments__form", onsubmit: (e) => { e.preventDefault(); submit(); } }, avatar(me().id, { size: 30 }), h("div", { class: "comments__input" }, mentionAssist(area, people), h("div", { class: "actions" }, send))),
        list.map((c) => {
          const own = c.authorId === me().id;
          if (ui.editComment === c.id) {
            const edit = h("textarea", { class: "textarea textarea--short", maxlength: "5000" });
            edit.value = ui.commentEdit;
            edit.addEventListener("input", () => { ui.commentEdit = edit.value; });
            setTimeout(() => edit.focus());
            return h("div", { class: "comment" }, avatar(c.authorId, { size: 30 }), h("div", { class: "comment__body" },
              edit,
              h("div", { class: "actions" },
                btn("Сохранить", { small: true, onclick: async () => { if (await call("PATCH", `/api/work/issues/${issue.id}/comments/${c.id}`, { text: ui.commentEdit })) { ui.editComment = null; draw(); } } }),
                btn("Отмена", { small: true, variant: "light", onclick: () => { ui.editComment = null; draw(); } }))));
          }
          return h("div", { class: "comment" }, avatar(c.authorId, { size: 30 }), h("div", { class: "comment__body" },
            h("p", { class: "comment__meta" }, h("b", { text: nameOf(c.authorId) }), h("span", { class: "mono", text: `${ago(c.at)}${c.editedAt ? " · изменён" : ""}` }),
              own ? h("button", { class: "link-btn comment__act", type: "button", text: "изменить", onclick: () => { ui.editComment = c.id; ui.commentEdit = c.text; draw(); } }) : null,
              own || me().role === "admin" ? h("button", { class: "link-btn comment__act", type: "button", text: "удалить", onclick: () => { if (confirm("Удалить комментарий?")) call("DELETE", `/api/work/issues/${issue.id}/comments/${c.id}`, undefined, "Комментарий удалён"); } }) : null),
            markdown(c.text, { cls: "md--compact" })));
        }));
    }

    function historyBlock() {
      if (!issue.history.length) return h("p", { class: "empty empty--small", text: `Задача создана ${ago(issue.createdAt)}, автор: ${nameOf(issue.reporterId)}. Изменений пока не было.` });
      return h("ul", { class: "history" },
        issue.history.map((x) => h("li", { class: "history__row" }, avatar(x.by, { size: 22 }), h("div", {},
          h("p", {}, h("b", { text: nameOf(x.by) }), " · ", describeChange(data, x)),
          h("span", { class: "mono", text: ago(x.at) })))),
        h("li", { class: "history__row" }, avatar(issue.reporterId, { size: 22 }), h("div", {}, h("p", {}, h("b", { text: nameOf(issue.reporterId) }), " · задача создана"), h("span", { class: "mono", text: ago(issue.createdAt) }))));
    }

    function timeBlock() {
      const hoursInput = h("input", { class: "input input--sm", type: "number", min: "0.25", max: "24", step: "0.25", placeholder: "Часы", value: ui.logHours, required: true, oninput: (e) => { ui.logHours = e.target.value; } });
      const date = h("input", { class: "input input--sm", type: "date", value: ui.logDate, max: today(), oninput: (e) => { ui.logDate = e.target.value; } });
      const note = h("input", { class: "input input--sm", maxlength: "300", placeholder: "Что сделано", value: ui.logNote, oninput: (e) => { ui.logNote = e.target.value; } });
      const est = issue.estimate || 0;
      const pct = est ? Math.min(100, Math.round((issue.spent / est) * 100)) : 0;
      return h("div", { class: "time" },
        h("div", { class: "time__sum" },
          h("p", {}, h("b", { text: hrs(issue.spent) }), est ? ` из ${hrs(est)} по оценке` : " затрачено, оценки нет"),
          est ? h("div", { class: `bar bar--thin${issue.spent > est ? " bar--over" : ""}` }, h("i", { vars: { "--p": `${pct}%` } })) : null),
        h("form", {
          class: "time__form",
          onsubmit: async (e) => {
            e.preventDefault();
            if (await call("POST", `/api/work/issues/${issue.id}/worklogs`, { hours: Number(ui.logHours), date: ui.logDate, note: ui.logNote }, "Время записано")) {
              ui.logHours = "";
              ui.logNote = "";
              draw();
            }
          },
        }, hoursInput, date, note, btn("Записать", { small: true, type: "submit" })),
        issue.worklogs.length
          ? h("ul", { class: "worklogs" }, issue.worklogs.map((w) => h("li", { class: "worklogs__row" },
            avatar(w.userId, { size: 22 }),
            h("div", { class: "worklogs__main" }, h("b", { text: hrs(w.hours) }), h("span", { class: "muted", text: ` ${nameOf(w.userId)} · ${fmtDate(w.date)}` }), w.note ? h("p", { text: w.note }) : null),
            w.userId === me().id || me().role === "admin" ? tool("Удалить запись", "close", () => call("DELETE", `/api/work/issues/${issue.id}/worklogs/${w.id}`, undefined, "Запись удалена"), true) : null)))
          : null);
    }

    function fieldsBlock() {
      const field = (label, ...control) => h("div", { class: "side-field" }, h("span", { class: "side-field__label", text: label }), h("div", { class: "side-field__control" }, ...control));
      const members = data.members.map((id) => [id, nameOf(id)]).sort((a, b) => a[1].localeCompare(b[1], "ru"));
      if (issue.assigneeId && !data.members.includes(issue.assigneeId)) members.push([issue.assigneeId, `${nameOf(issue.assigneeId)} (нет доступа)`]);
      const sprints = data.sprints.filter((s) => s.state !== "closed" || s.id === issue.sprintId);
      const epics = epicsOf(data).filter((e) => e.id !== issue.id);
      const status = select(`status-select is-${issue.status}`, STATUSES, issue.status, (v) => save({ status: v }, `Статус: ${STATUS[v]}`));
      const numberField = (key, attrs) => {
        const input = h("input", { class: "input input--sm", type: "number", ...attrs, value: issue[key] ?? "" });
        input.addEventListener("change", () => {
          const v = input.value === "" ? null : Number(input.value);
          if (v !== issue[key]) save({ [key]: v }, "Сохранено");
        });
        return input;
      };
      const dateField = (key) => h("input", { class: "input input--sm", type: "date", value: issue[key], onchange: (e) => save({ [key]: e.target.value }, "Сохранено") });
      return h("div", { class: "side" },
        field("Статус", status),
        field("Исполнитель",
          h("div", { class: "assignee" }, avatar(issue.assigneeId, { size: 26 }),
            select("", [["", "Не назначен"], ...members], issue.assigneeId, (v) => save({ assigneeId: v }, v ? `Исполнитель: ${nameOf(v)}` : "Исполнитель снят"))),
          issue.assigneeId !== me().id && data.members.includes(me().id)
            ? h("button", { class: "link-btn side-field__hint", type: "button", text: "Назначить меня", onclick: () => save({ assigneeId: me().id }, "Задача ваша") })
            : null),
        field("Приоритет", h("div", { class: "assignee" }, priorityIcon(issue.priority), select("", PRIORITIES, issue.priority, (v) => save({ priority: v }, `Приоритет: ${PRIORITY[v].toLowerCase()}`)))),
        issue.type !== "epic"
          ? field("Спринт", select("", [["", "Бэклог"], ...sprints.map((s) => [s.id, `${s.name}${s.state === "active" ? " · идёт" : ""}`])], issue.sprintId, (v) => save({ sprintId: v }, v ? `В спринте «${sprintName(data, v)}»` : "В бэклоге")))
          : null,
        issue.type !== "epic"
          ? field("Эпик", select("", [["", "Без эпика"], ...epics.map((e) => [e.id, `${e.key} ${e.title}`])], issue.epicId, (v) => save({ epicId: v }, "Эпик изменён")))
          : null,
        field("Метки", labelsEditor()),
        field("Оценка, часов", numberField("estimate", { min: "0", max: "10000", step: "0.25", placeholder: "Нет" })),
        field("Затрачено", h("button", { class: "link-btn side-field__value", type: "button", onclick: () => { ui.tab = "time"; draw(); el.querySelector(".time__form input")?.focus(); } }, issue.spent ? hrs(issue.spent) : "Записать время")),
        h("div", { class: "side-dates" }, field("Начало", dateField("start")), field("Срок", dateField("due"))),
        isOverdue(issue) ? h("p", { class: "side-warn", text: `Срок прошёл ${fmtDate(issue.due)}` }) : null,
        h("dl", { class: "side-meta" },
          h("div", {}, h("dt", { text: "Автор" }), h("dd", { text: nameOf(issue.reporterId) })),
          h("div", {}, h("dt", { text: "Создана" }), h("dd", { text: ago(issue.createdAt) })),
          h("div", {}, h("dt", { text: "Обновлена" }), h("dd", { text: ago(issue.updatedAt) })),
          issue.doneAt ? h("div", {}, h("dt", { text: "Готова" }), h("dd", { text: ago(issue.doneAt) })) : null));
    }

    function labelsEditor() {
      const id = `labels-${issue.id}`;
      const input = h("input", { class: "input input--sm labels__input", maxlength: "40", list: id, placeholder: "+ метка" });
      const add = () => {
        const v = input.value.trim();
        if (v && !issue.labels.includes(v)) save({ labels: [...issue.labels, v] });
        input.value = "";
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
      input.addEventListener("change", () => { if (labelsOf(data).includes(input.value.trim())) add(); });
      return h("div", { class: "labels" },
        issue.labels.map((l) => h("span", { class: "label-chip" }, l, h("button", { type: "button", class: "label-chip__x", "aria-label": `Убрать метку ${l}`, text: "×", onclick: () => save({ labels: issue.labels.filter((x) => x !== l) }) }))),
        input,
        h("datalist", { id }, labelsOf(data).filter((l) => !issue.labels.includes(l)).map((l) => h("option", { value: l }))));
    }

    load();
    const dirty = () => (ui.editDesc && ui.desc !== issue?.description) || Boolean(ui.comment.trim());
    return {
      el,
      get id() { return issueId; },
      dirty,
      refresh: () => { if (!ui.editDesc && ui.editComment === null && !el.contains(document.activeElement)) load(); },
      canClose: () => !dirty() || confirm("Есть несохранённый текст. Закрыть без сохранения?"),
    };
  }

  // «изменил статус: К работе → В работе»
  function describeChange(data, x) {
    const fmt = (v) => {
      if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return "нет";
      switch (x.field) {
        case "status": return STATUS[v] || v;
        case "type": return TYPES[v] || v;
        case "priority": return PRIORITY[v] || v;
        case "assigneeId": return nameOf(v);
        case "sprintId": return data ? sprintName(data, v) : "спринт";
        case "epicId": {
          const e = data?.issues.find((i) => i.id === v);
          return e ? e.title : "эпик";
        }
        case "estimate": return hrs(v);
        case "due": case "start": return fmtDate(v);
        case "labels": return v.join(", ");
        default: return String(v);
      }
    };
    if (x.field === "description") return "описание изменено";
    if (x.field === "sprintId" && x.from === "" && x.to) return h("span", {}, "в спринт ", h("b", { text: fmt(x.to) }));
    return h("span", {}, `${(FIELD_LABELS[x.field] || x.field).toLowerCase()}: `, h("s", { class: "muted", text: fmt(x.from) }), " → ", h("b", { text: fmt(x.to) }));
  }

  function miniIssue(i, onclick, extra = null) {
    return h("li", {},
      h("button", { class: `mini-issue${i.status === "done" ? " is-done" : ""}`, type: "button", onclick },
        typeIcon(i.type),
        h("span", { class: "mini-issue__key mono", text: i.key }),
        h("span", { class: "mini-issue__title", text: i.title }),
        extra,
        priorityIcon(i.priority),
        statusPill(i.status),
        avatar(i.assigneeId, { size: 22 })));
  }

  /* ---------- Новая задача ---------- */
  async function createIssue({ space = null, projectId = "", status = "todo", sprintId = null, epicId = "", type = "task", onCreated = () => {} } = {}) {
    let data = space;
    let projects = [];
    if (!data) {
      const res = await api("GET", "/api/work/projects");
      rememberTeam(res.team);
      projects = res.projects;
      if (!projects.length) return toast("Нет проектов, где вы в команде");
      data = await loadSpace(projectId || projects[0].id);
    }
    const form = h("form", { class: "form create-issue" });
    const error = h("p", { class: "form__error", hidden: true });
    const more = h("input", { type: "checkbox" });
    const submit = btn("Создать", { type: "submit" });
    let ui = null;
    const active = () => data.sprints.find((s) => s.state === "active");
    let state = { type, title: "", description: "", status, priority: "medium", assigneeId: "", estimate: "", due: "", epicId, labels: "", sprintId: sprintId ?? (active()?.id || "") };

    function fill() {
      const p = data.project;
      const title = h("input", { class: "input", maxlength: "300", required: true, placeholder: "Коротко: что нужно сделать", value: state.title, oninput: (e) => { state.title = e.target.value; } });
      const desc = h("textarea", { class: "textarea", maxlength: "50000", placeholder: "Подробности в Markdown: шаги, критерии готовности, ссылки", oninput: (e) => { state.desc = e.target.value; } });
      desc.value = state.desc || "";
      const members = data.members.map((id) => [id, nameOf(id)]).sort((a, b) => a[1].localeCompare(b[1], "ru"));
      const sprints = data.sprints.filter((s) => s.state !== "closed");
      const set = (key) => (v) => { state[key] = v; if (key === "type") fill(); };
      form.replaceChildren(
        projects.length > 1
          ? h("label", { class: "field" }, h("span", { text: "Проект" }), select("", projects.map((x) => [x.id, `${x.key} · ${x.title}`]), p.id, async (v) => {
            data = await loadSpace(v);
            state = { ...state, assigneeId: "", epicId: "", sprintId: active()?.id || "" };
            fill();
          }))
          : h("p", { class: "mono", text: `${p.key} · ${p.title}` }),
        h("div", { class: "create-issue__row" },
          h("label", { class: "field" }, h("span", { text: "Тип" }), select("", Object.entries(TYPES), state.type, set("type"))),
          h("label", { class: "field" }, h("span", { text: "Приоритет" }), select("", PRIORITIES, state.priority, set("priority"))),
          h("label", { class: "field" }, h("span", { text: "Статус" }), select("", STATUSES, state.status, set("status")))),
        h("label", { class: "field" }, h("span", { text: "Название" }), title),
        h("label", { class: "field" }, h("span", { text: "Описание" }), desc),
        h("div", { class: "create-issue__row" },
          h("label", { class: "field" }, h("span", { text: "Исполнитель" }), select("", [["", "Не назначен"], ...members], state.assigneeId, set("assigneeId"))),
          h("label", { class: "field" }, h("span", { text: "Оценка, часов" }), h("input", { class: "input input--sm", type: "number", min: "0", step: "0.25", value: state.estimate, oninput: (e) => { state.estimate = e.target.value; } })),
          h("label", { class: "field" }, h("span", { text: "Срок" }), h("input", { class: "input input--sm", type: "date", value: state.due, oninput: (e) => { state.due = e.target.value; } }))),
        state.type !== "epic"
          ? h("div", { class: "create-issue__row create-issue__row--2" },
            h("label", { class: "field" }, h("span", { text: "Спринт" }), select("", [["", "Бэклог"], ...sprints.map((s) => [s.id, `${s.name}${s.state === "active" ? " · идёт" : ""}`])], state.sprintId, set("sprintId"))),
            h("label", { class: "field" }, h("span", { text: "Эпик" }), select("", [["", "Без эпика"], ...epicsOf(data).map((e) => [e.id, `${e.key} ${e.title}`])], state.epicId, set("epicId"))))
          : null,
        h("label", { class: "field" }, h("span", { text: "Метки через запятую" }), h("input", { class: "input input--sm", maxlength: "200", value: state.labels, placeholder: "front, api, дизайн", oninput: (e) => { state.labels = e.target.value; } })),
        error,
        h("div", { class: "actions create-issue__foot" }, submit, h("label", { class: "check" }, more, "Создать ещё одну")));
      setTimeout(() => title.focus());
    }
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      try {
        const body = {
          type: state.type, title: state.title, description: state.desc || "", status: state.status, priority: state.priority,
          assigneeId: state.assigneeId, estimate: state.estimate === "" ? null : Number(state.estimate), due: state.due,
          labels: state.labels.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10),
          ...(state.type !== "epic" ? { epicId: state.epicId, sprintId: state.sprintId } : {}),
        };
        const { issue } = await api("POST", `/api/work/projects/${data.project.id}/issues`, body);
        mergeIssue(data, issue);
        toast(`Создана ${issue.key}`);
        onCreated(issue);
        if (more.checked) {
          state = { ...state, title: "", desc: "" };
          fill();
        } else {
          ui.close(true);
        }
      } catch (err) {
        error.textContent = errorText(err);
        error.hidden = false;
      } finally {
        submit.disabled = false;
      }
    });
    fill();
    ui = dialog("Новая задача", form, { wide: true });
  }

  /* ---------- Быстрый поиск (Ctrl+K) ---------- */
  function openSearch() {
    if (document.querySelector(".search-box")) return;
    const input = h("input", { class: "input search-box__input", type: "search", placeholder: "Ключ задачи, название, страница вики или доска", "aria-label": "Поиск" });
    const results = h("div", { class: "search-box__results" }, h("p", { class: "empty empty--small", text: "Например: D2OP-12, «лобби», «ТЗ»." }));
    let items = [];
    let cursor = 0;
    let timer;
    let ui;
    const go = (href) => { ui.close(true); navigate(href); };
    function paint() {
      for (const [k, el] of items.entries()) el.classList.toggle("is-active", k === cursor);
      items[cursor]?.scrollIntoView({ block: "nearest" });
    }
    async function run() {
      const q = input.value.trim();
      if (!q) return;
      try {
        const res = await api("GET", `/api/work/search?q=${encodeURIComponent(q)}`);
        if (q !== input.value.trim()) return;
        items = [];
        const row = (href, ...content) => {
          const el = h("button", { class: "search-row", type: "button", onclick: () => go(href), onmousemove: () => { cursor = items.indexOf(el); paint(); } }, ...content);
          items.push(el);
          return el;
        };
        const group = (title, list) => (list.length ? [h("p", { class: "search-box__group mono", text: title }), ...list] : []);
        results.replaceChildren(...[
          ...group("Задачи", res.issues.map((i) => row(`/work/i/${i.key}`, typeIcon(i.type), h("span", { class: "mono", text: i.key }), h("span", { class: "search-row__title", text: i.title }), statusPill(i.status)))),
          ...group("Вики", res.pages.map((pg) => row(`/work/p/${pg.projectId}/wiki/${pg.id}`, ico("page"), h("span", { class: "search-row__title", text: pg.title }), h("span", { class: "muted search-row__sub", text: pg.snippet || pg.projectTitle })))),
          ...group("Доски", res.boards.map((b) => row(`/work/b/${b.id}`, ico("board"), h("span", { class: "search-row__title", text: b.title }), h("span", { class: "muted search-row__sub", text: b.projectTitle || "Общая доска" })))),
        ]);
        if (!items.length) results.replaceChildren(h("p", { class: "empty empty--small", text: "Ничего не нашли." }));
        cursor = 0;
        paint();
      } catch (err) {
        results.replaceChildren(h("p", { class: "empty empty--small", text: errorText(err) }));
      }
    }
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 160); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); cursor = Math.min(items.length - 1, cursor + 1); paint(); }
      if (e.key === "ArrowUp") { e.preventDefault(); cursor = Math.max(0, cursor - 1); paint(); }
      if (e.key === "Enter") {
        e.preventDefault();
        const q = input.value.trim();
        if (items[cursor]) items[cursor].click();
        else if (/^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/.test(q)) go(`/work/i/${q.toUpperCase()}`);
      }
    });
    ui = overlay(h("div", { class: "search-box" }, h("div", { class: "search-box__field" }, ico("search"), input), results), { kind: "modal" });
    ui.box.classList.add("modal--search");
    setTimeout(() => input.focus());
  }

  /* ---------- Моя работа ---------- */
  async function viewWorkHome(alive) {
    loading();
    const [data, boardsRes] = await Promise.all([api("GET", "/api/work/me"), api("GET", "/api/work/boards?project=")]);
    if (!alive()) return;
    rememberTeam(data.team);
    for (const p of data.projects) knownKeys.add(p.key);
    hotkeys({ create: () => createIssue({ onCreated: () => render() }) });
    const render = () => navigate("/work", { replace: true });
    const byProject = new Map(data.projects.map((p) => [p.id, p]));

    const order = ["progress", "review", "test", "todo", "done"];
    const groups = order.map((s) => [s, data.assigned.filter((i) => i.status === s)
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.due || "9999").localeCompare(b.due || "9999"))]).filter(([, list]) => list.length);
    const row = (i) => h("li", {},
      h("button", { class: `my-issue${i.status === "done" ? " is-done" : ""}`, type: "button", onclick: () => openIssue(i.id, { onChange: () => {} }) },
        typeIcon(i.type),
        h("span", { class: "my-issue__key mono", text: i.key }),
        h("span", { class: "my-issue__title" }, i.title, h("small", { class: "muted", text: i.projectTitle })),
        i.due ? h("span", { class: `my-issue__due mono${isOverdue(i) ? " is-late" : ""}`, text: fmtDate(i.due) }) : null,
        priorityIcon(i.priority),
        statusPill(i.status)));

    // Часы за текущую неделю, с понедельника.
    const monday = addDays(today(), -((new Date().getDay() + 6) % 7));
    const week = Array.from({ length: 7 }, (_, k) => addDays(monday, k));
    const perDay = week.map((d) => data.worklogs.filter((w) => w.date === d).reduce((n, w) => n + w.hours, 0));
    const weekTotal = perDay.reduce((n, x) => n + x, 0);
    const maxDay = Math.max(8, ...perDay);
    const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

    const fresh = data.feed.filter((x) => x.at > data.seenAt).length;
    const feedItem = (x) => h("li", { class: `feed-item${x.at > data.seenAt ? " is-new" : ""}` },
      h("p", { class: "feed-item__what" },
        h("b", { text: x.by }), " ",
        x.kind === "comment" ? "· комментарий" : x.kind === "mention" ? h("span", { class: "accent", text: "· упоминание" }) : x.kind === "created" ? "· новая задача для вас" : ["· ", describeChange(null, x)]),
      h("button", { class: "feed-item__issue", type: "button", onclick: () => openIssue(x.issue.id) }, typeIcon(x.issue.type), h("span", { class: "mono", text: x.issue.key }), h("span", { text: x.issue.title })),
      x.kind === "comment" || x.kind === "mention" ? h("p", { class: "feed-item__quote", text: x.text }) : null,
      h("span", { class: "mono", text: ago(x.at) }));

    const spaceCard = (p) => link(`/work/p/${p.id}/board`, { class: "card space-card" },
      h("div", { class: "space-card__top" },
        p.logo ? h("img", { class: "space-card__logo", src: I.logoSrc(p), alt: "" }) : h("span", { class: "space-head__key space-head__key--sm", text: p.key.slice(0, 2) }),
        h("span", { class: "mono", text: p.key })),
      h("h3", { class: "space-card__title", text: p.title }),
      h("p", { class: "space-card__meta" },
        h("span", { text: `${p.open} ${plural(p.open, "открытая", "открытые", "открытых")}` }),
        p.mine ? h("span", { class: "accent", text: `ваших ${p.mine}` }) : null),
      h("p", { class: "mono", text: p.sprint ? `${p.sprint.name}${p.sprint.end ? ` · до ${fmtDate(p.sprint.end)}` : ""}` : "Канбан без спринта" }));

    const generalBoards = boardsRes.boards;
    I.root.replaceChildren(...(() => {
      const nodes = shell(
        h("div", { class: "project-head" },
          h("div", {}, h("span", { class: "eyebrow mono", text: "Работа команды" }), h("h1", { class: "h1", text: "Моя работа" })),
          h("div", { class: "actions" },
            btn("Поиск", { variant: "light", title: "Ctrl+K", onclick: openSearch }),
            btn("Создать задачу", { title: "Клавиша C", onclick: () => createIssue({ onCreated: () => render() }) }))),
        h("div", { class: "work-home" },
          h("div", { class: "work-home__main" },
            h("section", {},
              h("div", { class: "section-head" }, h("h2", { class: "h2", text: "Назначено мне" }), h("span", { class: "mono", text: String(data.assigned.filter((i) => i.status !== "done").length) })),
              groups.length
                ? groups.map(([s, list]) => h("div", { class: "my-group" },
                  h("p", { class: "my-group__title mono" }, STATUS[s], s === "done" ? " за неделю" : "", ` · ${list.length}`),
                  h("ul", { class: "my-issues" }, list.map(row))))
                : h("p", { class: "empty", text: "На вас сейчас ничего не назначено. Возьмите задачу на доске проекта." })),
            data.reported.length
              ? h("section", { class: "mt-40" },
                h("div", { class: "section-head" }, h("h2", { class: "h2", text: "Поставлено мной" }), h("span", { class: "mono", text: String(data.reported.length) })),
                h("ul", { class: "my-issues" }, data.reported.slice(0, 15).map(row)))
              : null,
            h("section", { class: "mt-40" },
              h("div", { class: "section-head" }, h("h2", { class: "h2", text: "Проекты" }), h("span", { class: "mono", text: String(data.projects.length) })),
              data.projects.length
                ? h("div", { class: "space-cards" }, data.projects.map(spaceCard))
                : h("p", { class: "empty", text: "Вас пока не добавили ни в один проект. Попросите администратора открыть доступ." }))),
          h("aside", { class: "work-home__side" },
            h("section", { class: "card card--soft" },
              h("div", { class: "section-head" }, h("h2", { class: "h3", text: "Время за неделю" }), h("span", { class: "mono", text: hrs(weekTotal) })),
              h("div", { class: "week" }, week.map((d, k) => h("div", { class: `week__day${d === today() ? " is-today" : ""}`, title: `${fmtDate(d)}: ${hrs(perDay[k])}` },
                h("div", { class: "week__bar" }, h("i", { vars: { "--p": `${Math.round((perDay[k] / maxDay) * 100)}%` } })),
                h("span", { class: "mono", text: DAYS[k] })))),
              h("p", { class: "muted week__hint", text: "Время пишется в карточке задачи, во вкладке «Время»." })),
            h("section", {},
              h("div", { class: "section-head" }, h("h2", { class: "h3", text: "Что изменилось" }), h("span", { class: `mono${fresh ? " accent" : ""}`, text: fresh ? `новое: ${fresh}` : "2 недели" })),
              data.feed.length ? h("ul", { class: "feed-list" }, data.feed.slice(0, 20).map(feedItem)) : h("p", { class: "empty empty--small", text: "По вашим задачам тихо: здесь появятся комментарии и изменения от коллег." })),
            data.recent.length
              ? h("section", {},
                h("div", { class: "section-head" }, h("h2", { class: "h3", text: "Недавние страницы и доски" })),
                h("ul", { class: "recent" }, data.recent.map((x) => h("li", {}, link(x.kind === "page" ? `/work/p/${x.projectId}/wiki/${x.id}` : `/work/b/${x.id}`, { class: "recent__row" },
                  ico(x.kind === "page" ? "page" : "board"),
                  h("span", { class: "recent__title" }, x.title, h("small", { class: "muted", text: `${x.projectId ? byProject.get(x.projectId)?.title || "" : "Общая доска"} · ${ago(x.at)}` })))))))
              : null,
            h("section", {},
              h("div", { class: "section-head" }, h("h2", { class: "h3", text: "Общие доски" }), h("button", { class: "link-btn accent", type: "button", text: "+ Доска", onclick: () => I.work.newBoard("") })),
              generalBoards.length
                ? h("ul", { class: "recent" }, generalBoards.map((b) => h("li", {}, link(`/work/b/${b.id}`, { class: "recent__row" }, ico("board"), h("span", { class: "recent__title" }, b.title, h("small", { class: "muted", text: `${b.updatedBy} · ${ago(b.updatedAt)}` }))))))
                : h("p", { class: "empty empty--small", text: "Доски без проекта видит вся команда: планёрки, процессы, идеи." })))));
      widen(nodes);
      return nodes;
    })());
    // Ленту посмотрели: счётчик на вкладке «Работа» обнуляется, новые записи подсвечены до следующего захода.
    if (fresh) api("POST", "/api/work/seen").then(() => I.setNavBadge("/work", 0)).catch(() => {});
    else I.setNavBadge("/work", 0);
  }

  // Раз в минуту спрашиваем, есть ли новое по моим задачам, и рисуем число на вкладке «Работа».
  async function pollUnread() {
    const user = me();
    if (!user || !I.TEAM_ROLES.includes(user.role) || document.hidden || location.pathname === "/work") return;
    try {
      I.setNavBadge("/work", (await api("GET", "/api/work/unread")).count);
    } catch {}
  }
  setTimeout(pollUnread, 1500);
  setInterval(pollUnread, 60000);
  document.addEventListener("visibilitychange", pollUnread);

  /* ---------- Доска (канбан) ---------- */
  async function viewBoard(alive, id) {
    loading();
    let data = await loadSpace(id);
    if (!alive()) return;
    const f = filtersFor(id);
    let dragging = null;     // перетаскиваемая задача
    let pending = false;     // пришли чужие изменения во время перетаскивания
    let viewers = [];
    const reload = async () => {
      if (dragging) { pending = true; return; }
      try {
        data = await loadSpace(id);
        if (alive()) draw();
        openPanel?.refresh();
      } catch {}
    };
    let reloadTimer;
    live(`/api/work/projects/${id}/events?client=${CLIENT}`, {
      issues: (ev) => { if (ev.client !== CLIENT) { clearTimeout(reloadTimer); reloadTimer = setTimeout(reload, 300); } },
      presence: (ev) => { viewers = ev.members; drawPresence(); },
    }, { onResync: reload });
    const presenceBox = h("div", { class: "presence-slot" });
    const drawPresence = () => presenceBox.replaceChildren(presence(viewers) || "");

    const active = () => data.sprints.find((s) => s.state === "active");
    // Со спринтом — его задачи. Без спринта — канбан: всё вне спринтов, готовое старше двух недель уходит с доски.
    function scope() {
      const s = active();
      const cutoff = new Date(Date.now() - 14 * DAY).toISOString();
      return data.issues.filter((i) => i.type !== "epic" && (s ? i.sprintId === s.id : !i.sprintId && !(i.status === "done" && (i.doneAt || i.updatedAt) < cutoff)));
    }
    const onChange = (issue, removed) => { mergeIssue(data, issue, removed); draw(); };

    async function move(issue, fields, place) {
      const before = { ...issue };
      Object.assign(issue, fields);
      if (place) { // ставим локально сразу, сервер пришлёт точный ранг
        const ref = data.issues.find((x) => x.id === (place.before || place.after));
        if (ref) issue.rank = ref.rank + (place.before ? -0.0001 : 0.0001);
        data.issues.sort((a, b) => a.rank - b.rank);
      }
      draw();
      try {
        const res = await api("PATCH", `/api/work/issues/${issue.id}`, { ...fields, ...(place ? { place } : {}) });
        mergeIssue(data, res.issue);
        draw();
        if (fields.status && fields.status !== before.status) toast(`${issue.key}: ${STATUS[fields.status]}`);
      } catch (err) {
        Object.assign(issue, before);
        data.issues.sort((a, b) => a.rank - b.rank);
        draw();
        toast(errorText(err));
      }
    }

    function card(i) {
      const el = h("article", {
        class: `kcard${i.status === "done" ? " is-done" : ""}`, draggable: "true", tabindex: "0", "data-id": i.id,
        onclick: () => openIssue(i.id, { space: data, onChange, onLinks: reload }),
        onkeydown: (e) => { if (e.key === "Enter") openIssue(i.id, { space: data, onChange, onLinks: reload }); },
        ondragstart: (e) => {
          dragging = i;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", i.key);
          requestAnimationFrame(() => el.classList.add("is-dragging"));
          document.body.classList.add("is-dragging-card");
        },
        ondragend: () => {
          dragging = null;
          document.body.classList.remove("is-dragging-card");
          el.classList.remove("is-dragging");
          for (const x of document.querySelectorAll(".kdrop")) x.remove();
          if (pending) { pending = false; reload(); }
        },
      },
      h("p", { class: "kcard__title", text: i.title }),
      (i.labels.length || i.epicId) ? h("div", { class: "kcard__tags" }, epicChip(data, i.epicId), i.labels.slice(0, 3).map((l) => h("span", { class: "label-chip label-chip--sm", text: l }))) : null,
      h("div", { class: "kcard__foot" },
        typeIcon(i.type),
        h("span", { class: "kcard__key mono", text: i.key }),
        priorityIcon(i.priority),
        i.due ? h("span", { class: `kcard__due mono${isOverdue(i) ? " is-late" : ""}`, title: "Срок", text: fmtDate(i.due) }) : null,
        i.blocked ? h("span", { class: "kcard__blocked", title: "Заблокирована другой задачей" }, ico("block")) : null,
        i.checks.total ? h("span", { class: `kcard__meta mono${i.checks.done === i.checks.total ? " is-ok" : ""}`, title: "Чек-лист" }, ico("check"), `${i.checks.done}/${i.checks.total}`) : null,
        i.comments ? h("span", { class: "kcard__meta mono", title: "Комментарии" }, ico("comment"), String(i.comments)) : null,
        i.estimate ? h("span", { class: "kcard__est mono", title: `Оценка ${hrs(i.estimate)}${i.spent ? `, затрачено ${hrs(i.spent)}` : ""}`, text: `${String(i.estimate).replace(".", ",")}ч` }) : null,
        avatar(i.assigneeId, { size: 24 })));
      return el;
    }

    // Колонка (или клетка дорожки): принимает карточку, место показывает линия.
    function cell(status, list, lane) {
      const body = h("div", { class: "kcol__cards" }, list.map(card));
      const dropAt = (e) => {
        const cards = [...body.querySelectorAll(".kcard:not(.is-dragging)")];
        const next = cards.find((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
        return { next, cards };
      };
      const el = h("div", {
        class: "kcell",
        ondragover(e) {
          if (!dragging) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const { next } = dropAt(e);
          let marker = document.querySelector(".kdrop");
          if (!marker) marker = h("div", { class: "kdrop" });
          if (next) body.insertBefore(marker, next);
          else body.append(marker);
        },
        ondragleave(e) { if (!el.contains(e.relatedTarget)) document.querySelector(".kdrop")?.remove(); },
        ondrop(e) {
          e.preventDefault();
          const issue = dragging;
          if (!issue) return;
          const { next, cards } = dropAt(e);
          document.querySelector(".kdrop")?.remove();
          const fields = {};
          if (issue.status !== status) fields.status = status;
          if (lane && lane.field && issue[lane.field] !== lane.value) fields[lane.field] = lane.value;
          const nextId = next?.dataset.id;
          const lastId = cards[cards.length - 1]?.dataset.id;
          const place = nextId && nextId !== issue.id ? { before: nextId } : !nextId && lastId && lastId !== issue.id ? { after: lastId } : null;
          // Не сдвинули и ничего не поменяли — не дёргаем сервер.
          if (!Object.keys(fields).length) {
            const ids = list.map((x) => x.id);
            const k = ids.indexOf(issue.id);
            if (k >= 0 && ((nextId && ids[k + 1] === nextId) || (!nextId && k === ids.length - 1))) return;
          }
          move(issue, fields, place);
        },
      }, body);
      if (!lane) el.append(quickAdd(status));
      return el;
    }
    function quickAdd(status) {
      const box = h("div", { class: "kadd" });
      const closed = () => box.replaceChildren(h("button", { class: "kadd__btn", type: "button", onclick: opened }, ico("plus"), "Задача"));
      function opened() {
        const input = h("textarea", { class: "textarea kadd__input", rows: "2", maxlength: "300", placeholder: "Что нужно сделать? Enter создаёт" });
        input.addEventListener("keydown", async (e) => {
          if (e.key === "Escape") return closed();
          if (e.key !== "Enter" || e.shiftKey) return;
          e.preventDefault();
          const title = input.value.trim();
          if (!title) return;
          input.disabled = true;
          try {
            const s = active();
            const body = { title, status, ...(s ? { sprintId: s.id } : {}) };
            const { issue } = await api("POST", `/api/work/projects/${id}/issues`, body);
            mergeIssue(data, issue);
            draw();
            toast(`Создана ${issue.key}`);
            const again = document.querySelector(`.kcol[data-status="${status}"] .kadd__btn`);
            again?.click();
          } catch (err) {
            toast(errorText(err));
            input.disabled = false;
          }
        });
        input.addEventListener("blur", () => { if (!input.value.trim()) closed(); });
        box.replaceChildren(input);
        input.focus();
      }
      closed();
      return box;
    }

    function lanesOf(list) {
      if (f.lanes === "people") {
        const ids = [...new Set(list.map((i) => i.assigneeId))].sort((a, b) => (!a ? 1 : !b ? -1 : a === me().id ? -1 : b === me().id ? 1 : nameOf(a).localeCompare(nameOf(b), "ru")));
        return ids.map((v) => ({ key: v || "none", title: v ? nameOf(v) : "Без исполнителя", icon: avatar(v, { size: 22 }), field: "assigneeId", value: v, list: list.filter((i) => i.assigneeId === v) }));
      }
      if (f.lanes === "epic") {
        const ids = [...new Set(list.map((i) => i.epicId))].sort((a, b) => (!a ? 1 : !b ? -1 : 0));
        return ids.map((v) => {
          const e = data.issues.find((x) => x.id === v);
          return { key: v || "none", title: e ? `${e.key} ${e.title}` : "Без эпика", icon: typeIcon("epic"), field: "epicId", value: v, list: list.filter((i) => i.epicId === v) };
        });
      }
      if (f.lanes === "priority") {
        return PRIORITIES.map(([v, title]) => ({ key: v, title, icon: priorityIcon(v), field: "priority", value: v, list: list.filter((i) => i.priority === v) })).filter((l) => l.list.length);
      }
      return null;
    }

    function sprintBar() {
      const s = active();
      if (!s) {
        return h("div", { class: "sprint-bar" },
          h("div", {}, h("b", { text: "Канбан" }), h("span", { class: "muted", text: " · все задачи вне спринтов. Спринты планируются в бэклоге" })),
          presenceBox);
      }
      const left = s.end ? Math.ceil((Date.parse(s.end) - Date.parse(today())) / DAY) : null;
      const list = data.issues.filter((i) => i.sprintId === s.id);
      const done = list.filter((i) => i.status === "done").length;
      return h("div", { class: "sprint-bar" },
        h("div", { class: "sprint-bar__main" },
          h("b", { text: s.name }),
          h("span", { class: "mono", text: `${fmtDate(s.start)} – ${fmtDate(s.end)}` }),
          left !== null ? h("span", { class: `mono${left < 0 ? " accent" : ""}`, text: left < 0 ? `просрочен на ${-left} дн.` : left === 0 ? "последний день" : `осталось ${left} ${plural(left, "день", "дня", "дней")}` }) : null,
          h("span", { class: "mono", text: `готово ${done} из ${list.length}` }),
          s.goal ? h("p", { class: "sprint-bar__goal", text: `Цель: ${s.goal}` }) : null),
        h("div", { class: "actions" }, presenceBox, btn("Завершить спринт", { small: true, variant: "light", onclick: () => I.work.completeSprint(data, s, reload) })));
    }

    function draw() {
      keepSearchFocus(() => {
        const list = applyFilters(scope(), f);
        const lanes = lanesOf(list);
        const all = scope();
        const columns = STATUSES.map(([s, title]) => {
          const inCol = list.filter((i) => i.status === s);
          const est = inCol.reduce((n, i) => n + (i.estimate || 0), 0);
          const limit = data.project.wip[s];
          const total = all.filter((i) => i.status === s).length;
          const over = limit && total > limit;
          return h("div", { class: `kcol is-${s}${over ? " is-over" : ""}`, "data-status": s },
            h("div", { class: "kcol__head", title: limit ? `WIP-лимит колонки: ${limit}` : null },
              h("span", { class: `kcol__dot is-${s}` }), h("b", { text: title }),
              h("span", { class: "mono kcol__count", text: limit ? `${inCol.length}/${limit}` : String(inCol.length) }),
              over ? h("span", { class: "kcol__over mono", text: "лимит" }) : null,
              est ? h("span", { class: "mono kcol__est", text: hrs(est) }) : null),
            lanes ? null : cell(s, inCol, null));
        });
        let body;
        if (lanes) {
          body = h("div", { class: "kboard kboard--lanes" },
            h("div", { class: "kboard__cols" }, columns),
            lanes.map((lane) => h("section", { class: "klane" },
              h("div", { class: "klane__head" }, lane.icon, h("b", { text: lane.title }), h("span", { class: "mono", text: String(lane.list.length) })),
              h("div", { class: "kboard__cols" }, STATUSES.map(([s]) => cell(s, lane.list.filter((i) => i.status === s), lane))))));
        } else {
          body = h("div", { class: "kboard" }, h("div", { class: "kboard__cols" }, columns));
        }
        const total = all.length;
        I.root.replaceChildren(...spaceShell(data, "board", { onCreated: (issue) => { mergeIssue(data, issue); draw(); } },
          sprintBar(),
          filterBar(data, f, (o) => draw(o), { lanes: true }),
          total ? body : h("div", { class: "empty-state" },
            h("h2", { class: "h2", text: active() ? "В спринте пока пусто" : "Задач пока нет" }),
            h("p", { class: "lead", text: active() ? "Добавьте задачи в спринт в бэклоге." : "Создайте первую задачу: кнопка «Создать задачу» или клавиша C." }),
            h("div", { class: "actions mt-24" }, btn("Создать задачу", { onclick: () => createIssue({ space: data, onCreated: (issue) => { mergeIssue(data, issue); draw(); } }) }), active() ? btn("Открыть бэклог", { variant: "light", href: `/work/p/${id}/backlog` }) : null))));
        drawPresence();
      });
    }
    draw();
  }

  /* ---------- Бэклог и спринты ---------- */
  async function viewBacklog(alive, id) {
    loading();
    let data = await loadSpace(id);
    if (!alive()) return;
    const f = filtersFor(id);
    const collapsed = new Set();
    let dragging = null;
    let showDone = false;
    const reload = async () => {
      if (dragging) return;
      try {
        data = await loadSpace(id);
        if (alive()) draw();
      } catch {}
    };
    let timer;
    live(`/api/work/projects/${id}/events?client=${CLIENT}`, {
      issues: (ev) => { if (ev.client !== CLIENT) { clearTimeout(timer); timer = setTimeout(reload, 300); } },
    }, { onResync: reload });
    const onChange = (issue, removed) => { mergeIssue(data, issue, removed); draw(); };

    async function move(issue, sprintId, place) {
      const prev = { sprintId: issue.sprintId, rank: issue.rank };
      issue.sprintId = sprintId;
      if (place) {
        const ref = data.issues.find((x) => x.id === (place.before || place.after));
        if (ref) issue.rank = ref.rank + (place.before ? -0.0001 : 0.0001);
        data.issues.sort((a, b) => a.rank - b.rank);
      }
      draw();
      try {
        mergeIssue(data, (await api("PATCH", `/api/work/issues/${issue.id}`, { sprintId, ...(place ? { place } : {}) })).issue);
        draw();
      } catch (err) {
        Object.assign(issue, prev);
        data.issues.sort((a, b) => a.rank - b.rank);
        draw();
        toast(errorText(err));
      }
    }

    function row(i) {
      const el = h("li", {
        class: `brow${i.status === "done" ? " is-done" : ""}`, draggable: "true", "data-id": i.id, tabindex: "0",
        onclick: () => openIssue(i.id, { space: data, onChange, onLinks: reload }),
        onkeydown: (e) => { if (e.key === "Enter") openIssue(i.id, { space: data, onChange, onLinks: reload }); },
        ondragstart: (e) => {
          dragging = i;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", i.key);
          requestAnimationFrame(() => el.classList.add("is-dragging"));
        },
        ondragend: () => {
          dragging = null;
          el.classList.remove("is-dragging");
          for (const x of document.querySelectorAll(".bdrop")) x.remove();
          for (const x of document.querySelectorAll(".bsec.is-over")) x.classList.remove("is-over");
        },
      },
      h("span", { class: "brow__grip", "aria-hidden": "true" }, ico("grip")),
      typeIcon(i.type),
      h("span", { class: "brow__key mono", text: i.key }),
      h("span", { class: "brow__title", text: i.title }),
      i.blocked ? h("span", { class: "kcard__blocked", title: "Заблокирована другой задачей" }, ico("block")) : null,
      h("span", { class: "brow__tags" }, epicChip(data, i.epicId), i.labels.slice(0, 2).map((l) => h("span", { class: "label-chip label-chip--sm", text: l }))),
      priorityIcon(i.priority),
      statusPill(i.status),
      h("span", { class: "brow__est mono", text: i.estimate ? hrs(i.estimate) : "" }),
      avatar(i.assigneeId, { size: 24 }));
      return el;
    }

    function section({ key, sprint, title, sub, list, actions }) {
      const shown = applyFilters(list, f).filter((i) => showDone || sprint || i.status !== "done");
      const est = list.reduce((n, i) => n + (i.estimate || 0), 0);
      const counts = STATUSES.map(([s]) => list.filter((i) => i.status === s).length);
      const ul = h("ul", { class: "brows" }, shown.map(row));
      const isCollapsed = collapsed.has(key);
      const sec = h("section", {
        class: `bsec${sprint?.state === "active" ? " is-active" : ""}`,
        ondragover(e) {
          if (!dragging) return;
          e.preventDefault();
          sec.classList.add("is-over");
          const rows = [...ul.querySelectorAll(".brow:not(.is-dragging)")];
          const next = rows.find((r) => e.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
          let marker = document.querySelector(".bdrop");
          if (!marker) marker = h("li", { class: "bdrop" });
          if (next) ul.insertBefore(marker, next);
          else ul.append(marker);
        },
        ondragleave(e) { if (!sec.contains(e.relatedTarget)) { sec.classList.remove("is-over"); document.querySelector(".bdrop")?.remove(); } },
        ondrop(e) {
          e.preventDefault();
          sec.classList.remove("is-over");
          const issue = dragging;
          const marker = document.querySelector(".bdrop");
          const nextId = marker?.nextElementSibling?.dataset.id;
          const prevId = marker?.previousElementSibling?.dataset.id;
          marker?.remove();
          if (!issue) return;
          const sprintId = sprint ? sprint.id : "";
          const place = nextId && nextId !== issue.id ? { before: nextId } : prevId && prevId !== issue.id ? { after: prevId } : null;
          if (issue.sprintId === sprintId && !place) return;
          move(issue, sprintId, place);
        },
      },
      h("header", { class: "bsec__head" },
        h("button", { class: `bsec__toggle${isCollapsed ? " is-collapsed" : ""}`, type: "button", "aria-expanded": String(!isCollapsed), onclick: () => { if (isCollapsed) collapsed.delete(key); else collapsed.add(key); draw(); } },
          ico("chevron"), h("b", { text: title })),
        sub ? h("span", { class: "mono", text: sub }) : null,
        h("span", { class: "mono", text: `${list.length} ${plural(list.length, "задача", "задачи", "задач")}${est ? ` · ${hrs(est)}` : ""}` }),
        list.length ? h("span", { class: "status-strip", title: STATUSES.map(([, t], k) => `${t}: ${counts[k]}`).join(", ") },
          STATUSES.map(([s], k) => (counts[k] ? h("i", { class: `is-${s}`, vars: { "--n": String(counts[k]) } }) : null))) : null,
        h("div", { class: "actions bsec__actions" }, actions)),
      isCollapsed ? null : [
        sprint?.goal ? h("p", { class: "bsec__goal", text: `Цель: ${sprint.goal}` }) : null,
        shown.length ? ul : h("div", { class: "bsec__empty" }, ul, h("p", { class: "empty empty--small", text: sprint ? "Перетащите сюда задачи из бэклога." : "Бэклог пуст." })),
        quickRow(sprint),
      ]);
      return sec;
    }
    function quickRow(sprint) {
      const input = h("input", { class: "input input--sm", maxlength: "300", placeholder: "+ Создать задачу: название и Enter" });
      return h("form", {
        class: "bquick",
        async onsubmit(e) {
          e.preventDefault();
          const title = input.value.trim();
          if (!title) return;
          input.disabled = true;
          try {
            const { issue } = await api("POST", `/api/work/projects/${id}/issues`, { title, sprintId: sprint ? sprint.id : "" });
            mergeIssue(data, issue);
            draw();
            toast(`Создана ${issue.key}`);
            document.querySelector(`.bquick[data-key="${sprint ? sprint.id : "backlog"}"] input`)?.focus();
          } catch (err) {
            toast(errorText(err));
            input.disabled = false;
          }
        },
        "data-key": sprint ? sprint.id : "backlog",
      }, input);
    }

    async function newSprint() {
      try {
        const { sprint } = await api("POST", `/api/work/projects/${id}/sprints`, {});
        data.sprints.push(sprint);
        draw();
        toast(`${sprint.name} создан`);
      } catch (err) {
        toast(errorText(err));
      }
    }

    function draw() {
      keepSearchFocus(() => {
        const issues = data.issues.filter((i) => i.type !== "epic");
        const open = data.sprints.filter((s) => s.state !== "closed").sort((a, b) => (a.state === "active" ? -1 : b.state === "active" ? 1 : a.createdAt.localeCompare(b.createdAt)));
        const backlog = issues.filter((i) => !i.sprintId || !data.sprints.some((s) => s.id === i.sprintId));
        const hiddenDone = backlog.filter((i) => i.status === "done").length;
        const closed = data.sprints.filter((s) => s.state === "closed").sort((a, b) => (b.closedAt || "").localeCompare(a.closedAt || ""));
        I.root.replaceChildren(...spaceShell(data, "backlog", { onCreated: (issue) => { mergeIssue(data, issue); draw(); } },
          filterBar(data, f, (o) => draw(o), { extra: hiddenDone ? h("label", { class: "check filter-check" }, h("input", { type: "checkbox", checked: showDone, onchange: (e) => { showDone = e.target.checked; draw(); } }), `Готовые в бэклоге (${hiddenDone})`) : null }),
          h("div", { class: "backlog" },
            open.map((s) => section({
              key: s.id, sprint: s, title: s.name,
              sub: s.state === "active" ? `идёт · ${fmtDate(s.start)} – ${fmtDate(s.end)}` : s.start || s.end ? `${fmtDate(s.start)} – ${fmtDate(s.end)}` : "запланирован",
              list: issues.filter((i) => i.sprintId === s.id),
              actions: [
                s.state === "active"
                  ? btn("Завершить спринт", { small: true, variant: "light", onclick: () => I.work.completeSprint(data, s, reload) })
                  : btn("Начать спринт", { small: true, variant: data.sprints.some((x) => x.state === "active") ? "light" : "dark", onclick: () => startSprint(data, s, reload) }),
                tool("Изменить спринт", h("span", { text: "✎" }), () => editSprint(data, s, reload)),
                s.state === "planned" ? tool("Удалить спринт", "trash", async () => {
                  if (!confirm(`Удалить ${s.name}? Задачи вернутся в бэклог.`)) return;
                  try {
                    await api("DELETE", `/api/work/sprints/${s.id}`);
                    toast("Спринт удалён");
                    reload();
                  } catch (err) {
                    toast(errorText(err));
                  }
                }, true) : null,
              ],
            })),
            section({ key: "backlog", sprint: null, title: "Бэклог", sub: "", list: backlog, actions: [btn("Создать спринт", { small: true, variant: "light", onclick: newSprint })] }),
            closed.length
              ? h("details", { class: "closed-sprints" },
                h("summary", { class: "mono", text: `Завершённые спринты: ${closed.length}` }),
                h("ul", { class: "rows" }, closed.map((s) => h("li", { class: "row" },
                  h("div", { class: "row__main" }, s.name, h("small", { text: `${fmtDate(s.start)} – ${fmtDate(s.end)}${s.goal ? ` · ${s.goal}` : ""}` })),
                  h("div", { class: "row__side mono", text: s.stats ? `${s.stats.done} из ${s.stats.total} · ${hrs(s.stats.doneEstimate)} из ${hrs(s.stats.estimate)}` : "" })))))
              : null)));
      });
    }
    draw();
  }

  function sprintForm(s, { submitLabel, onSubmit, withDuration = false }) {
    const name = h("input", { class: "input", maxlength: "80", required: true, value: s.name });
    const goal = h("textarea", { class: "textarea textarea--short", maxlength: "500", placeholder: "Что команда хочет получить к концу спринта" });
    goal.value = s.goal || "";
    const start = h("input", { class: "input", type: "date", value: s.start || today(), required: withDuration });
    const end = h("input", { class: "input", type: "date", value: s.end || addDays(s.start || today(), 14) });
    const weeks = withDuration ? select("", [["1", "1 неделя"], ["2", "2 недели"], ["3", "3 недели"], ["4", "4 недели"], ["", "Своя дата"]], "2", (v) => { if (v) end.value = addDays(start.value || today(), Number(v) * 7); }) : null;
    start.addEventListener("change", () => { if (weeks?.value) end.value = addDays(start.value, Number(weeks.value) * 7); });
    const error = h("p", { class: "form__error", hidden: true });
    const submit = btn(submitLabel, { type: "submit" });
    return h("form", {
      class: "form",
      async onsubmit(e) {
        e.preventDefault();
        submit.disabled = true;
        error.hidden = true;
        try {
          await onSubmit({ name: name.value, goal: goal.value, start: start.value, end: end.value });
        } catch (err) {
          error.textContent = errorText(err);
          error.hidden = false;
          submit.disabled = false;
        }
      },
    },
    h("label", { class: "field" }, h("span", { text: "Название" }), name),
    h("label", { class: "field" }, h("span", { text: "Цель спринта" }), goal),
    h("div", { class: withDuration ? "create-issue__row" : "grid-2" },
      h("label", { class: "field" }, h("span", { text: "Начало" }), start),
      weeks ? h("label", { class: "field" }, h("span", { text: "Длительность" }), weeks) : null,
      h("label", { class: "field" }, h("span", { text: "Конец" }), end)),
    error,
    h("div", { class: "actions" }, submit));
  }
  function startSprint(data, s, done) {
    if (data.sprints.some((x) => x.state === "active")) return toast("Сначала завершите активный спринт");
    const count = data.issues.filter((i) => i.sprintId === s.id).length;
    let ui;
    ui = dialog(`Начать ${s.name}`, h("div", { class: "stack" },
      h("p", { class: "muted", text: count ? `В спринте ${count} ${plural(count, "задача", "задачи", "задач")}. После старта они появятся на доске.` : "В спринте пока нет задач: их можно добавить и после старта." }),
      sprintForm(s, {
        submitLabel: "Начать спринт", withDuration: true,
        onSubmit: async (body) => {
          await api("POST", `/api/work/sprints/${s.id}/start`, body);
          ui.close(true);
          toast("Спринт начался");
          done();
        },
      })));
  }
  function editSprint(data, s, done) {
    let ui;
    ui = dialog(`Спринт: ${s.name}`, sprintForm(s, {
      submitLabel: "Сохранить",
      onSubmit: async (body) => {
        await api("PATCH", `/api/work/sprints/${s.id}`, body);
        ui.close(true);
        toast("Сохранено");
        done();
      },
    }));
  }
  function completeSprint(data, s, done) {
    const list = data.issues.filter((i) => i.sprintId === s.id);
    const open = list.filter((i) => i.status !== "done");
    const targets = data.sprints.filter((x) => x.state === "planned");
    const where = select("", [["", "В бэклог"], ...targets.map((x) => [x.id, `В ${x.name}`]), ["new", "В новый спринт"]], targets[0]?.id || "", () => {});
    let ui;
    const submit = btn("Завершить спринт", {
      async onclick() {
        submit.disabled = true;
        try {
          let moveTo = where.value;
          if (moveTo === "new") moveTo = (await api("POST", `/api/work/projects/${data.project.id}/sprints`, {})).sprint.id;
          await api("POST", `/api/work/sprints/${s.id}/complete`, { moveTo });
          ui.close(true);
          toast(`${s.name} завершён`);
          done();
        } catch (err) {
          toast(errorText(err));
          submit.disabled = false;
        }
      },
    });
    ui = dialog(`Завершить ${s.name}`, h("div", { class: "stack" },
      h("div", { class: "checklist__stats" },
        h("div", {}, h("span", { text: "Готово" }), h("b", { text: String(list.length - open.length) })),
        h("div", {}, h("span", { text: "Не готово" }), h("b", { text: String(open.length) }))),
      open.length ? h("label", { class: "field" }, h("span", { text: `Куда перенести ${open.length} ${plural(open.length, "незавершённую задачу", "незавершённые задачи", "незавершённых задач")}` }), where) : h("p", { class: "muted", text: "Все задачи спринта готовы." }),
      h("div", { class: "actions" }, submit)));
  }

  /* ---------- Список задач ---------- */
  const COLUMNS = [
    ["key", "Ключ", (i) => i.number],
    ["title", "Название", (i) => i.title.toLowerCase()],
    ["status", "Статус", (i) => STATUSES.findIndex(([s]) => s === i.status)],
    ["assignee", "Исполнитель", (i) => nameOf(i.assigneeId) || "яя"],
    ["priority", "Приоритет", (i) => PRIORITY_ORDER[i.priority]],
    ["estimate", "Оценка", (i) => i.estimate ?? -1],
    ["spent", "Затрачено", (i) => i.spent],
    ["due", "Срок", (i) => i.due || "9999"],
    ["sprint", "Спринт", (i) => i.sprintId],
    ["updated", "Обновлена", (i) => i.updatedAt],
  ];
  async function viewList(alive, id) {
    loading();
    let data = await loadSpace(id);
    if (!alive()) return;
    const f = filtersFor(id);
    const sort = { key: "updated", dir: -1 };
    const onChange = (issue, removed) => { mergeIssue(data, issue, removed); draw(); };
    const rows = () => {
      const col = COLUMNS.find(([k]) => k === sort.key);
      return applyFilters(data.issues, f).sort((a, b) => {
        const x = col[2](a);
        const y = col[2](b);
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
    };
    function exportCsv() {
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const head = ["Ключ", "Тип", "Название", "Статус", "Исполнитель", "Автор", "Приоритет", "Оценка, ч", "Затрачено, ч", "Начало", "Срок", "Спринт", "Эпик", "Метки", "Создана", "Обновлена"];
      const lines = rows().map((i) => [
        i.key, TYPES[i.type], i.title, STATUS[i.status], nameOf(i.assigneeId), nameOf(i.reporterId), PRIORITY[i.priority],
        i.estimate ?? "", i.spent || "", i.start, i.due, i.sprintId ? sprintName(data, i.sprintId) : "", data.issues.find((e) => e.id === i.epicId)?.title || "",
        i.labels.join(", "), i.createdAt.slice(0, 10), i.updatedAt.slice(0, 10),
      ].map((v) => esc(String(v).replace(".", typeof v === "number" ? "," : "."))).join(";"));
      // BOM и «;» — чтобы Excel с русскими настройками открыл файл без мастера импорта.
      download(`${data.project.key}-задачи-${today()}.csv`, `﻿${[head.map(esc).join(";"), ...lines].join("\r\n")}`);
    }
    function draw() {
      keepSearchFocus(() => {
        const list = rows();
        const th = ([key, label]) => h("th", {},
          h("button", { class: `th-sort${sort.key === key ? " is-on" : ""}`, type: "button", onclick: () => { sort.dir = sort.key === key ? -sort.dir : key === "updated" ? -1 : 1; sort.key = key; draw(); } },
            label, sort.key === key ? h("span", { class: "mono", text: sort.dir > 0 ? " ↑" : " ↓" }) : null));
        I.root.replaceChildren(...spaceShell(data, "list", { onCreated: (issue) => { mergeIssue(data, issue); draw(); } },
          filterBar(data, f, (o) => draw(o), { hideDone: true, extra: h("div", { class: "filters__end" }, h("span", { class: "mono", text: `${list.length} из ${data.issues.length}` }), btn("Выгрузить CSV", { small: true, variant: "light", onclick: exportCsv })) }),
          list.length
            ? h("div", { class: "table-wrap issue-table" }, h("table", { class: "table" },
              h("thead", {}, h("tr", {}, COLUMNS.map(th))),
              h("tbody", {}, list.map((i) => h("tr", { class: i.status === "done" ? "is-off" : null, tabindex: "0", onclick: () => openIssue(i.id, { space: data, onChange }), onkeydown: (e) => { if (e.key === "Enter") openIssue(i.id, { space: data, onChange }); } },
                h("td", { class: "nowrap" }, h("span", { class: "cell-key" }, typeIcon(i.type), h("span", { class: "mono", text: i.key }))),
                h("td", { class: "cell-title" }, i.blocked ? h("span", { class: "kcard__blocked", title: "Заблокирована другой задачей" }, ico("block")) : null, i.title, epicChip(data, i.epicId)),
                h("td", {}, statusPill(i.status)),
                h("td", {}, h("span", { class: "cell-person" }, avatar(i.assigneeId, { size: 22 }), nameOf(i.assigneeId) || h("span", { class: "muted", text: "нет" }))),
                h("td", {}, h("span", { class: "cell-person" }, priorityIcon(i.priority), PRIORITY[i.priority])),
                h("td", { class: "mono", text: i.estimate ? hrs(i.estimate) : "" }),
                h("td", { class: "mono", text: i.spent ? hrs(i.spent) : "" }),
                h("td", { class: `mono${isOverdue(i) ? " accent" : ""}`, text: i.due ? fmtDate(i.due) : "" }),
                h("td", { class: "muted", text: i.type === "epic" ? "" : sprintName(data, i.sprintId) }),
                h("td", { class: "mono", text: ago(i.updatedAt) }))))))
            : h("p", { class: "empty mt-24", text: data.issues.length ? "По фильтрам ничего нет." : "Задач пока нет." })));
      });
    }
    draw();
  }

  /* ---------- Задача отдельной страницей: /work/i/D2OP-12 ---------- */
  async function viewIssuePage(alive, key) {
    loading();
    const { issue } = await api("GET", `/api/work/issue-by-key/${encodeURIComponent(key)}`);
    const data = await loadSpace(issue.projectId);
    if (!alive()) return;
    const panel = issuePanel(issue.id, { space: data, page: true, onChange: (x, removed) => { if (!removed && x.key !== key) history.replaceState(null, "", `/work/i/${x.key}`); } });
    openPanel = panel;
    I.onLeave(() => { if (openPanel === panel) openPanel = null; });
    live(`/api/work/projects/${data.project.id}/events?client=${CLIENT}`, { issues: (ev) => { if (ev.client !== CLIENT && ev.ids.includes(issue.id)) panel.refresh(); } });
    I.setLeaveGuard((unload) => !panel.dirty() || (!unload && confirm("Есть несохранённый текст. Уйти без сохранения?")));
    I.root.replaceChildren(...spaceShell(data, null, {}, h("div", { class: "card issue-page" }, panel.el)));
  }

  /* ---------- Маршруты ---------- */
  I.addRoutes([
    { re: /^\/work$/, view: viewWorkHome, access: "team" },
    { re: /^\/work\/p\/([\w-]+)$/, view: (alive, id) => navigate(`/work/p/${id}/board`, { replace: true }), access: "team" },
    { re: /^\/work\/p\/([\w-]+)\/board$/, view: viewBoard, access: "team" },
    { re: /^\/work\/p\/([\w-]+)\/backlog$/, view: viewBacklog, access: "team" },
    { re: /^\/work\/p\/([\w-]+)\/list$/, view: viewList, access: "team" },
    { re: /^\/work\/i\/([A-Za-z][A-Za-z0-9]{1,9}-\d+)$/, view: viewIssuePage, access: "team" },
  ]);

  // Для plan.js, wiki.js и board.js.
  I.work = {
    svg, ico, tool, typeIcon, priorityIcon, avatar, statusPill, epicChip, markdown, toggleTask, pasteImages, upload, overlay, dialog,
    live, presence, hotkeys, loadSpace, mergeIssue, spaceShell, openIssue, createIssue, completeSprint, describeChange, miniIssue,
    filtersFor, applyFilters, filterBar, keepSearchFocus, select, download, copyText, ago, hrs, addDays, localDate, nameOf, rememberTeam,
    isOverdue, epicsOf, sprintName, openSearch, typing, knownKeys,
    TYPES, STATUSES, STATUS, PRIORITIES, PRIORITY, TYPE_COLORS, DAY,
    get openPanel() { return openPanel; },
  };
})();
