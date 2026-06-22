import type { Role } from "../types";

export type Feature =
  | "CREATE_PLANNER"
  | "EDIT_SUBMITTED"
  | "VIEW_SUBMITTED"
  | "GENERATE_ASSIGNMENTS"
  | "MANAGE_MEMBERS"
  | "SETTINGS"
  | "agendas.create"
  | "agendas.edit"
  | "agendas.print";

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
    "agendas.create": true,
    "agendas.edit": true,
    "agendas.print": true,
  },

  /** 1st / 2nd Counsellor — create/edit/submit planners + can edit submitted planners */
  BISHOPRIC: {
    CREATE_PLANNER: true,
    EDIT_SUBMITTED: true,
    VIEW_SUBMITTED: true,
    GENERATE_ASSIGNMENTS: true,
    MANAGE_MEMBERS: true,
    SETTINGS: false,
    "agendas.create": true,
    "agendas.edit": true,
    "agendas.print": true,
  },

  /** Clerk / Assistant Clerk — printing + members (settings handled via approval workflow) */
  CLERK: {
    CREATE_PLANNER: false,
    EDIT_SUBMITTED: false,
    VIEW_SUBMITTED: true,
    GENERATE_ASSIGNMENTS: true,
    MANAGE_MEMBERS: true,
    SETTINGS: true,
    "agendas.create": false,
    "agendas.edit": false,
    "agendas.print": true,
  },

  /** Secretary / Assistant Secretary — printing */
  SECRETARY: {
    CREATE_PLANNER: false,
    EDIT_SUBMITTED: false,
    VIEW_SUBMITTED: true,
    GENERATE_ASSIGNMENTS: true,
    MANAGE_MEMBERS: false,
    SETTINGS: false,
    "agendas.create": false,
    "agendas.edit": false,
    "agendas.print": true,
  },

  /** Music Coordinator — works via Music workflow */
  MUSIC: {
    CREATE_PLANNER: false,
    EDIT_SUBMITTED: false,
    VIEW_SUBMITTED: false,
    GENERATE_ASSIGNMENTS: false,
    MANAGE_MEMBERS: false,
    SETTINGS: false,
    "agendas.create": false,
    "agendas.edit": false,
    "agendas.print": false,
  },
};

export function can(role: Role, feature: Feature) {
  return !!rolePerms[role]?.[feature];
}
