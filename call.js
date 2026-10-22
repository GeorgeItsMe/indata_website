(() => {
  /* ---------- Запись на звонок: календарь → время → форма ---------- */
  // Свободное время считается на клиенте из рабочих часов по Москве, минус занятые слоты
  // (GET на адрес из data-endpoint формы). Заявка уходит туда же POST-запросом (JSON).
  const booker = document.getElementById("booker");
  if (!booker) return;

  const DURATION = 15;      // длительность звонка, мин
  const STEP = 30;          // шаг между слотами, мин
  const HOURS = [10, 19];   // рабочие часы по Москве
  const DAYS_AHEAD = 21;    // на сколько дней вперёд можно записаться
  const NOTICE = 120;       // не раньше чем через столько минут
  const MSK = 3;            // Москва — UTC+3 круглый год
  const HOLIDAYS = new Set([
    "01-01", "01-02", "01-03", "01-04", "01-05", "01-06", "01-07", "01-08",
    "02-23", "03-08", "05-01", "05-09", "06-12", "11-04",
  ]);
  const ZONES = [
    ["Europe/Kaliningrad", "Калининград"],
    ["Europe/Moscow", "Москва"],
    ["Europe/Samara", "Самара"],
    ["Asia/Yekaterinburg", "Екатеринбург"],
    ["Asia/Omsk", "Омск"],
    ["Asia/Novosibirsk", "Новосибирск"],
    ["Asia/Krasnoyarsk", "Красноярск"],
    ["Asia/Irkutsk", "Иркутск"],
    ["Asia/Yakutsk", "Якутск"],
    ["Asia/Vladivostok", "Владивосток"],
    ["Asia/Magadan", "Магадан"],
    ["Asia/Kamchatka", "Камчатка"],
  ];
  const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const MIN = 60_000;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const $ = (sel) => booker.querySelector(sel);
  const tzSelect = $("#tz");
  const monthName = $("[data-month]");
  const monthYear = $("[data-year]");
  const prevBtn = $("[data-prev]");
  const nextBtn = $("[data-next]");
  const daysEl = $("[data-days]");
  const slotsHead = $("[data-slots-head]");
  const slotsEl = $("[data-slots]");
  const whenDate = $("[data-when-date]");
  const whenTime = $("[data-when-time]");
  const form = $(".booker__form");
  const formError = $("[data-form-error]");
  const ERROR_TEXT = formError.textContent;
  const submitBtn = form.querySelector('[type="submit"]');
  const done = $(".booker__done");
  const required = [...form.querySelectorAll("[required]")];

  const pad = (n) => String(n).padStart(2, "0");
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const field = (name) => form.elements.namedItem(name);
  const monthIndex = (y, m) => y * 12 + m;
  const keyToDate = (key) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };

  // Даты календаря — «чистые» дни (UTC), время слотов — в выбранном поясе.
  const utc = (opts) => new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", ...opts });
  const F = {
    month: utc({ month: "long" }),
    weekday: utc({ weekday: "short" }),
    dayMonth: utc({ day: "numeric", month: "long" }),
  };
  const mskFmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  let tz = localZone();
  let fmt;                  // форматтеры под текущий пояс
  let byDay = new Map();    // "ГГГГ-ММ-ДД" → начала слотов, мс
  let view;                 // показанный месяц { y, m }
  let picked = null;        // выбранный день
  let slot = null;          // выбранное время
  let busy = new Set();     // занятые слоты, мс

  function localZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow";
    } catch {
      return "Europe/Moscow";
    }
  }

  function offsetLabel(zone) {
    try {
      const part = new Intl.DateTimeFormat("ru-RU", { timeZone: zone, timeZoneName: "shortOffset" })
        .formatToParts(Date.now())
        .find((p) => p.type === "timeZoneName");
      return part ? ` (${part.value})` : "";
    } catch {
      return "";
    }
  }

  function fillZones() {
    const zones = ZONES.some(([zone]) => zone === tz)
      ? ZONES
      : [[tz, tz.split("/").pop().replace(/_/g, " ")], ...ZONES];
    tzSelect.replaceChildren(...zones.map(([zone, city]) => new Option(city + offsetLabel(zone), zone, false, zone === tz)));
  }

  function makeFormatters() {
    const local = (opts) => new Intl.DateTimeFormat("ru-RU", { timeZone: tz, ...opts });
    fmt = {
      key: local({ year: "numeric", month: "2-digit", day: "2-digit" }),
      time: local({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
      long: local({ weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    };
  }

  function dayKey(ms) {
    const p = {};
    for (const { type, value } of fmt.key.formatToParts(ms)) p[type] = value;
    return `${p.year}-${p.month}-${p.day}`;
  }

  const longDate = (ms) => cap(fmt.long.format(ms).replace(/\s?г\.$/, ""));
  const timeRange = (ms) => `${fmt.time.format(ms)} – ${fmt.time.format(ms + DURATION * MIN)}`;

  /* ---------- Свободное время ---------- */
  function buildSlots() {
    const now = Date.now();
    const earliest = now + NOTICE * MIN;
    const msk = new Date(now + MSK * 60 * MIN); // «сегодня» по Москве
    const slots = [];
    for (let i = 0; i <= DAYS_AHEAD; i++) {
      const day = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + i));
      const weekday = day.getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      if (HOLIDAYS.has(`${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`)) continue;
      for (let m = HOURS[0] * 60; m + DURATION <= HOURS[1] * 60; m += STEP) {
        const t = day.getTime() + (m - MSK * 60) * MIN;
        if (t >= earliest && !busy.has(t)) slots.push(t);
      }
    }
    return slots;
  }

  function regroup() {
    makeFormatters();
    byDay = new Map();
    for (const t of buildSlots()) {
      const key = dayKey(t);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(t);
    }
    if (!byDay.has(picked)) picked = byDay.keys().next().value ?? null;
    const base = keyToDate(picked ?? dayKey(Date.now()));
    view = { y: base.getUTCFullYear(), m: base.getUTCMonth() };
  }

  function refresh() {
    regroup();
    renderMonth();
    renderSlots();
  }

  async function loadBusy() {
    const url = form.dataset.endpoint;
    if (!url) return;
    try {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const { busy: list } = await res.json();
      busy = new Set(list.map(Date.parse));
      refresh();
    } catch (err) {
      // Без списка занятых форма всё равно работает: занятое время отклонит сервер (409).
      console.warn("Не удалось загрузить занятое время:", err);
    }
  }

  /* ---------- Календарь ---------- */
  function monthBounds() {
    const keys = [...byDay.keys()];
    const first = keyToDate(dayKey(Date.now()));
    const last = keys.length ? keyToDate(keys[keys.length - 1]) : first;
    return [
      monthIndex(first.getUTCFullYear(), first.getUTCMonth()),
      monthIndex(last.getUTCFullYear(), last.getUTCMonth()),
    ];
  }

  function renderMonth() {
    const { y, m } = view;
    const first = new Date(Date.UTC(y, m, 1));
    monthName.textContent = cap(F.month.format(first));
    monthYear.textContent = y;

    const lead = (first.getUTCDay() + 6) % 7; // неделя начинается с понедельника
    const total = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const cells = Math.ceil((lead + total) / 7) * 7;
    const today = dayKey(Date.now());
    const frag = document.createDocumentFragment();
    for (let i = 0; i < lead; i++) frag.append(document.createElement("span"));
    // Хвост последней недели добиваем днями следующего месяца, как в Cal.com.
    for (let i = lead; i < cells; i++) {
      const date = new Date(Date.UTC(y, m, i - lead + 1));
      const key = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
      const free = byDay.has(key);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "day";
      btn.textContent = date.getUTCDate();
      btn.dataset.key = key;
      btn.disabled = !free;
      btn.classList.toggle("is-free", free);
      btn.classList.toggle("is-today", key === today);
      btn.setAttribute("aria-pressed", String(key === picked));
      btn.setAttribute("aria-label", F.dayMonth.format(date) + (free ? "" : ", нет свободного времени"));
      if (date.getUTCMonth() !== m && date.getUTCDate() === 1) {
        const badge = document.createElement("span");
        badge.className = "day__badge";
        badge.textContent = MONTHS_SHORT[date.getUTCMonth()];
        btn.append(badge);
      }
      frag.append(btn);
    }
    daysEl.replaceChildren(frag);

    const [min, max] = monthBounds();
    prevBtn.disabled = monthIndex(y, m) <= min;
    nextBtn.disabled = monthIndex(y, m) >= max;
  }

  function shiftMonth(delta) {
    const i = monthIndex(view.y, view.m) + delta;
    view = { y: Math.floor(i / 12), m: i % 12 };
    renderMonth();
  }

  function renderSlots() {
    if (!picked) {
      slotsHead.textContent = "";
      const empty = document.createElement("p");
      empty.className = "slots__empty";
      empty.textContent = "В ближайшие недели свободного времени нет.";
      slotsEl.replaceChildren(empty);
      return;
    }
    const date = keyToDate(picked);
    const sub = document.createElement("span");
    sub.textContent = F.dayMonth.format(date);
    slotsHead.replaceChildren(cap(F.weekday.format(date)), " ", sub);
    slotsEl.replaceChildren(...byDay.get(picked).map((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot";
      btn.dataset.t = t;
      btn.textContent = fmt.time.format(t);
      return btn;
    }));
    slotsEl.scrollTop = 0;
  }

  /* ---------- Шаги ---------- */
  function setView(name, focusEl) {
    booker.dataset.view = name;
    // На телефоне виджет длинный: если его верх уехал за экран, возвращаем к началу шага.
    if (booker.getBoundingClientRect().top < 0) {
      booker.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    }
    focusEl?.focus({ preventScroll: true });
  }

  function fillWhen() {
    whenDate.textContent = longDate(slot);
    whenTime.textContent = timeRange(slot);
  }

  function openForm(t) {
    slot = t;
    fillWhen();
    formError.hidden = true;
    setView("form", field("name"));
  }

  /* ---------- Форма ---------- */
  function check(el) {
    let msg = "";
    if (el.type === "checkbox") msg = el.checked ? "" : "Без согласия не сможем принять заявку";
    else if (!el.value.trim()) msg = "Обязательное поле";
    else if (el.type === "email" && !el.validity.valid) msg = "Проверьте адрес почты";
    const box = el.closest(".field");
    box.classList.toggle("is-invalid", Boolean(msg));
    box.querySelector(".field__error").textContent = msg;
    el.setAttribute("aria-invalid", String(Boolean(msg)));
    return !msg;
  }

  function payload() {
    const value = (name) => field(name).value.trim();
    return {
      name: value("name"),
      email: value("email"),
      contact: value("contact"),
      notes: value("notes"),
      start: new Date(slot).toISOString(),
      startMsk: `${mskFmt.format(slot)} МСК`,
      duration: DURATION,
      timezone: tz,
      timezoneLabel: tzSelect.selectedOptions[0].textContent,
      page: location.href,
    };
  }

  // Ответ обработчика (server/booking): { ok, joinUrl — ссылка в Телемосте или null, emailed }.
  async function send(data) {
    const url = form.dataset.endpoint;
    if (!url) {
      // Обработчик ещё не подключён: локально показываем успех, на сайте — честную ошибку.
      if (["localhost", "127.0.0.1", ""].includes(location.hostname)) {
        console.info("Заявка на звонок (демо, data-endpoint не задан):", data);
        return { ok: true, joinUrl: null, emailed: false };
      }
      throw new Error("У формы записи не задан data-endpoint");
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.status === 409) throw Object.assign(new Error("Время уже недоступно"), { code: "slot" });
    if (!res.ok) throw new Error(`Заявка не отправилась: HTTP ${res.status}`);
    return res.json();
  }

  function setBusy(on) {
    submitBtn.setAttribute("aria-busy", String(on));
    submitBtn.textContent = on ? "Отправляем…" : "Подтвердить";
  }

  function showDone(data, result) {
    const { joinUrl, emailed } = result;
    $("[data-done-title]").textContent = joinUrl ? "Встреча запланирована" : "Заявка отправлена";
    $("[data-done-text]").textContent = !joinUrl
      ? "Подтвердим время и пришлём ссылку на звонок на почту."
      : emailed
        ? "Приглашение со ссылкой отправили на почту."
        : "Сохраните ссылку — по ней подключитесь в назначенное время.";
    const link = $("[data-done-link]");
    link.hidden = !joinUrl;
    if (joinUrl) {
      const a = link.querySelector("a");
      a.href = joinUrl;
      a.textContent = joinUrl.replace(/^https?:\/\//, "");
    }
    $("[data-done-when]").textContent = `${longDate(slot)}, ${timeRange(slot)}\n${tzSelect.selectedOptions[0].textContent}`;
    $("[data-done-who]").textContent = [data.name, data.email, data.contact].filter(Boolean).join("\n");
    const notes = $("[data-done-notes]");
    notes.hidden = !data.notes;
    notes.querySelector("dd").textContent = data.notes;
    setView("done", done);
  }

  /* ---------- События ---------- */
  daysEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".day.is-free");
    if (!btn) return;
    picked = btn.dataset.key;
    for (const day of daysEl.querySelectorAll(".day")) day.setAttribute("aria-pressed", String(day === btn));
    renderSlots();
  });
  slotsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".slot");
    if (btn) openForm(Number(btn.dataset.t));
  });
  prevBtn.addEventListener("click", () => shiftMonth(-1));
  nextBtn.addEventListener("click", () => shiftMonth(1));

  tzSelect.addEventListener("change", () => {
    tz = tzSelect.value;
    refresh();
    if (slot !== null) fillWhen();
  });

  form.querySelector("[data-back]").addEventListener("click", () => {
    setView("pick", slotsEl.querySelector(`[data-t="${slot}"]`));
  });

  for (const el of required) {
    el.addEventListener(el.type === "checkbox" ? "change" : "input", () => {
      if (el.closest(".field").classList.contains("is-invalid")) check(el);
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitBtn.getAttribute("aria-busy") === "true") return;
    const invalid = required.filter((el) => !check(el));
    if (invalid.length) {
      invalid[0].focus();
      return;
    }
    const data = payload();
    formError.hidden = true;
    setBusy(true);
    try {
      // Ловушка для ботов: людям поле не видно, а боты его заполняют.
      const result = field("website").value ? { ok: true, joinUrl: null } : await send(data);
      showDone(data, result);
    } catch (err) {
      console.error(err);
      formError.textContent = err.code === "slot" ? "Это время уже недоступно — вернитесь и выберите другое." : ERROR_TEXT;
      formError.hidden = false;
      if (err.code === "slot") loadBusy();
    } finally {
      setBusy(false);
    }
  });

  fillZones();
  refresh();
  loadBusy();
})();
