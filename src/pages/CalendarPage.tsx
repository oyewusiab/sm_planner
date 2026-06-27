import { useState, useMemo } from "react";
import type { User, UnitSettings, CalendarActivity, OtherChurchProgram, PublicHoliday, CalendarContact, CalendarReportLog } from "../types";
import { Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Select, Badge } from "../components/ui";
import { Modal } from "../components/Modal";
import { getDB, updateDB, ids, syncNow } from "../utils/storage";
import { can } from "../utils/permissions";
import { cn } from "../utils/cn";

function formatTimePlain(t: string | undefined | null): string {
  if (!t) return "";
  const tStr = String(t).trim();
  if (tStr.includes("T")) {
    try {
      const datePart = new Date(tStr);
      if (!isNaN(datePart.getTime())) {
        let hours = datePart.getUTCHours();
        const minutes = String(datePart.getUTCMinutes()).padStart(2, "0");
        const ampm = hours >= 12 ? "PM" : "AM";
        hours = hours % 12;
        hours = hours ? hours : 12;
        return `${String(hours).padStart(2, "0")}:${minutes} ${ampm}`;
      }
    } catch {}
  }
  return tStr;
}

export function CalendarPage({
  user,
  unit,
  onChanged,
}: {
  user: User;
  unit: UnitSettings;
  onChanged: () => void;
}) {
  const allowed = can(user.role, "MANAGE_MEMBERS"); // Admin/Clerk/Bishopric permissions
  const db = getDB();

  const [tab, setTab] = useState<"dashboard" | "calendar" | "directory">("dashboard");
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth()); // 0-11

  // Search and filter states
  const [activitySearch, setActivitySearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");

  // Edit / Add States
  const [openActivityModal, setOpenActivityModal] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Partial<CalendarActivity> | null>(null);

  const [openContactModal, setOpenContactModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Partial<CalendarContact> | null>(null);

  const [selectedCellDate, setSelectedCellDate] = useState<string | null>(null);
  const [openCellDetailModal, setOpenCellDetailModal] = useState(false);

  // Load datasets
  const activities = useMemo<CalendarActivity[]>(() => db.ACTIVITIES || [], [db.ACTIVITIES]);
  const otherPrograms = useMemo<OtherChurchProgram[]>(() => db["OTHER CHURCH PROGRAM"] || [], [db["OTHER CHURCH PROGRAM"]]);
  const publicHolidays = useMemo<PublicHoliday[]>(() => db["PUBLIC HOLIDAY"] || [], [db["PUBLIC HOLIDAY"]]);
  const contacts = useMemo<CalendarContact[]>(() => db.CONTACTS || [], [db.CONTACTS]);
  const reportLogs = useMemo<CalendarReportLog[]>(() => db["REPORT LOG"] || [], [db["REPORT LOG"]]);

  const [syncing, setSyncing] = useState(false);
  const handleRefreshSync = async () => {
    setSyncing(true);
    try {
      await syncNow();
      onChanged();
    } catch (e) {
      console.error(e);
      alert("Failed to sync calendar. Please check connection.");
    } finally {
      setSyncing(false);
    }
  };

  // Helper date formatting
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  // Dashboard calculations
  const dashboardStats = useMemo(() => {
    const total = activities.length;
    const completed = activities.filter(a => a.status).length;
    const pending = activities.filter(a => !a.status).length;
    const notDone = activities.filter(a => !a.status && (a.date ? a.date.slice(0, 10) : "") < todayStr).length;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const reports = activities.filter(a => a.report_submitted === "YES").length;
    
    // Overdue is pending activities past their date
    const overdueReports = activities.filter(a => !a.status && (a.date ? a.date.slice(0, 10) : "") < todayStr).length;

    return { total, completed, pending, notDone, rate, reports, overdueReports };
  }, [activities, todayStr]);

  // Next 14 Days Activities
  const next14DaysActivities = useMemo(() => {
    const start = new Date(todayStr);
    const end = new Date(start);
    end.setDate(start.getDate() + 14);

    return activities
      .filter(a => {
        const d = new Date(a.date ? a.date.slice(0, 10) : "");
        return d >= start && d <= end;
      })
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }, [activities, todayStr]);

  // Filtered lists
  const filteredActivities = useMemo(() => {
    const query = activitySearch.trim().toLowerCase();
    if (!query) return activities;
    return activities.filter(a => 
      (a.activity || "").toLowerCase().includes(query) || 
      (a.organisation || "").toLowerCase().includes(query) ||
      (a.those_involved || "").toLowerCase().includes(query)
    );
  }, [activities, activitySearch]);

  // Upcoming Activities (Next 60 Days)
  const upcomingActivities60Days = useMemo(() => {
    const start = new Date(todayStr);
    const end = new Date(start);
    end.setDate(start.getDate() + 60);

    return filteredActivities
      .filter(a => {
        const d = new Date(a.date ? a.date.slice(0, 10) : "");
        return d >= start && d <= end;
      })
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }, [filteredActivities, todayStr]);

  // Month list
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // Calendar rendering grid calculations
  const calendarGrid = useMemo(() => {
    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay(); // Sunday=0, etc.
    const numDays = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    const cells: { dateStr: string | null; dayNum: number | null; events: { type: "WARD" | "HOLIDAY" | "PROGRAM"; name: string; org?: string; details?: string }[] }[] = [];

    // Padding cells at the beginning
    for (let i = 0; i < firstDayIndex; i++) {
      cells.push({ dateStr: null, dayNum: null, events: [] });
    }

    // Days of the month
    for (let day = 1; day <= numDays; day++) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      
      const dayEvents: any[] = [];
      activities.filter((a: CalendarActivity) => (a.date ? a.date.slice(0, 10) : "") === dateStr).forEach((a: CalendarActivity) => {
        dayEvents.push({ type: "WARD", name: a.activity, org: a.organisation, details: a.those_involved });
      });
      publicHolidays.filter((h: PublicHoliday) => (h.date ? h.date.slice(0, 10) : "") === dateStr).forEach((h: PublicHoliday) => {
        dayEvents.push({ type: "HOLIDAY", name: h.holiday, details: h.theme });
      });
      otherPrograms.filter((p: OtherChurchProgram) => (p.date ? p.date.slice(0, 10) : "") === dateStr).forEach((p: OtherChurchProgram) => {
        dayEvents.push({ type: "PROGRAM", name: p.program, org: p.organisation });
      });

      cells.push({ dateStr, dayNum: day, events: dayEvents });
    }

    return cells;
  }, [currentYear, currentMonth, activities, publicHolidays, otherPrograms]);

  // Overlap color calculations for grid cells
  const getCellColorClass = (events: any[]) => {
    if (events.length === 0) return "bg-white hover:bg-slate-50";
    const hasWard = events.some(e => e.type === "WARD");
    const hasHoliday = events.some(e => e.type === "HOLIDAY");
    const hasProgram = events.some(e => e.type === "PROGRAM");

    // All Three Overlapping (Red)
    if (hasWard && hasHoliday && hasProgram) return "bg-red-50 border-red-200 text-red-700 hover:bg-red-100/50";
    
    // Ward + Holiday (Orange)
    if (hasWard && hasHoliday) return "bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100/50";
    
    // Ward + Program (Brown/Bronze)
    if (hasWard && hasProgram) return "bg-amber-100/40 border-amber-200 text-amber-900 hover:bg-amber-100/60";

    // Public Holiday + Program
    if (hasHoliday && hasProgram) return "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100/50";

    // Single states
    if (hasWard) return "bg-emerald-50 border-emerald-150 text-emerald-800 hover:bg-emerald-100/50";
    if (hasHoliday) return "bg-yellow-50/60 border-yellow-200 text-yellow-900 hover:bg-yellow-100/40";
    if (hasProgram) return "bg-indigo-50/60 border-indigo-200 text-indigo-800 hover:bg-indigo-100/50";

    return "bg-white hover:bg-slate-50";
  };

  const selectedCellEvents = useMemo(() => {
    if (!selectedCellDate) return [];
    const cell = calendarGrid.find(c => c.dateStr === selectedCellDate);
    return cell ? cell.events : [];
  }, [selectedCellDate, calendarGrid]);

  // CRUD handlers
  const saveActivity = (activity: Partial<CalendarActivity>) => {
    if (!activity.activity || !activity.date) return;
    updateDB((db0) => {
      const list = [...(db0.ACTIVITIES || [])];
      if (activity.activity_id) {
        // Edit
        const idx = list.findIndex(a => a.activity_id === activity.activity_id);
        if (idx >= 0) list[idx] = activity as CalendarActivity;
      } else {
        // Add new
        activity.activity_id = ids.uid("act");
        list.push(activity as CalendarActivity);
      }
      return { ...db0, ACTIVITIES: list };
    });
    setOpenActivityModal(false);
    onChanged();
  };

  const deleteActivity = (id: string) => {
    const ok = window.confirm("Are you sure you want to delete this activity?");
    if (!ok) return;
    updateDB((db0) => {
      return { ...db0, ACTIVITIES: (db0.ACTIVITIES || []).filter(a => a.activity_id !== id) };
    });
    onChanged();
  };

  const saveContact = (contact: Partial<CalendarContact>) => {
    if (!contact.name || !contact.calling) return;
    updateDB((db0) => {
      const list = [...(db0.CONTACTS || [])];
      if (contact.contact_id) {
        const idx = list.findIndex(c => c.contact_id === contact.contact_id);
        if (idx >= 0) list[idx] = contact as CalendarContact;
      } else {
        contact.contact_id = ids.uid("con");
        list.push(contact as CalendarContact);
      }
      return { ...db0, CONTACTS: list };
    });
    setOpenContactModal(false);
    onChanged();
  };

  const deleteContact = (id: string) => {
    const ok = window.confirm("Are you sure you want to delete this contact?");
    if (!ok) return;
    updateDB((db0) => {
      return { ...db0, CONTACTS: (db0.CONTACTS || []).filter(c => c.contact_id !== id) };
    });
    onChanged();
  };



  const filteredContacts = useMemo(() => {
    const query = contactSearch.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter(c => 
      c.name.toLowerCase().includes(query) || 
      c.calling.toLowerCase().includes(query) || 
      c.organisation.toLowerCase().includes(query)
    );
  }, [contacts, contactSearch]);

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
            <span>🗓️</span> {unit.unit_name} Calendar & Activities
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Broad planner, dashboard coordination, overlapping legend checks, and organizational contacts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleRefreshSync} disabled={syncing} className="font-bold text-xs gap-1.5 flex items-center">
            {syncing ? "Syncing..." : "Refresh Backend"}
          </Button>
          {allowed && (
            <Button
              onClick={() => {
                setEditingActivity({ date: todayStr, status: false, email_sent: false, report_submitted: "NO", time: "TBD", organisation: "WARD" });
                setOpenActivityModal(true);
              }}
              className="font-bold text-xs"
            >
              + Add Event
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        <button
          onClick={() => setTab("dashboard")}
          className={cn("px-4 py-1.5 text-xs font-bold rounded-lg transition", tab === "dashboard" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}
        >
          Dashboard
        </button>
        <button
          onClick={() => setTab("calendar")}
          className={cn("px-4 py-1.5 text-xs font-bold rounded-lg transition", tab === "calendar" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}
        >
          Monthly Grid
        </button>
        <button
          onClick={() => setTab("directory")}
          className={cn("px-4 py-1.5 text-xs font-bold rounded-lg transition", tab === "directory" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}
        >
          Directory & Logs
        </button>
      </div>

      {/* Dashboard View */}
      {tab === "dashboard" && (
        <div className="space-y-6">
          {/* Stats summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="bg-white border-slate-100 shadow-sm">
              <CardBody className="p-5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Total Calendar Activities</div>
                <div className="mt-2 text-3xl font-black text-slate-800">{dashboardStats.total}</div>
                <div className="mt-1 text-[10px] text-slate-500 font-semibold">Planned for the year</div>
              </CardBody>
            </Card>

            <Card className="bg-white border-slate-100 shadow-sm">
              <CardBody className="p-5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Completed activities</div>
                <div className="mt-2 text-3xl font-black text-emerald-600">
                  {dashboardStats.completed}
                  <span className="text-xs text-slate-400 font-normal ml-1.5">({dashboardStats.rate}%)</span>
                </div>
                <div className="mt-1 text-[10px] text-slate-500 font-semibold">Checkboxes checked</div>
              </CardBody>
            </Card>

            <Card className="bg-white border-slate-100 shadow-sm">
              <CardBody className="p-5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">Pending Activities</div>
                <div className="mt-2 text-3xl font-black text-indigo-600">{dashboardStats.pending}</div>
                <div className="mt-1 text-[10px] text-slate-500 font-semibold">Remaining events</div>
              </CardBody>
            </Card>

            <Card className="bg-white border-slate-100 shadow-sm">
              <CardBody className="p-5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-rose-500">Overdue / Reports Needed</div>
                <div className="mt-2 text-3xl font-black text-rose-500">
                  {dashboardStats.overdueReports}
                </div>
                <div className="mt-1 text-[10px] text-slate-500 font-semibold">Past events not checked</div>
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Next 14 Days activities */}
            <Card className="lg:col-span-1 border-amber-100 bg-amber-50/10">
              <CardHeader className="border-b border-slate-100/50 pb-3">
                <CardTitle className="text-slate-800 flex items-center gap-2 text-sm">
                  <span>🔥</span> Next 14 Days Activities
                </CardTitle>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                  Critical upcoming ward schedule
                </p>
              </CardHeader>
              <CardBody className="p-0 grow flex flex-col">
                <div className="max-h-[450px] overflow-auto divide-y divide-slate-100">
                  {next14DaysActivities.length === 0 ? (
                    <div className="py-12 px-6 text-center text-slate-400 text-xs italic">
                      No activities scheduled in the next 14 days.
                    </div>
                  ) : (
                    next14DaysActivities.map((a) => (
                      <div key={a.activity_id} className="p-4 hover:bg-slate-50/50 transition-colors flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-800">{a.activity}</div>
                          <div className="text-[9px] text-slate-400 mt-1 font-bold">
                            📅 {a.date ? a.date.slice(0, 10) : ""} • 🕒 {formatTimePlain(a.time)}
                          </div>
                          {a.those_involved && (
                            <p className="text-[9px] text-slate-500 italic mt-1 truncate">
                              Involved: {a.those_involved}
                            </p>
                          )}
                        </div>
                        <Badge tone={a.organisation === "WARD" ? "blue" : "gray"} className="text-[7px] font-extrabold uppercase shrink-0">
                          {a.organisation}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </CardBody>
            </Card>

            {/* Upcoming Activities (60 Days) */}
            <Card className="lg:col-span-2 bg-white border-slate-100 shadow-sm">
              <CardHeader className="border-b border-slate-50 pb-3">
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="text-slate-800 text-sm">Upcoming Activities (Next 60 Days)</CardTitle>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                      Activities forecast with countdown timers
                    </p>
                  </div>
                  <Input
                    value={activitySearch}
                    onChange={(e) => setActivitySearch(e.target.value)}
                    placeholder="Search activities..."
                    className="w-48 text-xs h-8"
                  />
                </div>
              </CardHeader>
              <CardBody className="p-0">
                <div className="max-h-[450px] overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50/50 sticky top-0 z-10 border-b border-slate-100">
                      <tr>
                        <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Date</th>
                        <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Activity</th>
                        <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Organisation</th>
                        <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center">Countdown</th>
                        <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {upcomingActivities60Days.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-400 text-xs italic">
                            No activities in the next 60 days.
                          </td>
                        </tr>
                      ) : (
                        upcomingActivities60Days.map((a) => {
                            const diffDays = Math.ceil((new Date(a.date).getTime() - new Date(todayStr).getTime()) / (1000 * 60 * 60 * 24));
                            const countdownLabel = diffDays === 0 ? "TODAY" : diffDays === 1 ? "1 DAY LEFT" : `${diffDays} DAYS LEFT`;
                            const countdownTone = diffDays <= 3 ? "rose" : diffDays <= 10 ? "amber" : "blue";

                            return (
                              <tr key={a.activity_id} className="hover:bg-slate-50/30 transition-colors">
                                <td className="p-3 text-xs font-semibold text-slate-600">{a.date ? a.date.slice(0, 10) : ""}</td>
                                <td className="p-3 text-xs font-black text-slate-800">
                                  {a.activity}
                                  {a.time && <span className="text-[10px] font-normal text-slate-400 ml-2">({formatTimePlain(a.time)})</span>}
                                </td>
                                <td className="p-3 text-xs">
                                  <Badge tone={a.organisation === "WARD" ? "blue" : "gray"} className="text-[8px] font-extrabold">
                                    {a.organisation}
                                  </Badge>
                                </td>
                                <td className="p-3 text-center">
                                  <Badge tone={countdownTone} className="text-[8px] font-extrabold tracking-wide uppercase px-2 py-0.5">
                                    {countdownLabel}
                                  </Badge>
                                </td>
                                <td className="p-3 text-right">
                                  <div className="flex gap-1.5 justify-end">
                                    <button
                                      onClick={() => {
                                        setEditingActivity(a);
                                        setOpenActivityModal(true);
                                      }}
                                      className="text-[10px] font-bold text-blue-600 hover:underline"
                                    >
                                      Edit
                                    </button>
                                    {allowed && (
                                      <button
                                        onClick={() => deleteActivity(a.activity_id)}
                                        className="text-[10px] font-bold text-rose-500 hover:underline"
                                      >
                                        Delete
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                      )}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {/* Grid Calendar View */}
      {tab === "calendar" && (
        <div className="space-y-6">
          <Card className="bg-white border-slate-100 shadow-sm p-6">
            {/* Calendar Controls */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (currentMonth === 0) {
                      setCurrentMonth(11);
                      setCurrentYear(y => y - 1);
                    } else {
                      setCurrentMonth(m => m - 1);
                    }
                  }}
                  className="font-black h-9 w-9 px-0 flex items-center justify-center text-sm"
                >
                  ◀
                </Button>
                
                {/* Month Dropdown Selector */}
                <Select
                  value={currentMonth}
                  onChange={(e) => setCurrentMonth(Number(e.target.value))}
                  className="h-9 font-bold text-xs w-36 border-slate-200"
                >
                  {MONTHS.map((m, idx) => (
                    <option key={m} value={idx}>{m}</option>
                  ))}
                </Select>

                {/* Year Dropdown Selector */}
                <Select
                  value={currentYear}
                  onChange={(e) => setCurrentYear(Number(e.target.value))}
                  className="h-9 font-bold text-xs w-24 border-slate-200"
                >
                  {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </Select>

                <Button
                  variant="outline"
                  onClick={() => {
                    if (currentMonth === 11) {
                      setCurrentMonth(0);
                      setCurrentYear(y => y + 1);
                    } else {
                      setCurrentMonth(m => m + 1);
                    }
                  }}
                  className="font-black h-9 w-9 px-0 flex items-center justify-center text-sm"
                >
                  ▶
                </Button>
              </div>

              {/* Legend Summary */}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[9px] font-extrabold text-slate-500 uppercase tracking-wide">
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-100 border border-emerald-300" /> Ward Activity</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-yellow-100 border border-yellow-300" /> Public Holiday</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-indigo-100 border border-indigo-300" /> Other Program</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-orange-100 border border-orange-300" /> Overlap: Activity + Holiday</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-amber-100 border border-amber-300" /> Overlap: Activity + Program</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-red-100 border border-red-300" /> Overlap: All Three</span>
              </div>
            </div>

            {/* Calendar Headers */}
            <div className="calendar-grid bg-slate-50 rounded-t-xl border-t border-x border-slate-200">
              {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map(day => (
                <div key={day} className="p-3 text-center text-xs font-black text-slate-500 tracking-wider">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Cells Grid */}
            <div className="calendar-grid bg-slate-200 border-b border-x border-slate-200 rounded-b-xl overflow-hidden">
              {calendarGrid.map((cell, idx) => {
                const isToday = cell.dateStr && cell.dateStr.slice(0, 10) === todayStr;
                const cellBg = getCellColorClass(cell.events);
                return (
                  <div
                    key={idx}
                    onClick={() => {
                      if (cell.dateStr) {
                        setSelectedCellDate(cell.dateStr);
                        setOpenCellDetailModal(true);
                      }
                    }}
                    className={cn(
                      "min-h-[120px] p-2 bg-white transition-all flex flex-col justify-between cursor-pointer relative border border-slate-100 hover:shadow-md hover:scale-[1.01] hover:z-10 group",
                      cellBg,
                      !cell.dayNum && "bg-slate-50/50 opacity-40 pointer-events-none",
                      isToday && "ring-2 ring-blue-500 ring-inset"
                    )}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className={cn(
                        "text-xs font-extrabold px-1.5 py-0.5 rounded-full",
                        isToday ? "bg-blue-600 text-white" : "text-slate-500"
                      )}>
                        {cell.dayNum || ""}
                      </span>
                      {isToday && (
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-ping absolute top-2 right-2" />
                      )}
                    </div>

                    {/* Event Capsules List */}
                    <div className="grow space-y-1 mt-1 overflow-hidden flex flex-col justify-start">
                      {cell.events.slice(0, 3).map((e, eIdx) => {
                        const capsuleClass =
                          e.type === "WARD"
                            ? "bg-emerald-50 text-emerald-800 border-emerald-100 hover:bg-emerald-100/50"
                            : e.type === "HOLIDAY"
                            ? "bg-amber-50 text-amber-900 border-amber-100 hover:bg-amber-100/50"
                            : "bg-indigo-50 text-indigo-800 border-indigo-100 hover:bg-indigo-100/50";

                        return (
                          <div 
                            key={eIdx} 
                            className={cn(
                              "text-[9px] font-black px-1.5 py-0.5 rounded-md border truncate leading-tight transition-all",
                              capsuleClass
                            )}
                            title={`${e.name} ${e.org ? `(${e.org})` : ""}`}
                          >
                            <span className="font-extrabold mr-1">{e.org ? `[${e.org.slice(0, 3).toUpperCase()}]` : ""}</span>
                            {e.name}
                          </div>
                        );
                      })}
                      {cell.events.length > 3 && (
                        <div className="text-[8px] font-extrabold text-slate-400 bg-slate-50 border border-slate-100 hover:bg-slate-100 text-center py-0.5 rounded-md transition-colors">
                          +{cell.events.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* Directory & Logs View */}
      {tab === "directory" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Contacts directory */}
          <Card className="lg:col-span-2 bg-white border-slate-100 shadow-sm">
            <CardHeader className="border-b border-slate-50 pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm">Ward Organization Contacts</CardTitle>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                  Reference directory for calendar submission & approvals
                </p>
              </div>
              <div className="flex gap-2">
                <Input
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search contacts..."
                  className="w-44 text-xs h-8"
                />
                {allowed && (
                  <Button
                    onClick={() => {
                      setEditingContact({ name: "", calling: "", organisation: "WARD", email: "", upcoming: "", report: "" });
                      setOpenContactModal(true);
                    }}
                    className="font-bold text-[10px] h-8 px-3"
                  >
                    + Add
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <div className="max-h-[500px] overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50/50 sticky top-0 z-10 border-b border-slate-100">
                    <tr>
                      <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Contact</th>
                      <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Calling</th>
                      <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Upcoming Guidelines</th>
                      <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Reporting</th>
                      <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredContacts.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400 text-xs italic">
                          No contact listings found.
                        </td>
                      </tr>
                    ) : (
                      filteredContacts.map((c) => (
                        <tr key={c.contact_id} className="hover:bg-slate-50/30 transition-colors">
                          <td className="p-3">
                            <div className="font-black text-slate-800 text-xs">{c.name}</div>
                            <div className="text-[10px] text-slate-400 font-bold">{c.email}</div>
                          </td>
                          <td className="p-3">
                            <div className="font-semibold text-slate-700 text-xs">{c.calling}</div>
                            <div className="text-[9px] mt-0.5 uppercase font-bold text-slate-400">{c.organisation}</div>
                          </td>
                          <td className="p-3 text-xs text-slate-500 font-medium max-w-[200px] truncate" title={c.upcoming}>
                            {c.upcoming || "—"}
                          </td>
                          <td className="p-3 text-xs text-slate-500 font-medium max-w-[150px] truncate" title={c.report}>
                            {c.report || "—"}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => {
                                  setEditingContact(c);
                                  setOpenContactModal(true);
                                }}
                                className="text-[10px] font-bold text-blue-600 hover:underline"
                              >
                                Edit
                              </button>
                              {allowed && (
                                <button
                                  onClick={() => deleteContact(c.contact_id)}
                                  className="text-[10px] font-bold text-rose-500 hover:underline"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          {/* Logs */}
          <Card className="lg:col-span-1 bg-white border-slate-100 shadow-sm">
            <CardHeader className="border-b border-slate-50 pb-3">
              <CardTitle className="text-sm">Calendar Report Log</CardTitle>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                Audit trail of system runs & notifications
              </p>
            </CardHeader>
            <CardBody className="p-0">
              <div className="max-h-[500px] overflow-auto divide-y divide-slate-100">
                {reportLogs.length === 0 ? (
                  <div className="py-12 px-6 text-center text-slate-400 text-xs italic">
                    No run logs recorded yet.
                  </div>
                ) : (
                  reportLogs.slice(0, 30).map((l, idx) => (
                    <div key={l.log_id || idx} className="p-4 hover:bg-slate-50/50 transition-colors">
                      <div className="flex justify-between items-start gap-1">
                        <div className="min-w-0">
                          <div className="text-[10px] font-black text-slate-800 truncate">{l.recipient}</div>
                          <div className="text-[9px] text-slate-500 font-bold mt-1">
                            {l.type}
                          </div>
                        </div>
                        <Badge tone={l.status === "SUCCESS" ? "green" : "rose"} className="text-[7px] font-extrabold shrink-0 px-1.5 py-0.5">
                          {l.status}
                        </Badge>
                      </div>
                      <div className="text-[8px] text-slate-400 font-bold mt-2 text-right">
                        🕒 {l.timestamp}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Activity Details / Add / Edit Modal */}
      <Modal
        open={openActivityModal}
        title={editingActivity?.activity_id ? "Edit Calendar Activity" : "Add Calendar Activity"}
        onClose={() => setOpenActivityModal(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpenActivityModal(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (editingActivity) saveActivity(editingActivity);
              }}
            >
              Save Activity
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Date</Label>
            <Input
              type="date"
              value={editingActivity?.date || ""}
              onChange={(e) => setEditingActivity(a => ({ ...a, date: e.target.value }))}
            />
          </div>

          <div className="space-y-1">
            <Label>Activity/Program Name</Label>
            <Input
              value={editingActivity?.activity || ""}
              onChange={(e) => setEditingActivity(a => ({ ...a, activity: e.target.value }))}
              placeholder="e.g. Relief Society Enrichment Activity"
            />
          </div>

          <div className="space-y-1">
            <Label>Organisation</Label>
            <Select
              value={editingActivity?.organisation || "WARD"}
              onChange={(e) => setEditingActivity(a => ({ ...a, organisation: e.target.value }))}
            >
              <option value="WARD">WARD</option>
              <option value="RELIEF SOCIETY">RELIEF SOCIETY</option>
              <option value="ELDERS QUORUM">ELDERS QUORUM</option>
              <option value="SUNDAY SCHOOL">SUNDAY SCHOOL</option>
              <option value="PRIMARY">PRIMARY</option>
              <option value="YOUTH">YOUTH</option>
              <option value="YSA">YSA</option>
              <option value="YOUNG MEN">YOUNG MEN</option>
              <option value="YOUNG WOMEN">YOUNG WOMEN</option>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Time</Label>
            <Input
              value={editingActivity?.time || "TBD"}
              onChange={(e) => setEditingActivity(a => ({ ...a, time: e.target.value }))}
              placeholder="e.g. 12:00 PM or TBD"
            />
          </div>

          <div className="space-y-1">
            <Label>Those Involved</Label>
            <Input
              value={editingActivity?.those_involved || ""}
              onChange={(e) => setEditingActivity(a => ({ ...a, those_involved: e.target.value }))}
              placeholder="e.g. All Sisters ages 18 and above"
            />
          </div>

          <div className="space-y-1">
            <Label>Report Submitted?</Label>
            <Select
              value={editingActivity?.report_submitted || "NO"}
              onChange={(e) => setEditingActivity(a => ({ ...a, report_submitted: e.target.value as any }))}
            >
              <option value="YES">YES</option>
              <option value="NO">NO</option>
              <option value="N/A">N/A</option>
            </Select>
          </div>

          <div className="flex gap-6 mt-4">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={editingActivity?.status || false}
                onChange={(e) => setEditingActivity(a => ({ ...a, status: e.target.checked }))}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Activity Completed (Status Checked)
            </label>

            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={editingActivity?.email_sent || false}
                onChange={(e) => setEditingActivity(a => ({ ...a, email_sent: e.target.checked }))}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Notification Email Sent?
            </label>
          </div>
        </div>
      </Modal>

      {/* Cell details modal / grid selector */}
      <Modal
        open={openCellDetailModal}
        title={selectedCellDate ? `Schedule for ${selectedCellDate}` : "Schedule Details"}
        onClose={() => setOpenCellDetailModal(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpenCellDetailModal(false)}>Close</Button>
            {allowed && (
              <Button
                onClick={() => {
                  setOpenCellDetailModal(false);
                  setEditingActivity({ date: selectedCellDate || todayStr, status: false, email_sent: false, report_submitted: "NO", time: "TBD", organisation: "WARD" });
                  setOpenActivityModal(true);
                }}
              >
                + Add Activity
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          {selectedCellEvents.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-6 text-center">No activities or holidays on this date.</p>
          ) : (
            <div className="space-y-3">
              {selectedCellEvents.map((e, idx) => {
                const badgeTone =
                  e.type === "WARD" ? "green" :
                  e.type === "HOLIDAY" ? "amber" : "blue";

                return (
                  <div key={idx} className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-black text-slate-800">{e.name}</h4>
                      {e.details && (
                        <p className="text-[10px] text-slate-500 font-semibold mt-1">
                          {e.type === "HOLIDAY" ? "Theme" : "Involved"}: {e.details}
                        </p>
                      )}
                      {e.org && (
                        <p className="text-[9px] text-slate-400 font-bold mt-1">
                          Organisation: {e.org}
                        </p>
                      )}
                    </div>
                    <Badge tone={badgeTone} className="text-[8px] font-extrabold uppercase shrink-0">
                      {e.type}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      {/* Contact details Modal */}
      <Modal
        open={openContactModal}
        title={editingContact?.contact_id ? "Edit Organization Contact" : "Add Organization Contact"}
        onClose={() => setOpenContactModal(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpenContactModal(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (editingContact) saveContact(editingContact);
              }}
            >
              Save Contact
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input
              value={editingContact?.name || ""}
              onChange={(e) => setEditingContact(c => ({ ...c, name: e.target.value }))}
              placeholder="e.g. Sister Akpan Oluwatoyin Jokotola"
            />
          </div>

          <div className="space-y-1">
            <Label>Calling</Label>
            <Input
              value={editingContact?.calling || ""}
              onChange={(e) => setEditingContact(c => ({ ...c, calling: e.target.value }))}
              placeholder="e.g. Relief Society President"
            />
          </div>

          <div className="space-y-1">
            <Label>Organisation</Label>
            <Select
              value={editingContact?.organisation || "WARD"}
              onChange={(e) => setEditingContact(c => ({ ...c, organisation: e.target.value }))}
            >
              <option value="WARD">WARD</option>
              <option value="RELIEF SOCIETY">RELIEF SOCIETY</option>
              <option value="ELDERS QUORUM">ELDERS QUORUM</option>
              <option value="SUNDAY SCHOOL">SUNDAY SCHOOL</option>
              <option value="PRIMARY">PRIMARY</option>
              <option value="YOUTH">YOUTH</option>
              <option value="YSA">YSA</option>
              <option value="YOUNG MEN">YOUNG MEN</option>
              <option value="YOUNG WOMEN">YOUNG WOMEN</option>
              <option value="BISHOPRIC">BISHOPRIC</option>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Email</Label>
            <Input
              value={editingContact?.email || ""}
              onChange={(e) => setEditingContact(c => ({ ...c, email: e.target.value }))}
              placeholder="e.g. contact@email.com"
            />
          </div>

          <div className="space-y-1">
            <Label>Upcoming Activities Guidelines</Label>
            <Input
              value={editingContact?.upcoming || ""}
              onChange={(e) => setEditingContact(c => ({ ...c, upcoming: e.target.value }))}
              placeholder="e.g. Ward; Relief Society"
            />
          </div>

          <div className="space-y-1">
            <Label>Report Requirements</Label>
            <Input
              value={editingContact?.report || ""}
              onChange={(e) => setEditingContact(c => ({ ...c, report: e.target.value }))}
              placeholder="e.g. Relief Society"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
