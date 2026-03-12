import { useEffect, useMemo, useState } from "react";
import type { ChecklistTask, Planner, UnitSettings, User } from "../types";
import { Button, Card, CardBody, CardHeader, CardTitle, Divider, EmptyState, Input, Label, SectionTitle, Select } from "../components/ui";
import { Modal } from "../components/Modal";
import { formatDateShort, monthName } from "../utils/date";
import { getDB, ids, time, updateDB } from "../utils/storage";

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

  const planners = useMemo(
    () => [...db.PLANNERS].filter((p) => p.state !== "ARCHIVED").sort((a, b) => b.updated_date.localeCompare(a.updated_date)),
    [db.PLANNERS]
  );

  const [plannerId, setPlannerId] = useState(planners[0]?.planner_id || "");
  const planner = planners.find((p) => p.planner_id === plannerId) || null;

  const weekOptions = useMemo(() => {
    if (!planner) return [];
    return planner.weeks.map((w, idx) => ({
      week_id: w.week_id,
      label: `Week ${idx + 1} — ${formatDateShort(w.date)}`,
      date: w.date,
    }));
  }, [planner]);

  const [weekId, setWeekId] = useState(weekOptions[0]?.week_id || "");

  useEffect(() => {
    if (!planner) return;
    const first = planner.weeks[0]?.week_id || "";
    setWeekId((prev) => (weekOptions.some((w) => w.week_id === prev) ? prev : first));
  }, [plannerId]);

  const weekLabel = weekOptions.find((w) => w.week_id === weekId)?.label || "";

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

  const [printOpen, setPrintOpen] = useState(false);

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

  const completion = tasks.length ? Math.round((tasks.filter((t) => t.status).length / tasks.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <SectionTitle title="Sacrament Meeting Readiness Checklist" subtitle="Mark weekly preparation tasks complete and print a clean checklist." />

      <Card>
        <CardHeader>
          <CardTitle>Choose week</CardTitle>
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
            <div className="space-y-1">
              <Label>Week</Label>
              <Select value={weekId} onChange={(e) => setWeekId(e.target.value)}>
                {weekOptions.map((w) => (
                  <option key={w.week_id} value={w.week_id}>
                    {w.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <Divider />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-slate-600">Completion: <span className="font-medium">{completion}%</span></div>
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
                  <tr key={t.checklist_id} className="border-t border-[color:var(--border)]">
                    <td className="p-3">{t.task}</td>
                    <td className="p-3">
                      <Input
                        value={t.responsible || ""}
                        onChange={(e) => updateTask(t.checklist_id, { responsible: e.target.value })}
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
                        <span className="text-xs text-slate-600">Complete</span>
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
            <div className="text-sm text-slate-600">{weekLabel} • {unit.venue} • {unit.meeting_time}</div>
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
