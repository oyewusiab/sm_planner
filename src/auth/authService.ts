import type { Role, User } from "../types";
import { sha256, timingSafeEqual } from "../utils/crypto";
import { backendEnabled, pingBackend } from "../utils/backend";
import { getDB, updateDB, ids, time, syncFromBackend } from "../utils/storage";

function norm(s: string) {
  return (s || "").trim().toLowerCase();
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
  return db.USERS.find((u) => u.user_id === user_id) || null;
}

export function getUserByEmail(email: string): User | null {
  const db = getDB();
  return db.USERS.find((u) => norm(u.email) === norm(email)) || null;
}
// ensureSeedUserIfEmpty removed - users are now provided via backend USERS sheet.

export function getUserByUsername(username: string): User | null {
  const db = getDB();
  return db.USERS.find((u) => u.username && norm(u.username) === norm(username)) || null;
}

export function getUsersByRole(role: Role): User[] {
  return getDB().USERS.filter((u) => u.role === role);
}

/**
 * Authenticate user with email/username and password.
 * Users are loaded from the backend USERS sheet.
 */
export async function login(identifier: string, password: string): Promise<User> {
  let db = getDB();
  const backendOn = backendEnabled();

  // If no users in local DB, attempt to sync from backend (blocking)
  if (!db.USERS || db.USERS.length === 0) {
    try {
      await syncFromBackend();
      db = getDB();
    } catch (err) {
      console.error("Failed to sync users from backend:", err);
      throw new Error("Unable to connect to server. Please try again.");
    }

    // If backend is configured but users are still empty, surface a clear setup/config error.
    if (backendOn && (!db.USERS || db.USERS.length === 0)) {
      try {
        await pingBackend();
      } catch {
        throw new Error(
          "Backend misconfigured. Check your deployed backend URL/API key and redeploy."
        );
      }
      throw new Error(
        "No users found in backend. Please verify USERS sheet data."
      );
    }
  } else {
    // Background sync to ensure data is fresh for next time
    void syncFromBackend();
  }

  const id = identifier.trim().toLowerCase();

  // Find user by email or username
  const user = db.USERS.find(
    (u) =>
      (u.email && u.email.toLowerCase() === id) ||
      (u.username && u.username.toLowerCase() === id)
  );

  if (!user) {
    throw new Error("User account not found. Please check your credentials or contact your Clerk.");
  }

  if (user.disabled) {
    throw new Error("This account has been disabled. Please contact your Clerk for assistance.");
  }

  // Verify password
  const hash = await sha256(password);
  const storedHash = (user.password_hash || "").trim().toLowerCase();
  const inputHash = hash.trim().toLowerCase();

  // Use timing-safe comparison
  const ok = timingSafeEqual(inputHash, storedHash);
  if (!ok) {
    throw new Error("Incorrect password. Please try again.");
  }

  // Passwords match!
  
  // Record last login (non-blocking update)
  try {
    const now = time.nowISO();
    setTimeout(() => {
      try {
        updateDB((db0) => ({
          ...db0,
          USERS: db0.USERS.map((u) =>
            u.user_id === user.user_id ? { ...u, last_login_date: now } : u
          ),
        }));
      } catch (err) {
        console.warn("[Auth] Deferred last_login_date update failed:", err);
      }
    }, 100);
  } catch (err) {
    console.warn("Failed to schedule last login date update:", err);
  }

  // Return fresh user data
  const fresh = getUserById(user.user_id);
  if (!fresh) {
    throw new Error("Login succeeded but failed to load user profile. Please refresh.");
  }
  return fresh;
}

/**
 * Set a new password for a user.
 * This also clears the must_reset_password flag.
 */
export async function setUserPassword(user_id: string, newPassword: string) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const hash = await sha256(newPassword);

  updateDB((db) => {
    const USERS = db.USERS.map((u) =>
      u.user_id === user_id
        ? {
          ...u,
          password_hash: hash,
          must_reset_password: false,
        }
        : u
    );
    return { ...db, USERS };
  });
}

/**
 * Reset a user's password to a default value and require reset on next login.
 * Admin function.
 */
export async function resetUserPasswordToDefault(user_id: string, password = "changeme") {
  const hash = await sha256(password);
  updateDB((db) => {
    const USERS = db.USERS.map((u) =>
      u.user_id === user_id
        ? { ...u, password_hash: hash, must_reset_password: true }
        : u
    );
    return { ...db, USERS };
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
  updateDB((db) => {
    const USERS = db.USERS.map((u) => {
      if (u.user_id !== user_id) return u;
      const { organisation, calling } = defaultOrgCallingForRole(role, u);
      return { ...u, role, organisation, calling };
    });
    return { ...db, USERS };
  });
}

export function setUserCalling(user_id: string, calling: string) {
  updateDB((db) => {
    const USERS = db.USERS.map((u) => {
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
    return { ...db, USERS };
  });
}

export function updateUserProfile(user_id: string, patch: Partial<User>) {
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

export function addUser(name: string, email: string, role: Role, password_hash: string, calling?: string, gender?: "M" | "F") {
  updateDB((db) => {
    const { organisation, calling: calling0 } = defaultOrgCallingForRole(role, calling ? { calling } : undefined);
    const user: User = {
      user_id: ids.uid("user"),
      name,
      email,
      role,
      organisation,
      calling: calling0,
      gender,
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
