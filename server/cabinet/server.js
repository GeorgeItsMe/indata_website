"use strict";
// Кабинет клиента обычным HTTP-сервером за nginx:
//   node --env-file=.env server.js
// Переменные окружения:
//   PORT          по умолчанию 8790
//   HOST          по умолчанию 127.0.0.1 (снаружи — только через nginx)
//   DATA_DIR      папка с db.json и файлами проектов, по умолчанию ./data
//   SITE_DIR      сайт indata.group, откуда берутся шрифты и иконка, по умолчанию ../..
//   APP_ORIGIN    адрес кабинета, например https://app.indata.group: изменения принимаются только с него
//   COOKIE_SECURE 0 — для локальной проверки по http
const http = require("node:http");
const path = require("node:path");
const { createApp } = require("./app.js");

const handle = createApp({
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, "data")),
  siteDir: path.resolve(process.env.SITE_DIR || path.join(__dirname, "..", "..")),
  origins: (process.env.APP_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean),
  secureCookie: process.env.COOKIE_SECURE !== "0",
});

const port = Number(process.env.PORT) || 8790;
const host = process.env.HOST || "127.0.0.1";
http.createServer(handle).listen(port, host, () => console.log(`cabinet: http://${host}:${port}`));
