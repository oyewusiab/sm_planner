import type { Planner, UnitSettings } from "../types";
import { formatDateShort, monthName } from "../utils/date";

type Gender = "M" | "F";

function withBrotherSister(name: string, gender?: Gender) {
  const n = (name || "").trim();
  if (!n) return "";
  const lower = n.toLowerCase();
  if (lower.startsWith("brother ") || lower.startsWith("sister ")) return n;
  if (gender === "M") return `Brother ${n}`;
  if (gender === "F") return `Sister ${n}`;
  return n;
}

function namesListToText(list: string[] | undefined): string {
  return (Array.isArray(list) ? list : []).join(", ");
}

function plannerLabel(p: Planner) {
  return `${monthName(p.month)} ${p.year}`;
}

export function PlannerPreviewTable({ planner, unit }: { planner: Planner; unit: UnitSettings }) {
  const maxSpeakers = Math.max(
    0,
    ...planner.weeks
      .filter((w) => !w.fast_testimony)
      .map((w) => (Array.isArray(w.speakers) ? w.speakers.length : 0))
  );

  const header = (
    <div className="space-y-1">
      <div className="text-center">
        <div className="text-lg font-semibold tracking-wide text-slate-900">
          {(unit.unit_name || "").toUpperCase()} — SACRAMENT MEETING PLAN
        </div>
        <div className="text-sm text-slate-600">
          {plannerLabel(planner)} • Venue: {unit.venue || "—"} • Time: {unit.meeting_time || "—"}
        </div>
      </div>
    </div>
  );

  const cell = "border border-slate-300 px-2 py-2 align-top";
  const th = `${cell} bg-slate-50 text-[11px] font-semibold text-slate-700`;
  const td = `${cell} text-[11px] text-slate-900`;

  const weekLabel = (idx: number) => `Week ${idx + 1}`;

  const speakerCellText = (name: string, gender: Gender | undefined, topic: string) => {
    const n = withBrotherSister(name, gender) || "";
    const t = (topic || "").trim();
    if (!n && !t) return "";
    if (!n) return t;
    if (!t) return n;
    return `${n}\n${t}`;
  };

  const names = (list: string[] | undefined) => {
    const txt = namesListToText(list);
    return (txt || "").trim() || "—";
  };

  const tableWrap = "overflow-x-auto";

  return (
    <div className="space-y-4 planner-print">
      {header}

      {/* FRONT PAGE */}
      <div className="planner-page space-y-2">
        <div className="text-sm font-semibold text-slate-900">Front Page (Speakers)</div>
        <div className={tableWrap}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Week</th>
                <th className={th}>Date</th>
                {Array.from({ length: Math.max(1, maxSpeakers) }).map((_, i) => (
                  <th key={i} className={th}>{`Speaker ${i + 1} (Name / Topic & Ref.)`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {planner.weeks.map((w, idx) => (
                <tr key={w.week_id}>
                  <td className={td}>{weekLabel(idx)}</td>
                  <td className={td}>{formatDateShort(w.date)}</td>

                  {w.fast_testimony ? (
                    <td className={`${td} whitespace-pre-line`} colSpan={Math.max(1, maxSpeakers)}>
                      Fast & Testimony Sunday (No planned speakers)
                    </td>
                  ) : (
                    Array.from({ length: Math.max(1, maxSpeakers) }).map((_, i) => {
                      const s = w.speakers?.[i];
                      const text = s ? speakerCellText(s.name, s.gender, s.topic) : "";
                      return (
                        <td key={i} className={`${td} whitespace-pre-line`}>
                          {text || "—"}
                        </td>
                      );
                    })
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="print-page-break" />

      {/* BACK PAGE */}
      <div className="planner-page space-y-2">
        <div className="text-sm font-semibold text-slate-900">Back Page (Hymns / Sacrament / Prayers / Note)</div>
        <div className={tableWrap}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Week</th>
                <th className={th}>Hymns (Opening / Sacrament / Closing)</th>
                <th className={th}>Sacrament Administration (Preparing / Blessing / Passing)</th>
                <th className={th}>Prayers (Invocation / Benediction)</th>
                <th className={th}>Note</th>
              </tr>
            </thead>
            <tbody>
              {planner.weeks.map((w, idx) => (
                <tr key={w.week_id}>
                  <td className={td}>
                    {weekLabel(idx)}
                    <div className="mt-1 text-[10px] text-slate-600">{formatDateShort(w.date)}</div>
                  </td>
                  <td className={`${td} whitespace-pre-line`}>
                    Opening: {w.hymns.opening || "—"}
                    {"\n"}Sacrament: {w.hymns.sacrament || "—"}
                    {"\n"}Closing: {w.hymns.closing || "—"}
                  </td>
                  <td className={`${td} whitespace-pre-line`}>
                    Preparing: {names(w.sacrament.preparing)}
                    {"\n"}Blessing: {names(w.sacrament.blessing)}
                    {"\n"}Passing: {names(w.sacrament.passing)}
                  </td>
                  <td className={`${td} whitespace-pre-line`}>
                    Invocation: {withBrotherSister(w.prayers.invocation, w.prayers.invocation_gender) || "—"}
                    {"\n"}Benediction: {withBrotherSister(w.prayers.benediction, w.prayers.benediction_gender) || "—"}
                  </td>
                  <td className={`${td} whitespace-pre-line`}>{(w.note || "").trim() || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="no-print text-xs text-slate-500">Tip: Use “Print → Save as PDF” to download.</div>
    </div>
  );
}
