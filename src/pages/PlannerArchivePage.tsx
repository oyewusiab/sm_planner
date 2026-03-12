import { useEffect, useMemo, useState } from "react";
import type { Planner, UnitSettings, User } from "../types";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, SectionTitle } from "../components/ui";
import { Modal } from "../components/Modal";
import { PlannerPreviewTable } from "../components/PlannerPreviewTable";
import { monthName } from "../utils/date";
import { getDB, time, updateDB } from "../utils/storage";

function plannerLabel(p: Planner) {
  return `${monthName(p.month)} ${p.year}`;
}

export function PlannerArchivePage({
  user,
  unit,
  onChanged,
}: {
  user: User;
  unit: UnitSettings;
  onChanged: () => void;
}) {
  void user;
  void onChanged;

  const db = getDB();
  const [previewPlanner, setPreviewPlanner] = useState<Planner | null>(null);

  useEffect(() => {
    const cls = "printing-planner";
    const styleId = "planner-print-page";

    if (previewPlanner) {
      document.body.classList.add(cls);
      if (!document.getElementById(styleId)) {
        const el = document.createElement("style");
        el.id = styleId;
        el.textContent = `@media print { @page { size: A4 landscape; margin: 10mm; } }`;
        document.head.appendChild(el);
      }
    } else {
      document.body.classList.remove(cls);
      const el = document.getElementById(styleId);
      if (el) el.remove();
    }

    return () => {
      document.body.classList.remove(cls);
      const el = document.getElementById(styleId);
      if (el) el.remove();
    };
  }, [previewPlanner]);

  const archived = useMemo(
    () => [...db.PLANNERS].filter((p) => p.state === "ARCHIVED").sort((a, b) => b.updated_date.localeCompare(a.updated_date)),
    [db.PLANNERS]
  );

  function restorePlanner(planner_id: string) {
    const ok = window.confirm("Restore this planner to the Planner page?");
    if (!ok) return;
    updateDB((db0) => {
      const PLANNERS = db0.PLANNERS.map((p) =>
        p.planner_id === planner_id ? { ...p, state: "SUBMITTED" as const, updated_date: time.nowISO() } : p
      );
      return { ...db0, PLANNERS };
    });
    onChanged();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle title="Planner Archive" subtitle="Archived planners are kept here for reference and printing." />
      </div>

      {archived.length === 0 ? (
        <EmptyState title="No archived planners" body="Archive a submitted planner to move it here." />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {archived.map((p) => (
            <Card key={p.planner_id}>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>{plannerLabel(p)}</CardTitle>
                  <div className="text-xs text-slate-500">Updated {new Date(p.updated_date).toLocaleString()}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="gray">ARCHIVED</Badge>
                  <Button variant="secondary" onClick={() => setPreviewPlanner(p)}>
                    Preview
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setPreviewPlanner(p);
                      setTimeout(() => window.print(), 50);
                    }}
                  >
                    Print
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setPreviewPlanner(p);
                      setTimeout(() => window.print(), 50);
                    }}
                  >
                    Download PDF
                  </Button>
                  <Button variant="ghost" onClick={() => restorePlanner(p.planner_id)}>
                    Restore
                  </Button>
                </div>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-[color:var(--border)] p-3">
                    <div className="text-xs text-slate-500">Unit</div>
                    <div className="text-sm font-medium">{p.unit_name}</div>
                  </div>
                  <div className="rounded-lg border border-[color:var(--border)] p-3">
                    <div className="text-xs text-slate-500">Weeks</div>
                    <div className="text-sm font-medium">{p.weeks.length}</div>
                  </div>
                  <div className="rounded-lg border border-[color:var(--border)] p-3">
                    <div className="text-xs text-slate-500">Conducting</div>
                    <div className="text-sm font-medium">{p.conducting_officer || "—"}</div>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!previewPlanner}
        title="Planner Preview (Landscape)"
        onClose={() => setPreviewPlanner(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => window.print()}>
              Print / Save as PDF
            </Button>
            <Button variant="ghost" onClick={() => setPreviewPlanner(null)}>
              Close
            </Button>
          </>
        }
        className="max-w-6xl"
      >
        {previewPlanner ? <PlannerPreviewTable planner={previewPlanner} unit={unit} /> : null}
      </Modal>
    </div>
  );
}
