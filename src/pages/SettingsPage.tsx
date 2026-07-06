import { useEffect, useMemo, useState } from "react";
import type { Role, SettingsChangeRequest, UnitSettings, UnitType, User } from "../types";
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
import { can } from "../utils/permissions";
import { getDB, ids, time, updateDB } from "../utils/storage";
import { sha256 } from "../utils/crypto";
import { notifyRoles, notifyUser } from "../utils/notifications";
import * as auth from "../auth/authService";

const bishopricCallings = ["1st Counsellor", "2nd Counsellor"] as const;
const clerkCallings = ["Clerk (Co-admin)", "Assistant Clerk"] as const;
const secretaryCallings = ["Secretary", "Assistant Secretary"] as const;

type BroadcastRole = "ALL" | "ADMIN" | "BISHOPRIC" | "CLERK" | "SECRETARY" | "MUSIC";
type ImportMode = "replace" | "merge";

function parseTaskTemplates(text: string): string[] {
  return text
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function SettingsPage({
  user,
  unit,
  onChanged,
  backendStatus,
  syncing,
  syncingAction,
  onSyncNow,
  onSyncHymns,
}: {
  user: User;
  unit: UnitSettings;
  onChanged: () => void;
  backendStatus: "disabled" | "connecting" | "online" | "error";
  syncing: boolean;
  syncingAction: "sync_now" | "sync_hymns" | null;
  onSyncNow: () => void;
  onSyncHymns: () => void;
}) {
  const allowed = can(user.role, "SETTINGS");
  const isClerk = user.role === "CLERK";
  const isBishop = user.role === "ADMIN";
  const db = getDB();

  const [form, setForm] = useState<UnitSettings>({
    ...unit,
    prefs: {
      default_speakers: unit.prefs?.default_speakers ?? 3,
      default_meeting_duration_min: unit.prefs?.default_meeting_duration_min ?? 70,
      enable_checklist: unit.prefs?.enable_checklist ?? true,
      checklist_tasks: unit.prefs?.checklist_tasks ?? [],
      assignment_message_template: unit.prefs?.assignment_message_template ?? "",
      default_country: "NG",
      enable_music_toolkit: unit.prefs?.enable_music_toolkit ?? true,
      enable_member_analytics: unit.prefs?.enable_member_analytics ?? true,
      gemini_api_key: unit.prefs?.gemini_api_key || "",
    },
  });
  const [checklistTaskText, setChecklistTaskText] = useState((unit.prefs?.checklist_tasks || []).join("\n"));

  const [flash, setFlash] = useState<{ tone: "success" | "error"; msg: string } | null>(null);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    role: "CLERK" as Role,
    calling: "Clerk (Co-admin)",
    gender: "M" as "M" | "F",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [broadcastRole, setBroadcastRole] = useState<BroadcastRole>("ALL");
  const [broadcastTitle, setBroadcastTitle] = useState("General announcement");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [snapshot, setSnapshot] = useState("");
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [activeTab, setActiveTab] = useState<"general" | "private">("general");

  // Keep the form in sync if UNIT_SETTINGS changes from outside.
  useEffect(() => {
    setForm({
      ...unit,
      prefs: {
        default_speakers: unit.prefs?.default_speakers ?? 3,
        default_meeting_duration_min: unit.prefs?.default_meeting_duration_min ?? 70,
        enable_checklist: unit.prefs?.enable_checklist ?? true,
        checklist_tasks: unit.prefs?.checklist_tasks ?? [],
        assignment_message_template: unit.prefs?.assignment_message_template ?? "",
        default_country: "NG",
        enable_music_toolkit: unit.prefs?.enable_music_toolkit ?? true,
        enable_member_analytics: unit.prefs?.enable_member_analytics ?? true,
        gemini_api_key: unit.prefs?.gemini_api_key || "",
      },
    });
    setChecklistTaskText((unit.prefs?.checklist_tasks || []).join("\n"));
  }, [unit]);

  const users = useMemo(() => [...db.USERS].sort((a, b) => a.name.localeCompare(b.name)), [db.USERS]);
  const systemStats = useMemo(() => {
    const activeUsers = db.USERS.filter((u) => !u.disabled).length;
    const disabledUsers = db.USERS.filter((u) => u.disabled).length;
    const submittedPlanners = db.PLANNERS.filter((p) => p.state === "SUBMITTED").length;
    const pendingApprovals =
      db.SETTINGS_REQUESTS.filter((r) => r.status === "PENDING").length +
      db.PLANNER_APPROVAL_REQUESTS.filter((r) => r.status === "PENDING").length;
    return { activeUsers, disabledUsers, submittedPlanners, pendingApprovals };
  }, [db]);

  if (!allowed) {
    return <EmptyState title="Settings" body="Admin access only." />;
  }

  function saveUnit(kind: "unit" | "prefs") {
    setFlash(null);
    const parsedChecklistTasks = parseTaskTemplates(checklistTaskText);
    const next: UnitSettings = {
      ...form,
      unit_name: String(form.unit_name || "").trim(),
      stake_name: form.stake_name ? String(form.stake_name).trim() : undefined,
      leader_name: String(form.leader_name || "").trim(),
      phone: String(form.phone || "").trim(),
      venue: String(form.venue || "").trim(),
      meeting_time: String(form.meeting_time || "").trim(),
      prefs: {
        default_speakers: form.prefs?.default_speakers ?? 3,
        default_meeting_duration_min: form.prefs?.default_meeting_duration_min ?? 70,
        enable_checklist: form.prefs?.enable_checklist ?? true,
        checklist_tasks: parsedChecklistTasks,
        assignment_message_template: form.prefs?.assignment_message_template || "",
        default_country: "NG",
        enable_music_toolkit: form.prefs?.enable_music_toolkit ?? true,
        enable_member_analytics: form.prefs?.enable_member_analytics ?? true,
        gemini_api_key: form.prefs?.gemini_api_key || "",
      },
      venues: form.venues || [],
    };

    function showFlash(tone: "success" | "error", msg: string) {
      setFlash({ tone, msg });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    if (!next.unit_name) return showFlash("error", "Unit Name is required.");
    if (!next.leader_name) return showFlash("error", "Leader Name is required.");
    if (!next.venue) return showFlash("error", "Venue is required.");
    if (!next.meeting_time) return showFlash("error", "Meeting Time is required.");

    if (isClerk) {
      const reqId = ids.uid("sreq");
      const request: SettingsChangeRequest = {
        request_id: reqId,
        requested_by: user.user_id,
        created_date: time.nowISO(),
        status: "PENDING",
        patch: next,
      };
      updateDB((db0) => ({ ...db0, SETTINGS_REQUESTS: [request, ...(db0.SETTINGS_REQUESTS || [])] }));

      notifyRoles({
        toRoles: ["ADMIN"],
        type: "SETTINGS_APPROVAL_REQUEST",
        title: "Settings change request",
        body: `${user.name} (${user.calling}) has submitted a settings change for approval. Please visit the Approvals tab in the Notifications Center.`,
        meta: { request_id: reqId },
      });
      showFlash("success", "Request sent to Bishop for approval.");
      return;
    }

    updateDB((db0) => ({ ...db0, UNIT_SETTINGS: next }));
    onChanged();
    showFlash("success", kind === "unit" ? "Unit settings saved." : "Preferences saved.");
  }

  async function createUser() {
    if (!newUser.name.trim()) return;
    if (!newUser.email.trim()) return;
    setBusy("create");
    try {
      const hash = await sha256("welcome");
      auth.addUser(newUser.name.trim(), newUser.email.trim(), newUser.role, hash, newUser.calling, newUser.gender);
      onChanged();
      setNewUser({ name: "", email: "", role: "CLERK", calling: "Clerk (Co-admin)", gender: "M" });
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword(user_id: string) {
    if (!window.confirm("Reset this user's password to default 'welcome'?")) return;
    setBusy(user_id);
    try {
      await auth.resetUserPasswordToDefault(user_id);
      onChanged();
      alert("Password reset to 'welcome' successfully.");
    } catch (err: any) {
      alert("Reset failed: " + err.message);
    } finally {
      setBusy(null);
    }
  }

  function setRole(user_id: string, role: Role) {
    auth.setUserRole(user_id, role);
    onChanged();
  }

  function setCalling(user_id: string, calling: string) {
    auth.setUserCalling(user_id, calling);
    onChanged();
  }

  async function setGender(user_id: string, gender: "M" | "F") {
    await auth.updateUserProfile(user_id, { gender });
    onChanged();
  }

  function setDisabled(user_id: string, disabled: boolean) {
    if (user_id === user.user_id) return;
    if (disabled) {
      const ok = window.confirm("Disable this user? They will be unable to sign in.");
      if (!ok) return;
    }
    auth.setUserDisabled(user_id, disabled);
    onChanged();
  }

  function deleteUser(user_id: string) {
    if (user_id === user.user_id) return;
    const ok = window.confirm("Delete this user? This cannot be undone.");
    if (!ok) return;
    auth.deleteUser(user_id);
    onChanged();
  }

  function sendBroadcast() {
    const title = broadcastTitle.trim();
    const body = broadcastBody.trim();
    if (!title || !body) {
      setFlash({ tone: "error", msg: "Broadcast title and message are required." });
      return;
    }

    if (isBishop) {
      const targets = broadcastRole === "ALL" ? db.USERS : db.USERS.filter((u) => u.role === broadcastRole);
      if (targets.length === 0) {
        setFlash({ tone: "error", msg: "No users matched the selected target." });
        return;
      }
      for (const target of targets) {
        notifyUser({
          to_user_id: target.user_id,
          type: "REMINDER",
          title,
          body,
          meta: { source: "bishop_broadcast" },
        });
      }
      setBroadcastBody("");
      setFlash({ tone: "success", msg: `Broadcast sent to ${targets.length} user(s).` });
      onChanged();
    } else {
      // Clerk approval workflow
      const reqId = ids.uid("sreq");
      const request: SettingsChangeRequest = {
        request_id: reqId,
        requested_by: user.user_id,
        created_date: time.nowISO(),
        status: "PENDING",
        patch: {},
        broadcast: {
          role: broadcastRole,
          title,
          body
        }
      };
      updateDB((db0) => ({ ...db0, SETTINGS_REQUESTS: [request, ...(db0.SETTINGS_REQUESTS || [])] }));

      notifyRoles({
        toRoles: ["ADMIN"],
        type: "SETTINGS_APPROVAL_REQUEST",
        title: "Broadcast approval request",
        body: `${user.name} (${user.calling}) has requested a broadcast announcement approval: "${title}"`,
        meta: { request_id: reqId },
      });

      setBroadcastBody("");
      setFlash({ tone: "success", msg: "Broadcast request submitted to Bishop for approval." });
      onChanged();
    }
  }

  function setPasswordResetForAll(forceReset: boolean) {
    if (!isBishop) return;
    updateDB((db0) => ({
      ...db0,
      USERS: db0.USERS.map((u) => (u.role === "ADMIN" ? u : { ...u, must_reset_password: forceReset })),
    }));
    setFlash({
      tone: "success",
      msg: forceReset
        ? "All non-admin users will reset password on next login."
        : "Forced password reset cleared for non-admin users.",
    });
    onChanged();
  }

  function setDisabledForAllNonAdmin(disabled: boolean) {
    if (!isBishop) return;
    if (disabled && !window.confirm("Disable all non-admin users?")) return;
    updateDB((db0) => ({
      ...db0,
      USERS: db0.USERS.map((u) => (u.role === "ADMIN" ? u : { ...u, disabled })),
    }));
    setFlash({ tone: "success", msg: disabled ? "All non-admin users disabled." : "All non-admin users enabled." });
    onChanged();
  }

  function exportSnapshot() {
    setSnapshot(JSON.stringify(getDB(), null, 2));
    setFlash({ tone: "success", msg: "Snapshot generated." });
  }

  function mergeById<T extends Record<string, any>>(base: T[], incoming: T[], idKey: string): T[] {
    const map = new Map<string, T>();
    for (const row of base || []) map.set(String(row[idKey] || ""), row);
    for (const row of incoming || []) {
      const id = String(row[idKey] || "");
      if (!id) continue;
      map.set(id, { ...(map.get(id) || {}), ...row });
    }
    return [...map.values()];
  }

  function importSnapshot() {
    if (!isBishop) return;
    if (!snapshot.trim()) {
      setFlash({ tone: "error", msg: "Paste snapshot JSON first." });
      return;
    }
    try {
      const raw = JSON.parse(snapshot);
      const current = getDB() as any;
      const incoming = {
        UNIT_SETTINGS: raw?.UNIT_SETTINGS ?? null,
        USERS: Array.isArray(raw?.USERS) ? raw.USERS : [],
        PLANNERS: Array.isArray(raw?.PLANNERS) ? raw.PLANNERS : [],
        ASSIGNMENTS: Array.isArray(raw?.ASSIGNMENTS) ? raw.ASSIGNMENTS : [],
        MEMBERS: Array.isArray(raw?.MEMBERS) ? raw.MEMBERS : [],
        CHECKLISTS: Array.isArray(raw?.CHECKLISTS) ? raw.CHECKLISTS : [],
        NOTIFICATIONS: Array.isArray(raw?.NOTIFICATIONS) ? raw.NOTIFICATIONS : [],
        SETTINGS_REQUESTS: Array.isArray(raw?.SETTINGS_REQUESTS) ? raw.SETTINGS_REQUESTS : [],
        PLANNER_APPROVAL_REQUESTS: Array.isArray(raw?.PLANNER_APPROVAL_REQUESTS) ? raw.PLANNER_APPROVAL_REQUESTS : [],
        TODOS: Array.isArray(raw?.TODOS) ? raw.TODOS : [],
        REMINDERS: Array.isArray(raw?.REMINDERS) ? raw.REMINDERS : [],
        HYMNS: Array.isArray(raw?.HYMNS) ? raw.HYMNS : [],
      };

      if (importMode === "replace") {
        updateDB(() => incoming as any);
      } else {
        updateDB(() => ({
          UNIT_SETTINGS: incoming.UNIT_SETTINGS || current.UNIT_SETTINGS,
          USERS: mergeById(current.USERS, incoming.USERS, "user_id"),
          PLANNERS: mergeById(current.PLANNERS, incoming.PLANNERS, "planner_id"),
          ASSIGNMENTS: mergeById(current.ASSIGNMENTS, incoming.ASSIGNMENTS, "assignment_id"),
          MEMBERS: mergeById(current.MEMBERS, incoming.MEMBERS, "name"),
          CHECKLISTS: mergeById(current.CHECKLISTS, incoming.CHECKLISTS, "checklist_id"),
          NOTIFICATIONS: mergeById(current.NOTIFICATIONS, incoming.NOTIFICATIONS, "notification_id"),
          SETTINGS_REQUESTS: mergeById(current.SETTINGS_REQUESTS, incoming.SETTINGS_REQUESTS, "request_id"),
          PLANNER_APPROVAL_REQUESTS: mergeById(current.PLANNER_APPROVAL_REQUESTS, incoming.PLANNER_APPROVAL_REQUESTS, "request_id"),
          TODOS: mergeById(current.TODOS, incoming.TODOS, "todo_id"),
          REMINDERS: mergeById(current.REMINDERS, incoming.REMINDERS, "reminder_id"),
          HYMNS: mergeById(current.HYMNS, incoming.HYMNS, "number"),
        } as any));
      }

      setFlash({ tone: "success", msg: `Snapshot ${importMode === "replace" ? "replaced" : "merged"} successfully.` });
      onChanged();
    } catch (err: any) {
      setFlash({ tone: "error", msg: err?.message || "Invalid snapshot JSON." });
    }
  }

  return (
    <div className="space-y-6">
      <SectionTitle title="Settings" subtitle="Unit information, role management, and system preferences." />

      {flash ? (
        <div
          className={
            "rounded-xl border p-3 text-sm " +
            (flash.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900")
          }
        >
          {flash.msg}
        </div>
      ) : null}

      {/* Tabs selector for Bishop */}
      {isBishop && (
        <div className="flex border-b border-slate-200 gap-2 mb-2 no-print">
          <button
            onClick={() => setActiveTab("general")}
            className={`py-2.5 px-6 font-semibold text-sm border-b-2 transition-all cursor-pointer ${
              activeTab === "general"
                ? "border-blue-600 text-blue-600 font-bold"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            📋 General Settings
          </button>
          <button
            onClick={() => setActiveTab("private")}
            className={`py-2.5 px-6 font-semibold text-sm border-b-2 transition-all cursor-pointer ${
              activeTab === "private"
                ? "border-blue-600 text-blue-600 font-bold"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            🔒 Private Settings (Bishop Only)
          </button>
        </div>
      )}

      {/* GENERAL TAB CONTENT (visible to Clerk, or Bishop if general tab is active) */}
      {(activeTab === "general" || !isBishop) && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Unit Information</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Unit Name</Label>
                  <Input value={form.unit_name} onChange={(e) => setForm((f) => ({ ...f, unit_name: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Stake Name (optional)</Label>
                  <Input value={form.stake_name || ""} onChange={(e) => setForm((f) => ({ ...f, stake_name: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Unit Type</Label>
                  <Select value={form.unit_type} onChange={(e) => setForm((f) => ({ ...f, unit_type: e.target.value as UnitType }))}>
                    <option value="Ward">Ward</option>
                    <option value="Branch">Branch</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Leader Name</Label>
                  <Input value={form.leader_name} onChange={(e) => setForm((f) => ({ ...f, leader_name: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Phone</Label>
                  <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Venue</Label>
                  <Input value={form.venue} onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label>Meeting Time</Label>
                  <Input
                    value={form.meeting_time}
                    onChange={(e) => setForm((f) => ({ ...f, meeting_time: e.target.value }))}
                    placeholder="e.g., 10:00 AM or 10:00 (24h)"
                  />
                  <div className="text-xs text-slate-500 mt-1">Accepted formats: <span style={{ fontWeight: 600 }}>HH:mm</span> or <span style={{ fontWeight: 600 }}>h:mm AM/PM</span> (e.g., 10:00 or 10:00 AM).</div>
                </div>
              </div>

              <Divider />
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-800">Available Venues</h3>
                  <Button variant="secondary" onClick={() => {
                    const next = [...(form.venues || []), { venue_id: String(Date.now()), name: "New Venue", address: "" }];
                    setForm(f => ({ ...f, venues: next }));
                  }}>Add Venue</Button>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {(form.venues || []).map((v, i) => (
                    <div key={v.venue_id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                      <div className="flex-1">
                        <Input value={v.name} onChange={(e) => {
                          const next = [...(form.venues || [])];
                          next[i].name = e.target.value;
                          setForm(f => ({ ...f, venues: next }));
                        }} placeholder="Venue Name" className="h-9 mb-1" />
                        <Input value={v.address || ""} onChange={(e) => {
                          const next = [...(form.venues || [])];
                          next[i].address = e.target.value;
                          setForm(f => ({ ...f, venues: next }));
                        }} placeholder="Address" className="h-8 text-xs" />
                      </div>
                      <Button variant="ghost" onClick={() => {
                        const next = (form.venues || []).filter((_, j) => i !== j);
                        setForm(f => ({ ...f, venues: next }));
                      }}>Remove</Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button onClick={() => saveUnit("unit")}>{isClerk ? "Request Approval" : "Save Unit Settings"}</Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>System Preferences</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-1">
                  <Label>Default number of speakers</Label>
                  <Input
                    type="number"
                    value={form.prefs?.default_speakers ?? 3}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        prefs: { ...f.prefs, default_speakers: Number(e.target.value || 3) },
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Default meeting duration (minutes)</Label>
                  <Input
                    type="number"
                    value={form.prefs?.default_meeting_duration_min ?? 70}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        prefs: { ...f.prefs, default_meeting_duration_min: Number(e.target.value || 70) },
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Enable checklist</Label>
                  <Select
                    value={(form.prefs?.enable_checklist ?? true) ? "yes" : "no"}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        prefs: { ...f.prefs, enable_checklist: e.target.value === "yes" },
                      }))
                    }
                  >
                    <option value="yes">Enabled</option>
                    <option value="no">Disabled</option>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Checklist task templates (one per line)</Label>
                  <Textarea
                    rows={6}
                    value={checklistTaskText}
                    onChange={(e) => setChecklistTaskText(e.target.value)}
                    placeholder={"Podium prepared\nSacrament table prepared\nMicrophones tested"}
                  />
                </div>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <Label>Assignment message template</Label>
                    <Textarea
                      rows={4}
                      value={form.prefs?.assignment_message_template || ""}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          prefs: { ...f.prefs, assignment_message_template: e.target.value },
                        }))
                      }
                      placeholder="Hello {{name}}, this is your reminder for {{date}}."
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="space-y-1">
                      <Label>Enable music toolkit</Label>
                      <Select
                        value={(form.prefs?.enable_music_toolkit ?? true) ? "yes" : "no"}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            prefs: { ...f.prefs, enable_music_toolkit: e.target.value === "yes" },
                          }))
                        }
                      >
                        <option value="yes">Enabled</option>
                        <option value="no">Disabled</option>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Enable member analytics</Label>
                      <Select
                        value={(form.prefs?.enable_member_analytics ?? true) ? "yes" : "no"}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            prefs: { ...f.prefs, enable_member_analytics: e.target.value === "yes" },
                          }))
                        }
                      >
                        <option value="yes">Enabled</option>
                        <option value="no">Disabled</option>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => saveUnit("prefs")}>{isClerk ? "Request Approval" : "Save Preferences"}</Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Broadcast Announcement</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label>Target</Label>
                  <Select value={broadcastRole} onChange={(e) => setBroadcastRole(e.target.value as BroadcastRole)}>
                    <option value="ALL">All users</option>
                    <option value="ADMIN">Admin</option>
                    <option value="BISHOPRIC">Bishopric</option>
                    <option value="CLERK">Clerk</option>
                    <option value="SECRETARY">Secretary</option>
                    <option value="MUSIC">Music</option>
                  </Select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label>Title</Label>
                  <Input value={broadcastTitle} onChange={(e) => setBroadcastTitle(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Message</Label>
                <Textarea rows={4} value={broadcastBody} onChange={(e) => setBroadcastBody(e.target.value)} />
              </div>
              <div className="flex justify-end">
                <Button onClick={sendBroadcast}>{isBishop ? "Send Broadcast" : "Request Broadcast Approval"}</Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* PRIVATE TAB CONTENT (visible only to Bishop if private tab is active) */}
      {isBishop && activeTab === "private" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Bishop Control Center</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Active users</div>
                  <div className="text-xl font-bold text-slate-800">{systemStats.activeUsers}</div>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Disabled users</div>
                  <div className="text-xl font-bold text-slate-800">{systemStats.disabledUsers}</div>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Submitted planners</div>
                  <div className="text-xl font-bold text-slate-800">{systemStats.submittedPlanners}</div>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Pending approvals</div>
                  <div className="text-xl font-bold text-slate-800">{systemStats.pendingApprovals}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setPasswordResetForAll(true)}>
                  Force Password Reset
                </Button>
                <Button variant="secondary" onClick={() => setPasswordResetForAll(false)}>
                  Clear Forced Reset
                </Button>
                <Button variant="danger" onClick={() => setDisabledForAllNonAdmin(true)}>
                  Disable All Non-admin
                </Button>
                <Button variant="secondary" onClick={() => setDisabledForAllNonAdmin(false)}>
                  Enable All Non-admin
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Roles Management</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="text-sm text-slate-600">
                Promote/demote users and reset passwords. Reset sets password to <span className="font-medium">welcome</span>.
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {users.map((u) => (
                  <div key={u.user_id} className="rounded-xl border border-[color:var(--border)] bg-white p-4 shadow-sm space-y-4">
                    {/* User Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
                          <span>{u.name}</span>
                          {u.user_id === user.user_id ? <Badge tone="blue">You</Badge> : null}
                          {u.disabled ? <Badge tone="gray">Disabled</Badge> : <Badge tone="green">Active</Badge>}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 break-all">ID: {u.user_id}</div>
                      </div>
                    </div>

                    {/* Email Address */}
                    <div className="text-xs text-slate-600">
                      <span className="font-semibold text-slate-500">Email:</span>{" "}
                      <a href={`mailto:${u.email}`} className="text-blue-600 hover:underline">{u.email}</a>
                    </div>

                    {/* Dropdowns Configuration */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-slate-500">Gender</Label>
                        {u.role === "ADMIN" ? (
                          <div className="h-10 flex items-center text-xs text-slate-500 font-medium pl-1">—</div>
                        ) : (
                          <Select
                            value={u.gender || "M"}
                            onChange={(e) => setGender(u.user_id, e.target.value as "M" | "F")}
                          >
                            <option value="M">Male</option>
                            <option value="F">Female</option>
                          </Select>
                        )}
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-slate-500">System Role</Label>
                        <Select value={u.role} onChange={(e) => setRole(u.user_id, e.target.value as Role)}>
                          <option value="ADMIN">Admin</option>
                          <option value="BISHOPRIC">Bishopric</option>
                          <option value="CLERK">Clerk</option>
                          <option value="SECRETARY">Secretary</option>
                          <option value="MUSIC">Music</option>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-slate-500">Calling</Label>
                        {u.role === "ADMIN" ? (
                          <div className="h-10 flex items-center text-xs text-slate-600 font-medium pl-1">Bishop</div>
                        ) : u.role === "BISHOPRIC" ? (
                          <Select value={(u.calling as string) || "1st Counsellor"} onChange={(e) => setCalling(u.user_id, e.target.value)}>
                            {bishopricCallings.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </Select>
                        ) : u.role === "CLERK" ? (
                          <Select value={(u.calling as string) || "Clerk (Co-admin)"} onChange={(e) => setCalling(u.user_id, e.target.value)}>
                            {clerkCallings.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </Select>
                        ) : u.role === "SECRETARY" ? (
                          <Select value={(u.calling as string) || "Secretary"} onChange={(e) => setCalling(u.user_id, e.target.value)}>
                            {secretaryCallings.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </Select>
                        ) : (
                          <div className="h-10 flex items-center text-xs text-slate-500 font-medium pl-1">—</div>
                        )}
                      </div>
                    </div>

                    {/* Operations Actions Footer */}
                    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100 justify-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy === u.user_id}
                        onClick={() => resetPassword(u.user_id)}
                      >
                        Reset Password
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={u.user_id === user.user_id}
                        onClick={() => setDisabled(u.user_id, !u.disabled)}
                      >
                        {u.disabled ? "Enable" : "Disable"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={u.user_id === user.user_id}
                        onClick={() => deleteUser(u.user_id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Divider />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
                <div className="space-y-1 md:col-span-2">
                  <Label>Name</Label>
                  <Input value={newUser.name} onChange={(e) => setNewUser((s) => ({ ...s, name: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input value={newUser.email} onChange={(e) => setNewUser((s) => ({ ...s, email: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Role</Label>
                  <Select
                    value={newUser.role}
                    onChange={(e) => {
                      const role = e.target.value as Role;
                      const calling =
                        role === "BISHOPRIC"
                          ? "1st Counsellor"
                          : role === "CLERK"
                            ? "Clerk (Co-admin)"
                            : role === "SECRETARY"
                              ? "Secretary"
                              : role === "MUSIC"
                                ? "Music Coordinator"
                                : "";
                      setNewUser((s) => ({ ...s, role, calling }));
                    }}
                  >
                    <option value="ADMIN">Admin</option>
                    <option value="BISHOPRIC">Bishopric</option>
                    <option value="CLERK">Clerk</option>
                    <option value="SECRETARY">Secretary</option>
                    <option value="MUSIC">Music</option>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label>Calling</Label>
                  {newUser.role === "BISHOPRIC" ? (
                    <Select value={newUser.calling} onChange={(e) => setNewUser((s) => ({ ...s, calling: e.target.value }))}>
                      {bishopricCallings.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  ) : newUser.role === "CLERK" ? (
                    <Select value={newUser.calling} onChange={(e) => setNewUser((s) => ({ ...s, calling: e.target.value }))}>
                      {clerkCallings.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  ) : newUser.role === "SECRETARY" ? (
                    <Select value={newUser.calling} onChange={(e) => setNewUser((s) => ({ ...s, calling: e.target.value }))}>
                      {secretaryCallings.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  ) : newUser.role === "MUSIC" ? (
                    <Input value="Music Coordinator" disabled />
                  ) : (
                    <Input value="(auto)" disabled />
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Gender</Label>
                  <Select value={newUser.gender} onChange={(e) => setNewUser((s) => ({ ...s, gender: e.target.value as "M" | "F" }))}>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end">
                <Button disabled={busy === "create"} onClick={createUser}>
                  Create user (temp password: welcome)
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI Assistant Settings</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="text-sm text-slate-600">
                Configure the artificial intelligence settings for the AI Assistant. Providing a Gemini API key enables RAG-grounded schedules, talk outlines, and Q&A features across the ward.
              </div>
              <div>
                <Label>Gemini API Key</Label>
                <Input
                  type="password"
                  placeholder="AIzaSy..."
                  value={form.prefs?.gemini_api_key || ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      prefs: { ...f.prefs, gemini_api_key: e.target.value },
                    }))
                  }
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  Get a free API key from Google AI Studio. This key is securely shared only with authenticated leaders of this unit.
                </p>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => saveUnit("prefs")}>{isClerk ? "Request Approval" : "Save Preferences"}</Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Firebase Database Backend</CardTitle>
            </CardHeader>
            <CardBody className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                  <span
                    className={
                      "h-2.5 w-2.5 rounded-full " +
                      (backendStatus === "online"
                        ? "bg-emerald-500 animate-pulse"
                        : backendStatus === "connecting"
                          ? "bg-amber-400 animate-pulse"
                          : backendStatus === "error"
                            ? "bg-rose-500"
                            : "bg-slate-300")
                    }
                  />
                  <span>
                    {backendStatus === "online"
                      ? "Real-time Firebase Connection Active"
                      : backendStatus === "connecting"
                        ? "Connecting to Firebase..."
                        : backendStatus === "error"
                          ? "Firebase connection failure"
                          : "Firebase integration disabled"}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={onSyncHymns}
                    disabled={syncing || backendStatus === "disabled" || backendStatus === "connecting"}
                  >
                    {syncingAction === "sync_hymns" ? "Syncing Hymns..." : "Bootstrap Hymns"}
                  </Button>
                </div>
              </div>

              {backendStatus === "error" && (
                <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800 border border-rose-100 space-y-2">
                  <strong className="font-semibold text-rose-900">Database Troubleshooting:</strong>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>Verify your network connection.</li>
                    <li>Make sure you have enabled the <strong>Email/Password</strong> provider in your Firebase Authentication console.</li>
                    <li>Ensure Firestore security rules and databases are fully deployed.</li>
                  </ul>
                </div>
              )}

              <Divider />

              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-800">Connection Information</h4>
                <p className="text-xs text-slate-500">
                  The application is configured to synchronize database tables and user authentication directly with Firebase Cloud Services.
                </p>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-xs">
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-1">
                    <span className="font-semibold text-slate-600 block">Project ID</span>
                    <span className="font-mono text-slate-800">{import.meta.env.VITE_FIREBASE_PROJECT_ID || "—"}</span>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-1">
                    <span className="font-semibold text-slate-600 block">Auth Domain</span>
                    <span className="font-mono text-slate-800">{import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "—"}</span>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-1">
                    <span className="font-semibold text-slate-600 block">Storage Bucket</span>
                    <span className="font-mono text-slate-800">{import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "—"}</span>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-1">
                    <span className="font-semibold text-slate-600 block">App ID</span>
                    <span className="font-mono text-slate-800">{import.meta.env.VITE_FIREBASE_APP_ID || "—"}</span>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Backup and Restore</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={exportSnapshot}>
                  Generate Snapshot JSON
                </Button>
                <Select value={importMode} onChange={(e) => setImportMode(e.target.value as ImportMode)} className="w-48">
                  <option value="merge">Import mode: Merge</option>
                  <option value="replace">Import mode: Replace</option>
                </Select>
                <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(snapshot)} disabled={!snapshot.trim()}>
                  Copy Snapshot
                </Button>
              </div>
              <div className="space-y-1">
                <Label>Snapshot JSON</Label>
                <Textarea
                  rows={10}
                  value={snapshot}
                  onChange={(e) => setSnapshot(e.target.value)}
                  placeholder="Paste exported JSON here for merge/restore"
                />
              </div>
              <div className="flex justify-end">
                <Button variant="danger" onClick={importSnapshot}>
                  Apply Snapshot
                </Button>
              </div>
              <div className="text-xs text-slate-500">
                Use replace only for full restore; merge will keep existing records and update by row IDs.
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
