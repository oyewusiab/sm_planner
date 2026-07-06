import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import html2pdf from "html2pdf.js";
import type { Agenda, Planner, UnitSettings, User } from "../types";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Input, SectionTitle, Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui";
import { Modal } from "../components/Modal";
import { PlannerPreviewTable } from "../components/PlannerPreviewTable";
import { monthName, formatDateShort } from "../utils/date";
import { time, updateDB, useTable, useUpsertMutation } from "../utils/storage";
import { can } from "../utils/permissions";

function plannerLabel(p: Planner) {
  return `${monthName(p.month)} ${p.year}`;
}

// Utility to pad arrays to a fixed size for consistent print layouts
function padArray<T>(arr: T[], targetSize: number, emptyObj: T): T[] {
  const result = [...(arr || [])];
  while (result.length < targetSize) {
    result.push(emptyObj);
  }
  return result.slice(0, targetSize);
}

export function PlannerArchivePage({
  user,
  unit,
  onChanged,
}: {
  user: User;
  unit: UnitSettings;
  onChanged: () => void;
}) {
  const { data: planners = [] } = useTable("PLANNERS");
  const { data: agendas = [] } = useTable("AGENDAS");
  const upsertAgenda = useUpsertMutation("AGENDAS");

  const [activeTab, setActiveTab] = useState<"planners" | "agendas">("planners");

  // Planner preview state
  const [previewPlanner, setPreviewPlanner] = useState<Planner | null>(null);

  // Agenda preview/print state
  const [previewAgenda, setPreviewAgenda] = useState<Agenda | null>(null);
  const [printMode, setPrintMode] = useState(false);
  const [actionAfterRender, setActionAfterRender] = useState<'print' | 'download' | null>(null);
  const printContentRef = useRef<HTMLDivElement>(null);

  // Delete Verification State for Agenda
  const [deleteAgendaTarget, setDeleteAgendaTarget] = useState<Agenda | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  useEffect(() => {
    const cls = "printing-planner";
    const styleId = "planner-print-page";

    if (previewPlanner) {
      document.body.classList.add(cls);
      if (!document.getElementById(styleId)) {
        const el = document.createElement("style");
        el.id = styleId;
        el.textContent = `@media print { @page { size: A4 landscape; margin: 10mm; } }`;
        document.head.appendChild(el);
      }
    } else {
      document.body.classList.remove(cls);
      const el = document.getElementById(styleId);
      if (el) el.remove();
    }

    return () => {
      document.body.classList.remove(cls);
      const el = document.getElementById(styleId);
      if (el) el.remove();
    };
  }, [previewPlanner]);

  // Handle print/pdf generation for agendas
  useEffect(() => {
    if (actionAfterRender && printContentRef.current && previewAgenda) {
      if (actionAfterRender === 'print') {
        setTimeout(() => {
          window.print();
          setTimeout(() => {
            setPrintMode(false);
            setActionAfterRender(null);
          }, 2000);
        }, 800);
      } else if (actionAfterRender === 'download') {
        setTimeout(async () => {
          if (printContentRef.current) {
            const element = printContentRef.current;
            const opt = {
              margin: 0,
              filename: `Sacrament-Agenda-${formatDateShort(previewAgenda.date || new Date().toISOString())}.pdf`,
              image: { type: 'jpeg' as const, quality: 1 },
              html2canvas: { scale: 3, useCORS: true, letterRendering: true },
              jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' as const }
            };
            try {
              await html2pdf().set(opt).from(element).save();
            } catch (err) {
              console.error("PDF generation failed:", err);
            }
            setPrintMode(false);
            setActionAfterRender(null);
          }
        }, 800);
      }
    }
  }, [actionAfterRender, printMode, previewAgenda]);

  const archivedPlanners = useMemo(
    () => [...(planners || [])].filter((p) => p.state === "ARCHIVED").sort((a, b) => b.updated_date.localeCompare(a.updated_date)),
    [planners]
  );

  const archivedAgendas = useMemo(
    () => [...(agendas || [])].filter((a) => a.state === "ARCHIVED").sort((a, b) => b.updated_date.localeCompare(a.updated_date)),
    [agendas]
  );

  function restorePlanner(planner_id: string) {
    if (user.role !== "ADMIN") {
      alert("Only the Bishop (admin) can restore planners.");
      return;
    }
    const ok = window.confirm("Restore this planner to the Planner page?");
    if (!ok) return;
    updateDB((db0) => {
      const PLANNERS = db0.PLANNERS.map((p) =>
        p.planner_id === planner_id ? { ...p, state: "SUBMITTED" as const, updated_date: time.nowISO() } : p
      );
      return { ...db0, PLANNERS };
    });
    onChanged();
  }

  function deletePlanner(p: Planner) {
    if (user.role !== "ADMIN") {
      alert("Only the Bishop (admin) can delete planners.");
      return;
    }
    const label = plannerLabel(p);
    if (!window.confirm(`Are you sure you want to permanently delete the planner for ${label}? This will also delete all checklist items and assignments associated with it. This action cannot be undone.`)) return;
    const verify = window.prompt("Type 'DELETE' to verify permanent deletion:");
    if (verify !== "DELETE") {
      alert("Deletion cancelled. Verification text did not match.");
      return;
    }
    updateDB((db0) => {
      const PLANNERS = db0.PLANNERS.filter((item) => item.planner_id !== p.planner_id);
      const CHECKLISTS = db0.CHECKLISTS.filter((item) => item.planner_id !== p.planner_id);
      const ASSIGNMENTS = db0.ASSIGNMENTS.filter((item) => item.planner_id !== p.planner_id);
      return { ...db0, PLANNERS, CHECKLISTS, ASSIGNMENTS };
    });
    onChanged();
    alert("Planner permanently deleted.");
  }

  const restoreAgenda = async (agenda: Agenda) => {
    const ok = window.confirm("Restore this agenda to the Agenda page?");
    if (!ok) return;
    await upsertAgenda.mutate({
      ...agenda,
      state: "DRAFT",
      updated_date: time.now()
    });
    onChanged();
    alert("Agenda restored to draft.");
  };

  const executeDeleteAgenda = () => {
    if (!deleteAgendaTarget) return;
    updateDB(db => ({
      ...db,
      AGENDAS: db.AGENDAS.filter(a => a.agenda_id !== deleteAgendaTarget.agenda_id)
    }));
    setDeleteAgendaTarget(null);
    setDeleteConfirmText("");
    onChanged();
    alert('Agenda permanently deleted.');
  };

  const handleAgendaPrint = (agenda: Agenda) => {
    setPreviewAgenda(agenda);
    setPrintMode(true);
    setActionAfterRender('print');
  };

  const handleAgendaDownload = (agenda: Agenda) => {
    setPreviewAgenda(agenda);
    setPrintMode(true);
    setActionAfterRender('download');
  };

  // Helper to render the agenda print preview
  const renderAgendaDocument = (agenda: Agenda) => {
    const speakers = padArray(agenda.speakers || [], 5, { name: "", topic: "" });
    const announcements = padArray(agenda.announcements || [], 6, "");
    const releases = padArray(agenda.releases || [], 6, { name: "", calling: "" });
    const calls = padArray(agenda.calls || [], 6, { name: "", calling: "" });
    const baptizedChildren = padArray(agenda.baptized_children || [], 4, "");
    const ordinations = padArray(agenda.aaronic_ordinations || [], 4, { name: "", office: "", ordained_by: "", ordained_by_office: "" });
    const advancements = padArray(agenda.aaronic_advancements || [], 4, { name: "", office_from: "", office_to: "", ordained_by: "", ordained_by_office: "" });
    const achievements = padArray(agenda.achievements || [], 4, "");
    const babies = padArray(agenda.babies || [], 4, { family: "", baby_name: "", blessed_by: "", blessed_by_office: "" });
    const confirmations = padArray(agenda.confirmations || [], 6, { name: "", confirmed_by: "", confirmed_by_office: "" });
    const fellowships = padArray(agenda.fellowships || [], 8, "");

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
                  <td className="border border-black p-1.5 w-[45%]"><strong>Ward / Branch:</strong> {agenda.ward_branch}</td>
                  <td className="border border-black p-1.5 w-[35%]"><strong>Stake / District:</strong> {agenda.stake_district}</td>
                  <td className="border border-black p-1.5 w-[20%] text-center"><strong>Date:</strong> {agenda.date ? formatDateShort(agenda.date) : ""}</td>
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
                          <input type="checkbox" checked={agenda.type_of_meeting === "Sacrament Meeting"} readOnly className="w-3 h-3 accent-black" />
                          Sacrament Meeting
                        </label>
                        <label className="flex items-center gap-1">
                          <input type="checkbox" checked={agenda.type_of_meeting === "Fast & Testimony"} readOnly className="w-3 h-3 accent-black" />
                          Fast & Testimony (F & T)
                        </label>
                        <label className="flex items-center gap-1">
                          <input type="checkbox" checked={agenda.type_of_meeting === "Stake/District Meeting"} readOnly className="w-3 h-3 accent-black" />
                          Stake/District Meeting
                        </label>
                        <label className="flex items-center gap-1">
                          <input type="checkbox" checked={agenda.type_of_meeting === "Ward/Branch Conference"} readOnly className="w-3 h-3 accent-black" />
                          Ward/Branch Conference
                        </label>
                      </div>
                    </div>
                    <div className="mt-1 flex items-center">
                      <label className="flex items-center gap-1 mr-1.5 whitespace-nowrap">
                        <input type="checkbox" checked={agenda.type_of_meeting === "Other"} readOnly className="w-3 h-3 accent-black" />
                        Other (Specify):
                      </label>
                      <span className="flex-1 border-b border-black min-h-[1.1rem] px-1 text-[9px]">
                        {agenda.type_of_meeting === "Other" ? agenda.other_meeting_specify : ""}
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
                    <div className="flex items-end mb-1.5">
                      <strong className="w-16 shrink-0">Presiding:</strong>
                      <span className="flex-1 border-b border-black min-h-[1.1rem] px-1 text-[9.5px] truncate">{agenda.presiding}</span>
                    </div>
                    <div className="flex items-end">
                      <strong className="w-16 shrink-0">Conducting:</strong>
                      <span className="flex-1 border-b border-black min-h-[1.1rem] px-1 text-[9.5px] truncate">{agenda.conducting}</span>
                    </div>
                  </td>
                  <td className="border border-black p-1.5 w-1/2 align-top space-y-1">
                    <div className="flex items-end">
                      <strong className="w-24 shrink-0">Music Director:</strong>
                      <span className="flex-1 border-b border-black min-h-[1.1rem] px-1 text-[9.5px] truncate">{agenda.music_director}</span>
                    </div>
                    <div className="flex items-end">
                      <strong className="w-24 shrink-0">Choir Director:</strong>
                      <span className="flex-1 border-b border-black min-h-[1.1rem] px-1 text-[9.5px] truncate">{agenda.choir_director}</span>
                    </div>
                    <div className="flex items-end">
                      <strong className="w-24 shrink-0">Organist:</strong>
                      <span className="flex-1 border-b border-black min-h-[1.1rem] px-1 text-[9.5px] truncate">{agenda.organist}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="flex justify-between items-end mb-0.5">
              <div className="flex-1 flex items-end">
                <strong>Prelude Music (by choir or organ):</strong>
                <span className="border-b border-black flex-1 min-h-[1.1rem] ml-1 px-1">{agenda.prelude_music}</span>
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
                  <span className="border-b border-black w-24 ml-1 px-1 text-center font-semibold">{agenda.start_time}</span>
                  <span className="border-b border-black flex-1 min-h-[1.1rem]"></span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1 truncate">
                  <strong className="shrink-0 mr-1">Greetings, Welcome & Acknowledgements:</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agenda.greetings_welcome}</span>
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
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agenda.opening_hymn}</span>
                  <strong className="shrink-0 ml-2 mr-1">Hymn Number:</strong>
                  <span className="border-b border-black w-14 text-center min-h-[1.1rem] px-1 font-semibold">{agenda.opening_hymn_number}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1 truncate">
                  <strong className="shrink-0 mr-1">Opening Prayer:</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agenda.opening_prayer}</span>
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
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agenda.ward_branch_business}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1 truncate">
                  <strong className="shrink-0 mr-1">Stake/District Business (by):</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agenda.stake_district_business}</span>
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
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agenda.naming_blessing}</span>
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
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agenda.confirmation_bestowal}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1">
                  <strong className="shrink-0 mr-1">Sacrament Hymn:</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agenda.sacrament_hymn}</span>
                  <strong className="shrink-0 ml-2 mr-1">Hymn Number:</strong>
                  <span className="border-b border-black w-14 text-center min-h-[1.1rem] px-1 font-semibold">{agenda.sacrament_hymn_number}</span>
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
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agenda.special_music}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="font-bold text-[8.5px] uppercase tracking-wide mt-1 border-b border-black pb-0.5">
                Speakers, Testimonies, Hymn, Special Music (as appropriate)
              </div>

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
                        <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate text-[9px]">{s.topic}</span>
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
                        <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate text-[9px]">{s.topic}</span>
                      </div>
                      <div className="flex gap-2 shrink-0 w-16">
                        <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                        <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="text-[7.8px] italic text-slate-600 mt-1">
                <strong>Note:</strong> To ensure ending on time closing Hymn should commence not later than <span className="underline font-bold">8mins</span> before the closing time of sacrament meeting
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1">
                  <strong className="shrink-0 mr-1">Closing Hymn:</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agenda.closing_hymn}</span>
                  <strong className="shrink-0 ml-2 mr-1">Hymn No:</strong>
                  <span className="border-b border-black w-14 text-center min-h-[1.1rem] px-1 font-semibold">{agenda.closing_hymn_number}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5">
                <div className="flex items-end flex-1 truncate">
                  <strong className="shrink-0 mr-1">Closing Prayer (by):</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agenda.closing_prayer}</span>
                </div>
                <div className="flex gap-2 shrink-0 w-16">
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                  <span className="border-b border-black w-8 text-center min-h-[1.1rem]"></span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 h-5 mb-0.5">
                <div className="flex items-end flex-1 truncate">
                  <strong className="shrink-0 mr-1">Postlude Music (by organ only; not by choir):</strong>
                  <span className="border-b border-black flex-1 min-h-[1.1rem] px-1 truncate">{agenda.postlude_music}</span>
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

            <div className="mb-1.5">
              <div className="font-bold text-[8.8px] uppercase tracking-wide bg-slate-100 p-0.5 pl-1.5 border-l-2 border-black mb-1">
                Announcements
              </div>
              <table className="w-full border-collapse border border-black text-[8px]">
                <tbody>
                  {[0, 1, 2].map((i) => (
                    <tr key={i} className="h-5">
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 1}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%]">{announcements[i]}</td>
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 4}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%]">{announcements[i + 3]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mb-1.5">
              <div className="font-bold text-[8.8px] uppercase tracking-wide bg-slate-100 p-0.5 pl-1.5 border-l-2 border-black mb-1">
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
                      {[0, 1, 2].map((i) => (
                        <tr key={i} className="h-5.5">
                          <td className="border border-black p-0.5 text-center bg-slate-50 font-semibold">{i + 1}</td>
                          <td className="border border-black p-0.5 pl-1.5 truncate">{releases[i]?.name || ""}</td>
                          <td className="border border-black p-0.5 pl-1.5 truncate">{releases[i]?.calling || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <table className="w-full border-collapse border border-black border-t-0 text-[7.8px] text-left">
                    <tbody>
                      {[3, 4, 5].map((i) => (
                        <tr key={i} className="h-5.5">
                          <td className="border border-black p-0.5 text-center bg-slate-50 font-semibold">{i + 1}</td>
                          <td className="border border-black p-0.5 pl-1.5 truncate">{releases[i]?.name || ""}</td>
                          <td className="border border-black p-0.5 pl-1.5 truncate">{releases[i]?.calling || ""}</td>
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
                      {[0, 1, 2].map((i) => (
                        <tr key={i} className="h-5.5">
                          <td className="border border-black p-0.5 text-center bg-slate-50 font-semibold">{i + 1}</td>
                          <td className="border border-black p-0.5 pl-1.5 truncate">{calls[i]?.name || ""}</td>
                          <td className="border border-black p-0.5 pl-1.5 truncate">{calls[i]?.calling || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <table className="w-full border-collapse border border-black border-t-0 text-[7.8px] text-left">
                    <tbody>
                      {[3, 4, 5].map((i) => (
                        <tr key={i} className="h-5.5">
                          <td className="border border-black p-0.5 text-center bg-slate-50 font-semibold">{i + 1}</td>
                          <td className="border border-black p-0.5 pl-1.5 truncate">{calls[i]?.name || ""}</td>
                          <td className="border border-black p-0.5 pl-1.5 truncate">{calls[i]?.calling || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="mb-1.5">
              <div className="font-bold text-[8.5px] uppercase bg-slate-100 p-0.5 pl-1.5 border-l-2 border-black mb-0.5">
                Recognition of Newly Baptized Children of Record
              </div>
              <table className="w-full border-collapse border border-black text-[8px] text-left">
                <tbody>
                  {[0, 1].map((i) => (
                    <tr key={i} className="h-5">
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 1}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%]">{baptizedChildren[i]}</td>
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 3}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%]">{baptizedChildren[i + 2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mb-1.5">
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
                    <tr key={i} className="h-5">
                      <td className="border border-black p-0.5 text-center bg-slate-50">{i + 1}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{o.name || ""}</td>
                      <td className="border border-black p-0.5 text-center truncate">{o.office || ""}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{o.ordained_by || ""}</td>
                      <td className="border border-black p-0.5 text-center truncate">{o.ordained_by_office || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mb-1.5">
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
                    <tr key={i} className="h-5">
                      <td className="border border-black p-0.5 text-center bg-slate-50">{i + 1}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{a.name || ""}</td>
                      <td className="border border-black p-0.5 text-center truncate">{a.office_from || ""}</td>
                      <td className="border border-black p-0.5 text-center truncate">{a.office_to || ""}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{a.ordained_by || ""}</td>
                      <td className="border border-black p-0.5 text-center truncate">{a.ordained_by_office || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mb-1.5">
              <div className="font-bold text-[8.5px] uppercase bg-slate-100 p-0.5 pl-1.5 border-l-2 border-black mb-0.5">
                Recognition of Advancements & Achievements
              </div>
              <table className="w-full border-collapse border border-black text-[8px] text-left">
                <tbody>
                  {[0, 1].map((i) => (
                    <tr key={i} className="h-5">
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 1}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%]">{achievements[i]}</td>
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 3}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%]">{achievements[i + 2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mb-1.5">
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
                  {babies.map((b, i) => (
                    <tr key={i} className="h-5">
                      <td className="border border-black p-0.5 text-center bg-slate-50">{i + 1}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{b.family || ""}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{b.baby_name || ""}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{b.blessed_by || ""}</td>
                      <td className="border border-black p-0.5 text-center truncate">{b.blessed_by_office || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mb-1.5">
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
                  {confirmations.map((c, i) => (
                    <tr key={i} className="h-5">
                      <td className="border border-black p-0.5 text-center bg-slate-50">{i + 1}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{c.name || ""}</td>
                      <td className="border border-black p-0.5 pl-1 truncate">{c.confirmed_by || ""}</td>
                      <td className="border border-black p-0.5 text-center truncate">{c.confirmed_by_office || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div className="font-bold text-[8.5px] uppercase bg-slate-100 p-0.5 pl-1.5 border-l-2 border-black mb-0.5">
                Receive into Fellowship
              </div>
              <table className="w-full border-collapse border border-black text-[8px] text-left">
                <tbody>
                  {[0, 1, 2, 3].map((i) => (
                    <tr key={i} className="h-5">
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 1}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%]">{fellowships[i]}</td>
                      <td className="border border-black p-0.5 w-6 text-center font-bold bg-slate-50">{i + 5}.</td>
                      <td className="border border-black p-0.5 pl-1.5 w-[46%]">{fellowships[i + 4]}</td>
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle title="Planner & Agenda Archive" subtitle="Archived items are kept here for historical reference, printing, and recovery." />
      </div>

      <Tabs>
        <div className="border-b border-slate-200">
          <TabsList>
            <TabsTrigger active={activeTab === "planners"} onClick={() => setActiveTab("planners")}>Archived Planners ({archivedPlanners.length})</TabsTrigger>
            <TabsTrigger active={activeTab === "agendas"} onClick={() => setActiveTab("agendas")}>Archived Agendas ({archivedAgendas.length})</TabsTrigger>
          </TabsList>
        </div>

        {/* TAB 1: ARCHIVED PLANNERS */}
        <TabsContent active={activeTab === "planners"}>
          {archivedPlanners.length === 0 ? (
            <EmptyState title="No archived planners" body="Archive a submitted monthly planner to display it here." icon="📦" />
          ) : (
            <div className="grid grid-cols-1 gap-4 mt-4 animate-fade-in">
              {archivedPlanners.map((p) => (
                <Card key={p.planner_id}>
                  <CardHeader className="flex flex-row items-center justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle>{plannerLabel(p)}</CardTitle>
                      <div className="text-xs text-slate-500">Updated {new Date(p.updated_date).toLocaleString()}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="gray">ARCHIVED</Badge>
                      <Button variant="secondary" onClick={() => setPreviewPlanner(p)}>Preview</Button>
                      <Button variant="secondary" onClick={() => { setPreviewPlanner(p); setTimeout(() => window.print(), 50); }}>Print</Button>
                      {user.role === "ADMIN" && (
                        <>
                          <Button variant="ghost" onClick={() => restorePlanner(p.planner_id)}>Restore</Button>
                          <Button variant="ghost" onClick={() => deletePlanner(p)} className="text-rose-600 hover:bg-rose-50">Delete</Button>
                        </>
                      )}
                    </div>
                  </CardHeader>
                  <CardBody>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="rounded-lg border border-[color:var(--border)] p-3">
                        <div className="text-xs text-slate-500">Unit</div>
                        <div className="text-sm font-medium">{p.unit_name}</div>
                      </div>
                      <div className="rounded-lg border border-[color:var(--border)] p-3">
                        <div className="text-xs text-slate-500">Weeks</div>
                        <div className="text-sm font-medium">{p.weeks.length}</div>
                      </div>
                      <div className="rounded-lg border border-[color:var(--border)] p-3">
                        <div className="text-xs text-slate-500">Conducting</div>
                        <div className="text-sm font-medium">{p.conducting_officer || "—"}</div>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* TAB 2: ARCHIVED AGENDAS */}
        <TabsContent active={activeTab === "agendas"}>
          {archivedAgendas.length === 0 ? (
            <EmptyState title="No archived agendas" body="Archived meeting agendas will appear here." icon="📄" />
          ) : (
            <div className="grid grid-cols-1 gap-4 mt-4 animate-fade-in">
              {archivedAgendas.map((a) => (
                <Card key={a.agenda_id}>
                  <CardHeader className="flex flex-row items-center justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle>Agenda — {formatDateShort(a.date)}</CardTitle>
                      <div className="text-xs text-slate-500">Updated {new Date(a.updated_date).toLocaleString()}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="gray">ARCHIVED</Badge>
                      <Button variant="secondary" onClick={() => setPreviewAgenda(a)}>Preview</Button>
                      <Button variant="secondary" onClick={() => handleAgendaDownload(a)} icon="📥">PDF</Button>
                      <Button variant="secondary" onClick={() => handleAgendaPrint(a)} icon="🖨️">Print</Button>
                      {can(user.role, "agendas.edit") && (
                        <>
                          <Button variant="ghost" onClick={() => restoreAgenda(a)}>Restore</Button>
                          <Button variant="ghost" onClick={() => setDeleteAgendaTarget(a)} className="text-rose-600 hover:bg-rose-50">Delete</Button>
                        </>
                      )}
                    </div>
                  </CardHeader>
                  <CardBody>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                      <div className="rounded-lg border border-[color:var(--border)] p-3">
                        <div className="text-xs text-slate-500">Ward / Branch</div>
                        <div className="text-sm font-medium">{a.ward_branch}</div>
                      </div>
                      <div className="rounded-lg border border-[color:var(--border)] p-3">
                        <div className="text-xs text-slate-500">Stake / District</div>
                        <div className="text-sm font-medium">{a.stake_district}</div>
                      </div>
                      <div className="rounded-lg border border-[color:var(--border)] p-3">
                        <div className="text-xs text-slate-500">Meeting Type</div>
                        <div className="text-sm font-medium">{a.type_of_meeting}</div>
                      </div>
                      <div className="rounded-lg border border-[color:var(--border)] p-3">
                        <div className="text-xs text-slate-500">Conducting</div>
                        <div className="text-sm font-medium">{a.conducting || "—"}</div>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Planner Preview Modal */}
      <Modal
        open={!!previewPlanner}
        title="Planner Preview (Landscape)"
        onClose={() => setPreviewPlanner(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => window.print()}>
              Print / Save as PDF
            </Button>
            <Button variant="ghost" onClick={() => setPreviewPlanner(null)}>
              Close
            </Button>
          </>
        }
        className="max-w-6xl"
      >
        {previewPlanner ? <PlannerPreviewTable planner={previewPlanner} unit={unit} /> : null}
      </Modal>

      {/* Agenda Preview/Print Portal */}
      {(printMode || previewAgenda) && createPortal(
        <div className="fixed inset-0 z-[99999] bg-white text-black overflow-auto print-portal">
          <style dangerouslySetInnerHTML={{__html: `
            .print-portal {
              background-color: #f1f5f9;
              display: flex;
              flex-direction: column;
              align-items: center;
              padding: 30px;
            }
            .print-portal-header {
              margin-bottom: 20px;
              display: flex;
              gap: 15px;
              background: white;
              padding: 12px 24px;
              border-radius: 12px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.05);
            }
            
            .agenda-print-sheet {
              width: 8.5in;
              background-color: white;
              color: black;
              box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            }
            .agenda-page-container {
              width: 8.5in;
              height: 11in;
              min-height: 11in;
              max-height: 11in;
              padding: 0.4in;
              box-sizing: border-box;
              background: white;
              overflow: hidden;
              position: relative;
            }
            
            @media print {
              @page { 
                size: letter portrait; 
                margin: 0in;
              }
              * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                color-adjust: exact !important;
              }
              body { 
                background: white !important; 
                margin: 0 !important; 
                padding: 0 !important; 
              }
              .print-portal { 
                position: static !important; 
                overflow: visible !important; 
                padding: 0 !important;
                background-color: transparent !important;
              }
              .print-portal-header {
                display: none !important;
              }
              .agenda-print-sheet {
                box-shadow: none !important;
                width: 8.5in !important;
              }
              .agenda-page-container {
                page-break-after: always !important;
                break-after: page !important;
                width: 8.5in !important;
                height: 11in !important;
                margin: 0 !important;
                border: none !important;
              }
              #root { 
                display: none !important; 
              }
            }
          `}} />
          
          <div className="print-portal-header no-print">
            <Button variant="secondary" onClick={() => handleAgendaDownload(previewAgenda!)}>Download PDF</Button>
            <Button onClick={() => handleAgendaPrint(previewAgenda!)} className="bg-blue-600 text-white">Print</Button>
            <Button variant="ghost" onClick={() => { setPreviewAgenda(null); setPrintMode(false); }}>Close Preview</Button>
          </div>

          <div ref={printContentRef} className="agenda-print-sheet">
            {previewAgenda && renderAgendaDocument(previewAgenda)}
          </div>
        </div>,
        document.body
      )}

      {/* Delete Verification Modal for Agenda */}
      {deleteAgendaTarget && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteAgendaTarget(null)} />
          <div className="relative bg-white rounded-2xl max-w-md w-full shadow-2xl p-6 overflow-hidden border border-slate-100 z-10 animate-scale-in">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Permanently Delete Agenda?</h3>
            <p className="text-sm text-slate-500 mb-4 leading-relaxed">
              This action cannot be undone. The agenda for <strong>{formatDateShort(deleteAgendaTarget.date)}</strong> will be permanently deleted from the database. 
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
                <Button variant="secondary" onClick={() => { setDeleteAgendaTarget(null); setDeleteConfirmText(""); }}>
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

    </div>
  );
}
