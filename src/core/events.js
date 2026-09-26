// Шина событий внутри сервера. Уведомления и сообщения чатов сразу уходят приложениям,
// которые держат открытым поток /api/mobile/events: чат обновляется без задержки опроса.
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publish(type, payload = {}) {
  bus.emit('event', { type, ...payload });
}

export function subscribe(listener) {
  bus.on('event', listener);
  return () => bus.off('event', listener);
}
