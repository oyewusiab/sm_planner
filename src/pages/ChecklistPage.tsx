import { useEffect, useMemo, useState } from "react";
import type { ChecklistTask, Planner, UnitSettings, User } from "../types";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Divider, EmptyState, Label, SectionTitle, Select } from "../components/ui";
import { Modal } from "../components/Modal";
import { formatDateShort, formatTime12h, monthName } from "../utils/date";
import { getDB, ids, time, updateDB } from "../utils/storage";
import { MemberAutocomplete } from "../components/MemberAutocomplete";

const DEFAULT_TASKS = [
  "Podium prepared",
  "Sacrament table prepared",
  "Hymn numbers displayed",
  "Microphones tested",
  "Speakers confirmed",
  "Sacrament bread ready",
  "Water cups ready",
  "Presiding confirmed",
];

function seedChecklist(planner: Planner, week_id: string, week_label: string, updated_by: string) {
  updateDB((db0) => {
    const existing = db0.CHECKLISTS.filter((c) => c.planner_id === planner.planner_id && c.week_id === week_id);
    if (existing.length > 0) return db0;
    const created: ChecklistTask[] = DEFAULT_TASKS.map((task) => ({
      checklist_id: ids.uid("chk"),
      planner_id: planner.planner_id,
      week_id,
      week_label,
      task,
      responsible: "",
      status: false,
      updated_by,
      updated_date: time.nowISO(),
    }));
    return { ...db0, CHECKLISTS: [...created, ...db0.CHECKLISTS] };
  });
}

export function ChecklistPage({
  user,
  unit,
  onChanged,
}: {
  user: User;
  unit: UnitSettings;
  onChanged: () => void;
}) {
  const enabled = unit.prefs?.enable_checklist !== false;
  const db = getDB();
  const members = db.MEMBERS;

  const planners = useMemo(
    () => [...db.PLANNERS].filter((p) => p.state !== "ARCHIVED").sort((a, b) => b.updated_date.localeCompare(a.updated_date)),
    [db.PLANNERS]
  );

  // Detect the next upcoming Sunday
  const today = new Date().toISOString().split("T")[0];

  const [viewMode, setViewMode] = useState<"week" | "aggregate">("week");

  const [plannerId, setPlannerId] = useState(() => {
    const next = planners.find(p => p.weeks.some(w => w.date >= today));
    return next?.planner_id || planners[0]?.planner_id || "";
  });
  const planner = planners.find((p) => p.planner_id === plannerId) || null;

  const weekOptions = useMemo(() => {
    if (!planner) return [];
    return planner.weeks.map((w, idx) => ({
      week_id: w.week_id,
      label: `Week ${idx + 1} — ${formatDateShort(w.date)}`,
      date: w.date,
    }));
  }, [planner]);

  const [weekId, setWeekId] = useState(() => {
    if (!planner) return "";
    const nextWeek = planner.weeks.find(w => w.date >= today);
    return nextWeek?.week_id || planner.weeks[0]?.week_id || "";
  });

  // When planner changes, jump to nearest upcoming week
  useEffect(() => {
    if (!planner) return;
    const nextWeek = planner.weeks.find(w => w.date >= today);
    setWeekId(nextWeek?.week_id || planner.weeks[0]?.week_id || "");
  }, [plannerId]);

  const selectedWeek = planner?.weeks.find(w => w.week_id === weekId) || null;
  const weekLabel = weekOptions.find((w) => w.week_id === weekId)?.label || "";

  // Next Sunday detection across all planners
  const nextSundayInfo = useMemo(() => {
    for (const p of planners) {
      const nextW = p.weeks.find(w => w.date >= today);
      if (nextW) return { planner: p, week: nextW };
    }
    return null;
  }, [planners, today]);

  useEffect(() => {
    if (!planner || !weekId) return;
    seedChecklist(planner, weekId, weekLabel, user.user_id);
    onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannerId, weekId]);

  const tasks = useMemo(() => {
    if (!planner || !weekId) return [];
    return db.CHECKLISTS
      .filter((c) => c.planner_id === planner.planner_id && c.week_id === weekId)
      .sort((a, b) => a.task.localeCompare(b.task));
  }, [db.CHECKLISTS, planner, weekId]);

  // Aggregate: completion per week across selected planner
  const aggregateData = useMemo(() => {
    if (!planner) return [];
    return planner.weeks.map((w, idx) => {
      const wTasks = db.CHECKLISTS.filter(c => c.planner_id === planner.planner_id && c.week_id === w.week_id);
      const done = wTasks.filter(t => t.status).length;
      const total = wTasks.length;
      const pct = total > 0 ? Math.round((done / total) * 100) : null;
      const isNext = w.date >= today;
      return { idx, week: w, done, total, pct, isNext };
    });
  }, [planner, db.CHECKLISTS, today]);

  const [printOpen, setPrintOpen] = useState(false);

  const completion = tasks.length ? Math.round((tasks.filter((t) => t.status).length / tasks.length) * 100) : 0;

  if (!enabled) {
    return <EmptyState title="Checklist disabled" body="An Admin has disabled the readiness checklist in Settings." />;
  }

  if (planners.length === 0) {
    return <EmptyState title="No planners" body="Create a planner to start weekly readiness tracking." />;
  }

  function updateTask(checklist_id: string, patch: Partial<ChecklistTask>) {
    updateDB((db0) => {
      const CHECKLISTS = db0.CHECKLISTS.map((c) =>
        c.checklist_id === checklist_id
          ? { ...c, ...patch, updated_by: user.user_id, updated_date: time.nowISO() }
          : c
      );
      return { ...db0, CHECKLISTS };
    });
    onChanged();
  }

  function resetWeek() {
    if (!planner || !weekId) return;
    updateDB((db0) => {
      const CHECKLISTS = db0.CHECKLISTS.map((c) =>
        c.planner_id === planner.planner_id && c.week_id === weekId
          ? { ...c, status: false, updated_by: user.user_id, updated_date: time.nowISO() }
          : c
      );
      return { ...db0, CHECKLISTS };
    });
    onChanged();
  }

  return (
    <div className="space-y-6">
      <SectionTitle title="Sacrament Meeting Readiness Checklist" subtitle="Track preparation tasks for upcoming and past meetings." />

      {/* Next Sunday Banner */}
      {nextSundayInfo && (
        <div className="rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-500 p-4 flex items-center justify-between shadow-lg">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-indigo-200">Next Meeting — Focus</div>
            <div className="text-white font-black text-lg mt-0.5">{formatDateShort(nextSundayInfo.week.date)}</div>
            <div className="text-indigo-200 text-xs">{unit.venue} · {formatTime12h(unit.meeting_time)}</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setPlannerId(nextSundayInfo.planner.planner_id);
                setWeekId(nextSundayInfo.week.week_id);
                setViewMode("week");
              }}
              className="bg-white/20 hover:bg-white/30 text-white text-xs font-bold px-4 py-2 rounded-xl transition border border-white/20"
            >
              Prepare Now →
            </button>
          </div>
        </div>
      )}

      {/* View Mode Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        <button
          onClick={() => setViewMode("week")}
          className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${viewMode === "week" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          📋 Weekly View
        </button>
        <button
          onClick={() => setViewMode("aggregate")}
          className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${viewMode === "aggregate" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          📊 Aggregate Stats
        </button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Meeting</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1 md:col-span-2">
              <Label>Planner</Label>
              <Select
                value={plannerId}
                onChange={(e) => {
                  setPlannerId(e.target.value);
                }}
              >
                {planners.map((p) => (
                  <option key={p.planner_id} value={p.planner_id}>
                    {monthName(p.month)} {p.year} — {p.state}
                  </option>
                ))}
              </Select>
            </div>
            {viewMode === "week" && (
              <div className="space-y-1">
                <Label>Week</Label>
                <Select value={weekId} onChange={(e) => setWeekId(e.target.value)}>
                  {weekOptions.map((w) => {
                    const isPast = w.date < today;
                    const isNext = !isPast && w.date >= today;
                    return (
                      <option key={w.week_id} value={w.week_id}>
                        {isNext ? "🔔 " : isPast ? "✓ " : ""}{w.label}
                      </option>
                    );
                  })}
                </Select>
              </div>
            )}
          </div>

          {/* ─────────── AGGREGATE VIEW ─────────── */}
          {viewMode === "aggregate" && (
            <div className="space-y-4 pt-2">
              <Divider />
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">All Weeks — Completion Summary</div>
              <div className="overflow-hidden rounded-xl border border-[color:var(--border)]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="p-3 font-medium text-slate-600">Week</th>
                      <th className="p-3 font-medium text-slate-600">Date</th>
                      <th className="p-3 font-medium text-slate-600 text-center">Done / Total</th>
                      <th className="p-3 font-medium text-slate-600 text-center">Completion</th>
                      <th className="p-3 font-medium text-slate-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregateData.map(({ idx, week, done, total, pct, isNext }) => (
                      <tr
                        key={week.week_id}
                        className={`border-t border-[color:var(--border)] cursor-pointer hover:bg-slate-50/70 transition-colors ${isNext ? "bg-blue-50/40" : ""}`}
                        onClick={() => { setWeekId(week.week_id); setViewMode("week"); }}
                      >
                        <td className="p-3 font-bold text-slate-700">
                          Week {idx + 1}
                          {isNext && <Badge tone="blue" className="ml-2 text-[9px]">Upcoming</Badge>}
                        </td>
                        <td className="p-3 text-slate-600">{formatDateShort(week.date)}</td>
                        <td className="p-3 text-center font-mono text-slate-700">{total > 0 ? `${done}/${total}` : "–"}</td>
                        <td className="p-3">
                          {pct !== null ? (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 rounded-full bg-slate-200 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${pct === 100 ? "bg-emerald-500" : pct > 50 ? "bg-blue-500" : "bg-amber-500"}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-xs font-bold text-slate-600 w-8 text-right">{pct}%</span>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs italic">No tasks seeded</span>
                          )}
                        </td>
                        <td className="p-3">
                          {pct === null
                            ? <Badge tone="gray">Not started</Badge>
                            : pct === 100
                              ? <Badge tone="green">Ready ✓</Badge>
                              : pct > 0
                                ? <Badge tone="amber">In Progress</Badge>
                                : <Badge tone="rose">Pending</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-400 italic">Click any week row to switch to weekly view.</p>
            </div>
          )}

          {/* ─────────── WEEKLY VIEW ─────────── */}
          {viewMode === "week" && (
            <>
              <Divider />

              {/* Selected week info */}
              {selectedWeek && (
                <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Selected Meeting</div>
                    <div className="text-sm font-black text-slate-800 mt-0.5">{formatDateShort(selectedWeek.date)}</div>
                    {selectedWeek.conducting_officer && (
                      <div className="text-xs text-slate-500">Conducting: {selectedWeek.conducting_officer}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`text-3xl font-black ${completion === 100 ? "text-emerald-500" : completion > 50 ? "text-blue-500" : "text-amber-500"}`}>
                      {completion}%
                    </div>
                    <div className="text-xs text-slate-500 font-bold">Ready</div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" onClick={() => setPrintOpen(true)}>
                    Printable Version
                  </Button>
                  <Button variant="secondary" onClick={resetWeek}>
                    Reset week
                  </Button>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-[color:var(--border)]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="p-3 font-medium text-slate-600">Task</th>
                      <th className="p-3 font-medium text-slate-600">Responsible</th>
                      <th className="p-3 font-medium text-slate-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t) => (
                      <tr key={t.checklist_id} className={`border-t border-[color:var(--border)] transition-colors ${t.status ? "bg-emerald-50/30" : ""}`}>
                        <td className="p-3">
                          <span className={t.status ? "line-through text-slate-400" : ""}>{t.task}</span>
                        </td>
                        <td className="p-3">
                          <MemberAutocomplete
                            members={members}
                            value={t.responsible || ""}
                            onChange={(val) => updateTask(t.checklist_id, { responsible: val })}
                            onPick={(m) => updateTask(t.checklist_id, { responsible: m.name })}
                            placeholder="Name"
                          />
                        </td>
                        <td className="p-3">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={t.status}
                              onChange={(e) => updateTask(t.checklist_id, { status: e.target.checked })}
                            />
                            <span className={`text-xs ${t.status ? "text-emerald-600 font-bold" : "text-slate-600"}`}>
                              {t.status ? "Done ✓" : "Pending"}
                            </span>
                          </label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="text-xs text-slate-500">
                Auto-reset behavior: each Sunday/week is stored separately; the next week starts unchecked.
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Modal
        open={printOpen}
        title="Printable Checklist"
        onClose={() => setPrintOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => window.print()}>
              Print / Save as PDF
            </Button>
            <Button variant="ghost" onClick={() => setPrintOpen(false)}>
              Close
            </Button>
          </>
        }
        className="max-w-4xl"
      >
        <div className="space-y-4 print-reset">
          <div>
            <div className="text-lg font-semibold">{unit.unit_name} — Readiness Checklist</div>
            <div className="text-sm text-slate-600">{weekLabel} • {unit.venue} • {formatTime12h(unit.meeting_time)}</div>
          </div>
          <div className="overflow-hidden rounded-xl border border-[color:var(--border)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-3 font-medium text-slate-600">Task</th>
                  <th className="p-3 font-medium text-slate-600">Responsible</th>
                  <th className="p-3 font-medium text-slate-600">Complete</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.checklist_id} className="border-t border-[color:var(--border)]">
                    <td className="p-3">{t.task}</td>
                    <td className="p-3">{t.responsible || ""}</td>
                    <td className="p-3">{t.status ? "☑" : "☐"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
}
