import type { Notification, NotificationType, User } from "../types";
import { getDB, ids, time, updateDB } from "./storage";

export function listNotificationsForUser(user_id: string) {
  const db = getDB();
  return [...db.NOTIFICATIONS]
    .filter((n) => n.to_user_id === user_id)
    .sort((a, b) => b.created_date.localeCompare(a.created_date));
}

export function unreadCount(user_id: string) {
  const db = getDB();
  return db.NOTIFICATIONS.filter((n) => n.to_user_id === user_id && !n.read).length;
}

export function markRead(notification_id: string) {
  updateDB((db0) => {
    const NOTIFICATIONS = db0.NOTIFICATIONS.map((n) =>
      n.notification_id === notification_id ? { ...n, read: true } : n
    );
    return { ...db0, NOTIFICATIONS };
  });
}

export function markAllRead(user_id: string) {
  updateDB((db0) => {
    const NOTIFICATIONS = db0.NOTIFICATIONS.map((n) =>
      n.to_user_id === user_id ? { ...n, read: true } : n
    );
    return { ...db0, NOTIFICATIONS };
  });
}

export function notifyUser(params: {
  to_user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  meta?: Record<string, string>;
}) {
  const db = getDB();
  // Avoid creating duplicate notifications for the same user/type/meta
  const metaA = JSON.stringify(params.meta || {});
  const existing = db.NOTIFICATIONS.find(
    (n) => n.to_user_id === params.to_user_id && n.type === params.type && JSON.stringify(n.meta || {}) === metaA
  );
  if (existing) return existing;

  const row: Notification = {
    notification_id: ids.uid("notif"),
    to_user_id: params.to_user_id,
    type: params.type,
    created_date: time.nowISO(),
    read: false,
    title: params.title,
    body: params.body,
    meta: params.meta,
  };
  updateDB((db0) => ({ ...db0, NOTIFICATIONS: [row, ...db0.NOTIFICATIONS] }));
  return row;
}

export function notifyRoles(params: {
  toRoles: User["role"][];
  type: NotificationType;
  title: string;
  body: string;
  meta?: Record<string, string>;
}) {
  const db = getDB();
  const users = db.USERS.filter((u) => params.toRoles.includes(u.role));
  const metaA = JSON.stringify(params.meta || {});
  const created: Notification[] = users
    .map((u) => {
      const exists = db.NOTIFICATIONS.find(
        (n) => n.to_user_id === u.user_id && n.type === params.type && JSON.stringify(n.meta || {}) === metaA
      );
      if (exists) return null;
      return {
        notification_id: ids.uid("notif"),
        to_user_id: u.user_id,
        type: params.type,
        created_date: time.nowISO(),
        read: false,
        title: params.title,
        body: params.body,
        meta: params.meta,
      } as Notification;
    })
    .filter((x): x is Notification => x !== null);

  if (created.length === 0) return [];
  updateDB((db0) => ({ ...db0, NOTIFICATIONS: [...created, ...db0.NOTIFICATIONS] }));
  return created;
}
