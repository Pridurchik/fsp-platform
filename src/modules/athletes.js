// Спортсмены: профиль, дисциплины, разряды и их подтверждение.
import { all, get, run, tx } from '../db/index.js';
import { isISODate, todayISO } from '../core/dates.js';
import { audit, notify } from './notifications.js';
import { hashPassword } from '../core/auth.js';

const ATHLETE_SQL = `
  SELECT a.*, m.name AS municipality, o.name AS organization, u.email
    FROM athletes a
    LEFT JOIN municipalities m ON m.id = a.municipality_id
    LEFT JOIN organizations o ON o.id = a.organization_id
    LEFT JOIN users u ON u.id = a.user_id`;

export const getAthlete = (id) => get(`${ATHLETE_SQL} WHERE a.id = ?`, id);
export const athleteByUser = (userId) => get(`${ATHLETE_SQL} WHERE a.user_id = ?`, userId);

export function athleteDisciplines(athleteId) {
  return all(
    `SELECT d.* FROM athlete_disciplines ad JOIN disciplines d ON d.id = ad.discipline_id
      WHERE ad.athlete_id = ? ORDER BY d.sort_order`,
    athleteId,
  );
}

export function listAthletes({ q = '', municipalityId = null } = {}) {
  const where = [];
  const params = [];
  if (q) {
    where.push("(a.last_name || ' ' || a.first_name || ' ' || COALESCE(a.middle_name, '')) LIKE ?");
    params.push(`%${q.trim()}%`);
  }
  if (municipalityId) {
    where.push('a.municipality_id = ?');
    params.push(municipalityId);
  }
  return all(
    `${ATHLETE_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.last_name, a.first_name`,
    ...params,
  );
}

export function readProfileForm(form) {
  const value = (k) => String(form.get(k) ?? '').trim();
  return {
    last_name: value('last_name'),
    first_name: value('first_name'),
    middle_name: value('middle_name') || null,
    birth_date: value('birth_date') || null,
    municipality_id: Number(value('municipality_id')) || null,
    organization_id: Number(value('organization_id')) || null,
    is_public: form.get('is_public') === '1' ? 1 : 0,
    disciplineIds: form.getAll('discipline_ids').map(Number).filter(Boolean),
  };
}

export function validateProfile(p, { requirePlaces = true } = {}) {
  const errors = {};
  if (p.last_name.length < 2) errors.last_name = 'Укажите фамилию';
  if (p.first_name.length < 2) errors.first_name = 'Укажите имя';
  if (p.birth_date && (!isISODate(p.birth_date) || p.birth_date > todayISO())) errors.birth_date = 'Проверьте дату рождения';
  if (requirePlaces && !p.municipality_id) errors.municipality_id = 'Выберите населённый пункт';
  if (requirePlaces && !p.organization_id) errors.organization_id = 'Выберите образовательную организацию';
  return errors;
}

export function setAthleteDisciplines(athleteId, disciplineIds) {
  run('DELETE FROM athlete_disciplines WHERE athlete_id = ?', athleteId);
  for (const id of new Set(disciplineIds)) {
    run('INSERT INTO athlete_disciplines (athlete_id, discipline_id) VALUES (?, ?)', athleteId, id);
  }
}

export function updateAthleteProfile(athleteId, p) {
  tx(() => {
    run(
      `UPDATE athletes SET last_name = ?, first_name = ?, middle_name = ?, birth_date = ?, municipality_id = ?,
              organization_id = ?, is_public = ? WHERE id = ?`,
      p.last_name, p.first_name, p.middle_name, p.birth_date, p.municipality_id, p.organization_id, p.is_public, athleteId,
    );
    setAthleteDisciplines(athleteId, p.disciplineIds);
  });
}

export function createAthlete(p, userId = null, actorId = null) {
  return tx(() => {
    const { id } = run(
      `INSERT INTO athletes (user_id, last_name, first_name, middle_name, birth_date, municipality_id, organization_id, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      userId, p.last_name, p.first_name, p.middle_name, p.birth_date, p.municipality_id, p.organization_id, p.is_public ?? 1,
    );
    setAthleteDisciplines(id, p.disciplineIds || []);
    if (actorId) audit(actorId, 'CREATE', 'athlete', id);
    return id;
  });
}

// ---------- разряды ----------

export const RANK_STATUS_LABELS = { PENDING: 'На проверке', CONFIRMED: 'Подтверждён', REJECTED: 'Отклонён' };

export function rankHistory(athleteId) {
  return all(
    `SELECT ar.*, rk.name AS rank_name, rk.short_name AS rank_short, rk.kind, rk.bonus_points
       FROM athlete_ranks ar JOIN ranks rk ON rk.id = ar.rank_id
      WHERE ar.athlete_id = ? ORDER BY ar.assigned_at DESC, ar.id DESC`,
    athleteId,
  );
}

export function readRankForm(form) {
  const value = (k) => String(form.get(k) ?? '').trim();
  return {
    rank_id: Number(value('rank_id')) || null,
    assigned_at: value('assigned_at'),
    valid_until: value('valid_until') || null,
    order_number: value('order_number') || null,
  };
}

export function validateRank(r) {
  const errors = {};
  const rank = r.rank_id ? get('SELECT * FROM ranks WHERE id = ?', r.rank_id) : null;
  if (!rank) errors.rank_id = 'Выберите разряд или звание';
  if (!isISODate(r.assigned_at) || r.assigned_at > todayISO()) errors.assigned_at = 'Укажите дату присвоения';
  if (r.valid_until && (!isISODate(r.valid_until) || r.valid_until < r.assigned_at)) errors.valid_until = 'Срок действия не может закончиться раньше присвоения';
  if (rank && rank.kind !== 'TITLE' && !r.valid_until) errors.valid_until = 'У разряда есть срок действия, укажите его';
  if (!r.order_number) errors.order_number = 'Укажите номер приказа';
  return errors;
}

export function submitRankRequest(athleteId, r) {
  run(
    "INSERT INTO athlete_ranks (athlete_id, rank_id, assigned_at, valid_until, order_number, status) VALUES (?, ?, ?, ?, ?, 'PENDING')",
    athleteId, r.rank_id, r.assigned_at, r.valid_until, r.order_number,
  );
}

export function assignRank(athleteId, r, actorId) {
  const { id } = run(
    `INSERT INTO athlete_ranks (athlete_id, rank_id, assigned_at, valid_until, order_number, status, reviewed_at)
     VALUES (?, ?, ?, ?, ?, 'CONFIRMED', datetime('now'))`,
    athleteId, r.rank_id, r.assigned_at, r.valid_until, r.order_number,
  );
  audit(actorId, 'ASSIGN_RANK', 'athlete', athleteId, { athleteRankId: id });
  return id;
}

export function reviewRank(athleteRankId, status, actorId) {
  if (!['CONFIRMED', 'REJECTED'].includes(status)) return { error: 'Неизвестное решение' };
  const row = get(
    `SELECT ar.*, a.user_id, rk.name AS rank_name FROM athlete_ranks ar
       JOIN athletes a ON a.id = ar.athlete_id JOIN ranks rk ON rk.id = ar.rank_id WHERE ar.id = ?`,
    athleteRankId,
  );
  if (!row) return { error: 'Заявка на разряд не найдена' };
  run("UPDATE athlete_ranks SET status = ?, reviewed_at = datetime('now') WHERE id = ?", status, athleteRankId);
  audit(actorId, `RANK_${status}`, 'athlete_rank', athleteRankId);
  notify(
    row.user_id,
    status === 'CONFIRMED' ? `Разряд подтверждён: ${row.rank_name}` : `Разряд не подтверждён: ${row.rank_name}`,
    status === 'CONFIRMED' ? 'Бонус за квалификацию уже учтён в рейтинге.' : 'Проверьте номер приказа и даты, затем подайте заново.',
    '/cabinet/profile#rank',
  );
  return { ok: true, athleteId: row.athlete_id };
}

export function pendingRanks() {
  return all(
    `SELECT ar.*, rk.name AS rank_name, rk.short_name AS rank_short, a.last_name, a.first_name, a.middle_name
       FROM athlete_ranks ar JOIN ranks rk ON rk.id = ar.rank_id JOIN athletes a ON a.id = ar.athlete_id
      WHERE ar.status = 'PENDING' ORDER BY ar.created_at`,
  );
}

// ---------- регистрация спортсмена (сайт и мобильное приложение) ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function readRegistration(src) {
  const value = (k) => String((typeof src.get === 'function' ? src.get(k) : src[k]) ?? '').trim();
  const consent = typeof src.get === 'function' ? src.get('consent') === '1' : src.consent === true || src.consent === '1';
  return {
    last_name: value('last_name'),
    first_name: value('first_name'),
    middle_name: value('middle_name'),
    email: value('email').toLowerCase(),
    consent,
  };
}

export function validateRegistration(v, password) {
  const errors = {};
  if (v.last_name.length < 2) errors.last_name = 'Укажите фамилию';
  if (v.first_name.length < 2) errors.first_name = 'Укажите имя';
  if (!EMAIL_RE.test(v.email)) errors.email = 'Проверьте адрес почты';
  else if (get('SELECT id FROM users WHERE email = ?', v.email)) errors.email = 'Эта почта уже зарегистрирована. Войдите или укажите другую';
  if (String(password || '').length < 8) errors.password = 'Пароль должен быть не короче 8 символов';
  if (!v.consent) errors.consent = 'Без согласия на обработку данных зарегистрироваться нельзя';
  return errors;
}

export function createAthleteAccount(v, password) {
  return tx(() => {
    const id = run('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)', v.email, hashPassword(password), 'ATHLETE').id;
    createAthlete({ last_name: v.last_name, first_name: v.first_name, middle_name: v.middle_name || null, is_public: 1, disciplineIds: [] }, id);
    return id;
  });
}
