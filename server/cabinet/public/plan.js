/* Роадмап (как Timeline в Jira): эпики и задачи на шкале времени, сроки двигаются мышкой.
   Отчёты: сгорание активного спринта, скорость по закрытым спринтам, загрузка людей, табель времени. */
(() => {
  "use strict";

  const I = window.InData;
  const W = I.work;
  const { h, btn, fmtDate, today, plural, api, errorText, toast, loading, CLIENT } = I;
  const { svg, typeIcon, avatar, statusPill, hrs, addDays, localDate, nameOf, select, download, DAY } = W;

  /* ---------- Роадмап ---------- */
  const SCALES = { weeks: ["Недели", 30], months: ["Месяцы", 9], quarters: ["Кварталы", 3.2] };
  const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const MONTHS_FULL = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const roadState = new Map();
  const dayIndex = (from, isoDate) => Math.round((Date.parse(isoDate) - Date.parse(from)) / DAY);

  async function viewRoadmap(alive, id) {
    loading();
    let data = await W.loadSpace(id);
    if (!alive()) return;
    if (!roadState.has(id)) roadState.set(id, { scale: "months", expanded: new Set(), loose: true, scrolled: false });
    const st = roadState.get(id);
    st.scrolled = false;
    const reload = async () => {
      try {
        data = await W.loadSpace(id);
        if (alive()) draw();
      } catch {}
    };
    let timer;
    W.live(`/api/work/projects/${id}/events?client=${CLIENT}`, {
      issues: (ev) => { if (ev.client !== CLIENT && !dragState) { clearTimeout(timer); timer = setTimeout(reload, 300); } },
    }, { onResync: reload });
    const onChange = (issue, removed) => { W.mergeIssue(data, issue, removed); draw(); };
    let dragState = null;

    function range() {
      const dates = data.issues.flatMap((i) => [i.start, i.due]).filter(Boolean).sort();
      let from = addDays(today(), -30);
      let to = addDays(today(), 120);
      if (dates.length) {
        if (dates[0] < addDays(from, 14)) from = addDays(dates[0], -14);
        if (dates[dates.length - 1] > addDays(to, -30)) to = addDays(dates[dates.length - 1], 45);
      }
      from = `${from.slice(0, 7)}-01`; // с первого числа месяца, шкала ровнее
      return { from, days: dayIndex(from, to) + 1 };
    }

    function header(from, days, dayW) {
      const top = [];
      const bottom = [];
      for (let d = 0; d < days;) {
        const date = addDays(from, d);
        const [y, m] = date.split("-").map(Number);
        const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
        const len = Math.min(days - d, dayIndex(date, next));
        top.push(h("div", { class: "rm-head__cell", vars: { "--x": `${d * dayW}px`, "--w": `${len * dayW}px` }, text: st.scale === "quarters" ? `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}` : `${MONTHS_FULL[m - 1]} ${y}` }));
        d += len;
      }
      if (st.scale === "weeks") {
        for (let d = 0; d < days; d++) {
          const date = new Date(Date.parse(addDays(from, d)));
          const wd = date.getUTCDay();
          bottom.push(h("div", { class: `rm-head__day${wd === 0 || wd === 6 ? " is-weekend" : ""}`, vars: { "--x": `${d * dayW}px`, "--w": `${dayW}px` }, text: String(date.getUTCDate()) }));
        }
      } else if (st.scale === "months") {
        // Понедельники: начало недели
        for (let d = 0; d < days; d++) {
          const date = new Date(Date.parse(addDays(from, d)));
          if (date.getUTCDay() === 1) bottom.push(h("div", { class: "rm-head__day", vars: { "--x": `${d * dayW}px`, "--w": `${7 * dayW}px` }, text: String(date.getUTCDate()) }));
        }
      }
      return h("div", { class: "rm-head__track", vars: { "--w": `${days * dayW}px` } },
        h("div", { class: "rm-head__row" }, top),
        bottom.length ? h("div", { class: "rm-head__row rm-head__row--sub" }, bottom) : null);
    }

    function bar(i, from, dayW) {
      if (!i.start && !i.due) return null;
      const s = i.start || i.due;
      const e = i.due || i.start;
      const x = dayIndex(from, s) * dayW;
      const w = Math.max(dayW, (dayIndex(s, e) + 1) * dayW);
      const children = i.type === "epic" ? data.issues.filter((c) => c.epicId === i.id) : [];
      const done = children.filter((c) => c.status === "done").length;
      const pct = i.type === "epic" ? (children.length ? Math.round((done / children.length) * 100) : 0) : i.status === "done" ? 100 : 0;
      const el = h("div", {
        class: `rm-bar is-${i.type === "epic" ? "epic" : i.status}${i.start && i.due ? "" : " is-point"}`,
        vars: { "--x": `${x}px`, "--w": `${w}px`, "--p": `${pct}%` },
        title: `${i.key} ${i.title}\n${fmtDate(s)} – ${fmtDate(e)}${i.type === "epic" ? `\nГотово ${done} из ${children.length}` : ""}\nПеретащите, чтобы сдвинуть; за край, чтобы изменить срок`,
      },
      h("span", { class: "rm-bar__fill" }),
      h("span", { class: "rm-bar__handle rm-bar__handle--l", "data-edge": "start" }),
      h("span", { class: "rm-bar__label", text: i.title }),
      h("span", { class: "rm-bar__handle rm-bar__handle--r", "data-edge": "end" }));
      el.addEventListener("pointerdown", (ev) => startDrag(ev, el, i, s, e, dayW));
      return el;
    }

    function startDrag(ev, el, issue, s, e, dayW) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const edge = ev.target.dataset.edge || "move";
      const x0 = ev.clientX;
      const left0 = parseFloat(el.style.getPropertyValue("--x"));
      const width0 = parseFloat(el.style.getPropertyValue("--w"));
      let shift = 0;
      dragState = { issue };
      el.setPointerCapture(ev.pointerId);
      el.classList.add("is-dragging");
      const tip = h("div", { class: "rm-tip mono" });
      el.append(tip);
      const dates = () => {
        const ns = edge === "end" ? s : addDays(s, shift);
        let ne = edge === "start" ? e : addDays(e, shift);
        const startOut = edge === "start" && ns > ne ? ne : ns;
        if (edge === "end" && ne < s) ne = s;
        return [startOut, ne];
      };
      const onMove = (m) => {
        shift = Math.round((m.clientX - x0) / dayW);
        if (edge === "move") el.style.setProperty("--x", `${left0 + shift * dayW}px`);
        if (edge === "start") {
          const d = Math.min(shift, Math.round(width0 / dayW) - 1);
          shift = d;
          el.style.setProperty("--x", `${left0 + d * dayW}px`);
          el.style.setProperty("--w", `${width0 - d * dayW}px`);
        }
        if (edge === "end") {
          const d = Math.max(shift, 1 - Math.round(width0 / dayW));
          shift = d;
          el.style.setProperty("--w", `${width0 + d * dayW}px`);
        }
        const [a, b] = dates();
        tip.textContent = `${fmtDate(a)} – ${fmtDate(b)}`;
      };
      const onUp = async () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        dragState = null;
        if (!shift) {
          tip.remove();
          el.classList.remove("is-dragging");
          if (edge === "move") W.openIssue(issue.id, { space: data, onChange });
          return;
        }
        const [start, due] = dates();
        const prev = { start: issue.start, due: issue.due };
        Object.assign(issue, { start, due });
        draw();
        try {
          W.mergeIssue(data, (await api("PATCH", `/api/work/issues/${issue.id}`, { start, due })).issue);
          toast(`${issue.key}: ${fmtDate(start)} – ${fmtDate(due)}`);
        } catch (err) {
          Object.assign(issue, prev);
          toast(errorText(err));
        }
        draw();
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    }

    // Клик по пустой шкале задаёт даты: эпику месяц, задаче неделю.
    async function setDates(issue, ev, from, dayW) {
      const rect = ev.currentTarget.getBoundingClientRect();
      const start = addDays(from, Math.floor((ev.clientX - rect.left) / dayW));
      const due = addDays(start, issue.type === "epic" ? 27 : 4);
      try {
        W.mergeIssue(data, (await api("PATCH", `/api/work/issues/${issue.id}`, { start, due })).issue);
        draw();
        toast(`${issue.key}: ${fmtDate(start)} – ${fmtDate(due)}`);
      } catch (err) {
        toast(errorText(err));
      }
    }

    function row(i, { level = 0, from, days, dayW, toggle = null, open = false, count = "" } = {}) {
      const children = i.type === "epic" ? data.issues.filter((c) => c.epicId === i.id) : [];
      const done = children.filter((c) => c.status === "done").length;
      return h("div", { class: `rm-row${i.type === "epic" ? " rm-row--epic" : ""}${i.status === "done" ? " is-done" : ""}` },
        h("div", { class: "rm-row__name", vars: { "--level": String(level) } },
          toggle ? h("button", { class: `rm-toggle${open ? " is-open" : ""}`, type: "button", "aria-label": open ? "Свернуть" : "Развернуть", "aria-expanded": String(open), onclick: toggle }, W.ico("chevron")) : h("span", { class: "rm-toggle rm-toggle--none" }),
          typeIcon(i.type),
          h("button", { class: "rm-row__title", type: "button", title: `${i.key} ${i.title}`, onclick: () => W.openIssue(i.id, { space: data, onChange }) },
            h("span", { class: "mono", text: i.key }), h("span", { text: i.title })),
          i.type === "epic" ? h("span", { class: "mono rm-row__count", text: children.length ? `${done}/${children.length}` : count }) : statusPill(i.status)),
        h("div", {
          class: `rm-row__track${!i.start && !i.due ? " is-empty" : ""}`,
          vars: { "--w": `${days * dayW}px` },
          title: !i.start && !i.due ? "Нажмите, чтобы поставить даты" : null,
          onclick: (ev) => { if (!i.start && !i.due && ev.target === ev.currentTarget) setDates(i, ev, from, dayW); },
        }, bar(i, from, dayW)));
    }

    function draw() {
      const { from, days } = range();
      const dayW = SCALES[st.scale][1];
      const todayX = dayIndex(from, today()) * dayW;
      const epics = W.epicsOf(data).sort((a, b) => (a.start || a.due || "9999").localeCompare(b.start || b.due || "9999") || a.rank - b.rank);
      const loose = data.issues.filter((i) => i.type !== "epic" && !i.epicId && (i.start || i.due));
      const rows = [];
      for (const e of epics) {
        const open = st.expanded.has(e.id);
        rows.push(row(e, { from, days, dayW, open, toggle: () => { if (open) st.expanded.delete(e.id); else st.expanded.add(e.id); draw(); } }));
        if (open) {
          const kids = data.issues.filter((c) => c.epicId === e.id).sort((a, b) => (a.start || a.due || "9999").localeCompare(b.start || b.due || "9999") || a.rank - b.rank);
          for (const c of kids) rows.push(row(c, { level: 1, from, days, dayW }));
        }
      }
      if (loose.length) {
        rows.push(h("div", { class: "rm-row rm-row--group" },
          h("div", { class: "rm-row__name" },
            h("button", { class: `rm-toggle${st.loose ? " is-open" : ""}`, type: "button", "aria-expanded": String(st.loose), onclick: () => { st.loose = !st.loose; draw(); } }, W.ico("chevron")),
            h("b", { text: "Задачи без эпика" }), h("span", { class: "mono rm-row__count", text: String(loose.length) })),
          h("div", { class: "rm-row__track", vars: { "--w": `${days * dayW}px` } })));
        if (st.loose) for (const i of loose.sort((a, b) => (a.start || a.due).localeCompare(b.start || b.due))) rows.push(row(i, { level: 1, from, days, dayW }));
      }
      const scroller = h("div", { class: "rm-scroll" },
        h("div", { class: "rm", vars: { "--track": `${days * dayW}px`, "--today": `${todayX}px` } },
          h("div", { class: "rm-head" }, h("div", { class: "rm-head__name mono", text: epics.length ? `Эпики: ${epics.length}` : "" }), header(from, days, dayW)),
          h("div", { class: "rm-body" }, rows, h("div", { class: "rm-today", "aria-hidden": "true" }))));
      const old = document.querySelector(".rm-scroll");
      const keep = old ? old.scrollLeft : null;
      I.root.replaceChildren(...W.spaceShell(data, "roadmap", { onCreated: (issue) => { W.mergeIssue(data, issue); draw(); } },
        h("div", { class: "filters" },
          h("div", { class: "seg" }, Object.entries(SCALES).map(([k, [label]]) => h("button", { class: `seg__btn${st.scale === k ? " is-on" : ""}`, type: "button", text: label, onclick: () => { st.scale = k; st.scrolled = false; draw(); } }))),
          btn("Сегодня", { small: true, variant: "light", onclick: () => { scroller.scrollTo({ left: Math.max(0, todayX - scroller.clientWidth / 3), behavior: "smooth" }); } }),
          h("span", { class: "muted filters__hint", text: "Перетащите полосу, чтобы сдвинуть сроки, или потяните за край. Пустая строка: нажмите на шкалу." }),
          h("div", { class: "filters__end" }, btn("Новый эпик", { small: true, onclick: () => W.createIssue({ space: data, type: "epic", onCreated: (issue) => { W.mergeIssue(data, issue); st.expanded.add(issue.id); draw(); } }) }))),
        epics.length || loose.length
          ? scroller
          : h("div", { class: "empty-state" },
            h("h2", { class: "h2", text: "Роадмап пуст" }),
            h("p", { class: "lead", text: "Заведите эпики, то есть крупные куски работы вроде «Онлайн-покер» или «Интеграция с iiko», и поставьте им сроки. Задачи эпика раскрываются под ним." }),
            h("div", { class: "actions mt-24" }, btn("Новый эпик", { onclick: () => W.createIssue({ space: data, type: "epic", onCreated: (issue) => { W.mergeIssue(data, issue); draw(); } }) })))));
      if (keep !== null && st.scrolled) scroller.scrollLeft = keep;
      else {
        scroller.scrollLeft = Math.max(0, todayX - 280);
        st.scrolled = true;
      }
    }
    draw();
  }

  /* ---------- Отчёты ---------- */
  // Цвета рядов — первые слоты проверенной категориальной палитры; текст всегда цветом текста.
  const SERIES = ["#2a78d6", "#eb6834"];
  const REFERENCE = "#c4c4c0";
  const reportState = new Map();

  function niceMax(v) {
    if (v <= 0) return 4;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p;
    return 10 * p;
  }
  const num = (v) => String(Math.round(v * 10) / 10).replace(".", ",");

  // Линейный график с перекрестием и подсказкой. series: [{ name, color, values, reference }]
  function lineChart({ labels, series, unit = "" }) {
    const W0 = 720;
    const H0 = 260;
    const pad = { l: 40, r: 64, t: 16, b: 30 };
    const max = niceMax(Math.max(...series.flatMap((s) => s.values.filter((v) => v !== null))));
    const x = (k) => pad.l + (labels.length < 2 ? 0 : (k / (labels.length - 1)) * (W0 - pad.l - pad.r));
    const y = (v) => pad.t + (1 - v / max) * (H0 - pad.t - pad.b);
    const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
    const every = Math.ceil(labels.length / 8);
    const tip = h("div", { class: "viz-tip", hidden: true });
    const cross = svg("line", { class: "viz-cross", y1: pad.t, y2: H0 - pad.b, x1: 0, x2: 0, visibility: "hidden" });
    const dots = series.map((s) => svg("circle", { r: "4.5", fill: s.color, stroke: "#fff", "stroke-width": "2", visibility: "hidden" }));
    const chart = svg("svg", { class: "viz-svg", viewBox: `0 0 ${W0} ${H0}`, role: "img", "aria-label": series.map((s) => s.name).join(", ") },
      ticks.map((t) => [
        svg("line", { class: "viz-grid", x1: pad.l, x2: W0 - pad.r, y1: y(t), y2: y(t) }),
        svg("text", { class: "viz-axis", x: pad.l - 8, y: y(t) + 4, "text-anchor": "end" }, num(t)),
      ]),
      // Подписи через равный шаг; последняя всегда, а соседняя с ней пропускается, чтобы не налезали.
      labels.map((l, k) => {
        const lastK = labels.length - 1;
        const show = k === lastK || (k % every === 0 && lastK - k >= Math.max(2, every * 0.75));
        return show ? svg("text", { class: "viz-axis", x: x(k), y: H0 - 8, "text-anchor": k === lastK ? "end" : "middle" }, l) : null;
      }),
      series.map((s) => {
        const pts = s.values.map((v, k) => (v === null ? null : `${x(k)},${y(v)}`)).filter(Boolean);
        const lastK = s.values.reduce((acc, v, k) => (v === null ? acc : k), -1);
        return [
          svg("polyline", { points: pts.join(" "), fill: "none", stroke: s.color, "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round" }),
          lastK >= 0 && !s.reference ? [
            svg("circle", { cx: x(lastK), cy: y(s.values[lastK]), r: "4", fill: s.color, stroke: "#fff", "stroke-width": "2" }),
            svg("text", { class: "viz-label", x: x(lastK) + 10, y: y(s.values[lastK]) + 4 }, `${num(s.values[lastK])}${unit}`),
          ] : null,
        ];
      }),
      cross, dots,
      svg("rect", { class: "viz-hit", x: pad.l, y: pad.t, width: W0 - pad.l - pad.r, height: H0 - pad.t - pad.b, fill: "transparent" }));
    const box = h("div", { class: "viz-plot" }, chart, tip);
    const hit = chart.querySelector(".viz-hit");
    hit.addEventListener("pointermove", (e) => {
      const r = chart.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W0;
      const k = Math.max(0, Math.min(labels.length - 1, Math.round(((px - pad.l) / (W0 - pad.l - pad.r)) * (labels.length - 1))));
      cross.setAttribute("x1", x(k));
      cross.setAttribute("x2", x(k));
      cross.setAttribute("visibility", "visible");
      series.forEach((s, n) => {
        const v = s.values[k];
        dots[n].setAttribute("visibility", v === null ? "hidden" : "visible");
        if (v !== null) { dots[n].setAttribute("cx", x(k)); dots[n].setAttribute("cy", y(v)); }
      });
      tip.replaceChildren(h("b", { text: labels[k] }), ...series.map((s) => h("span", { class: "viz-tip__row" }, h("i", { vars: { "--c": s.color } }), `${s.name}: `, h("b", { text: s.values[k] === null ? "нет" : `${num(s.values[k])}${unit}` }))));
      tip.hidden = false;
      const left = (x(k) / W0) * r.width;
      tip.style.left = `${Math.min(r.width - 170, Math.max(0, left + 12))}px`;
      tip.style.top = "8px";
    });
    hit.addEventListener("pointerleave", () => {
      tip.hidden = true;
      cross.setAttribute("visibility", "hidden");
      for (const d of dots) d.setAttribute("visibility", "hidden");
    });
    return box;
  }

  // Столбцы по группам (спринтам): до 24px толщиной, скругление сверху, зазор 2px между соседями.
  function columnChart({ labels, series, unit = "" }) {
    const W0 = 720;
    const H0 = 240;
    const pad = { l: 40, r: 12, t: 22, b: 30 };
    const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
    const band = (W0 - pad.l - pad.r) / Math.max(1, labels.length);
    const bw = Math.min(24, (band * 0.6) / series.length);
    const y = (v) => pad.t + (1 - v / max) * (H0 - pad.t - pad.b);
    const base = H0 - pad.b;
    const tip = h("div", { class: "viz-tip", hidden: true });
    const ticks = [0, max / 2, max];
    // Прямоугольник со скруглением только у верхнего края.
    const col = (x0, top, w) => {
      const r = Math.min(4, w / 2, base - top);
      return `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + w - r}Q${x0 + w},${top} ${x0 + w},${top + r}V${base}Z`;
    };
    const chart = svg("svg", { class: "viz-svg", viewBox: `0 0 ${W0} ${H0}`, role: "img", "aria-label": series.map((s) => s.name).join(", ") },
      ticks.map((t) => [
        svg("line", { class: "viz-grid", x1: pad.l, x2: W0 - pad.r, y1: y(t), y2: y(t) }),
        svg("text", { class: "viz-axis", x: pad.l - 8, y: y(t) + 4, "text-anchor": "end" }, num(t)),
      ]),
      labels.map((l, k) => {
        const cx = pad.l + band * k + band / 2;
        const groupW = series.length * bw + (series.length - 1) * 2;
        return [
          svg("text", { class: "viz-axis", x: cx, y: H0 - 8, "text-anchor": "middle" }, l.length > 14 ? `${l.slice(0, 13)}…` : l),
          series.map((s, n) => {
            const v = s.values[k];
            const x0 = cx - groupW / 2 + n * (bw + 2);
            const shape = v > 0 ? svg("path", { d: col(x0, y(v), bw), fill: s.color }) : null;
            const hitArea = svg("rect", { x: x0 - 4, y: pad.t, width: bw + 8, height: base - pad.t, fill: "transparent", class: "viz-hit" });
            hitArea.addEventListener("pointerenter", () => {
              tip.replaceChildren(h("b", { text: l }), h("span", { class: "viz-tip__row" }, h("i", { vars: { "--c": s.color } }), `${s.name}: `, h("b", { text: `${num(v)}${unit}` })));
              tip.hidden = false;
              const r = chart.getBoundingClientRect();
              tip.style.left = `${Math.min(r.width - 170, ((x0 + bw + 8) / W0) * r.width)}px`;
              tip.style.top = "8px";
            });
            hitArea.addEventListener("pointerleave", () => { tip.hidden = true; });
            return [shape, n === series.length - 1 && v > 0 ? svg("text", { class: "viz-label", x: x0 + bw / 2, y: y(v) - 6, "text-anchor": "middle" }, num(v)) : null, hitArea];
          }),
        ];
      }));
    return h("div", { class: "viz-plot" }, chart, tip);
  }

  const legend = (series) => h("div", { class: "viz-legend" }, series.map((s) => h("span", {}, h("i", { class: s.reference ? "is-line" : "", vars: { "--c": s.color } }), s.name)));
  const dataTable = (labels, series, unit) => h("details", { class: "viz-table" },
    h("summary", { class: "mono", text: "Таблицей" }),
    h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", { text: "" }), series.map((s) => h("th", { text: s.name })))),
      h("tbody", {}, labels.map((l, k) => h("tr", {}, h("td", { text: l }), series.map((s) => h("td", { class: "mono", text: s.values[k] === null ? "" : `${num(s.values[k])}${unit}` }))))))));

  async function viewReports(alive, id) {
    loading();
    const [data, { worklogs }] = await Promise.all([W.loadSpace(id), api("GET", `/api/work/projects/${id}/worklogs`)]);
    if (!alive()) return;
    if (!reportState.has(id)) reportState.set(id, { metric: "count", period: "30" });
    const st = reportState.get(id);

    function draw() {
      const issues = data.issues.filter((i) => i.type !== "epic");
      const value = (list) => (st.metric === "hours" ? list.reduce((n, i) => n + (i.estimate || 0), 0) : list.length);
      const unit = st.metric === "hours" ? " ч" : "";
      const since = st.period === "all" ? "" : addDays(today(), -Number(st.period) + 1);
      const logs = worklogs.filter((w) => !since || w.date >= since);
      const open = issues.filter((i) => i.status !== "done");
      const doneRecent = issues.filter((i) => i.status === "done" && i.doneAt && localDate(i.doneAt) >= addDays(today(), -13));
      const overdue = open.filter(W.isOverdue);
      const spent = logs.reduce((n, w) => n + w.hours, 0);
      const metricSwitch = h("div", { class: "seg" }, [["count", "Задачи"], ["hours", "Часы оценки"]].map(([k, label]) => h("button", { class: `seg__btn${st.metric === k ? " is-on" : ""}`, type: "button", text: label, onclick: () => { st.metric = k; draw(); } })));

      // Сгорание: сколько осталось сделать к концу каждого дня спринта.
      const sprint = data.sprints.find((s) => s.state === "active");
      let burndown;
      if (sprint && sprint.start && sprint.end) {
        const list = issues.filter((i) => i.sprintId === sprint.id);
        const len = Math.max(1, Math.round((Date.parse(sprint.end) - Date.parse(sprint.start)) / DAY));
        const days = Array.from({ length: len + 1 }, (_, k) => addDays(sprint.start, k));
        const total = value(list);
        const ideal = days.map((_, k) => Math.round((total - (total * k) / len) * 10) / 10);
        const actual = days.map((d) => (d > today() ? null : value(list.filter((i) => !(i.status === "done" && i.doneAt && localDate(i.doneAt) <= d)))));
        const labels = days.map((d) => fmtDate(d).replace(/ \d{4}$/, ""));
        const series = [{ name: "Осталось", color: SERIES[0], values: actual }, { name: "Идеальный темп", color: REFERENCE, values: ideal, reference: true }];
        burndown = h("section", { class: "card viz" },
          h("div", { class: "viz__head" },
            h("div", {}, h("h2", { class: "h3", text: `Сгорание: ${sprint.name}` }), h("p", { class: "muted viz__sub", text: `${fmtDate(sprint.start)} – ${fmtDate(sprint.end)}. Считается по задачам, которые сейчас в спринте.` })),
            legend(series)),
          list.length ? lineChart({ labels, series, unit }) : h("p", { class: "empty", text: "В спринте нет задач." }),
          list.length ? dataTable(labels, series, unit) : null);
      } else {
        burndown = h("section", { class: "card viz" }, h("h2", { class: "h3", text: "Сгорание спринта" }), h("p", { class: "empty mt-24", text: "Появится, когда в бэклоге начнётся спринт с датами." }));
      }

      // Скорость: сколько закрывали за спринт.
      const closed = data.sprints.filter((s) => s.state === "closed" && s.stats).sort((a, b) => (a.closedAt || "").localeCompare(b.closedAt || "")).slice(-8);
      const velSeries = [
        { name: "Запланировано", color: SERIES[0], values: closed.map((s) => (st.metric === "hours" ? s.stats.estimate : s.stats.total)) },
        { name: "Сделано", color: SERIES[1], values: closed.map((s) => (st.metric === "hours" ? s.stats.doneEstimate : s.stats.done)) },
      ];
      const velocity = h("section", { class: "card viz" },
        h("div", { class: "viz__head" }, h("div", {}, h("h2", { class: "h3", text: "Скорость команды" }), h("p", { class: "muted viz__sub", text: "Закрытые спринты: что брали и что успели." })), closed.length ? legend(velSeries) : null),
        closed.length ? [columnChart({ labels: closed.map((s) => s.name), series: velSeries, unit }), dataTable(closed.map((s) => s.name), velSeries, unit)] : h("p", { class: "empty mt-24", text: "Пока нет завершённых спринтов." }));

      // Загрузка: открытые задачи по людям.
      const people = [...new Set(open.map((i) => i.assigneeId))];
      const load = people.map((pid) => {
        const list = open.filter((i) => i.assigneeId === pid);
        return { pid, count: list.length, hours: list.reduce((n, i) => n + (i.estimate || 0), 0), progress: list.filter((i) => i.status !== "todo").length };
      }).sort((a, b) => (st.metric === "hours" ? b.hours - a.hours : b.count - a.count));
      const maxLoad = Math.max(1, ...load.map((l) => (st.metric === "hours" ? l.hours : l.count)));
      const workload = h("section", { class: "card viz" },
        h("div", { class: "viz__head" }, h("div", {}, h("h2", { class: "h3", text: "Загрузка" }), h("p", { class: "muted viz__sub", text: "Открытые задачи на каждом человеке." }))),
        load.length ? h("ul", { class: "hbars" }, load.map((l) => {
          const v = st.metric === "hours" ? l.hours : l.count;
          return h("li", { class: "hbars__row", title: `${l.pid ? nameOf(l.pid) : "Без исполнителя"}: ${l.count} ${plural(l.count, "задача", "задачи", "задач")}, оценка ${hrs(l.hours)}, в работе ${l.progress}` },
            h("span", { class: "hbars__name" }, avatar(l.pid, { size: 22 }), l.pid ? nameOf(l.pid) : "Без исполнителя"),
            h("span", { class: "hbars__track" }, h("i", { vars: { "--p": `${(v / maxLoad) * 100}%`, "--c": SERIES[0] } })),
            h("span", { class: "hbars__value mono", text: `${num(v)}${unit}` }));
        })) : h("p", { class: "empty mt-24", text: "Открытых задач нет." }));

      // Табель: часы по людям и задачам за период.
      const byPerson = [...logs.reduce((m, w) => m.set(w.userId, (m.get(w.userId) || 0) + w.hours), new Map())].sort((a, b) => b[1] - a[1]);
      const byIssue = [...logs.reduce((m, w) => {
        const x = m.get(w.issueId) || { key: w.key, title: w.title, hours: 0, people: new Set() };
        x.hours += w.hours;
        x.people.add(w.userId);
        return m.set(w.issueId, x);
      }, new Map()).values()].sort((a, b) => b.hours - a.hours).slice(0, 15);
      const maxPerson = Math.max(1, ...byPerson.map(([, v]) => v));
      const exportLogs = () => {
        const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const lines = logs.map((w) => [w.date, nameOf(w.userId), w.key, w.title, String(w.hours).replace(".", ","), w.note].map(esc).join(";"));
        download(`${data.project.key}-время-${today()}.csv`, `﻿${[["Дата", "Кто", "Задача", "Название", "Часы", "Что сделано"].map(esc).join(";"), ...lines].join("\r\n")}`);
      };
      const timesheet = h("section", { class: "card viz viz--wide" },
        h("div", { class: "viz__head" },
          h("div", {}, h("h2", { class: "h3", text: "Табель" }), h("p", { class: "muted viz__sub", text: `Всего ${hrs(spent)} по записям в задачах.` })),
          h("div", { class: "actions" },
            select("", [["7", "7 дней"], ["30", "30 дней"], ["90", "90 дней"], ["all", "Всё время"]], st.period, (v) => { st.period = v; draw(); }),
            logs.length ? btn("CSV", { small: true, variant: "light", onclick: exportLogs }) : null)),
        logs.length ? h("div", { class: "timesheet" },
          h("ul", { class: "hbars" }, byPerson.map(([pid, v]) => h("li", { class: "hbars__row" },
            h("span", { class: "hbars__name" }, avatar(pid, { size: 22 }), nameOf(pid)),
            h("span", { class: "hbars__track" }, h("i", { vars: { "--p": `${(v / maxPerson) * 100}%`, "--c": SERIES[1] } })),
            h("span", { class: "hbars__value mono", text: hrs(v) })))),
          h("div", { class: "table-wrap" }, h("table", { class: "table" },
            h("thead", {}, h("tr", {}, h("th", { text: "Задача" }), h("th", { text: "Кто" }), h("th", { text: "Часы" }))),
            h("tbody", {}, byIssue.map((x) => h("tr", {},
              h("td", {}, h("span", { class: "mono", text: `${x.key} ` }), x.title),
              h("td", {}, h("span", { class: "cell-people" }, [...x.people].map((pid) => avatar(pid, { size: 20 })))),
              h("td", { class: "mono", text: hrs(x.hours) }))))))) : h("p", { class: "empty mt-24", text: "За период время не записывали." }));

      I.root.replaceChildren(...W.spaceShell(data, "reports", {},
        h("div", { class: "filters" }, h("span", { class: "muted", text: "Считать в" }), metricSwitch),
        h("div", { class: "tiles" },
          tile("Открыто", open.length, `${hrs(open.reduce((n, i) => n + (i.estimate || 0), 0))} по оценке`),
          tile("В работе", open.filter((i) => i.status !== "todo").length, "в работе, ревью и тесте"),
          tile("Готово за 2 недели", doneRecent.length, doneRecent.length ? `${hrs(doneRecent.reduce((n, i) => n + (i.estimate || 0), 0))} по оценке` : "пока ничего"),
          tile("Просрочено", overdue.length, overdue.length ? overdue.slice(0, 2).map((i) => i.key).join(", ") : "сроки в порядке", overdue.length > 0)),
        h("div", { class: "reports" }, burndown, velocity, workload, timesheet)));
    }
    draw();
  }
  const tile = (label, value, sub, alert = false) => h("div", { class: `tile${alert ? " is-alert" : ""}` },
    h("span", { class: "tile__label", text: label }), h("b", { class: "tile__value", text: String(value) }), h("span", { class: "tile__sub mono", text: sub }));

  I.addRoutes([
    { re: /^\/work\/p\/([\w-]+)\/roadmap$/, view: viewRoadmap, access: "team" },
    { re: /^\/work\/p\/([\w-]+)\/reports$/, view: viewReports, access: "team" },
  ]);
})();
