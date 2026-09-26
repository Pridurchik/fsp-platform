// Модуль проведения соревнований (кейс №2): контест прямо на платформе.
// Контест — обычное соревнование первого этапа с настройками проведения, заданиями и решениями.
// Итоговая таблица переносится в результаты дисциплины, а дальше работает прежний конвейер:
// публикация итогов → профиль спортсмена → рейтинг.
import { all, get, run, tx } from '../db/index.js';
import { getCompetition, eventsOf, applyTransition } from './competitions.js';
import { isProfileComplete } from './registrations.js';
import { audit, notify } from './notifications.js';
import { syncMembership } from './chats.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ACTIVE_REG = "('SUBMITTED', 'APPROVED')";

export const getContest = (competitionId) => get('SELECT * FROM contests WHERE competition_id = ?', competitionId) || null;
export const isPlatformContest = (k) => Boolean(k && k.on_platform);

// ---------- настройки проведения (часть формы соревнования) ----------

export function readContestForm(form) {
  const value = (k) => String(form.get(k) ?? '').trim();
  return {
    on_platform: form.get('on_platform') === '1' ? 1 : 0,
    start_time: value('start_time') || '10:00',
    end_time: value('end_time') || '14:00',
    rules: value('rules').slice(0, 10000),
    auto_status: form.get('auto_status') === '1' ? 1 : 0,
    external_platform: value('external_platform') || null,
    external_url: value('external_url') || null,
  };
}

export function validateContest(k, competition) {
  const errors = {};
  if (k.on_platform) {
    if (!TIME_RE.test(k.start_time)) errors.start_time = 'Время в формате ЧЧ:ММ';
    if (!TIME_RE.test(k.end_time)) errors.end_time = 'Время в формате ЧЧ:ММ';
    else if (TIME_RE.test(k.start_time) && competition.start_date === competition.end_date && k.end_time <= k.start_time) {
      errors.end_time = 'Окончание должно быть позже начала';
    }
    if (competition.disciplineIds.length !== 1) errors.discipline_ids = 'Контест на платформе проводится по одной дисциплине';
  }
  if (k.external_url && !/^https:\/\/\S+$/.test(k.external_url)) errors.external_url = 'Ссылка должна начинаться с https://';
  return errors;
}

export function saveContest(competitionId, k) {
  if (!k.on_platform && !k.external_platform && !k.external_url && !getContest(competitionId)) return;
  run(
    `INSERT INTO contests (competition_id, on_platform, start_time, end_time, rules, auto_status, external_platform, external_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(competition_id) DO UPDATE SET on_platform = excluded.on_platform, start_time = excluded.start_time,
       end_time = excluded.end_time, rules = excluded.rules, auto_status = excluded.auto_status,
       external_platform = excluded.external_platform, external_url = excluded.external_url`,
    competitionId, k.on_platform, k.start_time, k.end_time, k.rules, k.auto_status, k.external_platform, k.external_url,
  );
}

// Начало и конец контеста по времени сервера.
export function contestWindow(c, k) {
  return { start: new Date(`${c.start_date}T${k.start_time}:00`), end: new Date(`${c.end_date}T${k.end_time}:00`) };
}

// Автоматическая смена статуса по времени, если организатор её включил. Вручную статус меняется всегда.
export function syncContestStatus(c, now = new Date()) {
  const k = getContest(c.id);
  if (!isPlatformContest(k) || !k.auto_status) return c;
  const { start, end } = contestWindow(c, k);
  if (c.status === 'PUBLISHED' && now >= start) applyTransition(c.id, 'start', null);
  const current = getCompetition(c.id);
  if (current.status === 'ONGOING' && now >= end) applyTransition(c.id, 'finish', null);
  return getCompetition(c.id);
}

// ---------- задания ----------

export const listTasks = (competitionId) =>
  all('SELECT * FROM contest_tasks WHERE competition_id = ? ORDER BY position, id', competitionId).map((t, i) => ({ ...t, letter: LETTERS[i] || String(i + 1) }));

export function readTaskForm(form) {
  const value = (k) => String(form.get(k) ?? '').trim();
  return {
    title: value('title').slice(0, 200),
    statement: value('statement').slice(0, 20000),
    max_score: Number.parseInt(value('max_score'), 10),
    materials_url: value('materials_url') || null,
  };
}

export function validateTask(t) {
  const errors = {};
  if (t.title.length < 2) errors.title = 'Укажите название';
  if (t.statement.length < 10) errors.statement = 'Опишите условие задания';
  if (!Number.isInteger(t.max_score) || t.max_score < 1 || t.max_score > 10000) errors.max_score = 'Целое число от 1 до 10 000';
  if (t.materials_url && !/^https?:\/\/\S+$/.test(t.materials_url)) errors.materials_url = 'Ссылка должна начинаться с http:// или https://';
  return errors;
}

export function addTask(competitionId, t, userId) {
  const position = get('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM contest_tasks WHERE competition_id = ?', competitionId).n;
  const { id } = run(
    'INSERT INTO contest_tasks (competition_id, position, title, statement, max_score, materials_url) VALUES (?, ?, ?, ?, ?, ?)',
    competitionId, position, t.title, t.statement, t.max_score, t.materials_url,
  );
  audit(userId, 'CREATE', 'contest_task', id, { title: t.title });
  return id;
}

export const getTask = (taskId) =>
  get(
    `SELECT t.*, c.status AS competition_status, c.title AS competition_title FROM contest_tasks t
       JOIN competitions c ON c.id = t.competition_id WHERE t.id = ?`,
    taskId,
  );

export function updateTask(taskId, t, userId) {
  const task = getTask(taskId);
  if (!task) return { error: 'Задание не найдено' };
  const overMax = get('SELECT COUNT(*) AS n FROM submissions WHERE task_id = ? AND score > ?', taskId, t.max_score).n;
  if (overMax) return { error: 'Есть оценки выше нового максимума. Сначала исправьте их', competitionId: task.competition_id };
  run('UPDATE contest_tasks SET title = ?, statement = ?, max_score = ?, materials_url = ? WHERE id = ?', t.title, t.statement, t.max_score, t.materials_url, taskId);
  audit(userId, 'UPDATE', 'contest_task', taskId, { title: t.title });
  return { ok: true, competitionId: task.competition_id };
}

export function deleteTask(taskId, userId) {
  const task = getTask(taskId);
  if (!task) return { error: 'Задание не найдено' };
  if (get('SELECT COUNT(*) AS n FROM submissions WHERE task_id = ?', taskId).n) {
    return { error: 'По заданию уже есть решения, удалить его нельзя', competitionId: task.competition_id };
  }
  run('DELETE FROM contest_tasks WHERE id = ?', taskId);
  audit(userId, 'DELETE', 'contest_task', taskId, { title: task.title });
  return { ok: true, competitionId: task.competition_id };
}

// ---------- участие и решения ----------

// Участник контеста — спортсмен с действующей заявкой в его дисциплину.
export function participation(competitionId, athleteId) {
  return get(
    `SELECT r.* FROM registrations r JOIN competition_events e ON e.id = r.event_id
      WHERE e.competition_id = ? AND r.athlete_id = ? AND r.status IN ${ACTIVE_REG}`,
    competitionId, athleteId,
  ) || null;
}

// Присоединиться к уже идущему контесту: заявка создаётся сразу допущенной.
export function joinContest(athlete, competitionId) {
  const c = getCompetition(competitionId);
  if (!c || !isPlatformContest(getContest(competitionId))) return { error: 'Контест не найден' };
  if (c.status !== 'ONGOING') return { error: 'Присоединиться можно, только пока контест идёт' };
  if (!isProfileComplete(athlete)) return { error: 'profile' };
  const ev = eventsOf(competitionId)[0];
  const existing = get('SELECT * FROM registrations WHERE event_id = ? AND athlete_id = ?', ev.id, athlete.id);
  if (existing?.status === 'REJECTED') return { error: 'Организатор отклонил вашу заявку' };
  if (existing) run("UPDATE registrations SET status = 'APPROVED' WHERE id = ?", existing.id);
  else run("INSERT INTO registrations (event_id, athlete_id, status) VALUES (?, ?, 'APPROVED')", ev.id, athlete.id);
  syncMembership(competitionId, athlete.id, { notifyUser: false });
  return { ok: true };
}

export function submitSolution(athlete, taskId, { text, url }) {
  const task = getTask(taskId);
  if (!task) return { error: 'Задание не найдено' };
  const back = { competitionId: task.competition_id };
  if (task.competition_status !== 'ONGOING') return { ...back, error: 'Решения принимаются, только пока контест идёт' };
  if (!participation(task.competition_id, athlete.id)) return { ...back, error: 'Сначала примите участие в контесте' };
  const answer = String(text || '').trim().slice(0, 20000);
  const link = String(url || '').trim();
  if (!answer && !link) return { ...back, error: 'Напишите ответ или добавьте ссылку на решение' };
  if (link && !/^https?:\/\/\S+$/.test(link)) return { ...back, error: 'Ссылка должна начинаться с http:// или https://' };
  const { id } = run('INSERT INTO submissions (task_id, athlete_id, answer_text, answer_url) VALUES (?, ?, ?, ?)', taskId, athlete.id, answer || null, link || null);
  return { ...back, ok: true, id, letter: listTasks(task.competition_id).find((t) => t.id === taskId)?.letter };
}

const SUBMISSION_SQL = `
  SELECT s.*, t.title AS task_title, t.max_score, t.competition_id, t.position,
         a.last_name, a.first_name, a.middle_name, a.is_public, o.name AS organization
    FROM submissions s
    JOIN contest_tasks t ON t.id = s.task_id
    JOIN athletes a ON a.id = s.athlete_id
    LEFT JOIN organizations o ON o.id = a.organization_id`;

function withLetters(competitionId, rows) {
  const letters = new Map(listTasks(competitionId).map((t) => [t.id, t.letter]));
  return rows.map((s) => ({ ...s, letter: letters.get(s.task_id) }));
}

export function listSubmissions(competitionId, { pending = false, taskId = null } = {}) {
  const params = [competitionId];
  let extra = pending ? 'AND s.score IS NULL' : '';
  if (taskId) {
    extra += ' AND t.id = ?';
    params.push(taskId);
  }
  const rows = all(
    `${SUBMISSION_SQL} WHERE t.competition_id = ? ${extra}
      ORDER BY s.score IS NOT NULL, s.created_at ${pending ? 'ASC' : 'DESC'}, s.id`,
    ...params,
  );
  return withLetters(competitionId, rows);
}

export function submissionCountsByTask(competitionId) {
  return all(
    `SELECT t.id AS task_id, COUNT(s.id) AS total, COALESCE(SUM(s.score IS NULL), 0) AS pending
       FROM contest_tasks t LEFT JOIN submissions s ON s.task_id = t.id
      WHERE t.competition_id = ? GROUP BY t.id`,
    competitionId,
  );
}

// Статистика по заданиям для организатора: попыток, проверено, средний и лучший баллы.
export function taskStats(competitionId) {
  const tasks = listTasks(competitionId);
  const rows = new Map(
    all(
      `SELECT s.task_id, COUNT(*) AS total, SUM(s.score IS NOT NULL) AS checked,
              AVG(s.score) AS avg_score, MAX(s.score) AS best_score
         FROM submissions s JOIN contest_tasks t ON t.id = s.task_id
        WHERE t.competition_id = ? GROUP BY s.task_id`,
      competitionId,
    ).map((r) => [r.task_id, r]),
  );
  return tasks.map((t) => {
    const r = rows.get(t.id) || { total: 0, checked: 0, avg_score: null, best_score: null };
    return {
      id: t.id,
      letter: t.letter,
      title: t.title,
      max_score: t.max_score,
      total: r.total,
      checked: r.checked,
      avg: r.avg_score === null ? null : Math.round(r.avg_score * 10) / 10,
      best: r.best_score,
    };
  });
}

export const athleteSubmissions = (competitionId, athleteId) =>
  withLetters(competitionId, all(`${SUBMISSION_SQL} WHERE t.competition_id = ? AND s.athlete_id = ? ORDER BY s.created_at DESC, s.id DESC`, competitionId, athleteId));

export const submissionCounts = (competitionId) =>
  get(
    `SELECT COUNT(*) AS total, COALESCE(SUM(s.score IS NULL), 0) AS pending FROM submissions s
       JOIN contest_tasks t ON t.id = s.task_id WHERE t.competition_id = ?`,
    competitionId,
  );

export function gradeSubmission(submissionId, rawScore, comment, userId) {
  const s = get(`${SUBMISSION_SQL} WHERE s.id = ?`, submissionId);
  if (!s) return { error: 'Решение не найдено' };
  const c = getCompetition(s.competition_id);
  if (c.status === 'RESULTS_PUBLISHED') return { error: 'Итоги уже опубликованы. Чтобы изменить оценку, сначала нажмите «Исправить итоги»', competitionId: s.competition_id };
  const score = Number.parseInt(String(rawScore ?? '').trim(), 10);
  if (!Number.isInteger(score) || score < 0 || score > s.max_score) return { error: `Оценка — целое число от 0 до ${s.max_score}`, competitionId: s.competition_id };
  run(
    "UPDATE submissions SET score = ?, comment = ?, checked_at = datetime('now'), checked_by = ? WHERE id = ?",
    score, String(comment || '').trim().slice(0, 2000) || null, userId, submissionId,
  );
  syncResults(s.competition_id);
  audit(userId, 'GRADE', 'submission', submissionId, { score });
  const athlete = get('SELECT user_id FROM athletes WHERE id = ?', s.athlete_id);
  const letter = listTasks(s.competition_id).find((t) => t.id === s.task_id)?.letter;
  notify(athlete?.user_id, `Решение проверено: ${letter}. ${s.task_title}`, `${score} из ${s.max_score} баллов. ${c.title}`, `/competitions/${s.competition_id}#tasks`);
  return { ok: true, competitionId: s.competition_id };
}

// ---------- итоговая таблица ----------

// Балл за задание — лучшая оценка среди проверенных попыток, сумма — по всем заданиям.
// Места: больше баллов — выше. При равной сумме выше тот, кто раньше отправил последнее решение,
// которое принесло баллы (раньше набрал свою сумму). Если совпадает и это время, место делится: 1, 2, 2, 4.
export function standings(competitionId) {
  const tasks = listTasks(competitionId);
  const subs = all(
    `SELECT s.* FROM submissions s JOIN contest_tasks t ON t.id = s.task_id WHERE t.competition_id = ? ORDER BY s.created_at, s.id`,
    competitionId,
  );
  const byAthlete = new Map();
  for (const s of subs) {
    if (!byAthlete.has(s.athlete_id)) byAthlete.set(s.athlete_id, new Map());
    const cells = byAthlete.get(s.athlete_id);
    const cell = cells.get(s.task_id) || { best: null, bestAt: null, attempts: 0, pending: 0 };
    cell.attempts += 1;
    if (s.score === null) cell.pending += 1;
    else if (cell.best === null || s.score > cell.best) {
      cell.best = s.score;
      cell.bestAt = s.created_at;
    }
    cells.set(s.task_id, cell);
  }
  if (!byAthlete.size) return { tasks, rows: [] };

  const ids = [...byAthlete.keys()];
  const athletes = new Map(
    all(
      `SELECT a.id, a.last_name, a.first_name, a.middle_name, a.is_public, o.name AS organization, m.name AS municipality
         FROM athletes a LEFT JOIN organizations o ON o.id = a.organization_id LEFT JOIN municipalities m ON m.id = a.municipality_id
        WHERE a.id IN (${ids.map(() => '?').join(',')})`,
      ...ids,
    ).map((a) => [a.id, a]),
  );

  const rows = ids.map((athleteId) => {
    const cells = byAthlete.get(athleteId);
    let total = 0;
    let reachedAt = null;
    let pending = 0;
    for (const cell of cells.values()) {
      pending += cell.pending;
      if (cell.best) {
        total += cell.best;
        if (!reachedAt || cell.bestAt > reachedAt) reachedAt = cell.bestAt;
      }
    }
    return { athleteId, athlete: athletes.get(athleteId), cells, total, reachedAt, pending };
  });
  rows.sort((a, b) => b.total - a.total
    || (a.reachedAt && b.reachedAt ? a.reachedAt.localeCompare(b.reachedAt) : a.reachedAt ? -1 : b.reachedAt ? 1 : 0)
    || a.athlete.last_name.localeCompare(b.athlete.last_name, 'ru'));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.place = prev && prev.total === r.total && prev.reachedAt === r.reachedAt ? prev.place : i + 1;
  });
  return { tasks, rows };
}

// Перенос таблицы в результаты дисциплины. Дальше итоги публикуются так же, как в первом этапе.
export function syncResults(competitionId) {
  const ev = eventsOf(competitionId)[0];
  if (!ev) return 0;
  const { rows } = standings(competitionId);
  tx(() => {
    run('DELETE FROM results WHERE event_id = ?', ev.id);
    for (const r of rows) run('INSERT INTO results (event_id, athlete_id, place, score) VALUES (?, ?, ?, ?)', ev.id, r.athleteId, r.place, r.total);
    run('UPDATE competition_events SET participants_total = NULL WHERE id = ?', ev.id);
  });
  return rows.length;
}

// Контесты спортсмена для кабинета: где участвует, сколько отправлено и проверено.
export function athleteContests(athleteId) {
  const rows = all(
    `SELECT c.id, c.title, c.status, c.start_date, c.end_date, k.start_time, k.end_time
       FROM competitions c
       JOIN contests k ON k.competition_id = c.id
       JOIN competition_events e ON e.competition_id = c.id
       JOIN registrations r ON r.event_id = e.id
      WHERE k.on_platform = 1 AND r.athlete_id = ? AND r.status IN ${ACTIVE_REG}
      ORDER BY c.start_date DESC, c.id DESC`,
    athleteId,
  );
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()].map((c) => {
    const mine = athleteSubmissions(c.id, athleteId);
    return {
      ...c,
      tasks: listTasks(c.id).length,
      submitted: mine.length,
      checked: mine.filter((s) => s.score !== null).length,
    };
  });
}

// Проверки перед публикацией итогов контеста.
export function contestPublishProblems(competitionId) {
  const problems = [];
  if (!listTasks(competitionId).length) problems.push('В контесте нет заданий');
  const { total, pending } = submissionCounts(competitionId);
  if (!total) problems.push('Ни одного решения не отправлено');
  if (pending) problems.push(`Решений ждут проверки: ${pending}`);
  return problems;
}
