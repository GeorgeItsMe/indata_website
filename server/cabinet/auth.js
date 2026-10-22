"use strict";
/* Пароли, сессии и защита входа от перебора. */

const crypto = require("node:crypto");

const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
// Без похожих символов (0/O, 1/l/I), чтобы пароль можно было продиктовать.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(salt, "base64"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function generatePassword(length = 12) {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

// В базе храним только хеш токена: утёкший db.json не даёт войти чужими сессиями.
const tokenHash = (token) => crypto.createHash("sha256").update(token).digest("base64url");

function createSessions(store, now = Date.now) {
  const { db } = store;
  return {
    create(userId) {
      const token = crypto.randomBytes(32).toString("base64url");
      db.sessions = db.sessions.filter((s) => s.expires > now()); // заодно чистим просроченные
      db.sessions.push({ hash: tokenHash(token), userId, expires: now() + SESSION_DAYS * DAY });
      store.save();
      return { token, maxAge: SESSION_DAYS * DAY / 1000 };
    },
    user(token) {
      if (!token) return null;
      const hash = tokenHash(token);
      const session = db.sessions.find((s) => s.hash === hash && s.expires > now());
      if (!session) return null;
      const user = db.users.find((u) => u.id === session.userId);
      return user && !user.disabled ? user : null;
    },
    destroy(token) {
      if (!token) return;
      const hash = tokenHash(token);
      db.sessions = db.sessions.filter((s) => s.hash !== hash);
      store.save();
    },
    destroyAllFor(userId) {
      db.sessions = db.sessions.filter((s) => s.userId !== userId);
      store.save();
    },
  };
}

// Не больше max неудачных попыток за windowMs — по IP и по логину отдельно.
function createLimiter({ max = 10, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const fails = new Map();
  const recent = (key) => (fails.get(key) || []).filter((t) => now() - t < windowMs);
  return {
    blocked: (...keys) => keys.some((key) => key && recent(key).length >= max),
    fail(...keys) {
      for (const key of keys) if (key) fails.set(key, [...recent(key), now()]);
    },
    reset(...keys) {
      for (const key of keys) fails.delete(key);
    },
  };
}

module.exports = { hashPassword, checkPassword, generatePassword, createSessions, createLimiter };
