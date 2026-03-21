import { useMemo } from "react";
import type { UnitSettings, User } from "../types";
import { Button, EmptyState } from "../components/ui";
import { formatDateShort, nextSundaysInMonth, yyyyMmToLabel } from "../utils/date";
import { getDB } from "../utils/storage";
import { cn } from "../utils/cn";
import { formatUserDisplayName } from "../utils/format";

const QUOTES = [
  { ref: "Moroni 10:32", text: "Come unto Christ, and be perfected in him." },
  { ref: "Mosiah 2:17", text: "When ye are in the service of your fellow beings ye are only in the service of your God." },
  { ref: "D&C 18:10", text: "The worth of souls is great in the sight of God." },
  { ref: "3 Nephi 18:32", text: "Nevertheless, ye shall not cast him out of your synagogues, or your places of worship." },
  { ref: "Alma 37:37", text: "Counsel with the Lord in all thy doings, and he will direct thee for good." },
  { ref: "2 Nephi 31:20", text: "Press forward with a steadfastness in Christ, having a perfect brightness of hope." },
];

function pickQuote(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return QUOTES[h % QUOTES.length];
}

function getGreeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** SVG donut-progress ring */
function ProgressRing({ pct, size = 80 }: { pct: number; size?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <defs>
        <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0096c7" />
          <stop offset="100%" stopColor="#00c6fb" />
        </linearGradient>
      </defs>
      <circle
        className="progress-ring-track"
        cx={size / 2}
        cy={size / 2}
        r={r}
      />
      <circle
        className="progress-ring-fill"
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeDasharray={circ}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

export function DashboardPage({
  user,
  unit,
  onNavigate,
}: {
  user: User;
  unit: UnitSettings;
  onNavigate: (route: "planner" | "assignments" | "checklist" | "members" | "settings") => void;
}) {
  const db = getDB();
  const now = new Date();
  const hour = now.getHours();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const quote = useMemo(
    () => pickQuote(`${user.user_id}.${now.toISOString().slice(0, 10)}`),
    [user.user_id]
  );

  const currentMonthSundays = nextSundaysInMonth(month, year);
  const plannersThisMonth = db.PLANNERS.filter((p) => p.month === month && p.year === year);
  const submittedThisMonth = plannersThisMonth.filter((p) => p.state === "SUBMITTED");
  const latestSubmitted = submittedThisMonth.sort(
    (a, b) => b.updated_date.localeCompare(a.updated_date)
  )[0];

  const speakerCount = useMemo(() => {
    if (!latestSubmitted) return 0;
    return latestSubmitted.weeks.reduce(
      (acc, w) => acc + (w.speakers || []).filter((s) => s.name.trim()).length,
      0
    );
  }, [latestSubmitted]);

  const checklistStats = useMemo(() => {
    if (!latestSubmitted) return { done: 0, total: 0, pct: 0 };
    const forPlanner = db.CHECKLISTS.filter((c) => c.planner_id === latestSubmitted.planner_id);
    const total = forPlanner.length;
    const done = forPlanner.filter((c) => c.status).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { done, total, pct };
  }, [db.CHECKLISTS, latestSubmitted]);

  const upcoming = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    return [...new Set([...currentMonthSundays])].filter((d) => d >= todayISO).slice(0, 5);
  }, [currentMonthSundays]);

  const greeting = getGreeting(hour);
  const displayName = formatUserDisplayName(user);

  return (
    <div className="space-y-6">
      {/* ── Hero banner ── */}
      <div className="dash-hero animate-fade-in-up">
        <div className="relative z-10">
          <div className="text-xs font-bold uppercase tracking-widest text-white/60">
            {yyyyMmToLabel(month, year)} · {unit.unit_name}
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white sm:text-4xl">
            {greeting}, {displayName}
          </h1>
          <p className="mt-2 text-sm text-white/80 max-w-md">
            {user.role === "MUSIC" 
              ? "Your music coordination dashboard. Manage hymns and musical assignments for upcoming meetings."
              : "Your sacrament meeting coordinator dashboard. Everything you need for this month's planning is right here."}
          </p>

          {/* Summary pill row */}
          <div className="mt-4 flex flex-wrap gap-3">
            <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
              <span>📅</span>
              <span>{upcoming.length} upcoming Sunday{upcoming.length !== 1 ? "s" : ""}</span>
            </div>
            {user.role !== "MUSIC" && (
              <>
                <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
                  <span>🎙️</span>
                  <span>{speakerCount} speaker{speakerCount !== 1 ? "s" : ""} assigned</span>
                </div>
                <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
                  <span>✅</span>
                  <span>{checklistStats.pct}% checklist done</span>
                </div>
              </>
            )}
            {user.role === "MUSIC" && (
              <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
                <span>🎵</span>
                <span>{latestSubmitted?.music_status === "COMPLETE" ? "Music items finalized" : "Music input needed"}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Upcoming Sundays */}
        <div className="stat-card animate-fade-in-up stagger-1">
          <div className="stat-card-bar bar-blue" />
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Upcoming Sundays
              </div>
              <div className="stat-icon stat-icon-blue">📅</div>
            </div>
            <div className="mt-3 space-y-2">
              {upcoming.length === 0 ? (
                <div className="text-sm text-slate-400">No more Sundays this month.</div>
              ) : (
                upcoming.slice(0, 3).map((d, idx) => (
                  <div key={d} className={`sunday-chip stagger-${idx + 1}`}>
                    <span className="text-sm font-semibold text-slate-700">{formatDateShort(d)}</span>
                    <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">
                      Sunday
                    </span>
                  </div>
                ))
              )}
              {upcoming.length > 3 && (
                <div className="text-center text-xs font-medium text-slate-400">
                  +{upcoming.length - 3} more
                </div>
              )}
            </div>
            <div className="mt-4">
              <Button variant="primary" className="w-full" onClick={() => onNavigate("planner")}>
                Open Planner →
              </Button>
            </div>
          </div>
        </div>

        {/* Speakers / Assignments */}
        <div className="stat-card animate-fade-in-up stagger-2">
          <div className="stat-card-bar bar-violet" />
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Assignments
              </div>
              <div className="stat-icon stat-icon-violet">🎙️</div>
            </div>
            <div className="mt-4 flex items-end gap-2">
              <div className="animate-count-up text-5xl font-extrabold tracking-tight text-slate-800">
                {speakerCount}
              </div>
              <div className="mb-1.5 text-sm text-slate-500">speaker{speakerCount !== 1 ? "s" : ""}</div>
            </div>
            <div className="mt-1 text-xs text-slate-400">
              From the latest submitted plan
            </div>
            <div
              className="mt-3 h-1.5 rounded-full"
              style={{ background: "rgba(0,0,0,0.06)" }}
            >
              <div
                className="h-1.5 rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(speakerCount * 10, 100)}%`,
                  background: "linear-gradient(90deg, #7c3aed, #a78bfa)",
                }}
              />
            </div>
            <div className="mt-4">
              <Button variant="secondary" className="w-full" onClick={() => onNavigate("assignments")}>
                Generate Notifications
              </Button>
            </div>
          </div>
        </div>

        {/* Readiness */}
        <div className="stat-card animate-fade-in-up stagger-3">
          <div className="stat-card-bar bar-green" />
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Readiness
              </div>
              <div className="stat-icon stat-icon-green">✅</div>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <div className="relative shrink-0">
                <ProgressRing pct={checklistStats.pct} size={80} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-extrabold text-slate-800">{checklistStats.pct}%</span>
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-2xl font-bold text-slate-800">
                  {checklistStats.done}
                  <span className="text-base font-normal text-slate-400">
                    /{checklistStats.total}
                  </span>
                </div>
                <div className="text-xs text-slate-400">tasks completed</div>
                <div className="mt-2 text-xs font-medium text-emerald-600">
                  {checklistStats.pct >= 100
                    ? "🎉 All done!"
                    : checklistStats.pct >= 50
                    ? "Making progress!"
                    : "Getting started…"}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <Button variant="secondary" className="w-full" onClick={() => onNavigate("checklist")}>
                Open Checklist
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div className="animate-fade-in-up stagger-4">
        <div className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">
          Quick Actions
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {[
            { icon: "📅", label: "New Plan", color: "#e0f2fe", route: "planner" as const, roles: ["ADMIN", "BISHOPRIC", "CLERK", "SECRETARY"] },
            { icon: "👥", label: "Members", color: "#ede9fe", route: "members" as const, roles: ["ADMIN", "BISHOPRIC", "CLERK"] },
            { icon: "✅", label: "Checklist", color: "#dcfce7", route: "checklist" as const, roles: ["ADMIN", "BISHOPRIC", "CLERK", "SECRETARY"] },
            { icon: "🎵", label: "Music", color: "#fdf4ff", route: "music" as const, roles: ["ADMIN", "MUSIC"] },
            { icon: "✉️", label: "Notify", color: "#fef9c3", route: "assignments" as const, roles: ["ADMIN", "BISHOPRIC", "CLERK", "SECRETARY"] },
          ]
            .filter(qa => !qa.roles || qa.roles.includes(user.role))
            .map((qa) => (
            <button
              key={qa.route}
              className="quick-action-btn"
              onClick={() => onNavigate(qa.route as any)}
              style={{ minWidth: "80px" }}
            >
              <div className="qa-icon" style={{ background: qa.color }}>
                {qa.icon}
              </div>
              <span className="text-xs font-semibold text-slate-600">{qa.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Spiritual Thought ── */}
      <div className="quote-card animate-fade-in-up stagger-5 shadow-sm hover:shadow-md transition-shadow">
        <div className="relative z-10">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-widest text-blue-600/80">
              ✦ Spiritual Thought
            </div>
            <div className="h-2 w-2 rounded-full bg-blue-400/30" />
          </div>
          <blockquote className="text-lg font-medium leading-relaxed text-slate-700 italic">
            "{quote.text}"
          </blockquote>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-blue-100 to-transparent" />
            <cite className="text-sm font-bold not-italic text-blue-600">
              {quote.ref}
            </cite>
          </div>
        </div>
      </div>

      {/* ── Recent Activity ── */}
      <div className="animate-fade-in-up stagger-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Recent Activity
          </div>
        </div>
        <div className="space-y-3">
          {db.PLANNERS.slice(0, 3).map((p) => (
            <div key={p.planner_id} className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-all hover:scale-[1.01] hover:shadow-md">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <span className="text-lg font-bold">{p.month}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-slate-800">
                  {yyyyMmToLabel(p.month, p.year)} Plan
                </div>
                <div className="text-xs text-slate-500">
                  Status: <span className={cn("font-semibold", p.state === "SUBMITTED" ? "text-emerald-600" : "text-amber-600")}>{p.state}</span> · Updated {formatDateShort(p.updated_date)}
                </div>
              </div>
              <Button variant="ghost" onClick={() => onNavigate("planner")}>
                View
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Empty state if no submitted plans ── */}
      {!latestSubmitted && (
        <EmptyState
          title="No submitted plans yet"
          body="Create a planner and submit it to unlock assignments and readiness workflows."
          action={<Button onClick={() => onNavigate("planner")}>Go to Planner →</Button>}
        />
      )}
    </div>
  );
}
