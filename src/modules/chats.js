// Чат участников соревнования. Членство следует за заявками: организатор допустил заявку —
// спортсмен в чате, отклонил или спортсмен отозвал заявку — спортсмен выходит из чата.
// Организаторы видят все чаты и пишут в них как «Организатор».
import { all, get, run, tx } from '../db/index.js';
import { isOrganizer } from '../core/auth.js';
import { notify } from './notifications.js';
import { publish } from '../core/events.js';

export const MESSAGE_MAX = 2000;

export const chatOf = (competitionId) => get('SELECT * FROM chats WHERE competition_id = ?', competitionId) || null;

export function ensureChat(competitionId) {
  run('INSERT OR IGNORE INTO chats (competition_id) VALUES (?)', competitionId);
  return chatOf(competitionId);
}

// Имя в чате. Спортсмен со скрытым профилем подписан как «Имя Ф.»: участники общаются,
// но полное имя видно только там, где спортсмен сам разрешил.
export function memberName(a) {
  if (!a || !a.first_name) return 'Участник';
  return a.is_public ? `${a.first_name} ${a.last_name}` : `${a.first_name} ${a.last_name.charAt(0)}.`;
}

export function systemMessage(chatId, body, createdAt = null) {
  if (createdAt) return run('INSERT INTO chat_messages (chat_id, user_id, body, created_at) VALUES (?, NULL, ?, ?)', chatId, body, createdAt).id;
  const id = run('INSERT INTO chat_messages (chat_id, user_id, body) VALUES (?, NULL, ?)', chatId, body).id;
  publishMessage(chatId, id);
  return id;
}

// Новое сообщение сразу уходит подписанным приложениям участников чата.
function publishMessage(chatId, messageId) {
  const chat = get('SELECT competition_id FROM chats WHERE id = ?', chatId);
  if (chat) publish('chat', { chatId, competitionId: chat.competition_id, messageId });
}

export const isMember = (chatId, userId) => Boolean(get('SELECT 1 AS x FROM chat_members WHERE chat_id = ? AND user_id = ?', chatId, userId));

// Привести членство спортсмена в чате к его заявкам на соревнование.
// notifyUser: false — без уведомления (спортсмен сам присоединился к идущему контесту).
// quiet — без уведомления и без сообщения в чате (перенос уже допущенных участников).
export function syncMembership(competitionId, athleteId, { notifyUser = true, quiet = false } = {}) {
  const a = get('SELECT id, user_id, first_name, last_name, is_public FROM athletes WHERE id = ?', athleteId);
  if (!a?.user_id) return null;
  const approved = get(
    `SELECT COUNT(*) AS n FROM registrations r JOIN competition_events e ON e.id = r.event_id
      WHERE e.competition_id = ? AND r.athlete_id = ? AND r.status = 'APPROVED'`,
    competitionId, athleteId,
  ).n > 0;
  const chat = approved ? ensureChat(competitionId) : chatOf(competitionId);
  if (!chat) return null;
  const member = isMember(chat.id, a.user_id);

  if (approved && !member) {
    run('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', chat.id, a.user_id);
    if (!quiet) publish('membership', { userId: a.user_id, competitionId });
    if (!quiet) {
      systemMessage(chat.id, `Новый участник: ${memberName(a)}`);
      if (notifyUser) {
        const c = get('SELECT title FROM competitions WHERE id = ?', competitionId);
        notify(
          a.user_id,
          `Заявка одобрена: ${c.title}`,
          'Организатор допустил вас к участию и добавил в чат участников. Когда соревнование начнётся, сюда будут приходить чекпоинты, перерывы и другие пункты расписания.',
          `/competitions/${competitionId}/chat`,
        );
      }
    }
    return 'joined';
  }
  if (!approved && member) {
    run('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?', chat.id, a.user_id);
    publish('membership', { userId: a.user_id, competitionId });
    return 'left';
  }
  return null;
}

// Участники, которых допустили до появления чатов, попадают в чаты идущих и предстоящих соревнований.
export function backfillChats() {
  const rows = all(
    `SELECT DISTINCT e.competition_id, r.athlete_id
       FROM registrations r
       JOIN competition_events e ON e.id = r.event_id
       JOIN competitions c ON c.id = e.competition_id
       JOIN athletes a ON a.id = r.athlete_id
      WHERE r.status = 'APPROVED' AND a.user_id IS NOT NULL AND c.status IN ('PUBLISHED', 'ONGOING')`,
  );
  tx(() => {
    for (const r of rows) syncMembership(r.competition_id, r.athlete_id, { quiet: true });
  });
}

// Открыть чат соревнования. Спортсмену — только если он допущен, организатору — всегда.
export function openChat(user, competitionId) {
  if (!user) return null;
  const competition = get('SELECT id, title, status, start_date, end_date FROM competitions WHERE id = ?', competitionId);
  if (!competition) return null;
  if (isOrganizer(user)) {
    const chat = ensureChat(competitionId);
    run('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)', chat.id, user.id);
    return { chat, competition };
  }
  const chat = chatOf(competitionId);
  if (!chat || !isMember(chat.id, user.id)) return null;
  return { chat, competition };
}

export const canUseChat = (user, competitionId) => {
  if (!user) return false;
  if (isOrganizer(user)) return true;
  const chat = chatOf(competitionId);
  return Boolean(chat && isMember(chat.id, user.id));
};

const MESSAGE_SQL = `
  SELECT m.id, m.chat_id, m.user_id, m.body, m.created_at, u.role, a.first_name, a.last_name, a.is_public
    FROM chat_messages m
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN athletes a ON a.user_id = m.user_id`;

function withAuthor(m) {
  let author;
  if (!m.user_id) author = { kind: 'system', name: 'Платформа ФСП' };
  else if (m.role === 'ORGANIZER' || m.role === 'ADMIN') author = { kind: 'organizer', name: 'Организатор' };
  else author = { kind: 'athlete', name: memberName(m) };
  return { id: m.id, chat_id: m.chat_id, user_id: m.user_id, body: m.body, created_at: m.created_at, author };
}

// Новые сообщения после after или последние limit сообщений (до before) в хронологическом порядке.
export function listMessages(chatId, { after = 0, before = 0, limit = 60 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 60, 1), 200);
  if (after) return all(`${MESSAGE_SQL} WHERE m.chat_id = ? AND m.id > ? ORDER BY m.id LIMIT ?`, chatId, after, n).map(withAuthor);
  const rows = before
    ? all(`${MESSAGE_SQL} WHERE m.chat_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`, chatId, before, n)
    : all(`${MESSAGE_SQL} WHERE m.chat_id = ? ORDER BY m.id DESC LIMIT ?`, chatId, n);
  return rows.reverse().map(withAuthor);
}

export function postMessage(user, competitionId, rawBody) {
  const opened = openChat(user, competitionId);
  if (!opened) return { error: 'Чат доступен участникам, чью заявку одобрил организатор' };
  const body = String(rawBody ?? '').replace(/\r\n/g, '\n').trim();
  if (!body) return { error: 'Напишите сообщение' };
  if (body.length > MESSAGE_MAX) return { error: `Сообщение длиннее ${MESSAGE_MAX} символов` };
  const { chat, competition } = opened;
  const id = run('INSERT INTO chat_messages (chat_id, user_id, body) VALUES (?, ?, ?)', chat.id, user.id, body).id;
  markRead(chat.id, user.id, id);
  publishMessage(chat.id, id);
  // Сообщение организатора — объявление: участники получают уведомление.
  if (isOrganizer(user)) {
    const members = all(
      `SELECT m.user_id FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.chat_id = ? AND u.role = 'ATHLETE'`,
      chat.id,
    );
    const preview = body.length > 140 ? `${body.slice(0, 140)}…` : body;
    for (const m of members) notify(m.user_id, `Организатор в чате: ${competition.title}`, preview, `/competitions/${competitionId}/chat`);
  }
  return { ok: true, id, message: withAuthor(get(`${MESSAGE_SQL} WHERE m.id = ?`, id)) };
}

export function markRead(chatId, userId, lastId) {
  run('UPDATE chat_members SET last_read_id = MAX(last_read_id, ?) WHERE chat_id = ? AND user_id = ?', Number(lastId) || 0, chatId, userId);
}

export const athleteMembersCount = (chatId) =>
  get(`SELECT COUNT(*) AS n FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.chat_id = ? AND u.role = 'ATHLETE'`, chatId).n;

export function chatMembers(chatId) {
  return all(
    `SELECT a.id AS athlete_id, a.first_name, a.last_name, a.is_public, o.name AS organization
       FROM chat_members m JOIN users u ON u.id = m.user_id
       JOIN athletes a ON a.user_id = m.user_id
       LEFT JOIN organizations o ON o.id = a.organization_id
      WHERE m.chat_id = ? AND u.role = 'ATHLETE'
      ORDER BY a.last_name, a.first_name`,
    chatId,
  ).map((a) => ({ athleteId: a.is_public ? a.athlete_id : null, name: memberName(a), organization: a.organization }));
}

const unreadSql = (me) => `(SELECT COUNT(*) FROM chat_messages x WHERE x.chat_id = ch.id AND x.id > COALESCE(m.last_read_id, 0)
    AND (x.user_id IS NULL OR x.user_id <> ${Number(me)}))`;

// Чаты пользователя: спортсмену — где он участник, организатору — все. Сначала с последней активностью.
export function userChats(user) {
  if (!user) return [];
  const organizer = isOrganizer(user);
  const rows = all(
    `SELECT ch.id, ch.competition_id, c.title, c.status, c.start_date, c.end_date,
            (SELECT MAX(id) FROM chat_messages WHERE chat_id = ch.id) AS last_id,
            ${unreadSql(user.id)} AS unread
       FROM chats ch JOIN competitions c ON c.id = ch.competition_id
       ${organizer ? 'LEFT JOIN' : 'JOIN'} chat_members m ON m.chat_id = ch.id AND m.user_id = ?
      ORDER BY COALESCE(last_id, 0) DESC, c.start_date DESC`,
    user.id,
  );
  return rows.map((r) => ({
    ...r,
    members: athleteMembersCount(r.id),
    last: r.last_id ? withAuthor(get(`${MESSAGE_SQL} WHERE m.id = ?`, r.last_id)) : null,
  }));
}

export function unreadChats(user) {
  if (!user) return 0;
  return userChats(user).reduce((sum, c) => sum + (c.unread > 0 ? 1 : 0), 0);
}

export const messageById = (id) => {
  const m = get(`${MESSAGE_SQL} WHERE m.id = ?`, id);
  return m ? withAuthor(m) : null;
};
