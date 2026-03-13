import { useEffect, useMemo, useState } from "react";
import type { Member, Role, UnitSettings, UnitType, User } from "../types";
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
import { can } from "../utils/permissions";
import { getDB, ids, updateDB } from "../utils/storage";
import { sha256 } from "../utils/crypto";
import { notifyRoles, notifyUser } from "../utils/notifications";

const bishopricCallings = ["1st Counsellor", "2nd Counsellor"] as const;
const clerkCallings = ["Clerk (Co-admin)", "Assistant Clerk"] as const;
const secretaryCallings = ["Secretary", "Assistant Secretary"] as const;

export function SettingsPage({
  user,
  unit,
  onChanged,
  backendStatus,
  syncing,
  onSyncNow,
}: {
  user: User;
  unit: UnitSettings;
  onChanged: () => void;
  backendStatus: "disabled" | "connecting" | "online" | "error";
  syncing: boolean;
  onSyncNow: () => void;
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
    },
  });

  const [flash, setFlash] = useState<{ tone: "success" | "error"; msg: string } | null>(null);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    role: "CLERK" as Role,
    calling: "Clerk (Co-admin)",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [syncUrl, setSyncUrl] = useState(() => localStorage.getItem("sm_sync_url") || "");
  const [syncKey, setSyncKey] = useState(() => localStorage.getItem("sm_sync_key") || "");
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // Keep the form in sync if UNIT_SETTINGS changes from outside.
  useEffect(() => {
    setForm({
      ...unit,
      prefs: {
        default_speakers: unit.prefs?.default_speakers ?? 3,
        default_meeting_duration_min: unit.prefs?.default_meeting_duration_min ?? 70,
        enable_checklist: unit.prefs?.enable_checklist ?? true,
      },
    });
  }, [unit]);

  const users = useMemo(() => [...db.USERS].sort((a, b) => a.name.localeCompare(b.name)), [db.USERS]);

  if (!allowed) {
    return <EmptyState title="Settings" body="Admin access only." />;
  }

  function saveUnit(kind: "unit" | "prefs") {
    setFlash(null);
    const next: UnitSettings = {
      ...form,
      unit_name: form.unit_name.trim(),
      stake_name: form.stake_name?.trim() || undefined,
      leader_name: form.leader_name.trim(),
      phone: form.phone.trim(),
      venue: form.venue.trim(),
      meeting_time: form.meeting_time.trim(),
      prefs: {
        default_speakers: form.prefs?.default_speakers ?? 3,
        default_meeting_duration_min: form.prefs?.default_meeting_duration_min ?? 70,
        enable_checklist: form.prefs?.enable_checklist ?? true,
        checklist_tasks: form.prefs?.checklist_tasks,
        assignment_message_template: form.prefs?.assignment_message_template,
        default_country: "NG",
        enable_music_toolkit: form.prefs?.enable_music_toolkit ?? true,
        enable_member_analytics: form.prefs?.enable_member_analytics ?? true,
      },
      venues: form.venues || [],
    };

    if (!next.unit_name) return setFlash({ tone: "error", msg: "Unit Name is required." });
    if (!next.leader_name) return setFlash({ tone: "error", msg: "Leader Name is required." });
    if (!next.venue) return setFlash({ tone: "error", msg: "Venue is required." });
    if (!next.meeting_time) return setFlash({ tone: "error", msg: "Meeting Time is required." });

    if (isClerk) {
      notifyRoles({
        toRoles: ["ADMIN"],
        type: "SETTINGS_APPROVAL_REQUEST",
        title: "Settings change request",
        body: `${user.name} (${user.calling}) has requested a change to unit ${kind === "unit" ? "information" : "preferences"}.`,
        meta: { 
          request_type: "SETTINGS_CHANGE",
          request_kind: kind,
          payload: JSON.stringify(next)
        }
      });
      setFlash({ tone: "success", msg: "Request sent to Bishop for approval." });
      return;
    }

    updateDB((db0) => ({ ...db0, UNIT_SETTINGS: next }));
    onChanged();
    setFlash({ tone: "success", msg: kind === "unit" ? "Unit settings saved." : "Preferences saved." });
  }

  function handleDecision(notif_id: string, approved: boolean, payload: string) {
    if (!approved) {
      updateDB(db0 => ({
        ...db0,
        NOTIFICATIONS: db0.NOTIFICATIONS.filter(n => n.notification_id !== notif_id)
      }));
      setFlash({ tone: "error", msg: "Request rejected." });
      return;
    }

    const next = JSON.parse(payload) as UnitSettings;
    updateDB((db0) => ({ 
      ...db0, 
      UNIT_SETTINGS: next,
      NOTIFICATIONS: db0.NOTIFICATIONS.filter(n => n.notification_id !== notif_id)
    }));
    onChanged();
    setFlash({ tone: "success", msg: "Settings approved and applied." });
  }

  async function createUser() {
    if (!newUser.name.trim()) return;
    if (!newUser.email.trim()) return;
    setBusy("create");
    try {
      const hash = await sha256("changeme");
      auth.addUser(newUser.name.trim(), newUser.email.trim(), newUser.role, hash, newUser.calling);
      onChanged();
      setNewUser({ name: "", email: "", role: "CLERK", calling: "Clerk (Co-admin)" });
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword(user_id: string) {
    setBusy(user_id);
    try {
      await auth.resetUserPasswordToDefault(user_id);
      onChanged();
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

  async function syncMembers() {
    const url = syncUrl.trim();
    if (!url) {
      setSyncStatus("Please enter the Web App URL.");
      return;
    }
    setSyncStatus("Syncing...");
    try {
      const u = new URL(url);
      u.searchParams.set("action", "list");
      u.searchParams.set("table", "MEMBERS");
      if (syncKey.trim()) u.searchParams.set("key", syncKey.trim());
      const res = await fetch(u.toString());
      const json = await res.json();
      if (!json || json.ok !== true) {
        throw new Error(json?.error || "Sync failed");
      }
      const members = Array.isArray(json.data) ? (json.data as Member[]) : [];
      updateDB((db0) => ({ ...db0, MEMBERS: members }));
      localStorage.setItem("sm_sync_url", url);
      localStorage.setItem("sm_sync_key", syncKey.trim());
      setSyncStatus(`Synced ${members.length} member(s).`);
      onChanged();
    } catch (err: any) {
      setSyncStatus(err?.message || "Sync failed");
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

      {isBishop && db.NOTIFICATIONS.some(n => n.type === "SETTINGS_APPROVAL_REQUEST") && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader>
            <CardTitle className="text-amber-900">Pending Approval Requests</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {db.NOTIFICATIONS.filter(n => n.type === "SETTINGS_APPROVAL_REQUEST").map(n => (
              <div key={n.notification_id} className="flex items-center justify-between rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
                <div>
                  <div className="font-semibold text-slate-900">{n.title}</div>
                  <div className="text-sm text-slate-600">{n.body}</div>
                  <div className="mt-1 text-xs text-slate-400">{new Date(n.created_date).toLocaleString()}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => handleDecision(n.notification_id, true, n.meta?.payload || "")}>Approve</Button>
                  <Button variant="ghost" onClick={() => handleDecision(n.notification_id, false, "")}>Reject</Button>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

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
              <Input value={form.meeting_time} onChange={(e) => setForm((f) => ({ ...f, meeting_time: e.target.value }))} />
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
          <div className="flex justify-end">
            <Button onClick={() => saveUnit("prefs")}>{isClerk ? "Request Approval" : "Save Preferences"}</Button>
          </div>
        </CardBody>
      </Card>

      {!isClerk && (
        <Card>
          <CardHeader>
            <CardTitle>Roles Management</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
          <div className="text-sm text-slate-600">
            Promote/demote users and reset passwords. Reset sets password to <span className="font-medium">changeme</span> and forces a reset at next login.
          </div>

          <div className="overflow-hidden rounded-xl border border-[color:var(--border)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-3 font-medium text-slate-600">User ID</th>
                  <th className="p-3 font-medium text-slate-600">Name</th>
                  <th className="p-3 font-medium text-slate-600">Email</th>
                  <th className="p-3 font-medium text-slate-600">Role</th>
                  <th className="p-3 font-medium text-slate-600">Calling</th>
                  <th className="p-3 font-medium text-slate-600">Status</th>
                  <th className="p-3 font-medium text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.user_id} className="border-t border-[color:var(--border)]">
                    <td className="p-3 text-xs font-mono text-slate-500">{u.user_id}</td>
                    <td className="p-3 font-medium">
                      {u.name} {u.user_id === user.user_id ? <Badge tone="blue">You</Badge> : null}
                    </td>
                    <td className="p-3">{u.email}</td>
                    <td className="p-3">
                      <Select value={u.role} onChange={(e) => setRole(u.user_id, e.target.value as Role)}>
                        <option value="ADMIN">Admin</option>
                        <option value="BISHOPRIC">Bishopric</option>
                        <option value="CLERK">Clerk</option>
                        <option value="SECRETARY">Secretary</option>
                        <option value="MUSIC">Music</option>
                      </Select>
                    </td>
                    <td className="p-3">
                      {u.role === "ADMIN" ? (
                        <div className="text-sm text-slate-600">Bishop</div>
                      ) : u.role === "BISHOPRIC" ? (
                        <Select value={(u.calling as string) || "1st Counsellor"} onChange={(e) => setCalling(u.user_id, e.target.value)}>
                          {bishopricCallings.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </Select>
                      ) : u.role === "CLERK" ? (
                        <Select value={(u.calling as string) || "Clerk (Co-admin)"} onChange={(e) => setCalling(u.user_id, e.target.value)}>
                          {clerkCallings.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </Select>
                      ) : u.role === "SECRETARY" ? (
                        <Select value={(u.calling as string) || "Secretary"} onChange={(e) => setCalling(u.user_id, e.target.value)}>
                          {secretaryCallings.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <div className="text-sm text-slate-600">—</div>
                      )}
                    </td>
                    <td className="p-3">
                      {u.disabled ? <Badge tone="gray">Disabled</Badge> : <Badge tone="green">Active</Badge>}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          disabled={busy === u.user_id}
                          onClick={() => resetPassword(u.user_id)}
                        >
                          Reset password
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={u.user_id === user.user_id}
                          onClick={() => setDisabled(u.user_id, !u.disabled)}
                        >
                          {u.disabled ? "Enable" : "Disable"}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={u.user_id === user.user_id}
                          onClick={() => deleteUser(u.user_id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          </div>
          <div className="flex justify-end">
            <Button disabled={busy === "create"} onClick={createUser}>
              Create user (temp password: changeme)
            </Button>
          </div>
        </CardBody>
      </Card>
    )}

      {!isClerk && (
        <Card>
          <CardHeader>
            <CardTitle>Backend</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-white px-3 py-1 text-xs text-slate-500">
                  <span
                    className={
                      "h-2 w-2 rounded-full " +
                      (backendStatus === "online"
                        ? "bg-emerald-500"
                        : backendStatus === "connecting"
                          ? "bg-amber-400"
                          : backendStatus === "error"
                            ? "bg-rose-500"
                            : "bg-slate-300")
                    }
                  />
                  <span>
                    {backendStatus === "online"
                      ? "Backend connected"
                      : backendStatus === "connecting"
                        ? "Connecting to backend"
                        : backendStatus === "error"
                          ? "Backend error (Check Script URL or API Key)"
                          : import.meta.env.PROD
                            ? "Backend disabled (Check VITE_ environment variables)"
                            : "Backend disabled"}
                  </span>
                </div>
                {backendStatus === "error" && (
                  <div className="w-full mt-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-800 border border-rose-100">
                    <strong>Troubleshooting:</strong>
                    <ul className="mt-1 list-disc list-inside space-y-1">
                      <li>Ensure the <strong>Web App URL</strong> is correct.</li>
                      <li>Verify the <strong>API Key</strong> matches <code>gs.md</code>.</li>
                      <li>Check if the script is deployed as a <strong>Web App</strong> and accessible to "Anyone".</li>
                    </ul>
                  </div>
                )}
                <Button
                  variant="secondary"
                  onClick={onSyncNow}
                  disabled={syncing || backendStatus === "disabled" || backendStatus === "connecting"}
                >
                  {syncing ? "Syncing..." : "Sync Now"}
                </Button>
              </div>

              <Divider />

              <div className="text-sm text-slate-600">
                Members directory sync (optional). Configure a Web App URL to pull member data from a backend list.
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-1 md:col-span-2">
                  <Label>Web App URL</Label>
                  <Input
                    value={syncUrl}
                    onChange={(e) => setSyncUrl(e.target.value)}
                    placeholder="https://script.google.com/macros/s/.../exec"
                  />
                </div>
                <div className="space-y-1">
                  <Label>API Key (optional)</Label>
                  <Input
                    value={syncKey}
                    onChange={(e) => setSyncKey(e.target.value)}
                    placeholder="Your API key"
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={syncMembers}>
                  Sync Members
                </Button>
                {syncStatus ? <div className="text-xs text-slate-500">{syncStatus}</div> : null}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Danger Zone</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="text-sm text-slate-600">
            This MVP stores all data in your browser. For a fresh start, clear site data / localStorage.
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
