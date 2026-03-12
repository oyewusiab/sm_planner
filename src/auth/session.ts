import type { User } from "../types";

const SESSION_KEY = "sac_meeting_planner_session_v1";

export type Session = {
  user_id: string;
  token: string;
  created_date: string;
};

export function getSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function setSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function newSessionForUser(user: User): Session {
  return {
    user_id: user.user_id,
    token: `${user.user_id}.${Math.random().toString(16).slice(2)}.${Date.now()}`,
    created_date: new Date().toISOString(),
  };
}
