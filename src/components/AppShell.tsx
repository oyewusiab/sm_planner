import React, { useMemo, useState } from "react";
import type { Notification, Role, UnitSettings, User } from "../types";
import { cn } from "../utils/cn";
import { listNotificationsForUser, markAllRead, markRead, unreadCount } from "../utils/notifications";
import { Modal } from "./Modal";
import { ProfileModal } from "./ProfileModal";
import { Badge, Button } from "./ui";

export type RouteKey =
  | "dashboard"
  | "planner"
  | "archive"
  | "assignments"
  | "checklist"
  | "members"
  | "music"
  | "notifications"
  | "settings";

const navItems: {
  key: RouteKey;
  label: string;
  roles?: Role[];
  /** Optional additional visibility rule (e.g., calling-based). */
  show?: (user: User) => boolean;
}[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "planner", label: "Planner", roles: ["ADMIN", "BISHOPRIC", "CLERK", "SECRETARY"] },
  { key: "archive", label: "Archive", roles: ["ADMIN", "BISHOPRIC"] },
  { key: "assignments", label: "Assignments", roles: ["ADMIN", "BISHOPRIC", "CLERK", "SECRETARY"] },
  { key: "notifications", label: "Notifications", roles: ["ADMIN", "BISHOPRIC", "CLERK", "SECRETARY", "MUSIC"] },
  { key: "checklist", label: "Checklist", roles: ["ADMIN", "BISHOPRIC", "CLERK", "SECRETARY"] },
  { key: "members", label: "Members", roles: ["ADMIN", "BISHOPRIC", "CLERK"] },
  { key: "music", label: "Music", roles: ["ADMIN", "MUSIC"] },
  // PART 2: Bishop can edit; Clerk (Co-admin) can request edits (requires approval).
  {
    key: "settings",
    label: "Settings",
    roles: ["ADMIN", "CLERK"],
    show: (u) => u.role === "ADMIN" || (u.role === "CLERK" && u.calling === "Clerk (Co-admin)"),
  },
];

function notifCta(n: Notification): { label: string; route: RouteKey } | null {
  if (n.type === "SETTINGS_APPROVAL_REQUEST") return { label: "Open Settings", route: "settings" };
  if (n.type === "MUSIC_INPUT_REQUEST") return { label: "Open Music", route: "music" };
  return null;
}

export function AppShell({
  user,
  unit,
  route,
  setRoute,
  onLogout,
  onProfileChanged,
  children,
}: {
  user: User;
  unit: UnitSettings;
  route: RouteKey;
  setRoute: (r: RouteKey) => void;
  onLogout: () => void;
  onProfileChanged?: () => void;
  children: React.ReactNode;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifTick, setNotifTick] = useState(0);

  const { notifs, unread } = useMemo(() => {
    void notifTick;
    const notifs0 = listNotificationsForUser(user.user_id);
    return { notifs: notifs0, unread: unreadCount(user.user_id) };
  }, [user.user_id, notifTick]);

  return (
    <div className="min-h-screen bg-[color:var(--bg)]">
      <div className="grid min-h-screen grid-cols-1 md:grid-cols-[280px_1fr]">
        <aside className="no-print flex flex-col bg-[color:var(--sidebar)] text-white">
          <div className="border-b border-white/10 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold tracking-wide text-white/90">{unit.unit_name}</div>
                <div className="mt-1 text-xs text-white/70">
                  {unit.unit_type} • {unit.venue} • {unit.meeting_time}
                </div>
              </div>

              <button
                className={cn(
                  "relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-sm hover:bg-white/10",
                  unread ? "ring-2 ring-white/20" : ""
                )}
                title="Notifications"
                onClick={() => setNotifOpen(true)}
              >
                <span aria-hidden>🔔</span>
                {unread ? (
                  <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[color:var(--accent)] px-1 text-[11px] font-semibold text-white">
                    {unread}
                  </span>
                ) : null}
              </button>
            </div>
          </div>

          <nav className="p-3">
            <div className="space-y-1">
              {navItems
                .filter((i) => (!i.roles || i.roles.includes(user.role)) && (!i.show || i.show(user)))
                .map((i) => {
                  const active = route === i.key;
                  return (
                    <button
                      key={i.key}
                      onClick={() => setRoute(i.key)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition",
                        active ? "bg-white/12" : "hover:bg-white/10"
                      )}
                    >
                      <span>{i.label}</span>
                      {active ? <span className="text-xs text-white/60">•</span> : null}
                    </button>
                  );
                })}
            </div>
          </nav>

          <div className="mt-auto border-t border-white/10 p-4">
            <button
              className="w-full text-left"
              onClick={() => setProfileOpen(true)}
              title="Edit your profile"
            >
              <div className="text-sm font-medium hover:underline">{user.name}</div>
            </button>
            <div className="mt-0.5 text-xs text-white/70">
              {user.calling ? `${user.calling} • ` : ""}
              {user.organisation ? `${user.organisation} • ` : ""}
              {user.role}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2">
              <Button variant="secondary" className="w-full" onClick={() => setNotifOpen(true)}>
                Notifications {unread ? <Badge tone="blue">{unread}</Badge> : null}
              </Button>
              <Button variant="secondary" className="w-full" onClick={onLogout}>
                Sign out
              </Button>
            </div>
          </div>
        </aside>

        <main className="p-4 md:p-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>

        <ProfileModal
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          viewer={user}
          target={user}
          onSaved={() => {
            // Profile changes are stored in localStorage; ask parent to refresh.
            setNotifTick((t) => t + 1);
            onProfileChanged?.();
          }}
        />

        <Modal
          open={notifOpen}
          title="Notifications"
          onClose={() => setNotifOpen(false)}
          className="max-w-2xl"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  markAllRead(user.user_id);
                  setNotifTick((t) => t + 1);
                }}
              >
                Mark all read
              </Button>
              <Button variant="ghost" onClick={() => setNotifOpen(false)}>
                Close
              </Button>
            </>
          }
        >
          <div className="space-y-2">
            {notifs.length === 0 ? (
              <div className="text-sm text-slate-600">No notifications.</div>
            ) : (
              notifs.map((n) => {
                const cta = notifCta(n);
                return (
                  <div
                    key={n.notification_id}
                    className={cn(
                      "rounded-xl border border-[color:var(--border)] p-3",
                      n.read ? "bg-white" : "bg-sky-50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">{n.title}</div>
                        <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{n.body}</div>
                        <div className="mt-2 text-xs text-slate-500">
                          {new Date(n.created_date).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {!n.read ? <Badge tone="blue">New</Badge> : <Badge tone="gray">Read</Badge>}
                        <Button
                          variant="secondary"
                          onClick={() => {
                            markRead(n.notification_id);
                            setNotifTick((t) => t + 1);
                          }}
                        >
                          Mark read
                        </Button>
                        {cta ? (
                          <Button
                            onClick={() => {
                              if (!n.read) markRead(n.notification_id);
                              setNotifTick((t) => t + 1);
                              setNotifOpen(false);
                              setRoute(cta.route);
                            }}
                          >
                            {cta.label}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Modal>
      </div>
    </div>
  );
}
