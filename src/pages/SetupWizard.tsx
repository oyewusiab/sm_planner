import { useMemo, useState } from "react";
import type { UnitSettings, UnitType, User } from "../types";
import { Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Select } from "../components/ui";
import { getDB, setDB, time } from "../utils/storage";

export function SetupWizard({
  currentUser,
  onComplete,
}: {
  currentUser: User;
  onComplete: (unit: UnitSettings) => void;
}) {
  const defaults = useMemo(
    () => ({
      unit_name: "",
      stake_name: "",
      unit_type: "Ward" as UnitType,
      leader_name: "",
      phone: "",
      venue: "",
      meeting_time: "",
    }),
    []
  );

  const [form, setForm] = useState(defaults);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function submit() {
    setError(null);
    if (!form.unit_name.trim()) return setError("Unit Name is required.");
    if (!form.leader_name.trim()) return setError("Bishop / Branch President Name is required.");
    if (!form.phone.trim()) return setError("Phone Number is required.");
    if (!form.venue.trim()) return setError("Default Meeting Venue is required.");
    if (!form.meeting_time.trim()) return setError("Default Meeting Time is required.");

    const unit: UnitSettings = {
      unit_name: form.unit_name.trim(),
      stake_name: form.stake_name.trim() || undefined,
      unit_type: form.unit_type,
      leader_name: form.leader_name.trim(),
      phone: form.phone.trim(),
      venue: form.venue.trim(),
      meeting_time: form.meeting_time.trim(),
      created_date: time.nowISO(),
    };

    const db = getDB();
    // Set current user as ADMIN (Bishop) for first-time install behavior
    // Also align the user record with the Bishop name entered in setup.
    const USERS: User[] = db.USERS.map((u) =>
      u.user_id === currentUser.user_id
        ? {
            ...u,
            name: form.leader_name.trim(),
            role: "ADMIN" as const,
            organisation: "Bishopric" as const,
            calling: "Bishop",
          }
        : u
    );
    setDB({ ...db, UNIT_SETTINGS: unit, USERS });
    onComplete(unit);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-50 p-4 md:p-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-2">
          <div className="text-2xl font-semibold text-[color:var(--text)]">Initial System Setup</div>
          <div className="text-sm text-slate-600">
            Provide your unit details to initialize the Sacrament Meeting Plan Platform.
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Setup Wizard</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Unit Name (Ward or Branch)</Label>
                <Input value={form.unit_name} onChange={(e) => set("unit_name", e.target.value)} placeholder="e.g., Maplewood Ward" />
              </div>
              <div className="space-y-1">
                <Label>Stake Name (optional)</Label>
                <Input value={form.stake_name} onChange={(e) => set("stake_name", e.target.value)} placeholder="e.g., Springfield Stake" />
              </div>

              <div className="space-y-1">
                <Label>Unit Type</Label>
                <Select value={form.unit_type} onChange={(e) => set("unit_type", e.target.value as UnitType)}>
                  <option value="Ward">Ward</option>
                  <option value="Branch">Branch</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Bishop / Branch President Name</Label>
                <Input value={form.leader_name} onChange={(e) => set("leader_name", e.target.value)} placeholder="e.g., Bishop John Smith" />
              </div>

              <div className="space-y-1">
                <Label>Phone Number</Label>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="e.g., +1 555-123-4567" />
              </div>
              <div className="space-y-1">
                <Label>Default Meeting Venue</Label>
                <Input value={form.venue} onChange={(e) => set("venue", e.target.value)} placeholder="e.g., Chapel" />
              </div>

              <div className="space-y-1 md:col-span-2">
                <Label>Default Meeting Time</Label>
                <Input value={form.meeting_time} onChange={(e) => set("meeting_time", e.target.value)} placeholder="e.g., Sunday 10:00 AM" />
              </div>
            </div>

            {error ? <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}

            <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
              <Button onClick={submit}>Save Unit Settings</Button>
            </div>

            <div className="mt-6 text-xs text-slate-500">
              This creates a <span className="font-medium">UNIT_SETTINGS</span> record and sets the current user as <span className="font-medium">ADMIN</span>.
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
