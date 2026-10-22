/* Кабинет клиента InData: одна страница, маршруты в адресной строке.
   Весь текст из данных вставляется через textContent — никакого innerHTML с данными. */
(() => {
  "use strict";

  const root = document.getElementById("app");
  const CONTACT = { label: "@geosibik", url: "https://t.me/geosibik" };
  const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const STATUS_LABELS = { todo: "Впереди", active: "В работе", done: "Готово" };
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
    { re: /^\/account$/, view: viewAccount },
    { re: /^\/admin$/, view: viewAdminProjects, access: "admin" },
    { re: /^\/admin\/clients$/, view: viewAdminClients, access: "admin" },
    { re: /^\/admin\/p\/([\w-]+)$/, view: viewAdminProject, access: "admin" },
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
        [["/admin", "Проекты"], ["/admin/clients", "Клиенты"]].map(([href, label]) => {
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
    if (projects.length === 1) return viewProject(alive, projects[0].id);
    root.replaceChildren(...shell(
      h("span", { class: "eyebrow mono", text: me.company || "Кабинет клиента" }),
      h("h1", { class: "h1", text: projects.length ? "Ваши проекты" : "Здесь появится ваш проект" }),
      projects.length
        ? h("div", { class: "projects" }, projects.map(projectCard))
        : h("p", { class: "lead", text: "Мы добавим его, как только начнём работу. Если что-то нужно уже сейчас, напишите нам в Telegram." }),
      contactBlock(),
    ));
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
        h("span", { class: "mono", text: `Обновлено ${fmtDate(p.updatedAt)}` })));
  }

  async function viewProject(alive, id) {
    loading();
    const { project: p } = await api("GET", `/api/projects/${id}`);
    if (!alive()) return;
    const active = p.stages.find((s) => s.status === "active");
    const finished = p.stages.length > 0 && p.stages.every((s) => s.status === "done");
    const pct = progressOf(p.stages);

    const head = h("div", { class: "project-head" },
      h("div", {},
        h("span", { class: "eyebrow mono", text: me.role === "admin" ? "Так проект видит клиент" : "Проект" }),
        h("h1", { class: "h1", text: p.title }),
        p.summary ? h("p", { class: "lead", text: p.summary }) : null),
      me.role === "admin"
        ? h("div", { class: "actions" }, btn("Редактировать", { href: `/admin/p/${p.id}`, variant: "light" }))
        : null);

    const status = h("section", { class: "status", "aria-label": "Статус проекта" },
      h("div", { class: "status__num", text: `${pct}%` }),
      h("p", { class: "status__now" },
        finished ? "Проект завершён" : active ? `Сейчас: ${active.title}` : "Скоро начнём",
        h("small", { text: active && active.end ? `Плановый срок этапа: ${fmtDate(active.end)}` : `Обновлено ${fmtDate(p.updatedAt)}` })),
      h("div", { class: "bar" }, h("i", { vars: { "--p": `${pct}%` } })));

    root.replaceChildren(...shell(
      head,
      status,
      p.stages.length ? stagesStrip(p.stages) : null,
      h("div", { class: "columns" },
        h("section", { "aria-labelledby": "feed-title" },
          h("div", { class: "section-head" }, h("h2", { class: "h2", id: "feed-title", text: "Что нового" })),
          feed(p.updates)),
        h("div", { class: "stack" },
          paymentsCard(p.payments),
          filesCard(p))),
      contactBlock(),
    ));
  }

  function stagesStrip(stages) {
    return h("ol", { class: "stages", vars: { "--n": String(stages.length) } }, stages.map((s) => h("li", { class: `stage is-${s.status}` },
      h("span", { class: "stage__dot", "aria-hidden": "true" }),
      h("p", { class: "stage__title", text: s.title }),
      h("p", { class: "stage__dates mono", text: [STATUS_LABELS[s.status], fmtRange(s.start, s.end)].filter(Boolean).join(" · ") }),
      s.note ? h("p", { class: "stage__note", text: s.note }) : null)));
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

    const title = h("input", { class: "input", required: true, maxlength: "160", placeholder: "Например, Доработка платформы клуба" });
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
          const { project } = await api("POST", "/api/admin/projects", { title: title.value, clientIds: picks.value() });
          navigate(`/admin/p/${project.id}`);
        } catch (err) {
          error.textContent = errorText(err);
          error.hidden = false;
          create.disabled = false;
        }
      },
    },
    h("h2", { class: "h2", text: "Новый проект" }),
    h("label", { class: "field" }, h("span", { text: "Название" }), title),
    h("div", { class: "field" }, h("span", { text: "Кому открыть" }), picks.el),
    error,
    h("div", { class: "actions" }, create, btn("Отмена", { variant: "light", onclick: () => { form.hidden = true; } })));

    root.replaceChildren(...shell(
      h("div", { class: "project-head" },
        h("div", {}, h("span", { class: "eyebrow mono", text: "Админка" }), h("h1", { class: "h1", text: "Проекты" })),
        btn("Новый проект", { onclick: () => { form.hidden = false; title.focus(); } })),
      h("div", { class: "stack mt-24" }, form),
      projects.length
        ? h("div", { class: "projects" }, projects.map((p) => projectCard(p, `/admin/p/${p.id}`)))
        : h("p", { class: "lead", text: "Проектов пока нет. Создайте первый и откройте его клиенту." }),
    ));
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
    const [{ project }, { users }] = await Promise.all([api("GET", `/api/projects/${id}`), api("GET", "/api/admin/users")]);
    if (!alive()) return;
    let p = project;
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
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: x.paid, onchange: (e) => { x.paid = e.target.checked; if (!x.paid) x.paidAt = ""; markDirty(); } }), "Оплачено"),
        h("button", { class: "icon-btn icon-btn--danger", type: "button", title: "Удалить", "aria-label": "Удалить платёж", text: "✕", onclick: () => { payments.splice(i, 1); renderPayments(); markDirty(); } }))));
    }
    renderPayments();

    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      try {
        const res = await api("PATCH", `/api/admin/projects/${p.id}`, {
          title: titleInput.value,
          summary: summaryInput.value,
          clientIds: picks.value(),
          stages: stages.map((s) => ({ ...s, title: s.title.trim() })).filter((s) => s.title),
          payments: payments.filter((x) => x.title.trim()).map((x) => ({ ...x, amount: Number(x.amount) || 0 })),
        });
        p = res.project;
        stages.splice(0, stages.length, ...structuredClone(p.stages));
        payments.splice(0, payments.length, ...structuredClone(p.payments));
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
        h("div", {}, link("/admin", { class: "eyebrow mono" }, "← Все проекты"), heading),
        h("div", { class: "actions" }, btn("Как видит клиент", { href: `/p/${p.id}`, variant: "light" }))),
      h("div", { class: "editor" },
        h("section", { class: "card form" },
          h("h2", { class: "h2", text: "Основное" }),
          h("label", { class: "field" }, h("span", { text: "Название" }), titleInput),
          h("label", { class: "field" }, h("span", { text: "Описание" }), summaryInput),
          h("div", { class: "field" }, h("span", { text: "Кому открыт проект" }), picks.el)),
        h("section", { class: "card form" },
          h("div", { class: "section-head" }, h("h2", { class: "h2", text: "Этапы" }), h("span", { class: "mono", text: "Прогресс считается по статусам этапов" })),
          h("div", { class: "edit-head edit-head--stage" }, ["Этап", "Статус", "Начало", "Срок", "Комментарий", ""].map((t) => h("span", { text: t }))),
          stageRows,
          h("div", { class: "actions" }, btn("Добавить этап", {
            variant: "light",
            small: true,
            onclick: () => { stages.push({ id: "", title: "", status: "todo", start: "", end: "", note: "" }); renderStages(); markDirty(); stageRows.lastElementChild.querySelector("input").focus(); },
          }))),
        h("section", { class: "card form" },
          h("h2", { class: "h2", text: "Оплаты" }),
          h("div", { class: "edit-head edit-head--pay" }, ["Платёж", "Сумма, ₽", "Оплатить до", "", ""].map((t) => h("span", { text: t }))),
          payRows,
          h("div", { class: "actions" }, btn("Добавить платёж", {
            variant: "light",
            small: true,
            onclick: () => { payments.push({ id: "", title: "", amount: "", due: "", paid: false, paidAt: "" }); renderPayments(); markDirty(); payRows.lastElementChild.querySelector("input").focus(); },
          }))),
        saveBar,
        h("section", { class: "card stack" },
          h("h2", { class: "h2", text: "Лента обновлений" }),
          postForm,
          feedBox),
        h("section", { class: "card stack" },
          h("div", { class: "section-head" }, h("h2", { class: "h2", text: "Документы" }), h("span", { class: "mono", text: "До 25 МБ на файл" })),
          h("div", { class: "upload" }, uploadBtn, fileInput),
          filesBox),
        h("div", { class: "actions" }, removeBtn)),
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
    const { users } = await api("GET", "/api/admin/users");
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
        h("p", {}, isNew ? `Клиент ${user.name} создан. ` : `Новый пароль для ${user.name}. `, h("span", { class: "muted", text: "Пароль показываем один раз: отправьте его клиенту сейчас." })),
        h("pre", { text }),
        h("div", { class: "actions" }, copy, btn("Готово", { variant: "light", small: true, onclick: () => secretBox.replaceChildren() }))));
      secretBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    const name = h("input", { class: "input", required: true, maxlength: "120", placeholder: "Иван Петров" });
    const company = h("input", { class: "input", maxlength: "120", placeholder: "Empire Poker Club" });
    const login = h("input", { class: "input", required: true, maxlength: "64", autocapitalize: "none", spellcheck: "false", placeholder: "empire" });
    const role = h("select", { class: "select" }, h("option", { value: "client", text: "Клиент" }), h("option", { value: "admin", text: "Сотрудник InData (админ)" }));
    const error = h("p", { class: "form__error", hidden: true });
    const create = btn("Создать и выдать пароль", { type: "submit" });
    const form = h("form", {
      class: "card form",
      hidden: true,
      async onsubmit(e) {
        e.preventDefault();
        error.hidden = true;
        create.disabled = true;
        try {
          const res = await api("POST", "/api/admin/users", { name: name.value, company: company.value, login: login.value, role: role.value });
          users.push(res.user);
          form.reset();
          form.hidden = true;
          renderTable();
          showSecret(res.user, res.password, true);
        } catch (err) {
          error.textContent = errorText(err);
          error.hidden = false;
        } finally {
          create.disabled = false;
        }
      },
    },
    h("h2", { class: "h2", text: "Новый клиент" }),
    h("div", { class: "grid-2" },
      h("label", { class: "field" }, h("span", { text: "Имя" }), name),
      h("label", { class: "field" }, h("span", { text: "Компания" }), company)),
    h("div", { class: "grid-2" },
      h("label", { class: "field" }, h("span", { text: "Логин: латиница, цифры, точка или дефис" }), login),
      h("label", { class: "field" }, h("span", { text: "Роль" }), role)),
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
          h("td", { class: "mono", text: u.login }),
          h("td", { text: u.role === "admin" ? "Админ" : u.disabled ? "Заблокирован" : "Клиент" }),
          h("td", {}, self ? h("span", { class: "mono", text: "это вы" }) : h("div", { class: "actions" },
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
                if (!confirm(`Удалить ${u.name}? Клиент потеряет доступ ко всем проектам.`)) return;
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
        h("div", {}, h("span", { class: "eyebrow mono", text: "Админка" }), h("h1", { class: "h1", text: "Клиенты" })),
        btn("Новый клиент", { onclick: () => { form.hidden = false; name.focus(); } })),
      h("div", { class: "stack mt-32" }, form, secretBox,
        h("div", { class: "card table-wrap" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, ["Имя", "Логин", "Роль", ""].map((t) => h("th", { text: t })))),
          tbody))),
    ));
  }

  /* ---------- Старт ---------- */
  api("GET", "/api/me", undefined, { allow401: true })
    .then(({ user }) => { me = user || null; })
    .catch(() => { me = null; })
    .finally(render);
})();
