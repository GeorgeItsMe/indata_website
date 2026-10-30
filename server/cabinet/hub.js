"use strict";
/* Живые обновления: Server-Sent Events. Канал — «board:<id>» (доска) или «project:<id>» (задачи проекта).
   Процесс один, поэтому подписчики живут в памяти. Каждое подключение знает, кто смотрит (meta),
   отсюда список «сейчас на доске». */

function createHub({ heartbeatMs = 20000 } = {}) {
  const channels = new Map(); // имя канала → Set подключений

  const write = (conn, event, data) => {
    try {
      conn.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {} // соединение уже закрыто, его уберёт обработчик close
  };

  // Один человек может открыть доску в двух вкладках: в списке он один раз.
  function members(name) {
    const seen = new Map();
    for (const conn of channels.get(name) || []) seen.set(conn.meta.userId, { userId: conn.meta.userId, name: conn.meta.name });
    return [...seen.values()];
  }

  // view(meta) — своё содержимое для каждого подключения (например, чужие приватные стикеры скрыты).
  function publish(name, event, data, { except = "", view = null } = {}) {
    for (const conn of channels.get(name) || []) {
      if (except && conn.meta.client === except) continue;
      write(conn, event, view ? view(conn.meta) : data);
    }
  }

  // Заголовки ответа уже отправлены; alive() проверяет, что сессия ещё действует (иначе поток закрываем).
  function open(name, req, res, meta, { alive = () => true, hello = null } = {}) {
    res.write("retry: 3000\n\n");
    const conn = { res, meta };
    if (!channels.has(name)) channels.set(name, new Set());
    channels.get(name).add(conn);
    if (hello) write(conn, "hello", hello);
    publish(name, "presence", { members: members(name) });
    // Пинг держит соединение через nginx (proxy_read_timeout 60 с) и заодно проверяет сессию.
    const timer = setInterval(() => {
      if (!alive()) return res.end();
      try {
        res.write(": ping\n\n");
      } catch {}
    }, heartbeatMs);
    timer.unref?.();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      const set = channels.get(name);
      if (!set) return;
      set.delete(conn);
      if (!set.size) channels.delete(name);
      else publish(name, "presence", { members: members(name) });
    };
    req.on("close", close);
    res.on("close", close);
  }

  function closeAll() {
    for (const set of channels.values()) for (const conn of set) conn.res.end();
    channels.clear();
  }

  return { open, publish, members, closeAll };
}

module.exports = { createHub };
