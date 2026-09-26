// Пароли, сессии и защита форм. Только встроенный модуль crypto.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { get, run } from '../db/index.js';

export const SESSION_COOKIE = 'fsp_sid';
export const CSRF_COOKIE = 'fsp_csrf';
const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltB64, hashB64] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// В cookie уходит случайный токен, в базе лежит только его хеш.
export function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, expires);
  return { token, maxAge: SESSION_DAYS * 86_400 };
}

export function getSessionUser(token) {
  if (!token) return null;
  const row = get(
    `SELECT u.id, u.email, u.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    sha256(token),
  );
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    run('DELETE FROM sessions WHERE id = ?', sha256(token));
    return null;
  }
  return { id: row.id, email: row.email, role: row.role };
}

export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE id = ?', sha256(token));
}

export const newCsrfToken = () => randomBytes(18).toString('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

export const isOrganizer = (user) => Boolean(user && (user.role === 'ORGANIZER' || user.role === 'ADMIN'));
