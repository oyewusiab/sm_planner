import { useEffect, useMemo, useState } from "react";
import type { PlannerApprovalRequest, SettingsChangeRequest, TodoItem, TodoPriority, UnitSettings, User } from "../types";
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
import { formatDateShort, formatTime12h, getTodayPartsInTimeZone, monthName } from "../utils/date";
import { getDB, ids, time, updateDB, useTable } from "../utils/storage";
import { Modal } from "../components/Modal";
import { listNotificationsForUser, markAllRead, markRead, notifyUser } from "../utils/notifications";

function normalizePersonName(s: string) {
  return (s || "")
    .replace(/^brother\s+/i, "")
    .replace(/^sister\s+/i, "")
    .trim();
}

function formatPhoneForWhatsApp(phone: string) {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0") && cleaned.length === 11) {
    return "234" + cleaned.substring(1);
  }
  return cleaned;
}

function dearPrefix(gender?: string) {
  if (gender === "M") return "Brother";
  if (gender === "F") return "Sister";
  return "Brother/Sister";
}

function generateMessageTextForDue(
  assignment: any,
  template: "new" | "reminder",
  unit: UnitSettings
) {
  const genderPrefix = dearPrefix(assignment.gender);
  const dateStr = formatDateShort(assignment.date);

  const fromName = "Ward Secretary";
  const unitName = unit.unit_name || "Ward";

  const assignmentLine = (() => {
    const roleLower = assignment.role.toLowerCase();
    if (roleLower.includes("invocation")) return "give the Opening Prayer";
    if (roleLower.includes("benediction")) return "give the Closing Prayer";
    if (roleLower.includes("testimony")) return "bear your Testimony";
    if (roleLower.includes("speaker") || roleLower.includes("talk")) {
      let line = `give a talk on the topic: "${assignment.topic || 'assigned topic'}"`;
      if (assignment.reference) {
        line += ` (Reference: ${assignment.reference})`;
      }
      return line;
    }
    return assignment.role;
  })();

  const allottedStr = assignment.minutes ? ` (Time allotted: ${assignment.minutes} minutes)` : "";

  if (template === "new") {
    return `Dear ${genderPrefix} ${assignment.person.replace(/^Brother\s+|^Sister\s+/i, "")},

On behalf of the Bishopric of the ${unitName}, you have been assigned to ${assignmentLine}${allottedStr} in Sacrament Meeting on ${dateStr}.

Please plan to arrive at the chapel and join the Bishopric on the stand 15 minutes before the meeting starts.

If for any reason you are unable to fulfill this assignment, please contact the Bishopric or the Ward Secretary as soon as possible.

Warm regards,
${unitName} Bishopric`;
  } else {
    return `Dear ${genderPrefix} ${assignment.person.replace(/^Brother\s+|^Sister\s+/i, "")},

This is a gentle reminder from the ${unitName} Bishopric regarding your assignment to ${assignmentLine}${allottedStr} in Sacrament Meeting this Sunday, ${dateStr}.

We look forward to your message. Please reply to this message to confirm your availability.

Warm regards,
${unitName} Bishopric`;
  }
}

function clampPatch(patch: Partial<UnitSettings>): Partial<UnitSettings> {
  // Keep approvals safe by only allowing these fields to be applied.
  return {
    unit_name: patch.unit_name,
    stake_name: patch.stake_name,
    unit_type: patch.unit_type,
    leader_name: patch.leader_name,
    phone: patch.phone,
    venue: patch.venue,
    meeting_time: patch.meeting_time,
    prefs: patch.prefs
      ? {
          default_speakers: patch.prefs.default_speakers,
          default_meeting_duration_min: patch.prefs.default_meeting_duration_min,
          enable_checklist: patch.prefs.enable_checklist,
          checklist_tasks: patch.prefs.checklist_tasks,
          assignment_message_template: patch.prefs.assignment_message_template,
          default_country: patch.prefs.default_country,
        }
      : undefined,
  };
}

type TabKey = "inbox" | "due" | "todos" | "approvals";

export function NotificationsPage({
  user,
  unit,
  onChanged,
}: {
  user: User;
  unit: UnitSettings;
  onChanged: () => void;
}) {
  const db = getDB();
  const { data: members = [] } = useTable("MEMBERS");

  const [activeMsgItem, setActiveMsgItem] = useState<any | null>(null);
  const [msgChannel, setMsgChannel] = useState<"whatsapp" | "email" | null>(null);
  const [msgPhone, setMsgPhone] = useState("");
  const [msgEmail, setMsgEmail] = useState("");
  const [msgTemplate, setMsgTemplate] = useState<"new" | "reminder">("reminder");
  const [msgText, setMsgText] = useState("");
  const [tab, setTab] = useState<TabKey>("inbox");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | string>("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [todoScope, setTodoScope] = useState<"mine" | "all">("mine");
  const [todoStatusFilter, setTodoStatusFilter] = useState<"all" | "open" | "done">("all");

  const notifs = useMemo(() => {
    const all = listNotificationsForUser(user.user_id);
    const filtered = all.filter((n) => {
      if (onlyUnread && n.read) return false;
      if (typeFilter !== "ALL" && n.type !== typeFilter) return false;
      const d = n.created_date.slice(0, 10);
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });
    if (!q.trim()) return filtered;
    const s = q.trim().toLowerCase();
    return filtered.filter((n) => (n.title + "\n" + n.body).toLowerCase().includes(s));
  }, [user.user_id, onlyUnread, q, typeFilter, fromDate, toDate]);

  const today = useMemo(() => getTodayPartsInTimeZone(), []);
  const todayISO = `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;

  const dueAssignments = useMemo(() => {
    const daysAhead = 14;
    const start = new Date(today.year, today.month - 1, today.day);
    const end = new Date(start);
    end.setDate(end.getDate() + daysAhead);
    const endISO = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;

    return [...db.ASSIGNMENTS]
      .filter((a) => a.date >= todayISO && a.date <= endISO)
      .sort((a, b) => (a.date + a.person + a.role).localeCompare(b.date + b.person + b.role));
  }, [db.ASSIGNMENTS, today.year, today.month, today.day, todayISO]);

  const users = useMemo(
    () => [...db.USERS].sort((a, b) => a.name.localeCompare(b.name)),
    [db.USERS]
  );

  const todos = useMemo(() => {
    const all = (db.TODOS as TodoItem[]).slice();
    const scoped =
      todoScope === "all" && user.role === "ADMIN"
        ? all
        : all.filter((t) => !t.assigned_to_user_id || t.assigned_to_user_id === user.user_id);
    const filtered = scoped.filter((t) => {
      if (todoStatusFilter === "open") return t.status !== "DONE";
      if (todoStatusFilter === "done") return t.status === "DONE";
      return true;
    });
    return filtered.sort((a, b) => (a.status + (a.due_date || "") + a.title).localeCompare(b.status + (b.due_date || "") + b.title));
  }, [db.TODOS, user.user_id, user.role, todoScope, todoStatusFilter]);

  const pendingApprovals = useMemo(() => {
    const settings = [...db.SETTINGS_REQUESTS].filter((r) => r.status === "PENDING");
    const planners = [...db.PLANNER_APPROVAL_REQUESTS].filter((r) => r.status === "PENDING");
    return { settings, planners };
  }, [db.SETTINGS_REQUESTS, db.PLANNER_APPROVAL_REQUESTS]);

  const [todoDraft, setTodoDraft] = useState<{
    title: string;
    details: string;
    due_date: string;
    priority: TodoPriority;
    assigned_to_user_id: string;
  }>({
    title: "",
    details: "",
    due_date: "",
    priority: "NORMAL",
    assigned_to_user_id: "",
  });

  const [reminderDraft, setReminderDraft] = useState<{ to_user_id: string; title: string; body: string }>({
    to_user_id: "",
    title: "Reminder",
    body: "",
  });

  function createTodo() {
    if (!todoDraft.title.trim()) return;
    const row: TodoItem = {
      todo_id: ids.uid("todo"),
      title: todoDraft.title.trim(),
      details: todoDraft.details.trim() || undefined,
      due_date: todoDraft.due_date || undefined,
      priority: todoDraft.priority,
      status: "OPEN",
      assigned_to_user_id: todoDraft.assigned_to_user_id || undefined,
      created_by_user_id: user.user_id,
      created_date: time.nowISO(),
      updated_date: time.nowISO(),
    };

    updateDB((db0) => ({ ...db0, TODOS: [row, ...db0.TODOS] }));

    if (row.assigned_to_user_id) {
      notifyUser({
        to_user_id: row.assigned_to_user_id,
        type: "TODO_ASSIGNED",
        title: `To-do assigned: ${row.title}`,
        body: `${user.name} assigned you a task.${row.due_date ? `\nDue: ${formatDateShort(row.due_date)}` : ""}`,
        meta: { todo_id: row.todo_id },
      });
    }

    setTodoDraft({ title: "", details: "", due_date: "", priority: "NORMAL", assigned_to_user_id: "" });
    onChanged();
  }

  function setTodoStatus(todo_id: string, status: TodoItem["status"]) {
    updateDB((db0) => {
      const TODOS = (db0.TODOS as TodoItem[]).map((t) =>
        t.todo_id === todo_id
          ? {
              ...t,
              status,
              updated_date: time.nowISO(),
              completed_date: status === "DONE" ? time.nowISO() : undefined,
            }
          : t
      );
      return { ...db0, TODOS };
    });
    onChanged();
  }

  function sendReminderToUser(to_user_id: string, title: string, body: string) {
    if (!to_user_id) return;
    notifyUser({ to_user_id, type: "REMINDER", title, body });
    onChanged();
  }

  function sendReminderForAssignment(person: string, body: string) {
    const name = normalizePersonName(person);
    const u = db.USERS.find((x) => normalizePersonName(x.name).toLowerCase() === name.toLowerCase());
    if (!u) return false;
    sendReminderToUser(u.user_id, "Assignment reminder", body);
    return true;
  }

  function markUnread(notification_id: string) {
    updateDB((db0) => ({
      ...db0,
      NOTIFICATIONS: db0.NOTIFICATIONS.map((n) =>
        n.notification_id === notification_id ? { ...n, read: false } : n
      ),
    }));
    onChanged();
  }

  function deleteNotification(notification_id: string) {
    updateDB((db0) => ({
      ...db0,
      NOTIFICATIONS: db0.NOTIFICATIONS.filter((n) => n.notification_id !== notification_id),
    }));
    onChanged();
  }

  function clearReadNotifications() {
    updateDB((db0) => ({
      ...db0,
      NOTIFICATIONS: db0.NOTIFICATIONS.filter((n) => n.to_user_id !== user.user_id || !n.read),
    }));
    onChanged();
  }

  function openMessageModal(item: any, channel: "whatsapp" | "email") {
    const member = members.find((m) => m.name.trim().toLowerCase() === item.person.trim().toLowerCase());
    const phone = member?.phone || "";
    const email = member?.email || "";

    setActiveMsgItem(item);
    setMsgChannel(channel);
    setMsgPhone(phone);
    setMsgEmail(email);
    setMsgTemplate("reminder"); // Default to reminder for due assignments

    // We can guess gender from the member if present
    const augmentedItem = {
      ...item,
      gender: member?.gender,
    };

    const text = generateMessageTextForDue(augmentedItem, "reminder", unit);
    setMsgText(text);
  }

  // Update text when template changes
  useEffect(() => {
    if (activeMsgItem) {
      const member = members.find((m) => m.name.trim().toLowerCase() === activeMsgItem.person.trim().toLowerCase());
      const augmentedItem = {
        ...activeMsgItem,
        gender: member?.gender,
      };
      const text = generateMessageTextForDue(augmentedItem, msgTemplate, unit);
      setMsgText(text);
    }
  }, [msgTemplate, activeMsgItem, unit, members]);

  function handleSendMessage() {
    if (!activeMsgItem || !msgChannel) return;

    if (msgChannel === "whatsapp") {
      const whatsappUrl = `https://wa.me/${formatPhoneForWhatsApp(msgPhone)}?text=${encodeURIComponent(msgText)}`;
      window.open(whatsappUrl, "_blank");
    } else {
      const mailtoUrl = `mailto:${msgEmail}?subject=${encodeURIComponent("Sacrament Meeting Assignment - " + formatDateShort(activeMsgItem.date))}&body=${encodeURIComponent(msgText)}`;
      window.open(mailtoUrl, "_self");
    }

    // Update assignment status if the assignment exists in the database
    updateDB((db0) => {
      const list = [...db0.ASSIGNMENTS];
      const idx = list.findIndex(
        (a) =>
          a.planner_id === activeMsgItem.planner_id &&
          a.week_id === activeMsgItem.week_id &&
          a.person.trim().toLowerCase() === activeMsgItem.person.trim().toLowerCase() &&
          a.role === activeMsgItem.role
      );

      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          sent_status: msgTemplate === "new" ? "SENT" : "REMINDED",
          sent_date: time.nowISO(),
        };
      }
      return { ...db0, ASSIGNMENTS: list };
    });

    setActiveMsgItem(null);
    setMsgChannel(null);
    onChanged();
  }

  function deleteTodo(todo_id: string) {
    updateDB((db0) => ({
      ...db0,
      TODOS: db0.TODOS.filter((t) => t.todo_id !== todo_id),
    }));
    onChanged();
  }

  function sendReminderToAllDue() {
    let sent = 0;
    let unmatched = 0;
    for (const a of dueAssignments) {
      const body =
        `${unit.unit_name}\n` +
        `Assignment: ${a.role}\n` +
        `Date: ${formatDateShort(a.date)}\n` +
        `Venue: ${a.venue}\n` +
        `Time: ${formatTime12h(a.meeting_time)}` +
        (a.topic ? `\nTopic: ${a.topic}` : "") +
        (a.reference ? `\nReference: ${a.reference}` : "");
      const ok = sendReminderForAssignment(a.person, body);
      if (ok) sent += 1;
      else unmatched += 1;
    }
    alert(`Reminders sent: ${sent}\nNo linked user account: ${unmatched}`);
  }

  function approveRequest(req: SettingsChangeRequest) {
    if (user.role !== "ADMIN") return;
    const patch = clampPatch(req.patch);
    updateDB((db0) => {
      const UNIT_SETTINGS = db0.UNIT_SETTINGS ? ({ ...db0.UNIT_SETTINGS, ...patch } as UnitSettings) : db0.UNIT_SETTINGS;
      const SETTINGS_REQUESTS = db0.SETTINGS_REQUESTS.map((r) =>
        r.request_id === req.request_id
          ? {
              ...r,
              status: "APPROVED" as const,
              decided_by: user.user_id,
              decided_date: time.nowISO(),
            }
          : r
      );
      return { ...db0, UNIT_SETTINGS, SETTINGS_REQUESTS };
    });

    notifyUser({
      to_user_id: req.requested_by,
      type: "SETTINGS_APPROVAL_DECISION",
      title: "Settings request approved",
      body: "Your request to update platform settings was approved and applied.",
      meta: { request_id: req.request_id },
    });

    onChanged();
  }

  function rejectRequest(req: SettingsChangeRequest) {
    if (user.role !== "ADMIN") return;
    updateDB((db0) => {
      const SETTINGS_REQUESTS = db0.SETTINGS_REQUESTS.map((r) =>
        r.request_id === req.request_id
          ? {
              ...r,
              status: "REJECTED" as const,
              decided_by: user.user_id,
              decided_date: time.nowISO(),
            }
          : r
      );
      return { ...db0, SETTINGS_REQUESTS };
    });

    notifyUser({
      to_user_id: req.requested_by,
      type: "SETTINGS_APPROVAL_DECISION",
      title: "Settings request rejected",
      body: "Your request to update platform settings was not approved.",
      meta: { request_id: req.request_id },
    });

    onChanged();
  }

  function approvePlannerRequest(req: PlannerApprovalRequest) {
    if (user.role !== "ADMIN") return;
    updateDB((db0) => {
      const PLANNER_APPROVAL_REQUESTS = db0.PLANNER_APPROVAL_REQUESTS.map((r) =>
        r.request_id === req.request_id
          ? { ...r, status: "APPROVED" as const, decided_by: user.user_id, decided_date: time.nowISO() }
          : r
      );

      const PLANNERS = db0.PLANNERS.map((p) => {
        if (p.planner_id !== req.planner_id) return p;
        if (req.type === "EDIT") return { ...p, state: "DRAFT" as const, updated_date: time.nowISO() };
        if (req.type === "SUBMIT") return { ...p, state: "SUBMITTED" as const, updated_date: time.nowISO() };
        return p;
      });

      return { ...db0, PLANNER_APPROVAL_REQUESTS, PLANNERS };
    });

    notifyUser({
      to_user_id: req.requested_by,
      type: "PLANNER_APPROVAL_DECISION",
      title: `Planner ${req.type === "EDIT" ? "edit" : "submission"} request approved`,
      body: `Your request was approved. The planner is now ${req.type === "EDIT" ? "back in DRAFT mode" : "SUBMITTED"}.`,
      meta: { request_id: req.request_id, planner_id: req.planner_id },
    });

    onChanged();
  }

  function rejectPlannerRequest(req: PlannerApprovalRequest) {
    if (user.role !== "ADMIN") return;
    updateDB((db0) => {
      const PLANNER_APPROVAL_REQUESTS = db0.PLANNER_APPROVAL_REQUESTS.map((r) =>
        r.request_id === req.request_id
          ? { ...r, status: "REJECTED" as const, decided_by: user.user_id, decided_date: time.nowISO() }
          : r
      );
      return { ...db0, PLANNER_APPROVAL_REQUESTS };
    });

    notifyUser({
      to_user_id: req.requested_by,
      type: "PLANNER_APPROVAL_DECISION",
      title: `Planner ${req.type === "EDIT" ? "edit" : "submission"} request rejected`,
      body: "Your request was not approved.",
      meta: { request_id: req.request_id },
    });

    onChanged();
  }

  const tabs: { key: TabKey; label: string; badge?: number; show?: boolean }[] = [
    { key: "inbox", label: "Inbox", badge: notifs.filter((n) => !n.read).length },
    { key: "due", label: "Due Assignments", badge: dueAssignments.length },
    { key: "todos", label: "To‑Dos", badge: todos.filter((t) => t.status === "OPEN").length },
    { key: "approvals", label: "Approvals", badge: pendingApprovals.settings.length + pendingApprovals.planners.length, show: user.role === "ADMIN" },
  ];

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Notifications Center"
        subtitle="Due assignments, reminders, to‑dos, and approvals in one place."
      />

      <Card>
        <CardBody className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {tabs
              .filter((t) => t.show !== false)
              .map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={
                    "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm " +
                    (tab === t.key
                      ? "border-sky-200 bg-sky-50 text-sky-900"
                      : "border-[color:var(--border)] bg-white text-slate-700 hover:bg-slate-50")
                  }
                >
                  <span className="font-medium">{t.label}</span>
                  {typeof t.badge === "number" ? <Badge tone={tab === t.key ? "blue" : "gray"}>{t.badge}</Badge> : null}
                </button>
              ))}
          </div>

          {tab === "inbox" ? (
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <Input placeholder="Search inbox…" value={q} onChange={(e) => setQ(e.target.value)} />
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="ALL">All types</option>
                <option value="REMINDER">Reminder</option>
                <option value="TODO_ASSIGNED">To-do assigned</option>
                <option value="TODO_COMPLETED">To-do completed</option>
                <option value="PLANNER_SUBMITTED">Planner submitted</option>
                <option value="MUSIC_INPUT_REQUEST">Music input request</option>
                <option value="SETTINGS_APPROVAL_REQUEST">Settings request</option>
                <option value="SETTINGS_APPROVAL_DECISION">Settings decision</option>
                <option value="PLANNER_APPROVAL_REQUEST">Planner approval request</option>
                <option value="PLANNER_APPROVAL_DECISION">Planner approval decision</option>
              </Select>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
                Unread only
              </label>
              <Button
                variant="secondary"
                onClick={() => {
                  markAllRead(user.user_id);
                  onChanged();
                }}
              >
                Mark all read
              </Button>
              <Button variant="secondary" onClick={clearReadNotifications}>
                Clear read
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {tab === "inbox" ? (
        <div className="space-y-3">
          {notifs.length === 0 ? (
            <EmptyState title="Inbox" body="No notifications yet." />
          ) : (
            notifs.map((n) => (
              <Card key={n.notification_id} className={n.read ? "" : "border-sky-200 bg-sky-50"}>
                <CardBody>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">{n.title}</div>
                        {!n.read ? <Badge tone="blue">New</Badge> : <Badge tone="gray">Read</Badge>}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{n.body}</div>
                      <div className="mt-2 text-xs text-slate-500">{new Date(n.created_date).toLocaleString()}</div>
                    </div>
                    <div className="shrink-0">
                      <div className="flex flex-col gap-2">
                        {!n.read ? (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              markRead(n.notification_id);
                              onChanged();
                            }}
                          >
                            Mark read
                          </Button>
                        ) : (
                          <Button variant="secondary" onClick={() => markUnread(n.notification_id)}>
                            Mark unread
                          </Button>
                        )}
                        <Button variant="ghost" onClick={() => deleteNotification(n.notification_id)}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))
          )}

          <Card>
            <CardHeader>
              <CardTitle>Quick Reminder</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1 md:col-span-1">
                  <Label>Send to</Label>
                  <Select
                    value={reminderDraft.to_user_id}
                    onChange={(e) => setReminderDraft((s) => ({ ...s, to_user_id: e.target.value }))}
                  >
                    <option value="">Select user…</option>
                    {users.map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.name} {u.calling ? `(${u.calling})` : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label>Title</Label>
                  <Input value={reminderDraft.title} onChange={(e) => setReminderDraft((s) => ({ ...s, title: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Message</Label>
                <Textarea
                  rows={3}
                  value={reminderDraft.body}
                  onChange={(e) => setReminderDraft((s) => ({ ...s, body: e.target.value }))}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    sendReminderToUser(reminderDraft.to_user_id, reminderDraft.title || "Reminder", reminderDraft.body || "");
                    setReminderDraft({ to_user_id: "", title: "Reminder", body: "" });
                  }}
                  disabled={!reminderDraft.to_user_id}
                >
                  Send reminder
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "due" ? (
        <div className="space-y-3">
          {dueAssignments.length === 0 ? (
            <EmptyState
              title="Due Assignments"
              body="No assignments are due in the next 14 days. Generate assignments from a submitted planner to see them here."
            />
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>Next 14 days</CardTitle>
                  <Button variant="secondary" onClick={sendReminderToAllDue}>
                    Send reminders to all
                  </Button>
                </div>
              </CardHeader>
              <CardBody>
                <div className="overflow-hidden rounded-xl border border-[color:var(--border)]">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="p-3 font-medium text-slate-600">Date</th>
                        <th className="p-3 font-medium text-slate-600">Person</th>
                        <th className="p-3 font-medium text-slate-600">Assignment</th>
                        <th className="p-3 font-medium text-slate-600">Topic / Note</th>
                        <th className="p-3 font-medium text-slate-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dueAssignments.map((a) => {
                        const reminderBody =
                          `${unit.unit_name}\n` +
                          `Assignment: ${a.role}\n` +
                          `Date: ${formatDateShort(a.date)}\n` +
                          `Venue: ${a.venue}\n` +
                          `Time: ${formatTime12h(a.meeting_time)}` +
                          (a.topic ? `\nTopic: ${a.topic}` : "") +
                          (a.reference ? `\nReference: ${a.reference}` : "");
                        return (
                          <tr key={a.assignment_id} className="border-t border-[color:var(--border)] hover:bg-slate-50/50">
                            <td className="p-3 whitespace-nowrap">{formatDateShort(a.date)}</td>
                            <td className="p-3 font-medium">
                              <div className="flex items-center gap-2">
                                <span>{a.person}</span>
                                {a.sent_status && (
                                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                    a.sent_status === "SENT"
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : "bg-blue-50 text-blue-700 border-blue-200"
                                  }`}>
                                    {a.sent_status === "SENT" ? "Sent" : "Reminded"}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-3">{a.role}</td>
                             <td className="p-3 text-slate-600 max-w-[200px] truncate" title={`${a.topic || ""}${a.reference ? ` (${a.reference})` : ""}`}>
                              {a.topic || "—"}
                              {a.reference ? <span className="block text-[10px] text-slate-400 italic">Ref: {a.reference}</span> : null}
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    const ok = sendReminderForAssignment(a.person, reminderBody);
                                    if (!ok) {
                                      alert(
                                        "No matching user account was found for this person name. Add/create a user (Settings) to send internal reminders."
                                      );
                                    }
                                  }}
                                  title="Send Internal App Notification"
                                >
                                  Internal
                                </Button>
                                
                                <button
                                  type="button"
                                  onClick={() => openMessageModal(a, "whatsapp")}
                                  className="rounded-lg p-1.5 hover:bg-emerald-50 text-emerald-600 transition-all border border-transparent hover:border-emerald-100"
                                  title="Notify via WhatsApp"
                                >
                                  <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.709 1.458h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                                  </svg>
                                </button>
                                
                                <button
                                  type="button"
                                  onClick={() => openMessageModal(a, "email")}
                                  className="rounded-lg p-1.5 hover:bg-blue-50 text-blue-600 transition-all border border-transparent hover:border-blue-100"
                                  title="Notify via Email"
                                >
                                  <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                    <polyline points="22,6 12,13 2,6" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 text-xs text-slate-500">
                  Tip: Reminders are internal platform notifications. For SMS/WhatsApp reminders, we can add that in a future step.
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      ) : null}

      {tab === "todos" ? (
        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Create To‑Do</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="space-y-1 md:col-span-2">
                  <Label>Title</Label>
                  <Input value={todoDraft.title} onChange={(e) => setTodoDraft((s) => ({ ...s, title: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Due date (optional)</Label>
                  <Input
                    type="date"
                    value={todoDraft.due_date}
                    onChange={(e) => setTodoDraft((s) => ({ ...s, due_date: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Priority</Label>
                  <Select
                    value={todoDraft.priority}
                    onChange={(e) => setTodoDraft((s) => ({ ...s, priority: e.target.value as TodoPriority }))}
                  >
                    <option value="LOW">Low</option>
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Details (optional)</Label>
                <Textarea
                  rows={3}
                  value={todoDraft.details}
                  onChange={(e) => setTodoDraft((s) => ({ ...s, details: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Assign to (optional)</Label>
                  <Select
                    value={todoDraft.assigned_to_user_id}
                    onChange={(e) => setTodoDraft((s) => ({ ...s, assigned_to_user_id: e.target.value }))}
                  >
                    <option value="">Unassigned (my to‑do)</option>
                    {users.map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.name} {u.calling ? `(${u.calling})` : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex items-end justify-end">
                  <Button onClick={createTodo}>Add to‑do</Button>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>My To‑Dos</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label>Scope</Label>
                  <Select value={todoScope} onChange={(e) => setTodoScope(e.target.value as "mine" | "all")}>
                    <option value="mine">Mine</option>
                    {user.role === "ADMIN" ? <option value="all">All users</option> : null}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Status</Label>
                  <Select value={todoStatusFilter} onChange={(e) => setTodoStatusFilter(e.target.value as "all" | "open" | "done")}>
                    <option value="all">All</option>
                    <option value="open">Open</option>
                    <option value="done">Done</option>
                  </Select>
                </div>
              </div>
              {todos.length === 0 ? (
                <EmptyState title="To‑Dos" body="No tasks yet." />
              ) : (
                todos.map((t) => (
                  <div
                    key={t.todo_id}
                    className="rounded-xl border border-[color:var(--border)] bg-white p-3"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-slate-900">{t.title}</div>
                          <Badge tone={t.status === "DONE" ? "green" : t.priority === "HIGH" ? "amber" : "gray"}>
                            {t.status === "DONE" ? "Done" : t.priority === "HIGH" ? "High" : "Open"}
                          </Badge>
                          {t.due_date ? <Badge tone="blue">Due {formatDateShort(t.due_date)}</Badge> : null}
                        </div>
                        {t.details ? <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{t.details}</div> : null}
                        <div className="mt-2 text-xs text-slate-500">
                          Created {new Date(t.created_date).toLocaleString()}
                        </div>
                      </div>
                      <div className="shrink-0">
                        <div className="flex gap-2">
                          {t.status !== "DONE" ? (
                            <Button variant="secondary" onClick={() => setTodoStatus(t.todo_id, "DONE")}>
                              Mark done
                            </Button>
                          ) : (
                            <Button variant="ghost" onClick={() => setTodoStatus(t.todo_id, "OPEN")}>
                              Re‑open
                            </Button>
                          )}
                          <Button variant="ghost" onClick={() => deleteTodo(t.todo_id)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "approvals" ? (
        user.role !== "ADMIN" ? (
          <EmptyState title="Approvals" body="Bishop (Admin) only." />
        ) : pendingApprovals.settings.length === 0 && pendingApprovals.planners.length === 0 ? (
          <EmptyState title="Approvals" body="No pending approval requests." />
        ) : (
          <div className="space-y-6">
            {pendingApprovals.planners.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Planner Requests</CardTitle>
                </CardHeader>
                <CardBody className="space-y-4">
                  {pendingApprovals.planners.map((r) => {
                    const requester = db.USERS.find((u) => u.user_id === r.requested_by);
                    const p = db.PLANNERS.find(x => x.planner_id === r.planner_id);
                    return (
                      <div key={r.request_id} className="rounded-xl border border-[color:var(--border)] bg-white p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-slate-900">
                                Planner {r.type === "EDIT" ? "Edit" : "Submission"} Requested
                              </div>
                              <Badge tone="amber">Pending</Badge>
                            </div>
                            <div className="mt-1 text-sm text-slate-700">
                              Planner: <span className="font-medium">{p ? `${monthName(p.month)} ${p.year}` : r.planner_id}</span>
                            </div>
                            <div className="mt-1 text-sm text-slate-700">
                              Requested by: <span className="font-medium">{requester?.name || r.requested_by}</span>
                            </div>
                            {r.reason && (
                              <div className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-600 border border-slate-100 italic">
                                "{r.reason}"
                              </div>
                            )}
                            <div className="mt-2 text-xs text-slate-500">{new Date(r.created_date).toLocaleString()}</div>
                          </div>
                          <div className="shrink-0 flex gap-2">
                            <Button onClick={() => approvePlannerRequest(r)}>Approve</Button>
                            <Button variant="secondary" onClick={() => rejectPlannerRequest(r)}>
                              Reject
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            )}

            {pendingApprovals.settings.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Settings Requests</CardTitle>
                </CardHeader>
                <CardBody className="space-y-4">
                  {pendingApprovals.settings.map((r) => {
                    const requester = db.USERS.find((u) => u.user_id === r.requested_by);
                    return (
                      <div key={r.request_id} className="rounded-xl border border-[color:var(--border)] bg-white p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-slate-900">Settings change request</div>
                              <Badge tone="amber">Pending</Badge>
                            </div>
                            <div className="mt-1 text-sm text-slate-700">
                              Requested by: <span className="font-medium">{requester?.name || r.requested_by}</span>
                            </div>
                            <div className="mt-1 text-xs text-slate-500">{new Date(r.created_date).toLocaleString()}</div>

                            <Divider className="my-3" />

                            <div className="text-xs font-medium text-slate-600">Patch</div>
                            <pre className="mt-1 overflow-auto rounded-lg border border-[color:var(--border)] bg-slate-50 p-3 text-xs text-slate-800">
                              {JSON.stringify(clampPatch(r.patch), null, 2)}
                            </pre>

                            {r.reason ? (
                              <div className="mt-2 text-sm text-slate-700">
                                Reason: <span className="font-medium">{r.reason}</span>
                              </div>
                            ) : null}
                          </div>

                          <div className="shrink-0 space-y-2">
                            <Button onClick={() => approveRequest(r)}>Approve & Apply</Button>
                            <Button variant="secondary" onClick={() => rejectRequest(r)}>
                              Reject
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            )}
          </div>
        )
      ) : null}

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

      <div className="text-xs text-slate-500">
        This MVP uses browser storage. Notifications and to‑dos are local to this device.
      </div>
    </div>
  );
}
