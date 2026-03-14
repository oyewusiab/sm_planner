import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
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
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/ui";
import { formatDateShort, monthName } from "../utils/date";
import { getDB, syncNow, time, updateDB } from "../utils/storage";
import { syncMusic } from "../utils/backend";
import { MemberAutocomplete, normalizeGender } from "../components/MemberAutocomplete";
import { HymnAutocomplete } from "../components/HymnAutocomplete";

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

function MusicPrintView({ planner, unit }: { planner: Planner; unit: UnitSettings }) {
  return (
    <div className="music-print-view space-y-8 bg-white p-8">
      <div className="border-b-2 border-slate-900 pb-4 text-center">
        <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">
          Sacrament Meeting Music Plan
        </h1>
        <p className="mt-1 text-sm font-bold text-slate-600">
          {unit.unit_name} • {monthName(planner.month)} {planner.year}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {planner.weeks.map((w, idx) => (
          <div key={w.week_id} className="rounded-xl border border-slate-200 p-6 break-inside-avoid">
            <div className="mb-4 flex items-center justify-between border-b pb-2">
              <h2 className="text-lg font-black text-slate-800">
                Week {idx + 1} — {formatDateShort(w.date)}
              </h2>
              {w.is_canceled && <Badge tone="amber">No Meeting: {w.cancel_reason}</Badge>}
            </div>

            {!w.is_canceled && (
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Weekly Hymns</div>
                    <div className="mt-2 space-y-2">
                      <div className="flex justify-between border-b border-slate-100 py-1">
                        <span className="text-xs font-bold text-slate-600">Opening:</span>
                        <span className="text-xs font-black text-slate-900">{w.hymns.opening || "—"}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 py-1">
                        <span className="text-xs font-bold text-slate-600">Sacrament:</span>
                        <span className="text-xs font-black text-slate-900">{w.hymns.sacrament || "—"}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 py-1">
                        <span className="text-xs font-bold text-slate-600">Closing:</span>
                        <span className="text-xs font-black text-slate-900">{w.hymns.closing || "—"}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Music Service</div>
                    <div className="mt-2 space-y-2">
                      <div className="flex justify-between border-b border-slate-100 py-1">
                        <span className="text-xs font-bold text-slate-600">Director:</span>
                        <span className="text-xs font-black text-slate-900">{w.music?.director || "—"}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 py-1">
                        <span className="text-xs font-bold text-slate-600">Accompanist:</span>
                        <span className="text-xs font-black text-slate-900">{w.music?.accompanist || "—"}</span>
                      </div>
                    </div>
                  </div>
                  {w.note && (
                    <div className="rounded-lg bg-slate-50 p-2">
                      <div className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1">Notes</div>
                      <div className="text-[10px] text-slate-700 leading-tight">{w.note}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-8 border-t pt-4 text-center">
        <p className="text-[10px] text-slate-400 italic">
          Generated via Sacrament Meeting Planner Platform • {new Date().toLocaleDateString()}
        </p>
      </div>
    </div>
  );
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

  const [tab, setTab] = useState<"plans" | "toolkit">("plans");
  const [hymnQuery, setHymnQuery] = useState("");
  const [printOpen, setPrintOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const hymnLibrary = db.HYMNS || [];

  const filteredHymns = useMemo(() => {
    return hymnLibrary.filter(h => 
      h.title.toLowerCase().includes(hymnQuery.toLowerCase()) || 
      h.number.toString().includes(hymnQuery)
    );
  }, [hymnLibrary, hymnQuery]);

  const musicStatus = (local?.music_status || "PENDING") as "PENDING" | "COMPLETE";

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Music"
        subtitle="Music Coordinator toolkit: manage hymns, tracking, and weekly planning."
      />

      <Tabs>
        <TabsList>
          <TabsTrigger active={tab === "plans"} onClick={() => setTab("plans")}>Current Plans</TabsTrigger>
          <TabsTrigger active={tab === "toolkit"} onClick={() => setTab("toolkit")}>Music Toolkit</TabsTrigger>
        </TabsList>

        <TabsContent active={tab === "plans"}>
          <div className="space-y-6">
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
                  <div className="text-sm text-slate-600 italic">
                    {unit.unit_name} • {unit.venue} • {unit.meeting_time}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={() => saveMusic("PENDING")}>
                      Save Progress
                    </Button>
                    <Button onClick={() => saveMusic("COMPLETE")}>Mark Complete & Ready</Button>
                  </div>
                </div>
              </CardBody>
            </Card>

            {!local ? null : (
              <div className="space-y-4">
                {local.weeks.map((w, idx) => (
                  <Card key={w.week_id} className="animate-fade-in-up" style={{ animationDelay: `${idx * 0.1}s` }}>
                    <CardHeader>
                      <CardTitle>
                        Week {idx + 1} • {w.date ? formatDateShort(w.date) : "(no date)"}
                      </CardTitle>
                    </CardHeader>
                    <CardBody className="space-y-4">
                      <div className="space-y-1">
                        <Label>Topics (Names Hidden)</Label>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-xs leading-relaxed text-slate-600">
                          {weekTopicsOnly(w).split('\n').map((line, i) => <div key={i}>{line}</div>)}
                        </div>
                      </div>

                      <Divider />

                      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                        <div className="space-y-3">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-blue-600">Weekly Hymns</div>
                          <div className="space-y-1.5">
                            <Label>Opening</Label>
                            <HymnAutocomplete
                              hymns={hymnLibrary}
                              value={w.hymns.opening}
                              onChange={(val) => setHymn(w.week_id, "opening", val)}
                              className="h-9"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Sacrament</Label>
                            <HymnAutocomplete
                              hymns={hymnLibrary}
                              value={w.hymns.sacrament}
                              onChange={(val) => setHymn(w.week_id, "sacrament", val)}
                              className="h-9"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Closing</Label>
                            <HymnAutocomplete
                              hymns={hymnLibrary}
                              value={w.hymns.closing}
                              onChange={(val) => setHymn(w.week_id, "closing", val)}
                              className="h-9"
                            />
                          </div>
                        </div>

                        <div className="space-y-3 md:col-span-2">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-blue-600">Serving This Week</div>
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label>Music Director</Label>
                              <MemberAutocomplete
                                members={db.MEMBERS}
                                value={w.music?.director || ""}
                                onChange={(val) => setMusicField(w.week_id, "director", val)}
                                placeholder="Select Director…"
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
                            <div className="space-y-1.5">
                              <Label>Accompanist</Label>
                              <MemberAutocomplete
                                members={db.MEMBERS}
                                value={w.music?.accompanist || ""}
                                onChange={(val) => setMusicField(w.week_id, "accompanist", val)}
                                placeholder="Select Accompanist…"
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
                variant="outline"
                onClick={() => {
                  setPrintOpen(true);
                  setTimeout(() => {
                    const host = document.getElementById("planner-print-portal");
                    if (host) {
                      window.print();
                    }
                    // Keep printOpen for a bit to ensure browser renders
                    setTimeout(() => setPrintOpen(false), 2000);
                  }, 500);
                }}
              >
                Print Full Music Plan
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent active={tab === "toolkit"}>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Hymn Library & Search</CardTitle>
                <Button
                  variant="ghost"
                  disabled={syncing}
                  onClick={async () => {
                    setSyncing(true);
                    try {
                      await syncMusic();
                      await syncNow();
                      onChanged();
                    } catch (e) {
                      console.error("Sync failed", e);
                    } finally {
                      setSyncing(false);
                    }
                  }}
                >
                  {syncing ? "Syncing..." : "Sync LDS List"}
                </Button>
              </CardHeader>
              <CardBody className="space-y-4">
                <Input value={hymnQuery} onChange={(e) => setHymnQuery(e.target.value)} placeholder="Search title, number, or theme..." className="h-10" />
                <div className="max-h-[400px] overflow-y-auto rounded-xl border border-slate-100">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        <th className="p-3 font-bold text-slate-600">#</th>
                        <th className="p-3 font-bold text-slate-600">Title</th>
                        <th className="p-3 font-bold text-slate-600">Type</th>
                        <th className="p-3 font-bold text-slate-600">Theme</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {filteredHymns.map(h => (
                        <tr key={h.number} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 font-bold text-blue-600">{h.number}</td>
                          <td className="p-3 font-medium text-slate-800">{h.title}</td>
                          <td className="p-3">
                            <Badge tone={h.type === "New" ? "green" : (h.type === "Sacrament" ? "blue" : "gray")}>{h.type || "Classic"}</Badge>
                          </td>
                          <td className="p-3 text-slate-500 italic">{h.theme}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Smart Rotation</CardTitle>
                </CardHeader>
                <CardBody className="space-y-3">
                  <div className="flex items-center gap-3 rounded-xl bg-blue-50/50 p-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                      🎵
                    </div>
                    <div>
                      <div className="text-xs font-bold text-blue-900 uppercase tracking-tighter">Last Sacrament Hymn</div>
                      <div className="text-sm font-medium text-blue-700">Hymn 193 - I Stand All Amazed</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 rounded-xl bg-emerald-50/50 p-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                      ✨
                    </div>
                    <div>
                      <div className="text-xs font-bold text-emerald-900 uppercase tracking-tighter">Suggested Rotation</div>
                      <div className="text-sm font-medium text-emerald-700">Next: As Now We Take the Sacrament (#169)</div>
                    </div>
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Theme Matcher</CardTitle>
                </CardHeader>
                <CardBody>
                   <p className="text-xs text-slate-500 leading-relaxed italic">
                     When you select a planner, topics are analyzed here to suggest appropriate hymns.
                   </p>
                </CardBody>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Print portal for browser window.print() */}
      {printOpen && local &&
        (() => {
          const host = document.getElementById("planner-print-portal");
          if (!host) return null;
          return createPortal(
            <div className="print-portrait">
              <MusicPrintView planner={local} unit={unit} />
            </div>,
            host
          );
        })()}
    </div>
  );
}
