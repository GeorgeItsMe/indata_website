"use strict";
// Управление кабинетом из консоли сервера (когда в админку ещё не войти):
//   node cli.js create-admin <логин> <имя>   — новый администратор, печатает пароль
//   node cli.js reset-password <логин>       — новый пароль, все сессии пользователя закрываются
// Запускать при остановленном кабинете (pm2 stop indata-cabinet), иначе он перезапишет изменения.
const path = require("node:path");
const { createStore } = require("./store.js");
const { hashPassword, generatePassword } = require("./auth.js");

const [command, login, ...nameParts] = process.argv.slice(2);
const store = createStore(path.resolve(process.env.DATA_DIR || path.join(__dirname, "data")));
const { db } = store;

if (command === "create-admin" && login && nameParts.length) {
  const normalized = login.toLowerCase();
  if (db.users.some((u) => u.login === normalized)) exit(`Логин ${normalized} уже занят`);
  const password = generatePassword();
  db.users.push({
    id: store.id(), login: normalized, name: nameParts.join(" "), company: "InData", role: "admin",
    password: hashPassword(password), createdAt: new Date().toISOString(),
  });
  store.save();
  console.log(`Администратор ${normalized} создан. Пароль: ${password}`);
} else if (command === "reset-password" && login) {
  const user = db.users.find((u) => u.login === login.toLowerCase()) || exit(`Нет пользователя ${login}`);
  const password = generatePassword();
  user.password = hashPassword(password);
  db.sessions = db.sessions.filter((s) => s.userId !== user.id);
  store.save();
  console.log(`Новый пароль ${user.login}: ${password}`);
} else {
  exit("Использование: node cli.js create-admin <логин> <имя> | reset-password <логин>");
}

function exit(message) {
  console.error(message);
  process.exit(1);
}
