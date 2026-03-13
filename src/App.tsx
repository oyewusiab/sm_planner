import { useEffect, useMemo, useState } from "react";
import type { UnitSettings, User } from "./types";
import { AppShell, type RouteKey } from "./components/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PlannerPage } from "./pages/PlannerPage";
import { PlannerArchivePage } from "./pages/PlannerArchivePage";
import { AssignmentsPage } from "./pages/AssignmentsPage";
import { ChecklistPage } from "./pages/ChecklistPage";
import { MembersPage } from "./pages/MembersPage";
import { MusicPage } from "./pages/MusicPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { SettingsPage } from "./pages/SettingsPage";
import * as auth from "./auth/authService";
import { clearSession, getSession, newSessionForUser, setSession } from "./auth/session";
import { syncNow, syncFromBackend, getDB } from "./utils/storage";
import { backendEnabled, pingBackend } from "./utils/backend";
import { Button } from "./components/ui";

function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white to-slate-50 p-8">
      <div className="rounded-xl border border-[color:var(--border)] bg-white px-5 py-4 text-sm text-slate-600 shadow-sm">
        {label}
      </div>
    </div>
  );
}

type BackendStatus = "disabled" | "connecting" | "online" | "error";

export function App() {
  const [booting, setBooting] = useState(true);
  const [dbTick, setDbTick] = useState(0);

  const [user, setUser] = useState<User | null>(null);
  const [unit, setUnit] = useState<UnitSettings | null>(() => getDB().UNIT_SETTINGS);

  const [route, setRoute] = useState<RouteKey>("dashboard");
  const [backendStatus, setBackendStatus] = useState<BackendStatus>(() =>
    backendEnabled() ? "connecting" : "disabled"
  );
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const dbSnapshot = useMemo(() => {
    void dbTick;
    return getDB();
  }, [dbTick]);

  function refresh() {
    setDbTick((t) => t + 1);
    const db = getDB();
    setUnit(db.UNIT_SETTINGS);
    if (user) {
      const latest = auth.getUserById(user.user_id);
      if (latest) {
        if (latest.disabled) {
          clearSession();
          setUser(null);
          setRoute("dashboard");
        } else {
          setUser(latest);
        }
      }
    }
  }

  async function refreshBackendStatus() {
    if (!backendEnabled()) {
      setBackendStatus("disabled");
      return;
    }
    setBackendStatus("connecting");
    try {
      await pingBackend();
      setBackendStatus("online");
    } catch {
      setBackendStatus("error");
    }
  }

  async function handleSyncNow() {
    if (!backendEnabled()) return;
    setSyncing(true);
    setSyncError(null);
    try {
      await syncNow();
      await refreshBackendStatus();
      refresh();
    } catch (err: any) {
      setSyncError(err?.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        // Sync from backend to get USERS and other data
        await syncFromBackend();
        setSyncError(null);
      } catch (err: any) {
        console.error("Initial sync failed:", err);
        setSyncError(err?.message || "Failed to connect to backend");
      }

      const db = getDB();
      setUnit(db.UNIT_SETTINGS);

      // Check for existing session
      const sess = getSession();
      if (sess) {
        const u = auth.getUserById(sess.user_id);
        if (u && !u.disabled) {
          setUser(u);
        } else {
          // Session invalid or user disabled
          clearSession();
        }
      }

      await refreshBackendStatus();
      setBooting(false);
    })();
  }, []);

  if (booting) return <LoadingScreen label="Connecting to server..." />;

  // Show login page if no authenticated user
  if (!user) {
    return (
      <LoginPage
        onLoggedIn={(u) => {
          setSession(newSessionForUser(u));
          setUser(u);
          setUnit(getDB().UNIT_SETTINGS);
          setRoute("dashboard");
        }}
        backendStatus={backendStatus}
        syncError={syncError}
        onRetrySync={handleSyncNow}
      />
    );
  }

  function logout() {
    clearSession();
    setUser(null);
    setRoute("dashboard");
  }

  // Content rendering - allow navigation even without unit settings
  const effectiveUnit = unit || ({
    unit_name: "Unit Not Configured",
    stake_name: "",
    prefs: {}
  } as UnitSettings);

  const content = (() => {
    if (route === "dashboard") {
      return (
        <>
          {!unit && (
            <div className="mx-4 mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <div className="text-amber-600">⚠️</div>
                <div>
                  <div className="font-medium text-amber-900">Unit Settings Not Configured</div>
                  <p className="mt-1 text-sm text-amber-800">
                    Please configure your unit details in Settings to enable full functionality.
                  </p>
                  {(user.role === "ADMIN" || user.role === "BISHOPRIC" || user.role === "CLERK") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => setRoute("settings")}
                    >
                      Go to Settings
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
          <DashboardPage user={user} unit={effectiveUnit} onNavigate={(r) => setRoute(r)} />
        </>
      );
    }

    if (route === "planner") return <PlannerPage user={user} unit={effectiveUnit} onChanged={refresh} />;
    if (route === "archive") return <PlannerArchivePage user={user} unit={effectiveUnit} onChanged={refresh} />;
    if (route === "assignments") return <AssignmentsPage user={user} unit={effectiveUnit} onChanged={refresh} />;
    if (route === "checklist") return <ChecklistPage user={user} unit={effectiveUnit} onChanged={refresh} />;
    if (route === "members") return <MembersPage user={user} unit={effectiveUnit} onChanged={refresh} />;
    if (route === "music") return <MusicPage user={user} unit={effectiveUnit} onChanged={refresh} />;
    if (route === "notifications") return <NotificationsPage user={user} unit={effectiveUnit} onChanged={refresh} />;
    if (route === "settings") {
      return (
        <SettingsPage
          user={user}
          unit={effectiveUnit}
          onChanged={refresh}
          backendStatus={backendStatus}
          syncing={syncing}
          onSyncNow={handleSyncNow}
        />
      );
    }
    return <div className="text-sm text-slate-600">Unknown route.</div>;
  })();

  return (
    <AppShell
      user={user}
      unit={unit || ({ unit_name: "Configure Unit" } as any)}
      route={route}
      setRoute={setRoute}
      onLogout={logout}
    >
      {content}
      <div className="hidden">{dbSnapshot.UNIT_SETTINGS?.unit_name}</div>
    </AppShell>
  );
}