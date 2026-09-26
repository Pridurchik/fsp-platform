// Расписание соревнования: открытие, чекпоинты, кофе-брейки, защита проектов.
// Пока соревнование идёт, в момент начала пункта допущенные участники получают уведомление,
// а в чат участников приходит сообщение платформы. Рассылку запускает сервер (src/main.js).
import { all, get, run, tx } from '../db/index.js';
import { isISODate, fmtDate, parts, MONTHS_SHORT } from '../core/dates.js';
import { audit, notify } from './notifications.js';
import { ensureChat, systemMessage } from './chats.js';

export const SCHEDULE_KINDS = {
  OPENING: 'Открытие',
  CHECKPOINT: 'Чекпоинт',
  COFFEE_BREAK: 'Кофе-брейк',
  MEAL: 'Обед',
  WORKSHOP: 'Мастер-класс',
  DEADLINE: 'Дедлайн',
  PITCH: 'Защита проектов',
  CLOSING: 'Закрытие',
  OTHER: 'Событие',
};

// Уведомление уходит, если с начала пункта прошло не больше 15 минут. Если организатор запустил
// соревнование позже, давно начавшиеся пункты не придут участникам пачкой.
export const NOTIFY_GRACE_MINUTES = 15;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const pad = (n) => String(n).padStart(2, '0');

// Время пунктов хранится как местное время сервера, так же как время контеста: 2026-09-26T14:00
export const localStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const stampToDate = (stamp) => new Date(`${stamp}:00`);

export function scheduleItemView(s, now = new Date()) {
  const start = stampToDate(s.starts_at);
  const { d, m } = parts(s.starts_at);
  return {
    ...s,
    kind_label: SCHEDULE_KINDS[s.kind] || SCHEDULE_KINDS.OTHER,
    date: s.starts_at.slice(0, 10),
    time: s.starts_at.slice(11, 16),
    date_label: fmtDate(s.starts_at.slice(0, 10), { year: false }),
    date_short: `${d} ${MONTHS_SHORT[m - 1]}`,
    starts_at_ms: start.getTime(),
    is_past: start <= now,
  };
}

export function listSchedule(competitionId, now = new Date()) {
  return all('SELECT * FROM schedule_items WHERE competition_id = ? ORDER BY starts_at, id', competitionId).map((s) => scheduleItemView(s, now));
}

export const getScheduleItem = (id) => get('SELECT * FROM schedule_items WHERE id = ?', id) || null;

// Текущий пункт (последний начавшийся сегодня) и следующий. Нужны для плашки в чате и карточке.
export function scheduleNow(competitionId, now = new Date()) {
  const items = listSchedule(competitionId, now);
  const next = items.find((s) => !s.is_past) || null;
  const started = items.filter((s) => s.is_past && s.date === localStamp(now).slice(0, 10));
  return { current: started[started.length - 1] || null, next };
}

export function readScheduleInput(src) {
  const value = (k) => String((typeof src.get === 'function' ? src.get(k) : src[k]) ?? '').trim();
  return {
    kind: value('kind') || 'OTHER',
    title: value('title').slice(0, 120),
    description: value('description').slice(0, 1000) || null,
    date: value('date'),
    time: value('time'),
  };
}

export function validateScheduleItem(s) {
  const errors = {};
  if (!SCHEDULE_KINDS[s.kind]) errors.kind = 'Выберите тип пункта';
  if (s.title.length < 2) errors.title = 'Укажите название';
  if (!isISODate(s.date)) errors.date = 'Укажите дату в формате ГГГГ-ММ-ДД';
  if (!TIME_RE.test(s.time)) errors.time = 'Время в формате ЧЧ:ММ';
  return errors;
}

export function addScheduleItem(competitionId, s, userId) {
  const { id } = run(
    'INSERT INTO schedule_items (competition_id, kind, title, description, starts_at) VALUES (?, ?, ?, ?, ?)',
    competitionId, s.kind, s.title, s.description, `${s.date}T${s.time}`,
  );
  audit(userId, 'CREATE', 'schedule_item', id, { title: s.title });
  return id;
}

export function updateScheduleItem(itemId, s, userId) {
  const item = getScheduleItem(itemId);
  if (!item) return { error: 'Пункт расписания не найден' };
  const startsAt = `${s.date}T${s.time}`;
  // Пункт перенесли на будущее время — уведомление уйдёт ещё раз, уже в новое время.
  const resend = startsAt !== item.starts_at && startsAt > localStamp(new Date());
  run(
    'UPDATE schedule_items SET kind = ?, title = ?, description = ?, starts_at = ?, notified_at = CASE WHEN ? THEN NULL ELSE notified_at END WHERE id = ?',
    s.kind, s.title, s.description, startsAt, resend, itemId,
  );
  audit(userId, 'UPDATE', 'schedule_item', itemId, { title: s.title });
  return { ok: true, competitionId: item.competition_id };
}

export function deleteScheduleItem(itemId, userId) {
  const item = getScheduleItem(itemId);
  if (!item) return { error: 'Пункт расписания не найден' };
  run('DELETE FROM schedule_items WHERE id = ?', itemId);
  audit(userId, 'DELETE', 'schedule_item', itemId, { title: item.title });
  return { ok: true, competitionId: item.competition_id };
}

// «Начинается чекпоинт: Демо MVP», «Начинается: Кофе-брейк»
export function announcement(item) {
  const label = SCHEDULE_KINDS[item.kind] || SCHEDULE_KINDS.OTHER;
  if (item.kind === 'OTHER' || item.title.toLowerCase() === label.toLowerCase()) return `Начинается: ${item.title}`;
  return `Начинается ${label.toLowerCase()}: ${item.title}`;
}

// Пользователи, которым приходят пункты расписания: спортсмены с допущенной заявкой.
const approvedUsers = (competitionId) =>
  all(
    `SELECT DISTINCT a.user_id FROM registrations r
       JOIN competition_events e ON e.id = r.event_id
       JOIN athletes a ON a.id = r.athlete_id
      WHERE e.competition_id = ? AND r.status = 'APPROVED' AND a.user_id IS NOT NULL`,
    competitionId,
  ).map((r) => r.user_id);

// Разослать уведомления о пунктах, которые уже начались. Сервер вызывает это раз в 15 секунд.
export function dispatchDueItems(now = new Date()) {
  const due = all(
    `SELECT s.*, c.title AS competition_title
       FROM schedule_items s JOIN competitions c ON c.id = s.competition_id
      WHERE s.notified_at IS NULL AND c.status = 'ONGOING' AND s.starts_at <= ? AND s.starts_at >= ?
      ORDER BY s.starts_at, s.id`,
    localStamp(now),
    localStamp(new Date(now.getTime() - NOTIFY_GRACE_MINUTES * 60_000)),
  );
  for (const item of due) {
    tx(() => {
      const title = announcement(item);
      const body = [item.competition_title, item.description].filter(Boolean).join(' · ');
      for (const userId of approvedUsers(item.competition_id)) {
        notify(userId, title, body, `/competitions/${item.competition_id}#schedule-${item.id}`);
      }
      systemMessage(ensureChat(item.competition_id).id, item.description ? `${title}. ${item.description}` : title);
      run("UPDATE schedule_items SET notified_at = datetime('now') WHERE id = ?", item.id);
    });
  }
  return due.length;
}

// Будущие пункты соревнований, куда пользователь допущен. Приложение ставит по ним напоминания на телефоне.
export function upcomingForUser(userId, now = new Date()) {
  return all(
    `SELECT DISTINCT s.*, c.title AS competition_title, c.status AS competition_status
       FROM schedule_items s
       JOIN competitions c ON c.id = s.competition_id
       JOIN competition_events e ON e.competition_id = c.id
       JOIN registrations r ON r.event_id = e.id AND r.status = 'APPROVED'
       JOIN athletes a ON a.id = r.athlete_id
      WHERE a.user_id = ? AND c.status IN ('PUBLISHED', 'ONGOING') AND s.starts_at > ?
      ORDER BY s.starts_at, s.id`,
    userId, localStamp(now),
  ).map((s) => scheduleItemView(s, now));
}
