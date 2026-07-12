import { useState, useMemo } from "react";
import type { CalendarActivity, UnitSettings, User } from "../types";
import { Button, Card, CardBody, CardHeader, CardTitle, Divider, Input, Label, Select } from "../components/ui";
import { ids, updateDB, useTable } from "../utils/storage";
import { formatDateShort } from "../utils/date";


const ORGANISATIONS = [
  "ALL",
  "WARD",
  "ELDERS QUORUM",
  "RELIEF SOCIETY",
  "PRIMARY",
  "SUNDAY SCHOOL",
  "YOUNG MEN",
  "YOUNG WOMEN",
  "YOUTH",
  "YSA"
];

export function CalendarPage({
  user,
  unit,
  onChanged,
}: {
  user: User;
  unit: UnitSettings;
  onChanged: () => void;
}) {
  void unit;
  const { data: activities = [] } = useTable("ACTIVITIES") as { data: CalendarActivity[] };

  const [query, setQuery] = useState("");
  const [org, setOrg] = useState("ALL");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<CalendarActivity> | null>(null);

  const canEditOrDelete = user.role === "ADMIN" || user.role === "CLERK";

  // Filtered and sorted activities
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activities
      .filter((a) => (org === "ALL" ? true : a.organisation === org))
      .filter((a) => {
        if (!q) return true;
        return (
          a.activity.toLowerCase().includes(q) ||
          a.organisation.toLowerCase().includes(q) ||
          a.date.includes(q)
        );
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [activities, query, org]);



  // Delete handler
  const handleDelete = (item: CalendarActivity) => {
    if (!window.confirm(`Are you sure you want to delete "${item.activity}"?`)) return;

    updateDB((db0) => {
      const list = (db0.ACTIVITIES || []).filter(a => a.activity_id !== item.activity_id);
      return { ...db0, ACTIVITIES: list };
    });

    onChanged();
  };

  // Save handler (Create / Edit)
  const handleSave = () => {
    if (!editing?.date || !editing?.activity || !editing?.organisation) {
      alert("Please fill in Date, Activity Name, and Organisation.");
      return;
    }

    const isNew = !editing.activity_id;
    const targetId = editing.activity_id || ids.uid("act");

    const nextActivity: CalendarActivity = {
      activity_id: targetId,
      date: editing.date,
      activity: editing.activity.trim(),
      organisation: editing.organisation,
      status: editing.status ?? false,
      email_sent: editing.email_sent ?? false,
      those_involved: editing.those_involved || "",
      report_submitted: editing.report_submitted || "N/A",
      time: editing.time || "12:00 PM",
      last_reminder: editing.last_reminder
    };

    updateDB((db0) => {
      const list = [...(db0.ACTIVITIES || [])];
      if (isNew) {
        list.push(nextActivity);
      } else {
        const idx = list.findIndex(a => a.activity_id === targetId);
        if (idx !== -1) list[idx] = nextActivity;
      }
      return { ...db0, ACTIVITIES: list };
    });

    setOpen(false);
    setEditing(null);
    onChanged();
  };

  return (
    <div className="space-y-6 w-full">
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Ward Calendar</h2>
          <p className="text-sm text-slate-500 mt-1">Manage, search, and pre-populate your unit calendar of activities and programs.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEditOrDelete && (
            <Button
              onClick={() => {
                setEditing({
                  date: new Date().toISOString().split("T")[0],
                  activity: "",
                  organisation: "WARD",
                  status: false,
                  email_sent: false,
                  those_involved: "",
                  report_submitted: "N/A",
                  time: "12:00 PM"
                });
                setOpen(true);
              }}
            >
              Add Activity
            </Button>
          )}
        </div>
      </div>

      {/* Filter Options */}
      <Card>
        <CardBody>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1 md:col-span-2">
              <Label>Search</Label>
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by activity, date (YYYY-MM-DD), organisation..." />
            </div>
            <div className="space-y-1">
              <Label>Organisation</Label>
              <Select value={org} onChange={(e) => setOrg(e.target.value)}>
                {ORGANISATIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Activities Table */}
      <div className="overflow-x-auto max-w-full rounded-xl border border-[color:var(--border)] bg-white" style={{ maxWidth: "100%" }}>
        <table className="w-full text-left text-sm" style={{ minWidth: "800px" }}>
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3 font-medium text-slate-600 w-32">Date</th>
              <th className="p-3 font-medium text-slate-600">Activity / Program</th>
              <th className="p-3 font-medium text-slate-600 w-48">Organisation</th>
              <th className="p-3 font-medium text-slate-600 w-32">Time</th>
              {canEditOrDelete && <th className="p-3 font-medium text-slate-600 w-36">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-500 text-center" colSpan={canEditOrDelete ? 5 : 4}>
                  No activities found.
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr key={item.activity_id} className="border-t border-[color:var(--border)] hover:bg-slate-50/50">
                  <td className="p-3 font-medium text-slate-700">{formatDateShort(item.date)}</td>
                  <td className="p-3 text-slate-900 font-semibold">{item.activity}</td>
                  <td className="p-3">
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800">
                      {item.organisation}
                    </span>
                  </td>
                  <td className="p-3 text-slate-500">{item.time || "12:00 PM"}</td>
                  {canEditOrDelete && (
                    <td className="p-3 whitespace-nowrap">
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setEditing(JSON.parse(JSON.stringify(item)) as CalendarActivity);
                            setOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDelete(item)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Modal */}
      {open && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
          <Card className="w-full max-w-md bg-white shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <CardHeader className="border-b pb-3">
              <CardTitle>{editing.activity_id ? "Edit Activity" : "Add Activity"}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4 pt-4">
              <div className="space-y-1">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={editing.date || ""}
                  onChange={e => setEditing(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Activity Details</Label>
                <Input
                  value={editing.activity || ""}
                  onChange={e => setEditing(prev => ({ ...prev, activity: e.target.value }))}
                  placeholder="e.g. Relief Society Enrichment"
                />
              </div>
              <div className="space-y-1">
                <Label>Organisation</Label>
                <Select
                  value={editing.organisation || "WARD"}
                  onChange={e => setEditing(prev => ({ ...prev, organisation: e.target.value }))}
                >
                  {ORGANISATIONS.filter(o => o !== "ALL").map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Time (Optional)</Label>
                <Input
                  value={editing.time || ""}
                  onChange={e => setEditing(prev => ({ ...prev, time: e.target.value }))}
                  placeholder="e.g. 6:00 PM"
                />
              </div>
              <Divider className="my-2" />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => { setOpen(false); setEditing(null); }}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleSave}>
                  Save
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
