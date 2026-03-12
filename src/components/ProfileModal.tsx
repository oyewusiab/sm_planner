import { useEffect, useMemo, useState } from "react";
import type { User } from "../types";
import { sha256, timingSafeEqual } from "../utils/crypto";
import { Modal } from "./Modal";
import { Badge, Button, Input, Label, Select, Textarea } from "./ui";
import * as auth from "../auth/authService";

function isClerkCoAdmin(u: User) {
  return u.role === "CLERK" && u.calling === "Clerk (Co-admin)";
}

export function ProfileModal({
  open,
  onClose,
  viewer,
  target,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  viewer: User;
  target: User;
  onSaved: () => void;
}) {
  const isSelf = viewer.user_id === target.user_id;
  const canEditSecure = viewer.role === "ADMIN" || isClerkCoAdmin(viewer);

  const [tab, setTab] = useState<"profile" | "security">("profile");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [form, setForm] = useState<User>(target);

  // Password change (self only)
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    if (open) {
      setForm(target);
      setTab("profile");
      setError(null);
      setOk(null);
      setCurrentPassword("");
      setNewPassword("");
    }
  }, [open, target]);

  const readOnlySummary = useMemo(() => {
    return {
      role: target.role,
      organisation: target.organisation,
      calling: target.calling,
      created: target.created_date,
      lastLogin: target.last_login_date,
    };
  }, [target]);

  async function saveProfile() {
    setError(null);
    setOk(null);
    setSaving(true);
    try {
      // Restrict what a user can change about themselves.
      const patch: Partial<User> = {};

      if (canEditSecure) {
        patch.name = form.name.trim();
        patch.email = form.email.trim();
        patch.username = (form.username || "").trim();
      }

      // Self-editable fields
      if (isSelf || canEditSecure) {
        patch.preferred_name = (form.preferred_name || "").trim() || undefined;
        patch.phone = (form.phone || "").trim() || undefined;
        patch.whatsapp = (form.whatsapp || "").trim() || undefined;
        patch.gender = form.gender;
        patch.address = (form.address || "").trim() || undefined;
        patch.lga = (form.lga || "").trim() || undefined;
        patch.state = (form.state || "").trim() || undefined;
        patch.country = (form.country || "").trim() || undefined;
        patch.emergency_contact_name = (form.emergency_contact_name || "").trim() || undefined;
        patch.emergency_contact_phone = (form.emergency_contact_phone || "").trim() || undefined;
      }

      // Notes are admin/co-admin only.
      if (canEditSecure) {
        patch.notes = (form.notes || "").trim() || undefined;
      }

      // Optional e-signature (image data URL)
      if (isSelf || canEditSecure) {
        patch.signature_data_url = (form.signature_data_url || "").trim() || undefined;
      }

      auth.updateUserProfile(target.user_id, patch);
      setOk("Profile saved.");
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Unable to save profile.");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    if (!isSelf) return;
    setError(null);
    setOk(null);
    if (newPassword.trim().length < 6) return setError("New password must be at least 6 characters.");
    setSaving(true);
    try {
      const latest = auth.getUserById(target.user_id);
      if (!latest) throw new Error("Unable to load user.");
      const currentHash = await sha256(currentPassword);
      if (!timingSafeEqual(currentHash, latest.password_hash)) {
        throw new Error("Current password is incorrect.");
      }
      await auth.setUserPassword(target.user_id, newPassword.trim());
      setOk("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Unable to change password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={isSelf ? "My Profile" : "User Profile"}
      onClose={onClose}
      className="max-w-3xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {tab === "profile" ? (
            <Button onClick={saveProfile} disabled={saving}>
              Save changes
            </Button>
          ) : isSelf ? (
            <Button onClick={changePassword} disabled={saving}>
              Update password
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={tab === "profile" ? "primary" : "secondary"} onClick={() => setTab("profile")}>
            Profile
          </Button>
          <Button
            variant={tab === "security" ? "primary" : "secondary"}
            onClick={() => setTab("security")}
          >
            Security
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Badge tone="blue">{target.role}</Badge>
            {target.calling ? <Badge tone="gray">{target.calling}</Badge> : null}
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
        ) : null}
        {ok ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{ok}</div>
        ) : null}

        {tab === "profile" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Full name</Label>
              <Input
                value={form.name}
                disabled={!canEditSecure}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              {!canEditSecure ? (
                <div className="text-xs text-slate-500">Editable by Bishop/Clerk (Co-admin) only.</div>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label>Preferred name (optional)</Label>
              <Input
                value={form.preferred_name || ""}
                onChange={(e) => setForm((f) => ({ ...f, preferred_name: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <Label>Gender</Label>
              <Select value={form.gender || ""} onChange={(e) => setForm((f) => ({ ...f, gender: (e.target.value as any) || undefined }))}>
                <option value="">—</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={form.phone || ""} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>

            <div className="space-y-1">
              <Label>WhatsApp</Label>
              <Input
                value={form.whatsapp || ""}
                onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))}
                placeholder="+234..."
              />
            </div>

            <div className="space-y-1">
              <Label>Address</Label>
              <Input value={form.address || ""} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>

            <div className="space-y-1">
              <Label>LGA</Label>
              <Input value={form.lga || ""} onChange={(e) => setForm((f) => ({ ...f, lga: e.target.value }))} />
            </div>

            <div className="space-y-1">
              <Label>State</Label>
              <Input value={form.state || ""} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
            </div>

            <div className="space-y-1">
              <Label>Country</Label>
              <Input value={form.country || ""} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} placeholder="Nigeria" />
            </div>

            <div className="space-y-1">
              <Label>Emergency contact name</Label>
              <Input
                value={form.emergency_contact_name || ""}
                onChange={(e) => setForm((f) => ({ ...f, emergency_contact_name: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <Label>Emergency contact phone</Label>
              <Input
                value={form.emergency_contact_phone || ""}
                onChange={(e) => setForm((f) => ({ ...f, emergency_contact_phone: e.target.value }))}
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label>Signature (optional)</Label>
              <div className="rounded-xl border border-[color:var(--border)] bg-white p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        setForm((f) => ({ ...f, signature_data_url: String(reader.result || "") }));
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => setForm((f) => ({ ...f, signature_data_url: undefined }))}
                    type="button"
                  >
                    Clear
                  </Button>
                  <div className="text-xs text-slate-500">
                    Used on printed assignment notifications when you are the signatory.
                  </div>
                </div>
                {form.signature_data_url ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <img
                      src={form.signature_data_url}
                      alt="Signature preview"
                      className="h-14 w-auto object-contain"
                    />
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-slate-500">No signature uploaded.</div>
                )}
              </div>
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label>Notes (Admin/Co-admin only)</Label>
              <Textarea
                rows={3}
                disabled={!canEditSecure}
                value={form.notes || ""}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder={canEditSecure ? "Internal notes (optional)" : "—"}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Email (login)</Label>
                <Input
                  value={form.email}
                  disabled={!canEditSecure}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Username (login)</Label>
                <Input
                  value={form.username || ""}
                  disabled={!canEditSecure}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                />
                <div className="text-xs text-slate-500">
                  Users can sign in with either email or username.
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-[color:var(--border)] bg-white p-3">
                <div className="text-xs font-semibold text-slate-600">Account</div>
                <div className="mt-2 space-y-1 text-sm text-slate-700">
                  <div>
                    Role: <span className="font-medium">{readOnlySummary.role}</span>
                  </div>
                  <div>
                    Organisation: <span className="font-medium">{readOnlySummary.organisation || "—"}</span>
                  </div>
                  <div>
                    Calling: <span className="font-medium">{readOnlySummary.calling || "—"}</span>
                  </div>
                  <div className="text-xs text-slate-500">Created: {new Date(readOnlySummary.created).toLocaleString()}</div>
                  {readOnlySummary.lastLogin ? (
                    <div className="text-xs text-slate-500">
                      Last login: {new Date(readOnlySummary.lastLogin).toLocaleString()}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-[color:var(--border)] bg-white p-3">
                <div className="text-xs font-semibold text-slate-600">Password</div>
                {isSelf ? (
                  <div className="mt-2 space-y-2">
                    <div className="space-y-1">
                      <Label>Current password</Label>
                      <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>New password</Label>
                      <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                    </div>
                    <div className="text-xs text-slate-500">
                      Use 6+ characters. Password resets for other users are handled in Settings.
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-slate-600">Password can only be changed by the user or reset by Admin.</div>
                )}
              </div>
            </div>

            {canEditSecure ? (
              <div className="text-xs text-slate-500">
                Security fields are editable only by the Bishop (Admin) or Clerk (Co-admin).
              </div>
            ) : (
              <div className="text-xs text-slate-500">Security fields are managed by the Bishop/Clerk (Co-admin).</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
