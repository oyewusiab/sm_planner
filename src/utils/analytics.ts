import type { Assignment, ChecklistTask, Member, Planner } from "../types";

function normName(s: string) {
  return (s || "").trim().replace(/^brother\s+/i, "").replace(/^sister\s+/i, "").trim().toLowerCase();
}

export type MemberAssignmentStats = {
  key: string; // normalized name key
  display_name: string;
  total: number;
  upcoming: number;
  last_date?: string;
  roles_top?: { role: string; count: number }[];
};

export function computeMemberAssignmentStats(params: {
  members: Member[];
  assignments: Assignment[];
  todayISO: string;
  fromISO?: string;
  toISO?: string;
}) {
  const { members, assignments, todayISO, fromISO, toISO } = params;

  const statsByKey: Record<string, MemberAssignmentStats> = {};

  const ensure = (name: string) => {
    const key = normName(name);
    if (!key) return null;
    if (!statsByKey[key]) {
      statsByKey[key] = {
        key,
        display_name: name,
        total: 0,
        upcoming: 0,
        last_date: undefined,
        roles_top: [],
      };
    }
    return statsByKey[key];
  };

  // Seed from members so we can show even with zero assignments.
  for (const m of members) {
    if (!m.name?.trim()) continue;
    const key = normName(m.name);
    if (!key) continue;
    statsByKey[key] = {
      key,
      display_name: m.name,
      total: 0,
      upcoming: 0,
      last_date: undefined,
      roles_top: [],
    };
  }

  const roleCounts: Record<string, Record<string, number>> = {};

  for (const a of assignments) {
    if (!a.person?.trim()) continue;
    if (fromISO && a.date < fromISO) continue;
    if (toISO && a.date > toISO) continue;

    const st = ensure(a.person);
    if (!st) continue;

    st.total += 1;
    if (a.date >= todayISO) st.upcoming += 1;
    if (!st.last_date || a.date > st.last_date) st.last_date = a.date;

    const key = st.key;
    roleCounts[key] ||= {};
    roleCounts[key][a.role] = (roleCounts[key][a.role] || 0) + 1;
  }

  for (const key of Object.keys(statsByKey)) {
    const rc = roleCounts[key] || {};
    const top = Object.entries(rc)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([role, count]) => ({ role, count }));
    statsByKey[key].roles_top = top;
  }

  const list = Object.values(statsByKey).sort((a, b) => (b.total - a.total) || a.display_name.localeCompare(b.display_name));

  return { statsByKey, list };
}

export function computeChecklistCompletion(params: { checklist: ChecklistTask[]; planner_id?: string }) {
  const rows = params.planner_id ? params.checklist.filter((c) => c.planner_id === params.planner_id) : params.checklist;
  const total = rows.length;
  const done = rows.filter((r) => r.status).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, pct };
}

export function computePlannerCompletionTimes(planners: Planner[]) {
  // Uses created_date -> updated_date (updated_date is submission time in this MVP).
  const submitted = planners.filter((p) => p.state === "SUBMITTED" || p.state === "ARCHIVED");
  const mins: number[] = [];
  for (const p of submitted) {
    const a = Date.parse(p.created_date);
    const b = Date.parse(p.updated_date);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const diffMin = Math.max(0, Math.round((b - a) / 60000));
    mins.push(diffMin);
  }
  mins.sort((x, y) => x - y);
  const avg = mins.length ? Math.round(mins.reduce((s, v) => s + v, 0) / mins.length) : 0;
  const p50 = mins.length ? mins[Math.floor(mins.length / 2)] : 0;
  return { count: mins.length, avg_min: avg, median_min: p50 };
}
