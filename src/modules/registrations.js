// Заявки спортсменов на дисциплины внутри соревнований.
import { all, get, run } from '../db/index.js';
import { registrationInfo } from './competitions.js';
import { checkAgeAndRank } from './eligibility.js';
import { audit, notify } from './notifications.js';
import { syncMembership } from './chats.js';

export const REG_STATUS_LABELS = {
  SUBMITTED: 'Заявка подана',
  APPROVED: 'Допущен',
  REJECTED: 'Отклонена',
  WITHDRAWN: 'Отозвана',
};

export const isProfileComplete = (a) => Boolean(a && a.municipality_id && a.organization_id);

export function applyToEvent(athlete, eventId) {
  const ev = get(
    `SELECT e.id, e.competition_id, c.status, c.reg_start, c.reg_end, c.title,
            c.age_min, c.age_max, c.required_rank_id
       FROM competition_events e JOIN competitions c ON c.id = e.competition_id WHERE e.id = ?`,
    eventId,
  );
  if (!ev) return { error: 'Дисциплина не найдена' };
  if (!registrationInfo(ev).open) return { error: 'Регистрация на это соревнование сейчас закрыта', competitionId: ev.competition_id };
  if (!isProfileComplete(athlete)) return { error: 'profile', competitionId: ev.competition_id };
  const blocked = checkAgeAndRank(athlete, ev);
  if (blocked) return { ...blocked, competitionId: ev.competition_id };
  // Участник команды подаётся вместе с ней: заявка помечается team_id.
  const team = get(
    `SELECT t.id FROM team_members m JOIN teams t ON t.id = m.team_id
      WHERE t.competition_id = ? AND m.athlete_id = ?`,
    ev.competition_id, athlete.id,
  );
  const teamId = team ? team.id : null;
  const existing = get('SELECT * FROM registrations WHERE event_id = ? AND athlete_id = ?', eventId, athlete.id);
  if (existing) {
    if (existing.status !== 'WITHDRAWN') return { error: 'Вы уже подали заявку в эту дисциплину', competitionId: ev.competition_id };
    run("UPDATE registrations SET status = 'SUBMITTED', team_id = ?, created_at = datetime('now') WHERE id = ?", teamId, existing.id);
  } else {
    run('INSERT INTO registrations (event_id, athlete_id, team_id) VALUES (?, ?, ?)', eventId, athlete.id, teamId);
  }
  return { ok: true, competitionId: ev.competition_id, title: ev.title };
}

export function withdrawRegistration(athlete, registrationId) {
  const reg = get(
    `SELECT r.id, r.athlete_id, r.status, e.competition_id, c.status AS competition_status, c.reg_start, c.reg_end
       FROM registrations r JOIN competition_events e ON e.id = r.event_id JOIN competitions c ON c.id = e.competition_id
      WHERE r.id = ?`,
    registrationId,
  );
  if (!reg || reg.athlete_id !== athlete.id) return { error: 'Заявка не найдена' };
  if (!['SUBMITTED', 'APPROVED'].includes(reg.status)) return { error: 'Эту заявку уже нельзя отозвать', competitionId: reg.competition_id };
  const window = { status: reg.competition_status, reg_start: reg.reg_start, reg_end: reg.reg_end };
  if (!registrationInfo(window).open) return { error: 'Регистрация закрыта, заявку отозвать нельзя', competitionId: reg.competition_id };
  run("UPDATE registrations SET status = 'WITHDRAWN' WHERE id = ?", registrationId);
  syncMembership(reg.competition_id, reg.athlete_id);
  return { ok: true, competitionId: reg.competition_id };
}

export function setRegistrationStatus(registrationId, status, userId) {
  if (!['SUBMITTED', 'APPROVED', 'REJECTED'].includes(status)) return { error: 'Неизвестный статус' };
  const reg = get(
    'SELECT r.*, e.competition_id FROM registrations r JOIN competition_events e ON e.id = r.event_id WHERE r.id = ?',
    registrationId,
  );
  if (!reg) return { error: 'Заявка не найдена' };
  run('UPDATE registrations SET status = ? WHERE id = ?', status, registrationId);
  audit(userId, `REGISTRATION_${status}`, 'registration', registrationId);
  // Допуск добавляет спортсмена в чат участников и присылает уведомление, отказ убирает из чата.
  const chat = syncMembership(reg.competition_id, reg.athlete_id);
  if (status === 'REJECTED' && reg.status !== 'REJECTED') {
    const info = get(
      'SELECT a.user_id, c.title FROM athletes a, competitions c WHERE a.id = ? AND c.id = ?',
      reg.athlete_id, reg.competition_id,
    );
    notify(info?.user_id, `Заявка отклонена: ${info?.title}`, 'Организатор не допустил заявку. Вопросы можно задать по контактам Федерации.', `/competitions/${reg.competition_id}`);
  }
  return { ok: true, competitionId: reg.competition_id, athleteId: reg.athlete_id, chat };
}

export function competitionRegistrations(competitionId) {
  return all(
    `SELECT r.id, r.status, r.created_at, r.event_id, a.id AS athlete_id, a.last_name, a.first_name, a.middle_name, a.birth_date,
            a.is_public, a.user_id, m.name AS municipality, o.name AS organization, d.short_name AS discipline_short
       FROM registrations r
       JOIN competition_events e ON e.id = r.event_id
       JOIN disciplines d ON d.id = e.discipline_id
       JOIN athletes a ON a.id = r.athlete_id
       LEFT JOIN municipalities m ON m.id = a.municipality_id
       LEFT JOIN organizations o ON o.id = a.organization_id
      WHERE e.competition_id = ?
      ORDER BY d.sort_order, r.status = 'WITHDRAWN', r.status = 'REJECTED', r.created_at, a.last_name`,
    competitionId,
  );
}

export function athleteRegistrations(athleteId) {
  return all(
    `SELECT r.id, r.status, r.created_at, c.id AS competition_id, c.title, c.status AS competition_status,
            c.start_date, c.end_date, c.city, c.format, c.reg_start, c.reg_end, d.short_name AS discipline_short,
            res.place, e.participants_total,
            (SELECT COUNT(*) FROM results x WHERE x.event_id = e.id AND x.place IS NOT NULL) AS placed
       FROM registrations r
       JOIN competition_events e ON e.id = r.event_id
       JOIN competitions c ON c.id = e.competition_id
       JOIN disciplines d ON d.id = e.discipline_id
       LEFT JOIN results res ON res.event_id = e.id AND res.athlete_id = r.athlete_id
      WHERE r.athlete_id = ?
      ORDER BY c.start_date DESC`,
    athleteId,
  );
}

export function athleteRegistrationsFor(competitionId, athleteId) {
  return all(
    `SELECT r.*, d.short_name AS discipline_short FROM registrations r
       JOIN competition_events e ON e.id = r.event_id JOIN disciplines d ON d.id = e.discipline_id
      WHERE e.competition_id = ? AND r.athlete_id = ?`,
    competitionId,
    athleteId,
  );
}
