-- Схема данных платформы ФСП РД.
-- Справочники (уровни, разряды, дисциплины) хранят веса рейтинга: их меняет организатор, без программиста.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'ATHLETE' CHECK (role IN ('ATHLETE', 'ORGANIZER', 'ADMIN')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,            -- sha256 от токена из cookie, сам токен не хранится
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS municipalities (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'CITY' CHECK (kind IN ('CITY', 'DISTRICT'))
);

CREATE TABLE IF NOT EXISTS organizations (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'SCHOOL' CHECK (kind IN ('SCHOOL', 'COLLEGE', 'UNIVERSITY', 'CLUB')),
  municipality_id INTEGER REFERENCES municipalities(id)
);

CREATE TABLE IF NOT EXISTS disciplines (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  short_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS competition_levels (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  short_name  TEXT NOT NULL,
  base_points INTEGER NOT NULL CHECK (base_points >= 0),
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ranks (
  id           INTEGER PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  short_name   TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('YOUTH', 'RANK', 'TITLE')),
  bonus_points INTEGER NOT NULL CHECK (bonus_points >= 0),
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS athletes (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL, -- может быть пустым: спортсмена завёл организатор
  last_name       TEXT NOT NULL,
  first_name      TEXT NOT NULL,
  middle_name     TEXT,
  birth_date      TEXT,
  municipality_id INTEGER REFERENCES municipalities(id),
  organization_id INTEGER REFERENCES organizations(id),
  is_public       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS athlete_disciplines (
  athlete_id    INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  discipline_id INTEGER NOT NULL REFERENCES disciplines(id),
  PRIMARY KEY (athlete_id, discipline_id)
);

CREATE TABLE IF NOT EXISTS athlete_ranks (
  id           INTEGER PRIMARY KEY,
  athlete_id   INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  rank_id      INTEGER NOT NULL REFERENCES ranks(id),
  assigned_at  TEXT NOT NULL,
  valid_until  TEXT,                       -- у званий срока нет
  order_number TEXT,
  status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at  TEXT
);

CREATE TABLE IF NOT EXISTS competitions (
  id                   INTEGER PRIMARY KEY,
  title                TEXT NOT NULL,
  level_id             INTEGER NOT NULL REFERENCES competition_levels(id),
  format               TEXT NOT NULL DEFAULT 'OFFLINE' CHECK (format IN ('OFFLINE', 'ONLINE', 'MIXED')),
  city                 TEXT,
  venue                TEXT,
  description          TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'DRAFT'
                       CHECK (status IN ('DRAFT', 'PUBLISHED', 'ONGOING', 'FINISHED', 'RESULTS_PUBLISHED', 'CANCELLED')),
  start_date           TEXT NOT NULL,
  end_date             TEXT NOT NULL,
  reg_start            TEXT,
  reg_end              TEXT,
  regulations_url      TEXT,
  is_external          INTEGER NOT NULL DEFAULT 0, -- внешний старт: вносим только своих, число участников вручную
  results_published_at TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Дисциплина внутри соревнования: единица заявок и результатов.
CREATE TABLE IF NOT EXISTS competition_events (
  id                 INTEGER PRIMARY KEY,
  competition_id     INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  discipline_id      INTEGER NOT NULL REFERENCES disciplines(id),
  participants_total INTEGER CHECK (participants_total IS NULL OR participants_total > 0),
  UNIQUE (competition_id, discipline_id)
);

CREATE TABLE IF NOT EXISTS registrations (
  id         INTEGER PRIMARY KEY,
  event_id   INTEGER NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE,
  athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, athlete_id)
);

CREATE TABLE IF NOT EXISTS results (
  id         INTEGER PRIMARY KEY,
  event_id   INTEGER NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE,
  athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  place      INTEGER CHECK (place IS NULL OR place > 0),
  score      REAL,
  note       TEXT,
  UNIQUE (event_id, athlete_id)
);

CREATE TABLE IF NOT EXISTS rating_changes (
  id              INTEGER PRIMARY KEY,
  athlete_id      INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  competition_id  INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  rating_before   REAL NOT NULL,
  rating_after    REAL NOT NULL,
  position_before INTEGER,
  position_after  INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rating_config (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  version       TEXT NOT NULL,
  top_n         INTEGER NOT NULL,
  window_months INTEGER NOT NULL,
  full_months   INTEGER NOT NULL,
  place_floor   REAL NOT NULL,
  place_power   REAL NOT NULL,
  field_ref     INTEGER NOT NULL,
  field_min     REAL NOT NULL,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS news (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  excerpt      TEXT NOT NULL,
  body         TEXT NOT NULL,
  published_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('FEDERATION', 'REGULATIONS', 'RULES', 'MATERIALS')),
  url          TEXT,
  description  TEXT,
  published_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  INTEGER,
  details    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Настройки сайта: название и контакты Федерации
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- Модуль проведения соревнований (кейс №2). Контест — это соревнование первого этапа,
-- которое проводится прямо на платформе: с заданиями, отправкой решений и проверкой.
CREATE TABLE IF NOT EXISTS contests (
  competition_id    INTEGER PRIMARY KEY REFERENCES competitions(id) ON DELETE CASCADE,
  on_platform       INTEGER NOT NULL DEFAULT 0,
  start_time        TEXT NOT NULL DEFAULT '10:00',
  end_time          TEXT NOT NULL DEFAULT '14:00',
  rules             TEXT NOT NULL DEFAULT '',
  auto_status       INTEGER NOT NULL DEFAULT 0, -- статус меняется сам по времени начала и окончания
  external_platform TEXT,                        -- соревнование на внешней площадке, например Codeforces
  external_url      TEXT
);

CREATE TABLE IF NOT EXISTS contest_tasks (
  id             INTEGER PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  title          TEXT NOT NULL,
  statement      TEXT NOT NULL,
  max_score      INTEGER NOT NULL CHECK (max_score > 0),
  materials_url  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Каждая попытка хранится отдельно: балл за задание — лучшая проверенная попытка.
CREATE TABLE IF NOT EXISTS submissions (
  id          INTEGER PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES contest_tasks(id) ON DELETE CASCADE,
  athlete_id  INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  answer_text TEXT,
  answer_url  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  score       INTEGER CHECK (score IS NULL OR score >= 0),
  comment     TEXT,
  checked_at  TEXT,
  checked_by  INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_contest_tasks_competition ON contest_tasks(competition_id);
CREATE INDEX IF NOT EXISTS idx_submissions_task ON submissions(task_id);
CREATE INDEX IF NOT EXISTS idx_submissions_athlete ON submissions(athlete_id);

CREATE INDEX IF NOT EXISTS idx_results_athlete ON results(athlete_id);
CREATE INDEX IF NOT EXISTS idx_registrations_athlete ON registrations(athlete_id);
CREATE INDEX IF NOT EXISTS idx_events_competition ON competition_events(competition_id);
CREATE INDEX IF NOT EXISTS idx_athlete_ranks_athlete ON athlete_ranks(athlete_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Чат участников и расписание хакатона. Чат есть у каждого соревнования: организатор допускает
-- заявку — спортсмен попадает в чат; отклоняет или спортсмен отзывает заявку — выходит из него.
CREATE TABLE IF NOT EXISTS chats (
  id             INTEGER PRIMARY KEY,
  competition_id INTEGER NOT NULL UNIQUE REFERENCES competitions(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Спортсмены попадают сюда после допуска. Организатор видит все чаты, строка появляется, когда он открывает чат.
CREATE TABLE IF NOT EXISTS chat_members (
  chat_id      INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY,
  chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL, -- пусто: сообщение платформы
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Пункты расписания: чекпоинты, кофе-брейки, защита. Когда соревнование идёт, в момент начала
-- пункта допущенные участники получают уведомление, а в чат приходит сообщение платформы.
CREATE TABLE IF NOT EXISTS schedule_items (
  id             INTEGER PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'OTHER'
                 CHECK (kind IN ('OPENING', 'CHECKPOINT', 'COFFEE_BREAK', 'MEAL', 'WORKSHOP', 'DEADLINE', 'PITCH', 'CLOSING', 'OTHER')),
  title          TEXT NOT NULL,
  description    TEXT,
  starts_at      TEXT NOT NULL,           -- местное время сервера: 2026-09-26T14:00
  notified_at    TEXT,                    -- когда ушло уведомление о начале
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
CREATE INDEX IF NOT EXISTS idx_schedule_competition ON schedule_items(competition_id, starts_at);
