import React, { useMemo, useState } from "react";
import type { Notification, Role, UnitSettings, User } from "../types";
import { cn } from "../utils/cn";
import { listNotificationsForUser, markAllRead, markRead, unreadCount } from "../utils/notifications";
import { Modal } from "./Modal";
import { ProfileModal } from "./ProfileModal";
import { Badge, Button } from "./ui";

import { formatUserDisplayName } from "../utils/format";

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
  icon: string;
  roles?: Role[];
  show?: (user: User) => boolean;
}[] = [
  { key: "dashboard",     label: "Dashboard",     icon: "⊞" },
  { key: "planner",       label: "Planner",        icon: "📅", roles: ["ADMIN", "BISHOPRIC", "CLERK", "SECRETARY"] },
  { key: "archive",       label: "Archive",        icon: "🗂️", roles: ["ADMIN", "CLERK"] },
  { key: "assignments",   label: "Assignments",    icon: "✉️", roles: ["ADMIN", "BISHOPRIC", "CLERK", "SECRETARY"] },
  { key: "notifications", label: "Notifications",  icon: "🔔", roles: ["ADMIN", "BISHOPRIC", "CLERK", "SECRETARY", "MUSIC"] },
  { key: "checklist",     label: "Checklist",      icon: "✅", roles: ["ADMIN", "BISHOPRIC", "CLERK", "SECRETARY"] },
  { key: "members",       label: "Members",        icon: "👥", roles: ["ADMIN", "BISHOPRIC", "CLERK"] },
  { key: "music",         label: "Music",          icon: "🎵", roles: ["ADMIN", "MUSIC"] },
  {
    key: "settings",
    label: "Settings",
    icon: "⚙️",
    roles: ["ADMIN", "CLERK"],
  },
];

function notifCta(n: Notification): { label: string; route: RouteKey } | null {
  if (n.type === "SETTINGS_APPROVAL_REQUEST") return { label: "Open Settings", route: "settings" };
  if (n.type === "MUSIC_INPUT_REQUEST") return { label: "Open Music", route: "music" };
  return null;
}

// Initials avatar helper
function Initials({ name }: { name: string }) {
  const parts = name.trim().split(" ");
  const letters = parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : parts[0].slice(0, 2);
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-bold text-white shadow-sm ring-2 ring-white/20">
      {letters.toUpperCase()}
    </div>
  );
}

export function AppShell({
  user,
  unit,
  route,
  setRoute,
  onLogout,
  onProfileChanged,
  dbTick = 0,
  children,
}: {
  user: User;
  unit: UnitSettings;
  route: RouteKey;
  setRoute: (r: RouteKey) => void;
  onLogout: () => void;
  onProfileChanged?: () => void;
  dbTick?: number;
  children: React.ReactNode;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifTick, setNotifTick] = useState(0);

  const { notifs, unread } = useMemo(() => {
    void notifTick;
    void dbTick;
    const notifs0 = listNotificationsForUser(user.user_id);
    return { notifs: notifs0, unread: unreadCount(user.user_id) };
  }, [user.user_id, notifTick, dbTick]);

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="grid min-h-screen grid-cols-1 md:grid-cols-[268px_1fr]">
        {/* ── Sidebar ── */}
        <aside
          className="no-print flex flex-col text-white"
          style={{
            background: "linear-gradient(180deg, #003459 0%, #001f35 80%, #00171f 100%)",
          }}
        >
          {/* Brand header */}
          <div
            className="border-b px-5 py-5"
            style={{ borderColor: "rgba(255,255,255,0.08)" }}
          >
            {/* App logo row */}
            <div className="mb-3 flex items-center gap-3">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl text-lg shadow-md"
                style={{
                  background: "linear-gradient(135deg, #00c6fb 0%, #005bea 100%)",
                }}
              >
                <svg
                  className="h-5 w-5 text-white"
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
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-white/50">
                  Sacrament
                </div>
                <div className="text-sm font-bold leading-tight text-white">Planner</div>
              </div>

              {/* Notification bell */}
              <button
                className={cn(
                  "relative ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg border text-sm transition",
                  "border-white/10 bg-white/5 hover:bg-white/10",
                  unread ? "ring-2 ring-[#00c6fb]/40" : ""
                )}
                title="Notifications"
                onClick={() => setNotifOpen(true)}
              >
                <span aria-hidden>🔔</span>
                {unread ? (
                  <span
                    className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
                    style={{ background: "linear-gradient(135deg, #00c6fb, #005bea)" }}
                  >
                    {unread}
                  </span>
                ) : null}
              </button>
            </div>

            {/* Unit info */}
            <div
              className="rounded-xl px-3 py-2.5"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              <div className="truncate text-sm font-semibold text-white/90">
                {unit.unit_name}
              </div>
              <div className="mt-0.5 truncate text-xs text-white/50">
                {unit.unit_type} · {unit.meeting_time}
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4">
            <div className="mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-white/30">
              Navigation
            </div>
            <div className="space-y-0.5">
              {navItems
                .filter(
                  (i) =>
                    (!i.roles || i.roles.includes(user.role)) &&
                    (!i.show || i.show(user))
                )
                .map((i) => {
                  const active = route === i.key;
                  return (
                    <button
                      key={i.key}
                      onClick={() => setRoute(i.key)}
                      className={cn("sidebar-nav-item", active ? "active" : "")}
                    >
                      <span className="sidebar-nav-icon">{i.icon}</span>
                      <span>{i.label}</span>
                      {i.key === "notifications" && unread ? (
                        <span
                          className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
                          style={{ background: "linear-gradient(135deg, #00c6fb, #005bea)" }}
                        >
                          {unread}
                        </span>
                      ) : active ? (
                        <span
                          className="ml-auto h-1.5 w-1.5 rounded-full"
                          style={{ background: "#00c6fb" }}
                        />
                      ) : null}
                    </button>
                  );
                })}
            </div>
          </nav>

          {/* User area */}
          <div
            className="border-t px-4 py-4"
            style={{ borderColor: "rgba(255,255,255,0.08)" }}
          >
            <button
              className="w-full text-left transition"
              onClick={() => setProfileOpen(true)}
              title="Edit your profile"
            >
              <div className="flex items-center gap-3">
                <Initials name={user.name} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white hover:underline">
                    {formatUserDisplayName(user)}
                  </div>
                  <div className="truncate text-xs text-white/50">
                    {user.calling || user.role}
                  </div>
                </div>
              </div>
            </button>
            <div className="mt-3">
              <button
                className="w-full rounded-xl py-2 text-center text-xs font-semibold text-white/50 transition hover:bg-white/5 hover:text-white/80"
                onClick={onLogout}
              >
                Sign out ↩
              </button>
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="p-4 md:p-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>

        <ProfileModal
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          viewer={user}
          target={user}
          onSaved={() => {
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
                        <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                          {n.body}
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          {new Date(n.created_date).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {!n.read ? (
                          <Badge tone="blue">New</Badge>
                        ) : (
                          <Badge tone="gray">Read</Badge>
                        )}
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
