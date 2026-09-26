// Первый запуск. Пока в базе нет ни одного организатора, сайт позволяет создать первый аккаунт
// по одноразовой ссылке, которую сервер печатает в консоль. Ссылку знает только тот, кто запустил сервер.
import { randomBytes } from 'node:crypto';
import { get } from '../db/index.js';
import { safeEqual } from './auth.js';

let token = null;

export const needsSetup = () => !get("SELECT id FROM users WHERE role IN ('ORGANIZER', 'ADMIN') LIMIT 1");

export function setupToken() {
  if (!token) token = randomBytes(18).toString('base64url');
  return token;
}

export const isSetupToken = (value) => Boolean(token) && safeEqual(value, token);

export function finishSetup() {
  token = null;
}
