"use strict";
/* Хранилище кабинета: один JSON-файл с пользователями, проектами и сессиями + папка с файлами.
   Клиентов и проектов десятки, процесс один — базы данных не нужно. Запись атомарная:
   во временный файл и переименование, чтобы при сбое не остался обрезанный JSON. */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const EMPTY = { users: [], projects: [], sessions: [] };

function createStore(dir) {
  const file = dir ? path.join(dir, "db.json") : null;
  const filesDir = dir ? path.join(dir, "files") : null;
  let db = structuredClone(EMPTY);

  if (dir) {
    fs.mkdirSync(filesDir, { recursive: true, mode: 0o700 });
    try {
      db = { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(file, "utf8")) };
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  const memFiles = new Map(); // без dir (тесты) файлы живут в памяти

  function save() {
    if (!file) return;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  return {
    db,
    save,
    id: () => crypto.randomBytes(9).toString("base64url"),

    writeFile(id, buf) {
      if (!filesDir) return void memFiles.set(id, buf);
      fs.writeFileSync(path.join(filesDir, id), buf, { mode: 0o600 });
    },
    readFile(id) {
      if (!filesDir) return memFiles.get(id) ?? null;
      try {
        return fs.readFileSync(path.join(filesDir, id));
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    },
    deleteFile(id) {
      if (!filesDir) return void memFiles.delete(id);
      fs.rmSync(path.join(filesDir, id), { force: true });
    },
  };
}

module.exports = { createStore };
