import { useMemo, useState } from "react";
import type { User } from "../types";
import { Button, Card, CardBody, CardHeader, CardTitle, Input, Label } from "../components/ui";
import * as auth from "../auth/authService";
import { getDB } from "../utils/storage";

export function LoginPage({
  onLoggedIn,
}: {
  onLoggedIn: (user: User) => void;
}) {
  const seededHint = useMemo(() => {
    const db = getDB();
    const has = db.USERS.some((u) => u.email.toLowerCase() === "admin@local");
    return has ? "Default login: admin@local / admin" : null;
  }, []);

  const [identifier, setIdentifier] = useState("admin@local");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [needsReset, setNeedsReset] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const user = await auth.login(identifier.trim(), password);
      if (!user) {
        setError("Invalid email or password.");
        return;
      }
      if (user.must_reset_password) {
        setNeedsReset(user);
        return;
      }
      onLoggedIn(user);
    } catch (e: any) {
      setError(e?.message || "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function doReset() {
    if (!needsReset) return;
    setError(null);
    if (newPassword.trim().length < 6) return setError("Please choose a password (6+ characters).");
    setLoading(true);
    try {
      await auth.setUserPassword(needsReset.user_id, newPassword.trim());
      // Fetch updated user
      const updated = auth.getUserById(needsReset.user_id);
      if (!updated) throw new Error("Unable to load updated user.");
      onLoggedIn(updated);
    } catch (e: any) {
      setError(e?.message || "Password reset failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-50 p-4 md:p-10">
      <div className="mx-auto max-w-md space-y-6">
        <div className="space-y-2">
          <div className="text-2xl font-semibold text-[color:var(--text)]">Sacrament Meeting Plan Platform</div>
          <div className="text-sm text-slate-600">Secure, role-based planning for your unit.</div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{needsReset ? "Set a new password" : "Sign in"}</CardTitle>
          </CardHeader>
          <CardBody>
            {needsReset ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  This account requires a password reset before continuing.
                </div>
                <div className="space-y-1">
                  <Label>New password</Label>
                  <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </div>
                {error ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>
                ) : null}
                <Button onClick={doReset} disabled={loading} className="w-full">
                  Continue
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label>Email or Username</Label>
                  <Input
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="email@example.com or username"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Password</Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>

                {seededHint ? <div className="text-xs text-slate-500">{seededHint}</div> : null}
                {error ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>
                ) : null}

                <Button onClick={submit} disabled={loading} className="w-full">
                  Sign in
                </Button>

                <div className="text-xs text-slate-500">
                  MVP note: authentication + session token are stored in your browser (localStorage).
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
