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
      // Sync from backend immediately to get USERS data
      await syncFromBackend();

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

  function logout() {
    clearSession();
    setUser(null);
    setRoute("dashboard");
  }

  // If unit settings are missing after sync, we still allow the user in, 
  // but they'll see a prompt to update settings.
  const content = (() => {
    if (!unit) {
      return (
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <div className="text-lg font-semibold text-slate-900">Unit Settings Missing</div>
          <p className="mt-1 text-sm text-slate-600">
            Please configure your unit details in <strong>Settings</strong> to continue.
          </p>
          <Button className="mt-4" onClick={() => setRoute("settings")}>
            Go to Settings
          </Button>
        </div>
      );
    }

    if (route === "dashboard") return <DashboardPage user={user} unit={unit} onNavigate={(r) => setRoute(r)} />;
    if (route === "planner") return <PlannerPage user={user} unit={unit} onChanged={refresh} />;
    if (route === "archive") return <PlannerArchivePage user={user} unit={unit} onChanged={refresh} />;
    if (route === "assignments") return <AssignmentsPage user={user} unit={unit} onChanged={refresh} />;
    if (route === "checklist") return <ChecklistPage user={user} unit={unit} onChanged={refresh} />;
    if (route === "members") return <MembersPage user={user} unit={unit} onChanged={refresh} />;
    if (route === "music") return <MusicPage user={user} unit={unit} onChanged={refresh} />;
    if (route === "notifications") return <NotificationsPage user={user} unit={unit} onChanged={refresh} />;
    if (route === "settings") {
      return (
        <SettingsPage
          user={user}
          unit={unit}
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
      unit={unit || ({} as any)}
      route={route}
      setRoute={setRoute}
      onLogout={logout}
    >
      {content}
      <div className="hidden">{dbSnapshot.UNIT_SETTINGS?.unit_name}</div>
    </AppShell>
  );
}
