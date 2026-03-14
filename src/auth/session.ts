import type { User } from "../types";

const SESSION_KEY = "sac_meeting_planner_session_v1";

export type Session = {
  user_id: string;
  token: string;
  created_date: string;
  last_activity: number; // Timestamp
};

export function getSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    // Check if token still exists in sessionStorage (protection against browser close)
    const token = sessionStorage.getItem(SESSION_KEY + "_token");
    if (!token || token !== s.token) return null;
    return s;
  } catch {
    return null;
  }
}

export function setSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  sessionStorage.setItem(SESSION_KEY + "_token", session.token);
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY + "_token");
}

export function newSessionForUser(user: User): Session {
  return {
    user_id: user.user_id,
    token: `${user.user_id}.${Math.random().toString(16).slice(2)}.${Date.now()}`,
    created_date: new Date().toISOString(),
    last_activity: Date.now(),
  };
}
