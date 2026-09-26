// Информационная часть: новости и документы Федерации.
import { all, get, run } from '../db/index.js';
import { todayISO } from '../core/dates.js';

export const DOC_CATEGORIES = {
  FEDERATION: 'Документы Федерации',
  REGULATIONS: 'Положения и регламенты',
  RULES: 'Правила вида спорта',
  MATERIALS: 'Полезные материалы',
};

export const listNews = (limit = 50) => all('SELECT * FROM news ORDER BY published_at DESC, id DESC LIMIT ?', limit);
export const getNews = (id) => get('SELECT * FROM news WHERE id = ?', id);

export function createNews({ title, excerpt, body }) {
  return run('INSERT INTO news (title, excerpt, body, published_at) VALUES (?, ?, ?, ?)', title, excerpt, body, todayISO()).id;
}
export const deleteNews = (id) => run('DELETE FROM news WHERE id = ?', id);

export const listDocuments = () => all('SELECT * FROM documents ORDER BY category, published_at DESC, id DESC');

export function createDocument({ title, category, url, description }) {
  return run(
    'INSERT INTO documents (title, category, url, description, published_at) VALUES (?, ?, ?, ?, ?)',
    title, DOC_CATEGORIES[category] ? category : 'MATERIALS', url || null, description || null, todayISO(),
  ).id;
}
export const deleteDocument = (id) => run('DELETE FROM documents WHERE id = ?', id);
