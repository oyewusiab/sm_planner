import { useMemo, useState } from "react";
import type { Member, UnitSettings, User } from "../types";
import { Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Input, Label, SectionTitle, Select, Textarea } from "../components/ui";
import { Modal } from "../components/Modal";
import { can } from "../utils/permissions";
import { getDB, ids, updateDB } from "../utils/storage";
import { downloadTextFile, toCSV } from "../utils/csv";
import { normalizeMemberName, getSurname } from "../utils/format";
import { cn } from "../utils/cn";
import { Badge } from "../components/ui";

function emptyMember(): Member {
  return {
    member_id: ids.uid("mem"),
    name: "",
    age: undefined,
    gender: "",
    phone: "",
    organisation: "",
    status: "",
    email: "",
    notes: "",
    created_date: new Date().toISOString().split("T")[0],
  };
}

export function MembersPage({
  user,
  unit,
  onChanged,
}: {
  user: User;
  unit: UnitSettings;
  onChanged: () => void;
}) {
  const allowed = can(user.role, "MANAGE_MEMBERS");
  const db = getDB();
  const [tab, setTab] = useState<"directory" | "analytics">("directory");
  const [q, setQ] = useState("");
  const [org, setOrg] = useState("ALL");
  const [filterMode, setFilterMode] = useState<string | null>(null);

  const organisations = useMemo(() => {
    const set = new Set<string>();
    for (const m of db.MEMBERS) if (m.organisation?.trim()) set.add(m.organisation.trim());
    return ["ALL", ...Array.from(set).sort()];
  }, [db.MEMBERS]);

  const analyticsData = useMemo(() => {
    const now = new Date();
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(now.getMonth() - 3);

    // 1. Initialise core structures
    const memberStats: Record<string, {
      total: number;
      speakers: number;
      invocation: number;
      benediction: number;
      lastDate: string | null;
      sacrament: { preparing: number; blessing: number; passing: number };
      music: { director: number; accompanist: number };
      monthlyAssignments: Record<string, number>; // year-month -> count
      topics: { topic: string; date: string }[];
    }> = {};

    const orgMetrics: Record<string, { total: number; idleCount: number }> = {};
    const topicUsageByDate: Record<string, string[]> = {}; // topic -> [date, date]
    const surnameStats: Record<string, number> = {};
    const statusStats: Record<string, number> = { "ACTIVE": 0, "LESS-ACTIVE": 0 };
    const genderStats: Record<string, number> = { "M": 0, "F": 0 };
    const globalMonthlyTrend: Record<string, number> = {}; // year-month -> total roles
    const surnameLastDate: Record<string, string | null> = {};
    
    // Member id lookup map for O(1) performance
    const nameMap = new Map<string, string>();
    for (const m of db.MEMBERS) {
      nameMap.set(normalizeMemberName(m.name), m.member_id);
      memberStats[m.member_id] = {
        total: 0, speakers: 0, invocation: 0, benediction: 0, lastDate: null,
        sacrament: { preparing: 0, blessing: 0, passing: 0 },
        music: { director: 0, accompanist: 0 },
        monthlyAssignments: {},
        topics: []
      };
    }

    // 2. Process all planners
    for (const p of db.PLANNERS) {
      const pMonth = `${p.year}-${String(p.month).padStart(2, "0")}`;
      for (const w of p.weeks) {
        const wDate = w.date || `${p.year}-${String(p.month).padStart(2, "0")}-01`;
        
        const rawAssignments = [
          { n: w.conducting_officer, t: "other" },
          { n: w.presiding, t: "other" },
          ...w.speakers.map(s => ({ n: s.name, t: "speaker", topic: s.topic })),
          { n: w.prayers.invocation, t: "invocation" },
          { n: w.prayers.benediction, t: "benediction" },
          { n: w.music?.director, t: "director" },
          { n: w.music?.accompanist, t: "accompanist" },
          ...w.sacrament.preparing.map(n => ({ n, t: "preparing" })),
          ...w.sacrament.blessing.map(n => ({ n, t: "blessing" })),
          ...w.sacrament.passing.map(n => ({ n, t: "passing" })),
        ];

        for (const ra of rawAssignments) {
          if (!ra.n) continue;
          const mid = nameMap.get(normalizeMemberName(ra.n));
          if (mid) {
            const s = memberStats[mid];
            s.total++;
            s.monthlyAssignments[pMonth] = (s.monthlyAssignments[pMonth] || 0) + 1;
            if (ra.t === "speaker") {
               s.speakers++;
               if (ra.topic) {
                 s.topics.push({ topic: ra.topic, date: wDate });
                 topicUsageByDate[ra.topic] = [...(topicUsageByDate[ra.topic] || []), wDate];
               }
            }
            if (ra.t === "invocation") s.invocation++;
            if (ra.t === "benediction") s.benediction++;
            if (ra.t === "director") s.music.director++;
            if (ra.t === "accompanist") s.music.accompanist++;
            if (ra.t === "preparing") s.sacrament.preparing++;
            if (ra.t === "blessing") s.sacrament.blessing++;
            if (ra.t === "passing") s.passing++;
            if (!s.lastDate || wDate > s.lastDate) s.lastDate = wDate;
            
            // Global trend
            globalMonthlyTrend[pMonth] = (globalMonthlyTrend[pMonth] || 0) + 1;
          }
        }
      }
    }

    // 3. Finalize analytics
    const processedMembers = db.MEMBERS.map(m => {
      const s = memberStats[m.member_id];
      const status = (m.status || "").toUpperCase();
      const gender = (m.gender || "").toUpperCase();
      const orgs = (m.organisation || "").split(",").map(o => o.trim()).filter(Boolean);
      const surname = getSurname(m.name);
      
      // Update global metrics
      if (status === "ACTIVE" || status === "LESS-ACTIVE") statusStats[status] += s.total;
      if (gender === "M" || gender === "F") genderStats[gender] += s.total;
      surnameStats[surname] = (surnameStats[surname] || 0) + s.total;

      for (const o of orgs) {
        if (!orgMetrics[o]) orgMetrics[o] = { total: 0, idleCount: 0 };
        orgMetrics[o].total += s.total;
        if (s.total === 0) orgMetrics[o].idleCount++;
      }

      const isNewcomer = m.created_date ? new Date(m.created_date) > threeMonthsAgo : false;
      const monthsSinceLast = s.lastDate ? Math.floor((now.getTime() - new Date(s.lastDate).getTime()) / (1000 * 60 * 60 * 24 * 30)) : 99;
      const isDoubleDipped = Object.values(s.monthlyAssignments).some(count => count > 1);

      // Speaker Readiness Score (0-100)
      // Factors: Active status, no assignment in 3m, not a newcomer (more than 1m), has spoken < 3 times in 1y
      let readiness = 0;
      if (status === "ACTIVE") {
        readiness += 40;
        if (monthsSinceLast >= 3) readiness += 30;
        if (s.speakers < 2) readiness += 20;
        if (!isNewcomer) readiness += 10;
      }

      if (!surnameLastDate[surname] || (s.lastDate && s.lastDate > (surnameLastDate[surname] || ""))) {
        surnameLastDate[surname] = s.lastDate;
      }

      return {
        ...m,
        ...s,
        status,
        orgs,
        surname,
        monthsSinceLast,
        isNewcomer,
        isDoubleDipped,
        readiness
      };
    });

    // 4. Trend Timeline (Last 12 months)
    const trendTimeline = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(now.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      trendTimeline.push({ month: key, count: globalMonthlyTrend[key] || 0 });
    }

    // 5. Forgotten Families (No assignment in 6 months)
    const forgottenFamilies = Object.entries(surnameLastDate)
      .filter(([_, last]) => !last || Math.floor((now.getTime() - new Date(last).getTime()) / (1000 * 60 * 60 * 24 * 30)) >= 6)
      .map(([name]) => name);

    // Topic staleness detection (used 3x in last 2 months)
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(now.getMonth() - 2);
    const staleTopics = Object.entries(topicUsageByDate)
      .filter(([_, dates]) => dates.filter(d => new Date(d) > twoMonthsAgo).length >= 3)
      .map(([topic]) => topic);

    // 6. Reliability Index (Last 4 Planners)
    const recentPlanners = db.PLANNERS
      .filter(p => p.state === "SUBMITTED")
      .sort((a, b) => b.updated_date.localeCompare(a.updated_date))
      .slice(0, 4);
    
    let totalTasks = 0;
    let completedTasks = 0;
    for (const p of recentPlanners) {
      const pChecklists = db.CHECKLISTS.filter(c => c.planner_id === p.planner_id);
      totalTasks += pChecklists.length;
      completedTasks += pChecklists.filter(c => c.status).length;
    }
    const reliabilityIndex = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 100;

    return {
      members: processedMembers,
      orgMetrics,
      statusStats,
      genderStats,
      surnameStats: Object.entries(surnameStats).sort((a, b) => b[1] - a[1]).slice(0, 10),
      staleTopics,
      trendTimeline,
      forgottenFamilies,
      reliabilityIndex,
      readySpeakers: processedMembers
        .filter(m => m.status === "ACTIVE" && m.readiness > 60)
        .sort((a, b) => b.readiness - a.readiness)
        .slice(0, 8),
      totalAssignments: processedMembers.reduce((a, b) => a + b.total, 0)
    };
  }, [db.MEMBERS, db.PLANNERS, db.CHECKLISTS]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let base = db.MEMBERS;

    // Apply analytics drill-down
    if (filterMode === "DOUBLE_DIPPED") {
      const ddIds = analyticsData.members.filter(m => m.isDoubleDipped).map(m => m.member_id);
      base = base.filter(m => ddIds.includes(m.member_id));
    } else if (filterMode === "IDLE") {
      base = base.filter(m => !analyticsData.members.find(am => am.member_id === m.member_id && am.total > 0));
    } else if (filterMode === "ACTIVE_MEMBER") {
      base = base.filter(m => m.status?.toUpperCase() === "ACTIVE");
    } else if (filterMode === "LESS_ACTIVE_MEMBER") {
      base = base.filter(m => m.status?.toUpperCase() === "LESS-ACTIVE");
    } else if (filterMode?.startsWith("SURNAME_")) {
      const surname = filterMode.replace("SURNAME_", "");
      base = base.filter(m => getSurname(m.name) === surname);
    }

    return base
      .filter((m) => (org === "ALL" ? true : (m.organisation || "").trim() === org))
      .filter((m) => {
        if (!query) return true;
        const hay = `${m.name} ${m.phone || ""} ${m.organisation || ""} ${m.email || ""}`.toLowerCase();
        return hay.includes(query);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [db.MEMBERS, q, org, filterMode, analyticsData.members]);


  const analytics = analyticsData.members;

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);

  function save(member: Member) {
    updateDB((db0) => {
      const exists = db0.MEMBERS.some((m) => m.member_id === member.member_id);
      const MEMBERS = exists
        ? db0.MEMBERS.map((m) => (m.member_id === member.member_id ? member : m))
        : [{ ...member, created_date: member.created_date || new Date().toISOString().split("T")[0] }, ...db0.MEMBERS];
      return { ...db0, MEMBERS };
    });
    onChanged();
  }

  function exportCSV() {
    const columns = [
      { key: "name", label: "Name" },
      { key: "age", label: "Age" },
      { key: "gender", label: "Gender" },
      { key: "phone", label: "Phone" },
      { key: "organisation", label: "Organisation" },
      { key: "status", label: "Status" },
      { key: "email", label: "Email" },
      { key: "notes", label: "Notes" },
    ];
    const csv = toCSV(filtered as any, columns);
    const safe = unit.unit_name.trim().replace(/\s+/g, "_");
    downloadTextFile(`members_${safe}.csv`, csv, "text/csv");
  }

  if (!allowed) {
    return <EmptyState title="Members Directory" body="You do not have permission to manage members." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle title="Members Directory" subtitle="Add, edit, search, and export your unit member list." />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={exportCSV}>
            Export CSV
          </Button>
          <Button
            onClick={() => {
              setEditing(emptyMember());
              setOpen(true);
            }}
          >
            Add Member
          </Button>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        <button
          onClick={() => setTab("directory")}
          className={cn("px-4 py-1.5 text-xs font-bold rounded-lg transition", tab === "directory" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}
        >
          Directory
        </button>
        <button
          onClick={() => setTab("analytics")}
          className={cn("px-4 py-1.5 text-xs font-bold rounded-lg transition", tab === "analytics" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}
        >
          Analytics
        </button>
      </div>

      {filterMode && (
        <div className="flex items-center gap-2 px-1">
          <Badge tone="blue" className="px-2 py-1 flex items-center gap-2">
            Filter: <span className="font-black italic">{filterMode.replace(/_/g, " ")}</span>
            <button onClick={() => setFilterMode(null)} className="ml-1 hover:text-white/80">✕</button>
          </Badge>
          <span className="text-[10px] text-slate-400 font-medium">Click ✕ to show all members</span>
        </div>
      )}

      {tab === "directory" ? (
        <>
      <Card>
        <CardHeader>
          <CardTitle>Search & Filter</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1 md:col-span-2">
              <Label>Search</Label>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, organisation…" />
            </div>
            <div className="space-y-1">
              <Label>Organisation</Label>
              <Select value={org} onChange={(e) => setOrg(e.target.value)}>
                {organisations.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3 font-medium text-slate-600">Name</th>
              <th className="p-3 font-medium text-slate-600">Age</th>
              <th className="p-3 font-medium text-slate-600">Gender</th>
              <th className="p-3 font-medium text-slate-600">Phone</th>
              <th className="p-3 font-medium text-slate-600">Organisation</th>
              <th className="p-3 font-medium text-slate-600">Status</th>
              <th className="p-3 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-500" colSpan={7}>
                  No members found.
                </td>
              </tr>
            ) : (
              filtered.map((m, idx) => (
                <tr key={m.member_id || `dir-${idx}`} className="border-t border-[color:var(--border)]">
                  <td className="p-3 font-medium">{m.name}</td>
                  <td className="p-3">{m.age ?? ""}</td>
                  <td className="p-3">{m.gender ?? ""}</td>
                  <td className="p-3">{m.phone ?? ""}</td>
                  <td className="p-3">{m.organisation ?? ""}</td>
                  <td className="p-3">{m.status ?? ""}</td>
                  <td className="p-3">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditing(JSON.parse(JSON.stringify(m)) as Member);
                        setOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </>
      ) : (
        /* Analytics View */
        <div className="space-y-8 animate-fade-in pb-12">
          {/* Top Level Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div 
              onClick={() => { setTab("directory"); setFilterMode("ACTIVE_MEMBER"); }}
              className="stat-card p-5 animate-scale-in stagger-1 cursor-pointer hover:border-emerald-200 group transition-all"
            >
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 group-hover:text-emerald-600 transition-colors">Active engagement</div>
              <div className="mt-2 text-3xl font-black text-slate-800">
                {(analyticsData.statusStats || {})["ACTIVE"] || 0} <span className="text-sm font-normal text-slate-400">/ {analyticsData.totalAssignments || 0}</span>
              </div>
              <div className="mt-1 text-xs font-semibold text-emerald-600">Roles given to ACTIVE</div>
            </div>

            <div 
              onClick={() => { setTab("directory"); setFilterMode("LESS_ACTIVE_MEMBER"); }}
              className="stat-card p-5 animate-scale-in stagger-2 cursor-pointer hover:border-rose-200 group transition-all"
            >
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 group-hover:text-rose-600 transition-colors">Less-Active Inclusion</div>
              <div className="grow mt-2 flex items-end gap-2">
                <div className="text-3xl font-black text-slate-800">{(analyticsData.statusStats || {})["LESS-ACTIVE"] || 0}</div>
                <div className="mb-1 text-xs font-bold text-rose-500">
                  {Math.round((((analyticsData.statusStats || {})["LESS-ACTIVE"] || 0) / (analyticsData.totalAssignments || 1)) * 100)}%
                </div>
              </div>
              <div className="mt-1 text-xs font-semibold text-slate-400">Roles to LESS-ACTIVE</div>
            </div>

            <div 
              onClick={() => { setTab("directory"); setFilterMode("DOUBLE_DIPPED"); }}
              className="stat-card p-5 animate-scale-in stagger-3 cursor-pointer hover:border-blue-200 group transition-all bg-gradient-to-br from-white to-blue-50/30"
            >
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 group-hover:text-blue-600 transition-colors">Double-Dip Load</div>
              <div className="mt-2 text-3xl font-black text-blue-600">
                {analyticsData.members.filter(m => m.isDoubleDipped).length}
                <span className="text-sm font-normal text-slate-400 ml-1">members</span>
              </div>
              <div className="mt-1 text-xs font-semibold text-slate-400">Multiple orgs same month</div>
            </div>

            <div 
              className="stat-card p-5 animate-scale-in stagger-4 cursor-pointer hover:border-sky-200 group transition-all"
            >
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 group-hover:text-sky-600 transition-colors">Meeting Reliability</div>
              <div className="mt-2 text-3xl font-black text-sky-500">
                {analyticsData.reliabilityIndex}%
              </div>
              <div className="mt-1 text-xs font-semibold text-slate-400">Checklist Completion</div>
            </div>
          </div>

          {/* Activity Trend Timeline */}
          <Card className="animate-fade-in stagger-2 bg-gradient-to-r from-slate-900 to-slate-800 border-none shadow-xl overflow-hidden">
            <CardBody className="p-6">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-lg font-black text-white">Participation Momentum</h3>
                  <p className="text-xs text-slate-400">Total assignments across all meeting categories (Last 12 Months)</p>
                </div>
                <Badge tone="blue" className="bg-blue-500/20 text-blue-300 border-none px-3 py-1 font-black">
                  {analyticsData.totalAssignments} Total Assignments
                </Badge>
              </div>
              <div className="flex items-end justify-between gap-1 h-32">
                {analyticsData.trendTimeline.map((t, idx) => {
                  const max = Math.max(...analyticsData.trendTimeline.map(m => m.count)) || 1;
                  const height = Math.max(5, (t.count / max) * 100);
                  return (
                    <div key={t.month} className="group relative flex-1 flex flex-col items-center">
                      <div 
                        className="w-full rounded-t-sm bg-blue-500/40 group-hover:bg-blue-400 transition-all cursor-crosshair"
                        style={{ height: `${height}%` }}
                      >
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-white text-slate-900 text-[10px] font-black px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg z-20">
                          {t.count} Roles
                        </div>
                      </div>
                      <div className="mt-2 text-[8px] font-bold text-slate-500 uppercase tracking-tighter">
                        {t.month.split('-')[1] === '01' ? t.month.split('-')[0] : t.month.split('-')[1]}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Speaker Frequency & Load Dashboard */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div>
                    <CardTitle>Member Assignment Load</CardTitle>
                    <p className="text-xs text-slate-500 mt-0.5">Comprehensive tracking of all member participation.</p>
                  </div>
                  <Badge tone="blue">Analysis of {analyticsData.members.length} Members</Badge>
                </CardHeader>
                <CardBody className="p-0">
                  <div className="max-h-[400px] overflow-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm border-b">
                        <tr>
                          <th className="p-4 font-bold text-slate-600">Member</th>
                          <th className="p-4 font-bold text-slate-600 text-center">Spoken</th>
                          <th className="p-4 font-bold text-slate-600 text-center">Prayers</th>
                          <th className="p-4 font-bold text-slate-600 text-center">Sacr/Music</th>
                          <th className="p-4 font-bold text-slate-600 text-right">Last</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {analyticsData.members.map((m, idx) => (
                          <tr key={m.member_id || `m-${idx}`} className="hover:bg-slate-50/50 transition-colors">
                            <td className="p-4">
                              <div className="font-semibold text-slate-800 truncate max-w-[150px]">{m.name}</div>
                              <div className="flex gap-1.5 mt-0.5 items-center">
                                <Badge tone={m.status === "ACTIVE" ? "green" : "rose"} className="text-[7px] px-1 py-0">{m.status || "Unknown"}</Badge>
                                {m.isDoubleDipped && <Badge tone="amber" className="text-[7px] px-1 py-0">Double-Dipped</Badge>}
                              </div>
                            </td>
                            <td className="p-4 text-center font-bold text-slate-700">{m.speakers}</td>
                            <td className="p-4 text-center text-slate-600">{m.invocation}/{m.benediction}</td>
                            <td className="p-4 text-center text-slate-600">{(m.sacrament.preparing+m.sacrament.blessing+m.sacrament.passing)}/{m.music.director+m.music.accompanist}</td>
                            <td className="p-4 text-right">
                              <div className={cn("text-xs font-bold", m.monthsSinceLast > 6 ? "text-rose-500" : "text-slate-400")}>
                                {m.monthsSinceLast === 99 ? "Never" : `${m.monthsSinceLast}m ago`}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              </Card>

              {/* Speaker Pipeline */}
              <Card className="bg-gradient-to-br from-white to-indigo-50/20 border-indigo-100">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span className="text-indigo-600">🎙️</span> Speaker Readiness Pipeline
                  </CardTitle>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Top candidates for next month's sacrament meeting</p>
                </CardHeader>
                <CardBody>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {analyticsData.readySpeakers.map((m, idx) => (
                      <div key={m.member_id || `rs-${idx}`} className="p-3 rounded-xl bg-white border border-indigo-50 shadow-sm flex items-center justify-between group hover:shadow-md transition-all">
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-800 truncate">{m.name}</div>
                          <div className="text-[10px] text-slate-400 font-bold">{m.monthsSinceLast === 99 ? "Never spoken" : `${m.monthsSinceLast}m since last assignment`}</div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className="h-1.5 w-16 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500" style={{ width: `${m.readiness}%` }} />
                          </div>
                          <span className="text-[8px] font-black text-indigo-600 uppercase tracking-tighter">{m.readiness}% Ready</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>

              {/* Advanced Tracking Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Youth Milestone Tracker */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                       <span>👦</span> Youth Milestone Tracker (12-18)
                    </CardTitle>
                  </CardHeader>
                  <CardBody>
                    <div className="space-y-4">
                      {analyticsData.members.filter(m => m.age && m.age >= 12 && m.age <= 18).slice(0, 5).map((m, idx) => (
                        <div key={m.member_id || `y-${idx}`} className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-700">{m.name} ({m.age})</span>
                            <div className="flex gap-1">
                              <Badge tone="blue" className="text-[8px]">P: {m.sacrament.passing}</Badge>
                              <Badge tone="indigo" className="text-[8px]">B: {m.sacrament.blessing}</Badge>
                              <Badge tone="purple" className="text-[8px]">Pr: {m.sacrament.preparing}</Badge>
                            </div>
                          </div>
                          <div className="h-1.5 w-full bg-slate-100 rounded-full flex overflow-hidden">
                            <div className="h-full bg-blue-400" title="Passing" style={{ width: `${(m.sacrament.passing/10)*100}%` }} />
                            <div className="h-full bg-indigo-500" title="Blessing" style={{ width: `${(m.sacrament.blessing/10)*100}%` }} />
                            <div className="h-full bg-purple-600" title="Preparing" style={{ width: `${(m.sacrament.preparing/10)*100}%` }} />
                          </div>
                        </div>
                      ))}
                      {analyticsData.members.filter(m => m.age && m.age >= 12 && m.age <= 18).length === 0 && (
                         <p className="text-center text-slate-400 text-xs py-4 italic">No youth records found.</p>
                      )}
                    </div>
                  </CardBody>
                </Card>

                {/* Music Volunteer Load */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                       <span>🎵</span> Music Volunteer Load
                    </CardTitle>
                  </CardHeader>
                  <CardBody>
                    <div className="space-y-4">
                       {analyticsData.members.filter(m => m.music.director > 0 || m.music.accompanist > 0).map((m, idx) => (
                         <div key={m.member_id || `mu-${idx}`} className="flex items-center justify-between">
                            <div className="min-w-0">
                               <div className="text-xs font-bold text-slate-800 truncate">{m.name}</div>
                               <div className="text-[10px] text-slate-400 uppercase font-bold">
                                 {m.music.director}x Director • {m.music.accompanist}x Accompanist
                               </div>
                            </div>
                            <div className="flex gap-1 items-center">
                               <div className="h-2 w-2 rounded-full bg-blue-500" style={{ opacity: Math.min(1, (m.music.director+m.music.accompanist)/5) }} />
                               <span className="text-xs font-black text-slate-600">{m.music.director + m.music.accompanist}</span>
                            </div>
                         </div>
                       ))}
                       {analyticsData.members.filter(m => m.music.director > 0 || m.music.accompanist > 0).length === 0 && (
                          <p className="text-center text-slate-400 text-xs py-4 italic">No music assignments recorded.</p>
                       )}
                    </div>
                  </CardBody>
                </Card>
              </div>

              {/* Organisation Balance */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Organisation Saturation & Idle Count</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <div className="space-y-4">
                      {Object.entries(analyticsData.orgMetrics).sort((a, b) => b[1].total - a[1].total).map(([org, metrics]) => {
                        const pct = Math.round((metrics.total / (analyticsData.totalAssignments || 1)) * 100);
                        return (
                          <div key={org} className="space-y-1.5">
                            <div className="flex justify-between text-[10px] font-bold">
                              <span className="text-slate-700 truncate mr-2">{org}</span>
                              <span className="text-slate-500 shrink-0">{metrics.total} assigns • {metrics.idleCount} IDLE</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Family/Surname Saturation</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <div className="space-y-4">
                      {analyticsData.surnameStats.slice(0, 6).map(([surname, count]) => {
                        const pct = Math.round((count / (analyticsData.totalAssignments || 1)) * 100);
                        return (
                          <div key={surname} className="space-y-1.5">
                            <div className="flex justify-between text-[10px] font-bold">
                              <span className="text-slate-700">{surname} Family</span>
                              <span className="text-slate-500">{count} roles ({pct}%)</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.min(pct * 5, 100)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardBody>
                </Card>
              </div>
            </div>

            {/* Side Column: Alerts, Topics, Hymns */}
              {/* Topic Staleness Alert */}
              {analyticsData.staleTopics.length > 0 && (
                <Card className="border-amber-100 bg-amber-50/30">
                  <CardHeader>
                    <CardTitle className="text-amber-800 text-sm flex items-center gap-2">
                       <span>🕒</span> Topic Staleness Alerts
                    </CardTitle>
                  </CardHeader>
                  <CardBody className="py-2">
                    <div className="flex flex-wrap gap-2">
                      {analyticsData.staleTopics.map(topic => (
                        <Badge key={topic} tone="amber" className="capitalize">{topic}</Badge>
                      ))}
                    </div>
                    <p className="text-[10px] text-amber-600 mt-2 font-bold italic underline">Used 3+ times in last 2 months</p>
                  </CardBody>
                </Card>
              )}

              {/* Newcomer Spotlight */}
              <Card className="border-blue-100 bg-blue-50/20">
                <CardHeader>
                  <CardTitle className="text-blue-900 flex items-center gap-2">
                    <span>✨</span> Newcomer Spotlight
                  </CardTitle>
                </CardHeader>
                <CardBody className="p-0">
                  <div className="divide-y divide-blue-100">
                    {analyticsData.members
                      .filter(m => m.isNewcomer && m.total === 0)
                      .slice(0, 5)
                      .map((m, idx) => (
                        <div key={m.member_id || `new-${idx}`} className="p-3 flex items-center justify-between hover:bg-blue-100/30 transition-colors">
                          <div className="min-w-0">
                            <div className="font-bold text-blue-900 truncate">{m.name}</div>
                            <div className="text-[10px] text-blue-600 uppercase font-bold tracking-tight">Joined recently • No roles yet</div>
                          </div>
                          <Badge tone="blue" className="shrink-0">Spotlight</Badge>
                        </div>
                      ))}
                    {analyticsData.members.filter(m => m.isNewcomer && m.total === 0).length === 0 && (
                      <div className="p-6 text-center text-slate-500 text-xs italic">No new members needing intro.</div>
                    )}
                  </div>
                </CardBody>
              </Card>

               {/* Forgotten Families Alert */}
               {analyticsData.forgottenFamilies.length > 0 && (
                <Card className="border-rose-100 bg-rose-50/30">
                  <CardHeader>
                    <CardTitle className="text-rose-800 text-sm flex items-center gap-2">
                       <span>🏠</span> Forgotten Families Alert
                    </CardTitle>
                  </CardHeader>
                  <CardBody className="py-2">
                    <div className="flex flex-wrap gap-2">
                      {analyticsData.forgottenFamilies.slice(0, 8).map(name => (
                        <Badge 
                          key={name} 
                          onClick={() => { setTab("directory"); setFilterMode(`SURNAME_${name}`); }}
                          tone="rose" 
                          className="capitalize cursor-pointer hover:scale-105 transition-transform"
                        >
                          {name}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-[10px] text-rose-600 mt-2 font-bold italic underline">No assignments in 6+ months</p>
                  </CardBody>
                </Card>
               )}

              {/* Double-Dip Alerts */}
              <Card className="border-rose-100 bg-rose-50/20">
                <CardHeader>
                  <CardTitle className="text-rose-900 flex items-center gap-2">
                    <span>⚠️</span> Multi-Organisation "Double-Dip"
                  </CardTitle>
                </CardHeader>
                <CardBody className="p-0">
                  <div className="divide-y divide-rose-100">
                    {analyticsData.members
                      .filter(m => m.isDoubleDipped)
                      .slice(0, 5)
                      .map((m, idx) => (
                        <div key={m.member_id || `dd-${idx}`} className="p-3 flex items-center justify-between hover:bg-rose-100/30 transition-colors">
                          <div className="min-w-0">
                            <div className="font-bold text-rose-900 truncate">{m.name}</div>
                            <div className="text-[10px] text-rose-600 uppercase font-bold tracking-tight">Assigned in {m.orgs.length} orgs same month</div>
                          </div>
                          <Badge tone="rose" className="shrink-0">Overload</Badge>
                        </div>
                      ))}
                    {analyticsData.members.filter(m => m.isDoubleDipped).length === 0 && (
                      <div className="p-6 text-center text-slate-500 text-xs italic">No overload detected.</div>
                    )}
                  </div>
                </CardBody>
              </Card>
          </div>
        </div>
      )}

      <Modal
        open={open}
        title={editing?.name ? `Edit Member` : "Add Member"}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button
              onClick={() => {
                if (!editing) return;
                if (!editing.name.trim()) return;
                save({
                  ...editing,
                  name: editing.name.trim(),
                  organisation: editing.organisation?.trim() || undefined,
                  phone: editing.phone?.trim() || undefined,
                  status: editing.status?.trim() || undefined,
                  email: editing.email?.trim() || undefined,
                  notes: editing.notes?.trim() || undefined,
                  age: editing.age ? Number(editing.age) : undefined,
                });
                setOpen(false);
              }}
            >
              Save
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label>Name</Label>
              <Input value={editing.name} onChange={(e) => setEditing((m) => (m ? { ...m, name: e.target.value } : m))} />
            </div>
            <div className="space-y-1">
              <Label>Age</Label>
              <Input
                type="number"
                value={editing.age ?? ""}
                onChange={(e) => setEditing((m) => (m ? { ...m, age: e.target.value ? Number(e.target.value) : undefined } : m))}
              />
            </div>
            <div className="space-y-1">
              <Label>Gender</Label>
              <Input value={editing.gender ?? ""} onChange={(e) => setEditing((m) => (m ? { ...m, gender: e.target.value } : m))} />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={editing.phone ?? ""} onChange={(e) => setEditing((m) => (m ? { ...m, phone: e.target.value } : m))} />
            </div>
            <div className="space-y-1">
              <Label>Organisation</Label>
              <Input value={editing.organisation ?? ""} onChange={(e) => setEditing((m) => (m ? { ...m, organisation: e.target.value } : m))} placeholder="Elders Quorum, Relief Society…" />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Input value={editing.status ?? ""} onChange={(e) => setEditing((m) => (m ? { ...m, status: e.target.value } : m))} placeholder="Active, New Move-in…" />
            </div>
            <div className="space-y-1">
              <Label>Email (optional)</Label>
              <Input value={editing.email ?? ""} onChange={(e) => setEditing((m) => (m ? { ...m, email: e.target.value } : m))} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Notes</Label>
              <Textarea rows={4} value={editing.notes ?? ""} onChange={(e) => setEditing((m) => (m ? { ...m, notes: e.target.value } : m))} />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
