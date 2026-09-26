// Доступ к базе: встроенный в Node.js SQLite, без внешних пакетов.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

let db = null;
const statements = new Map();
let txDepth = 0;

export function initDatabase(file) {
  closeDatabase();
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(readFileSync(SCHEMA, 'utf8'));
  return db;
}

export function closeDatabase() {
  statements.clear();
  if (db) db.close();
  db = null;
}

// Пустая база: справочники ещё не заполнены.
export function isDatabaseEmpty() {
  return get('SELECT COUNT(*) AS n FROM disciplines').n === 0;
}

function prepare(sql) {
  let stmt = statements.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    statements.set(sql, stmt);
  }
  return stmt;
}

// SQLite не принимает true/false и undefined — приводим к 1/0 и null.
const normalize = (params) =>
  params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

export const all = (sql, ...params) => prepare(sql).all(...normalize(params));
export const get = (sql, ...params) => prepare(sql).get(...normalize(params));
export function run(sql, ...params) {
  const res = prepare(sql).run(...normalize(params));
  return { changes: Number(res.changes), id: Number(res.lastInsertRowid) };
}
export const exec = (sql) => db.exec(sql);

// Транзакция: всё или ничего. Вложенные вызовы работают внутри внешней.
export function tx(fn) {
  if (txDepth > 0) return fn();
  txDepth++;
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth--;
  }
}
