import type { User } from "../types";

/**
 * Formats a user's display name with their appropriate title.
 * - Bishop: "Bishop [Name]"
 * - Other Male: "Brother [Name]"
 * - Other Female: "Sister [Name]"
 * - Fallback: "[Name]"
 */
export function formatUserDisplayName(user: User | { name: string; calling?: string; gender?: "M" | "F" }): string {
  if (!user.name) return "";

  // 1. Check for explicit calling "Bishop"
  if (user.calling === "Bishop") {
    return `Bishop ${user.name}`;
  }

  // 2. Fallback to gender-based titles
  if (user.gender === "M") {
    return `Brother ${user.name}`;
  }
  if (user.gender === "F") {
    return `Sister ${user.name}`;
  }

  // 3. Last fallback
  return user.name;
}
