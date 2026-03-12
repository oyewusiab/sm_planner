import { useMemo } from "react";
import type { UnitSettings, User } from "../types";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, SectionTitle } from "../components/ui";
import { formatDateShort, nextSundaysInMonth, yyyyMmToLabel } from "../utils/date";
import { getDB } from "../utils/storage";

const QUOTES = [
  { ref: "Moroni 10:32", text: "Come unto Christ, and be perfected in him." },
  { ref: "Mosiah 2:17", text: "When ye are in the service of your fellow beings ye are only in the service of your God." },
  { ref: "D&C 18:10", text: "The worth of souls is great in the sight of God." },
  { ref: "3 Nephi 18:32", text: "Nevertheless, ye shall not cast him out of your synagogues." },
];

function pickQuote(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return QUOTES[h % QUOTES.length];
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
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const quote = useMemo(() => pickQuote(`${user.user_id}.${new Date().toISOString().slice(0, 10)}`), [user.user_id]);

  const currentMonthSundays = nextSundaysInMonth(month, year);

  const plannersThisMonth = db.PLANNERS.filter((p) => p.month === month && p.year === year);
  const submittedThisMonth = plannersThisMonth.filter((p) => p.state === "SUBMITTED");
  const latestSubmitted = submittedThisMonth.sort((a, b) => b.updated_date.localeCompare(a.updated_date))[0];

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
    const all = [...new Set([...currentMonthSundays])].filter((d) => d >= todayISO);
    return all.slice(0, 5);
  }, [currentMonthSundays]);

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Dashboard"
        subtitle={`${unit.unit_name} • ${yyyyMmToLabel(month, year)}`}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Sundays</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {upcoming.length === 0 ? (
              <div className="text-sm text-slate-500">No upcoming Sundays in this month.</div>
            ) : (
              upcoming.map((d) => (
                <div key={d} className="flex items-center justify-between rounded-lg border border-[color:var(--border)] p-3">
                  <div className="text-sm font-medium">{formatDateShort(d)}</div>
                  <Badge tone="blue">Sunday</Badge>
                </div>
              ))
            )}
            <div className="pt-2">
              <Button variant="secondary" className="w-full" onClick={() => onNavigate("planner")}>
                Open Planner
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assignments</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="rounded-lg border border-[color:var(--border)] p-3">
              <div className="text-xs text-slate-500">Speakers assigned (latest submitted plan)</div>
              <div className="text-2xl font-semibold text-slate-900">{speakerCount}</div>
            </div>
            <Button variant="secondary" className="w-full" onClick={() => onNavigate("assignments")}>
              Generate Notifications
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Readiness</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="rounded-lg border border-[color:var(--border)] p-3">
              <div className="text-xs text-slate-500">Checklist completion</div>
              <div className="text-2xl font-semibold text-slate-900">{checklistStats.pct}%</div>
              <div className="text-xs text-slate-500">{checklistStats.done} / {checklistStats.total} tasks</div>
            </div>
            <Button variant="secondary" className="w-full" onClick={() => onNavigate("checklist")}>
              Open Checklist
            </Button>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Spiritual Thought</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="text-sm text-slate-700">“{quote.text}”</div>
          <div className="mt-2 text-xs text-slate-500">{quote.ref}</div>
        </CardBody>
      </Card>

      {latestSubmitted ? null : (
        <EmptyState
          title="No submitted plans yet"
          body="Create a planner and submit it to unlock assignments and readiness workflows."
          action={<Button onClick={() => onNavigate("planner")}>Go to Planner</Button>}
        />
      )}
    </div>
  );
}
