import type { Role } from "../types";

export type Feature =
  | "CREATE_PLANNER"
  | "EDIT_SUBMITTED"
  | "VIEW_SUBMITTED"
  | "GENERATE_ASSIGNMENTS"
  | "MANAGE_MEMBERS"
  | "SETTINGS";

/**
 * MVP permissions matrix (Nigeria ward setup).
 * - ADMIN = Bishop (supreme access)
 * - BISHOPRIC = counsellors (can create/edit/submit + edit submitted)
 * - CLERK = clerk/assistant clerk (members + printing; settings via approval workflow in Settings page)
 * - SECRETARY = secretary/assistant secretary (printing)
 * - MUSIC = music coordinator (music module only; other access controlled by UI/routes)
 */
const rolePerms: Record<Role, Record<Feature, boolean>> = {
  /** Bishop (Admin) — supreme access */
  ADMIN: {
    CREATE_PLANNER: true,
    EDIT_SUBMITTED: true,
    VIEW_SUBMITTED: true,
    GENERATE_ASSIGNMENTS: true,
    MANAGE_MEMBERS: true,
    SETTINGS: true,
  },

  /** 1st / 2nd Counsellor — create/edit/submit planners + can edit submitted planners */
  BISHOPRIC: {
    CREATE_PLANNER: true,
    EDIT_SUBMITTED: true,
    VIEW_SUBMITTED: true,
    GENERATE_ASSIGNMENTS: true,
    MANAGE_MEMBERS: true,
    SETTINGS: false,
  },

  /** Clerk / Assistant Clerk — printing + members (settings handled via approval workflow) */
  CLERK: {
    CREATE_PLANNER: false,
    EDIT_SUBMITTED: false,
    VIEW_SUBMITTED: true,
    GENERATE_ASSIGNMENTS: true,
    MANAGE_MEMBERS: true,
    SETTINGS: true,
  },

  /** Secretary / Assistant Secretary — printing */
  SECRETARY: {
    CREATE_PLANNER: false,
    EDIT_SUBMITTED: false,
    VIEW_SUBMITTED: true,
    GENERATE_ASSIGNMENTS: true,
    MANAGE_MEMBERS: false,
    SETTINGS: false,
  },

  /** Music Coordinator — works via Music workflow */
  MUSIC: {
    CREATE_PLANNER: false,
    EDIT_SUBMITTED: false,
    VIEW_SUBMITTED: false,
    GENERATE_ASSIGNMENTS: false,
    MANAGE_MEMBERS: false,
    SETTINGS: false,
  },
};

export function can(role: Role, feature: Feature) {
  return !!rolePerms[role]?.[feature];
}
