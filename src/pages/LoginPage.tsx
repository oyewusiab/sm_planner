import { useState, type KeyboardEvent } from "react";
import type { User } from "../types";
import { Button, Card, CardBody, CardHeader, CardTitle, Input, Label } from "../components/ui";
import * as auth from "../auth/authService";

type BackendStatus = "disabled" | "connecting" | "online" | "error";

export function LoginPage({
  onLoggedIn,
  backendStatus,
  syncError,
  onRetrySync,
}: {
  onLoggedIn: (user: User) => void;
  backendStatus?: BackendStatus;
  syncError?: string | null;
  onRetrySync?: () => void;
}) {
  const seededHint = null; // Removed seeded admin hint.
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [needsReset, setNeedsReset] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  async function submit() {
    setError(null);

    if (!identifier.trim()) {
      setError("Please enter your email or username.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setLoading(true);
    try {
      const user = await auth.login(identifier.trim(), password);
      if (!user) {
        setError("Invalid email/username or password.");
        return;
      }

      // Check if user needs to reset their password
      if (user.must_reset_password) {
        setNeedsReset(user);
        setPassword(""); // Clear the password field for security
        return;
      }

      onLoggedIn(user);
    } catch (e: any) {
      setError(e?.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function doReset() {
    if (!needsReset) return;
    setError(null);

    if (newPassword.trim().length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await auth.setUserPassword(needsReset.user_id, newPassword.trim());

      // Fetch updated user
      const updated = auth.getUserById(needsReset.user_id);
      if (!updated) {
        throw new Error("Unable to load updated user. Please try logging in again.");
      }

      onLoggedIn(updated);
    } catch (e: any) {
      setError(e?.message || "Password reset failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function cancelReset() {
    setNeedsReset(null);
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setPassword("");
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !loading) {
      if (needsReset) {
        doReset();
      } else {
        submit();
      }
    }
  }

  const showConnectionWarning = backendStatus === "error" || syncError;

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-50 p-4 md:p-10">
      <div className="mx-auto max-w-md space-y-6">
        {/* Header */}
        <div className="space-y-2 text-center">
          <div className="text-2xl font-semibold text-[color:var(--text)]">
            Sacrament Meeting Planner
          </div>
          <div className="text-sm text-slate-600">
            Secure, role-based planning for your unit.
          </div>
        </div>

        {/* Connection Status Warning */}
        {showConnectionWarning && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <div className="text-amber-600">⚠️</div>
              <div className="flex-1">
                <div className="font-medium text-amber-900">Connection Issue</div>
                <p className="mt-1 text-sm text-amber-800">
                  {syncError || "Unable to connect to the server. Please check your connection."}
                </p>
                {onRetrySync && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={onRetrySync}
                  >
                    Retry Connection
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Main Card */}
        <Card>
          <CardHeader>
            <CardTitle>
              {needsReset ? "Set Your New Password" : "Sign In"}
            </CardTitle>
            {needsReset && (
              <p className="text-sm text-slate-600 mt-1">
                Welcome, {needsReset.preferred_name || needsReset.name || needsReset.username}!
                Please create a new password to continue.
              </p>
            )}
          </CardHeader>
          <CardBody>
            {needsReset ? (
              /* Password Reset Form */
              <div className="space-y-4" onKeyDown={handleKeyDown}>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                  Your account requires a password change for security purposes.
                </div>

                <div className="space-y-1">
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password (min. 6 characters)"
                    autoFocus
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your new password"
                  />
                </div>

                {error && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                    {error}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={cancelReset}
                    disabled={loading}
                  >
                    Back
                  </Button>
                  <Button
                    onClick={doReset}
                    disabled={loading}
                    className="flex-1"
                  >
                    {loading ? "Saving..." : "Set Password & Continue"}
                  </Button>
                </div>
              </div>
            ) : (
              /* Login Form */
              <div className="space-y-4" onKeyDown={handleKeyDown}>
                <div className="space-y-1">
                  <Label htmlFor="identifier">Email or Username</Label>
                  <Input
                    id="identifier"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="Enter your email or username"
                    autoFocus
                    autoComplete="username"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                  />
                </div>

                {error && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                    {error}
                  </div>
                )}

                <Button
                  onClick={submit}
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? "Signing in..." : "Sign In"}
                </Button>

                <div className="text-center text-xs text-slate-500">
                  Contact your administrator if you need access or forgot your password.
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Backend Status Indicator */}
        <div className="flex justify-center">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <div
              className={`h-2 w-2 rounded-full ${backendStatus === "online"
                  ? "bg-green-500"
                  : backendStatus === "connecting"
                    ? "bg-amber-500 animate-pulse"
                    : backendStatus === "error"
                      ? "bg-red-500"
                      : "bg-slate-300"
                }`}
            />
            <span>
              {backendStatus === "online"
                ? "Connected"
                : backendStatus === "connecting"
                  ? "Connecting..."
                  : backendStatus === "error"
                    ? "Connection Error"
                    : import.meta.env.PROD
                      ? "Offline (Check VITE_ environment variables)"
                      : "Offline Mode"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
