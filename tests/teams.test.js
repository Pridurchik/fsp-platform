// Продакшен-модель: миграции схемы, допуск по возрасту/разряду, команды.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { initDatabase, closeDatabase, get, all, run } from '../src/db/index.js';
import { migrate, schemaVersion } from '../src/db/migrate.js';
import { seedBase } from '../src/db/seed.js';
import { applyToEvent } from '../src/modules/registrations.js';
import { createTeam, joinTeamByCode, leaveTeam, myTeamIn, teamMembers, teamSize, underfilledTeams } from '../src/modules/teams.js';
import { todayISO, addDays } from '../src/core/dates.js';

const dbFile = path.join(os.tmpdir(), `fsp-teams-${process.pid}.sqlite`);
const yearsAgo = (n) => {
  const t = todayISO();
  return `${Number(t.slice(0, 4)) - n}${t.slice(4)}`;
};

let ALGO, RD, MAKHACHKALA, ORG;

function mkAthlete(first, birth, mun = MAKHACHKALA, org = ORG) {
  return run('INSERT INTO athletes (last_name, first_name, birth_date, municipality_id, organization_id) VALUES (?, ?, ?, ?, ?)', 'Тестов', first, birth, mun, org).id;
}
const athleteOf = (id) => get('SELECT * FROM athletes WHERE id = ?', id);

function mkCompetition(over = {}) {
  return run(
    `INSERT INTO competitions (title, level_id, format, city, start_date, end_date, status, age_min, age_max,
       required_rank_id, min_team_size, max_team_size, allow_individual)
     VALUES (?, ?, 'OFFLINE', ?, ?, ?, 'PUBLISHED', ?, ?, ?, ?, ?, ?)`,
    over.title || 'Тестовый хакатон', RD, 'Махачкала', todayISO(), addDays(todayISO(), 7),
    over.age_min ?? null, over.age_max ?? null, over.required_rank_id ?? null,
    over.min_team_size ?? 1, over.max_team_size ?? 1, over.allow_individual ?? 1,
  ).id;
}
const mkEvent = (competitionId) => run('INSERT INTO competition_events (competition_id, discipline_id) VALUES (?, ?)', competitionId, ALGO).id;

before(() => {
  for (const s of ['', '-wal', '-shm']) rmSync(dbFile + s, { force: true });
  initDatabase(dbFile);
  migrate();
  seedBase();
  ALGO = get("SELECT id FROM disciplines WHERE code = 'ALGO'").id;
  RD = get("SELECT id FROM competition_levels WHERE code = 'RD'").id;
  MAKHACHKALA = get("SELECT id FROM municipalities WHERE name = 'Махачкала'").id;
  ORG = run('INSERT INTO organizations (name, kind, municipality_id) VALUES (?, ?, ?)', 'Тестовая школа', 'SCHOOL', MAKHACHKALA).id;
});

after(() => {
  closeDatabase();
  for (const s of ['', '-wal', '-shm']) rmSync(dbFile + s, { force: true });
});

test('миграция: версия 1, новые таблицы и справочники, идемпотентность и ремонт', () => {
  assert.equal(schemaVersion(), 1);
  for (const t of ['tags', 'competition_tags', 'languages', 'competition_languages', 'teams', 'team_members']) {
    assert.ok(get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", t), t);
  }
  assert.equal(get('SELECT COUNT(*) AS n FROM tags').n, 6);
  assert.equal(get('SELECT COUNT(*) AS n FROM languages').n, 7);
  assert.ok(all('PRAGMA table_info(competitions)').some((r) => r.name === 'age_min'));
  assert.ok(all('PRAGMA table_info(registrations)').some((r) => r.name === 'team_id'));
  assert.equal(migrate(), 1); // повторный прогон ничего не ломает
  run('DROP INDEX IF EXISTS idx_registrations_team');
  run('ALTER TABLE registrations DROP COLUMN team_id');
  assert.ok(!all('PRAGMA table_info(registrations)').some((r) => r.name === 'team_id'));
  migrate();
  assert.ok(all('PRAGMA table_info(registrations)').some((r) => r.name === 'team_id'));
  assert.ok(get("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_registrations_team'"));
});

test('допуск: возраст и разряд', () => {
  const comp = mkCompetition({ age_min: 14, age_max: 18 });
  const ev = mkEvent(comp);
  const teen = mkAthlete('Подросток', yearsAgo(15));
  assert.ok(applyToEvent(athleteOf(teen), ev).ok);
  const adult = mkAthlete('Взрослый', yearsAgo(25));
  const r1 = applyToEvent(athleteOf(adult), ev);
  assert.equal(r1.code, 'age');
  const noBirth = mkAthlete('БезДаты', null);
  const r2 = applyToEvent(athleteOf(noBirth), ev);
  assert.equal(r2.code, 'birthdate');

  const kms = get("SELECT id FROM ranks WHERE code = 'KMS'").id;
  const ranked = mkCompetition({ required_rank_id: kms });
  const ev2 = mkEvent(ranked);
  const plain = mkAthlete('БезРазряда', yearsAgo(20));
  // второй ивент того же соревнования: у подростка там ещё нет заявки
  const r3 = applyToEvent(athleteOf(plain), ev2);
  assert.equal(r3.code, 'rank');
  run("INSERT INTO athlete_ranks (athlete_id, rank_id, assigned_at, status) VALUES (?, ?, ?, 'CONFIRMED')", plain, kms, todayISO());
  assert.ok(applyToEvent(athleteOf(plain), ev2).ok);
});

test('команды: создание, вступление, лимиты, выход', () => {
  const comp = mkCompetition({ min_team_size: 2, max_team_size: 3 });
  const ev = mkEvent(comp);
  const cap = mkAthlete('Капитан', yearsAgo(20));
  const solo = mkCompetition({});
  assert.match(createTeam(athleteOf(cap), solo, 'Одиночки').error, /не предусмотрено/);

  const created = createTeam(athleteOf(cap), comp, 'Ракеты');
  assert.ok(created.ok);
  assert.equal(created.inviteCode.length, 8);
  assert.ok(myTeamIn(comp, cap));
  assert.match(createTeam(athleteOf(mkAthlete('Второй', yearsAgo(21))), comp, 'ракеты').error, /уже есть/);
  const other = mkAthlete('Другой', yearsAgo(22));
  const second = createTeam(athleteOf(other), comp, 'Кометы');
  assert.ok(second.ok, 'вторая команда создалась');
  assert.match(createTeam(athleteOf(cap), comp, 'Третья').error, /уже состоите/);

  // Вступление по коду
  const m2 = mkAthlete('Второй2', yearsAgo(21));
  const joined = joinTeamByCode(athleteOf(m2), created.inviteCode);
  assert.ok(joined.ok);
  assert.equal(teamSize(created.teamId), 2);
  assert.match(joinTeamByCode(athleteOf(mkAthlete('Чужой', yearsAgo(23))), 'NOPE1234').error, /не найдена/);
  const m3 = mkAthlete('Третий', yearsAgo(24));
  assert.ok(joinTeamByCode(athleteOf(m3), created.inviteCode).ok);
  const m4 = mkAthlete('Четвёртый', yearsAgo(25));
  assert.match(joinTeamByCode(athleteOf(m4), created.inviteCode).error, /заполнена/);

  // Заявка помечается командой
  const app = applyToEvent(athleteOf(cap), ev);
  assert.ok(app.ok);
  assert.equal(get('SELECT team_id AS t FROM registrations WHERE event_id = ? AND athlete_id = ?', ev, cap).t, created.teamId);

  // Недоукомплектованные: 'Кометы' из одного человека при минимуме 2
  assert.ok(underfilledTeams(comp).some((t) => t.name === 'Кометы'));

  // Выход участника чистит team_id
  assert.ok(leaveTeam(athleteOf(m2), created.teamId).ok);
  assert.equal(myTeamIn(comp, m2), null);
  assert.equal(get('SELECT team_id AS t FROM registrations WHERE event_id = ? AND athlete_id = ?', ev, m2), undefined);

  // Уход капитана передаёт капитанство, уход последнего удаляет команду
  assert.ok(leaveTeam(athleteOf(cap), created.teamId).ok);
  const members = teamMembers(created.teamId);
  assert.ok(members.some((m) => m.athlete_id === m3 && m.is_captain));
  assert.ok(leaveTeam(athleteOf(m3), created.teamId).ok);
  assert.equal(get('SELECT id FROM teams WHERE id = ?', created.teamId), undefined);
  assert.ok(leaveTeam(athleteOf(other), second.teamId).ok);
});
