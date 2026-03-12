import type { Role, User } from "../types";
import { sha256, timingSafeEqual } from "../utils/crypto";
import { getDB, setDB, time, updateDB, ids } from "../utils/storage";

function norm(s: string) {
  return (s || "").trim().toLowerCase();
}

function ensureUniqueUsernameEmail(user_id: string, patch: Partial<User>) {
  const db = getDB();
  const nextEmail = patch.email !== undefined ? patch.email : db.USERS.find((u) => u.user_id === user_id)?.email;
  const nextUsername =
    patch.username !== undefined ? patch.username : db.USERS.find((u) => u.user_id === user_id)?.username;

  if (nextEmail) {
    const taken = db.USERS.some((u) => u.user_id !== user_id && norm(u.email) === norm(nextEmail));
    if (taken) throw new Error("Email is already in use.");
  }
  if (nextUsername) {
    const taken = db.USERS.some(
      (u) => u.user_id !== user_id && u.username && norm(u.username) === norm(nextUsername)
    );
    if (taken) throw new Error("Username is already in use.");
  }
}

export function getUserById(user_id: string): User | null {
  const db = getDB();
  return db.USERS.find((u) => u.user_id === user_id) || null;
}

export async function ensureSeedUserIfEmpty() {
  const db = getDB();
  if (db.USERS.length > 0) return;
  // Seed a default Bishop (Admin) for first-time evaluation.
  // Real deployments would preload USERS sheet.
  const password_hash = await sha256("admin");
  const bishop: User = {
    user_id: ids.uid("user"),
    name: "Bishop (Default)",
    email: "admin@local",
    role: "ADMIN",
    organisation: "Bishopric",
    calling: "Bishop",
    password_hash,
    created_date: time.nowISO(),
    must_reset_password: true,
  };
  setDB({ ...db, USERS: [bishop] });
}

export async function login(identifier: string, password: string): Promise<User | null> {
  const db = getDB();
  const id = identifier.trim().toLowerCase();
  const user = db.USERS.find(
    (u) => u.email.toLowerCase() === id || (u.username ? u.username.toLowerCase() === id : false)
  );
  if (!user) return null;
  if (user.disabled) return null;
  const hash = await sha256(password);
  const ok = timingSafeEqual(hash, user.password_hash);
  if (!ok) return null;

  // Record last login (non-blocking).
  updateDB((db0) => ({
    ...db0,
    USERS: db0.USERS.map((u) => (u.user_id === user.user_id ? { ...u, last_login_date: time.nowISO() } : u)),
  }));

  return getUserById(user.user_id);
}

export async function setUserPassword(user_id: string, newPassword: string) {
  const hash = await sha256(newPassword);
  updateDB((db) => {
    const USERS = db.USERS.map((u) =>
      u.user_id === user_id ? { ...u, password_hash: hash, must_reset_password: false } : u
    );
    return { ...db, USERS };
  });
}

export async function resetUserPasswordToDefault(user_id: string, password = "changeme") {
  const hash = await sha256(password);
  updateDB((db) => {
    const USERS = db.USERS.map((u) =>
      u.user_id === user_id ? { ...u, password_hash: hash, must_reset_password: true } : u
    );
    return { ...db, USERS };
  });
}

function defaultOrgCallingForRole(
  role: Role,
  prev?: { organisation?: User["organisation"]; calling?: User["calling"] }
) {
  // Preserve calling when it is still valid for the chosen role.
  const prevCalling = prev?.calling;
  const prevOrg = prev?.organisation;

  if (role === "ADMIN") {
    return { organisation: "Bishopric" as const, calling: "Bishop" };
  }

  if (role === "BISHOPRIC") {
    const allowed = new Set(["1st Counsellor", "2nd Counsellor", "Bishop"]);
    const calling =
      prevCalling && allowed.has(prevCalling) && prevCalling !== "Bishop"
        ? prevCalling
        : "1st Counsellor";
    return { organisation: "Bishopric" as const, calling };
  }

  if (role === "CLERK") {
    const allowed = new Set(["Clerk (Co-admin)", "Assistant Clerk"]);
    const calling = prevCalling && allowed.has(prevCalling) ? prevCalling : "Clerk (Co-admin)";
    return { organisation: "Clerk" as const, calling };
  }

  if (role === "SECRETARY") {
    const allowed = new Set(["Secretary", "Assistant Secretary"]);
    const calling = prevCalling && allowed.has(prevCalling) ? prevCalling : "Secretary";
    return { organisation: "Secretary" as const, calling };
  }

  if (role === "MUSIC") {
    return { organisation: "Music" as const, calling: prevCalling || "Music Coordinator" };
  }

  return { organisation: prevOrg, calling: prevCalling };
}

export function setUserRole(user_id: string, role: Role) {
  updateDB((db) => {
    const USERS = db.USERS.map((u) => {
      if (u.user_id !== user_id) return u;
      const { organisation, calling } = defaultOrgCallingForRole(role, u);
      return { ...u, role, organisation, calling };
    });
    return { ...db, USERS };
  });
}

/**
 * Update a user's calling/title.
 * PART 1: focuses on Bishopric callings (1st/2nd Counsellor).
 */
export function setUserCalling(user_id: string, calling: string) {
  updateDB((db) => {
    const USERS = db.USERS.map((u) => {
      if (u.user_id !== user_id) return u;

      // Enforce Bishop = ADMIN.
      if (u.role === "ADMIN") {
        return { ...u, organisation: "Bishopric" as const, calling: "Bishop" };
      }

      if (u.role === "BISHOPRIC") {
        const allowed = new Set(["1st Counsellor", "2nd Counsellor"]);
        const nextCalling = allowed.has(calling) ? calling : "1st Counsellor";
        return { ...u, organisation: "Bishopric" as const, calling: nextCalling };
      }

      if (u.role === "CLERK") {
        const allowed = new Set(["Clerk (Co-admin)", "Assistant Clerk"]);
        const nextCalling = allowed.has(calling) ? calling : "Clerk (Co-admin)";
        return { ...u, organisation: "Clerk" as const, calling: nextCalling };
      }

      if (u.role === "SECRETARY") {
        const allowed = new Set(["Secretary", "Assistant Secretary"]);
        const nextCalling = allowed.has(calling) ? calling : "Secretary";
        return { ...u, organisation: "Secretary" as const, calling: nextCalling };
      }

      if (u.role === "MUSIC") {
        const allowed = new Set(["Music Coordinator"]);
        const nextCalling = allowed.has(calling) ? calling : "Music Coordinator";
        return { ...u, organisation: "Music" as const, calling: nextCalling };
      }

      // Other orgs/callings will be handled in later parts.
      return { ...u, calling };
    });
    return { ...db, USERS };
  });
}

export function updateUserProfile(user_id: string, patch: Partial<User>) {
  // Prevent accidental role/calling changes through profile edit.
  const safePatch: Partial<User> = { ...patch };
  delete (safePatch as any).role;
  delete (safePatch as any).organisation;
  delete (safePatch as any).calling;
  delete (safePatch as any).password_hash;
  delete (safePatch as any).created_date;

  ensureUniqueUsernameEmail(user_id, safePatch);

  updateDB((db) => {
    const USERS = db.USERS.map((u) => (u.user_id === user_id ? { ...u, ...safePatch } : u));
    return { ...db, USERS };
  });
}

export function addUser(name: string, email: string, role: Role, password_hash: string, calling?: string) {
  updateDB((db) => {
    const { organisation, calling: calling0 } = defaultOrgCallingForRole(role, calling ? { calling } : undefined);
    const user: User = {
      user_id: ids.uid("user"),
      name,
      email,
      role,
      organisation,
      calling: calling0,
      password_hash,
      created_date: time.nowISO(),
      must_reset_password: true,
    };
    return { ...db, USERS: [user, ...db.USERS] };
  });
}

export function setUserDisabled(user_id: string, disabled: boolean) {
  updateDB((db) => {
    const USERS = db.USERS.map((u) => (u.user_id === user_id ? { ...u, disabled } : u));
    return { ...db, USERS };
  });
}

export function deleteUser(user_id: string) {
  updateDB((db) => {
    const USERS = db.USERS.filter((u) => u.user_id !== user_id);
    return { ...db, USERS };
  });
}
