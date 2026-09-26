// Соревнования: карточка, дисциплины внутри соревнования и машина статусов.
import { all, get, run, tx } from '../db/index.js';
import { todayISO, fmtDate, isISODate } from '../core/dates.js';
import { audit } from './notifications.js';
import { announceStatus } from './schedule.js';

export const STATUS_LABELS = {
  DRAFT: 'Черновик',
  PUBLISHED: 'Опубликовано',
  ONGOING: 'Идёт',
  FINISHED: 'Завершено',
  RESULTS_PUBLISHED: 'Итоги опубликованы',
  CANCELLED: 'Отменено',
};

export const FORMAT_LABELS = { OFFLINE: 'Очно', ONLINE: 'Дистанционно', MIXED: 'Смешанный формат' };

// Разрешённые переходы. Кнопки в кабинете организатора строятся из этой таблицы.
export const TRANSITIONS = {
  DRAFT: [
    { action: 'publish', to: 'PUBLISHED', label: 'Опубликовать', hint: 'Соревнование появится на сайте, откроется регистрация по датам' },
    { action: 'cancel', to: 'CANCELLED', label: 'Отменить', danger: true },
  ],
  PUBLISHED: [
    { action: 'start', to: 'ONGOING', label: 'Начать соревнование', hint: 'Заявки закроются. Если старт раньше даты начала, дата обновится на сегодня' },
    { action: 'unpublish', to: 'DRAFT', label: 'Вернуть в черновик' },
    { action: 'cancel', to: 'CANCELLED', label: 'Отменить', danger: true },
  ],
  ONGOING: [
    { action: 'finish', to: 'FINISHED', label: 'Завершить', hint: 'Откроется ввод результатов. Дата окончания станет фактической' },
    { action: 'cancel', to: 'CANCELLED', label: 'Отменить', danger: true },
  ],
  FINISHED: [
    { action: 'publishResults', to: 'RESULTS_PUBLISHED', label: 'Опубликовать итоги', hint: 'Итоги появятся на сайте и в профилях, рейтинг пересчитается', accent: true },
  ],
  RESULTS_PUBLISHED: [
    { action: 'reopen', to: 'FINISHED', label: 'Исправить итоги', hint: 'Итоги скроются до повторной публикации, рейтинг временно вернётся к прежнему' },
  ],
  CANCELLED: [],
};

export const PHASES = {
  upcoming: { label: 'Предстоящие', statuses: ['PUBLISHED'] },
  current: { label: 'Текущие', statuses: ['ONGOING'] },
  finished: { label: 'Завершённые', statuses: ['FINISHED', 'RESULTS_PUBLISHED', 'CANCELLED'] },
};

export function phaseOf(status) {
  for (const [key, p] of Object.entries(PHASES)) if (p.statuses.includes(status)) return key;
  return 'draft';
}

export function registrationInfo(c, today = todayISO()) {
  if (c.status === 'DRAFT') return { open: false, text: 'Черновик, на сайте не виден' };
  if (c.status !== 'PUBLISHED') return { open: false, text: 'Регистрация закрыта' };
  if (c.reg_start && today < c.reg_start) return { open: false, soon: true, text: `Регистрация откроется ${fmtDate(c.reg_start)}` };
  if (c.reg_end && today > c.reg_end) return { open: false, text: 'Регистрация закрыта' };
  return { open: true, text: c.reg_end ? `Регистрация открыта до ${fmtDate(c.reg_end)}` : 'Регистрация открыта' };
}

// Настройки проведения из модуля контестов (кейс №2) подмешиваются к каждому соревнованию.
const COMPETITION_SQL = `
  SELECT c.*, l.name AS level_name, l.short_name AS level_short, l.base_points, l.code AS level_code,
         COALESCE(k.on_platform, 0) AS on_platform, k.start_time, k.end_time, k.external_platform, k.external_url
    FROM competitions c JOIN competition_levels l ON l.id = c.level_id
    LEFT JOIN contests k ON k.competition_id = c.id`;

export const getCompetition = (id) => get(`${COMPETITION_SQL} WHERE c.id = ?`, id);

export function eventsOf(competitionId) {
  return all(
    `SELECT e.*, d.name AS discipline_name, d.short_name AS discipline_short, d.code AS discipline_code,
            (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status IN ('SUBMITTED', 'APPROVED')) AS registered,
            (SELECT COUNT(*) FROM results x WHERE x.event_id = e.id AND x.place IS NOT NULL) AS placed
       FROM competition_events e JOIN disciplines d ON d.id = e.discipline_id
      WHERE e.competition_id = ?
      ORDER BY d.sort_order`,
    competitionId,
  );
}

export function listCompetitions({ phase = null, disciplineId = null, levelId = null, status = null, includeDrafts = false } = {}) {
  const where = [];
  const params = [];
  if (phase && PHASES[phase]) {
    where.push(`c.status IN (${PHASES[phase].statuses.map(() => '?').join(',')})`);
    params.push(...PHASES[phase].statuses);
  } else if (status) {
    where.push('c.status = ?');
    params.push(status);
  } else if (!includeDrafts) {
    where.push("c.status <> 'DRAFT'");
  }
  if (disciplineId) {
    where.push('EXISTS (SELECT 1 FROM competition_events e WHERE e.competition_id = c.id AND e.discipline_id = ?)');
    params.push(disciplineId);
  }
  if (levelId) {
    where.push('c.level_id = ?');
    params.push(levelId);
  }
  const order = phase === 'finished' ? 'c.end_date DESC' : 'c.start_date ASC';
  const rows = all(`${COMPETITION_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}, c.id`, ...params);
  return rows.map((c) => ({ ...c, events: eventsOf(c.id) }));
}

export function phaseCounts() {
  const rows = all("SELECT status, COUNT(*) AS n FROM competitions WHERE status <> 'DRAFT' GROUP BY status");
  const counts = { upcoming: 0, current: 0, finished: 0 };
  for (const r of rows) counts[phaseOf(r.status)] = (counts[phaseOf(r.status)] || 0) + r.n;
  return counts;
}

// ---------- создание и редактирование ----------

export function readCompetitionForm(form) {
  const value = (k) => String(form.get(k) ?? '').trim();
  return {
    title: value('title'),
    level_id: Number(value('level_id')) || null,
    format: value('format') || 'OFFLINE',
    city: value('city') || null,
    venue: value('venue') || null,
    description: value('description'),
    start_date: value('start_date'),
    end_date: value('end_date'),
    reg_start: value('reg_start') || null,
    reg_end: value('reg_end') || null,
    regulations_url: value('regulations_url') || null,
    is_external: form.get('is_external') === '1' ? 1 : 0,
    disciplineIds: form.getAll('discipline_ids').map(Number).filter(Boolean),
  };
}

export function validateCompetition(d) {
  const errors = {};
  if (d.title.length < 5) errors.title = 'Название должно быть не короче 5 символов';
  if (!d.level_id || !get('SELECT id FROM competition_levels WHERE id = ?', d.level_id)) errors.level_id = 'Выберите уровень';
  if (!FORMAT_LABELS[d.format]) errors.format = 'Выберите формат';
  if (!d.disciplineIds.length) errors.discipline_ids = 'Отметьте хотя бы одну дисциплину';
  if (!isISODate(d.start_date)) errors.start_date = 'Укажите дату начала';
  if (!isISODate(d.end_date)) errors.end_date = 'Укажите дату окончания';
  else if (isISODate(d.start_date) && d.end_date < d.start_date) errors.end_date = 'Окончание не может быть раньше начала';
  if (d.reg_start && !isISODate(d.reg_start)) errors.reg_start = 'Неверная дата';
  if (d.reg_end && !isISODate(d.reg_end)) errors.reg_end = 'Неверная дата';
  if (d.reg_start && d.reg_end && d.reg_end < d.reg_start) errors.reg_end = 'Регистрация не может закрыться раньше, чем откроется';
  if (d.format !== 'ONLINE' && !d.city) errors.city = 'Для очного формата укажите город';
  if (d.regulations_url && !/^(https?:\/\/|\/)/.test(d.regulations_url)) errors.regulations_url = 'Ссылка должна начинаться с http:// или https://';
  return errors;
}

export function createCompetition(d, userId) {
  return tx(() => {
    const { id } = run(
      `INSERT INTO competitions (title, level_id, format, city, venue, description, start_date, end_date, reg_start, reg_end, regulations_url, is_external)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      d.title, d.level_id, d.format, d.city, d.venue, d.description, d.start_date, d.end_date,
      d.reg_start, d.reg_end, d.regulations_url, d.is_external,
    );
    for (const disciplineId of d.disciplineIds) {
      run('INSERT INTO competition_events (competition_id, discipline_id) VALUES (?, ?)', id, disciplineId);
    }
    audit(userId, 'CREATE', 'competition', id, { title: d.title });
    return id;
  });
}

export function updateCompetition(id, d, userId) {
  return tx(() => {
    const current = eventsOf(id);
    const keep = new Set(d.disciplineIds);
    for (const e of current) {
      if (!keep.has(e.discipline_id) && (e.registered > 0 || e.placed > 0)) {
        return { error: `В дисциплине «${e.discipline_short}» уже есть заявки или результаты, её нельзя убрать` };
      }
    }
    run(
      `UPDATE competitions SET title = ?, level_id = ?, format = ?, city = ?, venue = ?, description = ?, start_date = ?, end_date = ?,
              reg_start = ?, reg_end = ?, regulations_url = ?, is_external = ?, updated_at = datetime('now')
        WHERE id = ?`,
      d.title, d.level_id, d.format, d.city, d.venue, d.description, d.start_date, d.end_date,
      d.reg_start, d.reg_end, d.regulations_url, d.is_external, id,
    );
    for (const e of current) if (!keep.has(e.discipline_id)) run('DELETE FROM competition_events WHERE id = ?', e.id);
    const existing = new Set(current.map((e) => e.discipline_id));
    for (const disciplineId of d.disciplineIds) {
      if (!existing.has(disciplineId)) run('INSERT INTO competition_events (competition_id, discipline_id) VALUES (?, ?)', id, disciplineId);
    }
    audit(userId, 'UPDATE', 'competition', id, { title: d.title });
    return { ok: true };
  });
}

// Смена статуса, кроме публикации итогов (она в модуле результатов: там пересчёт рейтинга).
export function applyTransition(id, action, userId) {
  const c = getCompetition(id);
  if (!c) return { error: 'Соревнование не найдено' };
  const t = (TRANSITIONS[c.status] || []).find((x) => x.action === action);
  if (!t) return { error: `Из статуса «${STATUS_LABELS[c.status]}» так перейти нельзя` };
  if (action === 'publishResults') return { error: 'Итоги публикуются из раздела результатов' };
  const today = todayISO();
  tx(() => {
    if (action === 'start' && c.start_date > today) run('UPDATE competitions SET start_date = ? WHERE id = ?', today, id);
    if (action === 'finish') {
      if (c.end_date > today) run('UPDATE competitions SET end_date = ? WHERE id = ?', today, id);
      run('UPDATE competitions SET start_date = MIN(start_date, end_date) WHERE id = ?', id);
    }
    if (action === 'reopen') run('UPDATE competitions SET results_published_at = NULL WHERE id = ?', id);
    run("UPDATE competitions SET status = ?, updated_at = datetime('now') WHERE id = ?", t.to, id);
    audit(userId, `STATUS_${t.to}`, 'competition', id, { from: c.status, to: t.to });
    // Хакатон начался или закончился: участники узнают об этом в уведомлениях и в чате.
    if (t.to === 'ONGOING' || t.to === 'FINISHED') announceStatus(id, t.to);
  });
  return { ok: true, to: t.to, label: t.label };
}
