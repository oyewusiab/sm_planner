import { useMemo, useState } from "react";
import type { Member, UnitSettings, User } from "../types";
import { Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Input, Label, SectionTitle, Select, Textarea } from "../components/ui";
import { Modal } from "../components/Modal";
import { can } from "../utils/permissions";
import { getDB, ids, updateDB } from "../utils/storage";
import { downloadTextFile, toCSV } from "../utils/csv";

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

  const organisations = useMemo(() => {
    const set = new Set<string>();
    for (const m of db.MEMBERS) if (m.organisation?.trim()) set.add(m.organisation.trim());
    return ["ALL", ...Array.from(set).sort()];
  }, [db.MEMBERS]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return db.MEMBERS
      .filter((m) => (org === "ALL" ? true : (m.organisation || "").trim() === org))
      .filter((m) => {
        if (!query) return true;
        const hay = `${m.name} ${m.phone || ""} ${m.organisation || ""} ${m.email || ""}`.toLowerCase();
        return hay.includes(query);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [db.MEMBERS, q, org]);

  const analytics = useMemo(() => {
    // Mock analytics based on planners for now, in a real app this would be more complex
    return db.MEMBERS.map(m => {
      const assignments = db.PLANNERS.flatMap(p => p.weeks.flatMap(w => [
        ...w.speakers.filter(s => s.name === m.name),
        ...(w.prayers.invocation === m.name ? [{name: m.name, role: "Invocation"}] : []),
        ...(w.prayers.benediction === m.name ? [{name: m.name, role: "Benediction"}] : [])
      ]));
      
      const last = assignments.length > 0 ? assignments[0] : null; // Simple mock
      return {
        member_id: m.member_id,
        name: m.name,
        assignment_count_12m: assignments.length,
        last_assignment_date: "2024-03-10", // Mock
        unconfirmed_rate: assignments.length > 0 ? 0.15 : 0, // Mock
        avg_completion_time_days: 2.5 // Mock
      };
    });
  }, [db.MEMBERS, db.PLANNERS]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);

  function save(member: Member) {
    updateDB((db0) => {
      const exists = db0.MEMBERS.some((m) => m.member_id === member.member_id);
      const MEMBERS = exists
        ? db0.MEMBERS.map((m) => (m.member_id === member.member_id ? member : m))
        : [member, ...db0.MEMBERS];
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
              filtered.map((m) => (
                <tr key={m.member_id} className="border-t border-[color:var(--border)]">
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
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="stat-card p-5 animate-scale-in stagger-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Avg. Load</div>
              <div className="mt-2 text-3xl font-black text-slate-800">1.2</div>
              <div className="mt-1 text-xs font-semibold text-emerald-600">Stable vs last month</div>
            </div>
            <div className="stat-card p-5 animate-scale-in stagger-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Unconfirmed</div>
              <div className="mt-2 text-3xl font-black text-slate-800">8%</div>
              <div className="mt-1 text-xs font-semibold text-rose-500">Requires focus</div>
            </div>
            <div className="stat-card p-5 animate-scale-in stagger-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Checklist %</div>
              <div className="mt-2 text-3xl font-black text-slate-800">92%</div>
              <div className="mt-1 text-xs font-semibold text-emerald-600">On track</div>
            </div>
            <div className="stat-card p-5 animate-scale-in stagger-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Avg. Prep Time</div>
              <div className="mt-2 text-3xl font-black text-slate-800">3.5d</div>
              <div className="mt-1 text-xs font-semibold text-slate-400">Time to complete</div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm animate-fade-in-up stagger-4">
            <div className="bg-slate-50/50 px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800">Member Assignment Load (Last 12 Months)</h3>
            </div>
            <div className="p-0">
               <table className="w-full text-left text-sm">
                 <thead className="bg-slate-50/30">
                   <tr>
                     <th className="p-4 font-bold text-slate-600">Member Name</th>
                     <th className="p-4 font-bold text-slate-600">Total Assignments</th>
                     <th className="p-4 font-bold text-slate-600">Unconfirmed Rate</th>
                     <th className="p-4 font-bold text-slate-600">Status</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-50">
                   {analytics.slice(0, 10).map(m => (
                     <tr key={m.member_id} className="hover:bg-slate-50/30 transition">
                       <td className="p-4 font-semibold text-slate-800">{m.name}</td>
                       <td className="p-4">
                         <div className="flex items-center gap-2">
                           <div className="h-1.5 w-24 rounded-full bg-slate-100 overflow-hidden">
                             <div className="h-full bg-blue-500 transition-all duration-1000" style={{ width: `${Math.min(m.assignment_count_12m * 20, 100)}%` }} />
                           </div>
                           <span className="text-xs font-bold text-slate-600">{m.assignment_count_12m}</span>
                         </div>
                       </td>
                       <td className="p-4 text-xs font-medium text-slate-500">{Math.round(m.unconfirmed_rate * 100)}%</td>
                       <td className="p-4">
                         <Badge tone={m.assignment_count_12m > 3 ? "amber" : "green"}>
                           {m.assignment_count_12m > 3 ? "High Load" : "Ready"}
                         </Badge>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
            </div>
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
