import { all, get, run } from '../db/index.js';

export function notify(userId, title, body = null, link = null) {
  if (!userId) return;
  run('INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)', userId, title, body, link);
}

export const listNotifications = (userId, limit = 8) =>
  all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', userId, limit);

export const unreadCount = (userId) =>
  get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId).n;

export function markAllRead(userId) {
  run("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL", userId);
}

// Журнал действий организаторов: кто, что и когда менял.
export function audit(userId, action, entity, entityId = null, details = null) {
  run(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    userId || null,
    action,
    entity,
    entityId,
    details ? JSON.stringify(details) : null,
  );
}

export const recentAudit = (limit = 8) =>
  all(
    `SELECT l.*, u.email FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
      ORDER BY l.created_at DESC, l.id DESC LIMIT ?`,
    limit,
  );
