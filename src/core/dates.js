// Даты храним строками ГГГГ-ММ-ДД: их можно сравнивать как строки.

const pad = (n) => String(n).padStart(2, '0');

export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function todayISO(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const { y, m, d } = parts(value);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parts(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

export function addDays(iso, days) {
  const { y, m, d } = parts(iso);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function addMonths(iso, months) {
  const { y, m, d } = parts(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, lastDay))}`;
}

export function endOfMonth(iso) {
  const { y, m } = parts(iso);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// Полные календарные месяцы между датами: 22.06.2025 → 25.09.2026 = 15.
export function monthsBetween(fromISO, toISO) {
  const a = parts(fromISO);
  const b = parts(toISO);
  return (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
}

export function fmtDate(iso, { year = true } = {}) {
  if (!iso) return '';
  const { y, m, d } = parts(iso);
  return `${d} ${MONTHS_GEN[m - 1]}${year ? ` ${y}` : ''}`;
}

export function fmtDateShort(iso) {
  if (!iso) return '';
  const { m, d } = parts(iso);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

export function fmtRange(start, end) {
  if (!end || start === end) return fmtDate(start);
  const a = parts(start);
  const b = parts(end);
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS_GEN[a.m - 1]} ${a.y}`;
  if (a.y === b.y) return `${a.d} ${MONTHS_GEN[a.m - 1]} – ${b.d} ${MONTHS_GEN[b.m - 1]} ${b.y}`;
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

export function fmtMonthYear(iso) {
  const { y, m } = parts(iso);
  return `${MONTHS_NOM[m - 1]} ${y}`;
}

// Время из SQLite datetime('now') хранится в UTC: 2026-09-25 17:04:11
export function fmtDateTime(sqliteUtc) {
  if (!sqliteUtc) return '';
  const dt = new Date(String(sqliteUtc).replace(' ', 'T') + (String(sqliteUtc).endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(dt.getTime())) return String(sqliteUtc);
  return `${dt.getDate()} ${MONTHS_SHORT[dt.getMonth()]}, ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function ageYears(birthISO, today = todayISO()) {
  if (!birthISO) return null;
  return Math.floor(monthsBetween(birthISO, today) / 12);
}
