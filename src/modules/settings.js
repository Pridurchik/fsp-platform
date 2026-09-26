// Настройки сайта: название и контакты Федерации. Заполняет организатор, пустые поля на сайте не показываются.
import { all, run, tx } from '../db/index.js';
import { audit } from './notifications.js';

export const SETTINGS_FIELDS = [
  { key: 'org_name', label: 'Полное название', required: true, default: 'Федерация спортивного программирования Республики Дагестан' },
  { key: 'about', label: 'О федерации', type: 'textarea', hint: 'Текст для страницы «О федерации». Пустая строка начинает новый абзац.' },
  { key: 'address', label: 'Адрес' },
  { key: 'phone', label: 'Телефон', type: 'tel' },
  { key: 'email', label: 'Электронная почта', type: 'email' },
  { key: 'telegram', label: 'Telegram', hint: 'Ссылка вида https://t.me/…' },
  { key: 'vk', label: 'ВКонтакте', hint: 'Ссылка вида https://vk.com/…' },
];

export function getSettings() {
  const out = Object.fromEntries(SETTINGS_FIELDS.map((f) => [f.key, f.default || '']));
  for (const r of all('SELECT key, value FROM settings')) if (r.key in out && r.value) out[r.key] = r.value;
  return out;
}

export const readSettingsForm = (form) =>
  Object.fromEntries(SETTINGS_FIELDS.map((f) => [f.key, String(form.get(f.key) || '').trim().slice(0, f.type === 'textarea' ? 5000 : 300)]));

export function validateSettings(v) {
  const errors = {};
  if (!v.org_name) errors.org_name = 'Укажите название';
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errors.email = 'Проверьте адрес почты';
  // Только https-ссылки: в href не попадёт javascript: и прочее.
  for (const key of ['telegram', 'vk']) if (v[key] && !/^https:\/\/\S+$/.test(v[key])) errors[key] = 'Ссылка должна начинаться с https://';
  return errors;
}

export function saveSettings(values, userId) {
  tx(() => {
    for (const [key, value] of Object.entries(values)) {
      run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
    }
  });
  audit(userId, 'UPDATE', 'settings');
}
