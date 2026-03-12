import { useEffect, useMemo, useState } from "react";
import type { Planner, UnitSettings, User } from "../types";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Divider,
  EmptyState,
  Input,
  Label,
  SectionTitle,
  Select,
} from "../components/ui";
import { Modal } from "../components/Modal";
import { can } from "../utils/permissions";
import { formatDateShort, monthName, toISODateLocal } from "../utils/date";
import { getDB, ids, time, updateDB } from "../utils/storage";

type Gender = "M" | "F";

type Extracted = {
  key: string;
  planner_id: string;
  week_id: string;
  date: string;
  person: string;
  role: string;
  topic?: string;
  gender?: Gender;
  minutes?: number;
};

type AssignmentKind = "OPENING_PRAYER" | "CLOSING_PRAYER" | "TESTIMONY" | "TALK" | "OTHER";

function withBrotherSister(name: string, gender?: Gender) {
  const n = (name || "").trim();
  if (!n) return "";
  const lower = n.toLowerCase();
  if (lower.startsWith("brother ") || lower.startsWith("sister ")) return n;
  if (gender === "M") return `Brother ${n}`;
  if (gender === "F") return `Sister ${n}`;
  return n;
}

function dearPrefix(gender?: Gender) {
  if (gender === "M") return "Brother";
  if (gender === "F") return "Sister";
  return "Brother/Sister";
}

function roleKind(role: string): AssignmentKind {
  if (role === "Invocation") return "OPENING_PRAYER";
  if (role === "Benediction") return "CLOSING_PRAYER";
  if (role.toLowerCase().includes("testimony")) return "TESTIMONY";
  if (role.toLowerCase().startsWith("speaker")) return "TALK";
  return "OTHER";
}

function roleAsText(role: string) {
  const k = roleKind(role);
  if (k === "OPENING_PRAYER") return "Opening Prayer";
  if (k === "CLOSING_PRAYER") return "Closing Prayer";
  if (k === "TESTIMONY") return "Bear your Testimony";
  if (k === "TALK") return "Give a Talk/Presentation/Lesson";
  return role;
}

function defaultMinutesFor(role: string) {
  const k = roleKind(role);
  if (k === "OPENING_PRAYER" || k === "CLOSING_PRAYER") return 2;
  if (k === "TESTIMONY") return 5;
  if (k === "TALK") return 10;
  return undefined;
}

function extract(planner: Planner): Extracted[] {
  const out: Extracted[] = [];
  for (const w of planner.weeks) {
    const push = (person: string, role: string, topic?: string, gender?: Gender, minutes?: number) => {
      const p = (person || "").trim();
      if (!p) return;
      out.push({
        key: `${planner.planner_id}.${w.week_id}.${role}.${p}`,
        planner_id: planner.planner_id,
        week_id: w.week_id,
        date: w.date,
        person: p,
        role,
        topic: topic?.trim() || undefined,
        gender,
        minutes,
      });
    };

    // Fast & Testimony meeting: no speakers.
    if (!w.fast_testimony) {
      w.speakers.forEach((s, i) => push(s.name, `Speaker ${i + 1}`, s.topic, s.gender, defaultMinutesFor(`Speaker ${i + 1}`)));
    }

    push(w.prayers.invocation, "Invocation", undefined, w.prayers.invocation_gender, defaultMinutesFor("Invocation"));
    push(w.prayers.benediction, "Benediction", undefined, w.prayers.benediction_gender, defaultMinutesFor("Benediction"));

    // Other assignments (kept for completeness)
    const pushMany = (people: string[] | undefined, role: string) => {
      for (const p of Array.isArray(people) ? people : []) push(p, role);
    };

    pushMany(w.sacrament.preparing, "Sacrament: Preparing");
    pushMany(w.sacrament.blessing, "Sacrament: Blessing");
    pushMany(w.sacrament.passing, "Sacrament: Passing");
    push(w.conducting_officer || planner.conducting_officer, "Conducting Officer");
    if (w.presiding) push(w.presiding, "Presiding");
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.person.localeCompare(b.person));
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function NotificationCard({
  unit,
  signatory,
  item,
  issuedDate,
}: {
  unit: UnitSettings;
  signatory: User | null;
  item: Extracted;
  issuedDate: string;
}) {
  const kind = roleKind(item.role);

  const headerUnit = (unit.unit_name || "").toUpperCase();
  const churchLine = "The Church of Jesus Christ of Latter-day Saints";

  const personName = withBrotherSister(item.person, item.gender);
  const meetingName = "Sacrament Meeting";
  const allotted = item.minutes ?? defaultMinutesFor(item.role);

  const subject = item.topic || "";

  const fromName = ((signatory?.name || "").trim() || "______________________________").trim();
  const fromPos = (signatory?.calling || "Secretary").trim() || "Secretary";
  const signature = (signatory?.signature_data_url || "").trim();

  const assignmentLine = (() => {
    if (kind === "OPENING_PRAYER") return "Give the Opening Prayer (2 minutes maximum)";
    if (kind === "CLOSING_PRAYER") return "Give the Closing Prayer (2 minutes maximum)";
    if (kind === "TESTIMONY") return "Bear your Testimony";
    if (kind === "TALK") return "Give a Talk/Presentation/Lesson";
    return roleAsText(item.role);
  })();

  return (
    <div className="notif-card bg-white p-4 text-[11.5px] leading-[1.32] text-slate-900">
      <div className="text-center">
        <div className="text-[12.5px] font-semibold tracking-wide">{headerUnit}</div>
        <div className="text-[11px] text-slate-700">{churchLine}</div>
        <div className="mt-1 text-[12px] font-semibold">ASSIGNMENT NOTIFICATION</div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <span className="font-medium">Date:</span> {formatDateShort(issuedDate)}
        </div>
        <div className="text-right">
          <span className="font-medium">Meeting Date:</span> {formatDateShort(item.date)}
        </div>
      </div>

      <div className="mt-2">
        <div>
          Dear {dearPrefix(item.gender)} <span className="font-medium">{personName.replace(/^Brother\s+|^Sister\s+/i, "")}</span>,
        </div>
        <div className="mt-1">
          On behalf of the Bishopric of the {unit.unit_name}, I am pleased to inform you that you have been assigned to:
        </div>
      </div>

      <div className="mt-2">
        <div className="font-semibold">{assignmentLine}</div>
      </div>

      <div className="mt-2">
        <div className="font-medium">Subject/Topic:</div>
        <div className="min-h-[18px] border-b border-dotted border-slate-400 text-slate-800">
          {subject || ""}
        </div>
      </div>

      <div className="mt-2 text-[11px]">
        for (Time Allotted): <span className="font-medium">{allotted ? `${allotted}` : ""}</span>
        {allotted ? " minutes" : ""} as the: <span className="font-medium">{roleAsText(item.role)}</span> In (Meeting/Activity):
        <span className="font-medium"> {meetingName}</span> on (Date): <span className="font-medium">{formatDateShort(item.date)}</span> at (Venue):
        <span className="font-medium"> {unit.venue || ""}</span>.
      </div>

      <div className="mt-2 text-[11px]">
        We kindly invite you to join the Bishopric 15 minutes before the meeting in preparation for the activity.
      </div>
      <div className="mt-1 text-[11px]">
        We appreciate your willingness to serve and contribute to the spiritual growth of the ward.
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-[10.5px]">
        <div className="col-span-2">
          <div className="text-slate-600">Name</div>
          <div className="border-b border-dotted border-slate-400 py-1 font-medium">{fromName}</div>
        </div>
        <div>
          <div className="text-slate-600">Position</div>
          <div className="border-b border-dotted border-slate-400 py-1 font-medium">{fromPos}</div>
        </div>
        <div>
          <div className="text-slate-600">Date</div>
          <div className="border-b border-dotted border-slate-400 py-1 font-medium">{formatDateShort(issuedDate)}</div>
        </div>
        <div className="col-span-4">
          <div className="text-slate-600">Signature</div>
          <div className="h-[30px] border-b border-dotted border-slate-400">
            {signature ? (
              <img src={signature} alt="Signature" className="h-full w-auto object-contain" />
            ) : (
              <div className="h-full" />
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 text-[10.5px] text-slate-700">
        Please prepare prayerfully and feel free to contact us if you have any questions. Your contribution is deeply appreciated.
      </div>
    </div>
  );
}

export function AssignmentsPage({
  user,
  unit,
  onChanged,
}: {
  user: User;
  unit: UnitSettings;
  onChanged: () => void;
}) {
  const allowed = can(user.role, "GENERATE_ASSIGNMENTS");
  const db = getDB();

  const submitted = useMemo(
    () => [...db.PLANNERS].filter((p) => p.state === "SUBMITTED").sort((a, b) => b.updated_date.localeCompare(a.updated_date)),
    [db.PLANNERS]
  );

  const [plannerId, setPlannerId] = useState(submitted[0]?.planner_id || "");
  const planner = submitted.find((p) => p.planner_id === plannerId) || null;

  const extractedAll = useMemo(() => (planner ? extract(planner) : []), [planner]);

  const [query, setQuery] = useState("");

  const [minutesByKey, setMinutesByKey] = useState<Record<string, number | undefined>>({});

  // Initialize default minutes when planner changes.
  useEffect(() => {
    const next: Record<string, number | undefined> = {};
    for (const x of extractedAll) {
      // keep existing overrides if any
      next[x.key] = minutesByKey[x.key] ?? x.minutes;
    }
    setMinutesByKey(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannerId]);

  const extracted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return extractedAll
      .map((x) => ({ ...x, minutes: minutesByKey[x.key] ?? x.minutes }))
      .filter((x) => {
        if (!q) return true;
        return `${x.person} ${x.role} ${x.topic || ""} ${x.date}`.toLowerCase().includes(q);
      });
  }, [extractedAll, minutesByKey, query]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [printOpen, setPrintOpen] = useState(false);

  useEffect(() => {
    const cls = "printing-assignments";
    if (printOpen) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [printOpen]);

  const selectedItems = useMemo(
    () => extracted.filter((x) => selected[x.key] ?? true).map((x) => ({ ...x, minutes: minutesByKey[x.key] ?? x.minutes })),
    [extracted, minutesByKey, selected]
  );

  const issuedDate = useMemo(() => toISODateLocal(new Date()), []);

  const signatory = useMemo(() => {
    const secretary = db.USERS.find((u) => u.role === "SECRETARY" && u.calling === "Secretary");
    const assistant = db.USERS.find((u) => u.role === "SECRETARY" && u.calling === "Assistant Secretary");
    // Assignment notifications must be signed by the Secretary.
    // If no Secretary is configured yet, print blank signature/name lines (do not fall back to Bishop/other roles).
    return secretary || assistant || null;
  }, [db.USERS]);

  function toggleAll(value: boolean) {
    const next: Record<string, boolean> = {};
    for (const x of extracted) next[x.key] = value;
    setSelected(next);
  }

  function generateRecords() {
    if (!planner) return;
    const rows = selectedItems;
    updateDB((db0) => {
      const created = rows.map((r) => ({
        assignment_id: ids.uid("assign"),
        planner_id: r.planner_id,
        week_id: r.week_id,
        date: r.date,
        venue: unit.venue,
        meeting_time: unit.meeting_time,
        person: r.person,
        role: r.role,
        topic: r.topic,
        minutes: r.minutes,
        created_date: time.nowISO(),
      }));
      return { ...db0, ASSIGNMENTS: [...created, ...db0.ASSIGNMENTS] };
    });
    onChanged();
  }

  if (!allowed) {
    return <EmptyState title="Assignments Generator" body="You do not have permission to generate assignments." />;
  }

  if (submitted.length === 0) {
    return <EmptyState title="No submitted planners" body="Submit a planner first, then generate notifications." />;
  }

  const pages = chunk(selectedItems, 3);

  return (
    <div className="space-y-6">
      <div className="no-print space-y-6">
        <SectionTitle
          title="Assignment Notifications"
          subtitle="Select recipients and print personalized notifications (3 per A4 page)."
        />

        <Card>
        <CardHeader>
          <CardTitle>1) Choose a submitted planner</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1 md:col-span-2">
              <Label>Planner</Label>
              <Select
                value={plannerId}
                onChange={(e) => {
                  setPlannerId(e.target.value);
                  setSelected({});
                }}
              >
                {submitted.map((p) => (
                  <option key={p.planner_id} value={p.planner_id}>
                    {monthName(p.month)} {p.year} — {p.unit_name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Venue</Label>
              <Input value={unit.venue} disabled />
            </div>
          </div>

          <Divider />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1 md:col-span-3">
              <Label>Search</Label>
              <Input placeholder="Search name, role, topic, date…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>

          <Divider />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-slate-600">2) Select who to generate notifications for</div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => toggleAll(true)}>
                Select all
              </Button>
              <Button variant="secondary" onClick={() => toggleAll(false)}>
                Select none
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {extracted.map((x) => {
              const checked = selected[x.key] ?? true;
              const kind = roleKind(x.role);
              const tone = kind === "TALK" ? "blue" : kind === "OPENING_PRAYER" || kind === "CLOSING_PRAYER" ? "green" : "gray";
              const minutes = minutesByKey[x.key] ?? x.minutes ?? defaultMinutesFor(x.role);
              const canEditMinutes = kind === "TALK" || kind === "OPENING_PRAYER" || kind === "CLOSING_PRAYER" || kind === "TESTIMONY";
              return (
                <div
                  key={x.key}
                  className="flex items-start justify-between gap-3 rounded-lg border border-[color:var(--border)] bg-white p-3 hover:bg-slate-50"
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                    <input
                      className="mt-1"
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setSelected((s) => ({ ...s, [x.key]: e.target.checked }))}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium text-slate-900">{withBrotherSister(x.person, x.gender) || x.person}</div>
                        <Badge tone={tone as any}>{roleAsText(x.role)}</Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-600">
                        {formatDateShort(x.date)}
                        {x.topic ? ` • ${x.topic}` : ""}
                      </div>
                    </div>
                  </label>

                  <div className="flex items-center gap-2">
                    <div className="text-[11px] text-slate-500">Minutes</div>
                    <input
                      className="w-[76px] rounded-md border border-[color:var(--border)] px-2 py-1 text-sm"
                      type="number"
                      min={0}
                      value={minutes ?? ""}
                      disabled={!canEditMinutes}
                      onChange={(e) => {
                        const v = e.target.value;
                        setMinutesByKey((m) => ({ ...m, [x.key]: v === "" ? undefined : Math.max(0, Number(v)) }));
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-500">Preview and print in A4 format. Cut and distribute to members.</div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  generateRecords();
                  setPrintOpen(true);
                }}
                disabled={selectedItems.length === 0}
              >
                Preview / Print
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
      </div>

      <Modal
        open={printOpen}
        title="Printable Notifications"
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
        className="max-w-5xl"
      >
        <div className="space-y-4">
          {pages.length === 0 ? (
            <div className="no-print text-sm text-slate-500">Nothing selected.</div>
          ) : (
            pages.map((page, idx) => (
              <div key={idx} className="notif-page">
                <div className="notif-grid">
                  {page.map((n) => (
                    <NotificationCard
                      key={n.key}
                      unit={unit}
                      signatory={signatory}
                      item={n}
                      issuedDate={issuedDate}
                    />
                  ))}
                </div>
                {idx < pages.length - 1 ? <div className="print-page-break" /> : null}
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
