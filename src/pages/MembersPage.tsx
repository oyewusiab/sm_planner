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
