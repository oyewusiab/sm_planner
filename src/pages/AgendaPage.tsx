import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import html2pdf from "html2pdf.js";
import type { Agenda, Planner, UnitSettings, User, WeekPlan } from "../types";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Input, Label, Select, Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui";
import { Modal } from "../components/Modal";
import { can } from "../utils/permissions";
import { useTable, useUpsertMutation, ids, time, updateDB } from "../utils/storage";
import { formatDateShort } from "../utils/date";

function parseHymn(rawHymn: string): { title: string; number: string } {
  if (!rawHymn) return { title: "", number: "" };
  
  // Try pattern: "135 - My Redeemer Lives" or "135-My Redeemer Lives"
  const dashMatch = rawHymn.match(/^\s*(\d+)\s*-\s*(.+)$/);
  if (dashMatch) {
    return { number: dashMatch[1], title: dashMatch[2].trim() };
  }
  
  // Try pattern: "135 My Redeemer Lives" (number followed by space and words)
  const spaceMatch = rawHymn.match(/^\s*(\d+)\s+(.+)$/);
  if (spaceMatch) {
    return { number: spaceMatch[1], title: spaceMatch[2].trim() };
  }
  
  // Try pattern: "My Redeemer Lives (135)" or "My Redeemer Lives 135" at the end
  const endMatch = rawHymn.match(/^(.+?)\s*\(?(\d+)\)?\s*$/);
  if (endMatch) {
    return { title: endMatch[1].trim(), number: endMatch[2] };
  }
  
  // Fallback: If it's just a number
  if (/^\s*\d+\s*$/.test(rawHymn)) {
    return { title: "", number: rawHymn.trim() };
  }
  
  return { title: rawHymn.trim(), number: "" };
}

function gender(name: string, g?: "M" | "F") {
  const n = (name || "").trim();
  if (!n) return "";
  const lo = n.toLowerCase();
  if (lo.startsWith("brother ") || lo.startsWith("sister ")) return n;
  if (g === "M") return `Brother ${n}`;
  if (g === "F") return `Sister ${n}`;
  return n;
}

function blankAgenda(plannerId: string, weekId: string, userId: string, _planner: Planner, week: WeekPlan, unit: UnitSettings): Agenda {
  const parsedOpening = parseHymn(week.hymns?.opening || "");
  const parsedSacrament = parseHymn(week.hymns?.sacrament || "");
  const parsedClosing = parseHymn(week.hymns?.closing || "");
  const defaultWelcome = "We warmly welcome everyone, stake officers, friends of the church and those worshipping with us for the first time.";

  return {
    agenda_id: ids.uid("agenda"),
    planner_id: plannerId,
    week_id: weekId,
    created_by: userId,
    created_date: time.now(),
    updated_date: time.now(),
    state: "DRAFT",

    ward_branch: unit.unit_name || "Ward/Branch",
    stake_district: unit.stake_name || "Stake/District",
    date: week.date,
    type_of_meeting: week.fast_testimony ? "Fast & Testimony" : "Sacrament Meeting",
    other_meeting_specify: "",
    presiding: week.presiding || "",
    presiding_position: "",
    conducting: week.conducting_officer || "",
    music_director: week.music?.director || "",
    choir_director: "",
    organist: week.music?.accompanist || "",
    start_time: unit.meeting_time || "9:00AM",
    prelude_music: "",
    greetings_welcome: defaultWelcome,
    acknowledgements: defaultWelcome, // Synchronized with greetings_welcome initially
    ward_branch_business: week.note || "",
    stake_district_business: "",
    naming_blessing: "",
    confirmation_bestowal: "",
    opening_hymn: parsedOpening.title,
    opening_hymn_number: parsedOpening.number,
    opening_prayer: gender(week.prayers?.invocation || "", week.prayers?.invocation_gender),
    sacrament_hymn: parsedSacrament.title,
    sacrament_hymn_number: parsedSacrament.number,
    special_music: "",
    speakers: week.speakers.map(s => ({ name: gender(s.name, s.gender), topic: s.topic, reference: s.reference || "" })),
    closing_hymn: parsedClosing.title,
    closing_hymn_number: parsedClosing.number,
    closing_prayer: gender(week.prayers?.benediction || "", week.prayers?.benediction_gender),
    postlude_music: "",

    announcements: ["", "", "", "", "", ""],
    releases: [],
    calls: [],
    baptized_children: ["", "", "", ""],
    aaronic_ordinations: [],
    aaronic_advancements: [],
    achievements: ["", "", "", ""],
    babies: [],
    confirmations: [],
    fellowships: ["", "", "", "", "", "", "", ""],
  };
}

// Utility to pad arrays to a fixed size for consistent print layouts
function padArray<T>(arr: T[], targetSize: number, emptyObj: T): T[] {
  const result = [...(arr || [])];
  while (result.length < targetSize) {
    result.push(emptyObj);
  }
  return result.slice(0, targetSize);
}

export function AgendaPage({ user, unit, onChanged }: { user: User; unit: UnitSettings; onChanged: () => void }) {
  const { data: planners = [] } = useTable("PLANNERS");
  const { data: agendas = [] } = useTable("AGENDAS");
  const upsert = useUpsertMutation("AGENDAS");
  
  const [selectedPlannerId, setSelectedPlannerId] = useState<string>("");
  const [selectedWeekId, setSelectedWeekId] = useState<string>("");
  const [selectedAgendaId, setSelectedAgendaId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"prepare" | "saved" | "preview">("prepare");
  const [searchQuery, setSearchQuery] = useState("");

  // In-memory draft state
  const [localAgenda, setLocalAgenda] = useState<Agenda | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Delete Verification State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [previewAgenda, setPreviewAgenda] = useState<Agenda | null>(null);

  const printContentRef = useRef<HTMLDivElement>(null);

  const activePlanners = useMemo(() => {
    const safePlanners = Array.isArray(planners) ? planners : [];
    return safePlanners.filter(p => p.state === "SUBMITTED")
      .sort((a, b) => b.created_date.localeCompare(a.created_date));
  }, [planners]);

  const activePlanner = useMemo(() => {
    return activePlanners.find(p => p.planner_id === selectedPlannerId);
  }, [activePlanners, selectedPlannerId]);

  const activeWeek = useMemo(() => {
    if (!activePlanner) return null;
    return activePlanner.weeks.find(w => w.week_id === selectedWeekId);
  }, [activePlanner, selectedWeekId]);

  const allAgendasForWeek = useMemo(() => {
    if (!activePlanner || !activeWeek) return [];
    return agendas.filter(a => a.planner_id === activePlanner.planner_id && a.week_id === activeWeek.week_id && a.state !== "ARCHIVED")
      .sort((a, b) => b.updated_date.localeCompare(a.updated_date));
  }, [agendas, activePlanner, activeWeek]);

  // Check if the current agenda exists in the database
  const existsInDB = useMemo(() => {
    if (!localAgenda) return false;
    return agendas.some(a => a.agenda_id === localAgenda.agenda_id);
  }, [agendas, localAgenda]);

  // Load saved agendas list for search area
  const savedAgendasList = useMemo(() => {
    return agendas.filter(a => a.state !== "ARCHIVED");
  }, [agendas]);

  const filteredAgendas = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return savedAgendasList;
    return savedAgendasList.filter(a => 
      a.ward_branch.toLowerCase().includes(query) ||
      a.stake_district.toLowerCase().includes(query) ||
      (a.date && a.date.toLowerCase().includes(query)) ||
      a.conducting.toLowerCase().includes(query) ||
      a.presiding.toLowerCase().includes(query)
    );
  }, [savedAgendasList, searchQuery]);

  useEffect(() => {
    if (!selectedPlannerId && activePlanners.length > 0) {
      setSelectedPlannerId(activePlanners[0].planner_id);
    }
  }, [activePlanners, selectedPlannerId]);

  useEffect(() => {
    if (activePlanner && !selectedWeekId && activePlanner.weeks.length > 0) {
      setSelectedWeekId(activePlanner.weeks[0].week_id);
    }
  }, [activePlanner, selectedWeekId]);

  // Alert on browser close or reload if unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Load selected agenda into local edit state
  useEffect(() => {
    if (selectedAgendaId) {
      const selected = agendas.find(a => a.agenda_id === selectedAgendaId);
      if (selected) {
        setLocalAgenda(selected);
        setIsDirty(false);
      }
    } else if (allAgendasForWeek.length > 0) {
      setLocalAgenda(allAgendasForWeek[0]);
      setIsDirty(false);
    } else {
      setLocalAgenda(null);
      setIsDirty(false);
    }
  }, [selectedAgendaId, allAgendasForWeek, agendas]);

  // Helper to check unsaved changes before switching week or planner
  const handleSelectPlannerChange = (plannerId: string) => {
    if (isDirty) {
      const proceed = window.confirm("You have unsaved changes. Do you want to discard them?");
      if (!proceed) return;
    }
    setSelectedPlannerId(plannerId);
    setSelectedWeekId("");
    setSelectedAgendaId(null);
    setLocalAgenda(null);
    setIsDirty(false);
  };

  const handleSelectWeekChange = (weekId: string) => {
    if (isDirty) {
      const proceed = window.confirm("You have unsaved changes. Do you want to discard them?");
      if (!proceed) return;
    }
    setSelectedWeekId(weekId);
    setSelectedAgendaId(null);
    setLocalAgenda(null);
    setIsDirty(false);
  };

  const handleSelectAgendaChange = (agendaId: string) => {
    if (isDirty) {
      const proceed = window.confirm("You have unsaved changes. Do you want to discard them?");
      if (!proceed) return;
    }
    setSelectedAgendaId(agendaId || null);
    setIsDirty(false);
  };

  const handleLoadSavedAgenda = (agenda: Agenda) => {
    if (isDirty) {
      const proceed = window.confirm("You have unsaved changes. Do you want to discard them and load this agenda?");
      if (!proceed) return;
    }
    setSelectedPlannerId(agenda.planner_id);
    setSelectedWeekId(agenda.week_id);
    setSelectedAgendaId(agenda.agenda_id);
    setLocalAgenda(agenda);
    setIsDirty(false);
    setActiveTab("prepare");
  };

  // Permission checks
  const canCreate = can(user.role, "agendas.create");
  const canEdit = can(user.role, "agendas.edit");
  const canPrint = can(user.role, "agendas.print");
  
  const handleCreateAgenda = async () => {
    if (!activePlanner || !activeWeek || !canCreate) return;
    
    // Check duplicate week constraint for the same user
    const sameUserDuplicate = agendas.find(a => 
      a.planner_id === activePlanner.planner_id && 
      a.week_id === activeWeek.week_id && 
      a.created_by === user.user_id &&
      a.state !== "ARCHIVED"
    );
    if (sameUserDuplicate) {
      alert("No two agendas of the same week can be created by the same user. You have already created one for this week.");
      return;
    }

    // Warn if another user has already created one
    const otherUserDuplicate = agendas.find(a => 
      a.planner_id === activePlanner.planner_id && 
      a.week_id === activeWeek.week_id &&
      a.state !== "ARCHIVED"
    );
    if (otherUserDuplicate) {
      const proceed = window.confirm("Another user has already created an agenda for this week. Do you want to proceed and create another one?");
      if (!proceed) return;
    }

    const newAgenda = blankAgenda(activePlanner.planner_id, activeWeek.week_id, user.user_id, activePlanner, activeWeek, unit);
    setLocalAgenda(newAgenda);
    setIsDirty(true);
    setActiveTab("prepare");
  };

  const updateAgendaField = (field: keyof Agenda, value: any) => {
    if (!localAgenda || !canEdit) return;
    let updated = { ...localAgenda, [field]: value };
    
    // Greetings & Welcome and Acknowledgements are the same
    if (field === "greetings_welcome") {
      updated.acknowledgements = value;
    }

    // Auto-parse hymn number/title if user enters them together
    if (field === "opening_hymn") {
      const parsed = parseHymn(value);
      if (parsed.number) {
        updated.opening_hymn = parsed.title;
        updated.opening_hymn_number = parsed.number;
      }
    } else if (field === "sacrament_hymn") {
      const parsed = parseHymn(value);
      if (parsed.number) {
        updated.sacrament_hymn = parsed.title;
        updated.sacrament_hymn_number = parsed.number;
      }
    } else if (field === "closing_hymn") {
      const parsed = parseHymn(value);
      if (parsed.number) {
        updated.closing_hymn = parsed.title;
        updated.closing_hymn_number = parsed.number;
      }
    }
    
    setLocalAgenda(updated);
    setIsDirty(true);
  };

  const updateAgendaSpeaker = (index: number, field: 'name' | 'topic' | 'reference', value: string) => {
    if (!localAgenda || !canEdit) return;
    const newSpeakers = [...(localAgenda.speakers || [])];
    while (newSpeakers.length <= index) {
      newSpeakers.push({ name: "", topic: "", reference: "" });
    }
    newSpeakers[index] = { ...newSpeakers[index], [field]: value };
    setLocalAgenda({ ...localAgenda, speakers: newSpeakers });
    setIsDirty(true);
  };

  const updateAnnouncement = (index: number, value: string) => {
    if (!localAgenda || !canEdit) return;
    const list = padArray(localAgenda.announcements || [], 6, "");
    list[index] = value;
    setLocalAgenda({ ...localAgenda, announcements: list });
    setIsDirty(true);
  };

  const updateRelease = (index: number, field: 'name' | 'calling', value: string) => {
    if (!localAgenda || !canEdit) return;
    const list = padArray(localAgenda.releases || [], 6, { name: "", calling: "" });
    list[index] = { ...list[index], [field]: value };
    setLocalAgenda({ ...localAgenda, releases: list });
    setIsDirty(true);
  };

  const updateCall = (index: number, field: 'name' | 'calling', value: string) => {
    if (!localAgenda || !canEdit) return;
    const list = padArray(localAgenda.calls || [], 6, { name: "", calling: "" });
    list[index] = { ...list[index], [field]: value };
    setLocalAgenda({ ...localAgenda, calls: list });
    setIsDirty(true);
  };

  const updateBaptizedChild = (index: number, value: string) => {
    if (!localAgenda || !canEdit) return;
    const list = padArray(localAgenda.baptized_children || [], 4, "");
    list[index] = value;
    setLocalAgenda({ ...localAgenda, baptized_children: list });
    setIsDirty(true);
  };

  const updateOrdination = (index: number, field: string, value: string) => {
    if (!localAgenda || !canEdit) return;
    const list = padArray(localAgenda.aaronic_ordinations || [], 4, { name: "", office: "", ordained_by: "", ordained_by_office: "" });
    list[index] = { ...list[index], [field]: value };
    setLocalAgenda({ ...localAgenda, aaronic_ordinations: list });
    setIsDirty(true);
  };

  const updateAdvancement = (index: number, field: string, value: string) => {
    if (!localAgenda || !canEdit) return;
    const list = padArray(localAgenda.aaronic_advancements || [], 4, { name: "", office_from: "", office_to: "", ordained_by: "", ordained_by_office: "" });
    list[index] = { ...list[index], [field]: value };
    setLocalAgenda({ ...localAgenda, aaronic_advancements: list });
    setIsDirty(true);
  };

  const updateAchievement = (index: number, value: string) => {
    if (!localAgenda || !canEdit) return;
    const list = padArray(localAgenda.achievements || [], 4, "");
    list[index] = value;
    setLocalAgenda({ ...localAgenda, achievements: list });
    setIsDirty(true);
  };

  const updateBaby = (index: number, field: string, value: string) => {
    if (!localAgenda || !canEdit) return;
    const list = padArray(localAgenda.babies || [], 4, { family: "", baby_name: "", blessed_by: "", blessed_by_office: "" });
    list[index] = { ...list[index], [field]: value };
    setLocalAgenda({ ...localAgenda, babies: list });
    setIsDirty(true);
  };

  const updateConfirmation = (index: number, field: string, value: string) => {
    if (!localAgenda || !canEdit) return;
    const list = padArray(localAgenda.confirmations || [], 6, { name: "", confirmed_by: "", confirmed_by_office: "" });
    list[index] = { ...list[index], [field]: value };
    setLocalAgenda({ ...localAgenda, confirmations: list });
    setIsDirty(true);
  };

  const updateFellowship = (index: number, value: string) => {
    if (!localAgenda || !canEdit) return;
    const list = padArray(localAgenda.fellowships || [], 8, "");
    list[index] = value;
    setLocalAgenda({ ...localAgenda, fellowships: list });
    setIsDirty(true);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = async () => {
    if (!localAgenda || !printContentRef.current) return;
    const element = printContentRef.current;
    const opt = {
      margin: 0,
      filename: `Sacrament-Agenda-${formatDateShort(localAgenda.date || new Date().toISOString())}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2.5, useCORS: true, letterRendering: true },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' as const }
    };
    try {
      await html2pdf().set(opt).from(element).save();
    } catch (err) {
      console.error("PDF generation failed:", err);
      alert("Failed to download PDF.");
    }
  };

  const archiveAgenda = async () => {
    if (!localAgenda || !canEdit || !existsInDB) return;
    const confirmed = window.confirm('Are you sure you want to archive this agenda? It will be moved to the archive page.');
    if (confirmed) {
      const updated = { ...localAgenda, state: 'ARCHIVED' as const, updated_date: time.now() };
      await upsert.mutate(updated);
      setLocalAgenda(null);
      setIsDirty(false);
      onChanged();
    }
  };

  const executeDeleteAgenda = () => {
    if (!localAgenda || !canEdit || !existsInDB) return;
    updateDB(db => ({
      ...db,
      AGENDAS: db.AGENDAS.filter(a => a.agenda_id !== localAgenda.agenda_id)
    }));
    setLocalAgenda(null);
    setIsDirty(false);
    setShowDeleteModal(false);
    setDeleteConfirmText("");
    onChanged();
    alert('Agenda deleted permanently.');
  };

  const saveAgenda = async () => {
    if (!localAgenda || !canEdit) return;
    try {
      const updatedAgenda = { ...localAgenda, state: 'SUBMITTED' as const, updated_date: time.now() };
      await upsert.mutate(updatedAgenda);
      setLocalAgenda(updatedAgenda);
      setIsDirty(false);
      onChanged();
      alert('Agenda saved successfully!');
    } catch (err) {
      alert('Error saving agenda: ' + err);
    }
  };

  const discardChanges = () => {
    const confirmed = window.confirm("Are you sure you want to discard all unsaved changes?");
    if (!confirmed) return;
    if (existsInDB) {
      const saved = agendas.find(a => a.agenda_id === localAgenda?.agenda_id);
      if (saved) setLocalAgenda(saved);
    } else {
      setLocalAgenda(null);
    }
    setIsDirty(false);
  };

  const handleArchiveDirect = async (agenda: Agenda) => {
    if (!canEdit) return;
    const confirmed = window.confirm('Are you sure you want to archive this agenda? It will be moved to the archive page.');
    if (confirmed) {
      const updated = { ...agenda, state: 'ARCHIVED' as const, updated_date: time.now() };
      await upsert.mutate(updated);
      if (localAgenda?.agenda_id === agenda.agenda_id) {
        setLocalAgenda(null);
        setIsDirty(false);
      }
      onChanged();
    }
  };

  const handleDeleteDirect = (agenda: Agenda) => {
    if (!canEdit) return;
    const confirmed = window.confirm('Are you sure you want to permanently delete this agenda? This action cannot be undone.');
    if (confirmed) {
      const verify = window.prompt("Type 'DELETE' to verify permanent deletion:");
      if (verify !== "DELETE") {
        alert("Deletion cancelled.");
        return;
      }
      updateDB(db => ({
        ...db,
        AGENDAS: db.AGENDAS.filter(a => a.agenda_id !== agenda.agenda_id)
      }));
      if (localAgenda?.agenda_id === agenda.agenda_id) {
        setLocalAgenda(null);
        setIsDirty(false);
      }
      onChanged();
      alert('Agenda deleted permanently.');
    }
  };

  // Setup padded lists for rendering
  const speakers = useMemo(() => padArray(localAgenda?.speakers || [], 5, { name: "", topic: "", reference: "" }), [localAgenda]);
  const announcementsList = useMemo(() => padArray(localAgenda?.announcements || [], 6, ""), [localAgenda]);
  const releasesList = useMemo(() => padArray(localAgenda?.releases || [], 6, { name: "", calling: "" }), [localAgenda]);
  const callsList = useMemo(() => padArray(localAgenda?.calls || [], 6, { name: "", calling: "" }), [localAgenda]);
  const baptizedChildren = useMemo(() => padArray(localAgenda?.baptized_children || [], 4, ""), [localAgenda]);
  const ordinations = useMemo(() => padArray(localAgenda?.aaronic_ordinations || [], 4, { name: "", office: "", ordained_by: "", ordained_by_office: "" }), [localAgenda]);
  const advancements = useMemo(() => padArray(localAgenda?.aaronic_advancements || [], 4, { name: "", office_from: "", office_to: "", ordained_by: "", ordained_by_office: "" }), [localAgenda]);
  const achievementsList = useMemo(() => padArray(localAgenda?.achievements || [], 4, ""), [localAgenda]);
  const babiesList = useMemo(() => padArray(localAgenda?.babies || [], 4, { family: "", baby_name: "", blessed_by: "", blessed_by_office: "" }), [localAgenda]);
  const confirmationsList = useMemo(() => padArray(localAgenda?.confirmations || [], 6, { name: "", confirmed_by: "", confirmed_by_office: "" }), [localAgenda]);
  const fellowshipsList = useMemo(() => padArray(localAgenda?.fellowships || [], 8, ""), [localAgenda]);

  // PDF & Print rendering component helper
  const renderAgendaDocument = (agendaData: Agenda | null) => {
    if (!agendaData) return null;
    const isFastTestimony = agendaData.type_of_meeting === "Fast & Testimony" || 
      !agendaData.speakers || 
      agendaData.speakers.filter(s => s.name?.trim()).length === 0;

    return (
      <div className="agenda-print-sheet font-serif text-[10.5px] leading-[1.35] text-black bg-white select-none">
        
        {/* PAGE 1: FRONT PAGE */}
        <div className="agenda-page-container">
          <div className="agenda-page-border flex flex-col justify-between h-full border-2 border-black p-[0.25in] box-border">
            
            <div className="text-center">
              <h1 className="text-center font-bold text-[14px] uppercase tracking-wide border-b-2 border-black pb-1 mb-2">Sacrament Meeting Agenda</h1>
            </div>

            <table className="w-full border-collapse border border-black mb-1.5 text-[9.5px]">
              <tbody>
                <tr>
                  <td className="border border-black p-1.5 w-[45%]"><strong>Ward / Branch:</strong> {agendaData.ward_branch}</td>
                  <td className="border border-black p-1.5 w-[35%]"><strong>Stake / District:</strong> {agendaData.stake_district}</td>
                  <td className="border border-black p-1.5 w-[20%] text-center"><strong>Date:</strong> {agendaData.date ? formatDateShort(agendaData.date) : ""}</td>
                </tr>
              </tbody>
            </table>

            <table className="w-full border-collapse border border-black mb-1.5 text-[9px]">
              <tbody>
                <tr>
                  <td className="border border-black p-1 px-2">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5">
                        <strong>Type:</strong>
                        <label className="flex items-center gap-1">
                          <input type="checkbox" checked={agendaData.type_of_meeting === "Sacrament Meeting"} readOnly className="w-3 h-3 accent-black" />
                          Sacrament Meeting
                        </label>
                        <label className="flex items-center gap-1">
                          <input type="checkbox" checked={agendaData.type_of_meeting === "Fast & Testimony"} readOnly className="w-3 h-3 accent-black" />
                          Fast & Testimony (F & T)
                        </label>
                        <label className="flex items-center gap-1">
                          <input type="checkbox" checked={agendaData.type_of_meeting === "Stake/District Meeting"} readOnly className="w-3 h-3 accent-black" />
                          Stake/District Meeting
                        </label>
                        <label className="flex items-center gap-1">
                          <input type="checkbox" checked={agendaData.type_of_meeting === "Ward/Branch Conference"} readOnly className="w-3 h-3 accent-black" />
                          Ward/Branch Conference
                        </label>
                      </div>
                    </div>
                    <div className="mt-1 flex items-center">
                      <label className="flex items-center gap-1 mr-1.5 whitespace-nowrap">
                        <input type="checkbox" checked={agendaData.type_of_meeting === "Other"} readOnly className="w-3 h-3 accent-black" />
                        Other (Specify):
                      </label>
                      <span className="flex-1 border-b border-black min-h-[1.1rem] px-1 text-[9px]">
                        {agendaData.type_of_meeting === "Other" ? agendaData.other_meeting_specify : ""}
                      </span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            <table className="w-full border-collapse border border-black mb-1.5 text-[9.5px]">
              <tbody>
                <tr>
                  <td className="border border-black p-1.5 w-1/2 align-top">
                    <div className="flex justify-between text-[8px] font-bold text-slate-500 mb-1 border-b border-slate-200 pb-0.5">
                      <span></span>
                      <span className="w-1/2 text-left pl-2">Name</span>
                      <span className="w-1/3 text-left">Position</span>
                    </div>
                    <div className="flex items-end mb-1.5 text-[9.5px]">
                      <strong className="w-16 shrink-0">Presiding:</strong>
                      <span className="w-1/2 border-b border-black min-h-[1.1rem] px-1 truncate">{agendaData.presiding}</span>
                      <span className="w-1/3 border-b border-black min-h-[1.1rem] px-1 truncate">{agendaData.presiding_position || "Bishop"}</span>
                    </div>
                    <div className="flex items-end text-[9.5px]">
                      <strong className="w-16 shrink-0">Conducting:</strong>
                      <span className="w-1/2 border-b border-black min-h-[1.1rem] px-1 truncate">
                        {agendaData.conducting.split(" (")[0].split(", ")[0]}
                      </span>
                      <span className="w-1/3 border-b border-black min-h-[1.1rem] px-1 truncate">
                        {agendaData.conducting.includes(" (") 
                          ? agendaData.conducting.split(" (")[1].replace(")", "") 
                          : agendaData.conducting.includes(", ") 
                            ? agendaData.conducting.split(", ")[1] 
                            : ""}
                      </span>
                    </div>
                  </td>
                  <td className="border border-black p-1.5 w-1/2 align-top space-y-1">
                    <div className="flex items-end">
                      <strong className="w-24 shrink-0">Music Director:</strong>
                      <span className="flex-1 border-b border-black min-h-[1.1rem] px-1 text-[9.5px] truncate">{agendaData.music_director}</span>
                    </div>
                    <div className="flex items-end">
                      <strong className="w-24 shrink-0">Choir Director:</strong>
                      <span className="flex-1 border-b border-black min-h-[1.1rem] px-1 text-[9.5px] truncate">{agendaData.choir_director}</span>
                    </div>
                    <div className="flex items-end">
                      <strong className="w-24 shrink-0">Organist:</strong>
                      <span className="flex-1 border-b border-black min-h-[1.1rem] px-1 text-[9.5px] truncate">{agendaData.organist}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="flex justify-between items-end mb-0.5">
              <div className="flex-1 flex items-end">
                <strong>Prelude Music (by choir or organ):</strong>
                <span className="border-b border-black flex-1 min-h-[1.1rem] ml-1 px-1">{agendaData.prelude_music}</span>
              </div>
              <div className="flex flex-col items-center shrink-0 w-16 mb-0.5 ml-4">
                <span className="text-[7.5px] font-bold uppercase tracking-wider leading-none">Time</span>
                <div className="flex border border-black text-[7px] font-bold text-center divide-x divide-black h-4 w-16 mt-0.5">
                  <div className="w-1/2 flex items-center justify-center">each</div>
                  <div className="w-1/2 flex items-center justify-center">cum</div>
                </div>
              </div>
            </div>

            <div className="space-y-1 flex-1 flex flex-col justify-between mt-1">
              
              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1">
                  <strong className="shrink-0">Start time:</strong>
                  <span className="border-b border-black w-24 ml-1 px-1 text-center font-semibold">{agendaData.start_time}</span>
                  <span className="border-b border-black flex-1 min-h-[1.1rem]"></span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1 truncate">
                  <strong className="shrink-0 mr-1">Greetings and Welcome:</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agendaData.greetings_welcome}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1 truncate">
                  <strong className="shrink-0 mr-1">Acknowledgements:</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agendaData.acknowledgements}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1">
                  <strong className="shrink-0">Announcements</strong>
                  <span className="text-[8px] italic ml-1 mr-1">(see reverse side)</span>
                  <span className="border-b border-black flex-1 min-h-[1.1rem]"></span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1">
                  <strong className="shrink-0 mr-1">Opening Hymn:</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agendaData.opening_hymn}</span>
                  <strong className="shrink-0 ml-2 mr-1">Hymn Number:</strong>
                  <span className="border-b border-black w-14 text-center min-h-[1.1rem] px-1 font-semibold">{agendaData.opening_hymn_number}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1 truncate">
                  <strong className="shrink-0 mr-1">Opening Prayer:</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agendaData.opening_prayer}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1 truncate">
                  <strong className="shrink-0">Ward/Branch Business</strong>
                  <span className="text-[8px] italic ml-1 mr-1">(see reverse side)</span>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agendaData.ward_branch_business}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1 truncate">
                  <strong className="shrink-0 mr-1">Stake/District Business (by):</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agendaData.stake_district_business}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1 truncate">
                  <strong className="shrink-0">Naming & Blessing of Children</strong>
                  <span className="text-[8.5px] italic ml-1 mr-1">(F & T only) (see reverse side)</span>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agendaData.naming_blessing}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1 truncate">
                  <strong className="shrink-0">Confirmation & Bestowal of the Holy Ghost</strong>
                  <span className="text-[8px] italic ml-1 mr-1">(see reverse side)</span>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agendaData.confirmation_bestowal}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1">
                  <strong className="shrink-0 mr-1">Sacrament Hymn:</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agendaData.sacrament_hymn}</span>
                  <strong className="shrink-0 ml-2 mr-1">Hymn Number:</strong>
                  <span className="border-b border-black w-14 text-center min-h-[1.1rem] px-1 font-semibold">{agendaData.sacrament_hymn_number}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="text-center border-t border-b border-black py-1 my-0.5 font-bold uppercase tracking-wider text-[9.5px]">
                Administration and Passing of the Sacrament
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1 truncate">
                  <strong className="shrink-0 mr-1">Special Music (if any, by choir - F & T only):</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agendaData.special_music}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>
              <div className="text-[7.5px] italic text-slate-500 -mt-0.5">
                (Express gratitude to the priesthood brethren for administering and to the congregation for reverence maintained; also, to the choir)
              </div>

              <div className="font-bold text-[8.5px] uppercase tracking-wide mt-1 border-b border-black pb-0.5">
                Speakers, Testimonies, Hymn, Special Music (as appropriate)
              </div>

              {isFastTestimony ? (
                <div style={{ height: "235px", position: "relative", border: "1px dashed #000", borderRadius: "4px", margin: "12px 0", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: "#fafafa" }}>
                  <div style={{ transform: "rotate(-12deg)", fontSize: "32px", fontWeight: "bold", color: "#bbb", textTransform: "uppercase", letterSpacing: "0.15em", whiteSpace: "nowrap", userSelect: "none", pointerEvents: "none" }}>
                    Fast and Testimony
                  </div>
                </div>
              ) : (
                <>
                  {[0, 1, 2].map((i) => {
                    const s = speakers[i];
                    return (
                      <div key={i} className="space-y-0.5 mt-0.5">
                        <div className="flex items-end justify-between gap-2 h-5">
                          <div className="flex items-end flex-1 truncate">
                            <strong className="shrink-0 mr-1">Testimony/Talk (by):</strong>
                            <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate font-medium">{s.name}</span>
                          </div>
                          <div className="flex gap-2 shrink-0 w-16">
                            <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                            <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                          </div>
                        </div>
                        <div className="flex items-end justify-between gap-2 h-5 pl-4">
                          <div className="flex items-end flex-1 truncate">
                            <strong className="shrink-0 mr-1 font-normal text-slate-700">Subject & references:</strong>
                            <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate text-[9px]">
                              {s.topic || s.reference ? `${s.topic || ""}${s.topic && s.reference ? " — " : ""}${s.reference || ""}` : ""}
                            </span>
                          </div>
                          <div className="flex gap-2 shrink-0 w-16">
                            <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                            <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <div className="space-y-0.5 mt-0.5">
                    <div className="flex items-end justify-between gap-2 h-5">
                      <div className="flex items-end flex-1 truncate">
                        <strong className="shrink-0 mr-1">Special Music:</strong>
                        <span className="border-b border-black flex-1 min-h-[1.1rem] px-1"></span>
                      </div>
                      <div className="flex gap-2 shrink-0 w-16">
                        <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                        <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                      </div>
                    </div>
                    <div className="text-[7.5px] italic text-slate-500 leading-none">
                      (Non F & T meetings only; by choir or occasional by congregation-sung standing)
                    </div>
                    <div className="text-[7px] italic text-slate-400 leading-none">
                      (Express gratitude to all those who have participated in the service thus far & to those who yet will; announce the rest of the program)
                    </div>
                  </div>

                  {[3, 4].map((i) => {
                    const s = speakers[i];
                    return (
                      <div key={i} className="space-y-0.5 mt-0.5">
                        <div className="flex items-end justify-between gap-2 h-5">
                          <div className="flex items-end flex-1 truncate">
                            <strong className="shrink-0 mr-1">Testimony/Talk (by):</strong>
                            <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate font-medium">{s.name}</span>
                          </div>
                          <div className="flex gap-2 shrink-0 w-16">
                            <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                            <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                          </div>
                        </div>
                        <div className="flex items-end justify-between gap-2 h-5 pl-4">
                          <div className="flex items-end flex-1 truncate">
                            <strong className="shrink-0 mr-1 font-normal text-slate-700">Subject & references:</strong>
                            <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate text-[9px]">
                              {s.topic || s.reference ? `${s.topic || ""}${s.topic && s.reference ? " — " : ""}${s.reference || ""}` : ""}
                            </span>
                          </div>
                          <div className="flex gap-2 shrink-0 w-16">
                            <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                            <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              <div className="text-[7.8px] italic text-slate-600 mt-1">
                <strong>Note:</strong> To ensure ending on time closing Hymn should commence not later than <span className="underline font-bold">8mins</span> before the closing time of sacrament meeting
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1">
                  <strong className="shrink-0 mr-1">Closing Hymn:</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agendaData.closing_hymn}</span>
                  <strong className="shrink-0 ml-2 mr-1">Hymn No:</strong>
                  <span className="border-b border-black w-14 text-center min-h-[1.1rem] px-1 font-semibold">{agendaData.closing_hymn_number}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1 truncate">
                  <strong className="shrink-0 mr-1">Closing Prayer (by):</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agendaData.closing_prayer}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5 mb-0.5">
                <div className="flex items-end flex-1 truncate">
                  <strong className="shrink-0 mr-1">Postlude Music (by organ only; not by choir):</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agendaData.postlude_music}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* PAGE 2: BACK PAGE */}
        <div className="agenda-page-container mt-0.5">
          <div className="agenda-page-border flex flex-col justify-between h-full border-2 border-black p-[0.25in] box-border text-[8.2px]">
            <div className="flex justify-between items-center mb-1 text-[7.5px] italic text-slate-500 border-b border-slate-200 pb-0.5">
              <span>Use additional sheet if necessary</span>
              <span>Sacrament Meeting business sheet</span>
            </div>

            {/* ANNOUNCEMENTS with printable lines inside table cells */}
            <div className="mb-1">
              <div className="font-bold text-[8.8px] uppercase tracking-wide bg-slate-100 p-0.5 pl-1.5 border-l-2 border-black mb-0.5">
                Announcements
              </div>
              <table className="w-full border-collapse border border-black text-[8px]">
                <tbody>
                  {[0, 1, 2].map((i) => (
                    <tr key={i} className="h-[17px]">
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 1}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%] align-bottom">
                        <div className="border-b border-black w-full min-h-[0.9rem] leading-none">
                          {announcementsList[i] || "\u00A0"}
                        </div>
                      </td>
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 4}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%] align-bottom">
                        <div className="border-b border-black w-full min-h-[0.9rem] leading-none">
                          {announcementsList[i + 3] || "\u00A0"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* BUSINESS / RELEASES & CALLS */}
            <div className="mb-1">
              <div className="font-bold text-[8.8px] uppercase tracking-wide bg-slate-100 p-0.5 pl-1.5 border-l-2 border-black mb-0.5">
                Business
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-center font-bold bg-black text-white p-0.5 text-[8px] uppercase">Releases</div>
                  <table className="w-full border-collapse border border-black text-[7.8px] text-left">
                    <thead>
                      <tr className="bg-slate-50 text-[6.8px] font-bold text-slate-600">
                        <th className="border border-black p-0.5 text-center w-5">#</th>
                        <th className="border border-black p-0.5 pl-1.5">First Middle SURNAME</th>
                        <th className="border border-black p-0.5 pl-1.5 w-24">AS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <tr key={i} className="h-[17px]">
                          <td className="border border-black p-0.5 text-center bg-slate-50 font-semibold">{i + 1}</td>
                          <td className="border border-black p-0.5 pl-1.5 truncate">{releasesList[i]?.name || "\u00A0"}</td>
                          <td className="border border-black p-0.5 pl-1.5 truncate">{releasesList[i]?.calling || "\u00A0"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div>
                  <div className="text-center font-bold bg-black text-white p-0.5 text-[8px] uppercase">Calls</div>
                  <table className="w-full border-collapse border border-black text-[7.8px] text-left">
                    <thead>
                      <tr className="bg-slate-50 text-[6.8px] font-bold text-slate-600">
                        <th className="border border-black p-0.5 text-center w-5">#</th>
                        <th className="border border-black p-0.5 pl-1.5">First Middle SURNAME</th>
                        <th className="border border-black p-0.5 pl-1.5 w-24">AS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <tr key={i} className="h-[17px]">
                          <td className="border border-black p-0.5 text-center bg-slate-50 font-semibold">{i + 1}</td>
                          <td className="border border-black p-0.5 pl-1.5 truncate">{callsList[i]?.name || "\u00A0"}</td>
                          <td className="border border-black p-0.5 pl-1.5 truncate">{callsList[i]?.calling || "\u00A0"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* BAPTIZED CHILDREN with printable lines */}
            <div className="mb-1">
              <div className="font-bold text-[8.5px] uppercase bg-slate-100 p-0.5 pl-1.5 border-l-2 border-black mb-0.5">
                Recognition of Newly Baptized Children of Record
              </div>
              <table className="w-full border-collapse border border-black text-[8px] text-left">
                <tbody>
                  {[0, 1].map((i) => (
                    <tr key={i} className="h-[17px]">
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 1}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%] align-bottom">
                        <div className="border-b border-black w-full min-h-[0.9rem] leading-none">
                          {baptizedChildren[i] || "\u00A0"}
                        </div>
                      </td>
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 3}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%] align-bottom">
                        <div className="border-b border-black w-full min-h-[0.9rem] leading-none">
                          {baptizedChildren[i + 2] || "\u00A0"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* AARONIC ORDINATIONS */}
            <div className="mb-1">
              <div className="font-bold text-[8.5px] uppercase bg-slate-100 p-0.5 pl-1.5 border-l-2 border-black mb-0.5">
                Aaronic Priesthood Ordinations
              </div>
              <table className="w-full border-collapse border border-black text-[7.8px] text-left">
                <thead>
                  <tr>
                    <th className="border border-black p-0.5 text-center w-5" rowSpan={2}>No</th>
                    <th className="border border-black p-0.5 text-center font-bold" colSpan={2}>Name of person to be ordained</th>
                    <th className="border border-black p-0.5 text-center font-bold" colSpan={2}>Ordained by</th>
                  </tr>
                  <tr className="bg-slate-50 text-[6.5px] font-semibold text-slate-600">
                    <th className="border border-black p-0.5 pl-1">First Middle SURNAME</th>
                    <th className="border border-black p-0.5 pl-1 w-16 text-center">Office</th>
                    <th className="border border-black p-0.5 pl-1">First Middle SURNAME</th>
                    <th className="border border-black p-0.5 pl-1 w-16 text-center">Office</th>
                  </tr>
                </thead>
                <tbody>
                  {ordinations.map((o, i) => (
                    <tr key={i} className="h-[17px]">
                      <td className="border border-black p-0.5 text-center bg-slate-50">{i + 1}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{o.name || "\u00A0"}</td>
                      <td className="border border-black p-0.5 text-center truncate">{o.office || "\u00A0"}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{o.ordained_by || "\u00A0"}</td>
                      <td className="border border-black p-0.5 text-center truncate">{o.ordained_by_office || "\u00A0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* AARONIC ADVANCEMENTS */}
            <div className="mb-1">
              <div className="font-bold text-[8.5px] uppercase bg-slate-100 p-0.5 pl-1.5 border-l-2 border-black mb-0.5">
                Aaronic Priesthood Advancements
              </div>
              <table className="w-full border-collapse border border-black text-[7.8px] text-left">
                <thead>
                  <tr>
                    <th className="border border-black p-0.5 text-center w-5" rowSpan={2}>No</th>
                    <th className="border border-black p-0.5 text-center font-bold" colSpan={3}>Name of person to be ordained</th>
                    <th className="border border-black p-0.5 text-center font-bold" colSpan={2}>Ordained by</th>
                  </tr>
                  <tr className="bg-slate-50 text-[6.5px] font-semibold text-slate-600">
                    <th className="border border-black p-0.5 pl-1">First Middle SURNAME</th>
                    <th className="border border-black p-0.5 w-12 text-center">From</th>
                    <th className="border border-black p-0.5 w-12 text-center">To</th>
                    <th className="border border-black p-0.5 pl-1">First Middle SURNAME</th>
                    <th className="border border-black p-0.5 w-16 text-center">Office</th>
                  </tr>
                </thead>
                <tbody>
                  {advancements.map((a, i) => (
                    <tr key={i} className="h-[17px]">
                      <td className="border border-black p-0.5 text-center bg-slate-50">{i + 1}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{a.name || "\u00A0"}</td>
                      <td className="border border-black p-0.5 text-center truncate">{a.office_from || "\u00A0"}</td>
                      <td className="border border-black p-0.5 text-center truncate">{a.office_to || "\u00A0"}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{a.ordained_by || "\u00A0"}</td>
                      <td className="border border-black p-0.5 text-center truncate">{a.ordained_by_office || "\u00A0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* RECOGNITION OF ACHIEVEMENTS with printable lines */}
            <div className="mb-1">
              <div className="font-bold text-[8.5px] uppercase bg-slate-100 p-0.5 pl-1.5 border-l-2 border-black mb-0.5">
                Recognition of Advancements & Achievements
              </div>
              <table className="w-full border-collapse border border-black text-[8px] text-left">
                <tbody>
                  {[0, 1].map((i) => (
                    <tr key={i} className="h-[17px]">
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 1}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%] align-bottom">
                        <div className="border-b border-black w-full min-h-[0.9rem] leading-none">
                          {achievementsList[i] || "\u00A0"}
                        </div>
                      </td>
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 3}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%] align-bottom">
                        <div className="border-b border-black w-full min-h-[0.9rem] leading-none">
                          {achievementsList[i + 2] || "\u00A0"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* BABY BLESSINGS */}
            <div className="mb-1">
              <div className="font-bold text-[8.5px] uppercase bg-slate-100 p-0.5 pl-1.5 border-l-2 border-black mb-0.5">
                Naming & Blessing of Newly-born Babies
              </div>
              <table className="w-full border-collapse border border-black text-[7.8px] text-left">
                <thead>
                  <tr className="bg-slate-50 text-[7px] font-bold text-slate-600">
                    <th className="border border-black p-0.5 text-center w-5">No</th>
                    <th className="border border-black p-0.5 pl-1">Family</th>
                    <th className="border border-black p-0.5 pl-1">Baby Name (SURNAME, First Middle)</th>
                    <th className="border border-black p-0.5 pl-1">Blessed by</th>
                    <th className="border border-black p-0.5 w-16 text-center">Office</th>
                  </tr>
                </thead>
                <tbody>
                  {babiesList.map((b, i) => (
                    <tr key={i} className="h-[17px]">
                      <td className="border border-black p-0.5 text-center bg-slate-50">{i + 1}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{b.family || "\u00A0"}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{b.baby_name || "\u00A0"}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{b.blessed_by || "\u00A0"}</td>
                      <td className="border border-black p-0.5 text-center truncate">{b.blessed_by_office || "\u00A0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* CONFIRMATIONS */}
            <div className="mb-1">
              <div className="font-bold text-[8.5px] uppercase bg-slate-100 p-0.5 pl-1.5 border-l-2 border-black mb-0.5">
                Confirmation & Bestowal of Gift of Holy Ghost
              </div>
              <table className="w-full border-collapse border border-black text-[7.8px] text-left">
                <thead>
                  <tr className="bg-slate-50 text-[7px] font-bold text-slate-600">
                    <th className="border border-black p-0.5 text-center w-5">No</th>
                    <th className="border border-black p-0.5 pl-1">Name to be Confirmed</th>
                    <th className="border border-black p-0.5 pl-1">Confirmed by</th>
                    <th className="border border-black p-0.5 w-16 text-center">Office</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmationsList.map((c, i) => (
                    <tr key={i} className="h-[17px]">
                      <td className="border border-black p-0.5 text-center bg-slate-50">{i + 1}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{c.name || "\u00A0"}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{c.confirmed_by || "\u00A0"}</td>
                      <td className="border border-black p-0.5 text-center truncate">{c.confirmed_by_office || "\u00A0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* FELLOWSHIPS with printable lines */}
            <div>
              <div className="font-bold text-[8.5px] uppercase bg-slate-100 p-0.5 pl-1.5 border-l-2 border-black mb-0.5">
                Receive into Fellowship
              </div>
              <table className="w-full border-collapse border border-black text-[8px] text-left">
                <tbody>
                  {[0, 1, 2, 3].map((i) => (
                    <tr key={i} className="h-[17px]">
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 1}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%] align-bottom">
                        <div className="border-b border-black w-full min-h-[0.9rem] leading-none">
                          {fellowshipsList[i] || "\u00A0"}
                        </div>
                      </td>
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 5}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%] align-bottom">
                        <div className="border-b border-black w-full min-h-[0.9rem] leading-none">
                          {fellowshipsList[i + 4] || "\u00A0"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        </div>

      </div>
    );
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      
      {/* Header Banner */}
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Meeting Agenda Planner</h1>
          <p className="mt-1 text-sm text-slate-500">Prepare, manage, search, and print Sacrament Meeting Agendas.</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs>
        <div className="border-b border-slate-200 mb-6">
          <TabsList>
            <TabsTrigger active={activeTab === "prepare"} onClick={() => {
              if (activeTab === "prepare" || !isDirty) {
                setActiveTab("prepare");
              } else {
                const proceed = window.confirm("You have unsaved changes. Do you want to discard them?");
                if (proceed) {
                  setIsDirty(false);
                  setActiveTab("prepare");
                }
              }
            }}>Prepare Agenda</TabsTrigger>
            <TabsTrigger active={activeTab === "saved"} onClick={() => {
              if (!isDirty) {
                setActiveTab("saved");
              } else {
                const proceed = window.confirm("You have unsaved changes. Do you want to discard them?");
                if (proceed) {
                  setIsDirty(false);
                  setActiveTab("saved");
                }
              }
            }}>Saved Agendas ({savedAgendasList.length})</TabsTrigger>
            <TabsTrigger active={activeTab === "preview"} onClick={() => {
              if (!isDirty) {
                setActiveTab("preview");
              } else {
                const proceed = window.confirm("You have unsaved changes. Do you want to discard them?");
                if (proceed) {
                  setIsDirty(false);
                  setActiveTab("preview");
                }
              }
            }}>Live Sheet Preview</TabsTrigger>
          </TabsList>
        </div>

        {/* TAB 1: PREPARE AGENDA */}
        <TabsContent active={activeTab === "prepare"}>
          
          {/* Selection Filter Bar */}
          <Card className="mb-6 border border-slate-100 bg-white/60 shadow-sm backdrop-blur-md">
            <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <Label className="text-slate-600 font-semibold mb-1 block">1. Select Planner</Label>
                <Select value={selectedPlannerId} onChange={e => handleSelectPlannerChange(e.target.value)} className="w-full">
                  {activePlanners.length === 0 && <option value="">No Active Planners</option>}
                  {activePlanners.map(p => (
                    <option key={p.planner_id} value={p.planner_id}>{p.month}/{p.year} — {p.unit_name}</option>
                  ))}
                </Select>
              </div>
              
              <div>
                <Label className="text-slate-600 font-semibold mb-1 block">2. Select Week</Label>
                <Select value={selectedWeekId} onChange={e => handleSelectWeekChange(e.target.value)} disabled={!activePlanner} className="w-full">
                  {activePlanner?.weeks.map(w => (
                    <option key={w.week_id} value={w.week_id}>{formatDateShort(w.date)}</option>
                  ))}
                </Select>
              </div>

              <div>
                <Label className="text-slate-600 font-semibold mb-1 block">3. Choose Agenda</Label>
                <div className="flex gap-2 items-center">
                  <Select value={selectedAgendaId || ""} onChange={e => handleSelectAgendaChange(e.target.value)} disabled={!activeWeek || allAgendasForWeek.length === 0} className="flex-1">
                    {allAgendasForWeek.length === 0 && <option value="">No Agendas Created</option>}
                    {allAgendasForWeek.map(a => (
                      <option key={a.agenda_id} value={a.agenda_id}>
                        Agenda — {formatDateShort(a.date)} [{a.state}]
                      </option>
                    ))}
                  </Select>
                  {canCreate && activeWeek && (
                    <Button onClick={handleCreateAgenda} className="whitespace-nowrap bg-blue-600 text-white font-semibold">
                      + New
                    </Button>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          {activePlanner && activeWeek ? (
            localAgenda ? (
              <div className="space-y-6">
                
                {/* Top Toolbar / Actions */}
                <div className="flex flex-wrap justify-between items-center gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <Badge tone={localAgenda.state === "DRAFT" ? "blue" : localAgenda.state === "SUBMITTED" ? "green" : "gray"} className="text-xs px-2.5 py-1">
                      {existsInDB ? localAgenda.state : "UNSAVED DRAFT"}
                    </Badge>
                    {isDirty && (
                      <span className="text-xs text-amber-600 font-bold flex items-center gap-1">
                        ⚠️ Unsaved changes
                      </span>
                    )}
                    {!isDirty && existsInDB && (
                      <span className="text-xs text-slate-500 font-medium">Last saved {new Date(localAgenda.updated_date).toLocaleString()}</span>
                    )}
                  </div>
                  
                  <div className="flex flex-wrap gap-2">
                    {canEdit && (
                      <>
                        <Button
                          variant="outline"
                          onClick={existsInDB ? () => setShowDeleteModal(true) : () => {
                            if (!isDirty || window.confirm("Discard this new unsaved agenda?")) {
                              setLocalAgenda(null);
                              setIsDirty(false);
                            }
                          }}
                          className="text-rose-600 border-rose-200 hover:bg-rose-50"
                          icon="🗑️"
                        >
                          Delete
                        </Button>
                        <Button variant="secondary" onClick={archiveAgenda} disabled={!existsInDB} className="disabled:opacity-40" icon="📦">Archive</Button>
                        {isDirty && (
                          <Button variant="ghost" onClick={discardChanges} className="text-slate-500">Discard Changes</Button>
                        )}
                        <Button onClick={saveAgenda} className="bg-emerald-600 text-white hover:bg-emerald-700" icon="💾">Save</Button>
                      </>
                    )}
                    {canPrint && (
                      <>
                        <Button variant="secondary" onClick={handleDownload} icon="📥">Download PDF</Button>
                        <Button onClick={handlePrint} className="bg-blue-600 text-white" icon="🖨️">Print Agenda</Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Prepare Agenda Sections */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* Unit & Settings Card */}
                  <Card className="shadow-sm border border-slate-100">
                    <CardHeader><CardTitle>Unit & Meeting Settings</CardTitle></CardHeader>
                    <CardBody className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Ward / Branch</Label>
                          <Input value={localAgenda.ward_branch} onChange={e => updateAgendaField("ward_branch", e.target.value)} disabled={!canEdit} />
                        </div>
                        <div>
                          <Label>Stake / District</Label>
                          <Input value={localAgenda.stake_district} onChange={e => updateAgendaField("stake_district", e.target.value)} disabled={!canEdit} />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2">
                          <Label>Type of Meeting</Label>
                          <Select value={localAgenda.type_of_meeting} onChange={e => updateAgendaField("type_of_meeting", e.target.value)} disabled={!canEdit}>
                            <option value="Sacrament Meeting">Sacrament Meeting</option>
                            <option value="Fast & Testimony">Fast & Testimony (F & T)</option>
                            <option value="Stake/District Meeting">Stake/District Meeting</option>
                            <option value="Ward/Branch Conference">Ward/Branch Conference</option>
                            <option value="Other">Other (Specify Below)</option>
                          </Select>
                        </div>
                        <div>
                          <Label>Start Time</Label>
                          <Input value={localAgenda.start_time} onChange={e => updateAgendaField("start_time", e.target.value)} disabled={!canEdit} />
                        </div>
                      </div>
                      {localAgenda.type_of_meeting === "Other" && (
                        <div>
                          <Label>Specify Other Meeting Type</Label>
                          <Input value={localAgenda.other_meeting_specify || ""} onChange={e => updateAgendaField("other_meeting_specify", e.target.value)} disabled={!canEdit} />
                        </div>
                      )}
                      <div>
                        <Label>Prelude Music</Label>
                        <Input value={localAgenda.prelude_music} onChange={e => updateAgendaField("prelude_music", e.target.value)} placeholder="Choir selection or organist selection" disabled={!canEdit} />
                      </div>
                      <div>
                        <Label>Postlude Music</Label>
                        <Input value={localAgenda.postlude_music} onChange={e => updateAgendaField("postlude_music", e.target.value)} placeholder="Organist selection only" disabled={!canEdit} />
                      </div>
                    </CardBody>
                  </Card>

                  {/* Officers & Music Coordinators */}
                  <Card className="shadow-sm border border-slate-100">
                    <CardHeader><CardTitle>Officiating Officers & Music</CardTitle></CardHeader>
                    <CardBody className="space-y-4">
                       <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <Label>Presiding Officer Name</Label>
                          <Input value={localAgenda.presiding} onChange={e => updateAgendaField("presiding", e.target.value)} placeholder="e.g. Olajide" disabled={!canEdit} />
                        </div>
                        <div>
                          <Label>Presiding Officer Position</Label>
                          <Input value={localAgenda.presiding_position || ""} onChange={e => updateAgendaField("presiding_position", e.target.value)} placeholder="e.g. Bishop" disabled={!canEdit} />
                        </div>
                        <div>
                          <Label>Conducting Officer</Label>
                          <Input value={localAgenda.conducting} onChange={e => updateAgendaField("conducting", e.target.value)} placeholder="Name & Position" disabled={!canEdit} />
                        </div>
                      </div>
                      <div>
                        <Label>Music Director</Label>
                        <Input value={localAgenda.music_director} onChange={e => updateAgendaField("music_director", e.target.value)} disabled={!canEdit} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Choir Director</Label>
                          <Input value={localAgenda.choir_director} onChange={e => updateAgendaField("choir_director", e.target.value)} disabled={!canEdit} />
                        </div>
                        <div>
                          <Label>Organist / Pianist</Label>
                          <Input value={localAgenda.organist} onChange={e => updateAgendaField("organist", e.target.value)} disabled={!canEdit} />
                        </div>
                      </div>
                    </CardBody>
                  </Card>

                  {/* Combined Greetings and Welcome */}
                  <Card className="shadow-sm border border-slate-100 md:col-span-2">
                    <CardHeader><CardTitle>Standard Welcome & Business Details</CardTitle></CardHeader>
                    <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="md:col-span-2">
                        <Label>Greetings & Welcome / Acknowledgements</Label>
                        <Input 
                          value={localAgenda.greetings_welcome} 
                          onChange={e => updateAgendaField("greetings_welcome", e.target.value)} 
                          placeholder="Shared text printed under both Greetings & Welcome and Acknowledgements"
                          disabled={!canEdit} 
                        />
                      </div>
                      <div>
                        <Label>Ward / Branch Business</Label>
                        <Input value={localAgenda.ward_branch_business} onChange={e => updateAgendaField("ward_branch_business", e.target.value)} disabled={!canEdit} />
                      </div>
                      <div>
                        <Label>Stake / District Business (by)</Label>
                        <Input value={localAgenda.stake_district_business} onChange={e => updateAgendaField("stake_district_business", e.target.value)} disabled={!canEdit} />
                      </div>
                      <div>
                        <Label>Naming & Blessing note</Label>
                        <Input value={localAgenda.naming_blessing} onChange={e => updateAgendaField("naming_blessing", e.target.value)} placeholder="e.g. Blessing of new-born babies" disabled={!canEdit} />
                      </div>
                      <div>
                        <Label>Confirmation & Bestowal note</Label>
                        <Input value={localAgenda.confirmation_bestowal} onChange={e => updateAgendaField("confirmation_bestowal", e.target.value)} placeholder="e.g. Confirmation of new members" disabled={!canEdit} />
                      </div>
                    </CardBody>
                  </Card>

                  {/* Sacrament & Hymns */}
                  <Card className="shadow-sm border border-slate-100 md:col-span-2">
                    <CardHeader><CardTitle>Hymns & Prayers</CardTitle></CardHeader>
                    <CardBody className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-4">
                        <div className="text-xs font-bold text-slate-700 border-b pb-1">Opening Services</div>
                        <div>
                          <Label>Opening Hymn Title / Name</Label>
                          <Input value={localAgenda.opening_hymn} onChange={e => updateAgendaField("opening_hymn", e.target.value)} disabled={!canEdit} />
                        </div>
                        <div>
                          <Label>Opening Hymn Number</Label>
                          <Input value={localAgenda.opening_hymn_number} onChange={e => updateAgendaField("opening_hymn_number", e.target.value)} disabled={!canEdit} />
                        </div>
                        <div>
                          <Label>Opening Prayer (Invocation)</Label>
                          <Input value={localAgenda.opening_prayer} onChange={e => updateAgendaField("opening_prayer", e.target.value)} disabled={!canEdit} />
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="text-xs font-bold text-slate-700 border-b pb-1">Sacrament Services</div>
                        <div>
                          <Label>Sacrament Hymn Title</Label>
                          <Input value={localAgenda.sacrament_hymn} onChange={e => updateAgendaField("sacrament_hymn", e.target.value)} disabled={!canEdit} />
                        </div>
                        <div>
                          <Label>Sacrament Hymn Number</Label>
                          <Input value={localAgenda.sacrament_hymn_number} onChange={e => updateAgendaField("sacrament_hymn_number", e.target.value)} disabled={!canEdit} />
                        </div>
                        <div>
                          <Label>Special Music (F&T only)</Label>
                          <Input value={localAgenda.special_music} onChange={e => updateAgendaField("special_music", e.target.value)} placeholder="if any, by choir" disabled={!canEdit} />
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="text-xs font-bold text-slate-700 border-b pb-1">Closing Services</div>
                        <div>
                          <Label>Closing Hymn Title</Label>
                          <Input value={localAgenda.closing_hymn} onChange={e => updateAgendaField("closing_hymn", e.target.value)} disabled={!canEdit} />
                        </div>
                        <div>
                          <Label>Closing Hymn Number</Label>
                          <Input value={localAgenda.closing_hymn_number} onChange={e => updateAgendaField("closing_hymn_number", e.target.value)} disabled={!canEdit} />
                        </div>
                        <div>
                          <Label>Closing Prayer (Benediction)</Label>
                          <Input value={localAgenda.closing_prayer} onChange={e => updateAgendaField("closing_prayer", e.target.value)} disabled={!canEdit} />
                        </div>
                      </div>
                    </CardBody>
                  </Card>

                  {/* Speakers */}
                  <Card className="shadow-sm border border-slate-100 md:col-span-2">
                    <CardHeader><CardTitle>Sacrament Meeting Speakers (up to 5)</CardTitle></CardHeader>
                    <CardBody className="space-y-3">
                      {speakers.map((s, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-3 items-end border-b border-slate-50 pb-2.5 last:border-0 last:pb-0">
                          <div className="col-span-1 text-center font-bold text-slate-500 pb-2">{idx + 1}</div>
                          <div className="col-span-4">
                            <Label>Speaker Name</Label>
                            <Input value={s.name} onChange={e => updateAgendaSpeaker(idx, 'name', e.target.value)} disabled={!canEdit} />
                          </div>
                          <div className="col-span-4">
                            <Label>Topic</Label>
                            <Input value={s.topic} onChange={e => updateAgendaSpeaker(idx, 'topic', e.target.value)} placeholder="Topic" disabled={!canEdit} />
                          </div>
                          <div className="col-span-3">
                            <Label>Reference</Label>
                            <Input value={s.reference || ""} onChange={e => updateAgendaSpeaker(idx, 'reference', e.target.value)} placeholder="Scripture/Talk" disabled={!canEdit} />
                          </div>
                        </div>
                      ))}
                    </CardBody>
                  </Card>

                  {/* Announcements */}
                  <Card className="shadow-sm border border-slate-100 md:col-span-2">
                    <CardHeader><CardTitle>Announcements (6 slots)</CardTitle></CardHeader>
                    <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {announcementsList.map((a, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="font-semibold text-slate-500 w-4">{idx + 1}.</span>
                          <Input value={a} onChange={e => updateAnnouncement(idx, e.target.value)} placeholder="Stake/Ward Announcement details" disabled={!canEdit} />
                        </div>
                      ))}
                    </CardBody>
                  </Card>

                  {/* Releases & Calls */}
                  <Card className="shadow-sm border border-slate-100">
                    <CardHeader><CardTitle>Releases (6 slots)</CardTitle></CardHeader>
                    <CardBody className="space-y-2">
                      {releasesList.map((r, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                          <span className="col-span-1 text-center font-bold text-slate-500">{idx + 1}</span>
                          <div className="col-span-6">
                            <Input value={r.name} onChange={e => updateRelease(idx, 'name', e.target.value)} placeholder="First Middle SURNAME" disabled={!canEdit} />
                          </div>
                          <div className="col-span-5">
                            <Input value={r.calling} onChange={e => updateRelease(idx, 'calling', e.target.value)} placeholder=" AS Calling" disabled={!canEdit} />
                          </div>
                        </div>
                      ))}
                    </CardBody>
                  </Card>

                  <Card className="shadow-sm border border-slate-100">
                    <CardHeader><CardTitle>Calls (6 slots)</CardTitle></CardHeader>
                    <CardBody className="space-y-2">
                      {callsList.map((c, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                          <span className="col-span-1 text-center font-bold text-slate-500">{idx + 1}</span>
                          <div className="col-span-6">
                            <Input value={c.name} onChange={e => updateCall(idx, 'name', e.target.value)} placeholder="First Middle SURNAME" disabled={!canEdit} />
                          </div>
                          <div className="col-span-5">
                            <Input value={c.calling} onChange={e => updateCall(idx, 'calling', e.target.value)} placeholder=" AS Calling" disabled={!canEdit} />
                          </div>
                        </div>
                      ))}
                    </CardBody>
                  </Card>

                  {/* Newly Baptized Children & Achievements */}
                  <Card className="shadow-sm border border-slate-100">
                    <CardHeader><CardTitle>Newly Baptized Children (4 slots)</CardTitle></CardHeader>
                    <CardBody className="space-y-2">
                      {baptizedChildren.map((b, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="font-semibold text-slate-500 w-4">{idx + 1}.</span>
                          <Input value={b} onChange={e => updateBaptizedChild(idx, e.target.value)} placeholder="First Middle SURNAME" disabled={!canEdit} />
                        </div>
                      ))}
                    </CardBody>
                  </Card>

                  <Card className="shadow-sm border border-slate-100">
                    <CardHeader><CardTitle>Recognition of Achievements (4 slots)</CardTitle></CardHeader>
                    <CardBody className="space-y-2">
                      {achievementsList.map((a, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="font-semibold text-slate-500 w-4">{idx + 1}.</span>
                          <Input value={a} onChange={e => updateAchievement(idx, e.target.value)} placeholder="Advancement or achievement details" disabled={!canEdit} />
                        </div>
                      ))}
                    </CardBody>
                  </Card>

                  {/* Ordinations & Advancements */}
                  <Card className="shadow-sm border border-slate-100 md:col-span-2">
                    <CardHeader><CardTitle>Aaronic Priesthood Ordinations (4 slots)</CardTitle></CardHeader>
                    <CardBody className="space-y-3">
                      {ordinations.map((o, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-3 items-end border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                          <div className="col-span-1 text-center font-bold text-slate-500 pb-2">{idx + 1}</div>
                          <div className="col-span-4">
                            <Label>Name of Ordained</Label>
                            <Input value={o.name} onChange={e => updateOrdination(idx, 'name', e.target.value)} placeholder="First Middle SURNAME" disabled={!canEdit} />
                          </div>
                          <div className="col-span-2">
                            <Label>Office</Label>
                            <Input value={o.office} onChange={e => updateOrdination(idx, 'office', e.target.value)} placeholder="Deacon/Teacher/Priest" disabled={!canEdit} />
                          </div>
                          <div className="col-span-3">
                            <Label>Ordained By</Label>
                            <Input value={o.ordained_by} onChange={e => updateOrdination(idx, 'ordained_by', e.target.value)} placeholder="First Middle SURNAME" disabled={!canEdit} />
                          </div>
                          <div className="col-span-2">
                            <Label>Office</Label>
                            <Input value={o.ordained_by_office} onChange={e => updateOrdination(idx, 'ordained_by_office', e.target.value)} placeholder="High Priest/Elder" disabled={!canEdit} />
                          </div>
                        </div>
                      ))}
                    </CardBody>
                  </Card>

                  <Card className="shadow-sm border border-slate-100 md:col-span-2">
                    <CardHeader><CardTitle>Aaronic Priesthood Advancements (4 slots)</CardTitle></CardHeader>
                    <CardBody className="space-y-3">
                      {advancements.map((a, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-3 items-end border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                          <div className="col-span-1 text-center font-bold text-slate-500 pb-2">{idx + 1}</div>
                          <div className="col-span-3">
                            <Label>Name</Label>
                            <Input value={a.name} onChange={e => updateAdvancement(idx, 'name', e.target.value)} placeholder="First Middle SURNAME" disabled={!canEdit} />
                          </div>
                          <div className="col-span-1.5">
                            <Label>From</Label>
                            <Input value={a.office_from} onChange={e => updateAdvancement(idx, 'office_from', e.target.value)} placeholder="From" disabled={!canEdit} />
                          </div>
                          <div className="col-span-1.5">
                            <Label>To</Label>
                            <Input value={a.office_to} onChange={e => updateAdvancement(idx, 'office_to', e.target.value)} placeholder="To" disabled={!canEdit} />
                          </div>
                          <div className="col-span-3">
                            <Label>Ordained By</Label>
                            <Input value={a.ordained_by} onChange={e => updateAdvancement(idx, 'ordained_by', e.target.value)} placeholder="First Middle SURNAME" disabled={!canEdit} />
                          </div>
                          <div className="col-span-2">
                            <Label>Office</Label>
                            <Input value={a.ordained_by_office} onChange={e => updateAdvancement(idx, 'ordained_by_office', e.target.value)} placeholder="High Priest/Elder" disabled={!canEdit} />
                          </div>
                        </div>
                      ))}
                    </CardBody>
                  </Card>

                  {/* Babies Blessing */}
                  <Card className="shadow-sm border border-slate-100 md:col-span-2">
                    <CardHeader><CardTitle>Naming & Blessing of Babies (4 slots)</CardTitle></CardHeader>
                    <CardBody className="space-y-3">
                      {babiesList.map((b, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-3 items-end border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                          <div className="col-span-1 text-center font-bold text-slate-500 pb-2">{idx + 1}</div>
                          <div className="col-span-3">
                            <Label>Family Name</Label>
                            <Input value={b.family} onChange={e => updateBaby(idx, 'family', e.target.value)} placeholder="Family Name" disabled={!canEdit} />
                          </div>
                          <div className="col-span-3">
                            <Label>Baby Name</Label>
                            <Input value={b.baby_name} onChange={e => updateBaby(idx, 'baby_name', e.target.value)} placeholder="SURNAME, First Middle" disabled={!canEdit} />
                          </div>
                          <div className="col-span-3">
                            <Label>Blessed By</Label>
                            <Input value={b.blessed_by} onChange={e => updateBaby(idx, 'blessed_by', e.target.value)} placeholder="First Middle SURNAME" disabled={!canEdit} />
                          </div>
                          <div className="col-span-2">
                            <Label>Office</Label>
                            <Input value={b.blessed_by_office} onChange={e => updateBaby(idx, 'blessed_by_office', e.target.value)} placeholder="Elder/High Priest" disabled={!canEdit} />
                          </div>
                        </div>
                      ))}
                    </CardBody>
                  </Card>

                  {/* Confirmations */}
                  <Card className="shadow-sm border border-slate-100 md:col-span-2">
                    <CardHeader><CardTitle>Confirmation & Bestowal of Holy Ghost (6 slots)</CardTitle></CardHeader>
                    <CardBody className="space-y-3">
                      {confirmationsList.map((c, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-3 items-end border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                          <div className="col-span-1 text-center font-bold text-slate-500 pb-2">{idx + 1}</div>
                          <div className="col-span-4">
                            <Label>Confirmed Name</Label>
                            <Input value={c.name} onChange={e => updateConfirmation(idx, 'name', e.target.value)} placeholder="First Middle SURNAME" disabled={!canEdit} />
                          </div>
                          <div className="col-span-4">
                            <Label>Confirmed By</Label>
                            <Input value={c.confirmed_by} onChange={e => updateConfirmation(idx, 'confirmed_by', e.target.value)} placeholder="First Middle SURNAME" disabled={!canEdit} />
                          </div>
                          <div className="col-span-3">
                            <Label>Office</Label>
                            <Input value={c.confirmed_by_office} onChange={e => updateConfirmation(idx, 'confirmed_by_office', e.target.value)} placeholder="Elder/High Priest" disabled={!canEdit} />
                          </div>
                        </div>
                      ))}
                    </CardBody>
                  </Card>

                  {/* Fellowship */}
                  <Card className="shadow-sm border border-slate-100 md:col-span-2">
                    <CardHeader><CardTitle>Receive into Fellowship (8 slots)</CardTitle></CardHeader>
                    <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {fellowshipsList.map((f, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="font-semibold text-slate-500 w-4">{idx + 1}.</span>
                          <Input value={f} onChange={e => updateFellowship(idx, e.target.value)} placeholder="First Middle SURNAME (New member / Move-in)" disabled={!canEdit} />
                        </div>
                      ))}
                    </CardBody>
                  </Card>

                </div>
              </div>
            ) : (
              <EmptyState
                icon="📄"
                title="No Agenda Loaded"
                description="Select an existing agenda or click '+ New' to prepare a sacrament agenda for this week."
                action={
                  canCreate ? (
                    <Button onClick={handleCreateAgenda} className="bg-blue-600 text-white font-semibold">Create Agenda</Button>
                  ) : undefined
                }
              />
            )
          ) : (
            <EmptyState
              icon="📅"
              title="Select a Week"
              description="Please select an active planner and a week to begin preparing its agenda."
            />
          )}

        </TabsContent>

        {/* TAB 2: SAVED AGENDAS LIST & SEARCH */}
        <TabsContent active={activeTab === "saved"}>
          
          {/* Search bar */}
          <div className="mb-6 flex gap-4 items-center">
            <div className="flex-1">
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="🔍 Search saved agendas by Date, Ward, Presiding Officer, Conducting..."
                className="w-full shadow-sm bg-white"
              />
            </div>
            {searchQuery && (
              <Button variant="ghost" onClick={() => setSearchQuery("")}>Clear</Button>
            )}
          </div>

          {filteredAgendas.length === 0 ? (
            <EmptyState
              icon="🔍"
              title="No saved agendas found"
              description="No agendas matched your search criteria, or no agendas have been saved yet."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredAgendas.map((agenda: Agenda) => (
                <Card key={agenda.agenda_id} className="border border-slate-100 hover:shadow-md transition duration-200">
                  <CardHeader className="flex flex-row items-center justify-between gap-3 border-0 pb-1">
                    <div className="space-y-1">
                      <CardTitle className="normal-case font-bold text-base text-slate-800">
                        Sacrament Agenda — {formatDateShort(agenda.date)}
                      </CardTitle>
                      <div className="text-xs text-slate-500">
                        Created by {agenda.created_by.slice(0, 8)} | Updated {new Date(agenda.updated_date).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={agenda.state === "DRAFT" ? "blue" : "green"}>{agenda.state}</Badge>
                      <Button variant="secondary" onClick={() => setPreviewAgenda(agenda)} size="sm" icon="👁️">Preview</Button>
                      {canEdit && (
                        <>
                          <Button variant="primary" onClick={() => handleLoadSavedAgenda(agenda)} size="sm" icon="✏️">Edit</Button>
                          <Button variant="secondary" onClick={() => handleArchiveDirect(agenda)} size="sm" icon="📦">Archive</Button>
                          <Button variant="outline" onClick={() => handleDeleteDirect(agenda)} size="sm" className="text-rose-600 border-rose-200 hover:bg-rose-50" icon="🗑️">Delete</Button>
                        </>
                      )}
                      {canPrint && (
                        <>
                          <Button variant="secondary" onClick={() => handleAgendaDownloadDirect(agenda)} size="sm" icon="📥">PDF</Button>
                          <Button variant="secondary" onClick={() => handleAgendaPrintDirect(agenda)} size="sm" icon="🖨️">Print</Button>
                        </>
                      )}
                    </div>
                  </CardHeader>
                  <CardBody className="pt-2">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-4 text-xs">
                      <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Ward/Branch</div>
                        <div className="font-semibold text-slate-700 mt-0.5">{agenda.ward_branch}</div>
                      </div>
                      <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Stake/District</div>
                        <div className="font-semibold text-slate-700 mt-0.5">{agenda.stake_district}</div>
                      </div>
                      <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Presiding</div>
                        <div className="font-semibold text-slate-700 mt-0.5">{agenda.presiding || "—"}</div>
                      </div>
                      <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Conducting</div>
                        <div className="font-semibold text-slate-700 mt-0.5">{agenda.conducting || "—"}</div>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}

        </TabsContent>

        {/* TAB 3: LIVE PREVIEW */}
        <TabsContent active={activeTab === "preview"}>
          {localAgenda ? (
            <div className="space-y-4">
              <div className="flex justify-end gap-3 p-4 bg-slate-100 border border-slate-200 rounded-xl">
                <Button variant="secondary" onClick={handleDownload} icon="📥">Download PDF</Button>
                <Button onClick={handlePrint} className="bg-blue-600 text-white" icon="🖨️">Print Agenda</Button>
              </div>
              <div className="flex flex-col items-center justify-center p-6 bg-slate-700 rounded-xl overflow-auto w-full">
                <div className="bg-white shadow-2xl rounded-md">
                  {renderAgendaDocument(localAgenda)}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              icon="👁️"
              title="No Agenda Loaded"
              description="Please select or create an agenda to see its preview."
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Pre-mounted off-screen container for instant print and PDF download */}
      {createPortal(
        <div className="hidden-print-container">
          <div ref={printContentRef} className="agenda-print-sheet">
            {renderAgendaDocument(localAgenda)}
          </div>
        </div>,
        document.getElementById("planner-print-portal") || document.body
      )}
      <style dangerouslySetInnerHTML={{__html: `
        /* Position offscreen for layout rendering without flash */
        .hidden-print-container {
          position: fixed;
          left: 0;
          top: 0;
          width: 8.5in;
          z-index: -9999;
          background: white;
        }
        
        .agenda-print-sheet {
          width: 8.5in;
          background-color: white;
          color: black;
        }
        
        .agenda-page-container {
          width: 8.5in;
          height: 11in;
          min-height: 11in;
          max-height: 11in;
          padding: 0.3in 0.4in;
          box-sizing: border-box;
          background: white;
          overflow: hidden;
          position: relative;
        }
        
        @media print {
          body { 
            background: white !important; 
            margin: 0 !important; 
            padding: 0 !important; 
          }
          /* Hide everything in #root on print */
          #root { 
            display: none !important; 
          }
          /* Print only the portal container */
          .hidden-print-container {
            position: relative !important;
            left: auto !important;
            top: auto !important;
            z-index: 1 !important;
            width: 8.5in !important;
            display: block !important;
            background: white !important;
          }
          .agenda-page-container {
            page-break-after: always !important;
            break-after: page !important;
            width: 8.5in !important;
            height: 11in !important;
            margin: 0 !important;
            border: none !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}} />

      {/* Helper direct print/PDF triggers for saved agenda cards */}
      <script dangerouslySetInnerHTML={{__html: ""}} />

      {/* Delete Verification Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowDeleteModal(false)} />
          <div className="relative bg-white rounded-2xl max-w-md w-full shadow-2xl p-6 overflow-hidden border border-slate-100 z-10">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Delete Agenda Permanently?</h3>
            <p className="text-sm text-slate-500 mb-4 leading-relaxed">
              This action cannot be undone. This agenda will be permanently discarded from the system. 
              To confirm, type <span className="font-mono bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded font-bold">DELETE</span> in the box below:
            </p>
            <div className="space-y-4">
              <Input
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="Type 'DELETE' to verify"
                className="font-semibold text-center uppercase border-slate-200"
              />
              <div className="flex gap-3 justify-end">
                <Button variant="secondary" onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(""); }}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  disabled={deleteConfirmText !== "DELETE"}
                  onClick={executeDeleteAgenda}
                  className="px-6"
                >
                  Permanently Delete
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewAgenda && (
        <Modal
          open={true}
          title={`Preview Agenda — ${formatDateShort(previewAgenda.date)}`}
          onClose={() => setPreviewAgenda(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => { handleAgendaPrintDirect(previewAgenda); setPreviewAgenda(null); }} icon="🖨️">Print</Button>
              <Button variant="outline" onClick={() => handleAgendaDownloadDirect(previewAgenda)} icon="📥">Download PDF</Button>
              <Button variant="ghost" onClick={() => setPreviewAgenda(null)}>Close</Button>
            </>
          }
          className="max-w-4xl"
        >
          <div className="bg-white p-4 overflow-auto max-h-[70vh] border border-slate-100 rounded-xl shadow-inner">
            {renderAgendaDocument(previewAgenda)}
          </div>
        </Modal>
      )}

    </div>
  );

  // Helper trigger functions for quick print/download from search results
  async function handleAgendaDownloadDirect(agenda: Agenda) {
    // Temp hidden rendering for download
    const tempDiv = document.createElement("div");
    tempDiv.style.position = "fixed";
    tempDiv.style.left = "0";
    tempDiv.style.top = "0";
    tempDiv.style.zIndex = "-9999";
    tempDiv.style.background = "white";
    tempDiv.style.width = "8.5in";
    document.body.appendChild(tempDiv);
    
    // We render a temporary portal or container to generate PDF
    const opt = {
      margin: 0,
      filename: `Sacrament-Agenda-${formatDateShort(agenda.date || new Date().toISOString())}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2.5, useCORS: true, letterRendering: true },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' as const }
    };

    // Construct DOM element manually
    const printNode = printContentRef.current?.cloneNode(true) as HTMLDivElement;
    if (printNode) {
      tempDiv.appendChild(printNode);
      try {
        await html2pdf().set(opt).from(printNode).save();
      } catch (err) {
        console.error("Direct PDF download failed:", err);
      }
    }
    document.body.removeChild(tempDiv);
  }

  function handleAgendaPrintDirect(agenda: Agenda) {
    // Select this agenda first, wait for a tick, and run window.print
    setLocalAgenda(agenda);
    setSelectedPlannerId(agenda.planner_id);
    setSelectedWeekId(agenda.week_id);
    setSelectedAgendaId(agenda.agenda_id);
    setIsDirty(false);
    
    setTimeout(() => {
      window.print();
    }, 800);
  }
}
