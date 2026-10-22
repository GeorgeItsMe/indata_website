"use strict";
// Тот же обработчик обычным HTTP-сервером — для VPS или локальной проверки:
//   node --env-file=.env server.js   (PORT — по умолчанию 8787, HOST — 127.0.0.1)
// Снаружи к нему ходит nginx: location = /api/booking → http://127.0.0.1:8787, с X-Real-IP.
const http = require("node:http");
const { handler } = require("./index.js");

const MAX_BODY = 64 * 1024;

http.createServer(async (req, res) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  const out = await handler({
    httpMethod: req.method,
    headers: req.headers,
    body: Buffer.concat(chunks).toString("utf8"),
    isBase64Encoded: false,
    ip: req.socket.remoteAddress,
  });
  res.writeHead(out.statusCode, out.headers).end(out.body);
}).listen(Number(process.env.PORT) || 8787, process.env.HOST || "127.0.0.1");
