import { useEffect, useMemo, useRef, useState } from "react";
import type { UnitSettings, User, Notification } from "./types";
import { AppShell, type RouteKey } from "./components/AppShell";
import { AIChatbot } from "./components/AIChatbot";
import { auth as firebaseAuth } from "./utils/firebase";
import { onAuthStateChanged } from "firebase/auth";
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
import { AgendaPage } from "./pages/AgendaPage";
import { CalendarPage } from "./pages/CalendarPage";
import * as auth from "./auth/authService";
import { clearSession, getSession, newSessionForUser, setSession } from "./auth/session";
import { syncNow, syncFromBackend, getDB, onSyncStatusChange, updateDB, ids, onDBChange } from "./utils/storage";
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

const VALID_ROUTES: RouteKey[] = [
  "dashboard",
  "planner",
  "agenda",
  "calendar",
  "archive",
  "assignments",
  "checklist",
  "members",
  "music",
  "notifications",
  "settings",
];

function getRouteFromHash(): RouteKey | null {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (VALID_ROUTES.includes(hash as RouteKey)) {
    return hash as RouteKey;
  }
  return null;
}

export function App() {
  const [booting, setBooting] = useState(true);
  const [dbTick, setDbTick] = useState(0);
  const sessionGuardRef = useRef(0);

  const [user, setUser] = useState<User | null>(null);
  const [unit, setUnit] = useState<UnitSettings | null>(() => getDB().UNIT_SETTINGS);
  const [authReady, setAuthReady] = useState(false);

  const [route, setRoute] = useState<RouteKey>(() => {
    const fromHash = getRouteFromHash();
    if (fromHash) return fromHash;
    const saved = localStorage.getItem("sac_meeting_planner_route_v1");
    return (saved as RouteKey) || "dashboard";
  });

  useEffect(() => {
    if (user) {
      window.location.hash = `#/${route}`;
      localStorage.setItem("sac_meeting_planner_route_v1", route);
    }
  }, [route, user]);

  useEffect(() => {
    if (!user) {
      const fromHash = getRouteFromHash();
      if (!fromHash || fromHash === "dashboard") {
        if (window.location.hash !== "" && window.location.hash !== "#/") {
          window.location.hash = "";
        }
      }
    }
  }, [user]);

  useEffect(() => {
    const handleHashChange = () => {
      const fromHash = getRouteFromHash();
      if (fromHash) {
        setRoute(fromHash);
      } else {
        if (window.location.hash && window.location.hash !== "#/") {
          if (user) {
            window.location.hash = `#/${route}`;
          }
        } else {
          setRoute("dashboard");
        }
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [route, user]);
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
      await syncFromBackend({ force: true, replaceLocal: true });
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

  // Subscribe to real-time local and Firestore database updates
  useEffect(() => {
    return onDBChange(() => {
      refresh();
    });
  }, []);

  // Listen to Firebase Auth state initialization and session syncing
  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (firebaseUser) => {
      setAuthReady(true);
      if (firebaseUser) {
        console.log("[Auth] Firebase Auth session initialized for:", firebaseUser.email);
      } else if (user && backendEnabled()) {
        console.log("[Auth] Firebase Auth session expired or missing. Clearing local session...");
        logout();
      }
    });
  }, [user]);

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

  // Real-time listener and foreground refresh triggers.
  useEffect(() => {
    if (!authReady || !user || !backendEnabled()) return;

    console.log("[Sync] Initial sync on mount/login (auth ready)");
    void syncFromBackend().then((ok) => {
      if (ok) refresh();
    });
  }, [user, authReady]);

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
    if (!isSyncing) {
      void refreshBackendStatus();
    }
  }, [booting, isSyncing, dbTick]);

  useEffect(() => {
    if (booting || !user || user.role !== "ADMIN") return;
    
    const db = getDB();
    const planners = db.PLANNERS || [];
    const agendas = db.AGENDAS || [];
    const notifications = db.NOTIFICATIONS || [];
    const now = new Date();
    
    let dbUpdated = false;
    const newNotifications: Notification[] = [];
    
    // Check Planners in Archive > 2 years (2 * 365 days)
    planners.forEach((p) => {
      if (p.state === "ARCHIVED") {
        const dateStr = p.archive_date || p.updated_date || p.created_date;
        if (dateStr) {
          const archiveTime = new Date(dateStr).getTime();
          const ageYears = (now.getTime() - archiveTime) / (1000 * 60 * 60 * 24 * 365);
          if (ageYears >= 2) {
            const exists = notifications.some(
              (n) => n.type === "PLANNER_EXPIRY_APPROVAL" && n.meta?.planner_id === p.planner_id
            );
            if (!exists) {
              const label = `${p.month}/${p.year} (${p.unit_name})`;
              newNotifications.push({
                notification_id: ids.uid("notif"),
                to_user_id: user.user_id,
                type: "PLANNER_EXPIRY_APPROVAL",
                created_date: now.toISOString(),
                read: false,
                title: "Archived Planner Expiry Approval Request",
                body: `The archived planner for ${label} is older than 2 years and is scheduled for deletion. Please approve or reject this deletion request.`,
                meta: { planner_id: p.planner_id }
              });
              dbUpdated = true;
            }
          }
        }
      }
    });

    // Check Agendas in Archive > 3 years (3 * 365 days)
    agendas.forEach((a) => {
      if (a.state === "ARCHIVED") {
        const dateStr = a.updated_date || a.created_date || a.date;
        if (dateStr) {
          const archiveTime = new Date(dateStr).getTime();
          const ageYears = (now.getTime() - archiveTime) / (1000 * 60 * 60 * 24 * 365);
          if (ageYears >= 3) {
            const exists = notifications.some(
              (n) => n.type === "AGENDA_EXPIRY_APPROVAL" && n.meta?.agenda_id === a.agenda_id
            );
            if (!exists) {
              const dateLabel = a.date ? new Date(a.date).toLocaleDateString() : "Unknown Date";
              newNotifications.push({
                notification_id: ids.uid("notif"),
                to_user_id: user.user_id,
                type: "AGENDA_EXPIRY_APPROVAL",
                created_date: now.toISOString(),
                read: false,
                title: "Archived Agenda Expiry Approval Request",
                body: `The archived agenda for ${dateLabel} (${a.ward_branch}) is older than 3 years and is scheduled for deletion. Please approve or reject this deletion request.`,
                meta: { agenda_id: a.agenda_id }
              });
              dbUpdated = true;
            }
          }
        }
      }
    });

    // Auto-delete read notifications older than 8 days
    const eightDaysAgo = now.getTime() - 8 * 24 * 60 * 60 * 1000;
    const activeNotifications = notifications.filter((n) => {
      if (!n.read) return true;
      const createdTime = new Date(n.created_date || "").getTime();
      if (isNaN(createdTime)) return true;
      return createdTime >= eightDaysAgo;
    });

    if (activeNotifications.length !== notifications.length) {
      dbUpdated = true;
    }

    if (dbUpdated) {
      updateDB((db0) => {
        const existing = (db0.NOTIFICATIONS || []).filter((n) => {
          if (!n.read) return true;
          const createdTime = new Date(n.created_date || "").getTime();
          if (isNaN(createdTime)) return true;
          return createdTime >= eightDaysAgo;
        });
        return {
          ...db0,
          NOTIFICATIONS: [...newNotifications, ...existing]
        };
      });
      refresh();
    }
  }, [user, dbTick, booting]);

  if (booting) return <LoadingScreen label="Loading..." />;

  if (!user) {
    return (
      <LoginPage
        onLoggedIn={(u) => {
          sessionGuardRef.current += 1;
          setSession(newSessionForUser(u));
          setUser(u);
          setUnit(getDB().UNIT_SETTINGS);
          setRoute(getRouteFromHash() || "dashboard");
        }}
        backendStatus={backendStatus}
        syncError={syncError}
        onRetrySync={handleSyncNow}
      />
    );
  }

  function logout() {
    sessionGuardRef.current += 1;
    if (user) {
      sessionStorage.removeItem(`ai_chat_${user.user_id}_v1`);
    }
    clearSession();
    setUser(null);
    setRoute("dashboard");
    window.location.hash = "";
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
          <DashboardPage user={user} unit={effectiveUnit} onNavigate={(r) => setRoute(r as RouteKey)} />
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
    if (route === "agenda") {
      if (user.role === "MUSIC") {
        setRoute("dashboard");
        return null;
      }
      return <AgendaPage user={user} unit={effectiveUnit} onChanged={refresh} />;
    }
    if (route === "calendar") {
      if (user.role === "MUSIC") {
        setRoute("dashboard");
        return null;
      }
      return <CalendarPage user={user} unit={effectiveUnit} onChanged={refresh} />;
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
      <AIChatbot user={user} unit={effectiveUnit} />
      <div className="hidden">{dbSnapshot.UNIT_SETTINGS?.unit_name}</div>
    </AppShell>
  );
}
