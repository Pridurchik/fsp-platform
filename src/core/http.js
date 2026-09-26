import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, httpOnly = true, sameSite = 'Lax', secure = false } = {}) {
  let cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=${sameSite}`;
  if (maxAge !== undefined) cookie += `; Max-Age=${maxAge}`;
  if (httpOnly) cookie += '; HttpOnly';
  if (secure) cookie += '; Secure';
  return cookie;
}

export function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Слишком большой запрос'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Отдаёт файл из public/. Возвращает false, если файла нет.
export async function serveStatic(req, res, publicDir, relPath) {
  const target = path.normalize(path.join(publicDir, relPath));
  if (!target.startsWith(publicDir + path.sep)) return false;
  try {
    const info = await stat(target);
    if (!info.isFile()) return false;
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(target)] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  } catch {
    return false;
  }
}
