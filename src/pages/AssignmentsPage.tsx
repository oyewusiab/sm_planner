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
  Textarea,
} from "../components/ui";
import { Modal } from "../components/Modal";
import { can } from "../utils/permissions";
import { formatDateShort, monthName, toISODateLocal } from "../utils/date";
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
  reference?: string;
  gender?: Gender;
  minutes?: number;
  reference_link?: string;
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

function formatPhoneForWhatsApp(phone: string) {
  let cleaned = phone.replace(/\D/g, "");
  // Standard Nigerian 11 digit local number format starts with 0
  if (cleaned.startsWith("0") && cleaned.length === 11) {
    return "234" + cleaned.substring(1);
  }
  return cleaned;
}

function generateMessageText(
  item: Extracted,
  template: "new" | "reminder",
  signatory: User | null,
  unit: UnitSettings
) {
  const genderPrefix = dearPrefix(item.gender);
  const dateStr = formatDateShort(item.date);
  const kind = roleKind(item.role);

  const assignmentLine = (() => {
    if (kind === "OPENING_PRAYER") return "give the Opening Prayer";
    if (kind === "CLOSING_PRAYER") return "give the Closing Prayer";
    if (kind === "TESTIMONY") return "bear your Testimony";
    if (kind === "TALK") {
      let line = `give a talk on the topic: "${item.topic || 'assigned topic'}"`;
      if (item.reference) {
        line += ` (Reference: ${item.reference})`;
      }
      return line;
    }
    return roleAsText(item.role);
  })();

  const allottedTime = item.minutes ?? defaultMinutesFor(item.role);
  const allottedStr = allottedTime ? ` (Time allotted: ${allottedTime} minutes)` : "";

  const fromName = signatory?.name || "Ward Secretary";
  const fromCalling = signatory?.calling || "Secretary";
  const unitName = unit.unit_name || "Ward";

  if (template === "new") {
    let msg = `Dear ${genderPrefix} ${item.person.replace(/^Brother\s+|^Sister\s+/i, "")},

On behalf of the Bishopric of the ${unitName}, you have been assigned to ${assignmentLine}${allottedStr} in Sacrament Meeting on ${dateStr}.`;

    if (kind === "TALK" && item.reference_link) {
      msg += `\nReference Link: ${item.reference_link}`;
    }

    msg += `\n\nPlease plan to arrive at the chapel and join the Bishopric on the stand 15 minutes before the meeting starts.

If for any reason you are unable to fulfill this assignment, please contact the Bishopric or the Ward Secretary as soon as possible.

Warm regards,
${fromName}
${fromCalling}, ${unitName}`;
    return msg;
  } else {
    let msg = `Dear ${genderPrefix} ${item.person.replace(/^Brother\s+|^Sister\s+/i, "")},

This is a gentle reminder from the ${unitName} Bishopric regarding your assignment to ${assignmentLine}${allottedStr} in Sacrament Meeting this Sunday, ${dateStr}.`;

    if (kind === "TALK" && item.reference_link) {
      msg += `\nReference Link: ${item.reference_link}`;
    }

    msg += `\n\nWe look forward to your message. Please reply to this message to confirm your availability.

Warm regards,
${fromName}
${fromCalling}, ${unitName}`;
    return msg;
  }
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
    const push = (person: string, role: string, topic?: string, reference?: string, gender?: Gender, minutes?: number, reference_link?: string) => {
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
        reference: reference?.trim() || undefined,
        gender,
        minutes,
        reference_link,
      });
    };

    // Fast & Testimony meeting: no speakers.
    if (!w.fast_testimony) {
      w.speakers.forEach((s, i) => push(s.name, `Speaker ${i + 1}`, s.topic, s.reference, s.gender, defaultMinutesFor(`Speaker ${i + 1}`), s.reference_link));
    }

    push(w.prayers.invocation, "Invocation", undefined, undefined, w.prayers.invocation_gender, defaultMinutesFor("Invocation"));
    push(w.prayers.benediction, "Benediction", undefined, undefined, w.prayers.benediction_gender, defaultMinutesFor("Benediction"));

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
          Dear {dearPrefix(item.gender)} <span className="font-bold text-[12px]">{personName.replace(/^Brother\s+|^Sister\s+/i, "")}</span>,
        </div>
        <div>
          <span className="font-bold">Date:</span> {formatDateShort(issuedDate)}
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
        <div className="mb-2 flex items-baseline gap-2">
          <div className="font-bold whitespace-nowrap">Topic / Subject:</div>
          <div className="flex-1 border-b border-dotted border-black text-black font-medium px-1">
            {subject || "______________________________________________________"}
          </div>
        </div>
      )}

      {item.reference && (
        <div className="mb-3 flex items-baseline gap-2">
          <div className="font-bold whitespace-nowrap">Reference:</div>
          <div className="flex-1 border-b border-dotted border-black text-black font-medium px-1">
            {item.reference}
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
  const { data: members = [] } = useTable("MEMBERS");
  const { data: dbAssignments = [] } = useTable("ASSIGNMENTS");

  const [activeMsgItem, setActiveMsgItem] = useState<Extracted | null>(null);
  const [msgChannel, setMsgChannel] = useState<"whatsapp" | "email" | null>(null);
  const [msgPhone, setMsgPhone] = useState("");
  const [msgEmail, setMsgEmail] = useState("");
  const [msgTemplate, setMsgTemplate] = useState<"new" | "reminder">("new");
  const [msgText, setMsgText] = useState("");

  const submitted = useMemo(
    () => [...planners].filter((p) => p.state === "SUBMITTED").sort((a, b) => b.updated_date.localeCompare(a.updated_date)),
    [planners]
  );

  const [plannerId, setPlannerId] = useState(submitted[0]?.planner_id || "");
  const planner = submitted.find((p) => p.planner_id === plannerId) || null;

  const extractedAll = useMemo(() => (planner ? extract(planner) : []), [planner]);

  const [query, setQuery] = useState("");
  const [showPast, setShowPast] = useState(false);
  const todayStr = useMemo(() => toISODateLocal(new Date()), []);

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
        if (!showPast && x.date < todayStr) return false;
        if (!q) return true;
        return `${x.person} ${x.role} ${x.topic || ""} ${x.date}`.toLowerCase().includes(q);
      });
  }, [extractedAll, minutesByKey, query, showPast, todayStr]);

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

  function openMessageModal(item: Extracted, channel: "whatsapp" | "email") {
    const member = members.find((m) => m.name.trim().toLowerCase() === item.person.trim().toLowerCase());
    
    // Check if it's already in assignments table to see if it was sent
    const dbAssign = dbAssignments.find(
      (a) =>
        a.planner_id === item.planner_id &&
        a.week_id === item.week_id &&
        a.person.trim().toLowerCase() === item.person.trim().toLowerCase() &&
        a.role === item.role
    );

    const defaultTemplate = dbAssign?.sent_status ? "reminder" : "new";
    const phone = member?.phone || "";
    const email = member?.email || "";

    setActiveMsgItem(item);
    setMsgChannel(channel);
    setMsgPhone(phone);
    setMsgEmail(email);
    setMsgTemplate(defaultTemplate);

    const text = generateMessageText(item, defaultTemplate, signatory, unit);
    setMsgText(text);
  }

  // Update text when template changes
  useEffect(() => {
    if (activeMsgItem) {
      const text = generateMessageText(activeMsgItem, msgTemplate, signatory, unit);
      setMsgText(text);
    }
  }, [msgTemplate, activeMsgItem, signatory, unit]);

  function handleSendMessage() {
    if (!activeMsgItem || !msgChannel) return;

    if (msgChannel === "whatsapp") {
      const whatsappUrl = `https://wa.me/${formatPhoneForWhatsApp(msgPhone)}?text=${encodeURIComponent(msgText)}`;
      window.open(whatsappUrl, "_blank");
    } else {
      const mailtoUrl = `mailto:${msgEmail}?subject=${encodeURIComponent("Sacrament Meeting Assignment - " + formatDateShort(activeMsgItem.date))}&body=${encodeURIComponent(msgText)}`;
      window.open(mailtoUrl, "_self");
    }

    updateAssignmentStatus(activeMsgItem, msgTemplate === "new" ? "SENT" : "REMINDED");
    setActiveMsgItem(null);
    setMsgChannel(null);
  }

  function updateAssignmentStatus(item: Extracted, status: "SENT" | "REMINDED") {
    updateDB((db0) => {
      const list = [...db0.ASSIGNMENTS];
      const idx = list.findIndex(
        (a) =>
          a.planner_id === item.planner_id &&
          a.week_id === item.week_id &&
          a.person.trim().toLowerCase() === item.person.trim().toLowerCase() &&
          a.role === item.role
      );

      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          sent_status: status,
          sent_date: time.nowISO(),
        };
      } else {
        list.unshift({
          assignment_id: ids.uid("assign"),
          planner_id: item.planner_id,
          week_id: item.week_id,
          date: item.date,
          venue: unit.venue,
          meeting_time: unit.meeting_time,
          person: item.person,
          role: item.role,
          topic: item.topic,
          minutes: item.minutes,
          created_date: time.nowISO(),
          sent_status: status,
          sent_date: time.nowISO(),
        });
      }
      return { ...db0, ASSIGNMENTS: list };
    });
    onChanged();
  }

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
        reference: r.reference,
        reference_link: r.reference_link,
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

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-600">2) Select who to generate notifications for</div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showPast}
                    onChange={(e) => setShowPast(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Show past assignments
                </label>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={() => toggleAll(true)}>
                    Select all
                  </Button>
                  <Button variant="secondary" onClick={() => toggleAll(false)}>
                    Select none
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {extracted.map((x) => {
                const checked = selected[x.key] ?? true;
                const kind = roleKind(x.role);
                const tone = kind === "TALK" ? "blue" : kind === "OPENING_PRAYER" || kind === "CLOSING_PRAYER" ? "green" : "gray";
                const minutes = minutesByKey[x.key] ?? x.minutes ?? defaultMinutesFor(x.role);
                const canEditMinutes = kind === "TALK" || kind === "OPENING_PRAYER" || kind === "CLOSING_PRAYER" || kind === "TESTIMONY";
                const dbAssign = dbAssignments.find(
                  (a) =>
                    a.planner_id === x.planner_id &&
                    a.week_id === x.week_id &&
                    a.person.trim().toLowerCase() === x.person.trim().toLowerCase() &&
                    a.role === x.role
                );
                return (
                  <div
                    key={x.key}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--border)] bg-white p-3 hover:bg-slate-50"
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
                        <div className="mt-0.5 text-xs text-slate-600 flex items-center flex-wrap gap-1.5">
                          <span>{formatDateShort(x.date)}</span>
                          {x.topic ? <span>• {x.topic}</span> : null}
                          {x.reference ? <span>• <span className="italic text-slate-500">Ref: {x.reference}</span></span> : null}
                          {dbAssign?.sent_status && (
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                              dbAssign.sent_status === "SENT"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-blue-50 text-blue-700 border-blue-200"
                            }`}>
                              {dbAssign.sent_status === "SENT" ? "Sent" : "Reminded"}
                            </span>
                          )}
                        </div>
                      </div>
                    </label>
 
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <div className="text-[11px] text-slate-500 font-medium">Minutes</div>
                        <input
                          className="w-[76px] rounded-md border border-[color:var(--border)] px-2 py-1 text-sm font-medium"
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
 
                      <div className="flex items-center gap-1 border-l border-slate-200 pl-3">
                        <button
                          type="button"
                          onClick={() => openMessageModal(x, "whatsapp")}
                          className="rounded-lg p-1.5 hover:bg-emerald-50 text-emerald-600 transition-all border border-transparent hover:border-emerald-100"
                          title="Notify via WhatsApp"
                        >
                          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.709 1.458h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => openMessageModal(x, "email")}
                          className="rounded-lg p-1.5 hover:bg-blue-50 text-blue-600 transition-all border border-transparent hover:border-blue-100"
                          title="Notify via Email"
                        >
                          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                            <polyline points="22,6 12,13 2,6" />
                          </svg>
                        </button>
                      </div>
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

      {activeMsgItem && msgChannel && (
        <Modal
          open={true}
          title={`Send Notification to ${activeMsgItem.person}`}
          onClose={() => {
            setActiveMsgItem(null);
            setMsgChannel(null);
          }}
          footer={
            <>
              <Button
                onClick={handleSendMessage}
                disabled={msgChannel === "whatsapp" ? !msgPhone.trim() : !msgEmail.trim()}
              >
                {msgChannel === "whatsapp" ? "Open WhatsApp" : "Open Email Client"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setActiveMsgItem(null);
                  setMsgChannel(null);
                }}
              >
                Cancel
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Phone Number (WhatsApp)</Label>
                <Input
                  placeholder="e.g. 08033333333 or +234..."
                  value={msgPhone}
                  onChange={(e) => setMsgPhone(e.target.value)}
                />
                {msgChannel === "whatsapp" && !msgPhone.trim() && (
                  <p className="text-xs text-rose-500 font-semibold">⚠️ A phone number is required to send via WhatsApp.</p>
                )}
              </div>
              <div className="space-y-1">
                <Label>Email Address</Label>
                <Input
                  type="email"
                  placeholder="e.g. member@email.com"
                  value={msgEmail}
                  onChange={(e) => setMsgEmail(e.target.value)}
                />
                {msgChannel === "email" && !msgEmail.trim() && (
                  <p className="text-xs text-rose-500 font-semibold">⚠️ An email address is required to send via Email.</p>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label>Message Template Type</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMsgTemplate("new")}
                  className={`flex-1 py-2 px-3 rounded-md text-xs font-semibold border transition-all ${
                    msgTemplate === "new"
                      ? "bg-slate-900 border-slate-900 text-white shadow-sm"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  New Assignment Invite
                </button>
                <button
                  type="button"
                  onClick={() => setMsgTemplate("reminder")}
                  className={`flex-1 py-2 px-3 rounded-md text-xs font-semibold border transition-all ${
                    msgTemplate === "reminder"
                      ? "bg-slate-900 border-slate-900 text-white shadow-sm"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Assignment Reminder
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Message Text Preview (Editable)</Label>
              <Textarea
                rows={8}
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                className="text-xs font-mono bg-slate-50 border-slate-200"
              />
            </div>
          </div>
        </Modal>
      )}

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
