// Шаблоны HTML: всё, что подставляется в html`...`, экранируется автоматически.
// Уже готовую разметку передаём через raw() или вложенный html`...`.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export class Raw {
  constructor(value) {
    this.value = String(value);
  }
  toString() {
    return this.value;
  }
}

export const raw = (value) => new Raw(value);

export function esc(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(esc).join('');
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += esc(values[i]) + strings[i + 1];
  return new Raw(out);
}

// Простой текст с абзацами: пустая строка разделяет абзацы.
export function paragraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => html`<p>${p}</p>`);
}
