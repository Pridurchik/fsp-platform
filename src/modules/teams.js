// Команды внутри соревнования. Результаты и рейтинг остаются индивидуальными:
// заявка каждого участника хранит team_id, из них выводится состав и зачёт.
// Минимум проверяется мягко (предупреждение организатору), максимум — жёстко при вступлении.
import { randomBytes } from 'node:crypto';
import { all, get, run, tx } from '../db/index.js';
import { getCompetition } from './competitions.js';
import { isProfileComplete } from './registrations.js';
import { checkAgeAndRank } from './eligibility.js';
import { registrationInfo } from './competitions.js';

export function myTeamIn(competitionId, athleteId) {
  return (
    get(
      `SELECT t.* FROM team_members m JOIN teams t ON t.id = m.team_id
        WHERE t.competition_id = ? AND m.athlete_id = ?`,
      competitionId, athleteId,
    ) || null
  );
}

export function teamSize(teamId) {
  return get('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?', teamId).n;
}

export function teamMembers(teamId) {
  return all(
    `SELECT m.*, a.last_name, a.first_name, a.middle_name, a.is_public, m2.name AS municipality, o.name AS organization
       FROM team_members m JOIN athletes a ON a.id = m.athlete_id
       LEFT JOIN municipalities m2 ON m2.id = a.municipality_id
       LEFT JOIN organizations o ON o.id = a.organization_id
      WHERE m.team_id = ? ORDER BY m.is_captain DESC, m.joined_at, m.athlete_id`,
    teamId,
  );
}

export function teamDetails(teamId) {
  const t = get('SELECT t.*, c.title AS competition_title FROM teams t JOIN competitions c ON c.id = t.competition_id WHERE t.id = ?', teamId);
  if (!t) return null;
  return { ...t, members: teamMembers(teamId), size: teamMembers(teamId).length };
}

// Команды соревнования, не добравшие минимум: организатору на панель внимания.
export function underfilledTeams(competitionId) {
  return all(
    `SELECT t.*, c.min_team_size, COUNT(m.athlete_id) AS size FROM teams t
       JOIN competitions c ON c.id = t.competition_id
       LEFT JOIN team_members m ON m.team_id = t.id
      WHERE t.competition_id = ? AND c.min_team_size > 1
      GROUP BY t.id HAVING size < c.min_team_size`,
    competitionId,
  );
}

function newInviteCode() {
  for (let i = 0; i < 20; i++) {
    const code = randomBytes(4).toString('hex').toUpperCase();
    if (!get('SELECT id FROM teams WHERE invite_code = ?', code)) return code;
  }
  throw new Error('Не получилось сгенерировать код команды');
}

function attachTeamToRegistrations(competitionId, athleteId, teamId) {
  run(
    `UPDATE registrations SET team_id = ? WHERE athlete_id = ? AND status IN ('SUBMITTED', 'APPROVED')
       AND event_id IN (SELECT id FROM competition_events WHERE competition_id = ?)`,
    teamId, athleteId, competitionId,
  );
}

export function createTeam(athlete, competitionId, name) {
  const c = getCompetition(competitionId);
  if (!c || c.status === 'DRAFT') return { error: 'Соревнование не найдено', competitionId };
  if (!(c.max_team_size > 1)) return { error: 'Командное участие здесь не предусмотрено', competitionId };
  if (c.status === 'CANCELLED') return { error: 'Соревнование отменено', competitionId };
  if (!registrationInfo(c).open) return { error: 'Создать команду можно только во время регистрации', competitionId };
  if (!isProfileComplete(athlete)) return { error: 'profile', competitionId };
  const bad = checkAgeAndRank(athlete, c);
  if (bad) return { ...bad, competitionId };
  const clean = String(name ?? '').trim().slice(0, 60);
  if (clean.length < 2) return { error: 'Название команды — от 2 до 60 символов', competitionId };
  if (myTeamIn(competitionId, athlete.id)) return { error: 'Вы уже состоите в команде на этом соревновании', competitionId };
  // NOCASE в SQLite работает только для ASCII, поэтому кириллицу сравниваем в JS.
  const taken = all('SELECT name FROM teams WHERE competition_id = ?', competitionId).some(
    (t) => t.name.toLowerCase() === clean.toLowerCase(),
  );
  if (taken) return { error: 'Команда с таким названием уже есть', competitionId };
  return tx(() => {
    const inviteCode = newInviteCode();
    const { id } = run('INSERT INTO teams (competition_id, name, invite_code, created_by) VALUES (?, ?, ?, ?)', competitionId, clean, inviteCode, athlete.id);
    run('INSERT INTO team_members (team_id, athlete_id, is_captain) VALUES (?, ?, 1)', id, athlete.id);
    attachTeamToRegistrations(competitionId, athlete.id, id);
    return { ok: true, teamId: id, inviteCode, competitionId };
  });
}

export function joinTeamByCode(athlete, code, expectedCompetitionId = null) {
  const clean = String(code ?? '').trim().toUpperCase();
  const t = get('SELECT * FROM teams WHERE invite_code = ?', clean);
  if (!t) return { error: 'Команда с таким кодом не найдена' };
  if (expectedCompetitionId != null && t.competition_id !== Number(expectedCompetitionId)) {
    return { error: 'Код команды относится к другому соревнованию', competitionId: Number(expectedCompetitionId) };
  }
  const c = getCompetition(t.competition_id);
  if (!c || c.status === 'CANCELLED') return { error: 'Соревнование недоступно', competitionId: t.competition_id };
  if (!registrationInfo(c).open) return { error: 'Вступить в команду можно только во время регистрации', competitionId: t.competition_id };
  if (!isProfileComplete(athlete)) return { error: 'profile', competitionId: t.competition_id };
  const bad = checkAgeAndRank(athlete, c);
  if (bad) return { ...bad, competitionId: t.competition_id };
  if (myTeamIn(t.competition_id, athlete.id)) return { error: 'Вы уже состоите в команде на этом соревновании', competitionId: t.competition_id };
  if (teamSize(t.id) >= c.max_team_size) return { error: `Команда заполнена: максимум ${c.max_team_size}`, competitionId: t.competition_id };
  tx(() => {
    run('INSERT INTO team_members (team_id, athlete_id) VALUES (?, ?)', t.id, athlete.id);
    attachTeamToRegistrations(t.competition_id, athlete.id, t.id);
  });
  return { ok: true, teamId: t.id, competitionId: t.competition_id };
}

export function leaveTeam(athlete, teamId) {
  const t = get('SELECT * FROM teams WHERE id = ?', teamId);
  if (!t) return { error: 'Команда не найдена' };
  const competition = getCompetition(t.competition_id);
  const me = get('SELECT * FROM team_members WHERE team_id = ? AND athlete_id = ?', teamId, athlete.id);
  if (!me) return { error: 'Вы не состоите в этой команде', competitionId: t.competition_id };
  if (competition && !competition.allow_individual && get(
    `SELECT 1 FROM registrations r JOIN competition_events e ON e.id = r.event_id
      WHERE e.competition_id = ? AND r.athlete_id = ? AND r.status IN ('SUBMITTED', 'APPROVED') LIMIT 1`,
    t.competition_id, athlete.id,
  )) {
    return { error: 'Сначала отзовите заявку на соревнование, затем можно выйти из команды.', competitionId: t.competition_id };
  }
  tx(() => {
    run('DELETE FROM team_members WHERE team_id = ? AND athlete_id = ?', teamId, athlete.id);
    run(
      `UPDATE registrations SET team_id = NULL WHERE athlete_id = ?
         AND event_id IN (SELECT id FROM competition_events WHERE competition_id = ?)`,
      athlete.id, t.competition_id,
    );
    if (me.is_captain) {
      const next = get('SELECT athlete_id FROM team_members WHERE team_id = ? ORDER BY joined_at, rowid LIMIT 1', teamId);
      if (next) run('UPDATE team_members SET is_captain = 1 WHERE team_id = ? AND athlete_id = ?', teamId, next.athlete_id);
    }
    if (teamSize(teamId) === 0) run('DELETE FROM teams WHERE id = ?', teamId);
  });
  return { ok: true, competitionId: t.competition_id };
}

export function teamsForCompetition(competitionId, athleteId = null) {
  const rows = all(
    `SELECT t.id, t.competition_id, t.name, t.invite_code, COUNT(m.athlete_id) AS size,
            MAX(CASE WHEN m.athlete_id = ? THEN 1 ELSE 0 END) AS is_member,
            MAX(CASE WHEN m.athlete_id = ? AND m.is_captain = 1 THEN 1 ELSE 0 END) AS is_captain
       FROM teams t LEFT JOIN team_members m ON m.team_id = t.id
      WHERE t.competition_id = ? GROUP BY t.id ORDER BY t.name COLLATE NOCASE`,
    athleteId, athleteId, competitionId,
  );
  const c = getCompetition(competitionId);
  return rows.map((t) => ({
    ...t,
    invite_code: t.is_member ? t.invite_code : null,
    members: teamMembers(t.id),
    maxSize: c?.max_team_size ?? 1,
  }));
}
