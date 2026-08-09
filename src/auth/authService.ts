import type { Role, User } from "../types";
import { sha256, timingSafeEqual } from "../utils/crypto";
import { backendEnabled } from "../utils/backend";
import { getDB, updateDB, ids, time, syncFromBackend } from "../utils/storage";

function norm(s: string) {
  return (s || "").trim().toLowerCase();
}

function usernameFromUser(name: string, email: string) {
  const fromEmail = norm((email || "").split("@")[0] || "").replace(/[^a-z0-9._-]/g, "");
  if (fromEmail) return fromEmail;
  const fromName = norm(name).replace(/\s+/g, "").replace(/[^a-z0-9._-]/g, "");
  return fromName || ids.uid("user").slice(0, 12);
}

function ensureUniqueUsernameEmail(user_id: string, patch: Partial<User>) {
  const db = getDB();
  const currentUser = db.USERS.find((u) => u.user_id === user_id);
  const nextEmail = patch.email !== undefined ? patch.email : currentUser?.email;
  const nextUsername = patch.username !== undefined ? patch.username : currentUser?.username;

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
  return db.USERS.find((u) => u.user_id === user_id || u.auth_uid === user_id) || null;
}

export function getUserByEmail(email: string): User | null {
  const db = getDB();
  return db.USERS.find((u) => norm(u.email) === norm(email)) || null;
}

export function getUserByUsername(username: string): User | null {
  const db = getDB();
  return db.USERS.find((u) => u.username && norm(u.username) === norm(username)) || null;
}

export function getUsersByRole(role: Role): User[] {
  const db = getDB();
  return db.USERS.filter((u) => u.role === role && !u.disabled);
}

export async function login(identifier: string, password: string): Promise<User> {
  const id = identifier.trim().toLowerCase();
  let dbData = getDB();

  // Find user locally by email, username, or name
  let user = dbData.USERS.find(
    (u) =>
      norm(u.email || "") === id ||
      norm(u.username || "") === id ||
      norm(u.name || "") === id
  );

  const backendOn = backendEnabled();

  if (!user && backendOn) {
    // Sync latest users database from Google Sheets
    await syncFromBackend({ force: true, replaceLocal: false });
    const updatedDb = getDB();
    user = updatedDb.USERS.find(
      (u) =>
        norm(u.email || "") === id ||
        norm(u.username || "") === id ||
        norm(u.name || "") === id
    );
  }

  if (!user) {
    throw new Error("User account not found. Please check your credentials or contact your Clerk.");
  }

  if (user.disabled) {
    throw new Error("This account has been disabled. Please contact your Clerk for assistance.");
  }

  const hash = await sha256(password);
  const storedHash = (user.password_hash || "").trim().toLowerCase();
  const ok = timingSafeEqual(hash.trim().toLowerCase(), storedHash);
  if (!ok) {
    throw new Error("Incorrect password. Please try again.");
  }

  // Record last login (non-blocking)
  const now = time.nowISO();
  setTimeout(() => {
    try {
      updateDB((db0) => ({
        ...db0,
        USERS: db0.USERS.map((u) =>
          u.user_id === user!.user_id ? { ...u, last_login_date: now } : u
        ),
      }));
    } catch (err) {
      console.warn("[Auth] Deferred last_login_date update failed:", err);
    }
  }, 100);

  const fresh = getUserById(user.user_id);
  if (!fresh) {
    throw new Error("Login succeeded but failed to load user profile. Please refresh.");
  }
  return fresh;
}

export async function setUserPassword(user_id: string, newPassword: string) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const hash = await sha256(newPassword);

  updateDB((db0) => {
    const USERS = db0.USERS.map((u) =>
      u.user_id === user_id
        ? {
            ...u,
            password_hash: hash,
            must_reset_password: false,
          }
        : u
    );
    return { ...db0, USERS };
  });
}

export async function resetUserPasswordToDefault(user_id: string, password = "welcome") {
  const hash = await sha256(password);
  updateDB((db0) => {
    const USERS = db0.USERS.map((u) =>
      u.user_id === user_id
        ? { ...u, password_hash: hash, must_reset_password: false }
        : u
    );
    return { ...db0, USERS };
  });
}

function defaultOrgCallingForRole(
  role: Role,
  prev?: { organisation?: User["organisation"]; calling?: User["calling"] }
) {
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
  updateDB((db0) => {
    const USERS = db0.USERS.map((u) => {
      if (u.user_id !== user_id) return u;
      const { organisation, calling } = defaultOrgCallingForRole(role, u);
      return { ...u, role, organisation, calling };
    });
    return { ...db0, USERS };
  });
}

export function setUserCalling(user_id: string, calling: string) {
  updateDB((db0) => {
    const USERS = db0.USERS.map((u) => {
      if (u.user_id !== user_id) return u;

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

      return { ...u, calling };
    });
    return { ...db0, USERS };
  });
}

export async function updateUserProfile(user_id: string, patch: Partial<User>) {
  const safePatch: Partial<User> = { ...patch };
  delete (safePatch as any).role;
  delete (safePatch as any).organisation;
  delete (safePatch as any).calling;
  delete (safePatch as any).password_hash;
  delete (safePatch as any).created_date;

  ensureUniqueUsernameEmail(user_id, safePatch);

  updateDB((db0) => {
    const USERS = db0.USERS.map((u) => (u.user_id === user_id ? { ...u, ...safePatch } : u));
    return { ...db0, USERS };
  });
}

export async function addUser(
  name: string,
  email: string,
  role: Role,
  password_hash: string,
  calling?: string,
  gender?: "M" | "F"
) {
  const { organisation, calling: calling0 } = defaultOrgCallingForRole(role, calling ? { calling } : undefined);
  const username = usernameFromUser(name, email);

  updateDB((db0) => {
    const user: User = {
      user_id: ids.uid("user"),
      name,
      username,
      email,
      role,
      organisation,
      calling: calling0,
      gender,
      password_hash,
      created_date: time.nowISO(),
      must_reset_password: false,
    };
    return { ...db0, USERS: [user, ...db0.USERS] };
  });
}

export async function setUserDisabled(user_id: string, disabled: boolean) {
  updateDB((db0) => {
    const USERS = db0.USERS.map((u) => (u.user_id === user_id ? { ...u, disabled } : u));
    return { ...db0, USERS };
  });
}

export async function deleteUser(user_id: string) {
  updateDB((db0) => {
    const USERS = db0.USERS.filter((u) => u.user_id !== user_id);
    return { ...db0, USERS };
  });
}
