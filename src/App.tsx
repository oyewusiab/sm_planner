import { useEffect, useMemo, useState } from "react";
import type { UnitSettings, User } from "./types";
import { AppShell, type RouteKey } from "./components/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { SetupWizard } from "./pages/SetupWizard";
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

  const dbSnapshot = useMemo(() => {
    // Read current DB (localStorage) whenever tick changes
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
    try {
      await syncNow();
      await refreshBackendStatus();
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    (async () => {
      await syncFromBackend();

      // Ensure a seed user exists so you can get into the app on first run.
      await auth.ensureSeedUserIfEmpty();

      const db = getDB();
      setUnit(db.UNIT_SETTINGS);

      const sess = getSession();
      if (sess) {
        const u = auth.getUserById(sess.user_id);
        if (u) setUser(u);
        else clearSession();
      }

      await refreshBackendStatus();
      setBooting(false);
    })();
  }, []);

  if (booting) return <LoadingScreen />;

  if (!user) {
    return (
      <LoginPage
        onLoggedIn={(u) => {
          setSession(newSessionForUser(u));
          setUser(u);
          setUnit(getDB().UNIT_SETTINGS);
        }}
      />
    );
  }

  if (!unit) {
    return (
      <SetupWizard
        currentUser={user}
        onComplete={(u) => {
          setUnit(u);
          const latest = auth.getUserById(user.user_id);
          if (latest) setUser(latest);
          setRoute("dashboard");
          refresh();
        }}
      />
    );
  }

  function logout() {
    clearSession();
    setUser(null);
    setRoute("dashboard");
  }

  return (
    <AppShell
      user={user}
      unit={unit}
      route={route}
      setRoute={setRoute}
      onLogout={logout}
    >
      {route === "dashboard" ? (
        <DashboardPage user={user} unit={unit} onNavigate={(r) => setRoute(r)} />
      ) : route === "planner" ? (
        <PlannerPage user={user} unit={unit} onChanged={refresh} />
      ) : route === "archive" ? (
        <PlannerArchivePage user={user} unit={unit} onChanged={refresh} />
      ) : route === "assignments" ? (
        <AssignmentsPage user={user} unit={unit} onChanged={refresh} />
      ) : route === "checklist" ? (
        <ChecklistPage user={user} unit={unit} onChanged={refresh} />
      ) : route === "members" ? (
        <MembersPage user={user} unit={unit} onChanged={refresh} />
      ) : route === "music" ? (
        <MusicPage user={user} unit={unit} onChanged={refresh} />
      ) : route === "notifications" ? (
        <NotificationsPage user={user} unit={unit} onChanged={refresh} />
      ) : route === "settings" ? (
        <SettingsPage
          user={user}
          unit={unit}
          onChanged={refresh}
          backendStatus={backendStatus}
          syncing={syncing}
          onSyncNow={handleSyncNow}
        />
      ) : (
        <div className="text-sm text-slate-600">Unknown route.</div>
      )}

      <div className="hidden">{dbSnapshot.UNIT_SETTINGS?.unit_name}</div>
    </AppShell>
  );
}
