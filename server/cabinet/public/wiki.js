/* Вики проекта (как Confluence или Notion): страницы деревом, текст в Markdown с предпросмотром,
   шаблоны, версии с восстановлением, картинки из буфера. Если кто-то сохранил страницу раньше,
   сервер не даёт затереть его правки, и мы предлагаем, что сделать. */
(() => {
  "use strict";

  const I = window.InData;
  const W = I.work;
  const { h, link, btn, api, errorText, toast, navigate, loading } = I;
  const { ico, tool, markdown, toggleTask, pasteImages, dialog, select, ago, copyText } = W;

  const TEMPLATES = {
    empty: ["Пустая страница", ""],
    spec: ["Техническое задание", "## Цель\n\nЗачем делаем и что изменится для пользователя.\n\n## Что входит\n\n- \n\n## Что не входит\n\n- \n\n## Сценарии\n\n1. \n\n## Критерии готовности\n\n- [ ] \n\n## Открытые вопросы\n\n- \n"],
    meeting: ["Заметки созвона", "**Дата:** \n**Участники:** \n\n## Повестка\n\n- \n\n## Решили\n\n- \n\n## Задачи\n\n- [ ] Кто, что, к какому сроку\n"],
    release: ["Релиз", "## Версия\n\n**Дата выкладки:** \n\n## Что нового\n\n- \n\n## Исправлено\n\n- \n\n## Проверить после выкладки\n\n- [ ] \n"],
    onboarding: ["Онбординг разработчика", "## Репозитории\n\n- \n\n## Как запустить локально\n\n```\n\n```\n\n## Окружения\n\n| Окружение | Адрес | Для чего |\n| --- | --- | --- |\n| Прод |  |  |\n| Тест |  |  |\n\n## Кого спросить\n\n- \n\nДоступы и пароли сюда не пишем: их выдаёт ПМ лично.\n"],
    adr: ["Архитектурное решение", "## Контекст\n\nЧто происходит и почему нужно решать.\n\n## Решение\n\nЧто выбрали.\n\n## Варианты\n\n| Вариант | Плюсы | Минусы |\n| --- | --- | --- |\n|  |  |  |\n\n## Последствия\n\nЧто станет проще, что сложнее.\n"],
  };
  let openEditor = null; // id страницы, которую сразу открыть в редакторе (после создания)
  const treeState = new Map(); // свёрнутые ветки по проекту

  async function viewWiki(alive, id, pageId = null) {
    loading();
    const [data, res] = await Promise.all([W.loadSpace(id), api("GET", `/api/work/projects/${id}/pages`)]);
    let pages = res.pages;
    const sorted = (list) => [...list].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "ru"));
    if (!pageId && pages.length) {
      const first = sorted(pages.filter((x) => !x.parentId))[0] || pages[0];
      return navigate(`/work/p/${id}/wiki/${first.id}`, { replace: true });
    }
    let page = pageId ? (await api("GET", `/api/work/pages/${pageId}`)).page : null;
    if (!alive()) return;
    if (!treeState.has(id)) treeState.set(id, new Set());
    const collapsed = treeState.get(id);
    let q = "";
    let editing = page && openEditor === page.id;
    openEditor = null;
    let draft = page ? { title: page.title, body: page.body, parentId: page.parentId } : null;
    let preview = true;
    const dirty = () => editing && draft && (draft.title !== page.title || draft.body !== page.body || draft.parentId !== page.parentId);
    I.setLeaveGuard((unload) => !dirty() || (!unload && confirm("Страница не сохранена. Уйти без сохранения?")));

    const childrenOf = (pid) => sorted(pages.filter((x) => x.parentId === pid));
    const ancestors = (pg) => {
      const out = [];
      for (let cur = pages.find((x) => x.id === pg.parentId); cur && out.length < 50; cur = pages.find((x) => x.id === cur.parentId)) out.unshift(cur);
      return out;
    };
    const descendants = (pid) => childrenOf(pid).flatMap((c) => [c.id, ...descendants(c.id)]);

    function tree() {
      const match = (pg) => pg.title.toLowerCase().includes(q.toLowerCase());
      const visible = (pg) => !q || match(pg) || childrenOf(pg.id).some(visible);
      const branch = (pid, level) => {
        const kids = childrenOf(pid).filter(visible);
        if (!kids.length) return null;
        return h("ul", { class: "wiki-tree__list" }, kids.map((pg) => {
          const sub = childrenOf(pg.id);
          const open = q || !collapsed.has(pg.id);
          return h("li", {},
            h("div", { class: `wiki-tree__item${page && page.id === pg.id ? " is-current" : ""}`, vars: { "--level": String(level) } },
              sub.length
                ? h("button", { class: `rm-toggle${open ? " is-open" : ""}`, type: "button", "aria-label": open ? "Свернуть" : "Развернуть", onclick: () => { if (collapsed.has(pg.id)) collapsed.delete(pg.id); else collapsed.add(pg.id); draw(); } }, ico("chevron"))
                : h("span", { class: "rm-toggle rm-toggle--none" }),
              link(`/work/p/${id}/wiki/${pg.id}`, { class: "wiki-tree__link", title: pg.title }, pg.title),
              h("button", { class: "icon-btn wiki-tree__add", type: "button", title: "Подстраница", "aria-label": `Подстраница в «${pg.title}»`, onclick: () => newPage(pg.id) }, ico("plus"))),
            open ? branch(pg.id, level + 1) : null);
        }));
      };
      return h("aside", { class: "wiki-tree" },
        h("div", { class: "wiki-tree__head" },
          h("b", { text: "Страницы" }),
          h("button", { class: "link-btn accent", type: "button", text: "+ Страница", onclick: () => newPage("") })),
        pages.length > 6 ? h("input", { class: "input input--sm wiki-tree__search", type: "search", value: q, placeholder: "Найти страницу", oninput: (e) => { q = e.target.value; drawTree(); } }) : null,
        h("nav", { class: "wiki-tree__nav", "aria-label": "Страницы вики" }, branch("", 0) || h("p", { class: "empty empty--small", text: q ? "Не нашли." : "Пока пусто." })));
    }
    let treeEl;
    const drawTree = () => {
      const next = tree();
      const input = treeEl?.querySelector("input");
      const pos = input && document.activeElement === input ? input.selectionStart : null;
      treeEl.replaceWith(next);
      treeEl = next;
      if (pos !== null) {
        const fresh = treeEl.querySelector("input");
        fresh.focus();
        fresh.setSelectionRange(pos, pos);
      }
    };

    function newPage(parentId) {
      const title = h("input", { class: "input", maxlength: "200", required: true, placeholder: "Например, «Техническое задание: онлайн-покер»" });
      let template = "empty";
      const picks = h("div", { class: "templates" }, Object.entries(TEMPLATES).map(([key, [label]]) => h("button", {
        class: `template${key === template ? " is-on" : ""}`, type: "button", "data-key": key,
        onclick: (e) => {
          template = key;
          for (const b of picks.children) b.classList.toggle("is-on", b.dataset.key === key);
          if (!title.value.trim() && key !== "empty") title.value = label;
          e.currentTarget.blur();
        },
      }, ico("page"), label)));
      const parents = sorted(pages);
      const parent = select("", [["", "В корне"], ...parents.map((pg) => [pg.id, pg.title])], parentId, () => {});
      const submit = btn("Создать", { type: "submit" });
      let ui;
      ui = dialog("Новая страница", h("form", {
        class: "form",
        async onsubmit(e) {
          e.preventDefault();
          submit.disabled = true;
          try {
            const { page: created } = await api("POST", `/api/work/projects/${id}/pages`, { title: title.value, parentId: parent.value, body: TEMPLATES[template][1] });
            ui.close(true);
            openEditor = created.id;
            navigate(`/work/p/${id}/wiki/${created.id}`);
          } catch (err) {
            toast(errorText(err));
            submit.disabled = false;
          }
        },
      },
      h("label", { class: "field" }, h("span", { text: "Название" }), title),
      h("div", { class: "field" }, h("span", { text: "Шаблон" }), picks),
      h("label", { class: "field" }, h("span", { text: "Где лежит" }), parent),
      h("div", { class: "actions" }, submit)), { wide: true });
      setTimeout(() => title.focus());
    }

    async function save(force = false) {
      try {
        const body = { title: draft.title, body: draft.body, parentId: draft.parentId, ...(force ? {} : { base: page.updatedAt }) };
        page = (await api("PATCH", `/api/work/pages/${page.id}`, body)).page;
        updateMeta(page);
        editing = false;
        draw();
        toast("Страница сохранена");
      } catch (err) {
        if (err.code === "conflict") return conflict();
        toast(errorText(err));
      }
    }
    function conflict() {
      let ui;
      ui = dialog("Страницу уже изменили", h("div", { class: "stack" },
        h("p", { class: "lead", text: "Пока вы редактировали, кто-то сохранил свою версию. Можно записать вашу поверх или открыть свежую в новой вкладке и перенести правки вручную." }),
        h("div", { class: "actions" },
          btn("Открыть свежую версию", { variant: "light", onclick: () => window.open(location.href, "_blank", "noopener") }),
          btn("Сохранить мою поверх", { onclick: () => { ui.close(true); save(true); } }))));
    }
    const updateMeta = (pg) => {
      const k = pages.findIndex((x) => x.id === pg.id);
      const meta = { id: pg.id, projectId: pg.projectId, parentId: pg.parentId, title: pg.title, order: pg.order, createdBy: pg.createdBy, updatedAt: pg.updatedAt, updatedBy: pg.updatedBy };
      if (k >= 0) pages[k] = meta;
      else pages.push(meta);
    };

    async function remove() {
      const kids = childrenOf(page.id).length;
      if (!confirm(`Удалить страницу «${page.title}»?${kids ? ` Подстраницы (${kids}) поднимутся на уровень выше.` : ""}`)) return;
      try {
        await api("DELETE", `/api/work/pages/${page.id}`);
        toast("Страница удалена");
        I.setLeaveGuard(null);
        navigate(page.parentId ? `/work/p/${id}/wiki/${page.parentId}` : `/work/p/${id}/wiki`);
      } catch (err) {
        toast(errorText(err));
      }
    }

    async function versions() {
      const list = h("ul", { class: "versions" }, page.versions.map((v) => h("li", {},
        h("button", { class: "versions__row", type: "button", onclick: () => showVersion(v) },
          h("span", {}, h("b", { text: v.by || "Без автора" }), h("span", { class: "muted", text: ` · ${ago(v.at)}` })),
          h("span", { class: "muted versions__title", text: v.title })))));
      const ui = dialog("История страницы", page.versions.length ? list : h("p", { class: "empty", text: "Прежних версий нет: страницу ещё не правили." }), { wide: true });
      async function showVersion(v) {
        try {
          const { version } = await api("GET", `/api/work/pages/${page.id}/versions/${v.n}`);
          ui.box.querySelector(".dialog").replaceChildren(
            h("div", { class: "dialog__head" }, h("h2", { class: "h2", text: `Версия: ${version.by || ""}, ${ago(version.at)}` }), tool("Закрыть", "close", () => ui.close())),
            h("div", { class: "version-view" }, h("h1", { class: "wiki-page__title", text: version.title }), markdown(version.body)),
            h("div", { class: "actions" },
              btn("Восстановить эту версию", {
                async onclick() {
                  try {
                    page = (await api("PATCH", `/api/work/pages/${page.id}`, { title: version.title, body: version.body, base: page.updatedAt })).page;
                    updateMeta(page);
                    ui.close(true);
                    draw();
                    toast("Версия восстановлена, текущая ушла в историю");
                  } catch (err) {
                    toast(errorText(err));
                  }
                },
              }),
              btn("Назад к списку", { variant: "light", onclick: () => { ui.close(true); versions(); } })));
        } catch (err) {
          toast(errorText(err));
        }
      }
    }

    // Кнопки панели оборачивают выделение или ставят префикс строкам.
    function toolbar(area, onInput) {
      const wrap = (before, after = before, placeholder = "текст") => () => {
        const { selectionStart: a, selectionEnd: b, value } = area;
        const sel = value.slice(a, b) || placeholder;
        area.value = `${value.slice(0, a)}${before}${sel}${after}${value.slice(b)}`;
        area.selectionStart = a + before.length;
        area.selectionEnd = a + before.length + sel.length;
        area.focus();
        onInput();
      };
      const prefix = (mark) => () => {
        const { selectionStart: a, selectionEnd: b, value } = area;
        const start = value.lastIndexOf("\n", a - 1) + 1;
        const block = value.slice(start, b);
        const next = block.split("\n").map((l, k) => (typeof mark === "function" ? mark(k) : mark) + l).join("\n");
        area.value = `${value.slice(0, start)}${next}${value.slice(b)}`;
        area.selectionStart = start;
        area.selectionEnd = start + next.length;
        area.focus();
        onInput();
      };
      const insert = (text) => () => {
        const { selectionStart: a, value } = area;
        const pre = a && value[a - 1] !== "\n" ? "\n\n" : "";
        area.value = `${value.slice(0, a)}${pre}${text}${value.slice(a)}`;
        area.selectionStart = area.selectionEnd = a + pre.length + text.length;
        area.focus();
        onInput();
      };
      const b = (label, title, fn) => h("button", { class: "md-tool", type: "button", title, "aria-label": title, onclick: fn }, label);
      return h("div", { class: "md-toolbar", role: "toolbar" },
        b("B", "Жирный", wrap("**")), b("I", "Курсив", wrap("*")), b("S", "Зачёркнутый", wrap("~~")),
        h("span", { class: "md-toolbar__sep" }),
        b("H2", "Заголовок", prefix("## ")), b("H3", "Подзаголовок", prefix("### ")),
        h("span", { class: "md-toolbar__sep" }),
        b("•", "Список", prefix("- ")), b("1.", "Нумерованный список", prefix((k) => `${k + 1}. `)), b("☐", "Чек-лист", prefix("- [ ] ")), b("❝", "Цитата", prefix("> ")),
        h("span", { class: "md-toolbar__sep" }),
        b("</>", "Код", wrap("```\n", "\n```", "код")), b(ico("link"), "Ссылка", wrap("[", "](https://)", "текст ссылки")),
        b("▦", "Таблица", insert("| Колонка | Колонка |\n| --- | --- |\n|  |  |\n")), b("—", "Разделитель", insert("---\n")));
    }

    function content() {
      if (!page) {
        return h("div", { class: "wiki-empty" },
          h("h2", { class: "h2", text: "Здесь будет база знаний проекта" }),
          h("p", { class: "lead", text: "ТЗ, решения по архитектуре, заметки созвонов, инструкции по запуску. Всё в Markdown, с версиями." }),
          h("div", { class: "actions mt-24" }, btn("Создать страницу", { onclick: () => newPage("") })));
      }
      const crumbs = h("p", { class: "wiki-crumbs mono" }, link(`/work/p/${id}/wiki`, {}, "Вики"), ancestors(page).map((pg) => [" / ", link(`/work/p/${id}/wiki/${pg.id}`, {}, pg.title)]));
      if (editing) {
        const title = h("input", { class: "wiki-page__title-input", maxlength: "200", value: draft.title, "aria-label": "Название страницы", oninput: (e) => { draft.title = e.target.value; } });
        const area = h("textarea", { class: "textarea wiki-editor__area", spellcheck: "true", placeholder: "Пишите в Markdown. Картинку можно вставить из буфера." });
        area.value = draft.body;
        const out = h("div", { class: "wiki-editor__preview" }, markdown(draft.body));
        let timer;
        const onInput = () => {
          draft.body = area.value;
          clearTimeout(timer);
          timer = setTimeout(() => out.replaceChildren(markdown(draft.body)), 150);
        };
        area.addEventListener("input", onInput);
        area.addEventListener("keydown", (e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
          if (e.key === "Tab") { // отступ для вложенных списков
            e.preventDefault();
            const { selectionStart: a, selectionEnd: b, value } = area;
            area.value = `${value.slice(0, a)}  ${value.slice(b)}`;
            area.selectionStart = area.selectionEnd = a + 2;
            onInput();
          }
        });
        pasteImages(area, () => `/api/work/pages/${page.id}/files`);
        const banned = new Set([page.id, ...descendants(page.id)]);
        const parent = select("", [["", "В корне"], ...sorted(pages).filter((pg) => !banned.has(pg.id)).map((pg) => [pg.id, pg.title])], draft.parentId, (v) => { draft.parentId = v; });
        setTimeout(() => area.focus({ preventScroll: true }));
        return h("article", { class: "wiki-page wiki-page--edit" },
          crumbs,
          title,
          h("div", { class: "wiki-editor__bar" },
            toolbar(area, onInput),
            h("label", { class: "check" }, h("input", { type: "checkbox", checked: preview, onchange: (e) => { preview = e.target.checked; draw(); } }), "Предпросмотр"),
            h("label", { class: "wiki-editor__parent" }, h("span", { class: "muted", text: "Раздел" }), parent)),
          h("div", { class: `wiki-editor${preview ? "" : " is-solo"}` }, area, preview ? out : null),
          h("div", { class: "save-bar" },
            h("span", { text: "Ctrl+S сохраняет. Прежний текст уйдёт в историю страницы." }),
            h("div", { class: "actions" },
              h("button", { class: "link-btn save-bar__cancel", type: "button", text: "Отмена", onclick: () => { if (!dirty() || confirm("Отменить правки?")) { editing = false; draft = { title: page.title, body: page.body, parentId: page.parentId }; draw(); } } }),
              btn("Сохранить", { variant: "light", small: true, onclick: () => save() }))));
      }
      const kids = childrenOf(page.id);
      const startEdit = () => { editing = true; draft = { title: page.title, body: page.body, parentId: page.parentId }; draw(); };
      return h("article", { class: "wiki-page" },
        h("div", { class: "wiki-page__top" },
          crumbs,
          h("div", { class: "row-tools" },
            tool("Скопировать ссылку", "link", () => copyText(location.href)),
            tool("История версий", "clock", versions),
            tool("Удалить страницу", "trash", remove, true))),
        h("h1", { class: "wiki-page__title", text: page.title }),
        h("p", { class: "wiki-page__meta mono", text: `Обновлено ${ago(page.updatedAt)}${page.updatedBy ? ` · ${page.updatedBy}` : ""}${page.versions.length ? ` · версий: ${page.versions.length + 1}` : ""}` }),
        h("div", { class: "actions wiki-page__actions" },
          btn("Редактировать", { small: true, onclick: startEdit }),
          btn("Подстраница", { small: true, variant: "light", onclick: () => newPage(page.id) })),
        page.body.trim()
          ? h("div", { class: "wiki-page__body", ondblclick: startEdit }, markdown(page.body, {
            onToggle: async (line, checked) => {
              try {
                page = (await api("PATCH", `/api/work/pages/${page.id}`, { body: toggleTask(page.body, line, checked), base: page.updatedAt })).page;
                updateMeta(page);
                draw();
              } catch (err) {
                toast(err.code === "conflict" ? "Страницу уже изменили: обновите её" : errorText(err));
                draw();
              }
            },
          }))
          : h("button", { class: "issue__placeholder", type: "button", text: "Страница пустая. Нажмите, чтобы написать текст…", onclick: startEdit }),
        kids.length
          ? h("section", { class: "wiki-children" },
            h("h3", { class: "issue__label", text: "Подстраницы" }),
            h("ul", { class: "recent" }, kids.map((c) => h("li", {}, link(`/work/p/${id}/wiki/${c.id}`, { class: "recent__row" }, ico("page"), h("span", { class: "recent__title" }, c.title, h("small", { class: "muted", text: `${c.updatedBy} · ${ago(c.updatedAt)}` })))))))
          : null);
    }

    function draw() {
      treeEl = tree();
      I.root.replaceChildren(...W.spaceShell(data, "wiki", {}, h("div", { class: "wiki" }, treeEl, content())));
    }
    draw();
  }

  I.addRoutes([
    { re: /^\/work\/p\/([\w-]+)\/wiki$/, view: viewWiki, access: "team" },
    { re: /^\/work\/p\/([\w-]+)\/wiki\/([\w-]+)$/, view: viewWiki, access: "team" },
  ]);
})();
