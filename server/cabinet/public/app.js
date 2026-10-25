/* Кабинет клиента InData: одна страница, маршруты в адресной строке.
   Весь текст из данных вставляется через textContent — никакого innerHTML с данными. */
(() => {
  "use strict";

  const root = document.getElementById("app");
  const CONTACT = { label: "@geosibik", url: "https://t.me/geosibik" };
  const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const STATUS_LABELS = { todo: "Впереди", active: "В работе", done: "Готово" };
  const ROLE_LABELS = { client: "Клиент", manager: "Менеджер проекта", admin: "Администратор" };
  // Блоки, которые можно скрыть от менеджера. Оплаты и суммы скрыты всегда.
  const BLOCK_LABELS = { tasks: "Задачи для заказчика", meetings: "Созвоны и договорённости", updates: "Лента обновлений", files: "Документы" };
  const ERRORS = {
    credentials: "Неверный логин или пароль",
    rate: "Слишком много попыток. Попробуйте через 15 минут",
    login_taken: "Такой логин уже занят",
    login: "Логин: латиница, цифры, точка, дефис или @, от 3 символов",
    current: "Текущий пароль указан неверно",
    weak: "Новый пароль должен быть не короче 8 символов",
    date: "Проверьте даты",
    amount: "Проверьте суммы",
    url: "Ссылка должна начинаться с http:// или https://",
    too_large: "Файл больше 25 МБ",
    self: "Это действие нельзя применить к себе",
  };

  let me = null;          // вошедший пользователь
  let renderId = 0;       // защита от гонок: ответ старого экрана не рисуем поверх нового
  let leaveGuard = null;  // () => true, если можно уйти со страницы без потери правок

  /* ---------- DOM ---------- */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "text") el.textContent = value;
      else if (key === "vars") for (const [name, v] of Object.entries(value)) el.style.setProperty(name, v);
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else if (key in el && typeof value !== "string") el[key] = value;
      else el.setAttribute(key, value === true ? "" : value);
    }
    append(el, children);
    return el;
  }
  function append(el, children) {
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  }

  function link(href, props, ...children) {
    return h("a", {
      href,
      ...props,
      onclick(e) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(href);
      },
    }, ...children);
  }

  // Кнопка как на сайте: при наведении текст прокручивается вверх.
  function btn(label, { variant = "dark", small = false, href = null, external = false, ...props } = {}) {
    const cls = `btn btn--${variant}${small ? " btn--small" : ""}`;
    const roll = h("span", { class: "btn__roll" }, h("span", { text: label }), h("span", { text: label, "aria-hidden": "true" }));
    if (href && external) return h("a", { class: cls, href, target: "_blank", rel: "noopener", ...props }, roll);
    if (href) return link(href, { class: cls, ...props }, roll);
    return h("button", { class: cls, type: "button", ...props }, roll);
  }
  function setBtnLabel(button, label) {
    for (const span of button.querySelectorAll(".btn__roll > span")) span.textContent = label;
  }

  function wordmark() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 26 26");
    svg.setAttribute("aria-hidden", "true");
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("width", "7");
    rect.setAttribute("height", "26");
    rect.setAttribute("rx", "1");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M10 0h3a13 13 0 0 1 0 26h-3z");
    svg.append(rect, path);
    return link("/", { class: "wordmark", "aria-label": "InData — кабинет" }, svg, h("span", { text: "InData" }));
  }

  // «← Все проекты»: такая же стрелка в рамке, как у кнопки «назад» на indata.group.
  function backLink(href, label) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M16 10H4m5-5-5 5 5 5");
    svg.append(path);
    return link(href, { class: "backlink" }, h("span", { class: "backlink__icon" }, svg), label);
  }

  /* ---------- Форматы ---------- */
  function fmtDate(iso, withYear = false) {
    if (!iso) return "";
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    const year = withYear || y !== new Date().getFullYear() ? ` ${y}` : "";
    return `${d} ${MONTHS[m - 1]}${year}`;
  }
  function fmtRange(start, end) {
    if (start && end) {
      const [y1, m1, d1] = start.split("-").map(Number);
      const [y2, m2, d2] = end.split("-").map(Number);
      if (y1 === y2 && m1 === m2) return `${d1}–${fmtDate(end)}`;
      const short = (d, m) => `${d} ${MONTHS[m - 1].slice(0, 3)}`;
      return `${short(d1, m1)} – ${short(d2, m2)}${y2 !== new Date().getFullYear() ? ` ${y2}` : ""}`;
    }
    if (end) return `до ${fmtDate(end)}`;
    if (start) return `с ${fmtDate(start)}`;
    return "";
  }
  const rub = (n) => `${new Intl.NumberFormat("ru-RU").format(n)} ₽`;
  function fileSize(bytes) {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
  }
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  function progressOf(stages) {
    if (!stages.length) return 0;
    const done = stages.reduce((n, s) => n + (s.status === "done" ? 1 : s.status === "active" ? 0.5 : 0), 0);
    return Math.round((done / stages.length) * 100);
  }
  const plural = (n, one, few, many) => {
    const m10 = n % 10;
    const m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  };

  /* ---------- Сервер ---------- */
  class ApiError extends Error {
    constructor(status, code) {
      super(code);
      this.status = status;
      this.code = code;
    }
  }
  async function api(method, url, body, { allow401 = false, headers = {} } = {}) {
    const init = { method, headers: { ...headers }, credentials: "same-origin" };
    if (body instanceof Blob) {
      init.body = body;
      init.headers["Content-Type"] = body.type || "application/octet-stream";
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers["Content-Type"] = "application/json";
    }
    let res;
    try {
      res = await fetch(url, init);
    } catch {
      throw new ApiError(0, "network");
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !allow401) {
      me = null;
      navigate("/login", { replace: true, force: true });
      throw new ApiError(401, "auth");
    }
    if (!res.ok) throw new ApiError(res.status, data.error || "server");
    return data;
  }
  function errorText(err) {
    if (err.code === "network") return "Нет связи с сервером. Проверьте интернет";
    if (String(err.code).startsWith("required")) return "Заполните обязательные поля";
    return ERRORS[err.code] || "Что-то пошло не так. Попробуйте ещё раз";
  }

  /* ---------- Уведомление ---------- */
  const toastEl = h("div", { class: "toast", role: "status", "aria-live": "polite" });
  document.body.append(toastEl);
  let toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 2600);
  }

  /* ---------- Маршруты ---------- */
  const ROUTES = [
    { re: /^\/login$/, view: viewLogin, access: "public" },
    { re: /^\/$/, view: viewHome },
    { re: /^\/p\/([\w-]+)$/, view: viewProject },
    { re: /^\/p\/([\w-]+)\/tasks$/, view: (alive, id) => viewProject(alive, id, "tasks") },
    { re: /^\/account$/, view: viewAccount },
    { re: /^\/admin$/, view: viewAdminProjects, access: "admin" },
    { re: /^\/admin\/clients$/, view: viewAdminClients, access: "admin" },
    { re: /^\/admin\/p\/([\w-]+)$/, view: viewAdminProject, access: "staff" },
  ];

  function navigate(path, { replace = false, force = false } = {}) {
    if (!force && leaveGuard && !leaveGuard()) return;
    leaveGuard = null;
    if (path !== location.pathname) history[replace ? "replaceState" : "pushState"](null, "", path);
    render();
  }
  window.addEventListener("popstate", () => {
    leaveGuard = null;
    render();
  });
  window.addEventListener("beforeunload", (e) => {
    if (leaveGuard && !leaveGuard(true)) e.preventDefault();
  });

  async function render() {
    const id = ++renderId;
    const path = location.pathname.replace(/\/+$/, "") || "/";
    const route = ROUTES.find((r) => r.re.test(path));
    if (!route) return navigate("/", { replace: true });
    if (route.access !== "public" && !me) return navigate("/login", { replace: true });
    if (route.access === "public" && me) return navigate("/", { replace: true });
    if (route.access === "admin" && me.role !== "admin") return navigate("/", { replace: true });
    if (route.access === "staff" && me.role === "client") return navigate("/", { replace: true });
    window.scrollTo(0, 0);
    const params = path.match(route.re).slice(1);
    try {
      await route.view(() => id === renderId, ...params);
    } catch (err) {
      if (!(err instanceof ApiError)) console.error(err);
      if (err.code === "auth" || id !== renderId) return;
      const notFound = err.status === 404;
      root.replaceChildren(...shell(
        h("p", { class: "eyebrow mono", text: notFound ? "404" : "Ошибка" }),
        h("h1", { class: "h1", text: notFound ? "Такого проекта нет" : "Не получилось загрузить" }),
        h("p", { class: "lead", text: notFound ? "Возможно, ссылка устарела или у вас нет к нему доступа." : errorText(err) }),
        h("div", { class: "actions mt-32" }, btn("На главную", { href: "/", variant: "light" })),
      ));
    }
  }

  // Шапка, вкладки админа и место для экрана.
  function shell(...content) {
    const nav = me.role === "admin"
      ? h("nav", { class: "tabs", "aria-label": "Разделы" },
        [["/admin", "Проекты"], ["/admin/clients", "Люди"]].map(([href, label]) => {
          const current = href === "/admin" ? /^\/admin(\/p\/|$)/.test(location.pathname) : location.pathname.startsWith(href);
          return link(href, { "aria-current": current ? "page" : null }, label);
        }))
      : null;
    return [
      h("header", { class: "top" },
        h("span", { class: "mono", text: me.company && me.role === "client" ? me.company : "app.indata.group" }),
        wordmark(),
        h("div", { class: "top__user" },
          link("/account", { class: "mono", title: "Аккаунт" }, me.name),
          h("button", { class: "mono link-btn", type: "button", onclick: logout, text: "Выйти" }))),
      nav,
      h("main", { class: "page appear" }, ...content),
    ].filter(Boolean);
  }
  function loading() {
    root.replaceChildren(...shell(h("p", { class: "loading mono", text: "Загружаем…" })));
  }

  async function logout() {
    if (leaveGuard && !leaveGuard()) return;
    await api("POST", "/api/logout").catch(() => {});
    me = null;
    navigate("/login", { force: true });
  }

  /* ---------- Вход ---------- */
  async function viewLogin() {
    const error = h("p", { class: "form__error", hidden: true });
    const submit = btn("Войти", { type: "submit" });
    const loginInput = h("input", { class: "input", name: "login", autocomplete: "username", autocapitalize: "none", spellcheck: "false", required: true });
    const passInput = h("input", { class: "input", name: "password", type: "password", autocomplete: "current-password", required: true });
    const form = h("form", {
      class: "form",
      async onsubmit(e) {
        e.preventDefault();
        error.hidden = true;
        submit.disabled = true;
        try {
          const { user } = await api("POST", "/api/login", { login: loginInput.value, password: passInput.value }, { allow401: true });
          me = user;
          navigate("/", { replace: true });
        } catch (err) {
          error.textContent = errorText(err);
          error.hidden = false;
          passInput.select();
        } finally {
          submit.disabled = false;
        }
      },
    },
    h("label", { class: "field" }, h("span", { text: "Логин" }), loginInput),
    h("label", { class: "field" }, h("span", { text: "Пароль" }), passInput),
    error,
    submit);

    root.replaceChildren(h("main", { class: "login" },
      h("div", { class: "login__card appear" },
        wordmark(),
        h("h1", { class: "login__title", text: "Кабинет клиента" }),
        h("p", { class: "login__lead", text: "Статус проекта, обновления, оплаты и документы в одном месте" }),
        form,
        h("p", { class: "login__help mono" }, "Нет доступа? Напишите ", h("a", { href: CONTACT.url, target: "_blank", rel: "noopener", class: "accent", text: CONTACT.label })))));
    loginInput.focus();
  }

  /* ---------- Клиент: проекты ---------- */
  async function viewHome(alive) {
    if (me.role === "admin") return navigate("/admin", { replace: true });
    loading();
    const { projects } = await api("GET", "/api/projects");
    if (!alive()) return;
    if (me.role === "manager") {
      root.replaceChildren(...shell(
        h("span", { class: "eyebrow mono", text: ROLE_LABELS.manager }),
        h("h1", { class: "h1", text: "Ваши проекты" }),
        projects.length
          ? folderSections(projects)
          : h("p", { class: "lead", text: "Проектов пока нет. Когда администратор откроет вам проект, он появится здесь." }),
      ));
      return;
    }
    if (projects.length === 1) return viewProject(alive, projects[0].id);
    root.replaceChildren(...shell(
      h("span", { class: "eyebrow mono", text: me.company || "Кабинет клиента" }),
      h("h1", { class: "h1", text: projects.length ? "Ваши проекты" : "Здесь появится ваш проект" }),
      projects.length ? folderTotals(projects, "lead") : null,
      projects.length
        ? h("div", { class: "projects" }, projects.map((p) => projectCard(p)))
        : h("p", { class: "lead", text: "Мы добавим его, как только начнём работу. Если что-то нужно уже сейчас, напишите нам в Telegram." }),
      contactBlock(),
    ));
  }

  // «3 проекта · 1 220 000 ₽ · оплачено 535 000 ₽ · нужно от вас: 14 задач»
  function folderTotals(projects, cls) {
    const total = projects.reduce((n, p) => n + (p.total || 0), 0);
    const paid = projects.reduce((n, p) => n + (p.paid || 0), 0);
    const tasks = projects.reduce((n, p) => n + (p.openTasks || 0), 0);
    const parts = [`${projects.length} ${plural(projects.length, "проект", "проекта", "проектов")}`];
    if (total) parts.push(`${rub(total)} по договорам`, paid >= total ? "оплачено полностью" : `оплачено ${rub(paid)}`);
    return h("p", { class: cls },
      parts.join(" · "),
      tasks ? [" · ", h("span", { class: "accent nowrap", text: `${me.role === "client" ? "нужно от вас" : "у заказчика"}: ${tasks} ${plural(tasks, "задача", "задачи", "задач")}` })] : null);
  }

  function projectCard(p, href = `/p/${p.id}`) {
    return link(href, { class: "card project-card" },
      h("h2", { class: "project-card__title", text: p.title }),
      p.summary ? h("p", { class: "project-card__summary", text: p.summary }) : null,
      p.clients ? h("p", { class: "mono", text: p.clients.join(", ") || "Клиенты не назначены" }) : null,
      h("div", { class: "project-card__foot" },
        h("div", { class: "project-card__meta" },
          h("span", { text: p.stage ? p.stage : "Скоро начнём" }),
          h("span", { class: "accent", text: `${p.progress}%` })),
        h("div", { class: "bar" }, h("i", { vars: { "--p": `${p.progress}%` } })),
        p.total
          ? h("div", { class: "project-card__meta project-card__money" },
            h("span", { text: rub(p.total) }),
            h("span", { class: p.paid >= p.total ? "tag--ok" : "muted", text: p.paid >= p.total ? "оплачено" : p.paid ? `оплачено ${rub(p.paid)}` : "не оплачено" }))
          : null,
        p.openTasks
          ? h("span", { class: "mono accent", text: `${me.role === "client" ? "Нужно от вас" : "У заказчика"}: ${p.openTasks} ${plural(p.openTasks, "задача", "задачи", "задач")}` })
          : h("span", { class: "mono", text: `Обновлено ${fmtDate(p.updatedAt)}` })));
  }

  async function viewProject(alive, id, tab = "overview") {
    loading();
    const [{ project }, mine] = await Promise.all([
      api("GET", `/api/projects/${id}`),
      me.role === "client" ? api("GET", "/api/projects") : null,
    ]);
    if (!alive()) return;
    let p = project;
    const admin = me.role !== "client"; // админ или менеджер смотрят глазами клиента
    // У клиента с одним проектом «все проекты» — это он сам, стрелка назад не нужна.
    const back = admin || mine.projects.length > 1 ? backLink(me.role === "admin" ? "/admin" : "/", "Все проекты") : null;

    async function toggle(task) {
      try {
        p = (await api("POST", `/api/projects/${p.id}/tasks/${task.id}/done`, { done: !task.done })).project;
        draw();
        toast(task.done ? "Задача снова в работе" : "Отметили: выполнено. Спасибо!");
      } catch (err) {
        toast(errorText(err));
      }
    }

    function draw() {
      const open = (p.tasks || []).filter((t) => !t.done);
      const base = `/p/${p.id}`;
      const head = h("div", { class: "project-head" },
        h("div", {},
          back,
          admin || !back ? h("span", { class: "eyebrow mono", text: admin ? "Так проект видит клиент" : "Проект" }) : null,
          h("h1", { class: "h1", text: p.title }),
          p.summary ? h("p", { class: "lead", text: p.summary }) : null),
        admin ? h("div", { class: "actions" }, btn("Редактировать", { href: `/admin/p/${p.id}`, variant: "light" })) : null);
      const tabs = h("nav", { class: "subtabs", "aria-label": "Разделы проекта" },
        link(base, { "aria-current": tab === "overview" ? "page" : null }, "Обзор"),
        p.tasks
          ? link(`${base}/tasks`, { "aria-current": tab === "tasks" ? "page" : null },
            "Задачи для вас",
            open.length ? h("span", { class: "badge", text: String(open.length) }) : null)
          : null);
      const body = tab === "tasks" && p.tasks ? tasksTab(p, toggle) : overviewTab(p, open);
      root.replaceChildren(...shell(head, tabs, body, contactBlock()));
    }
    draw();
  }

  function overviewTab(p, open) {
    const active = p.stages.find((s) => s.status === "active");
    const finished = p.stages.length > 0 && p.stages.every((s) => s.status === "done");
    const pct = progressOf(p.stages);
    const nearest = open.find((t) => t.due);
    return [
      open.length
        ? h("section", { class: "notice" },
          h("p", { class: "notice__title" },
            "Нужно от вас: ",
            h("b", { text: `${open.length} ${plural(open.length, "задача", "задачи", "задач")}` }),
            h("small", { text: nearest ? `Ближайший срок: ${fmtDate(nearest.due)}` : "Без срока" })),
          btn("Открыть задачи", { href: `/p/${p.id}/tasks`, small: true }))
        : null,
      h("section", { class: "status", "aria-label": "Статус проекта" },
        h("div", { class: "status__num", text: `${pct}%` }),
        h("p", { class: "status__now" },
          finished ? "Проект завершён" : active ? `Сейчас: ${active.title}` : "Скоро начнём",
          h("small", { text: active && active.end ? `Плановый срок этапа: ${fmtDate(active.end)}` : `Обновлено ${fmtDate(p.updatedAt)}` })),
        h("div", { class: "bar" }, h("i", { vars: { "--p": `${pct}%` } }))),
      p.stages.length ? stagesStrip(p.stages) : null,
      h("div", { class: "columns" },
        h("div", { class: "stack stack--wide" },
          p.meetings?.length
            ? h("section", { "aria-labelledby": "meetings-title" },
              h("div", { class: "section-head" }, h("h2", { class: "h2", id: "meetings-title", text: "Созвоны и договорённости" })),
              meetingsList(p.meetings))
            : null,
          p.updates
            ? h("section", { "aria-labelledby": "feed-title" },
              h("div", { class: "section-head" }, h("h2", { class: "h2", id: "feed-title", text: "Что нового" })),
              feed(p.updates))
            : null),
        h("div", { class: "stack" },
          p.payments ? paymentsCard(p.payments) : null,
          p.files ? filesCard(p) : null)),
    ];
  }

  function tasksTab(p, onToggle) {
    const done = p.tasks.filter((t) => t.done);
    return h("section", { class: "tasks-page" },
      h("p", { class: "lead tasks-lead", text: "Что нужно от вас, чтобы мы шли по срокам. Когда сделаете, отметьте задачу, и мы увидим." }),
      tasksList(p.tasks.filter((t) => !t.done), { onToggle, empty: "Сейчас от вас ничего не нужно. Как только понадобится, задача появится здесь." }),
      done.length ? [h("p", { class: "tasks-done-title mono", text: `Выполнено: ${done.length}` }), tasksList(done, { onToggle })] : null);
  }

  // Задача: кружок-отметка, название, пояснение, срок или кто и когда выполнил, ссылка.
  function tasksList(tasks, { onToggle, onEdit = null, onDelete = null, empty = "Задач пока нет." }) {
    if (!tasks.length) return h("p", { class: "empty", text: empty });
    return h("ul", { class: "tasks" }, tasks.map((t) => {
      const overdue = !t.done && t.due && t.due < today();
      return h("li", { class: `task${t.done ? " is-done" : ""}` },
        h("button", {
          class: "task__check", type: "button", "aria-pressed": String(t.done),
          title: t.done ? "Вернуть в работу" : "Отметить выполненной",
          "aria-label": `${t.done ? "Вернуть в работу" : "Отметить выполненной"}: ${t.title}`,
          onclick: () => onToggle(t),
        }),
        h("div", { class: "task__body" },
          h("p", { class: "task__title", text: t.title }),
          t.text ? h("p", { class: "task__text", text: t.text }) : null,
          h("div", { class: "task__meta" },
            t.done
              ? h("span", { class: "tag tag--ok", text: `Выполнено ${fmtDate(t.doneAt.slice(0, 10))}${t.doneBy ? ` · ${t.doneBy}` : ""}` })
              : t.due ? h("span", { class: `tag ${overdue ? "tag--due" : "muted"}`, text: `${overdue ? "Срок был" : "Сделать до"} ${fmtDate(t.due)}` }) : null,
            t.url ? h("a", { class: "chip", href: t.url, target: "_blank", rel: "noopener noreferrer", text: `${hostOf(t.url)} ↗` }) : null)),
        onEdit
          ? h("div", { class: "row-tools" },
            h("button", { class: "icon-btn", type: "button", title: "Изменить", "aria-label": `Изменить: ${t.title}`, onclick: () => onEdit(t), text: "✎" }),
            h("button", { class: "icon-btn icon-btn--danger", type: "button", title: "Удалить", "aria-label": `Удалить: ${t.title}`, onclick: () => onDelete(t), text: "✕" }))
          : null);
    }));
  }

  function stagesStrip(stages) {
    return h("ol", { class: "stages", vars: { "--n": String(stages.length) } }, stages.map((s) => h("li", { class: `stage is-${s.status}` },
      h("span", { class: "stage__dot", "aria-hidden": "true" }),
      h("p", { class: "stage__title", text: s.title }),
      h("p", { class: "stage__dates mono", text: [STATUS_LABELS[s.status], fmtRange(s.start, s.end)].filter(Boolean).join(" · ") }),
      s.note ? h("p", { class: "stage__note", text: s.note }) : null)));
  }

  // Созвон: дата, тема, запись и договорённости — по одной в строке, маркеры «-», «•» убираем.
  function meetingsList(meetings, { onEdit = null, onDelete = null } = {}) {
    if (!meetings.length) return h("p", { class: "empty", text: "Здесь появятся созвоны: ссылка на запись и о чём договорились." });
    const admin = Boolean(onEdit || onDelete);
    return h("div", { class: "meetings" }, meetings.map((m) => {
      const points = m.agreements.split("\n").map((line) => line.replace(/^[\s•*–-]+/, "").trim()).filter(Boolean);
      return h("article", { class: "meeting" },
        h("div", { class: "meeting__head" },
          h("div", {}, h("span", { class: "mono", text: fmtDate(m.date) }), h("h3", { class: "meeting__title", text: m.title })),
          admin
            ? h("div", { class: "row-tools" },
              h("button", { class: "icon-btn", type: "button", title: "Изменить", "aria-label": "Изменить созвон", onclick: () => onEdit(m), text: "✎" }),
              h("button", { class: "icon-btn icon-btn--danger", type: "button", title: "Удалить", "aria-label": "Удалить созвон", onclick: () => onDelete(m), text: "✕" }))
            : null),
        m.recordingUrl
          ? h("a", { class: "chip chip--rec", href: m.recordingUrl, target: "_blank", rel: "noopener noreferrer" }, h("span", { class: "chip__play", "aria-hidden": "true" }), "Запись созвона ↗")
          : admin ? h("span", { class: "mono", text: "Ссылки на запись пока нет" }) : null,
        points.length
          ? h("div", {}, h("p", { class: "meeting__label", text: "Договорились" }), h("ul", { class: "agreements" }, points.map((t) => h("li", { text: t }))))
          : null);
    }));
  }

  function feed(updates, onDelete = null) {
    if (!updates.length) return h("p", { class: "empty", text: "Здесь будут новости проекта: что сделали, что показать и что дальше." });
    return h("div", { class: "feed" }, updates.map((u) => h("article", { class: "post" },
      h("span", { class: "mono", text: fmtDate(u.date) }),
      h("h3", { class: "post__title", text: u.title }),
      u.text ? h("p", { class: "post__text", text: u.text }) : null,
      u.links.length
        ? h("div", { class: "post__links" }, u.links.map((l) => h("a", { class: "chip", href: l.url, target: "_blank", rel: "noopener noreferrer", text: `${l.label || hostOf(l.url)} ↗` })))
        : null,
      onDelete ? h("button", { class: "icon-btn icon-btn--danger post__del", type: "button", title: "Удалить запись", "aria-label": "Удалить запись", onclick: () => onDelete(u), text: "✕" }) : null)));
  }
  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  function paymentsCard(payments) {
    const total = payments.reduce((n, x) => n + x.amount, 0);
    const paid = payments.filter((x) => x.paid).reduce((n, x) => n + x.amount, 0);
    return h("section", { class: "card" },
      h("div", { class: "section-head" }, h("h2", { class: "h2", text: "Оплаты" })),
      payments.length
        ? [
          h("dl", { class: "money" },
            h("div", {}, h("dt", { text: "Всего" }), h("dd", { text: rub(total) })),
            h("div", {}, h("dt", { text: "Оплачено" }), h("dd", { text: rub(paid) })),
            h("div", {}, h("dt", { text: "Осталось" }), h("dd", { class: total - paid > 0 ? "accent" : null, text: rub(total - paid) }))),
          h("ul", { class: "rows" }, payments.map((x) => {
            const overdue = !x.paid && x.due && x.due < today();
            const tag = x.paid
              ? h("span", { class: "tag tag--ok", text: x.paidAt ? `Оплачено ${fmtDate(x.paidAt)}` : "Оплачено" })
              : h("span", { class: `tag ${overdue ? "tag--due" : "muted"}`, text: x.due ? `${overdue ? "Срок был" : "Оплатить до"} ${fmtDate(x.due)}` : "Ожидает оплаты" });
            return h("li", { class: "row" },
              h("div", { class: "row__main" }, x.title),
              h("div", { class: "row__side" }, h("div", { text: rub(x.amount) }), tag));
          })),
        ]
        : h("p", { class: "empty", text: "Пока нет платежей." }));
  }

  function filesCard(p) {
    return h("section", { class: "card" },
      h("div", { class: "section-head" }, h("h2", { class: "h2", text: "Документы" })),
      filesList(p));
  }

  function filesList(p, onDelete = null) {
    return p.files.length
        ? h("ul", { class: "rows" }, p.files.map((f) => {
          const ext = f.name.includes(".") ? f.name.split(".").pop().slice(0, 4) : "file";
          const body = [
            h("div", { class: "row__main" },
              h("span", { class: "file__icon", text: ext }),
              h("div", { class: "file__meta" },
                h("div", { class: "file__name", text: f.name }),
                h("small", { text: `${fileSize(f.size)} · ${fmtDate(f.uploadedAt.slice(0, 10))}` }))),
          ];
          const href = `/api/projects/${p.id}/files/${f.id}`;
          if (!onDelete) return h("li", {}, h("a", { class: "row file", href, target: "_blank", rel: "noopener" }, body, h("span", { class: "mono file__open", text: "Открыть ↗" })));
          return h("li", { class: "row file" }, body, h("div", { class: "row-tools" },
            h("a", { class: "icon-btn", href, target: "_blank", rel: "noopener", title: "Открыть", "aria-label": "Открыть", text: "↗" }),
            h("button", { class: "icon-btn icon-btn--danger", type: "button", title: "Удалить", "aria-label": `Удалить ${f.name}`, onclick: () => onDelete(f), text: "✕" })));
        }))
      : h("p", { class: "empty", text: "Договор, акты и макеты появятся здесь." });
  }

  function contactBlock() {
    return h("section", { class: "contact card card--soft" },
      h("p", {}, "Вопросы по проекту? Напишите нам в Telegram, ответим в течение рабочего дня."),
      btn(`Написать ${CONTACT.label}`, { href: CONTACT.url, external: true }));
  }

  /* ---------- Аккаунт ---------- */
  async function viewAccount() {
    const current = h("input", { class: "input", type: "password", autocomplete: "current-password", required: true });
    const next = h("input", { class: "input", type: "password", autocomplete: "new-password", minlength: "8", required: true });
    const repeat = h("input", { class: "input", type: "password", autocomplete: "new-password", required: true });
    const error = h("p", { class: "form__error", hidden: true });
    const submit = btn("Сменить пароль", { type: "submit" });
    const form = h("form", {
      class: "form",
      async onsubmit(e) {
        e.preventDefault();
        error.hidden = true;
        if (next.value !== repeat.value) {
          error.textContent = "Новые пароли не совпадают";
          error.hidden = false;
          return;
        }
        submit.disabled = true;
        try {
          await api("POST", "/api/password", { current: current.value, next: next.value });
          form.reset();
          toast("Пароль изменён. На других устройствах нужно войти заново");
        } catch (err) {
          error.textContent = errorText(err);
          error.hidden = false;
        } finally {
          submit.disabled = false;
        }
      },
    },
    h("label", { class: "field" }, h("span", { text: "Текущий пароль" }), current),
    h("div", { class: "grid-2" },
      h("label", { class: "field" }, h("span", { text: "Новый пароль, от 8 символов" }), next),
      h("label", { class: "field" }, h("span", { text: "Повторите новый пароль" }), repeat)),
    error,
    h("div", { class: "actions" }, submit));

    root.replaceChildren(...shell(h("div", { class: "page--narrow" },
      h("span", { class: "eyebrow mono", text: "Аккаунт" }),
      h("h1", { class: "h1", text: me.name }),
      h("p", { class: "lead" }, `Логин: ${me.login}`, me.company ? ` · ${me.company}` : ""),
      h("section", { class: "card mt-40" }, h("div", { class: "stack" }, h("h2", { class: "h2", text: "Смена пароля" }), form)))));
  }

  /* ---------- Админка: проекты ---------- */
  async function viewAdminProjects(alive) {
    loading();
    const [{ projects }, { users }] = await Promise.all([api("GET", "/api/projects"), api("GET", "/api/admin/users")]);
    if (!alive()) return;
    const clients = users.filter((u) => u.role === "client" && !u.disabled);

    const title = h("input", { class: "input", required: true, maxlength: "160", placeholder: "Например, Доработки 2: онлайн-покер" });
    const folderInput = folderField(projects);
    const picks = clientPicker(clients, []);
    const error = h("p", { class: "form__error", hidden: true });
    const create = btn("Создать проект", { type: "submit" });
    const form = h("form", {
      class: "card form",
      hidden: true,
      async onsubmit(e) {
        e.preventDefault();
        create.disabled = true;
        error.hidden = true;
        try {
          const { project } = await api("POST", "/api/admin/projects", { title: title.value, folder: folderInput.input.value, clientIds: picks.value() });
          navigate(`/admin/p/${project.id}`);
        } catch (err) {
          error.textContent = errorText(err);
          error.hidden = false;
          create.disabled = false;
        }
      },
    },
    h("h2", { class: "h2", text: "Новый проект" }),
    h("div", { class: "grid-2" },
      h("label", { class: "field" }, h("span", { text: "Название" }), title),
      h("label", { class: "field" }, h("span", { text: "Папка: клиент или компания" }), folderInput.input, folderInput.list)),
    h("div", { class: "field" }, h("span", { text: "Кому открыть" }), picks.el),
    error,
    h("div", { class: "actions" }, create, btn("Отмена", { variant: "light", onclick: () => { form.hidden = true; } })));

    root.replaceChildren(...shell(
      h("div", { class: "project-head" },
        h("div", {}, h("span", { class: "eyebrow mono", text: "Админка" }), h("h1", { class: "h1", text: "Проекты" })),
        btn("Новый проект", { onclick: () => { form.hidden = false; title.focus(); } })),
      h("div", { class: "stack mt-24" }, form),
      projects.length
        ? folderSections(projects)
        : h("p", { class: "lead", text: "Проектов пока нет. Создайте первый и откройте его клиенту." }),
    ));
  }

  function folderSections(projects) {
    return groupByFolder(projects).map(([folder, list]) => h("details", {
          class: "folder",
          open: !collapsedFolders().has(folder),
          ontoggle: (e) => rememberFolder(folder, e.currentTarget.open),
        },
        h("summary", { class: "folder__head" },
          h("h2", { class: "folder__title" }, h("span", { class: "folder__icon", "aria-hidden": "true" }), folder || "Без папки"),
          folderTotals(list, "folder__totals mono"),
          h("span", { class: "folder__chevron", "aria-hidden": "true" })),
        h("div", { class: "projects" }, list.map((p) => projectCard(p, `/admin/p/${p.id}`)))));
  }

  // Свёрнутые папки помним в браузере; если хранилище недоступно, все папки просто открыты.
  const FOLDERS_KEY = "cabinet:collapsed-folders";
  function collapsedFolders() {
    try {
      return new Set(JSON.parse(localStorage.getItem(FOLDERS_KEY) || "[]"));
    } catch {
      return new Set();
    }
  }
  function rememberFolder(folder, open) {
    const set = collapsedFolders();
    if (open) set.delete(folder);
    else set.add(folder);
    try {
      localStorage.setItem(FOLDERS_KEY, JSON.stringify([...set]));
    } catch {}
  }

  function groupByFolder(projects) {
    const groups = new Map();
    for (const p of projects) {
      if (!groups.has(p.folder)) groups.set(p.folder, []);
      groups.get(p.folder).push(p);
    }
    // Проекты без папки — в конце.
    return [...groups].sort(([a], [b]) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b, "ru"));
  }

  // Поле папки с подсказками из уже существующих папок.
  function folderField(projects, value = "") {
    const id = `folders-${Math.random().toString(36).slice(2, 8)}`;
    const folders = [...new Set(projects.map((p) => p.folder).filter(Boolean))];
    return {
      input: h("input", { class: "input", maxlength: "120", value, list: id, placeholder: "Например, Empire Poker Club" }),
      list: h("datalist", { id }, folders.map((f) => h("option", { value: f }))),
    };
  }

  function clientPicker(clients, selected) {
    const boxes = clients.map((u) => h("input", { type: "checkbox", value: u.id, checked: selected.includes(u.id) }));
    const el = clients.length
      ? h("div", { class: "clients-pick" }, clients.map((u, i) => h("label", { class: "check" }, boxes[i], u.company ? `${u.name}, ${u.company}` : u.name)))
      : h("p", { class: "empty" }, "Клиентов пока нет. ", link("/admin/clients", { class: "accent" }, "Добавить клиента"));
    return { el, boxes, value: () => boxes.filter((b) => b.checked).map((b) => b.value) };
  }

  /* ---------- Админка: проект ---------- */
  async function viewAdminProject(alive, id) {
    loading();
    const isAdmin = me.role === "admin";
    const [{ project }, { users }, { projects: all }] = await Promise.all([
      api("GET", `/api/projects/${id}`),
      isAdmin ? api("GET", "/api/admin/users") : { users: [] },
      isAdmin ? api("GET", "/api/projects") : { projects: [] },
    ]);
    if (!alive()) return;
    let p = project;
    // Скрытые от менеджера блоки сервер не присылает вовсе.
    const show = { payments: Boolean(p.payments), tasks: Boolean(p.tasks), meetings: Boolean(p.meetings), updates: Boolean(p.updates), files: Boolean(p.files) };
    for (const key of ["payments", "tasks", "meetings", "updates", "files"]) p[key] ||= [];
    p.clientIds ||= [];
    const clients = users.filter((u) => u.role === "client" && (!u.disabled || p.clientIds.includes(u.id)));
    const stages = structuredClone(p.stages);
    const payments = structuredClone(p.payments);
    let dirty = false;

    const heading = h("h1", { class: "h1", text: p.title });
    const saveBar = h("div", { class: "save-bar", hidden: true });
    const saveBtn = btn("Сохранить", { variant: "light", small: true });
    append(saveBar, [h("span", { text: "Есть несохранённые изменения" }), saveBtn]);
    const markDirty = () => {
      dirty = true;
      saveBar.hidden = false;
    };
    leaveGuard = (silent) => !dirty || (!silent && confirm("Изменения не сохранены. Уйти со страницы?"));

    // Основное
    const titleInput = h("input", { class: "input", value: p.title, maxlength: "160", oninput: markDirty });
    const folderInput = folderField(all, p.folder);
    folderInput.input.addEventListener("input", markDirty);
    const summaryInput = h("textarea", { class: "textarea", maxlength: "600", rows: "2", placeholder: "Коротко о проекте: что делаем", oninput: markDirty });
    summaryInput.value = p.summary || "";
    const picks = clientPicker(clients, p.clientIds);
    for (const box of picks.boxes) box.addEventListener("change", markDirty);

    // Этапы
    const stageRows = h("div", { class: "edit-rows" });
    function renderStages() {
      stageRows.replaceChildren(...stages.map((s, i) => h("div", { class: "edit-row edit-row--stage" },
        h("input", { class: "input input--sm", value: s.title, placeholder: "Этап", "aria-label": "Название этапа", oninput: (e) => { s.title = e.target.value; markDirty(); } }),
        h("select", { class: "select select--sm", "aria-label": "Статус", onchange: (e) => { s.status = e.target.value; markDirty(); } },
          Object.entries(STATUS_LABELS).map(([value, label]) => h("option", { value, selected: s.status === value, text: label }))),
        h("input", { class: "input input--sm", type: "date", value: s.start, "aria-label": "Начало", oninput: (e) => { s.start = e.target.value; markDirty(); } }),
        h("input", { class: "input input--sm", type: "date", value: s.end, "aria-label": "Срок", oninput: (e) => { s.end = e.target.value; markDirty(); } }),
        h("input", { class: "input input--sm", value: s.note, placeholder: "Комментарий для клиента", "aria-label": "Комментарий", oninput: (e) => { s.note = e.target.value; markDirty(); } }),
        rowTools(stages, i, renderStages, markDirty))));
    }
    renderStages();

    // Оплаты
    const payRows = h("div", { class: "edit-rows" });
    function renderPayments() {
      payRows.replaceChildren(...payments.map((x, i) => h("div", { class: "edit-row edit-row--pay" },
        h("input", { class: "input input--sm", value: x.title, placeholder: "Например, Предоплата 50%", "aria-label": "Платёж", oninput: (e) => { x.title = e.target.value; markDirty(); } }),
        h("input", { class: "input input--sm", type: "number", min: "0", step: "1000", value: String(x.amount ?? ""), placeholder: "Сумма, ₽", "aria-label": "Сумма", oninput: (e) => { x.amount = e.target.value; markDirty(); } }),
        h("input", { class: "input input--sm", type: "date", value: x.due, "aria-label": "Срок оплаты", oninput: (e) => { x.due = e.target.value; markDirty(); } }),
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: x.paid, onchange: (e) => { x.paid = e.target.checked; x.paidAt = x.paid ? today() : ""; markDirty(); } }), "Оплачено"),
        h("button", { class: "icon-btn icon-btn--danger", type: "button", title: "Удалить", "aria-label": "Удалить платёж", text: "✕", onclick: () => { payments.splice(i, 1); renderPayments(); markDirty(); } }))));
    }
    renderPayments();

    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      try {
        const body = {
          title: titleInput.value,
          summary: summaryInput.value,
          stages: stages.map((s) => ({ ...s, title: s.title.trim() })).filter((s) => s.title),
        };
        if (isAdmin) {
          body.folder = folderInput.input.value;
          body.clientIds = picks.value();
          body.payments = payments.filter((x) => x.title.trim()).map((x) => ({ ...x, amount: Number(x.amount) || 0 }));
        }
        const res = await api("PATCH", `/api/admin/projects/${p.id}`, body);
        p = { ...p, ...res.project };
        stages.splice(0, stages.length, ...structuredClone(p.stages));
        payments.splice(0, payments.length, ...structuredClone(p.payments || []));
        renderStages();
        renderPayments();
        dirty = false;
        saveBar.hidden = true;
        heading.textContent = p.title;
        toast("Сохранено. Клиент уже видит изменения");
      } catch (err) {
        toast(errorText(err));
      } finally {
        saveBtn.disabled = false;
      }
    });

    // Задачи для заказчика
    let editingTask = null;
    const tasksBox = h("div");
    const taskTitle = h("input", { class: "input", maxlength: "200", required: true, placeholder: "Например, Согласовать формат онлайн-покера" });
    const taskDue = h("input", { class: "input", type: "date" });
    const taskText = h("textarea", { class: "textarea textarea--short", maxlength: "2000", placeholder: "Что именно нужно и в каком виде" });
    const taskUrl = h("input", { class: "input", type: "url", maxlength: "500", placeholder: "https://… макеты, документ или форма, если нужна" });
    const taskError = h("p", { class: "form__error", hidden: true });
    const taskBtn = btn("Добавить задачу", { type: "submit" });
    const taskCancel = btn("Отмена", { variant: "light", hidden: true, onclick: () => resetTaskForm() });
    function resetTaskForm() {
      editingTask = null;
      taskForm.reset();
      taskError.hidden = true;
      setBtnLabel(taskBtn, "Добавить задачу");
      taskCancel.hidden = true;
    }
    async function taskCall(promise, message) {
      try {
        p = (await promise).project;
        renderTasks();
        if (message) toast(message);
        return true;
      } catch (err) {
        toast(errorText(err));
        return false;
      }
    }
    const renderTasks = () => tasksBox.replaceChildren(tasksList(p.tasks, {
      empty: "Задач для заказчика пока нет.",
      onToggle: (t) => taskCall(api("POST", `/api/projects/${p.id}/tasks/${t.id}/done`, { done: !t.done }), t.done ? "Задача снова открыта" : "Отмечено выполненной"),
      onEdit(t) {
        editingTask = t.id;
        taskTitle.value = t.title;
        taskDue.value = t.due;
        taskText.value = t.text;
        taskUrl.value = t.url;
        setBtnLabel(taskBtn, "Сохранить задачу");
        taskCancel.hidden = false;
        taskForm.scrollIntoView({ block: "center", behavior: "smooth" });
        taskTitle.focus({ preventScroll: true });
      },
      async onDelete(t) {
        if (!confirm(`Удалить задачу «${t.title}»?`)) return;
        if (await taskCall(api("DELETE", `/api/admin/projects/${p.id}/tasks/${t.id}`)) && editingTask === t.id) resetTaskForm();
      },
    }));
    renderTasks();
    const taskForm = h("form", {
      class: "form",
      async onsubmit(e) {
        e.preventDefault();
        taskError.hidden = true;
        taskBtn.disabled = true;
        const body = { title: taskTitle.value, due: taskDue.value, text: taskText.value, url: taskUrl.value.trim() };
        try {
          p = (editingTask
            ? await api("PATCH", `/api/admin/projects/${p.id}/tasks/${editingTask}`, body)
            : await api("POST", `/api/admin/projects/${p.id}/tasks`, body)).project;
          toast(editingTask ? "Задача обновлена" : "Задача добавлена, клиент её видит");
          resetTaskForm();
          renderTasks();
        } catch (err) {
          taskError.textContent = errorText(err);
          taskError.hidden = false;
        } finally {
          taskBtn.disabled = false;
        }
      },
    },
    h("div", { class: "grid-2" },
      h("label", { class: "field" }, h("span", { text: "Задача" }), taskTitle),
      h("label", { class: "field" }, h("span", { text: "Срок" }), taskDue)),
    h("label", { class: "field" }, h("span", { text: "Пояснение" }), taskText),
    h("label", { class: "field" }, h("span", { text: "Ссылка" }), taskUrl),
    taskError,
    h("div", { class: "actions" }, taskBtn, taskCancel));

    // Созвоны
    let editingMeeting = null;
    const meetingsBox = h("div");
    const meetingTitle = h("input", { class: "input", maxlength: "160", placeholder: "Например, Старт проекта" });
    const meetingDate = h("input", { class: "input", type: "date", value: today() });
    const meetingUrl = h("input", { class: "input", type: "url", maxlength: "500", placeholder: "https://… ссылка на запись: Диск, Телемост, Zoom" });
    const meetingText = h("textarea", { class: "textarea", maxlength: "5000", placeholder: "По одной договорённости в строке:\nСтарт работ 26 октября\nЭтап 1 сдаём до 25 ноября" });
    const meetingError = h("p", { class: "form__error", hidden: true });
    const meetingBtn = btn("Добавить созвон", { type: "submit" });
    const meetingCancel = btn("Отмена", { variant: "light", hidden: true, onclick: () => resetMeetingForm() });
    function resetMeetingForm() {
      editingMeeting = null;
      meetingForm.reset();
      meetingDate.value = today();
      meetingError.hidden = true;
      setBtnLabel(meetingBtn, "Добавить созвон");
      meetingCancel.hidden = true;
    }
    const renderMeetings = () => meetingsBox.replaceChildren(meetingsList(p.meetings, {
      onEdit(m) {
        editingMeeting = m.id;
        meetingTitle.value = m.title;
        meetingDate.value = m.date;
        meetingUrl.value = m.recordingUrl;
        meetingText.value = m.agreements;
        setBtnLabel(meetingBtn, "Сохранить созвон");
        meetingCancel.hidden = false;
        meetingForm.scrollIntoView({ block: "center", behavior: "smooth" });
        meetingTitle.focus({ preventScroll: true });
      },
      async onDelete(m) {
        if (!confirm(`Удалить созвон «${m.title}»?`)) return;
        try {
          p = (await api("DELETE", `/api/admin/projects/${p.id}/meetings/${m.id}`)).project;
          if (editingMeeting === m.id) resetMeetingForm();
          renderMeetings();
        } catch (err) {
          toast(errorText(err));
        }
      },
    }));
    renderMeetings();
    const meetingForm = h("form", {
      class: "form",
      async onsubmit(e) {
        e.preventDefault();
        meetingError.hidden = true;
        meetingBtn.disabled = true;
        const body = { title: meetingTitle.value, date: meetingDate.value, recordingUrl: meetingUrl.value.trim(), agreements: meetingText.value };
        try {
          p = (editingMeeting
            ? await api("PATCH", `/api/admin/projects/${p.id}/meetings/${editingMeeting}`, body)
            : await api("POST", `/api/admin/projects/${p.id}/meetings`, body)).project;
          toast(editingMeeting ? "Созвон обновлён" : "Созвон добавлен");
          resetMeetingForm();
          renderMeetings();
        } catch (err) {
          meetingError.textContent = errorText(err);
          meetingError.hidden = false;
        } finally {
          meetingBtn.disabled = false;
        }
      },
    },
    h("div", { class: "grid-2" },
      h("label", { class: "field" }, h("span", { text: "Тема" }), meetingTitle),
      h("label", { class: "field" }, h("span", { text: "Дата" }), meetingDate)),
    h("label", { class: "field" }, h("span", { text: "Ссылка на запись" }), meetingUrl),
    h("label", { class: "field" }, h("span", { text: "Договорённости, по одной в строке" }), meetingText),
    meetingError,
    h("div", { class: "actions" }, meetingBtn, meetingCancel));

    // Лента
    const feedBox = h("div");
    const renderFeed = () => feedBox.replaceChildren(feed(p.updates, async (u) => {
      if (!confirm(`Удалить запись «${u.title}»?`)) return;
      try {
        p = (await api("DELETE", `/api/admin/projects/${p.id}/updates/${u.id}`)).project;
        renderFeed();
      } catch (err) {
        toast(errorText(err));
      }
    }));
    renderFeed();
    const postDate = h("input", { class: "input", type: "date", value: today() });
    const postTitle = h("input", { class: "input", maxlength: "160", required: true, placeholder: "Например, Сдали дизайн магазина" });
    const postText = h("textarea", { class: "textarea", maxlength: "5000", placeholder: "Что сделали, что посмотреть, что дальше" });
    const postLinks = h("textarea", { class: "textarea textarea--short", rows: "2", placeholder: "Макеты | https://figma.com/…\nhttps://test.example.com" });
    const postError = h("p", { class: "form__error", hidden: true });
    const postBtn = btn("Опубликовать", { type: "submit" });
    const postForm = h("form", {
      class: "form",
      async onsubmit(e) {
        e.preventDefault();
        postError.hidden = true;
        const links = postLinks.value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
          const [a, b] = line.split("|").map((s) => s.trim());
          return b ? { label: a, url: b } : { label: "", url: a };
        });
        postBtn.disabled = true;
        try {
          p = (await api("POST", `/api/admin/projects/${p.id}/updates`, { date: postDate.value, title: postTitle.value, text: postText.value, links })).project;
          postForm.reset();
          postDate.value = today();
          renderFeed();
          toast("Опубликовано");
        } catch (err) {
          postError.textContent = errorText(err);
          postError.hidden = false;
        } finally {
          postBtn.disabled = false;
        }
      },
    },
    h("div", { class: "grid-2" },
      h("label", { class: "field" }, h("span", { text: "Заголовок" }), postTitle),
      h("label", { class: "field" }, h("span", { text: "Дата" }), postDate)),
    h("label", { class: "field" }, h("span", { text: "Текст" }), postText),
    h("label", { class: "field" }, h("span", { text: "Ссылки, по одной в строке: «Название | адрес» или просто адрес" }), postLinks),
    postError,
    h("div", { class: "actions" }, postBtn));

    // Документы
    const filesBox = h("div");
    const renderFiles = () => filesBox.replaceChildren(filesList(p, async (f) => {
      if (!confirm(`Удалить файл «${f.name}»? Клиент перестанет его видеть.`)) return;
      try {
        p = (await api("DELETE", `/api/admin/projects/${p.id}/files/${f.id}`)).project;
        renderFiles();
      } catch (err) {
        toast(errorText(err));
      }
    }));
    renderFiles();
    // Кнопка открывает выбор файлов, выбранное сразу загружается.
    const uploadBtn = btn("Загрузить файлы", { variant: "light", small: true });
    const fileInput = h("input", { type: "file", multiple: true, hidden: true });
    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const files = [...fileInput.files];
      if (!files.length) return;
      uploadBtn.disabled = true;
      try {
        for (const [i, file] of files.entries()) {
          setBtnLabel(uploadBtn, files.length > 1 ? `Загружаем ${i + 1} из ${files.length}…` : "Загружаем…");
          p = (await api("POST", `/api/admin/projects/${p.id}/files`, file, { headers: { "X-Filename": encodeURIComponent(file.name) } })).project;
        }
        toast(files.length > 1 ? `Загружено ${files.length} ${plural(files.length, "файл", "файла", "файлов")}` : "Файл загружен");
      } catch (err) {
        toast(errorText(err));
      } finally {
        fileInput.value = "";
        renderFiles();
        setBtnLabel(uploadBtn, "Загрузить файлы");
        uploadBtn.disabled = false;
      }
    });

    const removeBtn = btn("Удалить проект", {
      variant: "danger",
      small: true,
      async onclick() {
        if (!confirm(`Удалить проект «${p.title}» вместе с лентой и файлами? Это нельзя отменить.`)) return;
        try {
          await api("DELETE", `/api/admin/projects/${p.id}`);
          dirty = false;
          navigate("/admin");
          toast("Проект удалён");
        } catch (err) {
          toast(errorText(err));
        }
      },
    });

    root.replaceChildren(...shell(
      h("div", { class: "project-head" },
        h("div", {}, backLink(isAdmin ? "/admin" : "/", "Все проекты"), heading),
        h("div", { class: "actions" }, btn("Как видит клиент", { href: `/p/${p.id}`, variant: "light" }))),
      h("div", { class: "editor" },
        h("section", { class: "card form" },
          h("h2", { class: "h2", text: "Основное" }),
          h("div", { class: isAdmin ? "grid-2" : "" },
            h("label", { class: "field" }, h("span", { text: "Название" }), titleInput),
            isAdmin ? h("label", { class: "field" }, h("span", { text: "Папка: клиент или компания" }), folderInput.input, folderInput.list) : null),
          h("label", { class: "field" }, h("span", { text: "Описание" }), summaryInput),
          isAdmin
            ? h("div", { class: "field" }, h("span", { text: "Кому открыт проект" }), picks.el)
            : p.clients?.length ? h("p", { class: "mono", text: `Клиент: ${p.clients.map((c) => c.name).join(", ")}` }) : null),
        h("section", { class: "card form" },
          h("div", { class: "section-head" }, h("h2", { class: "h2", text: "Этапы" }), h("span", { class: "mono", text: "Прогресс считается по статусам этапов" })),
          h("div", { class: "edit-head edit-head--stage" }, ["Этап", "Статус", "Начало", "Срок", "Комментарий", ""].map((t) => h("span", { text: t }))),
          stageRows,
          h("div", { class: "actions" }, btn("Добавить этап", {
            variant: "light",
            small: true,
            onclick: () => { stages.push({ id: "", title: "", status: "todo", start: "", end: "", note: "" }); renderStages(); markDirty(); stageRows.lastElementChild.querySelector("input").focus(); },
          }))),
        !show.payments ? null : h("section", { class: "card form" },
          h("h2", { class: "h2", text: "Оплаты" }),
          h("div", { class: "edit-head edit-head--pay" }, ["Платёж", "Сумма, ₽", "Оплатить до", "", ""].map((t) => h("span", { text: t }))),
          payRows,
          h("div", { class: "actions" }, btn("Добавить платёж", {
            variant: "light",
            small: true,
            onclick: () => { payments.push({ id: "", title: "", amount: "", due: "", paid: false, paidAt: "" }); renderPayments(); markDirty(); payRows.lastElementChild.querySelector("input").focus(); },
          }))),
        saveBar,
        !show.tasks ? null : h("section", { class: "card stack" },
          h("div", { class: "section-head" }, h("h2", { class: "h2", text: "Задачи для заказчика" }), link(`/p/${p.id}/tasks`, { class: "mono" }, "Как видит клиент ↗")),
          taskForm,
          tasksBox),
        !show.meetings ? null : h("section", { class: "card stack" },
          h("h2", { class: "h2", text: "Созвоны и договорённости" }),
          meetingForm,
          meetingsBox),
        !show.updates ? null : h("section", { class: "card stack" },
          h("h2", { class: "h2", text: "Лента обновлений" }),
          postForm,
          feedBox),
        !show.files ? null : h("section", { class: "card stack" },
          h("div", { class: "section-head" }, h("h2", { class: "h2", text: "Документы" }), h("span", { class: "mono", text: "До 25 МБ на файл" })),
          h("div", { class: "upload" }, uploadBtn, fileInput),
          filesBox),
        isAdmin ? h("div", { class: "actions" }, removeBtn) : null),
    ));
  }

  // Кнопки «выше», «ниже», «удалить» для строки списка.
  function rowTools(list, i, rerender, onChange) {
    const move = (to) => () => {
      [list[i], list[to]] = [list[to], list[i]];
      rerender();
      onChange();
    };
    return h("div", { class: "row-tools" },
      h("button", { class: "icon-btn", type: "button", title: "Выше", "aria-label": "Выше", disabled: i === 0, onclick: move(i - 1), text: "↑" }),
      h("button", { class: "icon-btn", type: "button", title: "Ниже", "aria-label": "Ниже", disabled: i === list.length - 1, onclick: move(i + 1), text: "↓" }),
      h("button", {
        class: "icon-btn icon-btn--danger", type: "button", title: "Удалить", "aria-label": "Удалить", text: "✕",
        onclick: () => { list.splice(i, 1); rerender(); onChange(); },
      }));
  }

  /* ---------- Админка: клиенты ---------- */
  async function viewAdminClients(alive) {
    loading();
    const [{ users }, { projects }] = await Promise.all([api("GET", "/api/admin/users"), api("GET", "/api/projects")]);
    if (!alive()) return;
    const secretBox = h("div");

    function showSecret(user, password, isNew) {
      const text = `Кабинет: ${location.origin}\nЛогин: ${user.login}\nПароль: ${password}`;
      const copy = btn("Скопировать", {
        variant: "dark",
        small: true,
        async onclick() {
          try {
            await navigator.clipboard.writeText(text);
            toast("Скопировано");
          } catch {
            toast("Не получилось скопировать, выделите текст вручную");
          }
        },
      });
      secretBox.replaceChildren(h("div", { class: "secret appear" },
        h("p", {}, isNew ? `Доступ для ${user.name} создан. ` : `Новый пароль для ${user.name}. `, h("span", { class: "muted", text: "Пароль показываем один раз: отправьте его сейчас." })),
        h("pre", { text }),
        h("div", { class: "actions" }, copy, btn("Готово", { variant: "light", small: true, onclick: () => secretBox.replaceChildren() }))));
      secretBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    const name = h("input", { class: "input", required: true, maxlength: "120", placeholder: "Иван Петров" });
    const company = h("input", { class: "input", maxlength: "120", placeholder: "Empire Poker Club" });
    const login = h("input", { class: "input", required: true, maxlength: "64", autocapitalize: "none", spellcheck: "false", placeholder: "empire" });
    const contact = h("input", { class: "input", maxlength: "120", placeholder: "@username или +7 900 000-00-00" });
    const role = h("select", { class: "select" }, Object.entries(ROLE_LABELS).map(([value, label]) => h("option", { value, text: label })));
    const roleField = h("label", { class: "field" }, h("span", { text: "Роль" }), role);

    // Менеджер проекта: какие проекты ведёт и какие блоки ему не видны.
    const projectBoxes = projects.map((p) => h("input", { type: "checkbox", value: p.id }));
    const hideBoxes = Object.keys(BLOCK_LABELS).map((key) => h("input", { type: "checkbox", value: key }));
    const managerFields = h("div", { class: "form", hidden: true },
      h("div", { class: "field" },
        h("span", { text: "Какие проекты ведёт" }),
        projects.length
          ? groupByFolder(projects).map(([folder, list]) => h("div", { class: "perm-group" },
            h("p", { class: "perm-group__title mono", text: folder || "Без папки" }),
            h("div", { class: "clients-pick" }, list.map((p) => h("label", { class: "check" }, projectBoxes[projects.indexOf(p)], p.title)))))
          : h("p", { class: "empty", text: "Проектов пока нет." })),
      h("div", { class: "field" },
        h("span", { text: "Что скрыть от менеджера" }),
        h("div", { class: "clients-pick" },
          h("label", { class: "check is-locked" }, h("input", { type: "checkbox", checked: true, disabled: true }), "Оплаты и суммы, всегда"),
          hideBoxes.map((box) => h("label", { class: "check" }, box, BLOCK_LABELS[box.value])))));
    const isManagerForm = () => (editing ? editing.role : role.value) === "manager";
    role.addEventListener("change", () => { managerFields.hidden = !isManagerForm(); });

    const error = h("p", { class: "form__error", hidden: true });
    const formTitle = h("h2", { class: "h2", text: "Добавить человека" });
    const create = btn("Создать и выдать пароль", { type: "submit" });
    let editing = null; // кого правим; null — создаём нового

    function openForm(user = null) {
      editing = user;
      form.reset();
      error.hidden = true;
      formTitle.textContent = user ? `${ROLE_LABELS[user.role]}: ${user.name}` : "Добавить человека";
      setBtnLabel(create, user ? "Сохранить" : "Создать и выдать пароль");
      roleField.hidden = Boolean(user);
      if (user) {
        name.value = user.name;
        company.value = user.company;
        login.value = user.login;
        contact.value = user.contact;
      }
      for (const box of projectBoxes) box.checked = Boolean(user?.projectIds?.includes(box.value));
      for (const box of hideBoxes) box.checked = Boolean(user?.hide?.includes(box.value));
      managerFields.hidden = !isManagerForm();
      form.hidden = false;
      form.scrollIntoView({ block: "nearest", behavior: "smooth" });
      name.focus({ preventScroll: true });
    }

    const form = h("form", {
      class: "card form",
      hidden: true,
      async onsubmit(e) {
        e.preventDefault();
        error.hidden = true;
        create.disabled = true;
        const fields = { name: name.value, company: company.value, login: login.value, contact: contact.value };
        if (isManagerForm()) {
          fields.projectIds = projectBoxes.filter((b) => b.checked).map((b) => b.value);
          fields.hide = hideBoxes.filter((b) => b.checked).map((b) => b.value);
        }
        try {
          if (editing) {
            const { user } = await api("PATCH", `/api/admin/users/${editing.id}`, fields);
            Object.assign(editing, user);
            form.hidden = true;
            renderTable();
            toast("Сохранено");
          } else {
            const res = await api("POST", "/api/admin/users", { ...fields, role: role.value });
            users.push(res.user);
            form.reset();
            form.hidden = true;
            renderTable();
            showSecret(res.user, res.password, true);
          }
        } catch (err) {
          error.textContent = errorText(err);
          error.hidden = false;
        } finally {
          create.disabled = false;
        }
      },
    },
    formTitle,
    h("div", { class: "grid-2" },
      h("label", { class: "field" }, h("span", { text: "Имя" }), name),
      h("label", { class: "field" }, h("span", { text: "Компания" }), company)),
    h("div", { class: "grid-2" },
      h("label", { class: "field" }, h("span", { text: "Логин: латиница, цифры, точка или дефис" }), login),
      h("label", { class: "field" }, h("span", { text: "Telegram или телефон" }), contact)),
    roleField,
    managerFields,
    error,
    h("div", { class: "actions" }, create, btn("Отмена", { variant: "light", onclick: () => { form.hidden = true; } })));

    const tbody = h("tbody");
    function renderTable() {
      tbody.replaceChildren(...users.map((u) => {
        const self = u.id === me.id;
        const act = async (fn) => {
          try {
            await fn();
          } catch (err) {
            toast(errorText(err));
          }
        };
        return h("tr", { class: u.disabled ? "is-off" : null },
          h("td", {}, h("div", { text: u.name }), u.company ? h("small", { class: "muted", text: u.company }) : null),
          h("td", {}, h("div", { class: "mono", text: u.login }), u.contact ? h("small", { class: "muted", text: u.contact }) : null),
          h("td", {},
            h("div", { text: u.disabled ? "Заблокирован" : ROLE_LABELS[u.role] }),
            u.role === "manager"
              ? h("small", { class: "muted", text: `${u.projectIds.length} ${plural(u.projectIds.length, "проект", "проекта", "проектов")}${u.hide.length ? `, скрыто: ${u.hide.map((b) => BLOCK_LABELS[b].toLowerCase()).join(", ")}` : ""}` })
              : null),
          h("td", {}, self ? h("span", { class: "mono", text: "это вы" }) : h("div", { class: "actions" },
            h("button", { class: "icon-btn", type: "button", title: "Изменить", "aria-label": `Изменить ${u.name}`, text: "✎", onclick: () => openForm(u) }),
            btn("Новый пароль", {
              variant: "light", small: true,
              onclick: () => act(async () => {
                if (!confirm(`Выдать ${u.name} новый пароль? Старый перестанет работать.`)) return;
                const { password } = await api("POST", `/api/admin/users/${u.id}/password`);
                showSecret(u, password, false);
              }),
            }),
            btn(u.disabled ? "Разблокировать" : "Заблокировать", {
              variant: "light", small: true,
              onclick: () => act(async () => {
                const { user } = await api("PATCH", `/api/admin/users/${u.id}`, { disabled: !u.disabled });
                Object.assign(u, user);
                renderTable();
                toast(user.disabled ? "Доступ закрыт" : "Доступ открыт");
              }),
            }),
            h("button", {
              class: "icon-btn icon-btn--danger", type: "button", title: "Удалить", "aria-label": `Удалить ${u.name}`, text: "✕",
              onclick: () => act(async () => {
                if (!confirm(`Удалить ${u.name}? Доступ ко всем проектам пропадёт.`)) return;
                await api("DELETE", `/api/admin/users/${u.id}`);
                users.splice(users.indexOf(u), 1);
                renderTable();
                toast("Удалено");
              }),
            }))));
      }));
    }
    renderTable();

    root.replaceChildren(...shell(
      h("div", { class: "project-head" },
        h("div", {}, h("span", { class: "eyebrow mono", text: "Админка" }), h("h1", { class: "h1", text: "Люди" })),
        btn("Добавить", { onclick: () => openForm() })),
      h("div", { class: "stack mt-32" }, form, secretBox,
        h("div", { class: "card table-wrap" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, ["Имя", "Логин и контакт", "Роль и доступ", ""].map((t) => h("th", { text: t })))),
          tbody))),
    ));
  }

  /* ---------- Старт ---------- */
  api("GET", "/api/me", undefined, { allow401: true })
    .then(({ user }) => { me = user || null; })
    .catch(() => { me = null; })
    .finally(render);
})();
