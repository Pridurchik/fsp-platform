// Пересоздаёт базу.
//   npm run reset   чистая база: справочники и параметры рейтинга
//   npm run sample  то же плюс пример наполнения для проверки и обучения
import { rmSync } from 'node:fs';
import { config } from '../src/config.js';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { seedBase, seedSample, SAMPLE_PASSWORD } from '../src/db/seed.js';

const sample = process.argv.includes('--sample');

for (const suffix of ['', '-wal', '-shm']) rmSync(config.dbFile + suffix, { force: true });
initDatabase(config.dbFile);
seedBase();
if (sample) seedSample();
closeDatabase();

console.log(`База пересоздана: ${config.dbFile}`);
if (sample) {
  console.log('Пример наполнения загружен. Вымышленные аккаунты:');
  console.log(`  organizer@example.com, athlete@example.com, novice@example.com, пароль ${SAMPLE_PASSWORD}`);
} else {
  console.log('При запуске сервер покажет ссылку для создания аккаунта организатора.');
}
