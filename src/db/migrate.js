// Версионирование схемы: новые установки получают схему из schema.sql целиком,
// существующие базы догоняются миграциями. Версия хранится в PRAGMA user_version.
// Все шаги идемпотентны: созданы заново и на пустой, и на старой базе.
import { all, exec, get, run, tx } from './index.js';

export const SCHEMA_VERSION = 1;

const hasTable = (table) => Boolean(get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", table));

const columnsOf = (table) => (hasTable(table) ? all(`PRAGMA table_info("${table}")`).map((r) => r.name) : []);

function addColumn(table, ddl) {
  const name = ddl.split(/\s+/)[0].replace(/"/g, '');
  if (!columnsOf(table).includes(name)) exec(`ALTER TABLE "${table}" ADD COLUMN ${ddl}`);
}

const COMPETITION_COLUMNS = [
  "organizer_name TEXT NOT NULL DEFAULT ''",
  "organizer_contacts TEXT NOT NULL DEFAULT ''",
  'event_url TEXT',
  "rules_text TEXT NOT NULL DEFAULT ''",
  "prize_fund TEXT NOT NULL DEFAULT ''",
  'age_min INTEGER CHECK (age_min IS NULL OR age_min >= 0)',
  'age_max INTEGER CHECK (age_max IS NULL OR age_max >= 0)',
  'required_rank_id INTEGER REFERENCES ranks(id)',
  'min_team_size INTEGER NOT NULL DEFAULT 1 CHECK (min_team_size >= 1)',
  'max_team_size INTEGER NOT NULL DEFAULT 1 CHECK (max_team_size >= 1)',
  'allow_individual INTEGER NOT NULL DEFAULT 1',
];

// Держим вровень со schema.sql: свежая база создаётся сразу с этими таблицами,
// миграция догоняет базы, созданные до них.
const NEW_TABLES = [
  `CREATE TABLE IF NOT EXISTS tags (
     id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS competition_tags (
     competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
     tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
     PRIMARY KEY (competition_id, tag_id)
   )`,
  `CREATE TABLE IF NOT EXISTS languages (
     id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS competition_languages (
     competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
     language_id INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
     PRIMARY KEY (competition_id, language_id)
   )`,
  `CREATE TABLE IF NOT EXISTS teams (
     id INTEGER PRIMARY KEY,
     competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     invite_code TEXT NOT NULL UNIQUE,
     created_by INTEGER REFERENCES athletes(id) ON DELETE SET NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (competition_id, name)
   )`,
  `CREATE TABLE IF NOT EXISTS team_members (
     team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
     athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
     is_captain INTEGER NOT NULL DEFAULT 0,
     joined_at TEXT NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (team_id, athlete_id)
   )`,
  'CREATE INDEX IF NOT EXISTS idx_team_members_athlete ON team_members(athlete_id)',
];

function upToV1() {
  for (const ddl of COMPETITION_COLUMNS) addColumn('competitions', ddl);
  for (const sql of NEW_TABLES) exec(sql);
  addColumn('registrations', 'team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE');
  exec('CREATE INDEX IF NOT EXISTS idx_registrations_team ON registrations(team_id)');
  const tags = [
    ['WEB', 'Веб-разработка'], ['ML', 'ML и искусственный интеллект'], ['MOBILE', 'Мобильная разработка'],
    ['DATA', 'Анализ данных'], ['GAME', 'Разработка игр'], ['IOT', 'Интернет вещей'],
  ];
  tags.forEach(([code, name], i) => run('INSERT OR IGNORE INTO tags (code, name, sort_order) VALUES (?, ?, ?)', code, name, i + 1));
  const languages = [['PY', 'Python'], ['CPP', 'C++'], ['JAVA', 'Java'], ['CSHARP', 'C#'], ['JS', 'JavaScript'], ['GO', 'Go'], ['KOTLIN', 'Kotlin']];
  languages.forEach(([code, name], i) => run('INSERT OR IGNORE INTO languages (code, name, sort_order) VALUES (?, ?, ?)', code, name, i + 1));
}

export function schemaVersion() {
  return get('PRAGMA user_version').user_version ?? 0;
}

export function migrate() {
  tx(() => {
    // Проверяем структуру на каждом запуске, а не только номер версии:
    // это также восстанавливает частично применённую миграцию.
    upToV1();
    exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
  return schemaVersion();
}
