import { useState, type KeyboardEvent } from "react";
import type { User } from "../types";
import { Button, Input, Label } from "../components/ui";
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
    <div className="relative min-h-screen overflow-hidden bg-[#0f172a]">
      {/* Background Blobs */}
      <div className="absolute -top-[10%] -left-[10%] h-[40%] w-[40%] rounded-full bg-blue-600/20 blur-[120px]" />
      <div className="absolute top-[20%] -right-[10%] h-[35%] w-[35%] rounded-full bg-indigo-600/20 blur-[100px]" />
      <div className="absolute -bottom-[10%] left-[20%] h-[30%] w-[30%] rounded-full bg-sky-500/10 blur-[80px]" />

      <div className="relative flex min-h-screen flex-col items-center justify-center p-6">
        <div className="w-full max-w-[440px] animate-fade-in-up">
          {/* Brand/Logo Area */}
          <div className="mb-10 text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-xl shadow-blue-500/20 ring-1 ring-white/20">
              <svg
                className="h-8 w-8 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              Sacrament Meeting Planner
            </h1>
            <p className="mt-2 text-sm font-medium text-slate-400">
              Sacrament Meeting Coordination Tool for LDS units
            </p>
          </div>

          {/* Connection Status Indicator (Top) */}
          {showConnectionWarning && (
            <div className="mb-6 animate-shake rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-center backdrop-blur-md">
              <p className="text-sm font-semibold text-rose-200">
                {syncError || "Unable to connect to service"}
              </p>
              {onRetrySync && (
                <button
                  onClick={onRetrySync}
                  className="mt-2 text-xs font-bold uppercase tracking-wider text-rose-300 underline decoration-rose-300/30 underline-offset-4 hover:text-rose-100"
                >
                  Retry Connection
                </button>
              )}
            </div>
          )}

          {/* Glass Card */}
          <div className="glass-panel rounded-[32px] p-8 shadow-2xl">
            <div className="mb-8">
              <h2 className="text-xl font-bold text-slate-800">
                {needsReset ? "Secure Account" : "Welcome Back"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {needsReset
                  ? `Please set a password for ${needsReset.name}`
                  : "Sign in to manage your assignments"}
              </p>
            </div>

            {needsReset ? (
              /* Password Reset Form */
              <div className="space-y-5" onKeyDown={handleKeyDown}>
                <div className="space-y-1.5">
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min. 6 characters"
                    className="h-12 bg-white/50"
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    className="h-12 bg-white/50"
                  />
                </div>

                {error && (
                  <div className="rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-600 ring-1 ring-rose-200">
                    {error}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="ghost"
                    onClick={cancelReset}
                    disabled={loading}
                    className="h-12 px-6"
                  >
                    Back
                  </Button>
                  <Button
                    onClick={doReset}
                    disabled={loading}
                    className="h-12 flex-1 shadow-lg shadow-blue-500/20"
                  >
                    {loading ? "Saving..." : "Create Password"}
                  </Button>
                </div>
              </div>
            ) : (
              /* Login Form */
              <div className="space-y-5" onKeyDown={handleKeyDown}>
                <div className="space-y-1.5">
                  <Label htmlFor="identifier">Identifier</Label>
                  <Input
                    id="identifier"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="Email or Username"
                    className="h-12 bg-white/50 focus:scale-[1.01]"
                    autoFocus
                    autoComplete="username"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-12 bg-white/50 focus:scale-[1.01]"
                    autoComplete="current-password"
                  />
                </div>

                {error && (
                  <div className="rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-600 ring-1 ring-rose-200">
                    {error}
                  </div>
                )}

                <div className="pt-2">
                  <Button
                    onClick={submit}
                    disabled={loading}
                    className="h-12 w-full text-base shadow-lg shadow-blue-500/20"
                  >
                    {loading ? "Verifying..." : "Sign In"}
                  </Button>
                </div>

                <p className="text-center text-xs font-medium text-slate-400">
                  By signing in, you agree to handle unit data with care.
                </p>
              </div>
            )}
          </div>

          {/* Footer Status */}
          <div className="mt-8 flex items-center justify-center gap-4">
            <div className="flex items-center gap-2">
              <div
                className={`h-2 w-2 rounded-full ring-4 ring-white/10 ${backendStatus === "online"
                  ? "bg-emerald-400"
                  : backendStatus === "connecting"
                    ? "animate-pulse bg-amber-400"
                    : "bg-slate-600"
                  }`}
              />
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                {backendStatus === "online" ? "System Online" : "System Offline"}
              </span>
            </div>
            <div className="h-1 w-1 rounded-full bg-slate-700" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              v2.1.0 Premium
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
