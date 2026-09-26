import { createServer } from 'node:http';
import os from 'node:os';
import { config } from './config.js';
import { initDatabase, isDatabaseEmpty } from './db/index.js';
import { migrate } from './db/migrate.js';
import { seedBase, seedSample } from './db/seed.js';
import { needsSetup, setupToken } from './core/setup.js';
import { handleRequest } from './app.js';
import { backfillChats } from './modules/chats.js';
import { dispatchDueItems } from './modules/schedule.js';

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list || []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}

// sample: заполнить пустую базу примером наполнения (для тестов и обучения).
export async function startServer({ port = config.port, host = config.host, dbFile = config.dbFile, quiet = false, sample = false } = {}) {
  initDatabase(dbFile);
  migrate();
  if (isDatabaseEmpty()) {
    seedBase();
    if (sample) seedSample();
    if (!quiet) console.log(sample ? '  Новая база: справочники и пример наполнения.' : '  Новая база: справочники загружены.');
  }
  backfillChats();

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Внутренняя ошибка сервера. Подробности в журнале сервера.');
    });
  });

  await new Promise((resolve) => server.listen(port, host, resolve));

  // Расписание хакатонов: раз в 15 секунд рассылаем уведомления о начавшихся пунктах.
  const dispatch = () => {
    try {
      dispatchDueItems();
    } catch (err) {
      console.error(err);
    }
  };
  dispatch();
  const timer = setInterval(dispatch, 15_000);
  timer.unref();
  server.on('close', () => clearInterval(timer));

  if (!quiet) {
    const p = server.address().port;
    const base = config.publicUrl || `http://localhost:${p}`;
    console.log(`\n  Платформа ФСП РД запущена: ${base}`);
    const lan = !config.publicUrl && ['0.0.0.0', '::'].includes(host) ? lanAddress() : null;
    if (lan) console.log(`  В локальной сети: http://${lan}:${p}`);
    if (needsSetup()) {
      console.log('\n  Аккаунта организатора ещё нет. Создайте его по одноразовой ссылке:');
      console.log(`  ${base}/setup?token=${setupToken()}`);
    }
    console.log('');
  }
  return server;
}
