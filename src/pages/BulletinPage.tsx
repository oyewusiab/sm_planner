import { useState, useEffect, useMemo } from "react";
import type { Bulletin, BulletinActivity, Member, Planner, UnitSettings, User, CalendarActivity, OtherChurchProgram } from "../types";
import { Button, Card, CardBody, CardHeader, CardTitle, Divider, EmptyState, Input, Label, Select, Textarea } from "../components/ui";
import { ids, updateDB, useTable } from "../utils/storage";
import { formatDateShort, yyyyMmToLabel, formatTime12h } from "../utils/date";
import { generatePDF } from "../utils/pdf";
import html2canvas from "html2canvas-pro";

// Helper to determine if a member's birthday falls in the week (Sunday to Saturday)
function getBirthdaysForWeek(members: Member[], sundayDateStr: string): string[] {
  if (!sundayDateStr) return [];
  const sunday = new Date(sundayDateStr);
  const weekDates: { month: number; day: number }[] = [];
  
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    weekDates.push({ month: d.getMonth() + 1, day: d.getDate() });
  }

  const matches: string[] = [];
  for (const m of members) {
    if (!m.birth_date) continue;
    
    // Normalize delimiters to dash
    const cleanBirth = m.birth_date.replace(/\//g, "-").trim();
    const parts = cleanBirth.split("-");
    let mMonth = 0;
    let mDay = 0;
    
    if (parts.length === 3) {
      // YYYY-MM-DD or DD-MM-YYYY
      if (parts[0].length === 4) {
        mMonth = parseInt(parts[1], 10);
        mDay = parseInt(parts[2], 10);
      } else if (parts[2].length === 4) {
        mMonth = parseInt(parts[1], 10);
        mDay = parseInt(parts[0], 10);
      }
    } else if (parts.length === 2) {
      mMonth = parseInt(parts[0], 10);
      mDay = parseInt(parts[1], 10);
    }
    
    if (mMonth && mDay && !isNaN(mMonth) && !isNaN(mDay)) {
      const isBirthdayThisWeek = weekDates.some(wd => wd.month === mMonth && wd.day === mDay);
      if (isBirthdayThisWeek) {
        matches.push(m.name);
      }
    }
  }
  return matches;
}

const DEFAULT_ACTIVITIES: BulletinActivity[] = [
  { day: "Monday", activity: "Family Home Evening", time: "7:00 PM", type: "Ward" },
  { day: "Tuesday", activity: "Institute / Seminary", time: "6:00 PM", type: "Ward" },
  { day: "Wednesday", activity: "Self-Reliance Class", time: "6:30 PM", type: "Ward" },
  { day: "Thursday", activity: "Choir Practice", time: "7:00 PM", type: "Ward" },
  { day: "Friday", activity: "Youth Activity", time: "6:00 PM", type: "Ward" },
  { day: "Saturday", activity: "Building Cleaning / Baptisms", time: "8:00 AM", type: "Ward" },
  { day: "Sunday", activity: "Sacrament Meeting", time: "9:00 AM", type: "Ward" },
];

export const THEMES: Record<string, {
  name: string;
  primary: string;
  primaryLight: string;
  accent: string;
  accentLight: string;
  gradient: string;
  bg: string;
  cardBg: string;
  border: string;
  text: string;
  textMuted: string;
  textAccent: string;
}> = {
  navy: {
    name: "Classic Navy & Gold",
    primary: "#1e3a8a",
    primaryLight: "#eff6ff",
    accent: "#b45309",
    accentLight: "#fef3c7",
    gradient: "from-blue-800 via-blue-900 to-slate-950",
    bg: "#f8fafc",
    cardBg: "#ffffff",
    border: "#cbd5e1",
    text: "#0f172a",
    textMuted: "#64748b",
    textAccent: "#b45309",
  },
  forest: {
    name: "Forest Green & Bronze",
    primary: "#064e3b",
    primaryLight: "#f0fdf4",
    accent: "#9a3412",
    accentLight: "#ffedd5",
    gradient: "from-emerald-900 via-teal-950 to-slate-950",
    bg: "#f4fbf7",
    cardBg: "#ffffff",
    border: "#a7f3d0",
    text: "#062f21",
    textMuted: "#059669",
    textAccent: "#9a3412",
  },
  plum: {
    name: "Royal Plum & Rose",
    primary: "#581c87",
    primaryLight: "#faf5ff",
    accent: "#be185d",
    accentLight: "#fce7f3",
    gradient: "from-purple-800 via-fuchsia-950 to-slate-950",
    bg: "#faf5ff",
    cardBg: "#ffffff",
    border: "#e9d5ff",
    text: "#3b0764",
    textMuted: "#9333ea",
    textAccent: "#be185d",
  },
  slate: {
    name: "Slate Gray & Silver",
    primary: "#334155",
    primaryLight: "#f8fafc",
    accent: "#475569",
    accentLight: "#f1f5f9",
    gradient: "from-slate-700 via-slate-800 to-slate-950",
    bg: "#f8fafc",
    cardBg: "#ffffff",
    border: "#cbd5e1",
    text: "#0f172a",
    textMuted: "#64748b",
    textAccent: "#475569",
  },
  teal: {
    name: "Vibrant Teal & Copper",
    primary: "#134e5e",
    primaryLight: "#f0fdfa",
    accent: "#b45309",
    accentLight: "#ffedd5",
    gradient: "from-teal-800 via-cyan-900 to-slate-950",
    bg: "#f0fdfa",
    cardBg: "#ffffff",
    border: "#99f6e4",
    text: "#042f2e",
    textMuted: "#0d9488",
    textAccent: "#b45309",
  }
};

function toMmmYyyy(month: number, year: number) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mIdx = Math.max(1, Math.min(12, Number(month || 1))) - 1;
  return `${months[mIdx]}-${year}`;
}

export function BulletinPage({
  user,
  unit,
  onChanged,
}: {
  user: User;
  unit: UnitSettings;
  onChanged: () => void;
}) {
  void user;
  const { data: members = [] } = useTable("MEMBERS") as { data: Member[] };
  const { data: planners = [] } = useTable("PLANNERS") as { data: Planner[] };
  const { data: bulletins = [] } = useTable("BULLETINS") as { data: Bulletin[] };
  const { data: activities = [] } = useTable("ACTIVITIES") as { data: CalendarActivity[] };
  const { data: otherPrograms = [] } = useTable("OTHER CHURCH PROGRAM") as { data: OtherChurchProgram[] };

  // Filter submitted planners
  const activePlanners = useMemo(() => {
    return planners.filter(p => p.state === "SUBMITTED");
  }, [planners]);

  const [selectedPlannerId, setSelectedPlannerId] = useState<string>(() => {
    return localStorage.getItem("shared_selected_planner_id") || "";
  });
  const [selectedWeekId, setSelectedWeekId] = useState<string>(() => {
    return localStorage.getItem("shared_selected_week_id") || "";
  });
  const [activeTab, setActiveTab] = useState<"edit" | "web" | "whatsapp" | "pdf">("edit");
  const [downloadingImage, setDownloadingImage] = useState(false);
  const [birthdaySearch, setBirthdaySearch] = useState("");

  useEffect(() => {
    if (selectedPlannerId) {
      localStorage.setItem("shared_selected_planner_id", selectedPlannerId);
    }
  }, [selectedPlannerId]);

  useEffect(() => {
    if (selectedWeekId) {
      localStorage.setItem("shared_selected_week_id", selectedWeekId);
    }
  }, [selectedWeekId]);

  // Load first planner/week by default matching local storage
  useEffect(() => {
    const savedPlannerId = localStorage.getItem("shared_selected_planner_id");
    if (savedPlannerId && activePlanners.some(p => p.planner_id === savedPlannerId)) {
      setSelectedPlannerId(savedPlannerId);
    } else if (activePlanners.length > 0) {
      setSelectedPlannerId(activePlanners[0].planner_id);
    }
  }, [activePlanners]);

  const activePlanner = useMemo(() => {
    return activePlanners.find(p => p.planner_id === selectedPlannerId);
  }, [activePlanners, selectedPlannerId]);

  useEffect(() => {
    const savedWeekId = localStorage.getItem("shared_selected_week_id");
    if (activePlanner) {
      if (savedWeekId && activePlanner.weeks.some(w => w.week_id === savedWeekId)) {
        setSelectedWeekId(savedWeekId);
      } else if (activePlanner.weeks.length > 0) {
        setSelectedWeekId(activePlanner.weeks[0].week_id);
      }
    }
  }, [activePlanner]);

  const activeWeek = useMemo(() => {
    return activePlanner?.weeks.find(w => w.week_id === selectedWeekId);
  }, [activePlanner, selectedWeekId]);

  const currentBulletin = useMemo(() => {
    if (!selectedWeekId) return null;
    return bulletins.find(b => b.week_id === selectedWeekId) || null;
  }, [bulletins, selectedWeekId]);

  const [formData, setFormData] = useState<Partial<Bulletin>>({});

  // Initialize form state when selection changes
  useEffect(() => {
    if (!selectedWeekId || !activeWeek) return;

    if (currentBulletin) {
      setFormData(currentBulletin);
    } else {
      const defaultBirthdays = getBirthdaysForWeek(members, activeWeek.date);
      const sundayISO = activeWeek.date;
      
      // Calculate the next 30 days
      const thirtyDaysLater = new Date(sundayISO);
      thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
      const endISO = thirtyDaysLater.toISOString().split("T")[0];

      const upcomingList: { label: string; date: string }[] = [];
      activities.forEach(a => {
        if (a.activity && a.activity.trim() && a.date >= sundayISO && a.date <= endISO) {
          upcomingList.push({ label: `${a.activity} (${a.organisation})`, date: a.date });
        }
      });
      otherPrograms.forEach(p => {
        if (p.program && p.program.trim() && p.date >= sundayISO && p.date <= endISO) {
          upcomingList.push({ label: `${p.program} (${p.organisation})`, date: p.date });
        }
      });
      upcomingList.sort((a, b) => a.date.localeCompare(b.date));

      const upcoming = upcomingList.map(item => `${formatDateShort(item.date)} — ${item.label}`);

      setFormData({
        theme: "",
        special_music: "",
        activities: DEFAULT_ACTIVITIES,
        birthdays: defaultBirthdays,
        missionaries: [],
        scripture_of_the_week: "",
        missionary_challenge: "",
        temple_trip_date: "",
        familysearch_tip: "",
        ancestor_challenge: "",
        self_reliance_classes: ["Personal Finance", "Emotional Resilience"],
        ward_focus: "Ministering: Reaching out to those in need.",
        welfare_reminders: ["Fast offering donation this Sunday", "Submit service logs to Clerk"],
        bishopric_message: "Focus this week on developing Christlike charity inside your home and community.",
        upcoming_events: upcoming,
        qr_whatsapp: "",
        qr_familysearch: "https://www.familysearch.org",
        qr_gospel_library: "https://www.churchofjesuschrist.org/study/gospel-library",
        qr_website: "",
        qr_planner_link: window.location.href.split("#")[0],
        show_sacrament: true,
        show_activities: true,
        show_birthdays: true,
        show_missionary: true,
        show_temple: true,
        show_self_reliance: true,
        show_focus: true,
        show_welfare: true,
        show_bishopric: true,
        show_upcoming: true,
        show_qr: true,
        color_theme: "navy",
        pdf_layout: "standard"
      });
    }
  }, [currentBulletin, selectedWeekId, activeWeek, members]);

  // Save/Update helper
  const handleSave = () => {
    if (!selectedPlannerId || !selectedWeekId || !activeWeek) return;

    const isNew = !currentBulletin;
    const now = new Date().toISOString();
    const targetBulletinId = currentBulletin?.bulletin_id || ids.uid("bulletin");

    const nextBulletin: Bulletin = {
      bulletin_id: targetBulletinId,
      planner_id: selectedPlannerId,
      week_id: selectedWeekId,
      date: activeWeek.date,
      theme: formData.theme || "",
      special_music: formData.special_music || "",
      activities: formData.activities || [],
      birthdays: formData.birthdays || [],
      missionaries: formData.missionaries || [],
      scripture_of_the_week: formData.scripture_of_the_week || "",
      missionary_challenge: formData.missionary_challenge || "",
      temple_trip_date: formData.temple_trip_date || "",
      familysearch_tip: formData.familysearch_tip || "",
      ancestor_challenge: formData.ancestor_challenge || "",
      self_reliance_classes: formData.self_reliance_classes || [],
      ward_focus: formData.ward_focus || "",
      welfare_reminders: formData.welfare_reminders || [],
      bishopric_message: formData.bishopric_message || "",
      upcoming_events: formData.upcoming_events || [],
      qr_whatsapp: formData.qr_whatsapp || "",
      qr_familysearch: formData.qr_familysearch || "",
      qr_gospel_library: formData.qr_gospel_library || "",
      qr_website: formData.qr_website || "",
      qr_planner_link: formData.qr_planner_link || "",
      show_sacrament: formData.show_sacrament !== false,
      show_activities: formData.show_activities !== false,
      show_birthdays: formData.show_birthdays !== false,
      show_missionary: formData.show_missionary !== false,
      show_temple: formData.show_temple !== false,
      show_self_reliance: formData.show_self_reliance !== false,
      show_focus: formData.show_focus !== false,
      show_welfare: formData.show_welfare !== false,
      show_bishopric: formData.show_bishopric !== false,
      show_upcoming: formData.show_upcoming !== false,
      show_qr: formData.show_qr !== false,
      color_theme: formData.color_theme || "navy",
      pdf_layout: formData.pdf_layout || "standard",
      created_date: currentBulletin?.created_date || now,
      updated_date: now,
    };

    updateDB((db0) => {
      const list = [...(db0.BULLETINS || [])];
      if (isNew) {
        list.push(nextBulletin);
      } else {
        const idx = list.findIndex(b => b.bulletin_id === targetBulletinId);
        if (idx !== -1) list[idx] = nextBulletin;
      }
      return { ...db0, BULLETINS: list };
    });

    onChanged();
    alert("Bulletin saved successfully!");
  };

  const handleFieldChange = (key: keyof Bulletin, val: any) => {
    setFormData(prev => ({ ...prev, [key]: val }));
  };

  // List helpers
  const handleArrayStringChange = (key: "upcoming_events" | "welfare_reminders" | "missionaries" | "birthdays" | "self_reliance_classes", index: number, value: string) => {
    const list = [...(formData[key] || [])];
    list[index] = value;
    handleFieldChange(key, list.filter(Boolean));
  };

  const handleArrayAdd = (key: "upcoming_events" | "welfare_reminders" | "missionaries" | "birthdays" | "self_reliance_classes") => {
    const list = [...(formData[key] || [])];
    list.push("");
    handleFieldChange(key, list);
  };

  const handleArrayRemove = (key: "upcoming_events" | "welfare_reminders" | "missionaries" | "birthdays" | "self_reliance_classes", index: number) => {
    const list = [...(formData[key] || [])];
    list.splice(index, 1);
    handleFieldChange(key, list);
  };

  const handleAddActivityRow = () => {
    const list = [...(formData.activities || [])];
    list.push({ day: "Sunday", activity: "", time: "12:00 PM", type: "Ward" });
    handleFieldChange("activities", list);
  };

  const handleRemoveActivityRow = (index: number) => {
    const list = [...(formData.activities || [])];
    list.splice(index, 1);
    handleFieldChange("activities", list);
  };

  // Activity cell update
  const handleActivityCellChange = (index: number, col: keyof BulletinActivity, value: any) => {
    const list = [...(formData.activities || [])];
    list[index] = { ...list[index], [col]: value };
    handleFieldChange("activities", list);
  };

  // Calendar Auto-fill Helper
  const handleImportWeeklyActivities = () => {
    if (!activeWeek) return;
    const sunday = new Date(activeWeek.date);
    const importedList: BulletinActivity[] = [];

    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    for (let idx = 0; idx < 7; idx++) {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + 1 + idx);
      const isoDate = d.toISOString().split("T")[0];
      const dayName = daysOfWeek[idx];

      // Find all events for this date
      const dayEvents = activities.filter(a => a.date === isoDate);
      const dayPrograms = otherPrograms.filter(p => p.date === isoDate);

      if (dayEvents.length === 0 && dayPrograms.length === 0) {
        const defaultAct = DEFAULT_ACTIVITIES[idx];
        importedList.push({ 
          day: dayName, 
          activity: defaultAct.activity, 
          time: defaultAct.time,
          type: "Ward"
        });
      } else {
        dayEvents.forEach(evt => {
          const isStake = evt.organisation?.toLowerCase().includes("stake");
          importedList.push({
            day: dayName,
            activity: `${evt.organisation}: ${evt.activity}`,
            time: evt.time || "12:00 PM",
            type: isStake ? "Stake" : "Ward"
          });
        });

        dayPrograms.forEach(prog => {
          if (prog.program && prog.program.trim()) {
            const isStake = prog.organisation?.toLowerCase().includes("stake");
            importedList.push({
              day: dayName,
              activity: `${prog.organisation}: ${prog.program}`,
              time: "12:00 PM",
              type: isStake ? "Stake" : "Ward"
            });
          }
        });
      }
    }

    handleFieldChange("activities", importedList);
    alert("Activities auto-filled from calendar! Duplicate days are supported for multiple events.");
  };

  // Pulling Suggested Upcoming Events
  const suggestedEvents = useMemo(() => {
    if (!activeWeek) return [];
    const sunday = new Date(activeWeek.date);
    const thirtyDaysLater = new Date(sunday);
    thirtyDaysLater.setDate(sunday.getDate() + 30);

    const startISO = sunday.toISOString().split("T")[0];
    const endISO = thirtyDaysLater.toISOString().split("T")[0];

    const list: { label: string; date: string }[] = [];

    // Filter activities
    activities.forEach(a => {
      if (a.activity && a.activity.trim() && a.date >= startISO && a.date <= endISO) {
        list.push({ label: `${a.activity} (${a.organisation})`, date: a.date });
      }
    });

    // Filter other church programs
    otherPrograms.forEach(p => {
      if (p.program && p.program.trim() && p.date >= startISO && p.date <= endISO) {
        list.push({ label: `${p.program} (${p.organisation})`, date: p.date });
      }
    });

    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [activeWeek, activities, otherPrograms]);

  const handleAddSuggestedEvent = (label: string, date: string) => {
    const list = [...(formData.upcoming_events || [])];
    const formatted = `${formatDateShort(date)} — ${label}`;
    if (!list.includes(formatted)) {
      list.push(formatted);
      handleFieldChange("upcoming_events", list);
    }
  };

  // Birthday search toggle helper
  const filteredBirthdayMembers = useMemo(() => {
    if (!birthdaySearch.trim()) return [];
    return members.filter(m => m.name.toLowerCase().includes(birthdaySearch.toLowerCase())).slice(0, 5);
  }, [members, birthdaySearch]);

  const handleToggleBirthdayName = (name: string) => {
    const list = [...(formData.birthdays || [])];
    if (list.includes(name)) {
      handleFieldChange("birthdays", list.filter(n => n !== name));
    } else {
      list.push(name);
      handleFieldChange("birthdays", list);
    }
  };

  // Image Generation (WhatsApp portrait format)
  const handleDownloadWhatsAppImage = async () => {
    const element = document.getElementById("bulletin-whatsapp-card");
    if (!element) return;
    
    setDownloadingImage(true);
    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        width: 1080,
        height: 1350
      });
      const link = document.createElement("a");
      link.download = `${unit.unit_name || "Ward"}_Bulletin_${activeWeek ? formatDateShort(activeWeek.date) : "week"}.jpg`;
      link.href = canvas.toDataURL("image/jpeg", 0.9);
      link.click();
    } catch (e) {
      console.error("Failed to export image card:", e);
      alert("Error generating image. Try printing to PDF instead.");
    } finally {
      setDownloadingImage(false);
    }
  };

  if (activePlanners.length === 0) {
    return (
      <EmptyState
        title="Weekly Bulletin"
        body="You must create and submit a Planner before you can generate bulletins. Please return to the Planner tab."
      />
    );
  }

  // Precompute sacrament items safely
  const parsedSpeakers = activeWeek?.speakers || [];
  const openingHymn = activeWeek?.hymns?.opening || "";
  const sacramentHymn = activeWeek?.hymns?.sacrament || "";
  const closingHymn = activeWeek?.hymns?.closing || "";
  const conducting = activeWeek?.conducting_officer || activePlanner?.conducting_officer || "";
  const presiding = activeWeek?.presiding || unit.leader_name || "";
  const openingPrayer = activeWeek?.prayers?.invocation || "";
  const closingPrayer = activeWeek?.prayers?.benediction || "";

  const theme = THEMES[formData.color_theme || "navy"] || THEMES.navy;

  return (
    <div className="space-y-6">
      {/* Selection Banner */}
      <Card>
        <CardBody className="flex flex-col md:flex-row gap-4 justify-between items-center">
          <div className="flex flex-wrap gap-4 items-center">
            <div>
              <Label className="text-slate-600 font-semibold mb-1 block">1. Select Planner</Label>
              <Select value={selectedPlannerId} onChange={e => { setSelectedPlannerId(e.target.value); setSelectedWeekId(""); }} className="w-52">
                {activePlanners.map(p => (
                  <option key={p.planner_id} value={p.planner_id}>
                    {toMmmYyyy(p.month, p.year)}
                  </option>
                ))}
              </Select>
            </div>
            {activePlanner && (
              <div>
                <Label className="text-slate-600 font-semibold mb-1 block">2. Select Week</Label>
                <Select value={selectedWeekId} onChange={e => setSelectedWeekId(e.target.value)} className="w-52">
                  {activePlanner.weeks.map(w => (
                    <option key={w.week_id} value={w.week_id}>
                      {formatDateShort(w.date)} {w.fast_testimony ? "(Fast)" : ""}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div>
              <Label className="text-slate-600 font-semibold mb-1 block">3. Color Theme</Label>
              <Select value={formData.color_theme || "navy"} onChange={e => handleFieldChange("color_theme", e.target.value)} className="w-52">
                {Object.entries(THEMES).map(([k, v]) => (
                  <option key={k} value={k}>{v.name}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant={activeTab === "edit" ? "primary" : "secondary"} onClick={() => setActiveTab("edit")}>
              Edit Info
            </Button>
            <Button variant={activeTab === "web" ? "primary" : "secondary"} onClick={() => setActiveTab("web")}>
              Web View
            </Button>
            <Button variant={activeTab === "whatsapp" ? "primary" : "secondary"} onClick={() => setActiveTab("whatsapp")}>
              WhatsApp Card
            </Button>
            <Button variant={activeTab === "pdf" ? "primary" : "secondary"} onClick={() => setActiveTab("pdf")}>
              Print / PDF
            </Button>
          </div>
        </CardBody>
      </Card>

      {activeWeek && (activeWeek.meeting_type === "Stake Conference" || activeWeek.is_canceled || activeWeek.cancel_reason) ? (
        <Card className="border border-slate-200 shadow-sm p-6 bg-slate-50 mt-6">
          <div className="text-center max-w-md mx-auto space-y-4 py-8">
            <span className="text-5xl block">⛪</span>
            <h3 className="text-xl font-bold text-slate-800">No Sacrament Meeting Scheduled</h3>
            <p className="text-sm text-slate-500">
              There is no sacrament meeting scheduled for the week of <strong>{formatDateShort(activeWeek.date)}</strong>. No weekly bulletin is required.
            </p>
            <div className="inline-block bg-amber-50 text-amber-800 border border-amber-200 rounded-xl px-4 py-2 text-sm font-semibold">
              Reason: {activeWeek.cancel_reason || activeWeek.meeting_type || "Stake Conference"}
            </div>
          </div>
        </Card>
      ) : (
        <>
          {/* EDIT TAB */}
          {activeTab === "edit" && activeWeek && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Form Fields */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader className="flex justify-between items-center border-b pb-3">
                <div>
                  <CardTitle>Weekly Bulletin Content Editor</CardTitle>
                  <p className="text-xs text-slate-500 mt-1">Select sections to display and type in the text details below.</p>
                </div>
                <Button variant="primary" onClick={handleSave}>
                  Save Changes
                </Button>
              </CardHeader>
              <CardBody className="divide-y divide-slate-100 space-y-6">
                
                {/* 1. Sacrament program */}
                <div className="pt-4 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-slate-900 text-base">1. Sacrament Meeting Outline</h3>
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input type="checkbox" checked={formData.show_sacrament !== false} onChange={e => handleFieldChange("show_sacrament", e.target.checked)} className="rounded" />
                      Show Section
                    </label>
                  </div>
                  {formData.show_sacrament !== false && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg">
                      <div>
                        <Label>Theme/Focus for Sacrament (Optional)</Label>
                        <Input value={formData.theme || ""} onChange={e => handleFieldChange("theme", e.target.value)} placeholder="e.g. Focus on Jesus Christ" />
                      </div>
                      <div>
                        <Label>Special Musical Number Detail (Optional)</Label>
                        <Input value={formData.special_music || ""} onChange={e => handleFieldChange("special_music", e.target.value)} placeholder="e.g. Solo by Sister Smith" />
                      </div>
                      <div className="md:col-span-2">
                        <Label>Come, Follow Me Study (Weekly Reading)</Label>
                        <Input value={formData.come_follow_me || ""} onChange={e => handleFieldChange("come_follow_me", e.target.value)} placeholder="e.g. Matthew 1-2, Luke 1" />
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Weekly Activities */}
                <div className="pt-6 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-slate-900 text-base">2. Weekly Activities</h3>
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input type="checkbox" checked={formData.show_activities !== false} onChange={e => handleFieldChange("show_activities", e.target.checked)} className="rounded" />
                      Show Section
                    </label>
                  </div>
                  {formData.show_activities !== false && (
                    <div className="space-y-4">
                      <table className="w-full text-left text-sm border rounded-lg overflow-hidden">
                        <thead className="bg-slate-100 text-slate-700">
                          <tr>
                            <th className="p-2 w-32 font-semibold">Day/Date</th>
                            <th className="p-2 font-semibold">Activity Details</th>
                            <th className="p-2 w-36 font-semibold">Time / Info</th>
                            <th className="p-2 w-28 font-semibold">Scope</th>
                            <th className="p-2 w-16 font-semibold text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(formData.activities || []).map((act, index) => (
                            <tr key={index} className="border-t border-slate-200">
                              <td className="p-2">
                                <Input value={act.day} onChange={e => handleActivityCellChange(index, "day", e.target.value)} className="h-8 w-full shadow-none bg-transparent" />
                              </td>
                              <td className="p-2">
                                <Input value={act.activity} onChange={e => handleActivityCellChange(index, "activity", e.target.value)} className="h-8 w-full shadow-none bg-transparent" />
                              </td>
                              <td className="p-2">
                                <Input value={act.time} onChange={e => handleActivityCellChange(index, "time", e.target.value)} className="h-8 w-full shadow-none bg-transparent" />
                              </td>
                              <td className="p-2">
                                <Select value={act.type || "Ward"} onChange={e => handleActivityCellChange(index, "type", e.target.value as any)} className="h-8 w-full p-0 px-2 text-xs">
                                  <option value="Ward">Ward</option>
                                  <option value="Stake">Stake</option>
                                </Select>
                              </td>
                              <td className="p-2 text-center">
                                <button type="button" onClick={() => handleRemoveActivityRow(index)} className="text-red-500 hover:text-red-700 font-semibold text-xs">
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="flex justify-between items-center">
                        <Button variant="secondary" onClick={handleAddActivityRow} className="h-8 text-xs font-semibold" icon="➕">
                          Add Custom Activity
                        </Button>
                        <Button variant="outline" onClick={handleImportWeeklyActivities} className="h-8 text-xs font-semibold" icon="🔄">
                          Auto-fill Week from Calendar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Bishopric message */}
                <div className="pt-6 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-slate-900 text-base">3. Bishopric Message</h3>
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input type="checkbox" checked={formData.show_bishopric !== false} onChange={e => handleFieldChange("show_bishopric", e.target.checked)} className="rounded" />
                      Show Section
                    </label>
                  </div>
                  {formData.show_bishopric !== false && (
                    <div>
                      <Label>Weekly Message</Label>
                      <Textarea rows={3} value={formData.bishopric_message || ""} onChange={e => handleFieldChange("bishopric_message", e.target.value)} placeholder="Spiritual thought for the ward..." />
                    </div>
                  )}
                </div>

                {/* 4. Missionary Corner */}
                <div className="pt-6 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-slate-900 text-base">4. Missionary Corner</h3>
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input type="checkbox" checked={formData.show_missionary !== false} onChange={e => handleFieldChange("show_missionary", e.target.checked)} className="rounded" />
                      Show Section
                    </label>
                  </div>
                  {formData.show_missionary !== false && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="md:col-span-2">
                        <Label>Full-time Missionaries serving from the ward</Label>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {(formData.missionaries || []).map((m, idx) => (
                            <span key={idx} className="bg-indigo-50 border text-indigo-900 rounded-full px-2 py-0.5 text-xs flex items-center gap-1">
                              {m}
                              <button type="button" onClick={() => handleArrayRemove("missionaries", idx)} className="hover:text-red-500 font-bold">×</button>
                            </span>
                          ))}
                          <Button variant="secondary" onClick={() => handleArrayAdd("missionaries")} className="h-6 text-[10px] py-0">+ Add</Button>
                        </div>
                      </div>
                      <div>
                        <Label>Scripture of the Week</Label>
                        <Input value={formData.scripture_of_the_week || ""} onChange={e => handleFieldChange("scripture_of_the_week", e.target.value)} />
                      </div>
                      <div>
                        <Label>Missionary Challenge</Label>
                        <Input value={formData.missionary_challenge || ""} onChange={e => handleFieldChange("missionary_challenge", e.target.value)} />
                      </div>
                    </div>
                  )}
                </div>

                {/* 5. Welfare & Focus */}
                <div className="pt-6 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-slate-900 text-base">5. Welfare & Ward Focus</h3>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                        <input type="checkbox" checked={formData.show_focus !== false} onChange={e => handleFieldChange("show_focus", e.target.checked)} className="rounded" />
                        Show Focus
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                        <input type="checkbox" checked={formData.show_welfare !== false} onChange={e => handleFieldChange("show_welfare", e.target.checked)} className="rounded" />
                        Show Welfare
                      </label>
                    </div>
                  </div>
                  {formData.show_focus !== false && (
                    <div>
                      <Label>Ward Focus / Month Emphasis</Label>
                      <Input value={formData.ward_focus || ""} onChange={e => handleFieldChange("ward_focus", e.target.value)} />
                    </div>
                  )}
                  {formData.show_welfare !== false && (
                    <div className="space-y-2">
                      <Label>Welfare Reminders</Label>
                      {(formData.welfare_reminders || []).map((rem, idx) => (
                        <div key={idx} className="flex gap-2">
                          <Input value={rem} onChange={e => handleArrayStringChange("welfare_reminders", idx, e.target.value)} className="h-8 flex-1" />
                          <button type="button" onClick={() => handleArrayRemove("welfare_reminders", idx)} className="text-red-500 text-xs">Remove</button>
                        </div>
                      ))}
                      <Button variant="secondary" onClick={() => handleArrayAdd("welfare_reminders")} className="h-7 text-xs">+ Add Item</Button>
                    </div>
                  )}
                </div>

                {/* 6. Upcoming Events */}
                <div className="pt-6 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-slate-900 text-base">6. Upcoming Events</h3>
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input type="checkbox" checked={formData.show_upcoming !== false} onChange={e => handleFieldChange("show_upcoming", e.target.checked)} className="rounded" />
                      Show Section
                    </label>
                  </div>
                  {formData.show_upcoming !== false && (
                    <div className="space-y-2">
                      {(formData.upcoming_events || []).map((evt, idx) => (
                        <div key={idx} className="flex gap-2">
                          <Input value={evt} onChange={e => handleArrayStringChange("upcoming_events", idx, e.target.value)} className="h-8 flex-1" />
                          <button type="button" onClick={() => handleArrayRemove("upcoming_events", idx)} className="text-red-500 text-xs">Remove</button>
                        </div>
                      ))}
                      <Button variant="secondary" onClick={() => handleArrayAdd("upcoming_events")} className="h-7 text-xs">+ Add Event</Button>
                    </div>
                  )}
                </div>

              </CardBody>
            </Card>
          </div>

          {/* Quick-import Sidebar */}
          <div className="space-y-6">
            
            {/* Quick-import Birthdays */}
            <Card>
              <CardHeader className="border-b pb-2">
                <CardTitle className="text-sm">🎂 Birthdays in Ward</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                <div className="text-xs text-slate-500">Search member directory to quickly toggle their birthday on the bulletin list:</div>
                <Input value={birthdaySearch} onChange={e => setBirthdaySearch(e.target.value)} placeholder="Type name..." className="h-8" />
                {filteredBirthdayMembers.length > 0 && (
                  <div className="border border-slate-200 rounded divide-y divide-slate-100 bg-slate-50 max-h-40 overflow-y-auto text-xs">
                    {filteredBirthdayMembers.map(m => {
                      const isAdded = (formData.birthdays || []).includes(m.name);
                      return (
                        <div key={m.member_id} className="p-2 flex justify-between items-center">
                          <div>
                            <span className="font-semibold">{m.name}</span>
                            {m.birth_date && <span className="text-[10px] text-slate-400 block">Bday: {m.birth_date}</span>}
                          </div>
                          <Button variant="ghost" className="h-6 py-0 px-2 text-xs" onClick={() => handleToggleBirthdayName(m.name)}>
                            {isAdded ? "Remove" : "Add"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <Divider />
                <div className="text-xs font-semibold text-slate-600">Selected Birthdays:</div>
                <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto pt-1">
                  {(formData.birthdays || []).length === 0 ? (
                    <span className="text-slate-400 text-xs">No birthdays selected.</span>
                  ) : (
                    (formData.birthdays || []).map((name, idx) => (
                      <span key={idx} className="bg-pink-50 border text-pink-900 text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 font-medium">
                        {name}
                        <button type="button" onClick={() => handleToggleBirthdayName(name)} className="hover:text-red-500">×</button>
                      </span>
                    ))
                  )}
                </div>
              </CardBody>
            </Card>

            {/* Quick-import Calendar Events */}
            <Card>
              <CardHeader className="border-b pb-2">
                <CardTitle className="text-sm">📅 Calendar Events (Next 30 Days)</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                <div className="text-xs text-slate-500">Auto-detected calendar items. Click + to add to upcoming events list:</div>
                {suggestedEvents.length === 0 ? (
                  <div className="text-xs text-slate-400 text-center py-4">No events found in calendar.</div>
                ) : (
                  <div className="border border-slate-200 rounded divide-y divide-slate-100 bg-slate-50 max-h-60 overflow-y-auto text-xs">
                    {suggestedEvents.map((evt, idx) => (
                      <div key={idx} className="p-2 flex justify-between items-start gap-2">
                        <div>
                          <div className="font-semibold text-slate-800 leading-tight">{evt.label}</div>
                          <span className="text-[10px] text-slate-400">{formatDateShort(evt.date)}</span>
                        </div>
                        <Button variant="secondary" className="h-6 w-6 p-0 flex items-center justify-center text-xs shrink-0" onClick={() => handleAddSuggestedEvent(evt.label, evt.date)}>
                          +
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Settings Toggles */}
            <Card>
              <CardHeader className="border-b pb-2">
                <CardTitle className="text-sm">⚙️ Section Toggles & Layout</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3 text-xs text-slate-700">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formData.show_temple !== false} onChange={e => handleFieldChange("show_temple", e.target.checked)} className="rounded" />Show Temple Section</label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formData.show_self_reliance !== false} onChange={e => handleFieldChange("show_self_reliance", e.target.checked)} className="rounded" />Show Self-Reliance</label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formData.show_qr !== false} onChange={e => handleFieldChange("show_qr", e.target.checked)} className="rounded" />Show QR Codes</label>
                </div>
                <Divider />
                <div>
                  <Label className="text-xs font-semibold block mb-1">PDF Page Format</Label>
                  <Select value={formData.pdf_layout || "standard"} onChange={e => handleFieldChange("pdf_layout", e.target.value)} className="w-full text-xs h-8">
                    <option value="standard">Standard Outline (Landscape, 2-Col)</option>
                    <option value="bi-fold">Booklet Bi-fold (Landscape, Booklet Fold)</option>
                  </Select>
                </div>
              </CardBody>
            </Card>

          </div>
        </div>
      )}

      {/* WEB VIEW (MOBILE PREVIEW) */}
      {activeTab === "web" && activeWeek && (
        <div className="max-w-md mx-auto bg-slate-50 border border-slate-200 rounded-3xl overflow-hidden shadow-lg" style={{ backgroundColor: theme.bg }}>
          {/* Header */}
          <div className="p-6 text-white text-center shadow-md bg-gradient-to-r" style={{ backgroundImage: `linear-gradient(to right, ${theme.primary}, #111827)` }}>
            <h2 className="text-xl font-bold uppercase tracking-wider">{unit.unit_name || "Obantoko Ward"}</h2>
            <p className="text-xs uppercase tracking-widest mt-1 opacity-80" style={{ color: theme.accentLight }}>Weekly Bulletin</p>
            <div className="mt-3 inline-block bg-white/20 px-3 py-0.5 rounded-full text-xs font-medium border border-white/10">
              Sunday, {formatDateShort(activeWeek.date)}
            </div>
          </div>
          
          <div className="p-4 space-y-4">
            
            {/* Sacrament */}
            {formData.show_sacrament !== false && (
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-xs space-y-3" style={{ backgroundColor: theme.cardBg }}>
                <div className="flex items-center gap-2 border-b pb-2 font-bold text-sm" style={{ color: theme.primary, borderColor: theme.border }}>
                  <span>⛪</span> Sacrament Meeting
                </div>
                {formData.theme && (
                  <div className="text-center italic text-xs py-1" style={{ color: theme.textMuted }}>
                    "{formData.theme}"
                  </div>
                )}
                <div className="text-xs space-y-2">
                  <div className="flex justify-between"><span className="text-slate-500">Presiding:</span><span className="font-semibold" style={{ color: theme.text }}>{presiding}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Conducting:</span><span className="font-semibold" style={{ color: theme.text }}>{conducting}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Opening Hymn:</span><span className="font-semibold" style={{ color: theme.text }}>{openingHymn}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Sacrament Hymn:</span><span className="font-semibold" style={{ color: theme.text }}>{sacramentHymn}</span></div>
                  {formData.special_music && (
                    <div className="p-2 rounded text-[11px] border" style={{ backgroundColor: theme.primaryLight, color: theme.text, borderColor: theme.border }}>
                      <strong>Special Music:</strong> {formData.special_music}
                    </div>
                  )}
                  {parsedSpeakers.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t" style={{ borderColor: theme.border }}>
                      <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.textMuted }}>Speakers:</div>
                      {parsedSpeakers.map((s, idx) => (
                        <div key={idx} className="p-2.5 rounded border border-slate-100" style={{ backgroundColor: theme.bg }}>
                          <div className="font-semibold text-slate-800">{s.name}</div>
                          {s.topic && <div className="text-[11px] text-slate-500 mt-0.5">Topic: {s.topic}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t" style={{ borderColor: theme.border }}><span className="text-slate-500">Closing Hymn:</span><span className="font-semibold" style={{ color: theme.text }}>{closingHymn}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Opening Prayer:</span><span className="font-semibold" style={{ color: theme.text }}>{openingPrayer}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Closing Prayer:</span><span className="font-semibold" style={{ color: theme.text }}>{closingPrayer}</span></div>
                </div>
              </div>
            )}

            {/* Come Follow Me */}
            {formData.come_follow_me && (
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-xs space-y-2" style={{ backgroundColor: theme.cardBg }}>
                <div className="flex items-center gap-2 border-b pb-1.5 font-bold text-sm" style={{ color: theme.primary, borderColor: theme.border }}>
                  <span>📖</span> Come, Follow Me Reading
                </div>
                <div className="text-xs font-semibold text-slate-800">
                  {formData.come_follow_me}
                </div>
              </div>
            )}

            {/* Activities */}
            {formData.show_activities !== false && (formData.activities || []).length > 0 && (
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-xs space-y-3" style={{ backgroundColor: theme.cardBg }}>
                <div className="flex items-center gap-2 border-b pb-2 font-bold text-sm" style={{ color: theme.primary, borderColor: theme.border }}>
                  <span>📅</span> Weekly Activities
                </div>
                <div className="space-y-2.5">
                  {(formData.activities || []).map((act, idx) => (
                    <div key={idx} className="flex justify-between items-start text-xs border-b border-slate-100/50 pb-2 last:border-0 last:pb-0">
                      <div className="font-bold w-20 shrink-0" style={{ color: theme.textAccent }}>{act.day}</div>
                      <div className="flex-1 font-semibold text-slate-800">
                        {act.activity || "None"}
                        {act.type && (
                          <span className="ml-1.5 text-[8px] px-1 py-0.5 rounded font-extrabold uppercase bg-slate-100 text-slate-500 border border-slate-200 inline-block">
                            {act.type}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 italic ml-2 shrink-0">{formatTime12h(act.time)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Birthdays */}
            {formData.show_birthdays !== false && (formData.birthdays || []).length > 0 && (
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-xs space-y-2" style={{ backgroundColor: theme.cardBg }}>
                <div className="flex items-center gap-2 border-b pb-1.5 font-bold text-sm" style={{ color: theme.primary, borderColor: theme.border }}>
                  <span>🎂</span> Birthdays This Week
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(formData.birthdays || []).map((name, i) => (
                    <span key={i} className="inline-block border rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-2xs" style={{ backgroundColor: theme.accentLight, color: theme.textAccent, borderColor: theme.border }}>
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Message */}
            {formData.show_bishopric !== false && formData.bishopric_message && (
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-xs space-y-2" style={{ backgroundColor: theme.cardBg }}>
                <div className="flex items-center gap-2 border-b pb-1.5 font-bold text-sm" style={{ color: theme.primary, borderColor: theme.border }}>
                  <span>✍️</span> Bishopric Message
                </div>
                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap italic">
                  "{formData.bishopric_message}"
                </p>
              </div>
            )}

            {/* Missionary Corner */}
            {formData.show_missionary !== false && (
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-xs space-y-2.5" style={{ backgroundColor: theme.cardBg }}>
                <div className="flex items-center gap-2 border-b pb-1.5 font-bold text-sm" style={{ color: theme.primary, borderColor: theme.border }}>
                  <span>🌍</span> Missionary Corner
                </div>
                {(formData.missionaries || []).length > 0 && (
                  <div className="text-xs">
                    <span className="text-slate-500">Serving from Ward: </span>
                    <span className="font-semibold" style={{ color: theme.text }}>{(formData.missionaries || []).join(", ")}</span>
                  </div>
                )}
                {formData.scripture_of_the_week && (
                  <div className="p-2.5 rounded border text-xs" style={{ backgroundColor: theme.primaryLight, borderColor: theme.border }}>
                    <div className="font-bold text-[9px] uppercase tracking-wider" style={{ color: theme.primary }}>Scripture of the Week</div>
                    <div className="italic text-slate-600 mt-1">"{formData.scripture_of_the_week}"</div>
                  </div>
                )}
                {formData.missionary_challenge && (
                  <div className="text-xs text-slate-700">
                    <strong>Challenge:</strong> {formData.missionary_challenge}
                  </div>
                )}
              </div>
            )}

            {/* Family History */}
            {formData.show_temple !== false && (
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-xs space-y-2.5" style={{ backgroundColor: theme.cardBg }}>
                <div className="flex items-center gap-2 border-b pb-1.5 font-bold text-sm" style={{ color: theme.primary, borderColor: theme.border }}>
                  <span>🏛️</span> Temple & Family History
                </div>
                {formData.temple_trip_date && (
                  <div className="text-xs">
                    <span className="text-slate-500">Temple Trip:</span> <span className="font-semibold" style={{ color: theme.text }}>{formData.temple_trip_date}</span>
                  </div>
                )}
                {formData.familysearch_tip && (
                  <div className="text-xs text-slate-600">
                    <strong>Tip:</strong> {formData.familysearch_tip}
                  </div>
                )}
                {formData.ancestor_challenge && (
                  <div className="text-xs text-slate-600">
                    <strong>Challenge:</strong> {formData.ancestor_challenge}
                  </div>
                )}
              </div>
            )}

            {/* Self Reliance */}
            {formData.show_self_reliance !== false && (formData.self_reliance_classes || []).length > 0 && (
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-xs space-y-2" style={{ backgroundColor: theme.cardBg }}>
                <div className="flex items-center gap-2 border-b pb-1.5 font-bold text-sm" style={{ color: theme.primary, borderColor: theme.border }}>
                  <span>💼</span> Self-Reliance Classes
                </div>
                <ul className="list-disc pl-4 text-xs text-slate-700 space-y-1">
                  {(formData.self_reliance_classes || []).map((cls, i) => (
                    <li key={i}>{cls}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Welfare */}
            {formData.show_welfare !== false && (formData.welfare_reminders || []).length > 0 && (
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-xs space-y-2" style={{ backgroundColor: theme.cardBg }}>
                <div className="flex items-center gap-2 border-b pb-1.5 font-bold text-sm" style={{ color: theme.primary, borderColor: theme.border }}>
                  <span>🤲</span> Welfare & Service
                </div>
                <ul className="list-disc pl-4 text-xs text-slate-700 space-y-1">
                  {(formData.welfare_reminders || []).map((rem, i) => (
                    <li key={i}>{rem}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Upcoming events */}
            {formData.show_upcoming !== false && (formData.upcoming_events || []).length > 0 && (
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-xs space-y-2" style={{ backgroundColor: theme.cardBg }}>
                <div className="flex items-center gap-2 border-b pb-1.5 font-bold text-sm" style={{ color: theme.primary, borderColor: theme.border }}>
                  <span>📣</span> Upcoming Events
                </div>
                <ul className="list-disc pl-4 text-xs text-slate-700 space-y-1">
                  {(formData.upcoming_events || []).map((evt, i) => (
                    <li key={i}>{evt}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Disclaimer */}
            <div className="text-[10px] text-slate-400 text-center leading-relaxed px-4 pt-4 border-t border-slate-200">
              Prepared for {unit.unit_name || "Ward"} members. Unofficial bulletin.
            </div>

          </div>
        </div>
      )}

      {/* WHATSAPP CARD EXPORT */}
      {activeTab === "whatsapp" && activeWeek && (
        <div className="space-y-4">
          <Card>
            <CardBody className="flex justify-between items-center bg-slate-50 border-b">
              <div>
                <h4 className="font-semibold text-slate-800">WhatsApp Graphic Preview</h4>
                <p className="text-xs text-slate-500 mt-1">High-quality portrait card (1080 × 1350 px) formatted in <strong>{theme.name}</strong>.</p>
              </div>
              <Button variant="primary" onClick={handleDownloadWhatsAppImage} disabled={downloadingImage}>
                {downloadingImage ? "Rendering Image..." : "Download Graphic"}
              </Button>
            </CardBody>
          </Card>

          <div className="flex justify-center bg-slate-200 p-8 rounded-xl overflow-x-auto">
            <div className="origin-top shrink-0" style={{ transform: "scale(0.55)", height: "742px", width: "594px" }}>
              <div
                id="bulletin-whatsapp-card"
                className="bg-white text-black font-sans relative overflow-hidden flex flex-col p-8"
                style={{ width: "1080px", height: "1350px", minWidth: "1080px", minHeight: "1350px", backgroundColor: theme.bg }}
              >
                {/* Header */}
                <div className="p-8 text-white rounded-2xl flex justify-between items-center shadow-md bg-gradient-to-r" style={{ backgroundImage: `linear-gradient(to right, ${theme.primary}, #0f172a)` }}>
                  <div>
                    <h2 className="text-3xl font-bold uppercase tracking-wide leading-none">{unit.unit_name || "Obantoko Ward"}</h2>
                    <p className="text-sm font-semibold tracking-widest uppercase mt-2" style={{ color: theme.accentLight }}>Weekly Bulletin</p>
                  </div>
                  <div className="bg-white/10 border border-white/20 px-4 py-2 rounded-xl text-right">
                    <div className="text-[10px] uppercase font-semibold tracking-wider opacity-85">Date</div>
                    <div className="text-base font-bold">{formatDateShort(activeWeek.date)}</div>
                  </div>
                </div>

                {/* 2-Column Grid */}
                <div className="flex-1 grid grid-cols-2 gap-6 mt-6 overflow-hidden">
                  
                  {/* Left Column */}
                  <div className="space-y-4 flex flex-col justify-start">
                    
                    {/* Sacrament Program */}
                    {formData.show_sacrament !== false && (
                      <div className="bg-white border p-5 rounded-2xl space-y-3" style={{ backgroundColor: theme.cardBg, borderColor: theme.border }}>
                        <div className="flex items-center gap-2 font-bold text-base border-b pb-2" style={{ color: theme.primary, borderColor: theme.border }}>
                          <span>⛪</span> Sacrament Meeting
                        </div>
                        {formData.theme && (
                          <div className="italic text-xs font-semibold" style={{ color: theme.textMuted }}>"{formData.theme}"</div>
                        )}
                        <div className="text-xs space-y-1.5">
                          <div className="flex justify-between"><span className="text-slate-500">Presiding:</span><span className="font-semibold" style={{ color: theme.text }}>{presiding}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Conducting:</span><span className="font-semibold" style={{ color: theme.text }}>{conducting}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Opening Hymn:</span><span className="font-semibold" style={{ color: theme.text }}>{openingHymn}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Sacrament Hymn:</span><span className="font-semibold" style={{ color: theme.text }}>{sacramentHymn}</span></div>
                          {formData.special_music && (
                            <div className="p-2 rounded text-[11px] border" style={{ backgroundColor: theme.primaryLight, color: theme.text, borderColor: theme.border }}>
                              <strong>Special Music:</strong> {formData.special_music}
                            </div>
                          )}
                          {parsedSpeakers.length > 0 && (
                            <div className="space-y-1.5 pt-1.5 border-t" style={{ borderColor: theme.border }}>
                              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Speakers</div>
                              {parsedSpeakers.slice(0, 3).map((s, idx) => (
                                <div key={idx} className="p-2 rounded border border-slate-50" style={{ backgroundColor: theme.bg }}>
                                  <div className="font-semibold text-slate-800 text-[11px]">{s.name}</div>
                                  {s.topic && <div className="text-[10px] text-slate-500">Topic: {s.topic}</div>}
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex justify-between pt-1.5 border-t" style={{ borderColor: theme.border }}><span className="text-slate-500">Closing Hymn:</span><span className="font-semibold" style={{ color: theme.text }}>{closingHymn}</span></div>
                        </div>
                      </div>
                    )}

                    {/* Come Follow Me */}
                    {formData.come_follow_me && (
                      <div className="bg-white border p-4 rounded-2xl space-y-2" style={{ backgroundColor: theme.cardBg, borderColor: theme.border }}>
                        <div className="flex items-center gap-2 font-bold text-sm border-b pb-1.5" style={{ color: theme.primary, borderColor: theme.border }}>
                          <span>📖</span> Come, Follow Me Reading
                        </div>
                        <div className="text-xs font-semibold text-slate-800">{formData.come_follow_me}</div>
                      </div>
                    )}

                    {/* Birthdays */}
                    {formData.show_birthdays !== false && (formData.birthdays || []).length > 0 && (
                      <div className="border p-4 rounded-2xl space-y-2" style={{ backgroundColor: theme.accentLight, borderColor: theme.border }}>
                        <div className="flex items-center gap-2 font-bold text-sm border-b pb-1.5" style={{ color: theme.textAccent, borderColor: theme.border }}>
                          <span>🎂</span> Birthdays This Week
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(formData.birthdays || []).map((name, i) => (
                            <span key={i} className="inline-block bg-white border rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-2xs" style={{ color: theme.textAccent, borderColor: theme.border }}>
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>

                  {/* Right Column */}
                  <div className="space-y-4 flex flex-col justify-start">
                    
                    {/* Weekly Activities */}
                    {formData.show_activities !== false && (formData.activities || []).length > 0 && (
                      <div className="bg-white border p-5 rounded-2xl space-y-3" style={{ backgroundColor: theme.cardBg, borderColor: theme.border }}>
                        <div className="flex items-center gap-2 font-bold text-base border-b pb-2" style={{ color: theme.primary, borderColor: theme.border }}>
                          <span>📅</span> Weekly Activities
                        </div>
                        <div className="space-y-2">
                          {(formData.activities || []).filter(act => act.activity).map((act, idx) => (
                            <div key={idx} className="flex justify-between items-start text-xs border-b border-slate-100/60 pb-1.5 last:border-0 last:pb-0">
                              <div className="font-bold w-20 shrink-0" style={{ color: theme.textAccent }}>{act.day}</div>
                              <div className="flex-1 text-slate-800 font-semibold">
                                {act.activity || "None"}
                                {act.type && (
                                  <span className="ml-1.5 text-[8px] px-1 py-0.5 rounded font-extrabold uppercase bg-slate-100 text-slate-500 border border-slate-200 inline-block">
                                    {act.type}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-500 italic ml-2 shrink-0">{formatTime12h(act.time)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Bishopric message */}
                    {formData.show_bishopric !== false && formData.bishopric_message && (
                      <div className="bg-white border p-5 rounded-2xl space-y-2" style={{ backgroundColor: theme.cardBg, borderColor: theme.border }}>
                        <div className="flex items-center gap-2 font-bold text-sm border-b pb-1.5" style={{ color: theme.primary, borderColor: theme.border }}>
                          <span>✍️</span> Bishopric Message
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed italic line-clamp-6">
                          "{formData.bishopric_message}"
                        </p>
                      </div>
                    )}

                    {/* Upcoming events */}
                    {formData.show_upcoming !== false && (formData.upcoming_events || []).length > 0 && (
                      <div className="bg-white border p-5 rounded-2xl space-y-2" style={{ backgroundColor: theme.cardBg, borderColor: theme.border }}>
                        <div className="flex items-center gap-2 font-bold text-sm border-b pb-1.5" style={{ color: theme.primary, borderColor: theme.border }}>
                          <span>📣</span> Upcoming Events
                        </div>
                        <ul className="list-disc pl-4 text-xs text-slate-700 space-y-1 font-medium">
                          {(formData.upcoming_events || []).slice(0, 4).map((evt, i) => (
                            <li key={i} className="line-clamp-1">{evt}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                  </div>

                </div>

                {/* Footer */}
                <div className="mt-auto border-t pt-5 flex items-center justify-between text-slate-400" style={{ borderColor: theme.border }}>
                  <div className="text-[10px] max-w-2xl leading-relaxed">
                    Prepared for {unit.unit_name || "Ward"} members. Unofficial bulletin.
                  </div>
                  <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: theme.primary }}>
                    SM Planner
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

      {/* PDF PRINT VIEW */}
      {activeTab === "pdf" && activeWeek && (
        <div className="space-y-4">
          <Card>
            <CardBody className="flex justify-between items-center bg-slate-50 border-b">
              <div>
                <h4 className="font-semibold text-slate-800">Printable Layout</h4>
                <p className="text-xs text-slate-500 mt-1">
                  Format: <strong>{formData.pdf_layout === "bi-fold" ? "Booklet Bi-fold (2-Col Landscape Booklet)" : "Standard Outline (Landscape)"}</strong>
                </p>
              </div>
              <Button variant="primary" onClick={() => generatePDF("bulletin-pdf-print-area", `${unit.unit_name || "Ward"}_Bulletin_${formatDateShort(activeWeek.date)}`)}>
                Generate PDF
              </Button>
            </CardBody>
          </Card>

          {/* Landscape Paper Sheet Preview */}
          <div className="bg-white border rounded-xl shadow-sm p-8 overflow-x-auto flex justify-center">
            
            {formData.pdf_layout === "bi-fold" ? (
              /* BOOKLET BI-FOLD RENDER */
              <div
                id="bulletin-pdf-print-area"
                className="bg-white text-black p-8 border border-slate-300 shadow-lg font-serif grid grid-cols-2 gap-12"
                style={{ width: "11in", minWidth: "11in", minHeight: "8.5in", boxSizing: "border-box", fontSize: "11px", borderLeft: "1px dashed #cbd5e1" }}
              >
                {/* LEFT HALF (BACK PAGE / INSIDE LEFT) */}
                <div className="space-y-5 flex flex-col justify-between border-r border-dashed border-slate-200 pr-6">
                  <div className="space-y-5">
                    
                    {/* Bishopric Message */}
                    {formData.show_bishopric !== false && formData.bishopric_message && (
                      <div className="space-y-1.5 p-3.5 border rounded bg-slate-50" style={{ borderColor: theme.border }}>
                        <h4 className="font-bold text-[11px] uppercase tracking-wider border-b pb-1" style={{ color: theme.primary, borderColor: theme.border }}>Bishopric Message</h4>
                        <p className="italic text-slate-700 leading-relaxed font-sans text-xs">
                          "{formData.bishopric_message}"
                        </p>
                      </div>
                    )}

                    {/* Ward Focus */}
                    {formData.show_focus !== false && formData.ward_focus && (
                      <div className="space-y-1">
                        <h4 className="font-bold text-[11px] uppercase tracking-wider border-b pb-0.5" style={{ color: theme.primary, borderColor: theme.border }}>🎯 Ward Emphasis</h4>
                        <p className="text-slate-800 font-sans text-xs font-semibold">{formData.ward_focus}</p>
                      </div>
                    )}

                    {/* Welfare */}
                    {formData.show_welfare !== false && (formData.welfare_reminders || []).length > 0 && (
                      <div className="space-y-1.5">
                        <h4 className="font-bold text-[11px] uppercase tracking-wider border-b pb-0.5" style={{ color: theme.primary, borderColor: theme.border }}>🤲 Welfare & Service</h4>
                        <ul className="list-disc pl-4 space-y-0.5 font-sans text-xs text-slate-700">
                          {(formData.welfare_reminders || []).map((rem, i) => (
                            <li key={i}>{rem}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Temple & Family History */}
                    {formData.show_temple !== false && (
                      <div className="space-y-1.5">
                        <h4 className="font-bold text-[11px] uppercase tracking-wider border-b pb-0.5" style={{ color: theme.primary, borderColor: theme.border }}>🏛️ Temple & Family History</h4>
                        <div className="font-sans text-xs space-y-1 text-slate-700">
                          {formData.temple_trip_date && <div><strong>Temple Trip:</strong> {formData.temple_trip_date}</div>}
                          {formData.familysearch_tip && <div><strong>FS Tip:</strong> {formData.familysearch_tip}</div>}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* QR Resources */}
                  <div className="pt-4 border-t border-slate-200" style={{ borderColor: theme.border }}>
                    <div className="font-bold text-[10px] uppercase tracking-wider mb-1" style={{ color: theme.primary }}>Online Resources</div>
                    <div className="grid grid-cols-2 gap-1 text-[9px] font-sans text-slate-500">
                      {formData.qr_whatsapp && <div className="truncate">• WhatsApp: {formData.qr_whatsapp}</div>}
                      <div>• FamilySearch: {formData.qr_familysearch}</div>
                      <div>• Gospel Library: {formData.qr_gospel_library}</div>
                      {formData.qr_website && <div className="truncate">• Website: {formData.qr_website}</div>}
                    </div>
                    <div className="text-[8px] text-slate-400 mt-4 leading-normal font-sans">
                      This is an unofficial program prepared for local members of the {unit.unit_name || "Ward"}.
                    </div>
                  </div>
                </div>

                {/* RIGHT HALF (FRONT PAGE / INSIDE RIGHT) */}
                <div className="space-y-5 flex flex-col justify-between pl-2">
                  <div className="space-y-4">
                    
                    {/* Header Banner */}
                    <div className="text-center border-b pb-3" style={{ borderColor: theme.primary }}>
                      <h2 className="text-2xl font-bold uppercase tracking-wider text-slate-900 leading-none">{unit.unit_name || "Obantoko Ward"}</h2>
                      <p className="text-[10px] font-semibold uppercase tracking-widest mt-1.5" style={{ color: theme.textAccent }}>Weekly bulletin program</p>
                      <div className="text-xs font-semibold text-slate-600 mt-2 font-sans">
                        Sunday, {formatDateShort(activeWeek.date)}
                      </div>
                    </div>

                    {/* Sacrament Program */}
                    {formData.show_sacrament !== false && (
                      <div className="space-y-2 text-[11px]">
                        <h4 className="font-bold border-b pb-0.5 text-center" style={{ color: theme.primary, borderColor: theme.border }}>SACRAMENT MEETING PROGRAM</h4>
                        {formData.theme && <div className="italic text-center text-slate-600">Theme: "{formData.theme}"</div>}
                        <div className="space-y-1 font-sans text-xs">
                          <div className="flex justify-between"><span className="text-slate-500">Conducting Officer:</span><span className="font-semibold">{conducting}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Opening Hymn:</span><span className="font-semibold">{openingHymn}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Sacrament Hymn:</span><span className="font-semibold">{sacramentHymn}</span></div>
                          {formData.special_music && (
                            <div className="text-center italic font-semibold text-indigo-900 py-0.5">Special Music: {formData.special_music}</div>
                          )}
                          {parsedSpeakers.length > 0 && (
                            <div className="py-1 border-y border-dashed border-slate-200 my-1 space-y-0.5">
                              {parsedSpeakers.map((s, i) => (
                                <div key={i} className="flex justify-between">
                                  <span className="text-slate-500">Speaker:</span>
                                  <span className="font-semibold">{s.name} {s.topic ? `(${s.topic})` : ""}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex justify-between"><span className="text-slate-500">Closing Hymn:</span><span className="font-semibold">{closingHymn}</span></div>
                        </div>
                      </div>
                    )}

                    {formData.come_follow_me && (
                      <div className="mt-3 pt-2 border-t border-dashed border-slate-200" style={{ borderColor: theme.border }}>
                        <div className="text-[10px] uppercase font-bold text-slate-500">📖 Come, Follow Me Reading</div>
                        <div className="font-semibold text-[11px] text-slate-800 mt-0.5">{formData.come_follow_me}</div>
                      </div>
                    )}

                    {/* Weekly Activities */}
                    {formData.show_activities !== false && (formData.activities || []).length > 0 && (
                      <div className="space-y-1.5">
                        <h4 className="font-bold border-b pb-0.5" style={{ color: theme.primary, borderColor: theme.border }}>Weekly Activities</h4>
                        <table className="w-full text-left font-sans text-xs">
                          <tbody>
                            {(formData.activities || []).filter(act => act.activity).map((act, idx) => (
                              <tr key={idx} className="border-b border-slate-100 last:border-0">
                                <td className="py-0.5 w-16 font-bold" style={{ color: theme.textAccent }}>{act.day}</td>
                                <td className="py-0.5 font-medium text-slate-800">
                                  {act.activity}
                                  {act.type && (
                                    <span className="ml-1 text-[7px] px-0.5 py-px rounded font-extrabold uppercase bg-slate-100 text-slate-600 border border-slate-200 inline-block">
                                      {act.type}
                                    </span>
                                  )}
                                </td>
                                <td className="py-0.5 text-right text-slate-400 italic text-[10px]">{formatTime12h(act.time)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Birthdays */}
                    {formData.show_birthdays !== false && (formData.birthdays || []).length > 0 && (
                      <div className="space-y-1">
                        <h4 className="font-bold border-b pb-0.5" style={{ color: theme.primary, borderColor: theme.border }}>🎂 Birthdays This Week</h4>
                        <div className="text-xs font-semibold" style={{ color: theme.textAccent }}>
                          {(formData.birthdays || []).join(", ")}
                        </div>
                      </div>
                    )}

                  </div>

                  {/* Upcoming events */}
                  {formData.show_upcoming !== false && (formData.upcoming_events || []).length > 0 && (
                    <div className="border-t pt-3" style={{ borderColor: theme.border }}>
                      <h4 className="font-bold text-[10px] uppercase tracking-wider mb-1" style={{ color: theme.primary }}>Upcoming Events</h4>
                      <ul className="list-disc pl-4 space-y-0.5 font-sans text-xs text-slate-700">
                        {(formData.upcoming_events || []).slice(0, 3).map((evt, i) => (
                          <li key={i}>{evt}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

              </div>
            ) : (
              /* STANDARD LANDSCAPE RENDER */
              <div
                id="bulletin-pdf-print-area"
                className="bg-white text-black p-10 border shadow-lg font-serif"
                style={{ width: "11in", minWidth: "11in", minHeight: "8.5in", boxSizing: "border-box", backgroundColor: theme.bg, color: theme.text, borderColor: theme.border }}
              >
                {/* PDF Header */}
                <div className="text-center border-b-2 pb-4 mb-6" style={{ borderColor: theme.primary }}>
                  <h1 className="text-3xl font-bold tracking-wide uppercase" style={{ color: theme.primary }}>{unit.unit_name || "Obantoko Ward"}</h1>
                  <p className="text-sm font-semibold tracking-widest uppercase mt-1" style={{ color: theme.textAccent }}>Weekly Ward Bulletin</p>
                  <div className="mt-2 text-xs font-medium text-slate-500">
                    Sunday, {formatDateShort(activeWeek.date)} — Prepared for Ward Members
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-8 text-[12px] leading-relaxed">
                  {/* Left Side */}
                  <div className="space-y-6">
                    {/* Sacrament Details */}
                    {formData.show_sacrament !== false && (
                      <div className="space-y-3">
                        <h3 className="font-bold text-sm border-b pb-1" style={{ color: theme.primary, borderColor: theme.border }}>SACRAMENT MEETING PROGRAM</h3>
                        {formData.theme && <div className="italic text-slate-650">Theme: "{formData.theme}"</div>}
                        <table className="w-full">
                          <tbody className="divide-y divide-slate-100" style={{ borderColor: theme.border }}>
                            <tr><td className="py-1 text-slate-500">Presiding</td><td className="py-1 text-right font-medium">{presiding}</td></tr>
                            <tr><td className="py-1 text-slate-500">Conducting</td><td className="py-1 text-right font-medium">{conducting}</td></tr>
                            <tr><td className="py-1 text-slate-500">Opening Hymn</td><td className="py-1 text-right font-medium">{openingHymn}</td></tr>
                            <tr><td className="py-1 text-slate-500">Sacrament Hymn</td><td className="py-1 text-right font-medium">{sacramentHymn}</td></tr>
                            {formData.special_music && (
                              <tr><td className="py-1 text-slate-500">Special Music</td><td className="py-1 text-right font-medium">{formData.special_music}</td></tr>
                            )}
                            {parsedSpeakers.map((s, idx) => (
                              <tr key={idx}>
                                <td className="py-1 text-slate-500">Speaker {idx + 1}</td>
                                <td className="py-1 text-right font-medium">{s.name} {s.topic ? `(${s.topic})` : ""}</td>
                              </tr>
                            ))}
                            <tr><td className="py-1 text-slate-500">Closing Hymn</td><td className="py-1 text-right font-medium">{closingHymn}</td></tr>
                            <tr><td className="py-1 text-slate-500">Opening Prayer</td><td className="py-1 text-right font-medium">{openingPrayer}</td></tr>
                            <tr><td className="py-1 text-slate-500">Closing Prayer</td><td className="py-1 text-right font-medium">{closingPrayer}</td></tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Come Follow Me Section */}
                    {formData.come_follow_me && (
                      <div className="space-y-1.5 pt-3 border-t" style={{ borderColor: theme.border }}>
                        <h3 className="font-bold text-xs uppercase tracking-wider font-sans" style={{ color: theme.primary }}>📖 Come, Follow Me Reading</h3>
                        <p className="font-semibold text-slate-800 text-xs font-sans">
                          {formData.come_follow_me}
                        </p>
                      </div>
                    )}

                    {/* Birthdays */}
                    {formData.show_birthdays !== false && (formData.birthdays || []).length > 0 && (
                      <div className="space-y-2">
                        <h3 className="font-bold text-sm border-b pb-1" style={{ color: theme.primary, borderColor: theme.border }}>🎂 BIRTHDAYS THIS WEEK</h3>
                        <p className="font-medium font-sans text-xs" style={{ color: theme.textAccent }}>
                          {(formData.birthdays || []).join(", ")}
                        </p>
                      </div>
                    )}

                    {/* Bishopric Message */}
                    {formData.show_bishopric !== false && formData.bishopric_message && (
                      <div className="space-y-2 p-4 border rounded" style={{ backgroundColor: theme.primaryLight, borderColor: theme.border }}>
                        <h3 className="font-bold text-xs border-b pb-1" style={{ color: theme.primary, borderColor: theme.border }}>BISHOPRIC MESSAGE</h3>
                        <p className="italic text-slate-800 leading-relaxed font-sans text-xs">
                          "{formData.bishopric_message}"
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Right Side */}
                  <div className="space-y-6">
                    {/* Weekly Activities */}
                    {formData.show_activities !== false && (formData.activities || []).length > 0 && (
                      <div className="space-y-3">
                        <h3 className="font-bold text-sm border-b pb-1" style={{ color: theme.primary, borderColor: theme.border }}>WEEKLY ACTIVITIES</h3>
                        <table className="w-full">
                          <tbody>
                            {(formData.activities || []).filter(act => act.activity).map((act, idx) => (
                              <tr key={idx} className="border-b" style={{ borderColor: theme.border }}>
                                <td className="py-1 w-24 font-bold" style={{ color: theme.textAccent }}>{act.day}</td>
                                <td className="py-1 font-medium">
                                  {act.activity || "None scheduled"}
                                  {act.type && (
                                    <span className="ml-1.5 text-[8px] px-1 py-0.5 rounded font-extrabold uppercase bg-slate-100 text-slate-500 border border-slate-200 inline-block">
                                      {act.type}
                                    </span>
                                  )}
                                </td>
                                <td className="py-1 w-28 text-right text-slate-500 text-xs italic">{formatTime12h(act.time)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Missionary Corner */}
                    {formData.show_missionary !== false && (
                      <div className="space-y-2">
                        <h3 className="font-bold text-sm border-b pb-1" style={{ color: theme.primary, borderColor: theme.border }}>🌍 MISSIONARY CORNER</h3>
                        {(formData.missionaries || []).length > 0 && (
                          <div>Full-Time Missionaries: <span className="font-medium" style={{ color: theme.text }}>{(formData.missionaries || []).join(", ")}</span></div>
                        )}
                        {formData.scripture_of_the_week && (
                          <div>Scripture of the Week: <span className="italic">"{formData.scripture_of_the_week}"</span></div>
                        )}
                        {formData.missionary_challenge && (
                          <div>Challenge: <span className="font-medium" style={{ color: theme.textAccent }}>{formData.missionary_challenge}</span></div>
                        )}
                      </div>
                    )}

                    {/* Welfare & Upcoming events */}
                    {formData.show_upcoming !== false && (formData.upcoming_events || []).length > 0 && (
                      <div className="space-y-2">
                        <h3 className="font-bold text-sm border-b pb-1" style={{ color: theme.primary, borderColor: theme.border }}>📣 UPCOMING EVENTS</h3>
                        <ul className="list-disc pl-4 space-y-1">
                          {(formData.upcoming_events || []).map((evt, i) => (
                            <li key={i}>{evt}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Welfare */}
                    {formData.show_welfare !== false && (formData.welfare_reminders || []).length > 0 && (
                      <div className="space-y-2">
                        <h3 className="font-bold text-sm border-b pb-1" style={{ color: theme.primary, borderColor: theme.border }}>🤲 WELFARE REMINDERS</h3>
                        <ul className="list-disc pl-4 space-y-1">
                          {(formData.welfare_reminders || []).map((rem, i) => (
                            <li key={i}>{rem}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* QR Codes Section */}
                    {formData.show_qr !== false && (
                      <div className="space-y-2 pt-4 border-t" style={{ borderColor: theme.border }}>
                        <h3 className="font-bold text-xs tracking-wider uppercase" style={{ color: theme.primary }}>Online Resources & Links</h3>
                        <div className="flex gap-2 flex-wrap text-[10px] text-slate-650 font-sans">
                          {formData.qr_whatsapp && <div>• WhatsApp Group: <span className="underline">{formData.qr_whatsapp}</span></div>}
                          {formData.qr_website && <div>• Ward Website: <span className="underline">{formData.qr_website}</span></div>}
                          <div>• FamilySearch: <span className="underline">{formData.qr_familysearch}</span></div>
                          <div>• Gospel Library: <span className="underline">{formData.qr_gospel_library}</span></div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* PDF Footer */}
                <div className="text-center text-[9px] text-slate-400 border-t pt-4 mt-8 font-sans" style={{ borderColor: theme.border }}>
                  This is prepared as a weekly informational sheet for local ward members. It is not an official publication of The Church of Jesus Christ of Latter-day Saints.
                </div>
              </div>
            )}
            
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
