import { useMemo, useState } from "react";
import type { Member, UnitSettings, User } from "../types";
import { Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Input, Label, SectionTitle, Select, Textarea } from "../components/ui";
import { Modal } from "../components/Modal";
import { can } from "../utils/permissions";
import { getDB, ids, updateDB } from "../utils/storage";
import { downloadTextFile, toCSV } from "../utils/csv";
import { normalizeMemberName, getSurname } from "../utils/format";
import { cn } from "../utils/cn";
import { Badge } from "../components/ui";

function asText(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

function upperText(value: unknown) {
  return asText(value).toUpperCase();
}

function emptyMember(): Member {
  return {
    member_id: ids.uid("mem"),
    name: "",
    age: undefined,
    gender: "",
    phone: "",
    organisation: "",
    status: "",
    email: "",
    notes: "",
    created_date: new Date().toISOString().split("T")[0],
  };
}

type AnalyticsRoleHistory = {
  date: string;
  type: string;
  label: string;
  topic?: string;
};

type AnalyticsMember = Member & {
  total: number;
  speakers: number;
  invocation: number;
  benediction: number;
  lastDate: string | null;
  sacrament: { preparing: number; blessing: number; passing: number };
  music: { director: number; accompanist: number };
  monthlyAssignments: Record<string, number>;
  topics: { topic: string; date: string }[];
  roleHistory: AnalyticsRoleHistory[];
  roleDatesByType: Record<string, string[]>;
  status: string;
  orgs: string[];
  surname: string;
  monthsSinceLast: number;
  isNewcomer: boolean;
  isDoubleDipped: boolean;
  readiness: number;
  diversityScore?: number;
  roleBreadth?: { category: string; count: number }[];
  // Current Calendar Year specific fields
  yearlyTotal: number;
  yearlyDone: number;
  yearlyDoing: number;
  yearlyWillDo: number;
  yearlyLastDate: string | null;
};

type OrgMetric = { total: number; idleCount: number };
type OrgParticipation = {
  org: string;
  memberCount: number;
  assignedCount: number;
  idleCount: number;
  totalAssignments: number;
  participationRate: number;
};
type TrendPoint = { month: string; count: number };
type PredictionCandidate = {
  member_id: string;
  name: string;
  daysSinceLast: number;
  avgInterval: number;
  overdueDays: number;
  confidence: string;
  totalForRole: number;
};
type RolePrediction = { role: string; label: string; candidates: PredictionCandidate[] };
type AgeGroupMetric = {
  label: string;
  min: number;
  max: number;
  memberCount: number;
  assignedCount: number;
  totalAssignments: number;
  rate: number;
};
type ConflictItem = { date: string; type: string; members: string[]; detail: string };
type CalendarMonthPoint = {
  monthIndex: number;
  label: string;
  done: number;
  doing: number;
  willDo: number;
};
type WeeklyAssignment = {
  date: string;
  person: string;
  role: string;
  topic?: string;
};
type FutureMeeting = {
  date: string;
  filledRoles: number;
  totalRoles: number;
};
type AnalyticsData = {
  members: AnalyticsMember[];
  orgMetrics: Record<string, OrgMetric>;
  orgParticipation: OrgParticipation[];
  statusStats: Record<"ACTIVE" | "LESS-ACTIVE", number>;
  genderStats: Record<"M" | "F", number>;
  genderByRole: Record<string, { M: number; F: number }>;
  surnameStats: [string, number][];
  trendTimeline: TrendPoint[];
  reliabilityIndex: number;
  staleTopics: string[];
  inactiveMembers: AnalyticsMember[];
  predictions: RolePrediction[];
  ageGroups: AgeGroupMetric[];
  neverAsked: AnalyticsMember[];
  conflicts: ConflictItem[];
  readySpeakers: AnalyticsMember[];
  totalAssignments: number;
  // Current Calendar Year specific fields
  currentYear: number;
  yearlySegment: { done: number; doing: number; willDo: number };
  calendarYearTimeline: CalendarMonthPoint[];
  currentWeekAssignments: WeeklyAssignment[];
  futureMeetings: FutureMeeting[];
};

const emptyAnalyticsData: AnalyticsData = {
  members: [],
  orgMetrics: {},
  orgParticipation: [],
  statusStats: { ACTIVE: 0, "LESS-ACTIVE": 0 },
  genderStats: { M: 0, F: 0 },
  genderByRole: {},
  surnameStats: [],
  trendTimeline: [],
  reliabilityIndex: 100,
  staleTopics: [],
  inactiveMembers: [],
  predictions: [],
  ageGroups: [],
  neverAsked: [],
  conflicts: [],
  readySpeakers: [],
  totalAssignments: 0,
  currentYear: new Date().getFullYear(),
  yearlySegment: { done: 0, doing: 0, willDo: 0 },
  calendarYearTimeline: [],
  currentWeekAssignments: [],
  futureMeetings: [],
};

export function MembersPage({
  user,
  unit,
  onChanged,
}: {
  user: User;
  unit: UnitSettings;
  onChanged: () => void;
}) {
  const allowed = can(user.role, "MANAGE_MEMBERS");
  const db = getDB();
  const [tab, setTab] = useState<"directory" | "analytics">("directory");
  const [q, setQ] = useState("");
  const [org, setOrg] = useState("ALL");
  const [filterMode, setFilterMode] = useState<string | null>(null);
  const [recRole, setRecRole] = useState<string>("speaker");

  const organisations = useMemo(() => {
    const set = new Set<string>();
    for (const m of db.MEMBERS) {
      const organisation = asText(m.organisation).trim();
      if (organisation) set.add(organisation);
    }
    return ["ALL", ...Array.from(set).sort()];
  }, [db.MEMBERS]);

  const analyticsData = useMemo<AnalyticsData>(() => {
    if (tab !== "analytics" && !filterMode) {
      return emptyAnalyticsData;
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const yearStr = String(currentYear);
    
    // Helper to get Sunday and Saturday dates for the current week (Sunday to Saturday)
    const getWeekDates = (d: Date) => {
      const current = new Date(d);
      const day = current.getDay(); // Sunday is 0
      const diff = current.getDate() - day; // adjust to Sunday
      const sun = new Date(current.setDate(diff));
      const sat = new Date(current.setDate(diff + 6));
      const toStr = (dateVal: Date) => 
        `${dateVal.getFullYear()}-${String(dateVal.getMonth() + 1).padStart(2, "0")}-${String(dateVal.getDate()).padStart(2, "0")}`;
      return { sunday: toStr(sun), saturday: toStr(sat) };
    };
    
    const currentWeekDates = getWeekDates(now);
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(now.getMonth() - 3);

    // 1. Initialise core structures
    const memberStats: Record<string, {
      total: number;
      speakers: number;
      invocation: number;
      benediction: number;
      lastDate: string | null;
      sacrament: { preparing: number; blessing: number; passing: number };
      music: { director: number; accompanist: number };
      monthlyAssignments: Record<string, number>; // year-month -> count
      topics: { topic: string; date: string }[];
      roleHistory: { date: string; type: string; label: string; topic?: string }[];
      roleDatesByType: Record<string, string[]>; // type -> sorted dates
      yearlyTotal: number;
      yearlyDone: number;
      yearlyDoing: number;
      yearlyWillDo: number;
      yearlyLastDate: string | null;
    }> = {};

    const yearlySegment = { done: 0, doing: 0, willDo: 0 };
    const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const calendarYearTimeline: CalendarMonthPoint[] = MONTH_LABELS.map((label, index) => ({
      monthIndex: index,
      label,
      done: 0,
      doing: 0,
      willDo: 0
    }));
    const currentWeekAssignments: WeeklyAssignment[] = [];

    const orgMetrics: Record<string, { total: number; idleCount: number }> = {};
    const topicUsageByDate: Record<string, string[]> = {}; // topic -> [date, date]
    const surnameStats: Record<string, number> = {};
    const statusStats: Record<string, number> = { "ACTIVE": 0, "LESS-ACTIVE": 0 };
    const genderStats: Record<string, number> = { "M": 0, "F": 0 };
    const globalMonthlyTrend: Record<string, number> = {}; // year-month -> total roles
    const genderByRole: Record<string, { M: number; F: number }> = {};
    
    // Member id lookup map
    const nameToId = new Map<string, string>();
    const memberGenderMap = new Map<string, string>(); // member_id -> gender
    for (const m of db.MEMBERS) {
      const norm = normalizeMemberName(asText(m.name));
      if (norm) nameToId.set(norm, m.member_id);
      memberGenderMap.set(m.member_id, upperText(m.gender));
      memberStats[m.member_id] = {
        total: 0, speakers: 0, invocation: 0, benediction: 0, lastDate: null,
        sacrament: { preparing: 0, blessing: 0, passing: 0 },
        music: { director: 0, accompanist: 0 },
        monthlyAssignments: {},
        topics: [],
        roleHistory: [],
        roleDatesByType: {},
        yearlyTotal: 0,
        yearlyDone: 0,
        yearlyDoing: 0,
        yearlyWillDo: 0,
        yearlyLastDate: null
      };
    }

    const findMid = (rawName: string): string | null => {
      if (!rawName) return null;
      
      const normName = (name: string): string => {
        if (!name) return "";
        return name.toLowerCase()
          .replace(/^(bishop|brother|sister|elder|president|stake|ward|br|sr)\s+/g, "")
          .replace(/[^a-z0-9\s]/g, "")
          .trim();
      };
      
      const fuzzyMatch = (nameA: string, nameB: string): boolean => {
        const cleanA = normName(nameA);
        const cleanB = normName(nameB);
        if (!cleanA || !cleanB) return false;
        if (cleanA === cleanB) return true;
        
        const partsA = cleanA.split(/\s+/).filter(Boolean);
        const partsB = cleanB.split(/\s+/).filter(Boolean);
        if (partsA.length === 0 || partsB.length === 0) return false;
        
        // Exact match of first and last name
        if (partsA.length >= 2 && partsB.length >= 2) {
          const firstA = partsA[0];
          const lastA = partsA[partsA.length - 1];
          const firstB = partsB[0];
          const lastB = partsB[partsB.length - 1];
          if (firstA === firstB && lastA === lastB) return true;
        }
        
        // Single word matching word boundaries in the other
        if (partsA.length === 1) {
          return partsB.includes(partsA[0]);
        }
        if (partsB.length === 1) {
          return partsA.includes(partsB[0]);
        }
        
        return false;
      };

      for (const m of db.MEMBERS) {
        if (fuzzyMatch(m.name, rawName)) {
          return m.member_id;
        }
      }

      const norm = normalizeMemberName(rawName);
      if (!norm) return null;
      // 1. Exact match
      if (nameToId.has(norm)) return nameToId.get(norm)!;
      // 2. Partial match (if planner has shorter name)
      for (const [mNorm, mid] of nameToId.entries()) {
        if (mNorm.includes(norm) || norm.includes(mNorm)) return mid;
      }
      return null;
    };

    const ROLE_LABELS: Record<string, string> = {
      speaker: "Speaker", invocation: "Invocation", benediction: "Benediction",
      director: "Music Director", accompanist: "Accompanist",
      preparing: "Sacr. Preparing", blessing: "Sacr. Blessing", passing: "Sacr. Passing",
      other: "Other",
    };

    const processItem = (ra: { n: string; t: string; topic?: string; date: string }) => {
      if (!ra.n) return;

      const isCurrentYear = ra.date.startsWith(yearStr);
      const mIndex = isCurrentYear ? parseInt(ra.date.slice(5, 7), 10) - 1 : -1;
      const isCurrentWeek = isCurrentYear && ra.date >= currentWeekDates.sunday && ra.date <= currentWeekDates.saturday;
      const isPast = isCurrentYear && ra.date < currentWeekDates.sunday;
      const isFuture = isCurrentYear && ra.date > currentWeekDates.saturday;

      // Accumulate global timeline counters (even for guest names not in MEMBERS sheet)
      if (isCurrentYear) {
        if (isCurrentWeek) {
          yearlySegment.doing++;
          if (mIndex >= 0 && mIndex < 12) calendarYearTimeline[mIndex].doing++;
          currentWeekAssignments.push({
            date: ra.date,
            person: ra.n,
            role: ROLE_LABELS[ra.t] || ra.t,
            topic: ra.topic
          });
        } else if (isPast) {
          yearlySegment.done++;
          if (mIndex >= 0 && mIndex < 12) calendarYearTimeline[mIndex].done++;
        } else if (isFuture) {
          yearlySegment.willDo++;
          if (mIndex >= 0 && mIndex < 12) calendarYearTimeline[mIndex].willDo++;
        }
      }

      const mid = findMid(ra.n);
      if (mid) {
        const s = memberStats[mid];
        const dateStr = ra.date;
        const pMonth = dateStr.slice(0, 7); // yyyy-mm

        s.total++;
        s.monthlyAssignments[pMonth] = (s.monthlyAssignments[pMonth] || 0) + 1;
        s.roleHistory.push({ date: dateStr, type: ra.t, label: ROLE_LABELS[ra.t] || ra.t, topic: ra.topic });
        if (!s.roleDatesByType[ra.t]) s.roleDatesByType[ra.t] = [];
        s.roleDatesByType[ra.t].push(dateStr);

        if (ra.t === "speaker") {
           s.speakers++;
           if (ra.topic) {
             s.topics.push({ topic: ra.topic, date: dateStr });
             topicUsageByDate[ra.topic] = [...(topicUsageByDate[ra.topic] || []), dateStr];
           }
        }
        if (ra.t === "invocation") s.invocation++;
        if (ra.t === "benediction") s.benediction++;
        if (ra.t === "director") s.music.director++;
        if (ra.t === "accompanist") s.music.accompanist++;
        if (ra.t === "preparing") s.sacrament.preparing++;
        if (ra.t === "blessing") s.sacrament.blessing++;
        if (ra.t === "passing") s.sacrament.passing++;
        if (!s.lastDate || dateStr > s.lastDate) s.lastDate = dateStr;
        
        globalMonthlyTrend[pMonth] = (globalMonthlyTrend[pMonth] || 0) + 1;

        // Track gender per role type
        if (ra.t !== "other") {
          const g = memberGenderMap.get(mid) || "";
          if (!genderByRole[ra.t]) genderByRole[ra.t] = { M: 0, F: 0 };
          if (g === "M") genderByRole[ra.t].M++;
          else if (g === "F") genderByRole[ra.t].F++;
        }

        // Track current year member stats
        if (isCurrentYear) {
          s.yearlyTotal++;
          if (isCurrentWeek) s.yearlyDoing++;
          else if (isPast) s.yearlyDone++;
          else if (isFuture) s.yearlyWillDo++;
          if (!s.yearlyLastDate || dateStr > s.yearlyLastDate) s.yearlyLastDate = dateStr;
        }
      }
    };

    // 2. Process all official assignments (Historical source 1)
    for (const a of db.ASSIGNMENTS) {
      const type = a.role.toLowerCase().includes("speaker") ? "speaker" :
                   a.role === "Invocation" ? "invocation" :
                   a.role === "Benediction" ? "benediction" :
                   a.role === "Director" ? "director" :
                   a.role === "Accompanist" ? "accompanist" :
                   a.role === "Sacrament: Preparing" ? "preparing" :
                   a.role === "Sacrament: Blessing" ? "blessing" :
                   a.role === "Sacrament: Passing" ? "passing" : "other";

      processItem({ n: a.person, t: type, topic: a.topic, date: a.date });
    }

    // 3. Process Planners (Source 2 - only if not already captured in ASSIGNMENTS)
    const trackedKeys = new Set(db.ASSIGNMENTS.map(a => `${a.planner_id}.${a.week_id}.${a.role}.${a.person}`));

    for (const p of db.PLANNERS) {
      if (p.state === "DRAFT") continue;
      
      for (const w of p.weeks) {
        const wDate = w.date;
        const items = [
          { n: w.conducting_officer, t: "other", r: "Conducting Officer" },
          { n: w.presiding, t: "other", r: "Presiding" },
          ...w.speakers.map((s, i) => ({ n: s.name, t: "speaker", topic: s.topic, r: `Speaker ${i+1}` })),
          { n: w.prayers.invocation, t: "invocation", r: "Invocation" },
          { n: w.prayers.benediction, t: "benediction", r: "Benediction" },
          { n: w.music?.director, t: "director", r: "Director" },
          { n: w.music?.accompanist, t: "accompanist", r: "Accompanist" },
          ...w.sacrament.preparing.map(n => ({ n, t: "preparing", r: "Sacrament: Preparing" })),
          ...w.sacrament.blessing.map(n => ({ n, t: "blessing", r: "Sacrament: Blessing" })),
          ...w.sacrament.passing.map(n => ({ n, t: "passing", r: "Sacrament: Passing" })),
        ];

        for (const it of items) {
          if (!it.n) continue;
          const key = `${p.planner_id}.${w.week_id}.${it.r}.${it.n}`;
          if (!trackedKeys.has(key)) {
            processItem({ n: it.n, t: it.t, topic: (it as any).topic, date: wDate });
          }
        }
      }
    }

    // 4. Finalize analytics
    const processedMembers = db.MEMBERS.map(m => {
      const s = memberStats[m.member_id];
      const status = upperText(m.status);
      const gender = upperText(m.gender);
      const orgs = asText(m.organisation).split(",").map(o => o.trim()).filter(Boolean);
      const surname = getSurname(asText(m.name));
      
      if (status === "ACTIVE" || status === "LESS-ACTIVE") statusStats[status] += s.total;
      if (gender === "M" || gender === "F") genderStats[gender] += s.total;
      surnameStats[surname] = (surnameStats[surname] || 0) + s.total;

      for (const o of orgs) {
        if (!orgMetrics[o]) orgMetrics[o] = { total: 0, idleCount: 0 };
        orgMetrics[o].total += s.total;
        if (s.total === 0) orgMetrics[o].idleCount++;
      }

      const isNewcomer = m.created_date ? new Date(m.created_date) > threeMonthsAgo : false;
      const monthsSinceLast = s.lastDate ? Math.floor((now.getTime() - new Date(s.lastDate).getTime()) / (1000 * 60 * 60 * 24 * 30)) : 99;
      const rolesByDate: Record<string, string[]> = {};
      for (const h of s.roleHistory) {
        if (!rolesByDate[h.date]) rolesByDate[h.date] = [];
        rolesByDate[h.date].push(h.type);
      }
      const isDoubleDipped = Object.entries(rolesByDate).some(([_, types]) => {
        if (types.length <= 1) return false;
        const isAllSacrament = types.every(t => t === "preparing" || t === "blessing" || t === "passing");
        return !isAllSacrament;
      });

      let readiness = 0;
      if (status === "ACTIVE") {
        readiness += 40;
        if (monthsSinceLast >= 3) readiness += 30;
        if (s.speakers < 2) readiness += 20;
        if (!isNewcomer) readiness += 10;
      }

      return {
        ...m,
        ...s,
        status,
        orgs,
        surname,
        monthsSinceLast,
        isNewcomer,
        isDoubleDipped,
        readiness
      };
    });

    // 5. Trend Timeline (Last 12 months)
    const trendTimeline = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(now.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      trendTimeline.push({ month: key, count: globalMonthlyTrend[key] || 0 });
    }

    // 6. Reliability Index (Last 4 Planners)
    const recentPlanners = db.PLANNERS
      .filter(p => p.state !== "DRAFT")
      .sort((a, b) => b.updated_date.localeCompare(a.updated_date))
      .slice(0, 4);
    
    let totalTasks = 0;
    let completedTasks = 0;
    for (const p of recentPlanners) {
      const pChecklists = db.CHECKLISTS.filter(c => c.planner_id === p.planner_id);
      totalTasks += pChecklists.length;
      completedTasks += pChecklists.filter(c => c.status).length;
    }
    const reliabilityIndex = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 100;

    // 7. Inactive Individuals (No assignment in 6 months)
    const inactiveMembers = processedMembers
      .filter(m => m.monthsSinceLast >= 6 && m.status === "ACTIVE")
      .sort((a, b) => b.monthsSinceLast - a.monthsSinceLast)
      .slice(0, 10);

    // 8. Topic staleness detection (used 3x in last 2 months)
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(now.getMonth() - 2);
    const staleTopics = Object.entries(topicUsageByDate)
      .filter(([_, dates]) => dates.filter(d => new Date(d) > twoMonthsAgo).length >= 3)
      .map(([topic]) => topic);

    // 9. ROLE DIVERSITY INDEX
    const processedMembersWithDiversity = processedMembers.map(m => {
      const s = memberStats[m.member_id];
      const prayerCount = s.yearlyTotal ? (s.invocation + s.benediction) : 0;
      const sacramentCount = s.yearlyTotal ? (s.sacrament.preparing + s.sacrament.blessing + s.sacrament.passing) : 0;
      const musicCount = s.yearlyTotal ? (s.music.director + s.music.accompanist) : 0;
      const roleBreadth = [
        { category: "Speaking", count: s.speakers },
        { category: "Prayer", count: prayerCount },
        { category: "Sacrament", count: sacramentCount },
        { category: "Music", count: musicCount },
      ];
      const categoriesUsed = roleBreadth.filter(r => r.count > 0).length;
      const diversityScore = Math.round((categoriesUsed / 4) * 100);
      return { ...m, diversityScore, roleBreadth };
    });

    // 10. ASSIGNMENT PREDICTION ENGINE
    const PREDICT_ROLES = ["speaker", "invocation", "benediction", "director", "accompanist", "preparing", "blessing", "passing"];
    const predictions = PREDICT_ROLES.map(role => {
      const activeMembers = processedMembers.filter(m => m.status === "ACTIVE");
      const candidates = activeMembers
        .map(m => {
          const s = memberStats[m.member_id];
          const dates = (s.roleDatesByType[role] || []).sort();
          const lastDate = dates[dates.length - 1] || null;
          const daysSinceLast = lastDate
            ? Math.floor((now.getTime() - new Date(lastDate).getTime()) / 86400000)
            : 9999;
          let avgInterval = 30;
          if (dates.length >= 2) {
            const intervals = dates.slice(1).map((d, i) =>
              Math.floor((new Date(d).getTime() - new Date(dates[i]).getTime()) / 86400000)
            );
            avgInterval = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
          }
          const overdueDays = daysSinceLast - avgInterval;
          const confidence = dates.length >= 3 ? "High" : dates.length >= 1 ? "Medium" : "Low";
          return { member_id: m.member_id, name: m.name, daysSinceLast, avgInterval, overdueDays, confidence, totalForRole: dates.length };
        })
        .filter(c => c.daysSinceLast > 0)
        .sort((a, b) => b.overdueDays - a.overdueDays)
        .slice(0, 5);
      return { role, label: ROLE_LABELS[role] || role, candidates };
    });

    // 11. AGE GROUP ENGAGEMENT
    const ageGroups = [
      { label: "Under 11", min: 0, max: 10 },
      { label: "11–17", min: 11, max: 17 },
      { label: "18–30", min: 18, max: 30 },
      { label: "31–50", min: 31, max: 50 },
      { label: "50+", min: 51, max: 200 },
    ].map(band => {
      const inBand = processedMembers.filter(m => m.age != null && m.age >= band.min && m.age <= band.max);
      const assignedCount = inBand.filter(m => m.total > 0).length;
      const totalAssignmentsInBand = inBand.reduce((sum, m) => sum + m.total, 0);
      const rate = inBand.length > 0 ? Math.round((assignedCount / inBand.length) * 100) : 0;
      return { ...band, memberCount: inBand.length, assignedCount, totalAssignments: totalAssignmentsInBand, rate };
    });

    // 12. NEVER BEEN ASKED
    const threeMonthsAgo2 = new Date();
    threeMonthsAgo2.setMonth(now.getMonth() - 3);
    const neverAsked = processedMembers
      .filter(m => m.total === 0 && m.status === "ACTIVE" && m.created_date && new Date(m.created_date) <= threeMonthsAgo2)
      .sort((a, b) => (a.created_date || "").localeCompare(b.created_date || ""))
      .slice(0, 15);

    // 13. CONFLICT DETECTOR
    const conflicts: { date: string; type: string; members: string[]; detail: string }[] = [];
    for (const p of db.PLANNERS) {
      if (p.state === "DRAFT") continue;
      for (const w of p.weeks) {
        if (!w.date) continue;
        const weekAssignees: { name: string; role: string }[] = [
          ...w.speakers.map(s => ({ name: s.name, role: "Speaker" })),
          { name: w.prayers.invocation, role: "Invocation" },
          { name: w.prayers.benediction, role: "Benediction" },
          ...w.sacrament.preparing.map(n => ({ name: n, role: "Sacr. Preparing" })),
          ...w.sacrament.blessing.map(n => ({ name: n, role: "Sacr. Blessing" })),
          ...w.sacrament.passing.map(n => ({ name: n, role: "Sacr. Passing" })),
        ].filter(a => !!a.name);

        const surnameBuckets: Record<string, { name: string; role: string }[]> = {};
        for (const a of weekAssignees) {
          const sn = getSurname(a.name);
          if (!surnameBuckets[sn]) surnameBuckets[sn] = [];
          surnameBuckets[sn].push(a);
        }
        for (const [sn, members] of Object.entries(surnameBuckets)) {
          if (members.length >= 2) {
            const uniqueNames = [...new Set(members.map(m => m.name))];
            if (uniqueNames.length >= 2) {
              conflicts.push({
                date: w.date, type: "FAMILY_CONFLICT",
                members: uniqueNames,
                detail: `${sn} family: ${members.map(m => `${m.name} (${m.role})`).join(", ")}`,
              });
            }
          }
        }

        const nameCounts: Record<string, string[]> = {};
        for (const a of weekAssignees) {
          if (!nameCounts[a.name]) nameCounts[a.name] = [];
          nameCounts[a.name].push(a.role);
        }
        for (const [name, roles] of Object.entries(nameCounts)) {
          if (roles.length >= 2) {
            conflicts.push({
              date: w.date, type: "DOUBLE_ASSIGNED",
              members: [name],
              detail: `${name} assigned ${roles.length}× in same meeting: ${roles.join(", ")}`,
            });
          }
        }
      }
    }

    // 14. Org participation
    const membersByOrg: Record<string, number> = {};
    for (const m of db.MEMBERS) {
      const orgs2 = (m.organisation || "").split(",").map(o => o.trim()).filter(Boolean);
      for (const o of orgs2) {
        membersByOrg[o] = (membersByOrg[o] || 0) + 1;
      }
    }
    const orgParticipation = Object.entries(orgMetrics).map(([org, metrics]) => ({
      org,
      memberCount: membersByOrg[org] || 0,
      assignedCount: (membersByOrg[org] || 0) - metrics.idleCount,
      idleCount: metrics.idleCount,
      totalAssignments: metrics.total,
      participationRate: membersByOrg[org] > 0
        ? Math.round(((membersByOrg[org] - metrics.idleCount) / membersByOrg[org]) * 100)
        : 0,
    })).sort((a, b) => b.participationRate - a.participationRate);

    // 15. Future Meetings Pipeline Filled Statistics
    const getWeekFilledStats = (w: any) => {
      let filled = 0;
      let total = 0;
      const checkField = (val: any) => {
        total++;
        if (val && String(val).trim()) filled++;
      };

      checkField(w.presiding);
      checkField(w.conducting_officer);
      checkField(w.prayers?.invocation);
      checkField(w.prayers?.benediction);
      checkField(w.music?.director);
      checkField(w.music?.accompanist);

      if (Array.isArray(w.speakers)) {
        w.speakers.forEach((s: any) => {
          total++;
          if (s?.name && String(s.name).trim()) filled++;
        });
      } else {
        total += 3;
      }

      if (w.sacrament) {
        if (Array.isArray(w.sacrament.preparing)) {
          total += w.sacrament.preparing.length || 2;
          w.sacrament.preparing.forEach((n: any) => { if (n && String(n).trim()) filled++; });
        } else {
          total += 2;
        }
        if (Array.isArray(w.sacrament.blessing)) {
          total += w.sacrament.blessing.length || 2;
          w.sacrament.blessing.forEach((n: any) => { if (n && String(n).trim()) filled++; });
        } else {
          total += 2;
        }
        if (Array.isArray(w.sacrament.passing)) {
          total += w.sacrament.passing.length || 4;
          w.sacrament.passing.forEach((n: any) => { if (n && String(n).trim()) filled++; });
        } else {
          total += 4;
        }
      } else {
        total += 8;
      }

      return { filled, total };
    };

    const futureMeetings: FutureMeeting[] = [];
    for (const p of db.PLANNERS) {
      if (p.state === "DRAFT") continue;
      if (!p.weeks) continue;
      for (const w of p.weeks) {
        if (w.date && w.date.startsWith(yearStr) && w.date > currentWeekDates.saturday) {
          const stats = getWeekFilledStats(w);
          futureMeetings.push({
            date: w.date,
            filledRoles: stats.filled,
            totalRoles: stats.total
          });
        }
      }
    }
    futureMeetings.sort((a, b) => a.date.localeCompare(b.date));

    return {
      members: processedMembersWithDiversity,
      orgMetrics,
      orgParticipation,
      statusStats,
      genderStats,
      genderByRole,
      surnameStats: Object.entries(surnameStats).sort((a, b) => b[1] - a[1]).slice(0, 10),
      trendTimeline,
      reliabilityIndex,
      staleTopics,
      inactiveMembers,
      predictions,
      ageGroups,
      neverAsked,
      conflicts: conflicts.slice(0, 20),
      readySpeakers: processedMembersWithDiversity
        .filter(m => m.status === "ACTIVE" && m.readiness > 60)
        .sort((a, b) => b.readiness - a.readiness)
        .slice(0, 8),
      totalAssignments: processedMembers.reduce((a, b) => a + b.total, 0),
      currentYear,
      yearlySegment,
      calendarYearTimeline,
      currentWeekAssignments,
      futureMeetings
    };
  }, [db.MEMBERS, db.PLANNERS, db.CHECKLISTS, db.ASSIGNMENTS, tab, filterMode]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let base = db.MEMBERS;

    // Apply analytics drill-down
    if (filterMode === "DOUBLE_DIPPED") {
      const ddIds = analyticsData.members.filter(m => m.isDoubleDipped).map(m => m.member_id);
      base = base.filter(m => ddIds.includes(m.member_id));
    } else if (filterMode === "IDLE") {
      base = base.filter(m => !analyticsData.members.find(am => am.member_id === m.member_id && am.total > 0));
    } else if (filterMode === "ACTIVE_MEMBER") {
      base = base.filter(m => upperText(m.status) === "ACTIVE");
    } else if (filterMode === "LESS_ACTIVE_MEMBER") {
      base = base.filter(m => upperText(m.status) === "LESS-ACTIVE");
    } else if (filterMode === "YOUTH") {
      base = base.filter(m => m.age && m.age >= 12 && m.age <= 18);
    } else if (filterMode === "MUSIC") {
      const musicIds = analyticsData.members.filter(m => m.music.director > 0 || m.music.accompanist > 0).map(m => m.member_id);
      base = base.filter(m => musicIds.includes(m.member_id));
    } else if (filterMode === "INACTIVE_6M") {
      const inactiveIds = analyticsData.inactiveMembers.map(m => m.member_id);
      base = base.filter(m => inactiveIds.includes(m.member_id));
    } else if (filterMode === "NEWCOMER_NO_ROLE") {
      const newcomerIds = analyticsData.members.filter(m => m.isNewcomer && m.total === 0).map(m => m.member_id);
      base = base.filter(m => newcomerIds.includes(m.member_id));
    } else if (filterMode?.startsWith("ORG_")) {
      const targetOrg = filterMode.replace("ORG_", "");
      base = base.filter(m => asText(m.organisation).split(",").map(o => o.trim().toLowerCase()).includes(targetOrg.toLowerCase()));
    } else if (filterMode?.startsWith("SURNAME_")) {
      const surname = filterMode.replace("SURNAME_", "");
      base = base.filter(m => getSurname(asText(m.name)) === surname);
    }

    return base
      .filter((m) => (org === "ALL" ? true : asText(m.organisation).trim() === org))
      .filter((m) => {
        if (!query) return true;
        const hay = `${asText(m.name)} ${asText(m.phone)} ${asText(m.organisation)} ${asText(m.email)}`.toLowerCase();
        return hay.includes(query);
      })
      .sort((a, b) => asText(a.name).localeCompare(asText(b.name)));
  }, [db.MEMBERS, q, org, filterMode, analyticsData.members]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);

  function save(member: Member, originalKey?: string) {
    updateDB((db0) => {
      const previousKey = asText(originalKey || member.member_id || member.name).trim();
      const cleanName = asText(member.name).trim();
      const nextMember: Member = {
        ...member,
        member_id: cleanName,
        name: cleanName,
        created_date: member.created_date || new Date().toISOString().split("T")[0],
      };
      const MEMBERS = [
        nextMember,
        ...db0.MEMBERS.filter((m) => {
          const existingKey = asText(m.member_id || m.name).trim();
          const existingName = asText(m.name).trim();
          return (
            existingKey !== previousKey &&
            existingName !== previousKey &&
            existingName !== cleanName
          );
        }),
      ];
      return { ...db0, MEMBERS };
    });
    onChanged();
  }

  function exportCSV() {
    const columns = [
      { key: "name", label: "Name" },
      { key: "age", label: "Age" },
      { key: "gender", label: "Gender" },
      { key: "phone", label: "Phone" },
      { key: "organisation", label: "Organisation" },
      { key: "status", label: "Status" },
      { key: "email", label: "Email" },
      { key: "notes", label: "Notes" },
    ];
    const csv = toCSV(filtered as any, columns);
    const safe = unit.unit_name.trim().replace(/\s+/g, "_");
    downloadTextFile(`members_${safe}.csv`, csv, "text/csv");
  }

  if (!allowed) {
    return <EmptyState title="Members Directory" body="You do not have permission to manage members." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle title="Members Directory" subtitle="Add, edit, search, and export your unit member list." />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={exportCSV}>
            Export CSV
          </Button>
          <Button
            onClick={() => {
              setEditing(emptyMember());
              setOpen(true);
            }}
          >
            Add Member
          </Button>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        <button
          onClick={() => setTab("directory")}
          className={cn("px-4 py-1.5 text-xs font-bold rounded-lg transition", tab === "directory" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}
        >
          Directory
        </button>
        <button
          onClick={() => setTab("analytics")}
          className={cn("px-4 py-1.5 text-xs font-bold rounded-lg transition", tab === "analytics" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}
        >
          Analytics
        </button>
      </div>

      {filterMode && (
        <div className="flex items-center gap-2 px-1">
          <Badge tone="blue" className="px-2 py-1 flex items-center gap-2">
            Filter: <span className="font-black italic">{filterMode.replace(/_/g, " ")}</span>
            <button onClick={() => setFilterMode(null)} className="ml-1 hover:text-white/80">✕</button>
          </Badge>
          <span className="text-[10px] text-slate-400 font-medium">Click ✕ to show all members</span>
        </div>
      )}

      {tab === "directory" ? (
        <>
      <Card>
        <CardHeader>
          <CardTitle>Search & Filter</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1 md:col-span-2">
              <Label>Search</Label>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, organisation…" />
            </div>
            <div className="space-y-1">
              <Label>Organisation</Label>
              <Select value={org} onChange={(e) => setOrg(e.target.value)}>
                {organisations.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3 font-medium text-slate-600">Name</th>
              <th className="p-3 font-medium text-slate-600">Age</th>
              <th className="p-3 font-medium text-slate-600">Gender</th>
              <th className="p-3 font-medium text-slate-600">Phone</th>
              <th className="p-3 font-medium text-slate-600">Organisation</th>
              <th className="p-3 font-medium text-slate-600">Status</th>
              <th className="p-3 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-500" colSpan={7}>
                  No members found.
                </td>
              </tr>
            ) : (
              filtered.map((m) => (
                <tr key={m.member_id} className="border-t border-[color:var(--border)]">
                  <td className="p-3 font-medium">{m.name}</td>
                  <td className="p-3">{m.age ?? ""}</td>
                  <td className="p-3">{m.gender ?? ""}</td>
                  <td className="p-3">{m.phone ?? ""}</td>
                  <td className="p-3">{m.organisation ?? ""}</td>
                  <td className="p-3">{m.status ?? ""}</td>
                  <td className="p-3">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditing(JSON.parse(JSON.stringify(m)) as Member);
                        setOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </>
      ) : (
        /* Analytics View */
        <div className="space-y-8 animate-fade-in pb-12">
          {/* Header Section */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-50 p-6 rounded-2xl border border-slate-100 shadow-sm">
            <div>
              <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                <span>📊</span> Calendar Year Analytics ({analyticsData.currentYear})
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Tracking assignments, active engagement, and future plans from January 1st to December 31st, {analyticsData.currentYear}.
              </p>
            </div>
            <Badge tone="blue" className="bg-blue-600/10 text-blue-700 border-blue-200/50 px-4 py-1.5 rounded-full font-black text-xs">
              Active Year: {analyticsData.currentYear}
            </Badge>
          </div>

          {/* Progress Overview & Stacked Timeline Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column: Annual Segmented Progress (Done, Doing, Will Do) */}
            <Card className="lg:col-span-1 bg-gradient-to-br from-slate-900 via-slate-850 to-slate-800 text-white border-none shadow-xl flex flex-col justify-between p-6">
              <div>
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Annual Activity Progress</h3>
                    <div className="mt-1.5 text-3xl font-black tracking-tight text-white">
                      {analyticsData.yearlySegment.done + analyticsData.yearlySegment.doing + analyticsData.yearlySegment.willDo}
                      <span className="text-xs text-slate-400 font-normal ml-2">Total Roles</span>
                    </div>
                  </div>
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-none font-bold text-[10px]">
                    {analyticsData.currentYear} Goal
                  </Badge>
                </div>

                {/* horizontal segmented progress bar */}
                <div className="mt-8 space-y-2">
                  <div className="flex justify-between text-xs font-semibold text-slate-300">
                    <span>Progress Breakdown</span>
                    <span>{Math.round(((analyticsData.yearlySegment.done) / (analyticsData.yearlySegment.done + analyticsData.yearlySegment.doing + analyticsData.yearlySegment.willDo || 1)) * 100)}% Done</span>
                  </div>
                  
                  <div className="h-4 w-full bg-slate-700/50 rounded-full flex overflow-hidden p-0.5 border border-slate-700">
                    {/* Done */}
                    <div 
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-l-full transition-all"
                      style={{ width: `${(analyticsData.yearlySegment.done / (analyticsData.yearlySegment.done + analyticsData.yearlySegment.doing + analyticsData.yearlySegment.willDo || 1)) * 100}%` }}
                      title={`Done: ${analyticsData.yearlySegment.done}`}
                    />
                    {/* Doing */}
                    <div 
                      className="h-full bg-gradient-to-r from-amber-500 to-orange-400 transition-all"
                      style={{ width: `${(analyticsData.yearlySegment.doing / (analyticsData.yearlySegment.done + analyticsData.yearlySegment.doing + analyticsData.yearlySegment.willDo || 1)) * 100}%` }}
                      title={`Doing: ${analyticsData.yearlySegment.doing}`}
                    />
                    {/* Will Do */}
                    <div 
                      className="h-full bg-gradient-to-r from-indigo-500 to-blue-400 rounded-r-full transition-all"
                      style={{ width: `${(analyticsData.yearlySegment.willDo / (analyticsData.yearlySegment.done + analyticsData.yearlySegment.doing + analyticsData.yearlySegment.willDo || 1)) * 100}%` }}
                      title={`Will Do: ${analyticsData.yearlySegment.willDo}`}
                    />
                  </div>
                </div>

                {/* Detailed Legend Stats */}
                <div className="mt-8 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-emerald-500" />
                      <span className="text-xs font-semibold text-slate-300">Done (Past Roles)</span>
                    </div>
                    <span className="text-sm font-bold text-white">{analyticsData.yearlySegment.done} <span className="text-[10px] text-slate-400 font-normal">roles</span></span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-amber-500" />
                      <span className="text-xs font-semibold text-slate-300">Doing (This Week)</span>
                    </div>
                    <span className="text-sm font-bold text-white">{analyticsData.yearlySegment.doing} <span className="text-[10px] text-slate-400 font-normal">roles</span></span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-indigo-500" />
                      <span className="text-xs font-semibold text-slate-300">Will Do (Future Planned)</span>
                    </div>
                    <span className="text-sm font-bold text-white">{analyticsData.yearlySegment.willDo} <span className="text-[10px] text-slate-400 font-normal">roles</span></span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800/80 text-[10px] text-slate-500 font-bold uppercase tracking-wider text-center">
                January 1st – December 31st
              </div>
            </Card>

            {/* Right Column: Month-by-Month Jan-Dec Stacked Timeline Bar Chart */}
            <Card className="lg:col-span-2 bg-gradient-to-r from-slate-900 to-slate-850 border-none shadow-xl text-white flex flex-col justify-between p-6">
              <div>
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Monthly Stacked Activity Timeline</h3>
                    <p className="text-xs text-slate-500 mt-1">Done (green), Doing (amber), and Will Do (indigo) assignments distribution</p>
                  </div>
                </div>

                {/* 12-Month Stacked Bar Chart */}
                <div className="flex items-end justify-between gap-1.5 sm:gap-3 h-48 mt-4">
                  {analyticsData.calendarYearTimeline.map((t) => {
                    const mTotal = t.done + t.doing + t.willDo;
                    const maxMonthTotal = Math.max(...analyticsData.calendarYearTimeline.map(m => m.done + m.doing + m.willDo)) || 1;
                    const totalHeight = Math.max(5, (mTotal / maxMonthTotal) * 100);
                    
                    const donePct = mTotal > 0 ? (t.done / mTotal) * 100 : 0;
                    const doingPct = mTotal > 0 ? (t.doing / mTotal) * 100 : 0;
                    const willDoPct = mTotal > 0 ? (t.willDo / mTotal) * 100 : 0;

                    return (
                      <div key={t.label} className="group relative flex-1 flex flex-col items-center h-full justify-end">
                        {/* Stacked Vertical Bar */}
                        <div 
                          className="w-full rounded-sm overflow-hidden flex flex-col justify-end transition-all cursor-pointer hover:brightness-110"
                          style={{ height: `${totalHeight}%` }}
                        >
                          {/* Will Do (Top) */}
                          {t.willDo > 0 && (
                            <div 
                              className="bg-indigo-500 w-full"
                              style={{ height: `${willDoPct}%` }}
                            />
                          )}
                          {/* Doing (Middle) */}
                          {t.doing > 0 && (
                            <div 
                              className="bg-amber-500 w-full animate-pulse"
                              style={{ height: `${doingPct}%` }}
                            />
                          )}
                          {/* Done (Bottom) */}
                          {t.done > 0 && (
                            <div 
                              className="bg-emerald-500 w-full"
                              style={{ height: `${donePct}%` }}
                            />
                          )}
                          {/* If empty bar, render a small line */}
                          {mTotal === 0 && (
                            <div className="bg-slate-800 w-full h-1" />
                          )}
                        </div>

                        {/* Hover details tooltip */}
                        <div className="absolute -top-16 left-1/2 -translate-x-1/2 bg-white text-slate-900 text-[10px] font-black p-2 rounded shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30 pointer-events-none border border-slate-100">
                          <div className="text-slate-800 font-bold border-b pb-1 mb-1">{t.label} {analyticsData.currentYear}</div>
                          <div className="flex items-center gap-1.5 text-emerald-600">● Done: {t.done}</div>
                          <div className="flex items-center gap-1.5 text-amber-500">● Doing: {t.doing}</div>
                          <div className="flex items-center gap-1.5 text-indigo-600">● Will Do: {t.willDo}</div>
                          <div className="text-slate-500 mt-0.5 pt-0.5 border-t">Total: {mTotal} roles</div>
                        </div>

                        {/* Month Label */}
                        <div className="mt-3 text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                          {t.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-center gap-6 text-[10px] text-slate-400 font-bold">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Done (Completed)</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Doing (Current Week)</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-500" /> Will Do (Planned)</span>
              </div>
            </Card>
          </div>

          {/* Current Week (Doing) & Upcoming Pipeline (Will Do) & Counters */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Card A: Doing Now (Current Week's Assignments) */}
            <Card className="bg-white border-slate-100 shadow-sm flex flex-col justify-between">
              <CardHeader className="pb-3 border-b border-slate-50">
                <CardTitle className="text-slate-800 flex items-center gap-2 text-sm">
                  <span>⚡</span> Doing Now (This Week)
                </CardTitle>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                  Active assignments for the current week
                </p>
              </CardHeader>
              <CardBody className="grow p-0">
                <div className="max-h-[300px] overflow-auto divide-y divide-slate-100">
                  {analyticsData.currentWeekAssignments.length === 0 ? (
                    <div className="py-12 px-6 text-center text-slate-400 text-xs italic">
                      No assignments scheduled for this week (Sunday to Saturday).
                    </div>
                  ) : (
                    analyticsData.currentWeekAssignments.map((a, idx) => (
                      <div 
                        key={`${a.person}-${a.role}-${idx}`}
                        onClick={() => { setTab("directory"); setQ(a.person); }}
                        className="p-3.5 hover:bg-slate-50/80 transition-colors cursor-pointer flex justify-between items-start group"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="text-xs font-black text-slate-800 group-hover:text-blue-600 transition-colors truncate">
                            {a.person}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1 font-semibold flex items-center gap-1">
                            <span>📅 {a.date}</span>
                            {a.topic && <span className="truncate max-w-[150px] italic">({a.topic})</span>}
                          </div>
                        </div>
                        <Badge tone="amber" className="text-[8px] font-extrabold px-1.5 py-0.5 uppercase tracking-wide shrink-0">
                          {a.role}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </CardBody>
            </Card>

            {/* Card B: Future Meeting Pipeline (Will Do) */}
            <Card className="bg-white border-slate-100 shadow-sm flex flex-col justify-between">
              <CardHeader className="pb-3 border-b border-slate-50">
                <CardTitle className="text-slate-800 flex items-center gap-2 text-sm">
                  <span>🚀</span> Will Do (Upcoming Pipeline)
                </CardTitle>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                  Planned sacramental meeting coverage
                </p>
              </CardHeader>
              <CardBody className="grow p-0">
                <div className="max-h-[300px] overflow-auto divide-y divide-slate-100">
                  {analyticsData.futureMeetings.length === 0 ? (
                    <div className="py-12 px-6 text-center text-slate-400 text-xs italic">
                      No future meetings planned in this calendar year.
                    </div>
                  ) : (
                    analyticsData.futureMeetings.slice(0, 6).map((m, idx) => {
                      const pct = Math.round((m.filledRoles / (m.totalRoles || 1)) * 100);
                      return (
                        <div 
                          key={`${m.date}-${idx}`}
                          className="p-3.5 hover:bg-slate-50/50 transition-colors flex flex-col gap-2"
                        >
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-extrabold text-slate-700">📅 {m.date}</span>
                            <span className="text-[10px] font-black text-slate-500">
                              {m.filledRoles} / {m.totalRoles} Roles ({pct}%)
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden border border-slate-200/50">
                            <div 
                              className={cn("h-full rounded-full transition-all", 
                                pct === 100 ? "bg-gradient-to-r from-emerald-500 to-teal-400" : 
                                pct >= 50 ? "bg-gradient-to-r from-amber-500 to-orange-400" : 
                                "bg-gradient-to-r from-rose-500 to-red-400"
                              )} 
                              style={{ width: `${pct}%` }} 
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardBody>
            </Card>

            {/* Card C: Annual Statistics Overview Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div 
                onClick={() => { setTab("directory"); setFilterMode("ACTIVE_MEMBER"); }}
                className="stat-card p-4 animate-scale-in stagger-1 cursor-pointer hover:border-emerald-200 group transition-all bg-white border border-slate-100 rounded-2xl flex flex-col justify-between"
              >
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-emerald-600 transition-colors">Active members</div>
                <div className="mt-3 text-2xl font-black text-slate-800">
                  {(analyticsData.statusStats || {})["ACTIVE"] || 0} <span className="text-xs font-normal text-slate-400">roles</span>
                </div>
                <div className="mt-2 text-[10px] font-bold text-emerald-600 bg-emerald-50 w-fit px-1.5 py-0.5 rounded">
                  Active engagement
                </div>
              </div>

              <div 
                onClick={() => { setTab("directory"); setFilterMode("LESS_ACTIVE_MEMBER"); }}
                className="stat-card p-4 animate-scale-in stagger-2 cursor-pointer hover:border-rose-200 group transition-all bg-white border border-slate-100 rounded-2xl flex flex-col justify-between"
              >
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-rose-600 transition-colors">Less-Active roles</div>
                <div className="grow mt-3 flex items-end gap-1.5">
                  <div className="text-2xl font-black text-slate-800">{(analyticsData.statusStats || {})["LESS-ACTIVE"] || 0}</div>
                  <div className="mb-0.5 text-[10px] font-extrabold text-rose-500">
                    {Math.round((((analyticsData.statusStats || {})["LESS-ACTIVE"] || 0) / (analyticsData.totalAssignments || 1)) * 100)}%
                  </div>
                </div>
                <div className="mt-2 text-[10px] font-bold text-rose-600 bg-rose-50 w-fit px-1.5 py-0.5 rounded">
                  Inclusion rate
                </div>
              </div>

              <div 
                onClick={() => { setTab("directory"); setFilterMode("DOUBLE_DIPPED"); }}
                className="stat-card p-4 animate-scale-in stagger-3 cursor-pointer hover:border-blue-200 group transition-all bg-white border border-slate-100 rounded-2xl flex flex-col justify-between"
              >
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-blue-600 transition-colors">Double-Dip Load</div>
                <div className="mt-3 text-2xl font-black text-blue-600">
                  {analyticsData.members.filter(m => m.isDoubleDipped).length}
                  <span className="text-xs font-normal text-slate-400 ml-1">members</span>
                </div>
                <div className="mt-2 text-[10px] font-bold text-blue-600 bg-blue-50 w-fit px-1.5 py-0.5 rounded">
                  Same-day conflicts
                </div>
              </div>

              <div 
                className="stat-card p-4 animate-scale-in stagger-4 cursor-pointer hover:border-sky-200 group transition-all bg-white border border-slate-100 rounded-2xl flex flex-col justify-between"
              >
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-sky-600 transition-colors">Reliability Index</div>
                <div className="mt-3 text-2xl font-black text-sky-500">
                  {analyticsData.reliabilityIndex}%
                </div>
                <div className="mt-2 text-[10px] font-bold text-sky-600 bg-sky-50 w-fit px-1.5 py-0.5 rounded">
                  Checklist completion
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Speaker Frequency & Load Dashboard */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div>
                    <CardTitle>Member Assignment Load ({analyticsData.currentYear})</CardTitle>
                    <p className="text-xs text-slate-500 mt-0.5">Year-to-date tracking of member participation from Jan 1st to Dec 31st.</p>
                  </div>
                  <Badge tone="blue">Analysis of {analyticsData.members.length} Members</Badge>
                </CardHeader>
                <CardBody className="p-0">
                  <div className="max-h-[400px] overflow-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm border-b">
                        <tr>
                          <th className="p-4 font-bold text-slate-600">Member</th>
                          <th className="p-4 font-bold text-slate-600 text-center">Done</th>
                          <th className="p-4 font-bold text-slate-600 text-center">Doing</th>
                          <th className="p-4 font-bold text-slate-600 text-center">Will Do</th>
                          <th className="p-4 font-bold text-slate-600 text-center">Total</th>
                          <th className="p-4 font-bold text-slate-600 text-right">Last Assigned</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {analyticsData.members.map((m) => (
                          <tr key={m.member_id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="p-4">
                              <div 
                                onClick={() => { setTab("directory"); setQ(m.name); }}
                                className="font-semibold text-slate-850 truncate max-w-[150px] cursor-pointer hover:text-blue-600 hover:underline transition-colors"
                              >
                                {m.name}
                              </div>
                              <div className="flex gap-1.5 mt-0.5 items-center">
                                <Badge tone={m.status === "ACTIVE" ? "green" : "rose"} className="text-[7px] px-1 py-0">{m.status || "Unknown"}</Badge>
                                {m.isDoubleDipped && <Badge tone="amber" className="text-[7px] px-1 py-0">Double-Dipped</Badge>}
                              </div>
                            </td>
                            <td className="p-4 text-center font-bold text-slate-700">{m.yearlyDone}</td>
                            <td className="p-4 text-center font-bold text-amber-600">{m.yearlyDoing}</td>
                            <td className="p-4 text-center font-bold text-indigo-600">{m.yearlyWillDo}</td>
                            <td className="p-4 text-center font-black text-slate-800">{m.yearlyTotal}</td>
                            <td className="p-4 text-right">
                              <div className={cn("text-xs font-bold", m.monthsSinceLast > 6 ? "text-rose-500" : "text-slate-450")}>
                                {m.yearlyLastDate || "Never"}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              </Card>

              {/* Smart Role Recommendations */}
              <Card className="bg-gradient-to-br from-white to-indigo-50/20 border-indigo-100 shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-indigo-900">
                        <span>💡</span> Smart Role Recommendations
                      </CardTitle>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">
                        Top active candidates based on assignment history and readiness
                      </p>
                    </div>
                    <Select
                      value={recRole}
                      onChange={(e) => setRecRole(e.target.value)}
                      className="w-full sm:w-48 text-xs font-bold border-indigo-200 bg-white text-indigo-700 focus:ring-indigo-500"
                    >
                      <option value="speaker">🎙️ Speaker</option>
                      <option value="invocation">🙏 Invocation Prayer</option>
                      <option value="benediction">🙏 Benediction Prayer</option>
                      <option value="director">🎵 Music Director</option>
                      <option value="accompanist">🎹 Organist/Accompanist</option>
                      <option value="preparing">🍞 Sacrament: Preparing</option>
                      <option value="blessing">🍷 Sacrament: Blessing</option>
                      <option value="passing">⛪ Sacrament: Passing</option>
                    </Select>
                  </div>
                </CardHeader>
                <CardBody>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(() => {
                      const pred = analyticsData.predictions.find(p => p.role === recRole);
                      const candidates = pred ? pred.candidates : [];
                      
                      if (candidates.length === 0) {
                        return (
                          <div className="col-span-2 py-8 text-center text-slate-400 text-xs italic">
                            No candidates found for this role. Ensure members are ACTIVE and have gender/age settings configured.
                          </div>
                        );
                      }
                      
                      return candidates.map((c, idx) => {
                        return (
                          <div 
                            key={c.member_id || `rec-${idx}`} 
                            onClick={() => { setTab("directory"); setQ(c.name); }}
                            className="p-3.5 rounded-xl bg-white border border-indigo-50 shadow-sm flex items-center justify-between group hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer"
                          >
                            <div className="min-w-0 flex-1 pr-3">
                              <div className="text-xs font-black text-slate-800 truncate group-hover:text-indigo-600 transition-colors flex items-center gap-1.5">
                                {c.name}
                                <span className="text-[9px] font-normal text-slate-400">({c.totalForRole}x)</span>
                              </div>
                              <div className="text-[10px] text-slate-400 font-bold mt-1">
                                {c.daysSinceLast === 9999 ? "Never filled this role" : (
                                  c.daysSinceLast >= 30 
                                    ? `${Math.floor(c.daysSinceLast / 30)}m since last time` 
                                    : `${c.daysSinceLast}d since last time`
                                )}
                              </div>
                              {c.overdueDays > 0 && (
                                <span className="inline-block text-[8px] font-extrabold text-emerald-600 uppercase tracking-wide bg-emerald-50 px-1.5 py-0.5 rounded mt-1.5">
                                  {c.overdueDays} days overdue
                                </span>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              <Badge 
                                tone={c.confidence === "High" ? "green" : c.confidence === "Medium" ? "amber" : "gray"}
                                className="text-[8px] font-extrabold px-1.5 py-0.5"
                              >
                                {c.confidence} fit
                              </Badge>
                              <span className="text-[8px] font-bold text-slate-400">Avg int: {c.avgInterval}d</span>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </CardBody>
              </Card>

              {/* Advanced Tracking Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Youth Milestone Tracker */}
                <Card onClick={() => { setTab("directory"); setFilterMode("YOUTH"); }} className="cursor-pointer hover:border-blue-200 hover:shadow-md transition-all">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                       <span>👦</span> Youth Milestone Tracker (12-18)
                    </CardTitle>
                  </CardHeader>
                  <CardBody>
                    <div className="space-y-4">
                      {analyticsData.members.filter(m => m.age && m.age >= 12 && m.age <= 18).slice(0, 5).map((m, idx) => (
                        <div 
                          key={m.member_id || `y-${idx}`} 
                          onClick={(e) => { e.stopPropagation(); setTab("directory"); setQ(m.name); }}
                          className="space-y-2 hover:bg-slate-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                        >
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-700">{m.name} ({m.age})</span>
                            <div className="flex gap-1">
                              <Badge tone="blue" className="text-[8px]">P: {m.sacrament.passing}</Badge>
                              <Badge tone="blue" className="text-[8px]">B: {m.sacrament.blessing}</Badge>
                              <Badge tone="gray" className="text-[8px]">Pr: {m.sacrament.preparing}</Badge>
                            </div>
                          </div>
                          <div className="h-1.5 w-full bg-slate-100 rounded-full flex overflow-hidden">
                            <div className="h-full bg-blue-400" title="Passing" style={{ width: `${(m.sacrament.passing/10)*100}%` }} />
                            <div className="h-full bg-indigo-500" title="Blessing" style={{ width: `${(m.sacrament.blessing/10)*100}%` }} />
                            <div className="h-full bg-purple-600" title="Preparing" style={{ width: `${(m.sacrament.preparing/10)*100}%` }} />
                          </div>
                        </div>
                      ))}
                      {analyticsData.members.filter(m => m.age && m.age >= 12 && m.age <= 18).length === 0 && (
                         <p className="text-center text-slate-400 text-xs py-4 italic">No youth records found.</p>
                      )}
                    </div>
                  </CardBody>
                </Card>

                {/* Music Volunteer Load */}
                <Card onClick={() => { setTab("directory"); setFilterMode("MUSIC"); }} className="cursor-pointer hover:border-indigo-200 hover:shadow-md transition-all">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                       <span>🎵</span> Music Volunteer Load
                    </CardTitle>
                  </CardHeader>
                  <CardBody>
                    <div className="space-y-4">
                       {analyticsData.members.filter(m => m.music.director > 0 || m.music.accompanist > 0).map((m, idx) => (
                          <div 
                            key={m.member_id || `mu-${idx}`} 
                            onClick={(e) => { e.stopPropagation(); setTab("directory"); setQ(m.name); }}
                            className="flex items-center justify-between hover:bg-slate-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                          >
                             <div className="min-w-0">
                                <div className="text-xs font-bold text-slate-800 truncate">{m.name}</div>
                                <div className="text-[10px] text-slate-400 uppercase font-bold">
                                  {m.music.director}x Director • {m.music.accompanist}x Accompanist
                                </div>
                             </div>
                             <div className="flex gap-1 items-center">
                                <div className="h-2 w-2 rounded-full bg-blue-500" style={{ opacity: Math.min(1, (m.music.director+m.music.accompanist)/5) }} />
                                <span className="text-xs font-black text-slate-600">{m.music.director + m.music.accompanist}</span>
                             </div>
                          </div>
                       ))}
                       {analyticsData.members.filter(m => m.music.director > 0 || m.music.accompanist > 0).length === 0 && (
                          <p className="text-center text-slate-400 text-xs py-4 italic">No music assignments recorded.</p>
                       )}
                    </div>
                  </CardBody>
                </Card>
              </div>

              {/* Organisation Balance */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Organisation Saturation & Idle Count</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <div className="space-y-4">
                      {Object.entries(analyticsData.orgMetrics).sort((a, b) => b[1].total - a[1].total).map(([org, metrics]) => {
                        const pct = Math.round((metrics.total / (analyticsData.totalAssignments || 1)) * 100);
                        return (
                          <div 
                            key={org} 
                            onClick={() => { setTab("directory"); setFilterMode("ORG_" + org); }}
                            className="space-y-1.5 hover:bg-slate-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                          >
                            <div className="flex justify-between text-[10px] font-bold">
                              <span className="text-slate-700 truncate mr-2">{org}</span>
                              <span className="text-slate-500 shrink-0">{metrics.total} assigns • {metrics.idleCount} IDLE</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Family/Surname Saturation</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <div className="space-y-4">
                      {analyticsData.surnameStats.slice(0, 6).map(([surname, count]) => {
                        const pct = Math.round((count / (analyticsData.totalAssignments || 1)) * 100);
                        return (
                          <div 
                            key={surname} 
                            onClick={() => { setTab("directory"); setFilterMode("SURNAME_" + surname); }}
                            className="space-y-1.5 hover:bg-slate-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                          >
                            <div className="flex justify-between text-[10px] font-bold">
                              <span className="text-slate-700">{surname} Family</span>
                              <span className="text-slate-500">{count} roles ({pct}%)</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.min(pct * 5, 100)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardBody>
                </Card>
              </div>
            </div>

            {/* Side Column: Alerts, Topics, Hymns */}
              {/* Topic Staleness Alert */}
              {analyticsData.staleTopics.length > 0 && (
                <Card className="border-amber-100 bg-amber-50/30">
                  <CardHeader>
                    <CardTitle className="text-amber-800 text-sm flex items-center gap-2">
                       <span>🕒</span> Topic Staleness Alerts
                    </CardTitle>
                  </CardHeader>
                  <CardBody className="py-2">
                    <div className="flex flex-wrap gap-2">
                      {analyticsData.staleTopics.map((topic: string) => (
                        <Badge key={topic} tone="amber" className="capitalize">{topic}</Badge>
                      ))}
                    </div>
                    <p className="text-[10px] text-amber-600 mt-2 font-bold italic underline">Used 3+ times in last 2 months</p>
                  </CardBody>
                </Card>
              )}

              {/* Newcomer Spotlight */}
              <Card onClick={() => { setTab("directory"); setFilterMode("NEWCOMER_NO_ROLE"); }} className="border-blue-100 bg-blue-50/20 cursor-pointer hover:border-blue-300 hover:shadow-md transition-all">
                <CardHeader>
                  <CardTitle className="text-blue-900 flex items-center gap-2">
                    <span>✨</span> Newcomer Spotlight
                  </CardTitle>
                </CardHeader>
                <CardBody className="p-0">
                  <div className="divide-y divide-blue-100">
                    {analyticsData.members
                      .filter(m => m.isNewcomer && m.total === 0)
                      .slice(0, 5)
                      .map((m, idx) => (
                        <div 
                          key={m.member_id || `new-${idx}`} 
                          onClick={(e) => { e.stopPropagation(); setTab("directory"); setQ(m.name); }}
                          className="p-3 flex items-center justify-between hover:bg-blue-100/30 transition-colors cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-blue-900 truncate">{m.name}</div>
                            <div className="text-[10px] text-blue-600 uppercase font-bold tracking-tight">Joined recently • No roles yet</div>
                          </div>
                          <Badge tone="blue" className="shrink-0">Spotlight</Badge>
                        </div>
                      ))}
                    {analyticsData.members.filter(m => m.isNewcomer && m.total === 0).length === 0 && (
                      <div className="p-6 text-center text-slate-500 text-xs italic">No new members needing intro.</div>
                    )}
                  </div>
                </CardBody>
              </Card>
 
               {/* Inactive Members Alert */}
               {analyticsData.inactiveMembers.length > 0 && (
                <Card onClick={() => { setTab("directory"); setFilterMode("INACTIVE_6M"); }} className="border-rose-100 bg-rose-50/30 cursor-pointer hover:border-rose-300 hover:shadow-md transition-all">
                  <CardHeader>
                    <CardTitle className="text-rose-800 text-sm flex items-center gap-2">
                       <span>⏳</span> Inactive Members Alert
                    </CardTitle>
                  </CardHeader>
                  <CardBody className="p-0">
                    <div className="divide-y divide-rose-50">
                      {analyticsData.inactiveMembers.map((m) => (
                        <div
                          key={m.member_id}
                          className="p-3 flex items-center justify-between hover:bg-rose-50 transition-colors cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); setTab("directory"); setQ(m.name); }}
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-rose-900 truncate">{m.name}</div>
                            <div className="text-[10px] text-rose-500 uppercase font-bold tracking-tight">
                              {m.monthsSinceLast === 99 ? "Never assigned" : `${m.monthsSinceLast} months since last role`}
                            </div>
                          </div>
                          <Badge tone="rose" className="shrink-0 ml-2">Follow up</Badge>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-rose-500 px-3 pb-2 font-bold italic">Active members with no assignments in 6+ months. Click to find in directory.</p>
                  </CardBody>
                </Card>
               )}
 
              {/* Double-Dip Alerts */}
              <Card onClick={() => { setTab("directory"); setFilterMode("DOUBLE_DIPPED"); }} className="border-rose-100 bg-rose-50/20 cursor-pointer hover:border-rose-300 hover:shadow-md transition-all">
                <CardHeader>
                  <CardTitle className="text-rose-900 flex items-center gap-2">
                    <span>⚠️</span> Multi-Organisation "Double-Dip"
                  </CardTitle>
                </CardHeader>
                <CardBody className="p-0">
                  <div className="divide-y divide-rose-100">
                    {analyticsData.members
                      .filter(m => m.isDoubleDipped)
                      .slice(0, 5)
                      .map((m, idx) => (
                        <div 
                          key={m.member_id || `dd-${idx}`} 
                          onClick={(e) => { e.stopPropagation(); setTab("directory"); setQ(m.name); }}
                          className="p-3 flex items-center justify-between hover:bg-rose-100/30 transition-colors cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-rose-900 truncate">{m.name}</div>
                            <div className="text-[10px] text-rose-600 uppercase font-bold tracking-tight">Assigned in {m.orgs.length} orgs same month</div>
                          </div>
                          <Badge tone="rose" className="shrink-0">Overload</Badge>
                        </div>
                      ))}
                    {analyticsData.members.filter(m => m.isDoubleDipped).length === 0 && (
                      <div className="p-6 text-center text-slate-500 text-xs italic">No overload detected.</div>
                    )}
                  </div>
                </CardBody>
              </Card>
          </div>
        </div>
      )}

      <Modal
        open={open}
        title={editing?.name ? `Edit Member` : "Add Member"}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button
              onClick={() => {
                if (!editing) return;
                if (!editing.name.trim()) return;
                const cleanName = editing.name.trim();
                save({
                  ...editing,
                  member_id: cleanName,
                  name: cleanName,
                  organisation: editing.organisation?.trim() || undefined,
                  phone: editing.phone?.trim() || undefined,
                  status: editing.status?.trim() || undefined,
                  email: editing.email?.trim() || undefined,
                  notes: editing.notes?.trim() || undefined,
                  age: editing.age ? Number(editing.age) : undefined,
                }, editing.member_id || editing.name);
                setOpen(false);
              }}
            >
              Save
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label>Name</Label>
              <Input value={editing.name} onChange={(e) => setEditing((m) => (m ? { ...m, name: e.target.value } : m))} />
            </div>
            <div className="space-y-1">
              <Label>Age</Label>
              <Input
                type="number"
                value={editing.age ?? ""}
                onChange={(e) => setEditing((m) => (m ? { ...m, age: e.target.value ? Number(e.target.value) : undefined } : m))}
              />
            </div>
            <div className="space-y-1">
              <Label>Gender</Label>
              <Input value={editing.gender ?? ""} onChange={(e) => setEditing((m) => (m ? { ...m, gender: e.target.value } : m))} />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={editing.phone ?? ""} onChange={(e) => setEditing((m) => (m ? { ...m, phone: e.target.value } : m))} />
            </div>
            <div className="space-y-1">
              <Label>Organisation</Label>
              <Input value={editing.organisation ?? ""} onChange={(e) => setEditing((m) => (m ? { ...m, organisation: e.target.value } : m))} placeholder="Elders Quorum, Relief Society…" />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Input value={editing.status ?? ""} onChange={(e) => setEditing((m) => (m ? { ...m, status: e.target.value } : m))} placeholder="Active, New Move-in…" />
            </div>
            <div className="space-y-1">
              <Label>Email (optional)</Label>
              <Input value={editing.email ?? ""} onChange={(e) => setEditing((m) => (m ? { ...m, email: e.target.value } : m))} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Notes</Label>
              <Textarea rows={4} value={editing.notes ?? ""} onChange={(e) => setEditing((m) => (m ? { ...m, notes: e.target.value } : m))} />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
