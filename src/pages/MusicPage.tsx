import { useMemo, useState } from "react";
import type { Planner, UnitSettings, User, WeekPlan } from "../types";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Divider,
  EmptyState,
  Input,
  Label,
  SectionTitle,
  Select,
  Textarea,
} from "../components/ui";
import { formatDateShort, monthName } from "../utils/date";
import { getDB, time, updateDB } from "../utils/storage";
import { MemberAutocomplete, normalizeGender } from "../components/MemberAutocomplete";

function plannerLabel(p: Planner) {
  return `${monthName(p.month)} ${p.year}`;
}

function weekTopicsOnly(w: WeekPlan) {
  const topics = (w.speakers || [])
    .map((s) => (s.topic || "").trim())
    .filter(Boolean);
  if (topics.length === 0) return "(No topics yet)";
  return topics.map((t, i) => `${i + 1}. ${t}`).join("\n");
}

export function MusicPage({
  user,
  unit,
  onChanged,
}: {
  user: User;
  unit: UnitSettings;
  onChanged: () => void;
}) {
  const db = getDB();

  const isMusic = user.role === "MUSIC";
  const isAdmin = user.role === "ADMIN";
  const allowed = isMusic || isAdmin;

  const submitted = useMemo(
    () => [...db.PLANNERS].filter((p) => p.state === "SUBMITTED").sort((a, b) => b.updated_date.localeCompare(a.updated_date)),
    [db.PLANNERS]
  );

  const [plannerId, setPlannerId] = useState(submitted[0]?.planner_id || "");
  const planner = submitted.find((p) => p.planner_id === plannerId) || null;

  const [local, setLocal] = useState<Planner | null>(planner ? (JSON.parse(JSON.stringify(planner)) as Planner) : null);

  // keep local draft in sync when switching planners
  useMemo(() => {
    setLocal(planner ? (JSON.parse(JSON.stringify(planner)) as Planner) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannerId]);

  if (!allowed) {
    return <EmptyState title="Music" body="Music Coordinator access only." />;
  }

  if (submitted.length === 0) {
    return (
      <EmptyState
        title="Music"
        body="No submitted planners yet. When a planner is submitted, the Music Coordinator will receive a notification."
      />
    );
  }

  function saveMusic(status: "PENDING" | "COMPLETE") {
    if (!local) return;
    const next: Planner = {
      ...local,
      music_status: status,
      updated_date: time.nowISO(),
    };

    updateDB((db0) => {
      const PLANNERS = db0.PLANNERS.map((p) => (p.planner_id === next.planner_id ? next : p));
      return { ...db0, PLANNERS };
    });

    // If this page was opened from a notification CTA, mark the notification as read.
    // (We can’t reliably know which notif; but we’ll mark any MUSIC_INPUT_REQUEST for this planner & user as read.)
    updateDB((db0) => {
      const NOTIFICATIONS = db0.NOTIFICATIONS.map((n) => {
        if (
          n.to_user_id === user.user_id &&
          n.type === "MUSIC_INPUT_REQUEST" &&
          n.meta?.planner_id === next.planner_id
        ) {
          return { ...n, read: true };
        }
        return n;
      });
      return { ...db0, NOTIFICATIONS };
    });

    onChanged();
    setLocal(next);
  }


  function setHymn(week_id: string, key: "opening" | "sacrament" | "closing", value: string) {
    setLocal((p) => {
      if (!p) return p;
      const weeks = p.weeks.map((w) => {
        if (w.week_id !== week_id) return w;
        return { ...w, hymns: { ...w.hymns, [key]: value } };
      });
      return { ...p, weeks };
    });
  }

  function setMusicField(week_id: string, key: "director" | "accompanist", value: string) {
    setLocal((p) => {
      if (!p) return p;
      const weeks = p.weeks.map((w) => {
        if (w.week_id !== week_id) return w;
        return { ...w, music: { ...(w.music || {}), [key]: value } };
      });
      return { ...p, weeks };
    });
  }

  const musicStatus = (local?.music_status || "PENDING") as "PENDING" | "COMPLETE";

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Music"
        subtitle="Music Coordinator workflow: view weekly topics (only) and fill hymns + music leaders."
      />

      <Card>
        <CardHeader>
          <CardTitle>Select submitted planner</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1 md:col-span-2">
              <Label>Planner</Label>
              <Select
                value={plannerId}
                onChange={(e) => {
                  setPlannerId(e.target.value);
                }}
              >
                {submitted.map((p) => (
                  <option key={p.planner_id} value={p.planner_id}>
                    {plannerLabel(p)} — {p.unit_name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <div className="pt-2">
                <Badge tone={musicStatus === "COMPLETE" ? "green" : "amber"}>{musicStatus}</Badge>
              </div>
            </div>
          </div>

          <Divider />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-slate-600">{unit.unit_name} • {unit.venue} • {unit.meeting_time}</div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => saveMusic("PENDING")}>
                Save (keep pending)
              </Button>
              <Button onClick={() => saveMusic("COMPLETE")}>Mark complete</Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {!local ? null : (
        <div className="space-y-4">
          {local.weeks.map((w, idx) => (
            <Card key={w.week_id}>
              <CardHeader>
                <CardTitle>
                  Week {idx + 1} • {w.date ? formatDateShort(w.date) : "(no date)"}
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="space-y-1">
                  <Label>Topics (from planner — names hidden)</Label>
                  <Textarea value={weekTopicsOnly(w)} rows={4} disabled />
                </div>

                <Divider />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-slate-900">Hymns</div>
                    <div className="space-y-1">
                      <Label>Opening</Label>
                      <Input value={w.hymns.opening} onChange={(e) => setHymn(w.week_id, "opening", e.target.value)} placeholder="e.g., Hymn 2" />
                    </div>
                    <div className="space-y-1">
                      <Label>Sacrament</Label>
                      <Input value={w.hymns.sacrament} onChange={(e) => setHymn(w.week_id, "sacrament", e.target.value)} placeholder="e.g., Hymn 169" />
                    </div>
                    <div className="space-y-1">
                      <Label>Closing</Label>
                      <Input value={w.hymns.closing} onChange={(e) => setHymn(w.week_id, "closing", e.target.value)} placeholder="e.g., Hymn 124" />
                    </div>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <div className="text-sm font-semibold text-slate-900">Music Leaders</div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-1">
                        <Label>Music Director</Label>
                        <MemberAutocomplete
                          members={db.MEMBERS}
                          value={w.music?.director || ""}
                          onChange={(val) => setMusicField(w.week_id, "director", val)}
                          placeholder="Select from Members…"
                          onPick={(m) => {
                            const g = normalizeGender(m.gender);
                            setLocal((p) => {
                              if (!p) return p;
                              const weeks = p.weeks.map((wk) => {
                                if (wk.week_id !== w.week_id) return wk;
                                return {
                                  ...wk,
                                  music: {
                                    ...(wk.music || {}),
                                    director: m.name,
                                    director_gender: g ?? wk.music?.director_gender,
                                  },
                                };
                              });
                              return { ...p, weeks };
                            });
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Music Accompanist</Label>
                        <MemberAutocomplete
                          members={db.MEMBERS}
                          value={w.music?.accompanist || ""}
                          onChange={(val) => setMusicField(w.week_id, "accompanist", val)}
                          placeholder="Select from Members…"
                          onPick={(m) => {
                            const g = normalizeGender(m.gender);
                            setLocal((p) => {
                              if (!p) return p;
                              const weeks = p.weeks.map((wk) => {
                                if (wk.week_id !== w.week_id) return wk;
                                return {
                                  ...wk,
                                  music: {
                                    ...(wk.music || {}),
                                    accompanist: m.name,
                                    accompanist_gender: g ?? wk.music?.accompanist_gender,
                                  },
                                };
                              });
                              return { ...p, weeks };
                            });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <div className="no-print flex justify-end">
        <Button
          variant="secondary"
          onClick={() => {
            // Use existing global print styles
            setTimeout(() => window.print(), 50);
          }}
        >
          Print Music Plan
        </Button>
      </div>
    </div>
  );
}
