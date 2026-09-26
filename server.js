// Точка входа. Проверяем версию Node до загрузки остального кода:
// встроенный модуль node:sqlite без флагов доступен с Node.js 22.13 (в ветке 23 с 23.4).
const [major, minor] = process.versions.node.split('.').map(Number);
const supported = major >= 24 || (major === 23 && minor >= 4) || (major === 22 && minor >= 13);
if (!supported) {
  console.error(
    `\nНужен Node.js 22.13 или новее, сейчас ${process.version}.\n` +
      'Установите версию LTS с https://nodejs.org или командой brew install node\n',
  );
  process.exit(1);
}

const { startServer } = await import('./src/main.js');
await startServer();
