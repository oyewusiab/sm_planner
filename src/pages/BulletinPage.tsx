import { useState, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import type { Bulletin, BulletinActivity, Member, Planner, UnitSettings, User, CalendarActivity, OtherChurchProgram } from "../types";
import { Button, Card, CardBody, CardHeader, CardTitle, Divider, EmptyState, Input, Label, Select, Textarea } from "../components/ui";
import { ids, updateDB, useTable } from "../utils/storage";
import { formatDateShort, yyyyMmToLabel, formatTime12h } from "../utils/date";
import { generatePDF } from "../utils/pdf";
import html2canvas from "html2canvas-pro";

// Helper to determine if a member's birthday falls in the week (Sunday to Saturday)
function getBirthdaysForWeek(members: Member[], sundayDateStr: string): string[] {
  if (!sundayDateStr) return [];
  const parts = sundayDateStr.split("-");
  const y = parseInt(parts[0], 10);
  const mVal = parseInt(parts[1], 10) - 1;
  const dVal = parseInt(parts[2], 10);
  const sunday = new Date(Date.UTC(y, mVal, dVal));
  
  const weekDates: { month: number; day: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setUTCDate(sunday.getUTCDate() - 6 + i);
    weekDates.push({ month: d.getUTCMonth() + 1, day: d.getUTCDate() });
  }

  const parseMonths = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const matches: { name: string; mDay: number; prefix: string }[] = [];

  for (const m of members) {
    if (!m.birth_date) continue;
    
    const clean = m.birth_date.trim();
    let mMonth = 0;
    let mDay = 0;

    const mmmMatch = clean.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,})([-/\s](\d{4}))?$/);
    if (mmmMatch) {
      const day = parseInt(mmmMatch[1], 10);
      const monthStr = mmmMatch[2].toLowerCase().substring(0, 3);
      const monthIdx = parseMonths.indexOf(monthStr);
      if (monthIdx !== -1 && day >= 1 && day <= 31) {
        mMonth = monthIdx + 1;
        mDay = day;
      }
    }

    if (!mMonth) {
      const yyyymmddMatch = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
      if (yyyymmddMatch) {
        mMonth = parseInt(yyyymmddMatch[2], 10);
        mDay = parseInt(yyyymmddMatch[3], 10);
      }
    }

    if (!mMonth) {
      const twoPartsMatch = clean.match(/^(\d{1,2})[-/](\d{1,2})$/);
      if (twoPartsMatch) {
        const p1 = parseInt(twoPartsMatch[1], 10);
        const p2 = parseInt(twoPartsMatch[2], 10);
        if (p1 >= 1 && p1 <= 31 && p2 >= 1 && p2 <= 31) {
          if (p1 > 12) {
            mMonth = p2;
            mDay = p1;
          } else if (p2 > 12) {
            mMonth = p1;
            mDay = p2;
          } else {
            mMonth = p2;
            mDay = p1;
          }
        }
      }
    }

    if (!mMonth) {
      const parsed = Date.parse(clean);
      if (!isNaN(parsed)) {
        const d = new Date(parsed);
        mMonth = d.getMonth() + 1;
        mDay = d.getDate();
      }
    }

    if (mMonth && mDay && !isNaN(mMonth) && !isNaN(mDay)) {
      const isBirthdayThisWeek = weekDates.some(wd => wd.month === mMonth && wd.day === mDay);
      if (isBirthdayThisWeek) {
        const gender = (m.gender || "").trim().toUpperCase();
        const prefix = gender === "M" ? "Brother " : gender === "F" ? "Sister " : "";
        matches.push({ name: m.name, mDay, prefix });
      }
    }
  }

  // Sort by day number ascending (e.g. 13, 14, 15)
  matches.sort((a, b) => a.mDay - b.mDay);

  return matches.map(item => `${item.prefix}${item.name} (${item.mDay})`);
}

function formatMemberNameWithPrefix(nameStr: string, membersList: Member[]): string {
  if (!nameStr) return "";
  const nameTrimmed = nameStr.trim();
  const upper = nameTrimmed.toUpperCase();
  if (
    upper.startsWith("BROTHER") ||
    upper.startsWith("SISTER") ||
    upper.startsWith("BRO.") ||
    upper.startsWith("SIS.") ||
    upper.startsWith("ELDER") ||
    upper.startsWith("PRESIDENT") ||
    upper.startsWith("PRES.") ||
    upper.startsWith("BISHOP")
  ) {
    return nameTrimmed;
  }
  const normalizedSearch = nameTrimmed.toLowerCase().replace(/\s+/g, "");
  const found = membersList.find(m => {
    const mName = m.name.toLowerCase().replace(/\s+/g, "");
    return mName === normalizedSearch || mName.includes(normalizedSearch) || normalizedSearch.includes(mName);
  });
  if (found) {
    const gender = (found.gender || "").trim().toUpperCase();
    if (gender === "M") {
      return `Brother ${nameTrimmed}`;
    } else if (gender === "F") {
      return `Sister ${nameTrimmed}`;
    }
  }
  return nameTrimmed;
}

const DEFAULT_ACTIVITIES: BulletinActivity[] = [
  { day: "Monday", activity: "Family Home Evening", time: "7:00 PM", type: "Ward", id: "def-mon" },
  { day: "Tuesday", activity: "Institute / Seminary", time: "6:00 PM", type: "Ward", id: "def-tue" },
  { day: "Wednesday", activity: "Self-Reliance Class", time: "6:30 PM", type: "Ward", id: "def-wed" },
  { day: "Thursday", activity: "Choir Practice", time: "7:00 PM", type: "Ward", id: "def-thu" },
  { day: "Friday", activity: "Youth Activity", time: "6:00 PM", type: "Ward", id: "def-fri" },
  { day: "Saturday", activity: "Building Cleaning / Baptisms", time: "8:00 AM", type: "Ward", id: "def-sat" },
  { day: "Sunday", activity: "Sacrament Meeting", time: "9:00 AM", type: "Ward", id: "def-sun" },
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

function getWeekRangeLabel(sundayStr: string) {
  if (!sundayStr) return "";
  const sunday = new Date(sundayStr);
  const monday = new Date(sunday);
  monday.setDate(sunday.getDate() - 6);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  
  const monDay = monday.getDate();
  const monMon = months[monday.getMonth()];
  const monYr = monday.getFullYear();

  const sunDay = sunday.getDate();
  const sunMon = months[sunday.getMonth()];
  const sunYr = sunday.getFullYear();

  if (monMon === sunMon && monYr === sunYr) {
    return `${monDay}-${sunDay} ${sunMon} ${sunYr}`;
  } else if (monYr === sunYr) {
    return `${monDay} ${monMon} - ${sunDay} ${sunMon} ${sunYr}`;
  } else {
    return `${monDay} ${monMon} ${monYr} - ${sunDay} ${sunMon} ${sunYr}`;
  }
}

function formatActivityName(str: string) {
  if (!str) return "";
  if (str === str.toUpperCase()) {
    return str
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  return str;
}

// Filter submitted planners
const activePlanners = useMemo(() => {
  return planners.filter(p => p.state === "SUBMITTED");
}, [planners]);

const allWeeks = useMemo(() => {
  const list: { week_id: string; date: string; planner_id: string; weekObj: any }[] = [];
  activePlanners.forEach(p => {
    (p.weeks || []).forEach(w => {
      list.push({
        week_id: w.week_id,
        date: w.date,
        planner_id: p.planner_id,
        weekObj: w
      });
    });
  });
  return list.sort((a, b) => b.date.localeCompare(a.date));
}, [activePlanners]);

  const [selectedPlannerId, setSelectedPlannerId] = useState<string>(() => {
    return localStorage.getItem("shared_selected_planner_id") || "";
  });
  const [selectedWeekId, setSelectedWeekId] = useState<string>(() => {
    return localStorage.getItem("shared_selected_week_id") || "";
  });
  const [activeTab, setActiveTab] = useState<"edit" | "web" | "whatsapp" | "pdf">("edit");
  const [downloadingImage, setDownloadingImage] = useState(false);
  const [birthdaySearch, setBirthdaySearch] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const [pdfScale, setPdfScale] = useState(1);
  const pdfContentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (formData.pdf_layout === "standard-2page" || formData.pdf_layout === "bi-fold") {
      setPdfScale(1);
      return;
    }
    const container = pdfContentRef.current;
    if (!container) return;

    // Reset styles to measure original scrollHeight
    container.style.transform = "none";
    container.style.width = "100%";
    container.style.height = "100%";

    const runMeasure = () => {
      const scrollH = container.scrollHeight;
      const parent = container.parentElement;
      if (!parent) return;
      const parentH = parent.clientHeight || 793;

      if (scrollH > parentH) {
        const newScale = (parentH - 4) / scrollH;
        setPdfScale(Math.max(0.4, Math.min(1, newScale)));
      } else {
        setPdfScale(1);
      }
    };

    const timer = setTimeout(runMeasure, 50);
    return () => clearTimeout(timer);
  }, [formData]);

  useEffect(() => {
    setIsEditing(false);
  }, [selectedWeekId]);

  const handleOpenEditBulletin = () => {
    if (currentBulletin) {
      setFormData(currentBulletin);
      setIsEditing(true);
    }
  };

  const handleDeleteBulletin = () => {
    if (!window.confirm("Are you sure you want to delete this bulletin? This action cannot be undone.")) return;
    updateDB((db0) => {
      const list = (db0.BULLETINS || []).filter(b => b.week_id !== selectedWeekId);
      return { ...db0, BULLETINS: list };
    });
    onChanged();
    setIsEditing(false);
  };

  const handleCreateBulletin = () => {
    if (!activeWeek) return;
    const defaultBirthdays = getBirthdaysForWeek(members, activeWeek.date);
    const sundayISO = activeWeek.date;
    const parts = sundayISO.split("-");
    const y = parseInt(parts[0], 10);
    const mVal = parseInt(parts[1], 10) - 1;
    const dVal = parseInt(parts[2], 10);
    const sunday = new Date(Date.UTC(y, mVal, dVal));

    const monday = new Date(sunday);
    monday.setUTCDate(sunday.getUTCDate() - 6);
    const startISO = monday.toISOString().split("T")[0];
    
    const thirtyDaysLater = new Date(sunday);
    thirtyDaysLater.setUTCDate(sunday.getUTCDate() + 30);
    const endISO = thirtyDaysLater.toISOString().split("T")[0];

    const upcomingList: { label: string; date: string }[] = [];
    activities.forEach(a => {
      if (a.activity && a.activity.trim() && a.date >= startISO && a.date <= endISO) {
        upcomingList.push({ label: `${a.activity} (${a.organisation})`, date: a.date });
      }
    });
    otherPrograms.forEach(p => {
      if (p.program && p.program.trim() && p.date >= startISO && p.date <= endISO) {
        upcomingList.push({ label: `${p.program} (${p.organisation})`, date: p.date });
      }
    });
    upcomingList.sort((a, b) => a.date.localeCompare(b.date));
    const upcoming = upcomingList.map(item => `${formatDateShort(item.date)} — ${item.label}`);

    // Carry forward recurring activities from the most recent bulletin
    const sortedBulletins = [...bulletins].sort((a, b) => (b.created_date || "").localeCompare(a.created_date || ""));
    const lastBulletin = sortedBulletins[0];
    const recurringActivities = lastBulletin ? (lastBulletin.activities || []).filter(a => a.is_recurring) : [];

    const activitiesList: BulletinActivity[] = [];
    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    
    daysOfWeek.forEach((dayName, idx) => {
      const dayRecs = recurringActivities.filter(r => r.day === dayName);
      if (dayRecs.length > 0) {
        activitiesList.push(...dayRecs.map(r => ({ ...r, id: r.id || Math.random().toString(36).substring(2) })));
      } else {
        activitiesList.push({ ...DEFAULT_ACTIVITIES[idx] });
      }
    });

    setFormData({
      theme: "",
      special_music: "",
      come_follow_me: "",
      cfm_reading: "",
      cfm_theme: "",
      cfm_discussion_question: "",
      cfm_family_challenge: "",
      cfm_study_tip: "",
      cleaning_group: "",
      cleaning_date: "",
      cleaning_time: "",
      cleaning_instructions: "",
      activities: activitiesList,
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
      show_cleaning: true,
      color_theme: "navy",
      pdf_layout: "standard"
    });
    setIsEditing(true);
  };

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
    const savedWeekId = localStorage.getItem("shared_selected_week_id");
    if (savedWeekId && allWeeks.some(w => w.week_id === savedWeekId)) {
      setSelectedWeekId(savedWeekId);
      const wMeta = allWeeks.find(x => x.week_id === savedWeekId);
      if (wMeta) setSelectedPlannerId(wMeta.planner_id);
    } else if (allWeeks.length > 0) {
      setSelectedWeekId(allWeeks[0].week_id);
      setSelectedPlannerId(allWeeks[0].planner_id);
    }
  }, [allWeeks]);

  const activeWeekMeta = useMemo(() => {
    return allWeeks.find(w => w.week_id === selectedWeekId) || null;
  }, [allWeeks, selectedWeekId]);

  const activeWeek = useMemo(() => {
    return activeWeekMeta?.weekObj || null;
  }, [activeWeekMeta]);

  const activePlanner = useMemo(() => {
    if (!activeWeekMeta) return null;
    return activePlanners.find(p => p.planner_id === activeWeekMeta.planner_id) || null;
  }, [activePlanners, activeWeekMeta]);


  const currentBulletin = useMemo(() => {
    if (!selectedWeekId) return null;
    return bulletins.find(b => b.week_id === selectedWeekId) || null;
  }, [bulletins, selectedWeekId]);

  const [formData, setFormData] = useState<Partial<Bulletin>>({});

  // Initialize form state when selection changes
  useEffect(() => {
    if (!selectedWeekId || !activeWeek) return;

    if (currentBulletin) {
      const liveBirthdays = getBirthdaysForWeek(members, activeWeek.date);
      setFormData({
        ...currentBulletin,
        birthdays: liveBirthdays
      });
    } else {
      const defaultBirthdays = getBirthdaysForWeek(members, activeWeek.date);
      const sundayISO = activeWeek.date;
      const parts = sundayISO.split("-");
      const y = parseInt(parts[0], 10);
      const mVal = parseInt(parts[1], 10) - 1;
      const dVal = parseInt(parts[2], 10);
      const sunday = new Date(Date.UTC(y, mVal, dVal));

      const monday = new Date(sunday);
      monday.setUTCDate(sunday.getUTCDate() - 6);
      const startISO = monday.toISOString().split("T")[0];
      
      const thirtyDaysLater = new Date(sunday);
      thirtyDaysLater.setUTCDate(sunday.getUTCDate() + 30);
      const endISO = thirtyDaysLater.toISOString().split("T")[0];

      const upcomingList: { label: string; date: string }[] = [];
      activities.forEach(a => {
        if (a.activity && a.activity.trim() && a.date >= startISO && a.date <= endISO) {
          upcomingList.push({ label: `${a.activity} (${a.organisation})`, date: a.date });
        }
      });
      otherPrograms.forEach(p => {
        if (p.program && p.program.trim() && p.date >= startISO && p.date <= endISO) {
          upcomingList.push({ label: `${p.program} (${p.organisation})`, date: p.date });
        }
      });
      upcomingList.sort((a, b) => a.date.localeCompare(b.date));

      const upcoming = upcomingList.map(item => `${formatDateShort(item.date)} — ${item.label}`);

      setFormData({
        theme: "",
        special_music: "",
        come_follow_me: "",
        cfm_reading: "",
        cfm_theme: "",
        cfm_discussion_question: "",
        cfm_family_challenge: "",
        cfm_study_tip: "",
        cleaning_group: "",
        cleaning_date: "",
        cleaning_time: "",
        cleaning_instructions: "",
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
        show_cleaning: true,
        color_theme: "navy",
        pdf_layout: "standard"
      });
    }
  }, [currentBulletin, selectedWeekId, activeWeek, members]);

  // Keep birthdays list in sync with directory changes dynamically
  useEffect(() => {
    if (!activeWeek) return;
    const liveBirthdays = getBirthdaysForWeek(members, activeWeek.date);
    setFormData(prev => {
      const current = prev.birthdays || [];
      if (JSON.stringify(current) !== JSON.stringify(liveBirthdays)) {
        return { ...prev, birthdays: liveBirthdays };
      }
      return prev;
    });
  }, [members, activeWeek]);

  // Keep upcoming events list in sync with calendar changes dynamically
  useEffect(() => {
    if (!activeWeek) return;
    const sundayISO = activeWeek.date;
    const parts = sundayISO.split("-");
    const y = parseInt(parts[0], 10);
    const mVal = parseInt(parts[1], 10) - 1;
    const dVal = parseInt(parts[2], 10);
    const sunday = new Date(Date.UTC(y, mVal, dVal));

    const monday = new Date(sunday);
    monday.setUTCDate(sunday.getUTCDate() - 6);
    const startISO = monday.toISOString().split("T")[0];
    
    const thirtyDaysLater = new Date(sunday);
    thirtyDaysLater.setUTCDate(sunday.getUTCDate() + 30);
    const endISO = thirtyDaysLater.toISOString().split("T")[0];

    const upcomingList: { label: string; date: string }[] = [];
    activities.forEach(a => {
      if (a.activity && a.activity.trim() && a.date >= startISO && a.date <= endISO) {
        upcomingList.push({ label: `${a.activity} (${a.organisation})`, date: a.date });
      }
    });
    otherPrograms.forEach(p => {
      if (p.program && p.program.trim() && p.date >= startISO && p.date <= endISO) {
        upcomingList.push({ label: `${p.program} (${p.organisation})`, date: p.date });
      }
    });
    upcomingList.sort((a, b) => a.date.localeCompare(b.date));
    const liveUpcoming = upcomingList.map(item => `${formatDateShort(item.date)} — ${item.label}`);

    setFormData(prev => {
      const current = prev.upcoming_events || [];
      if (JSON.stringify(current) !== JSON.stringify(liveUpcoming)) {
        return { ...prev, upcoming_events: liveUpcoming };
      }
      return prev;
    });
  }, [activities, otherPrograms, activeWeek]);

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
      come_follow_me: formData.come_follow_me || "",
      cfm_reading: formData.cfm_reading || "",
      cfm_theme: formData.cfm_theme || "",
      cfm_discussion_question: formData.cfm_discussion_question || "",
      cfm_family_challenge: formData.cfm_family_challenge || "",
      cfm_study_tip: formData.cfm_study_tip || "",
      cleaning_group: formData.cleaning_group || "",
      cleaning_date: formData.cleaning_date || "",
      cleaning_time: formData.cleaning_time || "",
      cleaning_instructions: formData.cleaning_instructions || "",
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
      show_cleaning: formData.show_cleaning !== false,
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
    list.push({ day: "Sunday", activity: "", time: "12:00 PM", type: "Ward", id: Math.random().toString(36).substring(2) });
    handleFieldChange("activities", list);
  };

  const handleRemoveActivityRow = (index: number) => {
    const list = [...(formData.activities || [])];
    list.splice(index, 1);
    handleFieldChange("activities", list);
  };

  const handleMoveActivity = (index: number, direction: -1 | 1) => {
    const list = [...(formData.activities || [])];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const temp = list[index];
    list[index] = list[targetIndex];
    list[targetIndex] = temp;
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
    const parts = activeWeek.date.split("-");
    const y = parseInt(parts[0], 10);
    const mVal = parseInt(parts[1], 10) - 1;
    const dVal = parseInt(parts[2], 10);
    const sunday = new Date(Date.UTC(y, mVal, dVal));
    const importedList: BulletinActivity[] = [];

    // Find last bulletin recurring activities to carry forward
    const sortedBulletins = [...bulletins].sort((a, b) => (b.created_date || "").localeCompare(a.created_date || ""));
    const lastBulletin = sortedBulletins[0];
    const recurringActivities = lastBulletin ? (lastBulletin.activities || []).filter(a => a.is_recurring) : [];

    const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    for (let idx = 0; idx < 7; idx++) {
      const d = new Date(sunday);
      d.setUTCDate(sunday.getUTCDate() - 6 + idx);
      const isoDate = d.toISOString().split("T")[0];
      const dayName = daysOfWeek[idx];

      const dayEvents = activities.filter(a => a.date === isoDate);
      const dayPrograms = otherPrograms.filter(p => p.date === isoDate);
      
      // Fetch recurring activities for this day
      const dayRecs = recurringActivities.filter(r => r.day === dayName);

      if (dayEvents.length === 0 && dayPrograms.length === 0) {
        if (dayRecs.length > 0) {
          importedList.push(...dayRecs.map(r => ({ ...r, id: r.id || Math.random().toString(36).substring(2) })));
        } else {
          const defaultAct = DEFAULT_ACTIVITIES[idx];
          importedList.push({ 
            day: dayName, 
            activity: defaultAct.activity, 
            time: defaultAct.time,
            type: "Ward",
            id: `def-${dayName.toLowerCase().substring(0, 3)}`
          });
        }
      } else {
        // Carry forward recurring activities
        if (dayRecs.length > 0) {
          importedList.push(...dayRecs.map(r => ({ ...r, id: r.id || Math.random().toString(36).substring(2) })));
        }

        dayEvents.forEach(evt => {
          const isStake = evt.organisation?.toLowerCase().includes("stake");
          importedList.push({
            day: dayName,
            activity: `${evt.organisation}: ${evt.activity}`,
            time: evt.time || "12:00 PM",
            type: isStake ? "Stake" : "Ward",
            id: Math.random().toString(36).substring(2)
          });
        });

        dayPrograms.forEach(prog => {
          if (prog.program && prog.program.trim()) {
            const isStake = prog.organisation?.toLowerCase().includes("stake");
            importedList.push({
              day: dayName,
              activity: `${prog.organisation}: ${prog.program}`,
              time: "12:00 PM",
              type: isStake ? "Stake" : "Ward",
              id: Math.random().toString(36).substring(2)
            });
          }
        });
      }
    }

    handleFieldChange("activities", importedList);
    alert("Activities auto-filled from calendar! Recurring activities have been preserved.");
  };

  // Pulling Suggested Upcoming Events
  const suggestedEvents = useMemo(() => {
    if (!activeWeek) return [];
    const parts = activeWeek.date.split("-");
    const y = parseInt(parts[0], 10);
    const mVal = parseInt(parts[1], 10) - 1;
    const dVal = parseInt(parts[2], 10);
    const sunday = new Date(Date.UTC(y, mVal, dVal));
    
    const monday = new Date(sunday);
    monday.setUTCDate(sunday.getUTCDate() - 6);
    
    const thirtyDaysLater = new Date(sunday);
    thirtyDaysLater.setUTCDate(sunday.getUTCDate() + 30);

    const startISO = monday.toISOString().split("T")[0];
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
        onclone: (clonedDoc) => {
          const clonedEl = clonedDoc.getElementById("bulletin-whatsapp-card");
          if (clonedEl) {
            clonedEl.style.transform = "none";
            clonedEl.style.position = "static";
            clonedEl.style.margin = "0";
            if (clonedEl.parentElement) {
              clonedEl.parentElement.style.transform = "none";
              clonedEl.parentElement.style.width = "1080px";
              clonedEl.parentElement.style.height = "1350px";
            }
          }
        }
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
              <Label className="text-slate-600 font-semibold mb-1 block">Select Week / Bulletin</Label>
              <Select value={selectedWeekId} onChange={e => {
                const wId = e.target.value;
                setSelectedWeekId(wId);
                localStorage.setItem("shared_selected_week_id", wId);
                const found = allWeeks.find(x => x.week_id === wId);
                if (found) {
                  setSelectedPlannerId(found.planner_id);
                  localStorage.setItem("shared_selected_planner_id", found.planner_id);
                }
              }} className="w-64">
                {allWeeks.map(w => (
                  <option key={w.week_id} value={w.week_id}>
                    {getWeekRangeLabel(w.date)} Bulletin
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label className="text-slate-600 font-semibold mb-1 block">3. Color Theme</Label>
              <Select value={formData.color_theme || "navy"} onChange={e => handleFieldChange("color_theme", e.target.value)} className="w-52">
                {Object.entries(THEMES).map(([k, v]) => (
                  <option key={k} value={k}>{v.name}</option>
                ))}
              </Select>
            </div>
          </div>
          {isEditing && (
            <div className="flex gap-2 font-sans text-xs">
              <Button variant="outline" onClick={() => setIsEditing(false)} className="h-9 font-semibold mr-2" icon="⬅️">
                Back to Bulletins
              </Button>
              <Button variant={activeTab === "edit" ? "primary" : "secondary"} onClick={() => setActiveTab("edit")} className="h-9 font-semibold">
                Edit Info
              </Button>
              <Button variant={activeTab === "web" ? "primary" : "secondary"} onClick={() => setActiveTab("web")} className="h-9 font-semibold">
                Web View
              </Button>
              <Button variant={activeTab === "whatsapp" ? "primary" : "secondary"} onClick={() => setActiveTab("whatsapp")} className="h-9 font-semibold">
                WhatsApp Card
              </Button>
              <Button variant={activeTab === "pdf" ? "primary" : "secondary"} onClick={() => setActiveTab("pdf")} className="h-9 font-semibold">
                Print / PDF
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      {selectedWeekId && activeWeek ? (
        activeWeek.meeting_type === "Stake Conference" || activeWeek.is_canceled || activeWeek.cancel_reason ? (
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
        ) : !isEditing ? (
          <div className="max-w-xl mx-auto mt-6">
            {currentBulletin ? (
              <Card className="border border-slate-200 shadow-sm p-6 bg-white">
                <CardBody className="space-y-4 text-center">
                  <div className="text-4xl">📄</div>
                  <h3 className="font-bold text-slate-800 text-lg">
                    {getWeekRangeLabel(activeWeek.date)} Bulletin
                  </h3>
                  <div className="text-xs text-slate-500">
                    <p>Created: {formatDateShort(currentBulletin.created_date || activeWeek.date)}</p>
                    <p>Last Updated: {currentBulletin.updated_date ? formatDateShort(currentBulletin.updated_date) : "N/A"}</p>
                  </div>
                  <div className="flex justify-center gap-3 pt-2">
                    <Button variant="primary" onClick={handleOpenEditBulletin} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold">
                      Open & Edit
                    </Button>
                    <Button variant="danger" onClick={handleDeleteBulletin} className="bg-red-600 hover:bg-red-700 text-white font-semibold">
                      Delete
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ) : (
              <EmptyState
                icon="📄"
                title="No Bulletin Created Yet"
                description="Click 'Create Bulletin' below to start preparing the weekly bulletin program for this week."
                action={
                  <Button onClick={handleCreateBulletin} className="bg-blue-600 text-white font-semibold">
                    Create Bulletin
                  </Button>
                }
              />
            )}
          </div>
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
                    </div>
                  )}
                </div>

                {/* Come, Follow Me Study */}
                <div className="pt-6 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-slate-900 text-base">Come, Follow Me Study</h3>
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input type="checkbox" checked={formData.show_focus !== false} onChange={e => handleFieldChange("show_focus", e.target.checked)} className="rounded" />
                      Show Section
                    </label>
                  </div>
                  {formData.show_focus !== false && (
                    <div className="bg-slate-50 p-4 rounded-lg space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Weekly Reading Block (Optional)</Label>
                          <Input
                            value={formData.cfm_reading || ""}
                            onChange={e => handleFieldChange("cfm_reading", e.target.value)}
                            placeholder="e.g. Helaman 1-6"
                          />
                        </div>
                        <div>
                          <Label>Weekly Study Theme (Optional)</Label>
                          <Input
                            value={formData.cfm_theme || ""}
                            onChange={e => handleFieldChange("cfm_theme", e.target.value)}
                            placeholder="e.g. 'Preserve in Your Remembrance'"
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Family Discussion Question (Optional)</Label>
                        <Input
                          value={formData.cfm_discussion_question || ""}
                          onChange={e => handleFieldChange("cfm_discussion_question", e.target.value)}
                          placeholder="e.g. How can we build our lives upon the rock of our Redeemer?"
                        />
                      </div>
                      <div>
                        <Label>Weekly Family Challenge (Optional)</Label>
                        <Input
                          value={formData.cfm_family_challenge || ""}
                          onChange={e => handleFieldChange("cfm_family_challenge", e.target.value)}
                          placeholder="e.g. Read Helaman 5:12 together and draw a picture of a house on a rock."
                        />
                      </div>
                      <div>
                        <Label>Weekly Study Tip (Optional)</Label>
                        <Input
                          value={formData.cfm_study_tip || ""}
                          onChange={e => handleFieldChange("cfm_study_tip", e.target.value)}
                          placeholder="e.g. Mark every reference to 'remember' in this week's reading."
                        />
                      </div>
                      <div>
                        <Label>Additional Study Details / Scripture Notes (Optional)</Label>
                        <Textarea
                          rows={3}
                          value={formData.come_follow_me || ""}
                          onChange={e => handleFieldChange("come_follow_me", e.target.value)}
                          placeholder="Type any additional scriptures, announcements, or custom text. Press enter for paragraphs."
                          className="w-full"
                        />
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
                            <th className="p-2 w-24 font-semibold text-center">Reoccurring</th>
                            <th className="p-2 w-28 font-semibold text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(formData.activities || []).map((act, index) => (
                            <tr key={act.id || index} className="border-t border-slate-200">
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
                                <input
                                  type="checkbox"
                                  checked={act.is_recurring === true}
                                  onChange={e => handleActivityCellChange(index, "is_recurring", e.target.checked)}
                                  className="rounded cursor-pointer"
                                />
                              </td>
                              <td className="p-2">
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    type="button"
                                    disabled={index === 0}
                                    onClick={() => handleMoveActivity(index, -1)}
                                    className="text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-semibold p-1"
                                    title="Move Up"
                                  >
                                    ⬆️
                                  </button>
                                  <button
                                    type="button"
                                    disabled={index === (formData.activities || []).length - 1}
                                    onClick={() => handleMoveActivity(index, 1)}
                                    className="text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-semibold p-1"
                                    title="Move Down"
                                  >
                                    ⬇️
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveActivityRow(index)}
                                    className="text-red-500 hover:text-red-700 text-sm p-1 ml-1"
                                    title="Remove"
                                  >
                                    🗑️
                                  </button>
                                </div>
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

                {/* 7. Chapel Cleaning Invitation */}
                <div className="pt-6 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-slate-900 text-base">7. Chapel Cleaning Invitation</h3>
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input type="checkbox" checked={formData.show_cleaning !== false} onChange={e => handleFieldChange("show_cleaning", e.target.checked)} className="rounded" />
                      Show Section
                    </label>
                  </div>
                  {formData.show_cleaning !== false && (
                    <div className="bg-slate-50 p-4 rounded-lg space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Assigned Group / Organization / Families</Label>
                          <Input
                            value={formData.cleaning_group || ""}
                            onChange={e => handleFieldChange("cleaning_group", e.target.value)}
                            placeholder="e.g. Elders Quorum & Relief Society District 1"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label>Cleaning Date</Label>
                            <Input
                              value={formData.cleaning_date || ""}
                              onChange={e => handleFieldChange("cleaning_date", e.target.value)}
                              placeholder="e.g. Saturday, July 18"
                            />
                          </div>
                          <div>
                            <Label>Cleaning Time</Label>
                            <Input
                              value={formData.cleaning_time || ""}
                              onChange={e => handleFieldChange("cleaning_time", e.target.value)}
                              placeholder="e.g. 8:00 AM"
                            />
                          </div>
                        </div>
                      </div>
                      <div>
                        <Label>Special Instructions / Focus Areas (Optional)</Label>
                        <Input
                          value={formData.cleaning_instructions || ""}
                          onChange={e => handleFieldChange("cleaning_instructions", e.target.value)}
                          placeholder="e.g. Focus will be sacrament hall. Supplies provided."
                        />
                      </div>
                    </div>
                  )}
                </div>

              </CardBody>
            </Card>
          </div>

          {/* Quick-import Sidebar */}
          <div className="space-y-6">
            
            {/* Automatically Generated Birthdays Card */}
            <Card>
              <CardHeader className="border-b pb-2">
                <CardTitle className="text-sm">🎂 Birthdays This Week</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                <div className="text-xs text-slate-500 font-sans">
                  Birthdays are automatically generated from the Member Directory for the week's Monday-to-Sunday range:
                </div>
                {(formData.birthdays || []).length === 0 ? (
                  <div className="text-center text-slate-400 text-xs italic py-4">No member birthdays this week.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(formData.birthdays || []).map((name, idx) => (
                      <span key={idx} className="bg-pink-50 border border-pink-200 text-pink-900 text-xs px-2.5 py-0.5 rounded-full font-medium inline-block">
                        {name}
                      </span>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-slate-400 font-sans italic border-t pt-2">
                  Tip: To show or hide this list on the printed bulletin, use the checkmark toggle in the editor sections.
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
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formData.show_cleaning !== false} onChange={e => handleFieldChange("show_cleaning", e.target.checked)} className="rounded" />Show Chapel Cleaning</label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formData.show_qr !== false} onChange={e => handleFieldChange("show_qr", e.target.checked)} className="rounded" />Show QR Codes</label>
                </div>
                <Divider />
                <div>
                  <Label className="text-xs font-semibold block mb-1">PDF Page Format</Label>
                  <Select value={formData.pdf_layout || "standard"} onChange={e => handleFieldChange("pdf_layout", e.target.value)} className="w-full text-xs h-8">
                    <option value="standard">Standard Outline (Landscape, 1 Page)</option>
                    <option value="standard-2page">Standard Outline (Landscape, 2 Pages)</option>
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
                          <div className="font-semibold text-slate-800">{formatMemberNameWithPrefix(s.name, members)}</div>
                          {s.topic && <div className="text-[11px] text-slate-500 mt-0.5">Topic: {s.topic}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t" style={{ borderColor: theme.border }}><span className="text-slate-500">Closing Hymn:</span><span className="font-semibold" style={{ color: theme.text }}>{closingHymn}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Opening Prayer:</span><span className="font-semibold" style={{ color: theme.text }}>{formatMemberNameWithPrefix(openingPrayer, members)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Closing Prayer:</span><span className="font-semibold" style={{ color: theme.text }}>{formatMemberNameWithPrefix(closingPrayer, members)}</span></div>
                </div>
              </div>
            )}

            {/* Come Follow Me */}
            {formData.show_focus !== false && (formData.cfm_reading || formData.cfm_theme || formData.cfm_discussion_question || formData.cfm_family_challenge || formData.cfm_study_tip || formData.come_follow_me) && (
              <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4" style={{ backgroundColor: theme.cardBg }}>
                <div className="flex items-center gap-2 border-b pb-2 font-bold text-sm" style={{ color: theme.primary, borderColor: theme.border }}>
                  <span>📖</span> Come, Follow Me Study
                </div>
                
                {/* Reading Block & Theme */}
                {(formData.cfm_reading || formData.cfm_theme) && (
                  <div className="space-y-1 bg-slate-50 p-3 rounded-xl border border-slate-100" style={{ backgroundColor: theme.primaryLight, borderColor: theme.border }}>
                    {formData.cfm_reading && (
                      <div className="font-bold text-xs uppercase tracking-wider" style={{ color: theme.textAccent }}>
                        Reading: {formData.cfm_reading}
                      </div>
                    )}
                    {formData.cfm_theme && (
                      <div className="text-sm font-extrabold text-slate-800 leading-tight" style={{ color: theme.text }}>
                        "{formData.cfm_theme}"
                      </div>
                    )}
                  </div>
                )}

                {/* Discussion Question */}
                {formData.cfm_discussion_question && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">💡 Family Discussion</div>
                    <div className="text-xs font-semibold text-slate-700 leading-relaxed border-l-2 pl-2.5" style={{ borderColor: theme.accent }}>
                      {formData.cfm_discussion_question}
                    </div>
                  </div>
                )}

                {/* Family Challenge */}
                {formData.cfm_family_challenge && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">🎯 Weekly Challenge</div>
                    <div className="text-xs font-medium text-slate-700 leading-relaxed p-2.5 rounded-lg border flex gap-2 items-start" style={{ backgroundColor: theme.accentLight, color: theme.textAccent, borderColor: theme.border }}>
                      <span className="text-amber-600">✨</span>
                      <span>{formData.cfm_family_challenge}</span>
                    </div>
                  </div>
                )}

                {/* Study Tip */}
                {formData.cfm_study_tip && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">🔑 Study Tip</div>
                    <div className="text-xs text-slate-600 italic">
                      {formData.cfm_study_tip}
                    </div>
                  </div>
                )}

                {/* General Scripture Notes */}
                {formData.come_follow_me && (
                  <div className="text-xs font-medium text-slate-605 leading-relaxed pt-2 border-t border-slate-100" style={{ whiteSpace: "pre-line", borderColor: theme.border }}>
                    {formData.come_follow_me}
                  </div>
                )}
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
                        {formatActivityName(act.activity) || "None"}
                        {act.is_recurring && <span className="ml-1 text-[9px] text-slate-400" title="Recurring Activity">🔄</span>}
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

            {/* Chapel Cleaning */}
            {formData.show_cleaning !== false && (formData.cleaning_group || formData.cleaning_date || formData.cleaning_time || formData.cleaning_instructions) && (
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-xs space-y-2.5" style={{ backgroundColor: theme.cardBg }}>
                <div className="flex items-center gap-2 border-b pb-1.5 font-bold text-sm" style={{ color: theme.primary, borderColor: theme.border }}>
                  <span>🧹</span> Chapel Cleaning Invitation
                </div>
                <div className="text-xs space-y-2 text-slate-700">
                  {formData.cleaning_group && (
                    <div>
                      <span className="text-slate-500">Invited Group:</span>{" "}
                      <span className="font-bold text-slate-800" style={{ color: theme.textAccent }}>
                        {formData.cleaning_group}
                      </span>
                    </div>
                  )}
                  {(formData.cleaning_date || formData.cleaning_time) && (
                    <div className="flex justify-between items-center bg-slate-50 p-2 rounded-lg border border-slate-100" style={{ backgroundColor: theme.primaryLight, borderColor: theme.border }}>
                      <div>
                        <span className="text-slate-500 font-sans">Date:</span>{" "}
                        <span className="font-semibold text-slate-855">{formData.cleaning_date || "Saturday"}</span>
                      </div>
                      {formData.cleaning_time && (
                        <div>
                          <span className="text-slate-500 font-sans">Time:</span>{" "}
                          <span className="font-semibold text-slate-855">{formData.cleaning_time}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {formData.cleaning_instructions && (
                    <div className="text-xs italic text-slate-600 font-medium">
                      Note: {formData.cleaning_instructions}
                    </div>
                  )}
                </div>
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
                          <span>⛪</span> Next Week Sunday Sacrament Meeting
                        </div>
                        {formData.theme && (
                          <div className="italic text-xs font-semibold" style={{ color: theme.textMuted }}>"{formData.theme}"</div>
                        )}
                        <div className="text-xs space-y-1.5">
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
                                  <div className="font-semibold text-slate-800 text-[11px]">{formatMemberNameWithPrefix(s.name, members)}</div>
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
                    {formData.show_focus !== false && (formData.cfm_reading || formData.cfm_theme || formData.cfm_discussion_question || formData.cfm_family_challenge || formData.cfm_study_tip || formData.come_follow_me) && (
                      <div className="bg-white border p-4 rounded-2xl space-y-2.5" style={{ backgroundColor: theme.cardBg, borderColor: theme.border }}>
                        <div className="flex items-center gap-2 font-bold text-sm border-b pb-1.5" style={{ color: theme.primary, borderColor: theme.border }}>
                          <span>📖</span> Come, Follow Me Study
                        </div>
                        <div className="text-xs space-y-2 text-slate-800">
                          {(formData.cfm_reading || formData.cfm_theme) && (
                            <div className="bg-slate-50 p-2 rounded-lg border border-slate-100/50" style={{ backgroundColor: theme.primaryLight, borderColor: theme.border }}>
                              {formData.cfm_reading && <div className="font-bold text-[10px] uppercase tracking-wider text-slate-500" style={{ color: theme.textAccent }}>Reading: {formData.cfm_reading}</div>}
                              {formData.cfm_theme && <div className="font-bold text-slate-800 mt-0.5">"{formData.cfm_theme}"</div>}
                            </div>
                          )}
                          {formData.cfm_discussion_question && (
                            <div className="space-y-0.5">
                              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Discussion Question</div>
                              <div className="font-semibold text-slate-700 leading-relaxed border-l-2 pl-2" style={{ borderColor: theme.accent }}>{formData.cfm_discussion_question}</div>
                            </div>
                          )}
                          {formData.cfm_family_challenge && (
                            <div className="space-y-0.5">
                              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Family Challenge</div>
                              <div className="font-medium text-slate-700 leading-relaxed p-2 rounded-lg border flex gap-1 items-start" style={{ backgroundColor: theme.accentLight, color: theme.textAccent, borderColor: theme.border }}>
                                <span>✨</span>
                                <span>{formData.cfm_family_challenge}</span>
                              </div>
                            </div>
                          )}
                          {formData.cfm_study_tip && (
                            <div className="space-y-0.5">
                              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Study Tip</div>
                              <div className="italic text-slate-650 font-medium">{formData.cfm_study_tip}</div>
                            </div>
                          )}
                          {formData.come_follow_me && (
                            <div className="text-[11px] font-medium text-slate-600 leading-relaxed pt-1.5 border-t border-slate-100" style={{ whiteSpace: "pre-line", borderColor: theme.border }}>{formData.come_follow_me}</div>
                          )}
                        </div>
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
                                {formatActivityName(act.activity) || "None"}
                                {act.is_recurring && <span className="ml-1 text-[9px] text-slate-400" title="Recurring Activity">🔄</span>}
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

                    {/* Chapel Cleaning */}
                    {formData.show_cleaning !== false && (formData.cleaning_group || formData.cleaning_date || formData.cleaning_time || formData.cleaning_instructions) && (
                      <div className="bg-white border p-5 rounded-2xl space-y-2.5" style={{ backgroundColor: theme.cardBg, borderColor: theme.border }}>
                        <div className="flex items-center gap-2 font-bold text-sm border-b pb-1.5" style={{ color: theme.primary, borderColor: theme.border }}>
                          <span>🧹</span> Chapel Cleaning Invitation
                        </div>
                        <div className="text-xs space-y-1.5 text-slate-700">
                          {formData.cleaning_group && (
                            <div>
                              <span className="text-slate-500">Invited:</span>{" "}
                              <span className="font-bold text-slate-800" style={{ color: theme.textAccent }}>{formData.cleaning_group}</span>
                            </div>
                          )}
                          {(formData.cleaning_date || formData.cleaning_time) && (
                            <div className="flex justify-between items-center bg-slate-50 p-2 rounded-lg border border-slate-100/50" style={{ backgroundColor: theme.primaryLight, borderColor: theme.border }}>
                              <div>Date: <span className="font-semibold text-slate-800">{formData.cleaning_date || "Saturday"}</span></div>
                              {formData.cleaning_time && <div>Time: <span className="font-semibold text-slate-800">{formData.cleaning_time}</span></div>}
                            </div>
                          )}
                          {formData.cleaning_instructions && (
                            <div className="text-[11px] italic text-slate-650 font-medium">Note: {formData.cleaning_instructions}</div>
                          )}
                        </div>
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
                  Format: <strong>{
                    formData.pdf_layout === "bi-fold" ? "Booklet Bi-fold (Landscape)" :
                    formData.pdf_layout === "standard-2page" ? "Standard Outline (Landscape, 2 Pages)" :
                    "Standard Outline (Landscape, 1 Page)"
                  }</strong>
                </p>
              </div>
              <Button variant="primary" onClick={() => generatePDF("bulletin-pdf-print-area", `${unit.unit_name || "Ward"}_Bulletin_${formatDateShort(activeWeek.date)}`)}>
                Generate PDF
              </Button>
            </CardBody>
          </Card>

          {/* Landscape Paper Sheet Preview */}
          <div className="bg-white border rounded-xl shadow-sm p-8 overflow-x-auto flex justify-center">
            
            {formData.pdf_layout === "standard-2page" ? (
              <div id="bulletin-pdf-print-area" className="space-y-8 bg-slate-100 p-4">
                {/* PAGE 1 */}
                <div
                  className="bg-white text-black p-7 border shadow-lg font-serif relative"
                  style={{ width: "297mm", minWidth: "297mm", height: "210mm", maxHeight: "210mm", overflow: "hidden", boxSizing: "border-box", backgroundColor: theme.bg, color: theme.text, borderColor: theme.border }}
                >
                  {/* PDF Header */}
                  <div className="text-center border-b-2 pb-2.5 mb-4" style={{ borderColor: theme.primary }}>
                    <h1 className="text-3xl font-bold tracking-wide uppercase" style={{ color: theme.primary }}>{unit.unit_name || "Obantoko Ward"}</h1>
                    <p className="text-sm font-semibold tracking-widest uppercase mt-1" style={{ color: theme.textAccent }}>Weekly Ward Bulletin</p>
                    <div className="mt-2 text-xs font-medium text-slate-500">
                      {getWeekRangeLabel(activeWeek.date)} Bulletin — Page 1
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-8 text-[12px] leading-relaxed">
                    {/* Left Column: Sacrament Outline */}
                    <div className="space-y-6">
                      {formData.show_sacrament !== false && (
                        <div className="space-y-3">
                          <h3 className="font-bold text-sm border-b pb-1" style={{ color: theme.primary, borderColor: theme.border }}>NEXT WEEK SUNDAY SACRAMENT MEETING PROGRAM</h3>
                          {formData.theme && <div className="italic text-slate-650">Theme: "{formData.theme}"</div>}
                          <table className="w-full">
                            <tbody className="divide-y divide-slate-100" style={{ borderColor: theme.border }}>
                              <tr><td className="py-1 text-slate-500">Opening Hymn</td><td className="py-1 text-right font-medium">{openingHymn}</td></tr>
                              <tr><td className="py-1 text-slate-500">Sacrament Hymn</td><td className="py-1 text-right font-medium">{sacramentHymn}</td></tr>
                              {formData.special_music && (
                                <tr><td className="py-1 text-slate-500">Special Music</td><td className="py-1 text-right font-medium">{formData.special_music}</td></tr>
                              )}
                              {parsedSpeakers.length > 0 && (
                                <tr>
                                  <td colSpan={2} className="py-2">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Speakers</div>
                                    <div className="space-y-1">
                                      {parsedSpeakers.map((s, idx) => (
                                        <div key={idx} className="flex justify-between text-xs py-0.5 border-b border-dashed border-slate-100">
                                          <span className="font-medium text-slate-700">{formatMemberNameWithPrefix(s.name, members)}</span>
                                          {s.topic && <span className="text-slate-500 italic">Topic: {s.topic}</span>}
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )}
                              <tr><td className="py-1 text-slate-500">Closing Hymn</td><td className="py-1 text-right font-medium">{closingHymn}</td></tr>
                              <tr><td className="py-1 text-slate-500">Opening Prayer</td><td className="py-1 text-right font-medium">{formatMemberNameWithPrefix(openingPrayer, members)}</td></tr>
                              <tr><td className="py-1 text-slate-500">Closing Prayer</td><td className="py-1 text-right font-medium">{formatMemberNameWithPrefix(closingPrayer, members)}</td></tr>
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Right Column: Weekly Activities */}
                    <div className="space-y-6">
                      {formData.show_activities !== false && (formData.activities || []).length > 0 && (
                        <div className="space-y-3">
                          <h3 className="font-bold text-sm border-b pb-1" style={{ color: theme.primary, borderColor: theme.border }}>WEEKLY ACTIVITIES</h3>
                          <table className="w-full">
                            <tbody>
                              {(formData.activities || []).filter(act => act.activity).map((act, idx) => (
                                <tr key={idx} className="border-b" style={{ borderColor: theme.border }}>
                                  <td className="py-1 w-24 font-bold text-slate-700" style={{ color: theme.textAccent }}>{act.day}</td>
                                  <td className="py-1 font-medium">
                                    <div>{formatActivityName(act.activity)} {act.is_recurring && <span className="ml-1 text-[9px] text-slate-400">🔄</span>}</div>
                                    {act.time && <span className="text-[10px] text-slate-400 font-sans">{act.time}</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* PAGE 2 */}
                <div
                  className="bg-white text-black p-7 border shadow-lg font-serif relative"
                  style={{ width: "297mm", minWidth: "297mm", height: "210mm", maxHeight: "210mm", overflow: "hidden", boxSizing: "border-box", backgroundColor: theme.bg, color: theme.text, borderColor: theme.border }}
                >
                  {/* Page 2 Header */}
                  <div className="text-center border-b pb-1 mb-2.5" style={{ borderColor: theme.primary }}>
                    <h2 className="text-xl font-bold tracking-wide uppercase" style={{ color: theme.primary }}>{unit.unit_name || "Obantoko Ward"} Bulletin</h2>
                    <div className="text-[10px] font-medium text-slate-500 mt-1">
                      {getWeekRangeLabel(activeWeek.date)} — Page 2
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-8 text-[12px] leading-relaxed">
                    {/* Left Column: Focus, CFM, Birthdays, Bishopric Message */}
                    <div className="space-y-4">
                      {formData.show_focus !== false && (formData.cfm_reading || formData.cfm_theme || formData.cfm_discussion_question || formData.cfm_family_challenge || formData.cfm_study_tip || formData.come_follow_me) && (
                        <div className="space-y-2">
                          <h3 className="font-bold text-xs uppercase tracking-wider border-b pb-0.5" style={{ color: theme.primary }}>📖 Come, Follow Me Study</h3>
                          <div className="text-xs space-y-1 font-sans">
                            {(formData.cfm_reading || formData.cfm_theme) && (
                              <div className="bg-slate-50 p-1.5 rounded border border-slate-100/50" style={{ backgroundColor: theme.primaryLight, borderColor: theme.border }}>
                                {formData.cfm_reading && <div className="font-bold text-[10px]" style={{ color: theme.textAccent }}>Reading: {formData.cfm_reading}</div>}
                                {formData.cfm_theme && <div className="font-bold text-slate-800 leading-tight">"{formData.cfm_theme}"</div>}
                              </div>
                            )}
                            {formData.cfm_discussion_question && (
                              <div>
                                <span className="font-bold text-[10px] text-slate-400 block uppercase">Discussion:</span>
                                <div className="font-semibold text-slate-700 leading-normal border-l pl-1.5" style={{ borderColor: theme.accent }}>{formData.cfm_discussion_question}</div>
                              </div>
                            )}
                            {formData.cfm_family_challenge && (
                              <div className="p-1.5 rounded border text-[11px] leading-normal font-medium" style={{ backgroundColor: theme.accentLight, color: theme.textAccent, borderColor: theme.border }}>
                                <strong>Challenge:</strong> {formData.cfm_family_challenge}
                              </div>
                            )}
                            {formData.cfm_study_tip && (
                              <div className="italic text-slate-500 text-[11px]">
                                <strong>Tip:</strong> {formData.cfm_study_tip}
                              </div>
                            )}
                            {formData.come_follow_me && (
                              <p className="font-medium text-slate-650 text-xs border-t pt-1" style={{ whiteSpace: "pre-line", borderColor: theme.border }}>
                                {formData.come_follow_me}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                      {formData.show_birthdays !== false && (formData.birthdays || []).length > 0 && (
                        <div className="space-y-1.5">
                          <h3 className="font-bold text-xs border-b pb-0.5" style={{ color: theme.primary, borderColor: theme.border }}>🎂 BIRTHDAYS THIS WEEK</h3>
                          <p className="font-medium font-sans text-xs" style={{ color: theme.textAccent }}>
                            {(formData.birthdays || []).join(", ")}
                          </p>
                        </div>
                      )}
                      {formData.show_bishopric !== false && formData.bishopric_message && (
                        <div className="space-y-1.5 p-3 border rounded bg-slate-50" style={{ backgroundColor: theme.primaryLight, borderColor: theme.border }}>
                          <h3 className="font-bold text-xs border-b pb-0.5" style={{ color: theme.primary, borderColor: theme.border }}>BISHOPRIC MESSAGE</h3>
                          <p className="italic text-slate-800 leading-relaxed font-sans text-xs">
                            "{formData.bishopric_message}"
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Right Column: Missionaries, Temple, Self-Reliance, Upcoming Events */}
                    <div className="space-y-4">
                      {formData.show_missionary !== false && (formData.missionaries || []).length > 0 && (
                        <div className="space-y-1">
                          <h3 className="font-bold text-xs border-b pb-0.5" style={{ color: theme.primary, borderColor: theme.border }}>🌐 MISSIONARY CORNER</h3>
                          {(formData.missionaries || []).map((m, idx) => (
                            <div key={idx} className="text-xs">{m}</div>
                          ))}
                        </div>
                      )}
                      {formData.show_temple !== false && (formData.temple_trip_date || formData.familysearch_tip) && (
                        <div className="space-y-1">
                          <h3 className="font-bold text-xs border-b pb-0.5" style={{ color: theme.primary, borderColor: theme.border }}>🏛️ TEMPLE & FAMILY HISTORY</h3>
                          {formData.temple_trip_date && <div className="text-xs">Temple Trip: <span className="font-semibold">{formData.temple_trip_date}</span></div>}
                          {formData.familysearch_tip && <div className="text-xs italic font-sans text-slate-650">FS Tip: {formData.familysearch_tip}</div>}
                        </div>
                      )}
                      {formData.show_upcoming !== false && (formData.upcoming_events || []).length > 0 && (
                        <div className="space-y-1">
                          <h3 className="font-bold text-xs border-b pb-0.5" style={{ color: theme.primary, borderColor: theme.border }}>📣 UPCOMING EVENTS</h3>
                          <ul className="list-disc pl-4 space-y-0.5 text-xs">
                            {(formData.upcoming_events || []).slice(0, 4).map((evt, i) => (
                              <li key={i}>{evt}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {formData.show_cleaning !== false && (formData.cleaning_group || formData.cleaning_date || formData.cleaning_time || formData.cleaning_instructions) && (
                        <div className="space-y-1">
                          <h3 className="font-bold text-xs border-b pb-0.5" style={{ color: theme.primary, borderColor: theme.border }}>🧹 CHAPEL CLEANING</h3>
                          <div className="text-[11px] font-sans space-y-1 text-slate-700">
                            {formData.cleaning_group && <div>Invited Group: <span className="font-bold">{formData.cleaning_group}</span></div>}
                            {(formData.cleaning_date || formData.cleaning_time) && (
                              <div>Date/Time: <span className="font-semibold">{formData.cleaning_date || "Saturday"}{formData.cleaning_time ? ` at ${formData.cleaning_time}` : ""}</span></div>
                            )}
                            {formData.cleaning_instructions && <div className="italic text-slate-500 font-medium">Note: {formData.cleaning_instructions}</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Page 2 Footer */}
                  <div className="absolute bottom-4 left-10 right-10 text-center text-[9px] text-slate-400 border-t pt-2 font-sans" style={{ borderColor: theme.border }}>
                    This is prepared as a weekly informational sheet for local ward members. It is not an official publication of The Church of Jesus Christ of Latter-day Saints.
                  </div>
                </div>
              </div>
            ) : formData.pdf_layout === "bi-fold" ? (
              /* BOOKLET BI-FOLD RENDER */
              <div
                id="bulletin-pdf-print-area"
                className="bg-white text-black p-8 border border-slate-300 shadow-lg font-serif grid grid-cols-2 gap-12"
                style={{ width: "297mm", minWidth: "297mm", height: "210mm", maxHeight: "210mm", overflow: "hidden", boxSizing: "border-box", fontSize: "11px", borderLeft: "1px dashed #cbd5e1" }}
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
                        {getWeekRangeLabel(activeWeek.date)} Bulletin
                      </div>
                    </div>

                    {/* Sacrament Program */}
                    {formData.show_sacrament !== false && (
                      <div className="space-y-2 text-[11px]">
                        <h4 className="font-bold border-b pb-0.5 text-center" style={{ color: theme.primary, borderColor: theme.border }}>NEXT WEEK SUNDAY SACRAMENT MEETING PROGRAM</h4>
                        {formData.theme && <div className="italic text-center text-slate-600">Theme: "{formData.theme}"</div>}
                        <div className="space-y-1 font-sans text-xs">
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
                                  <span className="font-semibold">{formatMemberNameWithPrefix(s.name, members)} {s.topic ? `(${s.topic})` : ""}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex justify-between"><span className="text-slate-500">Closing Hymn:</span><span className="font-semibold">{closingHymn}</span></div>
                        </div>
                      </div>
                    )}

                    {formData.show_focus !== false && (formData.cfm_reading || formData.cfm_theme || formData.cfm_discussion_question || formData.cfm_family_challenge || formData.cfm_study_tip || formData.come_follow_me) && (
                      <div className="mt-3 pt-2 border-t border-dashed border-slate-200" style={{ borderColor: theme.border }}>
                        <div className="text-[10px] uppercase font-bold text-slate-500">📖 Come, Follow Me Reading</div>
                        <div className="text-xs space-y-1 font-sans mt-1">
                          {(formData.cfm_reading || formData.cfm_theme) && (
                            <div className="bg-slate-50 p-1.5 rounded border border-slate-100/50" style={{ backgroundColor: theme.primaryLight, borderColor: theme.border }}>
                              {formData.cfm_reading && <div className="font-bold text-[9px] text-slate-500" style={{ color: theme.textAccent }}>Reading: {formData.cfm_reading}</div>}
                              {formData.cfm_theme && <div className="font-bold text-slate-800 leading-tight">"{formData.cfm_theme}"</div>}
                            </div>
                          )}
                          {formData.cfm_discussion_question && (
                            <div className="text-xs font-semibold text-slate-705 leading-normal border-l pl-1.5" style={{ borderColor: theme.accent }}>{formData.cfm_discussion_question}</div>
                          )}
                          {formData.cfm_family_challenge && (
                            <div className="p-1 rounded border text-[10px] leading-normal font-medium" style={{ backgroundColor: theme.accentLight, color: theme.textAccent, borderColor: theme.border }}>
                              <strong>Challenge:</strong> {formData.cfm_family_challenge}
                            </div>
                          )}
                          {formData.cfm_study_tip && (
                            <div className="italic text-slate-500 text-[10px]">
                              <strong>Tip:</strong> {formData.cfm_study_tip}
                            </div>
                          )}
                          {formData.come_follow_me && (
                            <div className="font-medium text-slate-655 text-[11px] mt-0.5" style={{ whiteSpace: "pre-line" }}>{formData.come_follow_me}</div>
                          )}
                        </div>
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
                                  {formatActivityName(act.activity)}
                                  {act.is_recurring && <span className="ml-1 text-[8px] text-slate-400">🔄</span>}
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

                  {/* Chapel Cleaning */}
                  {formData.show_cleaning !== false && (formData.cleaning_group || formData.cleaning_date || formData.cleaning_time || formData.cleaning_instructions) && (
                    <div className="border-t pt-3 space-y-1" style={{ borderColor: theme.border }}>
                      <h4 className="font-bold text-[10px] uppercase tracking-wider mb-1" style={{ color: theme.primary }}>🧹 Chapel Cleaning</h4>
                      <div className="text-[11px] font-sans space-y-1 text-slate-700 leading-normal">
                        {formData.cleaning_group && <div>Invited: <span className="font-bold text-slate-800">{formData.cleaning_group}</span></div>}
                        {(formData.cleaning_date || formData.cleaning_time) && (
                          <div>Date/Time: <span className="font-semibold">{formData.cleaning_date || "Saturday"}{formData.cleaning_time ? ` at ${formData.cleaning_time}` : ""}</span></div>
                        )}
                        {formData.cleaning_instructions && <div className="italic text-slate-500 font-medium">Note: {formData.cleaning_instructions}</div>}
                      </div>
                    </div>
                  )}
                </div>

              </div>
            ) : (
              <div
                id="bulletin-pdf-print-area"
                className="bg-white text-black border shadow-lg font-serif"
                style={{ width: "297mm", minWidth: "297mm", height: "210mm", maxHeight: "210mm", overflow: "hidden", boxSizing: "border-box", backgroundColor: theme.bg, color: theme.text, borderColor: theme.border, padding: 0 }}
              >
                <div
                  ref={pdfContentRef}
                  style={{
                    transform: pdfScale < 1 ? `scale(${pdfScale})` : "none",
                    transformOrigin: "top left",
                    width: pdfScale < 1 ? `${100 / pdfScale}%` : "100%",
                    height: pdfScale < 1 ? `${100 / pdfScale}%` : "100%",
                    padding: "28px",
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between"
                  }}
                >
                  <div>
                {/* PDF Header */}
                <div className="text-center border-b-2 pb-2.5 mb-4" style={{ borderColor: theme.primary }}>
                  <h1 className="text-3xl font-bold tracking-wide uppercase" style={{ color: theme.primary }}>{unit.unit_name || "Obantoko Ward"}</h1>
                  <p className="text-sm font-semibold tracking-widest uppercase mt-1" style={{ color: theme.textAccent }}>Weekly Ward Bulletin</p>
                  <div className="mt-2 text-xs font-medium text-slate-500">
                    {getWeekRangeLabel(activeWeek.date)} Bulletin — Prepared for Ward Members
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-8 text-[12px] leading-relaxed">
                  {/* Left Side */}
                  <div className="space-y-6">
                    {/* Sacrament Details */}
                    {formData.show_sacrament !== false && (
                      <div className="space-y-3">
                        <h3 className="font-bold text-sm border-b pb-1" style={{ color: theme.primary, borderColor: theme.border }}>NEXT WEEK SUNDAY SACRAMENT MEETING PROGRAM</h3>
                        {formData.theme && <div className="italic text-slate-650">Theme: "{formData.theme}"</div>}
                        <table className="w-full">
                          <tbody className="divide-y divide-slate-100" style={{ borderColor: theme.border }}>
                            <tr><td className="py-1 text-slate-500">Opening Hymn</td><td className="py-1 text-right font-medium">{openingHymn}</td></tr>
                            <tr><td className="py-1 text-slate-500">Sacrament Hymn</td><td className="py-1 text-right font-medium">{sacramentHymn}</td></tr>
                            {formData.special_music && (
                              <tr><td className="py-1 text-slate-500">Special Music</td><td className="py-1 text-right font-medium">{formData.special_music}</td></tr>
                            )}
                            {parsedSpeakers.map((s, idx) => (
                              <tr key={idx}>
                                <td className="py-1 text-slate-500">Speaker {idx + 1}</td>
                                <td className="py-1 text-right font-medium">{formatMemberNameWithPrefix(s.name, members)} {s.topic ? `(${s.topic})` : ""}</td>
                              </tr>
                            ))}
                            <tr><td className="py-1 text-slate-500">Closing Hymn</td><td className="py-1 text-right font-medium">{closingHymn}</td></tr>
                            <tr><td className="py-1 text-slate-500">Opening Prayer</td><td className="py-1 text-right font-medium">{formatMemberNameWithPrefix(openingPrayer, members)}</td></tr>
                            <tr><td className="py-1 text-slate-500">Closing Prayer</td><td className="py-1 text-right font-medium">{formatMemberNameWithPrefix(closingPrayer, members)}</td></tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Come Follow Me Section */}
                    {formData.show_focus !== false && (formData.cfm_reading || formData.cfm_theme || formData.cfm_discussion_question || formData.cfm_family_challenge || formData.cfm_study_tip || formData.come_follow_me) && (
                      <div className="space-y-1.5 pt-3 border-t" style={{ borderColor: theme.border }}>
                        <h3 className="font-bold text-xs uppercase tracking-wider font-sans" style={{ color: theme.primary }}>📖 Come, Follow Me Study</h3>
                        <div className="text-xs space-y-1 font-sans mt-1">
                          {(formData.cfm_reading || formData.cfm_theme) && (
                            <div className="bg-slate-50 p-1.5 rounded border border-slate-100/50" style={{ backgroundColor: theme.primaryLight, borderColor: theme.border }}>
                              {formData.cfm_reading && <div className="font-bold text-[9px]" style={{ color: theme.textAccent }}>Reading: {formData.cfm_reading}</div>}
                              {formData.cfm_theme && <div className="font-bold text-slate-805 leading-tight">"{formData.cfm_theme}"</div>}
                            </div>
                          )}
                          {formData.cfm_discussion_question && (
                            <div className="text-xs font-semibold text-slate-755 leading-normal border-l pl-1.5" style={{ borderColor: theme.accent }}>{formData.cfm_discussion_question}</div>
                          )}
                          {formData.cfm_family_challenge && (
                            <div className="p-1 rounded border text-[10px] leading-normal font-medium" style={{ backgroundColor: theme.accentLight, color: theme.textAccent, borderColor: theme.border }}>
                              <strong>Challenge:</strong> {formData.cfm_family_challenge}
                            </div>
                          )}
                          {formData.cfm_study_tip && (
                            <div className="italic text-slate-500 text-[10px]">
                              <strong>Tip:</strong> {formData.cfm_study_tip}
                            </div>
                          )}
                          {formData.come_follow_me && (
                            <p className="font-medium text-slate-655 text-xs border-t pt-1" style={{ whiteSpace: "pre-line", borderColor: theme.border }}>
                              {formData.come_follow_me}
                            </p>
                          )}
                        </div>
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
                                  {formatActivityName(act.activity) || "None scheduled"}
                                  {act.is_recurring && <span className="ml-1 text-[8px] text-slate-400">🔄</span>}
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

                    {/* Chapel Cleaning */}
                    {formData.show_cleaning !== false && (formData.cleaning_group || formData.cleaning_date || formData.cleaning_time || formData.cleaning_instructions) && (
                      <div className="space-y-2">
                        <h3 className="font-bold text-sm border-b pb-1" style={{ color: theme.primary, borderColor: theme.border }}>🧹 CHAPEL CLEANING</h3>
                        <div className="text-[11px] font-sans space-y-1 text-slate-700 leading-normal">
                          {formData.cleaning_group && <div>Invited Group: <span className="font-bold">{formData.cleaning_group}</span></div>}
                          {(formData.cleaning_date || formData.cleaning_time) && (
                            <div>Date/Time: <span className="font-semibold">{formData.cleaning_date || "Saturday"}{formData.cleaning_time ? ` at ${formData.cleaning_time}` : ""}</span></div>
                          )}
                          {formData.cleaning_instructions && <div className="italic text-slate-500 font-medium">Note: {formData.cleaning_instructions}</div>}
                        </div>
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
              </div>

              {/* PDF Footer */}
              <div className="text-center text-[9px] text-slate-400 border-t pt-4 mt-8 font-sans" style={{ borderColor: theme.border }}>
                This is prepared as a weekly informational sheet for local ward members. It is not an official publication of The Church of Jesus Christ of Latter-day Saints.
              </div>
            </div>
          </div>
            )}
            
          </div>
        </div>
      )}
      </>
        )
      ) : (
        <EmptyState
          icon="📅"
          title="Select a Week"
          description="Please select a week to begin preparing the weekly bulletin."
        />
      )}
    </div>
  );
}
