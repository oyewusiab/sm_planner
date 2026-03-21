import type { Planner, UnitSettings } from "../types";
import { formatDateShort, formatTime12h, monthName } from "../utils/date";

type Gender = "M" | "F";

function gender(name: string, g?: Gender) {
  const n = (name || "").trim();
  if (!n) return "";
  const lo = n.toLowerCase();
  if (lo.startsWith("brother ") || lo.startsWith("sister ")) return n;
  if (g === "M") return `Brother ${n}`;
  if (g === "F") return `Sister ${n}`;
  return n;
}

function names(arr: string[] | undefined) {
  const list = (Array.isArray(arr) ? arr : []).filter(Boolean);
  return list.length ? list.join(", ") : "—";
}

/** Shared inline styles – these are the ONLY styles for the printed output */
const S = {
  // Page containers – 281mm = 297mm A4 landscape minus 2×8mm margins
  page: {
    width: "100%",
    minHeight: "190mm",
    fontFamily: "'Inter', Arial, sans-serif",
    fontSize: "12px",
    color: "#111",
    lineHeight: "1.45",
    boxSizing: "border-box" as const,
  },
  pageBreak: {
    pageBreakAfter: "always" as const,
    breakAfter: "page" as const,
  },
  // Header
  title: {
    textAlign: "center" as const,
    fontWeight: 700,
    fontSize: "15px",
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    marginBottom: "3px",
  },
  subtitle: {
    textAlign: "center" as const,
    fontSize: "11px",
    color: "#555",
    marginBottom: "6px",
  },
  pageLabel: {
    fontSize: "10px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    color: "#555",
    letterSpacing: "0.08em",
    marginBottom: "5px",
  },
  // Table
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    tableLayout: "fixed" as const,
  },
  th: {
    border: "1px solid #aaa",
    padding: "6px 8px",
    background: "#e8eef4",
    fontWeight: 700,
    fontSize: "11px",
    textAlign: "center" as const,
    verticalAlign: "middle" as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    lineHeight: "1.3",
  },
  thSub: {
    border: "1px solid #aaa",
    padding: "5px 8px",
    background: "#f4f7fa",
    fontWeight: 600,
    fontSize: "10px",
    textAlign: "center" as const,
    verticalAlign: "middle" as const,
    color: "#444",
  },
  td: {
    border: "1px solid #aaa",
    padding: "6px 8px",
    fontSize: "12px",
    verticalAlign: "top" as const,
    whiteSpace: "pre-wrap" as const,
    color: "#111",
    lineHeight: "1.5",
  },
  tdCenter: {
    border: "1px solid #aaa",
    padding: "6px 8px",
    fontSize: "12px",
    verticalAlign: "middle" as const,
    textAlign: "center" as const,
    color: "#111",
    fontWeight: 600,
  },
};

export function PlannerPreviewTable({ planner, unit }: { planner: Planner; unit: UnitSettings }) {
  const maxSpeakers = Math.max(
    1,
    ...planner.weeks
      .filter((w) => !w.fast_testimony)
      .map((w) => (Array.isArray(w.speakers) ? w.speakers.length : 0))
  );

  const planLabel = `${monthName(planner.month)} ${planner.year}`;
  const headerInfo = `Venue: ${unit.venue || "—"}  |  Time: ${formatTime12h(unit.meeting_time || "")}  |  Conducting: ${planner.conducting_officer || "—"}`;

  // Speaker column width – share remaining space evenly
  const wkW = "38px";
  const dateW = "54px";
  const spkW = `${Math.floor((100 - 8 - 10) / maxSpeakers)}%`;

  // Back-page column widths
  const bwk = "44px";
  const bhymns = "18%";
  const bsac = "22%";
  const bpray = "18%";
  // note column fills remaining
  const frontCols = [
    <col key="wk" style={{ width: wkW }} />,
    <col key="date" style={{ width: dateW }} />,
    ...Array.from({ length: maxSpeakers }).map((_, i) => (
      <col key={`spk-${i}`} style={{ width: spkW }} />
    )),
  ];

  const backCols = [
    <col key="bwk" style={{ width: bwk }} />,
    <col key="bhymns" style={{ width: bhymns }} />,
    <col key="bsac" style={{ width: bsac }} />,
    <col key="bpray" style={{ width: bpray }} />,
    <col key="bnote" />,
  ];

  return (
    <div>
      {/* ══════════════════════════════════════════
          FRONT PAGE – Speakers
      ══════════════════════════════════════════ */}
      <div style={{ ...S.page, ...S.pageBreak }}>
        <div style={S.title}>
          {(unit.unit_name || "").toUpperCase()} — SACRAMENT MEETING PLAN
        </div>
        <div style={S.subtitle}>{planLabel}  |  {headerInfo}</div>
        <div style={S.pageLabel}>Page 1 — Speakers (Front)</div>

        <table style={{ ...S.table }}>
          <colgroup>{frontCols}</colgroup>
          <thead>
            <tr>
              <th style={{ ...S.th, width: wkW }} rowSpan={2}>WK</th>
              <th style={{ ...S.th, width: dateW }} rowSpan={2}>DATE</th>
              {Array.from({ length: maxSpeakers }).map((_, i) => (
                <th key={i} style={S.th}>SPEAKER {i + 1}</th>
              ))}
            </tr>
            <tr>
              {Array.from({ length: maxSpeakers }).map((_, i) => (
                <th key={i} style={S.thSub}>Name / Topic &amp; Reference</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {planner.weeks.map((w, idx) => (
              <tr key={w.week_id} style={{ background: idx % 2 === 1 ? "#fafbfc" : "#fff" }}>
                <td style={S.tdCenter}>{idx + 1}</td>
                <td style={{ ...S.td, textAlign: "center" }}>{formatDateShort(w.date)}</td>

                {w.is_canceled ? (
                  <td
                    style={{ ...S.td, fontStyle: "italic", color: "#b45309", background: "#fffbeb", fontWeight: 700, textAlign: "center" }}
                    colSpan={maxSpeakers}
                  >
                    NO SACRAMENT MEETING — {w.cancel_reason || "Scheduled Break"}
                  </td>
                ) : w.fast_testimony ? (
                  <td
                    style={{ ...S.td, fontStyle: "italic", color: "#666" }}
                    colSpan={maxSpeakers}
                  >
                    Fast &amp; Testimony Sunday — No Planned Speakers
                  </td>
                ) : (
                  Array.from({ length: maxSpeakers }).map((_, i) => {
                    const s = w.speakers?.[i];
                    const nameStr = s ? gender(s.name, s.gender) : "";
                    const topicStr = (s?.topic || "").trim();
                    const cell =
                      nameStr && topicStr
                        ? `${nameStr}\n${topicStr}`
                        : nameStr || topicStr || "—";
                    return (
                      <td key={i} style={S.td}>
                        {cell}
                      </td>
                    );
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ══════════════════════════════════════════
          BACK PAGE – Hymns / Sacrament / Prayers
      ══════════════════════════════════════════ */}
      <div style={S.page}>
        <div style={S.title}>
          {(unit.unit_name || "").toUpperCase()} — SACRAMENT MEETING PLAN
        </div>
        <div style={S.subtitle}>{planLabel}  |  {headerInfo}</div>
        <div style={S.pageLabel}>Page 2 — Hymns / Sacrament / Prayers (Back)</div>

        <table style={S.table}>
          <colgroup>{backCols}</colgroup>
          <thead>
            {/* Top header row – group labels */}
            <tr>
              <th style={{ ...S.th, width: bwk }} rowSpan={2}>WEEK</th>
              <th style={S.th}>HYMNS</th>
              <th style={S.th}>SACRAMENT ADMINISTRATION</th>
              <th style={S.th}>PRAYER</th>
              <th style={{ ...S.th }} rowSpan={2}>NOTE</th>
            </tr>
            {/* Sub-header row */}
            <tr>
              <th style={S.thSub}>Opening / Sacrament / Closing</th>
              <th style={S.thSub}>Preparing / Blessing / Passing</th>
              <th style={S.thSub}>Invocation / Benediction</th>
            </tr>
          </thead>
          <tbody>
            {planner.weeks.map((w, idx) => {
              const inv = gender(w.prayers.invocation, w.prayers.invocation_gender);
              const ben = gender(w.prayers.benediction, w.prayers.benediction_gender);
              return (
                <tr key={w.week_id} style={{ background: idx % 2 === 1 ? "#fafbfc" : "#fff" }}>
                  <td style={S.tdCenter}>
                    <div style={{ fontWeight: 700 }}>{idx + 1}</div>
                    <div style={{ fontSize: "8px", color: "#555", marginTop: "2px" }}>
                      {formatDateShort(w.date)}
                    </div>
                  </td>

                  {w.is_canceled ? (
                    <td
                      style={{ ...S.td, fontStyle: "italic", color: "#b45309", background: "#fffbeb", fontWeight: 700, textAlign: "center" }}
                      colSpan={4}
                    >
                      NO SACRAMENT MEETING — {w.cancel_reason || "Scheduled Break"}
                    </td>
                  ) : (
                    <>
                      <td style={S.td}>
                        <span style={{ fontWeight: 600, fontSize: "10px", color: "#555" }}>Opening: </span>
                        {w.hymns.opening || "—"}{"\n"}
                        <span style={{ fontWeight: 600, fontSize: "10px", color: "#555" }}>Sacrament: </span>
                        {w.hymns.sacrament || "—"}{"\n"}
                        <span style={{ fontWeight: 600, fontSize: "10px", color: "#555" }}>Closing: </span>
                        {w.hymns.closing || "—"}
                      </td>

                      <td style={S.td}>
                        <span style={{ fontWeight: 600, fontSize: "10px", color: "#555" }}>Preparing: </span>
                        {names(w.sacrament.preparing)}{"\n"}
                        <span style={{ fontWeight: 600, fontSize: "10px", color: "#555" }}>Blessing: </span>
                        {names(w.sacrament.blessing)}{"\n"}
                        <span style={{ fontWeight: 600, fontSize: "10px", color: "#555" }}>Passing: </span>
                        {names(w.sacrament.passing)}
                      </td>

                      <td style={S.td}>
                        <span style={{ fontWeight: 600, fontSize: "10px", color: "#555" }}>Invocation: </span>
                        {inv || "—"}{"\n"}
                        <span style={{ fontWeight: 600, fontSize: "10px", color: "#555" }}>Benediction: </span>
                        {ben || "—"}
                      </td>

                      <td style={{ ...S.td, fontSize: "9px", color: "#444" }}>
                        {(w.note || "").trim() || "—"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
