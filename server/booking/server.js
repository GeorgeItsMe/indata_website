"use strict";
// Тот же обработчик обычным HTTP-сервером — для VPS или локальной проверки:
//   TELEMOST_TOKEN=… node server.js   (порт — PORT, по умолчанию 8787)
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
  });
  res.writeHead(out.statusCode, out.headers).end(out.body);
}).listen(Number(process.env.PORT) || 8787);
