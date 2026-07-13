import { useState, useMemo } from "react";
import type { CalendarActivity, UnitSettings, User } from "../types";
import { Button, Card, CardBody, CardHeader, CardTitle, Divider, Input, Label, Select } from "../components/ui";
import { ids, updateDB, useTable, cleanDateToYYYYMMDD } from "../utils/storage";
import { formatDateShort, formatTime12h } from "../utils/date";
import { generatePDF } from "../utils/pdf";
import { extractTextFromPDF } from "../utils/pdfParser";
import { Modal } from "../components/Modal";


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

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [parsedActivities, setParsedActivities] = useState<CalendarActivity[]>([]);
  const [importMode, setImportMode] = useState<"merge" | "overwrite">("merge");
  const [isImporting, setIsImporting] = useState(false);

  const handlePDFImportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsImporting(true);
      const text = await extractTextFromPDF(file);
      const parsed = parseActivitiesFromPDFText(text);
      if (parsed.length === 0) {
        alert("No valid activities could be parsed from the PDF. Please check the PDF layout.");
      } else {
        setParsedActivities(parsed as CalendarActivity[]);
        setIsImportModalOpen(true);
      }
    } catch (err: any) {
      alert(`Failed to parse PDF: ${err.message || String(err)}`);
    } finally {
      setIsImporting(false);
      e.target.value = "";
    }
  };

  const handleSaveImported = () => {
    updateDB((db0) => {
      const existing = db0.ACTIVITIES || [];
      const newItems = parsedActivities.map(item => ({
        ...item,
        activity_id: item.activity_id || ids.uid("act"),
        status: item.status ?? false,
        email_sent: item.email_sent ?? false,
        those_involved: item.those_involved || "",
        report_submitted: item.report_submitted || "N/A"
      }));

      let nextList: CalendarActivity[] = [];
      if (importMode === "overwrite") {
        nextList = newItems;
      } else {
        nextList = [...existing];
        newItems.forEach(newItem => {
          const isDuplicate = existing.some(ext => 
            ext.date === newItem.date && 
            ext.activity.toLowerCase() === newItem.activity.toLowerCase() &&
            ext.organisation === newItem.organisation
          );
          if (!isDuplicate) {
            nextList.push(newItem);
          }
        });
      }

      return { ...db0, ACTIVITIES: nextList };
    });

    setIsImportModalOpen(false);
    setParsedActivities([]);
    onChanged();
  };

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
      date: cleanDateToYYYYMMDD(editing.date),
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
            <>
              {selectedIds.length > 0 && (
                <Button
                  variant="danger"
                  onClick={() => {
                    if (!window.confirm(`Are you sure you want to delete the ${selectedIds.length} selected activities?`)) return;
                    updateDB((db0) => {
                      const list = (db0.ACTIVITIES || []).filter(a => !selectedIds.includes(a.activity_id));
                      return { ...db0, ACTIVITIES: list };
                    });
                    setSelectedIds([]);
                    onChanged();
                  }}
                >
                  Delete Selected ({selectedIds.length})
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => {
                  generatePDF("calendar-table-print", `Ward_Calendar_${new Date().toISOString().split("T")[0]}`);
                }}
              >
                Export PDF
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  document.getElementById("pdf-import-input")?.click();
                }}
                disabled={isImporting}
              >
                {isImporting ? "Importing..." : "Import PDF"}
              </Button>
              <input
                id="pdf-import-input"
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handlePDFImportChange}
              />
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
            </>
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
      <div id="calendar-table-print" className="overflow-x-auto max-w-full rounded-xl border border-[color:var(--border)] bg-white" style={{ maxWidth: "100%" }}>
        <table className="w-full text-left text-sm" style={{ minWidth: "800px" }}>
          <thead className="bg-slate-50">
            <tr>
              {canEditOrDelete && (
                <th className="p-3 w-10 no-print">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    checked={filtered.length > 0 && filtered.every(item => selectedIds.includes(item.activity_id))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(prev => {
                          const next = [...prev];
                          filtered.forEach(item => {
                            if (!next.includes(item.activity_id)) next.push(item.activity_id);
                          });
                          return next;
                        });
                      } else {
                        setSelectedIds(prev => prev.filter(id => !filtered.some(item => item.activity_id === id)));
                      }
                    }}
                  />
                </th>
              )}
              <th className="p-3 font-medium text-slate-600 w-32">Date</th>
              <th className="p-3 font-medium text-slate-600">Activity / Program</th>
              <th className="p-3 font-medium text-slate-600 w-48">Organisation</th>
              <th className="p-3 font-medium text-slate-600 w-32">Time</th>
              {canEditOrDelete && <th className="p-3 font-medium text-slate-600 w-36 no-print">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-500 text-center" colSpan={(canEditOrDelete ? 5 : 4) + (canEditOrDelete ? 1 : 0)}>
                  No activities found.
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr key={item.activity_id} className="border-t border-[color:var(--border)] hover:bg-slate-50/50">
                  {canEditOrDelete && (
                    <td className="p-3 no-print">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        checked={selectedIds.includes(item.activity_id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds(prev => [...prev, item.activity_id]);
                          } else {
                            setSelectedIds(prev => prev.filter(id => id !== item.activity_id));
                          }
                        }}
                      />
                    </td>
                  )}
                  <td className="p-3 font-medium text-slate-700">{formatDateShort(item.date)}</td>
                  <td className="p-3 text-slate-900 font-semibold">{item.activity}</td>
                  <td className="p-3">
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800">
                      {item.organisation}
                    </span>
                  </td>
                  <td className="p-3 text-slate-500">{formatTime12h(item.time)}</td>
                  {canEditOrDelete && (
                    <td className="p-3 whitespace-nowrap no-print">
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

      {/* PDF Import Preview Modal */}
      <Modal
        open={isImportModalOpen}
        title="Preview Parsed Activities"
        onClose={() => {
          setIsImportModalOpen(false);
          setParsedActivities([]);
        }}
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setIsImportModalOpen(false); setParsedActivities([]); }}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveImported}>
              Import {parsedActivities.length} Items
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="text-sm text-slate-600">
            We found the following {parsedActivities.length} activities in the PDF. Choose whether you want to merge them into your existing list or replace all existing activities.
          </div>
          
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-slate-700">Import Mode:</label>
            <Select value={importMode} onChange={(e) => setImportMode(e.target.value as any)}>
              <option value="merge">Add to Existing List</option>
              <option value="overwrite">Overwrite/Replace Existing List</option>
            </Select>
          </div>

          <div className="max-h-60 overflow-y-auto border rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 sticky top-0 border-b">
                <tr>
                  <th className="p-2 font-medium text-slate-600">Date</th>
                  <th className="p-2 font-medium text-slate-600">Activity</th>
                  <th className="p-2 font-medium text-slate-600">Org</th>
                  <th className="p-2 font-medium text-slate-600">Time</th>
                </tr>
              </thead>
              <tbody>
                {parsedActivities.map((act, idx) => (
                  <tr key={idx} className="border-b last:border-0 hover:bg-slate-50/50">
                    <td className="p-2 whitespace-nowrap">{formatDateShort(act.date)}</td>
                    <td className="p-2 font-semibold text-slate-700">{act.activity}</td>
                    <td className="p-2">{act.organisation}</td>
                    <td className="p-2">{act.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
}

const parseActivitiesFromPDFText = (text: string): Partial<CalendarActivity>[] => {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const parsed: Partial<CalendarActivity>[] = [];
  
  const dateRegex = /^(\d{1,2})[-/](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[-/](\d{4})$/i;
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const timeRegex = /^(?:1[0-2]|0?[1-9]):[0-5]\d\s*(?:AM|PM)?$/i;
  const rawTimeRegex = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;
  
  let current: Partial<CalendarActivity> | null = null;
  
  const monthMap: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
  };

  lines.forEach(line => {
    let dateStr = "";
    if (isoDateRegex.test(line)) {
      dateStr = line;
    } else {
      const match = line.match(dateRegex);
      if (match) {
        const [_, d, m, y] = match;
        const day = d.padStart(2, "0");
        const month = monthMap[m.toLowerCase()];
        dateStr = `${y}-${month}-${day}`;
      }
    }

    if (dateStr) {
      if (current) parsed.push(current);
      current = {
        date: dateStr,
        activity: "",
        organisation: "WARD",
        time: "12:00 PM",
        status: false,
        email_sent: false,
        those_involved: "",
        report_submitted: "N/A"
      };
      return;
    }

    if (!current) return;

    if (timeRegex.test(line) || rawTimeRegex.test(line)) {
      current.time = line;
      return;
    }

    const upperLine = line.toUpperCase();
    if (ORGANISATIONS.includes(upperLine) && upperLine !== "ALL") {
      current.organisation = upperLine;
      return;
    }

    if (
      line !== "Edit" && line !== "Delete" && line !== "Actions" && 
      line !== "Activity / Program" && line !== "Date" && 
      line !== "Organisation" && line !== "Time" && 
      !line.includes("📅") && !line.includes("Export PDF") && 
      !line.includes("Import PDF") && !line.includes("Add Activity")
    ) {
      current.activity = current.activity ? `${current.activity} ${line}` : line;
    }
  });

  if (current) parsed.push(current);
  return parsed.filter(a => a.activity);
};
