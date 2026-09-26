// Результаты: ввод, расстановка мест, проверка и публикация итогов с пересчётом рейтинга.
import { all, get, run, tx } from '../db/index.js';
import { todayISO, monthsBetween } from '../core/dates.js';
import { fmt1, signed } from '../core/format.js';
import { getCompetition, eventsOf, STATUS_LABELS } from './competitions.js';
import { audit, notify } from './notifications.js';
import { ratingDiff, getRatingConfig } from './rating/service.js';
import { kPlace, kField, kTime } from './rating/engine.js';

// Строки ввода: все активные заявки дисциплины плюс уже внесённые результаты.
export function resultRows(eventId) {
  return all(
    `SELECT a.id AS athlete_id, a.last_name, a.first_name, a.middle_name, o.name AS organization, m.name AS municipality,
            r.place, r.score, r.note, reg.status AS reg_status
       FROM athletes a
       LEFT JOIN results r ON r.athlete_id = a.id AND r.event_id = ?
       LEFT JOIN registrations reg ON reg.athlete_id = a.id AND reg.event_id = ?
       LEFT JOIN organizations o ON o.id = a.organization_id
       LEFT JOIN municipalities m ON m.id = a.municipality_id
      WHERE r.id IS NOT NULL OR (reg.id IS NOT NULL AND reg.status IN ('SUBMITTED', 'APPROVED'))
      ORDER BY r.place IS NULL, r.place, r.score DESC, a.last_name, a.first_name`,
    eventId,
    eventId,
  );
}

const toInt = (v) => {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const toNum = (v) => {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// Форма: athlete_ids[] + place_<id>, score_<id>, note_<id>
export function saveResultsFromForm(eventId, form) {
  const ids = form.getAll('athlete_ids').map(Number).filter(Boolean);
  tx(() => {
    for (const id of ids) {
      run(
        `INSERT INTO results (event_id, athlete_id, place, score, note) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(event_id, athlete_id) DO UPDATE SET place = excluded.place, score = excluded.score, note = excluded.note`,
        eventId,
        id,
        toInt(form.get(`place_${id}`)),
        toNum(form.get(`score_${id}`)),
        String(form.get(`note_${id}`) ?? '').trim() || null,
      );
    }
  });
  return ids.length;
}

// Места по баллам: больше баллов — выше место, равные баллы делят место (1, 2, 2, 4).
export function autoPlace(eventId) {
  const rows = all('SELECT id, score FROM results WHERE event_id = ?', eventId);
  const scored = rows.filter((r) => r.score !== null).sort((a, b) => b.score - a.score);
  tx(() => {
    let place = 0;
    let prev = null;
    scored.forEach((r, i) => {
      if (prev === null || r.score !== prev) {
        place = i + 1;
        prev = r.score;
      }
      run('UPDATE results SET place = ? WHERE id = ?', place, r.id);
    });
    for (const r of rows) if (r.score === null) run('UPDATE results SET place = NULL WHERE id = ?', r.id);
  });
  return scored.length;
}

export function addAthleteToEvent(eventId, athleteId) {
  if (!get('SELECT id FROM athletes WHERE id = ?', athleteId)) return { error: 'Спортсмен не найден' };
  run('INSERT OR IGNORE INTO results (event_id, athlete_id) VALUES (?, ?)', eventId, athleteId);
  return { ok: true };
}

export function setParticipantsTotal(eventId, value) {
  const n = toInt(value);
  run('UPDATE competition_events SET participants_total = ? WHERE id = ?', n, eventId);
}

export function validateForPublish(competitionId) {
  const errors = [];
  let placedTotal = 0;
  for (const e of eventsOf(competitionId)) {
    const placed = all('SELECT place FROM results WHERE event_id = ? AND place IS NOT NULL', e.id);
    placedTotal += placed.length;
    if (!placed.length) continue;
    const n = e.participants_total || placed.length;
    if (e.participants_total && e.participants_total < placed.length) {
      errors.push(`${e.discipline_short}: участников по протоколу (${e.participants_total}) меньше, чем внесено мест (${placed.length})`);
    }
    const tooHigh = placed.filter((p) => p.place > n);
    if (tooHigh.length) errors.push(`${e.discipline_short}: место не может быть больше числа участников (${n})`);
  }
  if (placedTotal === 0) errors.push('Внесите хотя бы одно место, прежде чем публиковать итоги');
  return errors;
}

export function publishResults(competitionId, user) {
  const c = getCompetition(competitionId);
  if (!c) return { errors: ['Соревнование не найдено'] };
  if (c.status !== 'FINISHED') return { errors: [`Итоги публикуются из статуса «Завершено», сейчас «${STATUS_LABELS[c.status]}»`] };
  const errors = validateForPublish(competitionId);
  if (errors.length) return { errors };

  const diff = ratingDiff(competitionId);
  const places = new Map(
    all(
      `SELECT r.athlete_id, r.place, d.short_name AS discipline,
              COALESCE(e.participants_total, (SELECT COUNT(*) FROM results x WHERE x.event_id = e.id AND x.place IS NOT NULL)) AS n
         FROM results r JOIN competition_events e ON e.id = r.event_id JOIN disciplines d ON d.id = e.discipline_id
        WHERE e.competition_id = ? AND r.place IS NOT NULL ORDER BY r.place`,
      competitionId,
    ).map((r) => [r.athlete_id, r]),
  );

  tx(() => {
    run(
      "UPDATE competitions SET status = 'RESULTS_PUBLISHED', results_published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      competitionId,
    );
    for (const d of diff) {
      run(
        `INSERT INTO rating_changes (athlete_id, competition_id, rating_before, rating_after, position_before, position_after)
         VALUES (?, ?, ?, ?, ?, ?)`,
        d.athleteId, competitionId, d.before, d.after, d.positionBefore, d.positionAfter,
      );
      const athlete = get('SELECT user_id FROM athletes WHERE id = ?', d.athleteId);
      const p = places.get(d.athleteId);
      if (athlete?.user_id && p) {
        notify(
          athlete.user_id,
          `Итоги: ${c.title}`,
          `${p.place}-е место из ${p.n} (${p.discipline}). Рейтинг ${fmt1(d.before)} → ${fmt1(d.after)} (${signed(d.after - d.before)})`,
          `/competitions/${competitionId}`,
        );
      }
    }
    audit(user?.id, 'PUBLISH_RESULTS', 'competition', competitionId, { athletes: diff.length });
  });
  return { ok: true, diff };
}

// Итоги для публичной карточки: место и сколько баллов оно даёт в рейтинг сегодня.
export function publishedResults(competitionId) {
  const c = getCompetition(competitionId);
  if (!c) return [];
  const cfg = getRatingConfig();
  const age = Math.max(0, monthsBetween(c.end_date, todayISO()));
  return eventsOf(competitionId).map((e) => {
    const rows = all(
      `SELECT r.place, r.score, a.id AS athlete_id, a.last_name, a.first_name, a.middle_name, a.is_public,
              o.name AS organization, m.name AS municipality
         FROM results r JOIN athletes a ON a.id = r.athlete_id
         LEFT JOIN organizations o ON o.id = a.organization_id
         LEFT JOIN municipalities m ON m.id = a.municipality_id
        WHERE r.event_id = ? AND r.place IS NOT NULL
        ORDER BY r.place, a.last_name`,
      e.id,
    );
    const n = e.participants_total || rows.length;
    return {
      event: e,
      participants: n,
      rows: rows.map((r) => ({
        ...r,
        points: c.base_points * kPlace(r.place, n, cfg) * kField(n, cfg) * kTime(age, cfg),
      })),
    };
  });
}

export function athleteResults(athleteId) {
  return all(
    `SELECT r.place, r.score, c.id AS competition_id, c.title, c.end_date, c.status, l.short_name AS level_short,
            d.short_name AS discipline_short,
            COALESCE(e.participants_total, (SELECT COUNT(*) FROM results x WHERE x.event_id = e.id AND x.place IS NOT NULL)) AS participants
       FROM results r JOIN competition_events e ON e.id = r.event_id
       JOIN competitions c ON c.id = e.competition_id JOIN competition_levels l ON l.id = c.level_id
       JOIN disciplines d ON d.id = e.discipline_id
      WHERE r.athlete_id = ? AND r.place IS NOT NULL AND c.status = 'RESULTS_PUBLISHED'
      ORDER BY c.end_date DESC`,
    athleteId,
  );
}
