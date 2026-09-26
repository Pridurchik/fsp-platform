import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT) || 3000,
  // 0.0.0.0: сайт доступен в локальной сети. Только с этого компьютера: HOST=127.0.0.1
  host: process.env.HOST || '0.0.0.0',
  // Адрес сайта для ссылок в консоли, например https://fsp-rd.ru
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  dbFile: process.env.DB_FILE || path.join(ROOT, 'data', 'fsp.sqlite'),
  secureCookies: process.env.SECURE_COOKIES === '1',
};
