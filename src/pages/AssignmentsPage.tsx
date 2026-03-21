import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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
import { formatDateShort, monthName } from "../utils/date";
import { formatUserDisplayName } from "../utils/format";
import { ids, updateDB, useTable, time } from "../utils/storage";
import { generatePDF } from "../utils/pdf";

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
  // Use Serif font for a more formal, printed look
  const fontHeader = "font-serif";

  const headerUnit = (unit.unit_name || "");
  const churchLine = "The Church of Jesus Christ of Latter-day Saints";

  const personName = withBrotherSister(item.person, item.gender);
  const meetingName = "Sacrament Meeting";

  // Logic to handle 0 minutes or undefined nicely
  const defaultMins = defaultMinutesFor(item.role);
  const minVal = item.minutes ?? defaultMins;
  const allotted = minVal ? `${minVal} min` : "";

  const subject = item.topic || "";

  // If no signatory, provide a blank line
  const fromName = ((signatory?.name || "").trim() || "");
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
    <div className="notif-card bg-white p-2 text-[10px] leading-tight text-black font-sans border border-black rounded-none">
      {/* Header Section */}
      <div className="flex items-start justify-between border-b border-black pb-2 mb-2">
        <div className="space-y-0.5">
          <div className={`${fontHeader} text-[10px] text-black uppercase tracking-wide`}>{churchLine}</div>
          <div className={`${fontHeader} text-[14px] font-bold text-black uppercase`}>{headerUnit}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase border border-black px-2 py-0.5 inline-block">Assignment</div>
        </div>
      </div>

      {/* Date & Recipient Line */}
      <div className="flex justify-between items-end mb-3 text-[11px]">
        <div>
          <span className="font-bold">Date:</span> {formatDateShort(issuedDate)}
        </div>
        <div>
          Dear {dearPrefix(item.gender)} <span className="font-bold text-[12px]">{personName.replace(/^Brother\s+|^Sister\s+/i, "")}</span>,
        </div>
      </div>

      {/* Assignment Body */}
      <div className="mb-3">
        <div className="mb-1.5">
          On behalf of the Bishopric, you are assigned to:
        </div>
        <div className="font-bold text-[12px] pl-4 border-l-2 border-black py-0.5 my-1">
          {assignmentLine}
        </div>
        <div className="mt-1.5">
          in <span className="font-bold">{meetingName}</span> on <span className="font-bold text-[11px] bg-gray-100 px-1 border border-gray-300 print:border-black print:bg-transparent">{formatDateShort(item.date)}</span>
          {allotted && <span> (Time: <span className="font-bold">{allotted}</span>)</span>}.
        </div>
      </div>

      {/* Subject Line (if applicable) */}
      {(kind === "TALK" || subject) && (
        <div className="mb-3 flex items-baseline gap-2">
          <div className="font-bold whitespace-nowrap">Topic / Subject:</div>
          <div className="flex-1 border-b border-dotted border-black text-black font-medium px-1">
            {subject || "______________________________________________________"}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="mb-4 text-[9px] italic text-black">
        Please join the Bishopric 15 minutes before the meeting. If you cannot fulfill this assignment, please contact a member of the Bishopric immediately.
      </div>

      {/* Signature Area */}
      <div className="flex items-end justify-between mt-auto pt-2">
        <div className="w-1/2">
          {/* Left blank or could be Bishop's line */}
        </div>
        <div className="col-span-2">
          <div className="h-[25px] flex items-end justify-center relative">
            {signature ? (
              <img src={signature} alt="Sig" className="h-full max-h-[40px] w-auto object-contain absolute bottom-0" />
            ) : (
              <div className="h-full" />
            )}
          </div>
          <div className="border-t border-black pt-1 text-center">
            <div className="font-bold text-[10px]">{fromName || "__________________________"}</div>
            <div className="text-[9px] uppercase tracking-wide">{fromPos}</div>
          </div>
        </div>
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
  const { data: planners = [] } = useTable("PLANNERS");
  const { data: users = [] } = useTable("USERS");

  const submitted = useMemo(
    () => [...planners].filter((p) => p.state === "SUBMITTED").sort((a, b) => b.updated_date.localeCompare(a.updated_date)),
    [planners]
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [printStatus, setPrintStatus] = useState<"idle" | "preparing" | "ready">("idle");

  useEffect(() => {
    if (printStatus === "ready") {
      const timer = setTimeout(() => {
        window.print();
        setPrintStatus("idle");
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [printStatus]);

  function triggerPrint() {
    setPrintStatus("preparing");
    // Small delay to let React render the portal
    setTimeout(() => setPrintStatus("ready"), 100);
  }

  useEffect(() => {
    const cls = "printing-assignments";
    if (printStatus !== "idle") {
      document.body.classList.add(cls);
    } else {
      document.body.classList.remove(cls);
    }
    return () => document.body.classList.remove(cls);
  }, [printStatus]);

  const selectedItems = useMemo(
    () => extracted.filter((x) => selected[x.key] ?? true).map((x) => ({ ...x, minutes: minutesByKey[x.key] ?? x.minutes })),
    [extracted, minutesByKey, selected]
  );

  // Use simple ISO date string for today
  const issuedDate = useMemo(() => new Date().toISOString().split("T")[0], []);

  const signatory = useMemo(() => {
    const secretary = users.find((u) => u.role === "SECRETARY" && u.calling === "Secretary");
    const assistant = users.find((u) => u.role === "SECRETARY" && u.calling === "Assistant Secretary");
    // Assignment notifications must be signed by the Secretary.
    // If no Secretary is configured yet, print blank signature/name lines (do not fall back to Bishop/other roles).
    return secretary || assistant || null;
  }, [users]);

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
                          <div className="text-sm font-medium text-slate-900">
                            {formatUserDisplayName({ name: x.person, gender: x.gender as any })}
                          </div>
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
              <div className="text-xs text-slate-500">Preview and print. Cut and distribute to members.</div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    generateRecords();
                    setPreviewOpen(true);
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
        open={previewOpen}
        title="Printable Notifications"
        onClose={() => setPreviewOpen(false)}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={triggerPrint}
              disabled={printStatus !== "idle"}
            >
              Print
            </Button>
            <Button
              variant="outline"
              disabled={printStatus !== "idle"}
              onClick={() => generatePDF("assignments-print-area", `Assignments_${new Date().toISOString().split('T')[0]}`)}
            >
              Download Notifications PDF
            </Button>
            <Button variant="ghost" onClick={() => {
              setPreviewOpen(false);
              setPrintStatus("idle");
            }}>
              Close
            </Button>
          </>
        }
        className="max-w-5xl"
      >
        <div id="assignments-print-area" className="space-y-6">
          {pages.length === 0 ? (
            <div className="no-print text-sm text-slate-500">Nothing selected.</div>
          ) : (
            pages.map((page, idx) => (
              <div key={idx} className="notif-page space-y-4">
                {page.map((n) => (
                  <div key={n.key} className="border border-slate-200 overflow-hidden print:border-black">
                    <NotificationCard
                      unit={unit}
                      signatory={signatory}
                      item={n}
                      issuedDate={issuedDate}
                    />
                  </div>
                ))}
                {idx < pages.length - 1 ? <div className="print-page-break" style={{ pageBreakAfter: "always" }} /> : null}
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* Print portal for browser window.print() */}
      {printStatus !== "idle" &&
        (() => {
          const host = document.getElementById("planner-print-portal");
          if (!host) return null;
          return createPortal(
            <div className="print-portrait p-0">
              <div className="space-y-0">
                {pages.map((page, idx) => (
                  // Optimized for A4 Portrait (297mm height)
                  // Padding 10mm top/bottom leaves 277mm. 3 cards need space.
                  // Reduced gap to 4mm to ensure they fit without spilling to next page.
                  <div key={idx} className="notif-page" style={{ height: "297mm", padding: "10mm 15mm", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "4mm", pageBreakAfter: "always" }}>
                    {page.map((n) => (
                      <div key={n.key} style={{ flex: "1", border: "1px dashed #000", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                        <NotificationCard
                          unit={unit}
                          signatory={signatory}
                          item={n}
                          issuedDate={issuedDate}
                        />
                      </div>
                    ))}
                    {idx < pages.length - 1 ? <div style={{ pageBreakAfter: "always" }} /> : null}
                  </div>
                ))}
              </div>
            </div>,
            host
          );
        })()}
    </div>
  );
}
