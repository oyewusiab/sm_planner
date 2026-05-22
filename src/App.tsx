import { useEffect, useMemo, useRef, useState } from "react";
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
import { syncNow, syncFromBackend, getDB, onSyncStatusChange } from "./utils/storage";
import { backendEnabled, pingBackend, syncMusic } from "./utils/backend";
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
const AUTO_SYNC_INTERVAL_MS = 60000;

export function App() {
  const [booting, setBooting] = useState(true);
  const [dbTick, setDbTick] = useState(0);
  const sessionGuardRef = useRef(0);

  const [user, setUser] = useState<User | null>(null);
  const [unit, setUnit] = useState<UnitSettings | null>(() => getDB().UNIT_SETTINGS);

  const [route, setRoute] = useState<RouteKey>(() => {
    const saved = localStorage.getItem("sac_meeting_planner_route_v1");
    return (saved as RouteKey) || "dashboard";
  });

  useEffect(() => {
    localStorage.setItem("sac_meeting_planner_route_v1", route);
  }, [route]);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>(() =>
    backendEnabled() ? "connecting" : "disabled"
  );
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [syncingAction, setSyncingAction] = useState<"sync_now" | "sync_hymns" | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const isSyncing = backgroundSyncing || syncingAction !== null;

  const dbSnapshot = useMemo(() => {
    void dbTick;
    return getDB();
  }, [dbTick]);

  function restoreSessionFromLocal(clearIfInvalid: boolean, guard = sessionGuardRef.current) {
    if (guard !== sessionGuardRef.current) return false;
    const sess = getSession();
    if (!sess) {
      console.log("[Session] No session found on boot.");
      return false;
    }

    const u = auth.getUserById(sess.user_id);
    const now = Date.now();
    const inactiveMs = now - (sess.last_activity || 0);

    if (guard !== sessionGuardRef.current) return false;

    if (u && !u.disabled && inactiveMs < 30 * 60 * 1000) {
      console.log(`[Session] Restored session for ${u.name} (${u.role})`);
      setUser(u);
      setSession({ ...sess, last_activity: now });
      return true;
    }

    if (clearIfInvalid) {
      console.warn("[Session] Session expired, locked, or invalid. Clearing.");
      clearSession();
    }

    return false;
  }

  function refresh() {
    setDbTick((t) => t + 1);
    const db = getDB();
    setUnit(db.UNIT_SETTINGS);
    const sess = getSession();
    if (sess?.user_id) {
      const latest = auth.getUserById(sess.user_id);
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
      setSyncError(null);
    } catch {
      setBackendStatus("error");
    }
  }

  async function handleSyncNow() {
    if (!backendEnabled()) return;
    setSyncingAction("sync_now");
    setSyncError(null);
    try {
      await syncNow();
      await refreshBackendStatus();
      refresh();
    } catch (err: any) {
      setSyncError(err?.message || "Sync failed");
    } finally {
      setSyncingAction(null);
    }
  }

  async function handleSyncHymns() {
    if (!backendEnabled()) return;
    setSyncingAction("sync_hymns");
    setSyncError(null);
    try {
      await syncMusic();
      await syncFromBackend({ force: true });
      await refreshBackendStatus();
      refresh();
    } catch (err: any) {
      setSyncError(err?.message || "Hymn sync failed");
    } finally {
      setSyncingAction(null);
    }
  }

  // Subscribe to background sync status overrides
  useEffect(() => {
    return onSyncStatusChange((syncing) => {
      setBackgroundSyncing(syncing);
      if (!syncing) refresh(); // Refresh UI when background sync completes
    });
  }, []);

  // Inactivity & Auto-logout
  useEffect(() => {
    if (!user) return;

    const handleActivity = () => {
      const sess = getSession();
      if (sess) {
        setSession({ ...sess, last_activity: Date.now() });
      }
    };

    window.addEventListener("mousedown", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("scroll", handleActivity);

    const checkInterval = setInterval(() => {
      const sess = getSession();
      if (sess && user) {
        const inactiveMs = Date.now() - sess.last_activity;
        if (inactiveMs > 30 * 60 * 1000) {
          console.log("[Session] Auto-logout due to inactivity.");
          logout();
        }
      }
    }, 60000); // Check every minute

    return () => {
      window.removeEventListener("mousedown", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("scroll", handleActivity);
      clearInterval(checkInterval);
    };
  }, [user]);

  // Polling Sync + foreground refresh for near-real-time multi-user visibility.
  useEffect(() => {
    if (!user || !backendEnabled()) return;

    const pull = () => {
      void syncFromBackend().then((ok) => {
        if (ok) refresh();
      });
    };

    console.log(`[Sync] Polling started (${AUTO_SYNC_INTERVAL_MS / 1000}s interval)`);
    pull(); // Immediate check when app becomes active for the signed-in user

    const interval = setInterval(pull, AUTO_SYNC_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") pull();
    };
    const onFocus = () => pull();
    const onOnline = () => pull();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [user]);

  useEffect(() => {
    (async () => {
      try {
        const db = getDB();
        const hasUsers = db.USERS && db.USERS.length > 0;
        const guard = sessionGuardRef.current;
        setUnit(db.UNIT_SETTINGS);
        restoreSessionFromLocal(hasUsers, guard);
        setBooting(false);

        // Existing local data should render immediately; refresh in the background.
        void syncFromBackend()
          .then((ok) => {
            if (guard !== sessionGuardRef.current) return;
            if (ok) {
              setSyncError(null);
            } else if (!hasUsers) {
              setSyncError("Failed to connect to backend");
            }
            setUnit(getDB().UNIT_SETTINGS);
            restoreSessionFromLocal(true, guard);
            refresh();
          })
          .catch((err: any) => {
            if (guard !== sessionGuardRef.current) return;
            console.error("Initial sync failed:", err);
            if (!hasUsers) {
              setSyncError(err?.message || "Failed to connect to backend");
            }
          });
      } catch (err) {
        console.error("Booting error:", err);
        setBooting(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (booting) return;
    void refreshBackendStatus();
  }, [booting]);

  if (booting) return <LoadingScreen label="Loading..." />;

  if (!user) {
    return (
      <LoginPage
        onLoggedIn={(u) => {
          sessionGuardRef.current += 1;
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
    sessionGuardRef.current += 1;
    clearSession();
    setUser(null);
    setRoute("dashboard");
  }

  const effectiveUnit: UnitSettings =
    unit || ({
      unit_name: "Unit Not Configured",
      stake_name: "",
      unit_type: "Ward",
      leader_name: "",
      phone: "",
      venue: "",
      meeting_time: "",
      created_date: "",
      prefs: {},
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

    if (route === "planner") {
      if (user.role === "MUSIC") {
        setRoute("dashboard");
        return null;
      }
      return <PlannerPage user={user} unit={effectiveUnit} onChanged={refresh} />;
    }
    if (route === "archive") {
      if (user.role === "MUSIC" || user.role === "SECRETARY") {
        setRoute("dashboard");
        return null;
      }
      return <PlannerArchivePage user={user} unit={effectiveUnit} onChanged={refresh} />;
    }
    if (route === "assignments") return <AssignmentsPage user={user} unit={effectiveUnit} onChanged={refresh} />;
    if (route === "checklist") {
      if (user.role === "MUSIC") {
        setRoute("dashboard");
        return null;
      }
      return <ChecklistPage user={user} unit={effectiveUnit} onChanged={refresh} />;
    }
    if (route === "members") {
      if (user.role === "MUSIC" || user.role === "SECRETARY") {
        setRoute("dashboard");
        return null;
      }
      return <MembersPage user={user} unit={effectiveUnit} onChanged={refresh} />;
    }
    if (route === "music") return <MusicPage user={user} unit={effectiveUnit} onChanged={refresh} />;
    if (route === "notifications") return <NotificationsPage user={user} unit={effectiveUnit} onChanged={refresh} />;
    if (route === "settings") {
      if (user.role === "MUSIC" || user.role === "SECRETARY" || user.role === "BISHOPRIC") {
        // Bishopric Counsellors don't have settings access in permissions.ts
        setRoute("dashboard");
        return null;
      }
      return (
        <SettingsPage
          user={user}
          unit={effectiveUnit}
          onChanged={refresh}
          backendStatus={backendStatus}
          syncing={isSyncing}
          syncingAction={syncingAction}
          onSyncNow={handleSyncNow}
          onSyncHymns={handleSyncHymns}
        />
      );
    }
    return <div className="text-sm text-slate-600">Unknown route.</div>;
  })();

  return (
    <AppShell
      user={user}
      unit={effectiveUnit}
      route={route}
      setRoute={setRoute}
      onLogout={logout}
      onProfileChanged={refresh}
      dbTick={dbTick}
    >
      {content}
      <div className="hidden">{dbSnapshot.UNIT_SETTINGS?.unit_name}</div>
    </AppShell>
  );
}
