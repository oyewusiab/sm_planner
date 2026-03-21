import { useMemo, useState } from "react";
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
import { getDB, ids, time, updateDB } from "../utils/storage";
import { listNotificationsForUser, markAllRead, markRead, notifyUser } from "../utils/notifications";

function normalizePersonName(s: string) {
  return (s || "")
    .replace(/^brother\s+/i, "")
    .replace(/^sister\s+/i, "")
    .trim();
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
  const [tab, setTab] = useState<TabKey>("inbox");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [q, setQ] = useState("");

  const notifs = useMemo(() => {
    const all = listNotificationsForUser(user.user_id);
    const filtered = onlyUnread ? all.filter((n) => !n.read) : all;
    if (!q.trim()) return filtered;
    const s = q.trim().toLowerCase();
    return filtered.filter((n) => (n.title + "\n" + n.body).toLowerCase().includes(s));
  }, [user.user_id, onlyUnread, q]);

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
    const mine = all.filter((t) => !t.assigned_to_user_id || t.assigned_to_user_id === user.user_id);
    return mine.sort((a, b) => (a.status + (a.due_date || "") + a.title).localeCompare(b.status + (b.due_date || "") + b.title));
  }, [db.TODOS, user.user_id]);

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
                      <Button
                        variant="secondary"
                        onClick={() => {
                          markRead(n.notification_id);
                          onChanged();
                        }}
                      >
                        Mark read
                      </Button>
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
                <CardTitle>Next 14 days</CardTitle>
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
                          (a.topic ? `\nTopic: ${a.topic}` : "");
                        return (
                          <tr key={a.assignment_id} className="border-t border-[color:var(--border)]">
                            <td className="p-3">{formatDateShort(a.date)}</td>
                            <td className="p-3 font-medium">{a.person}</td>
                            <td className="p-3">{a.role}</td>
                            <td className="p-3 text-slate-600">{a.topic || "—"}</td>
                            <td className="p-3">
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  const ok = sendReminderForAssignment(a.person, reminderBody);
                                  if (!ok) {
                                    alert(
                                      "No matching user account was found for this person name. Add/create a user (Settings) to send internal reminders."
                                    );
                                  }
                                }}
                              >
                                Send reminder
                              </Button>
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
                        {t.status !== "DONE" ? (
                          <Button variant="secondary" onClick={() => setTodoStatus(t.todo_id, "DONE")}>
                            Mark done
                          </Button>
                        ) : (
                          <Button variant="ghost" onClick={() => setTodoStatus(t.todo_id, "OPEN")}>
                            Re‑open
                          </Button>
                        )}
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

      <div className="text-xs text-slate-500">
        This MVP uses browser storage. Notifications and to‑dos are local to this device.
      </div>
    </div>
  );
}
