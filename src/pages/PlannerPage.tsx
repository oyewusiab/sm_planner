import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Planner, PlannerState, UnitSettings, User, WeekPlan } from "../types";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Divider, EmptyState, Input, Label, SectionTitle, Select, Textarea } from "../components/ui";
import { Modal } from "../components/Modal";
import { PlannerPreviewTable } from "../components/PlannerPreviewTable";
import { MemberAutocomplete, normalizeGender } from "../components/MemberAutocomplete";
import { can } from "../utils/permissions";
import { formatDateShort, monthName, nextSundaysInMonth, yyyyMmToLabel } from "../utils/date";
import { getDB, ids, time, updateDB } from "../utils/storage";

type Gender = "M" | "F";

function ensureListWithAtLeastOne(list: string[] | undefined) {
  const arr = Array.isArray(list) ? list : [];
  return arr.length === 0 ? [""] : arr;
}

function blankWeek(dateISO: string, conducting_officer: string, defaultSpeakers = 3): WeekPlan {
  return {
    week_id: ids.uid("week"),
    date: dateISO,
    conducting_officer,
    presiding: "",
    fast_testimony: false,
    speakers: Array.from({ length: Math.max(0, defaultSpeakers) }).map(() => ({
      name: "",
      topic: "",
      gender: undefined,
    })),
    hymns: { opening: "", sacrament: "", closing: "" },
    sacrament: { preparing: [], blessing: [], passing: [] },
    prayers: {
      invocation: "",
      invocation_gender: undefined,
      benediction: "",
      benediction_gender: undefined,
    },
    note: "",
  };
}

function stateTone(state: PlannerState) {
  if (state === "DRAFT") return "amber";
  if (state === "SUBMITTED") return "green";
  return "gray";
}

function plannerLabel(p: Planner) {
  return `${monthName(p.month)} ${p.year}`;
}

export function PlannerPage({
  user,
  unit,
  onChanged,
}: {
  user: User;
  unit: UnitSettings;
  onChanged: () => void;
}) {
  const db = getDB();
  const members = db.MEMBERS;

  const canCreate = can(user.role, "CREATE_PLANNER");
  const canEditSubmitted = can(user.role, "EDIT_SUBMITTED");

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [previewPlanner, setPreviewPlanner] = useState<Planner | null>(null);

  // Print portal: renders table directly in body so modal chrome is bypassed during printing.
  useEffect(() => {
    const styleId = "planner-print-page";
    const portalId = "planner-print-portal";

    if (previewPlanner) {
      // Landscape A4 page rule + hide everything except the portal during print
      if (!document.getElementById(styleId)) {
        const el = document.createElement("style");
        el.id = styleId;
        el.textContent = [
          "@media print {",
          "  @page { size: A4 landscape; margin: 8mm; }",
          "  body > *:not(#planner-print-portal) { display: none !important; }",
          "  #planner-print-portal { display: block !important; }",
          "}",
        ].join("\n");
        document.head.appendChild(el);
      }
      // Create portal host
      if (!document.getElementById(portalId)) {
        const host = document.createElement("div");
        host.id = portalId;
        host.style.display = "none"; // hidden on screen; shown by print CSS
        document.body.appendChild(host);
      }
    } else {
      const styleEl = document.getElementById(styleId);
      if (styleEl) styleEl.remove();
      const portalEl = document.getElementById(portalId);
      if (portalEl) portalEl.remove();
    }

    return () => {
      const styleEl = document.getElementById(styleId);
      if (styleEl) styleEl.remove();
      const portalEl = document.getElementById(portalId);
      if (portalEl) portalEl.remove();
    };
  }, [previewPlanner]);

  const planners = useMemo(() => {
    const list = [...db.PLANNERS]
      .filter((p) => p.state !== "ARCHIVED")
      .sort((a, b) => b.updated_date.localeCompare(a.updated_date));
    // Non-creators can still view submitted plans; drafts are hidden from them.
    if (!canCreate) return list.filter((p) => p.state !== "DRAFT");
    return list;
  }, [db.PLANNERS, canCreate]);



  const [draft, setDraft] = useState<Planner | null>(null);

  function startCreate() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const sundays = nextSundaysInMonth(month, year);
    const conducting = user.name;
    const defaultSpeakers = unit.prefs?.default_speakers ?? 3;
    const planner: Planner = {
      planner_id: ids.uid("planner"),
      unit_name: unit.unit_name,
      month,
      year,
      created_by: user.user_id,
      created_date: time.nowISO(),
      updated_date: time.nowISO(),
      state: "DRAFT",
      conducting_officer: conducting,
      weeks: sundays.slice(0, 5).map((d) => blankWeek(d, conducting, defaultSpeakers)),
    };
    setDraft(planner);
    setMode("edit");
  }

  function startEdit(p: Planner) {
    setDraft(JSON.parse(JSON.stringify(p)) as Planner);
    setMode("edit");
  }

  function save(nextState?: PlannerState) {
    if (!draft) return;
    const state: PlannerState = nextState || draft.state;
    const next: Planner = {
      ...draft,
      state,
      unit_name: unit.unit_name,
      updated_date: time.nowISO(),
      weeks: draft.weeks.slice(0, 5),
    };
    updateDB((db0) => {
      const exists = db0.PLANNERS.some((p) => p.planner_id === next.planner_id);
      const PLANNERS = exists
        ? db0.PLANNERS.map((p) => (p.planner_id === next.planner_id ? next : p))
        : [next, ...db0.PLANNERS];
      return { ...db0, PLANNERS };
    });
    onChanged();
    setDraft(next);
    return next;
  }

  function submit() {
    if (!draft) return;
    if (draft.weeks.length === 0) return;
    save("SUBMITTED");
  }

  function archive(planner_id: string) {
    updateDB((db0) => {
      const PLANNERS = db0.PLANNERS.map((p) =>
        p.planner_id === planner_id ? { ...p, state: "ARCHIVED" as const, updated_date: time.nowISO() } : p
      );
      return { ...db0, PLANNERS };
    });
    onChanged();
  }

  function addWeek() {
    if (!draft) return;
    if (draft.weeks.length >= 5) return;
    const defaultSpeakers = unit.prefs?.default_speakers ?? 3;
    setDraft((d) => {
      if (!d) return d;
      const last = d.weeks[d.weeks.length - 1];
      const nextDate = last?.date ? new Date(last.date + "T00:00:00") : new Date();
      nextDate.setDate(nextDate.getDate() + 7);
      const iso = nextDate.toISOString().slice(0, 10);
      return { ...d, weeks: [...d.weeks, blankWeek(iso, d.conducting_officer, defaultSpeakers)] };
    });
  }

  function removeWeek(week_id: string) {
    if (!draft) return;
    setDraft((d) => (d ? { ...d, weeks: d.weeks.filter((w) => w.week_id !== week_id) } : d));
  }

  const readonly = useMemo(() => {
    if (!draft) return true;
    if (draft.state === "SUBMITTED" && !canEditSubmitted) return true;
    if (draft.state === "ARCHIVED") return true;
    return !canCreate && draft.state === "DRAFT";
  }, [draft, canEditSubmitted, canCreate]);

  function setSacramentNames(week_id: string, key: "preparing" | "blessing" | "passing", names: string[]) {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        weeks: d.weeks.map((w) =>
          w.week_id === week_id ? { ...w, sacrament: { ...w.sacrament, [key]: names } } : w
        ),
      };
    });
  }

  function addSacramentName(week_id: string, key: "preparing" | "blessing" | "passing") {
    const week = draft?.weeks.find((w) => w.week_id === week_id);
    const list = ensureListWithAtLeastOne(week?.sacrament?.[key]);
    setSacramentNames(week_id, key, [...list, ""]);
  }

  function removeSacramentName(week_id: string, key: "preparing" | "blessing" | "passing", idx: number) {
    const week = draft?.weeks.find((w) => w.week_id === week_id);
    const list = ensureListWithAtLeastOne(week?.sacrament?.[key]);
    const next = list.filter((_, i) => i !== idx);
    setSacramentNames(week_id, key, next.length === 0 ? [""] : next);
  }

  function updateSacramentName(week_id: string, key: "preparing" | "blessing" | "passing", idx: number, value: string) {
    const week = draft?.weeks.find((w) => w.week_id === week_id);
    const list = ensureListWithAtLeastOne(week?.sacrament?.[key]);
    const next = list.map((x, i) => (i === idx ? value : x));
    setSacramentNames(week_id, key, next);
  }

  if (mode === "list") {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionTitle title="Sacrament Meeting Planner" subtitle="Create, submit, and archive monthly plans." />
          {canCreate ? <Button onClick={startCreate}>Create Planner</Button> : null}
        </div>

        {planners.length === 0 ? (
          <EmptyState
            title="No planners yet"
            body={canCreate ? "Create your first monthly plan." : "Ask an Admin/Bishopric member to create and submit a plan."}
            action={canCreate ? <Button onClick={startCreate}>Create Planner</Button> : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {planners.map((p) => (
              <Card key={p.planner_id}>
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle>{plannerLabel(p)}</CardTitle>
                    <div className="text-xs text-slate-500">Updated {new Date(p.updated_date).toLocaleString()}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={stateTone(p.state) as any}>{p.state}</Badge>

                    <Button variant="secondary" onClick={() => startEdit(p)}>
                      {p.state === "SUBMITTED" && !canEditSubmitted ? "View" : "Open"}
                    </Button>

                    <Button variant="secondary" onClick={() => setPreviewPlanner(p)}>
                      Preview
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setPreviewPlanner(p);
                        setTimeout(() => window.print(), 400);
                      }}
                    >
                      Print
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setPreviewPlanner(p);
                        setTimeout(() => window.print(), 400);
                      }}
                    >
                      Download PDF
                    </Button>

                    {p.state === "SUBMITTED" && canEditSubmitted ? (
                      <Button variant="ghost" onClick={() => archive(p.planner_id)}>
                        Archive
                      </Button>
                    ) : null}
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
      </div>
    );
  }

  if (!draft) {
    return (
      <EmptyState
        title="Nothing to edit"
        body="Return to the planner list."
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setMode("list");
            }}
          >
            Back
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle
          title={`Planner • ${yyyyMmToLabel(draft.month, draft.year)}`}
          subtitle={`${unit.unit_name} • State: ${draft.state}`}
        />
        <div className="flex flex-wrap items-center gap-2 no-print">
          <Button variant="secondary" onClick={() => setPreviewPlanner(draft)}>
            Preview
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setPreviewPlanner(draft);
              setTimeout(() => window.print(), 400);
            }}
          >
            Print
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setPreviewPlanner(draft);
              setTimeout(() => window.print(), 400);
            }}
          >
            Download PDF
          </Button>
          {!readonly ? (
            <>
              <Button variant="secondary" onClick={() => save("DRAFT")}>
                Save Draft
              </Button>
              <Button onClick={submit}>Submit</Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            onClick={() => {
              if (!readonly) save(draft.state);
              setMode("list");
              setDraft(null);
            }}
          >
            Continue Later
          </Button>
        </div>
      </div>

      <Card className="no-print">
        <CardHeader>
          <CardTitle>Header</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Unit Name</Label>
              <Input value={unit.unit_name} disabled />
            </div>
            <div className="space-y-1">
              <Label>Month</Label>
              <Select
                disabled={readonly}
                value={draft.month}
                onChange={(e) => {
                  const month = Number(e.target.value);
                  const sundays = nextSundaysInMonth(month, draft.year);
                  const defaultSpeakers = unit.prefs?.default_speakers ?? 3;
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          month,
                          weeks: sundays.slice(0, 5).map((date) => blankWeek(date, d.conducting_officer, defaultSpeakers)),
                        }
                      : d
                  );
                }}
              >
                {Array.from({ length: 12 }).map((_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {monthName(i + 1)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Year</Label>
              <Input
                disabled={readonly}
                type="number"
                value={draft.year}
                onChange={(e) => {
                  const year = Number(e.target.value || new Date().getFullYear());
                  const sundays = nextSundaysInMonth(draft.month, year);
                  const defaultSpeakers = unit.prefs?.default_speakers ?? 3;
                  setDraft((d) =>
                    d
                      ? { ...d, year, weeks: sundays.slice(0, 5).map((date) => blankWeek(date, d.conducting_officer, defaultSpeakers)) }
                      : d
                  );
                }}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Conducting Officer</Label>
              <Input
                disabled={readonly}
                value={draft.conducting_officer}
                onChange={(e) =>
                  setDraft((d) => {
                    if (!d) return d;
                    const conducting_officer = e.target.value;
                    return {
                      ...d,
                      conducting_officer,
                      weeks: d.weeks.map((w) => ({ ...w, conducting_officer: w.conducting_officer || conducting_officer })),
                    };
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Weeks</Label>
              <div className="flex gap-2">
                <Input value={String(draft.weeks.length)} disabled />
                <Button variant="secondary" disabled={readonly || draft.weeks.length >= 5} onClick={addWeek}>
                  + Week
                </Button>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="space-y-4">
        {draft.weeks.map((w, idx) => (
          <Card key={w.week_id}>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>
                  Week {idx + 1} • {w.date ? formatDateShort(w.date) : "(no date)"}
                </CardTitle>
                <div className="text-xs text-slate-500">Fill in the details for this Sunday.</div>
              </div>
              {!readonly ? (
                <Button variant="ghost" onClick={() => removeWeek(w.week_id)}>
                  Remove
                </Button>
              ) : null}
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Date</Label>
                  <Input
                    disabled={readonly}
                    type="date"
                    value={w.date}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? { ...d, weeks: d.weeks.map((x) => (x.week_id === w.week_id ? { ...x, date: e.target.value } : x)) }
                          : d
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Presiding (optional)</Label>
                  <Input
                    disabled={readonly}
                    value={w.presiding || ""}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? { ...d, weeks: d.weeks.map((x) => (x.week_id === w.week_id ? { ...x, presiding: e.target.value } : x)) }
                          : d
                      )
                    }
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-slate-900">Speakers</div>
                      {!readonly && !w.fast_testimony ? (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            onClick={() =>
                              setDraft((d) => {
                                if (!d) return d;
                                const weeks = d.weeks.map((x) =>
                                  x.week_id === w.week_id
                                    ? {
                                        ...x,
                                        speakers: [...(x.speakers || []), { name: "", topic: "", gender: undefined }],
                                      }
                                    : x
                                );
                                return { ...d, weeks };
                              })
                            }
                          >
                            + Speaker
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={(w.speakers?.length || 0) === 0}
                            onClick={() =>
                              setDraft((d) => {
                                if (!d) return d;
                                const weeks = d.weeks.map((x) =>
                                  x.week_id === w.week_id
                                    ? {
                                        ...x,
                                        speakers: (x.speakers || []).slice(0, Math.max(0, (x.speakers || []).length - 1)),
                                      }
                                    : x
                                );
                                return { ...d, weeks };
                              })
                            }
                          >
                            − Speaker
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        disabled={readonly}
                        checked={!!w.fast_testimony}
                        onChange={(e) =>
                          setDraft((d) => {
                            if (!d) return d;
                            const defaultSpeakers = unit.prefs?.default_speakers ?? 3;
                            const weeks = d.weeks.map((x) => {
                              if (x.week_id !== w.week_id) return x;
                              const fast_testimony = e.target.checked;
                              return {
                                ...x,
                                fast_testimony,
                                speakers: fast_testimony
                                  ? []
                                  : (x.speakers && x.speakers.length > 0
                                      ? x.speakers
                                      : Array.from({ length: Math.max(0, defaultSpeakers) }).map(() => ({
                                          name: "",
                                          topic: "",
                                          gender: undefined,
                                        }))),
                              };
                            });
                            return { ...d, weeks };
                          })
                        }
                      />
                      Fast & Testimony Meeting (no speakers)
                    </label>
                  </div>

                  {w.fast_testimony ? (
                    <div className="rounded-lg border border-[color:var(--border)] bg-slate-50 p-3 text-sm text-slate-700">
                      Speakers are disabled for this week.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {w.speakers.map((s, i) => (
                        <div key={i} className="space-y-2 rounded-lg border border-[color:var(--border)] p-3">
                          <div className="text-xs font-medium text-slate-500">Speaker {i + 1}</div>

                          <div className="space-y-1">
                            <Label>Gender / Prefix</Label>
                            <Select
                              disabled={readonly}
                              value={s.gender || ""}
                              onChange={(e) =>
                                setDraft((d) => {
                                  if (!d) return d;
                                  const gender = (e.target.value || undefined) as Gender | undefined;
                                  const weeks = d.weeks.map((x) => {
                                    if (x.week_id !== w.week_id) return x;
                                    const speakers = x.speakers.map((sp, j) => (j === i ? { ...sp, gender } : sp));
                                    return { ...x, speakers };
                                  });
                                  return { ...d, weeks };
                                })
                              }
                            >
                              <option value="">—</option>
                              <option value="M">Brother</option>
                              <option value="F">Sister</option>
                            </Select>
                          </div>

                          <div className="space-y-1">
                            <Label>Name</Label>
                            <MemberAutocomplete
                              members={members}
                              disabled={readonly}
                              value={s.name}
                              placeholder="Select from Members…"
                              onChange={(val) =>
                                setDraft((d) => {
                                  if (!d) return d;
                                  const weeks = d.weeks.map((x) => {
                                    if (x.week_id !== w.week_id) return x;
                                    const speakers = x.speakers.map((sp, j) => (j === i ? { ...sp, name: val } : sp));
                                    return { ...x, speakers };
                                  });
                                  return { ...d, weeks };
                                })
                              }
                              onPick={(m) => {
                                const g = normalizeGender(m.gender);
                                setDraft((d) => {
                                  if (!d) return d;
                                  const weeks = d.weeks.map((x) => {
                                    if (x.week_id !== w.week_id) return x;
                                    const speakers = x.speakers.map((sp, j) =>
                                      j === i ? { ...sp, name: m.name, gender: g ?? sp.gender } : sp
                                    );
                                    return { ...x, speakers };
                                  });
                                  return { ...d, weeks };
                                });
                              }}
                            />
                          </div>

                          <div className="space-y-1">
                            <Label>Topic & Reference</Label>
                            <Textarea
                              disabled={readonly}
                              rows={3}
                              value={s.topic}
                              onChange={(e) =>
                                setDraft((d) => {
                                  if (!d) return d;
                                  const weeks = d.weeks.map((x) => {
                                    if (x.week_id !== w.week_id) return x;
                                    const speakers = x.speakers.map((sp, j) => (j === i ? { ...sp, topic: e.target.value } : sp));
                                    return { ...x, speakers };
                                  });
                                  return { ...d, weeks };
                                })
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Divider />
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <div className="text-sm font-semibold text-slate-900">Hymns</div>
                      <div className="space-y-1">
                        <Label>Opening</Label>
                        <Input disabled={readonly} value={w.hymns.opening} onChange={(e) => setDraft((d) => d ? ({ ...d, weeks: d.weeks.map((x) => x.week_id === w.week_id ? ({ ...x, hymns: { ...x.hymns, opening: e.target.value } }) : x) }) : d)} />
                      </div>
                      <div className="space-y-1">
                        <Label>Sacrament</Label>
                        <Input disabled={readonly} value={w.hymns.sacrament} onChange={(e) => setDraft((d) => d ? ({ ...d, weeks: d.weeks.map((x) => x.week_id === w.week_id ? ({ ...x, hymns: { ...x.hymns, sacrament: e.target.value } }) : x) }) : d)} />
                      </div>
                      <div className="space-y-1">
                        <Label>Closing</Label>
                        <Input disabled={readonly} value={w.hymns.closing} onChange={(e) => setDraft((d) => d ? ({ ...d, weeks: d.weeks.map((x) => x.week_id === w.week_id ? ({ ...x, hymns: { ...x.hymns, closing: e.target.value } }) : x) }) : d)} />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm font-semibold text-slate-900">Sacrament Administration</div>
                      <div className="text-xs text-slate-500">Use + / − to add multiple names.</div>

                      {/* Preparing */}
                      <div className="space-y-2 rounded-lg border border-[color:var(--border)] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Label>Preparing</Label>
                          {!readonly ? (
                            <Button variant="secondary" type="button" onClick={() => addSacramentName(w.week_id, "preparing")}>
                              +
                            </Button>
                          ) : null}
                        </div>
                        <div className="space-y-2">
                          {ensureListWithAtLeastOne(w.sacrament.preparing).map((name, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <MemberAutocomplete
                                members={members}
                                disabled={readonly}
                                placeholder={`Name ${i + 1}`}
                                value={name}
                                onChange={(val) => updateSacramentName(w.week_id, "preparing", i, val)}
                              />
                              {!readonly ? (
                                <Button
                                  variant="secondary"
                                  type="button"
                                  onClick={() => removeSacramentName(w.week_id, "preparing", i)}
                                  className="px-2"
                                  title="Remove"
                                >
                                  −
                                </Button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Blessing */}
                      <div className="space-y-2 rounded-lg border border-[color:var(--border)] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Label>Blessing</Label>
                          {!readonly ? (
                            <Button variant="secondary" type="button" onClick={() => addSacramentName(w.week_id, "blessing")}>
                              +
                            </Button>
                          ) : null}
                        </div>
                        <div className="space-y-2">
                          {ensureListWithAtLeastOne(w.sacrament.blessing).map((name, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <MemberAutocomplete
                                members={members}
                                disabled={readonly}
                                placeholder={`Name ${i + 1}`}
                                value={name}
                                onChange={(val) => updateSacramentName(w.week_id, "blessing", i, val)}
                              />
                              {!readonly ? (
                                <Button
                                  variant="secondary"
                                  type="button"
                                  onClick={() => removeSacramentName(w.week_id, "blessing", i)}
                                  className="px-2"
                                  title="Remove"
                                >
                                  −
                                </Button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Passing */}
                      <div className="space-y-2 rounded-lg border border-[color:var(--border)] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Label>Passing</Label>
                          {!readonly ? (
                            <Button variant="secondary" type="button" onClick={() => addSacramentName(w.week_id, "passing")}>
                              +
                            </Button>
                          ) : null}
                        </div>
                        <div className="space-y-2">
                          {ensureListWithAtLeastOne(w.sacrament.passing).map((name, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <MemberAutocomplete
                                members={members}
                                disabled={readonly}
                                placeholder={`Name ${i + 1}`}
                                value={name}
                                onChange={(val) => updateSacramentName(w.week_id, "passing", i, val)}
                              />
                              {!readonly ? (
                                <Button
                                  variant="secondary"
                                  type="button"
                                  onClick={() => removeSacramentName(w.week_id, "passing", i)}
                                  className="px-2"
                                  title="Remove"
                                >
                                  −
                                </Button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm font-semibold text-slate-900">Prayers</div>

                      <div className="rounded-lg border border-[color:var(--border)] p-3">
                        <div className="text-xs font-medium text-slate-500">Invocation</div>
                        <div className="mt-2 grid grid-cols-1 gap-2">
                          <div className="space-y-1">
                            <Label>Gender / Prefix</Label>
                            <Select
                              disabled={readonly}
                              value={w.prayers.invocation_gender || ""}
                              onChange={(e) =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        weeks: d.weeks.map((x) =>
                                          x.week_id === w.week_id
                                            ? {
                                                ...x,
                                                prayers: {
                                                  ...x.prayers,
                                                  invocation_gender: (e.target.value || undefined) as Gender | undefined,
                                                },
                                              }
                                            : x
                                        ),
                                      }
                                    : d
                                )
                              }
                            >
                              <option value="">—</option>
                              <option value="M">Brother</option>
                              <option value="F">Sister</option>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label>Name</Label>
                            <MemberAutocomplete
                              members={members}
                              disabled={readonly}
                              value={w.prayers.invocation}
                              placeholder="Select from Members…"
                              onChange={(val) =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        weeks: d.weeks.map((x) =>
                                          x.week_id === w.week_id
                                            ? { ...x, prayers: { ...x.prayers, invocation: val } }
                                            : x
                                        ),
                                      }
                                    : d
                                )
                              }
                              onPick={(m) => {
                                const g = normalizeGender(m.gender);
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        weeks: d.weeks.map((x) =>
                                          x.week_id === w.week_id
                                            ? {
                                                ...x,
                                                prayers: {
                                                  ...x.prayers,
                                                  invocation: m.name,
                                                  invocation_gender: g ?? x.prayers.invocation_gender,
                                                },
                                              }
                                            : x
                                        ),
                                      }
                                    : d
                                );
                              }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-[color:var(--border)] p-3">
                        <div className="text-xs font-medium text-slate-500">Benediction</div>
                        <div className="mt-2 grid grid-cols-1 gap-2">
                          <div className="space-y-1">
                            <Label>Gender / Prefix</Label>
                            <Select
                              disabled={readonly}
                              value={w.prayers.benediction_gender || ""}
                              onChange={(e) =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        weeks: d.weeks.map((x) =>
                                          x.week_id === w.week_id
                                            ? {
                                                ...x,
                                                prayers: {
                                                  ...x.prayers,
                                                  benediction_gender: (e.target.value || undefined) as Gender | undefined,
                                                },
                                              }
                                            : x
                                        ),
                                      }
                                    : d
                                )
                              }
                            >
                              <option value="">—</option>
                              <option value="M">Brother</option>
                              <option value="F">Sister</option>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label>Name</Label>
                            <MemberAutocomplete
                              members={members}
                              disabled={readonly}
                              value={w.prayers.benediction}
                              placeholder="Select from Members…"
                              onChange={(val) =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        weeks: d.weeks.map((x) =>
                                          x.week_id === w.week_id
                                            ? { ...x, prayers: { ...x.prayers, benediction: val } }
                                            : x
                                        ),
                                      }
                                    : d
                                )
                              }
                              onPick={(m) => {
                                const g = normalizeGender(m.gender);
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        weeks: d.weeks.map((x) =>
                                          x.week_id === w.week_id
                                            ? {
                                                ...x,
                                                prayers: {
                                                  ...x.prayers,
                                                  benediction: m.name,
                                                  benediction_gender: g ?? x.prayers.benediction_gender,
                                                },
                                              }
                                            : x
                                        ),
                                      }
                                    : d
                                );
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1 md:col-span-3">
                      <Label>Note (optional)</Label>
                      <Textarea
                        disabled={readonly}
                        rows={2}
                        placeholder="Any additional notes for this Sunday (optional)…"
                        value={w.note || ""}
                        onChange={(e) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  weeks: d.weeks.map((x) => (x.week_id === w.week_id ? { ...x, note: e.target.value } : x)),
                                }
                              : d
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Screen preview modal – hidden when printing */}
      <div className="no-print">
        <Modal
          open={!!previewPlanner}
          title="Planner Preview (A4 Landscape – 2 pages)"
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

      {/* Print portal – renders OUTSIDE modal so browser prints only these 2 pages */}
      {previewPlanner &&
        (() => {
          const host = document.getElementById("planner-print-portal");
          return host
            ? createPortal(
                <PlannerPreviewTable planner={previewPlanner} unit={unit} />,
                host
              )
            : null;
        })()}
    </div>
  );
}
