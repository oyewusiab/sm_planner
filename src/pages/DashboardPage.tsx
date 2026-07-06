import { useMemo, useState } from "react";
import type { UnitSettings, User } from "../types";
import { Button, EmptyState } from "../components/ui";
import { formatDateShort, nextSundaysInMonth, yyyyMmToLabel } from "../utils/date";
import { getDB } from "../utils/storage";
import { cn } from "../utils/cn";
import { formatUserDisplayName } from "../utils/format";

const QUOTES = [
  { ref: "Moroni 10:32", text: "Come unto Christ, and be perfected in him." },
  { ref: "Mosiah 2:17", text: "When ye are in the service of your fellow beings ye are only in the service of your God." },
  { ref: "D&C 18:10", text: "The worth of souls is great in the sight of God." },
  { ref: "3 Nephi 18:32", text: "Nevertheless, ye shall not cast him out of your synagogues, or your places of worship." },
  { ref: "Alma 37:37", text: "Counsel with the Lord in all thy doings, and he will direct thee for good." },
  { ref: "2 Nephi 31:20", text: "Press forward with a steadfastness in Christ, having a perfect brightness of hope." },
  { ref: "D&C 6:36", text: "Look unto me in every thought; doubt not, fear not." },
  { ref: "Proverbs 3:5-6", text: "Trust in the Lord with all thine heart; and lean not unto thine own understanding. In all thy ways acknowledge him, and he shall direct thy paths." },
  { ref: "Joshua 1:9", text: "Be strong and of a good courage; be not afraid, neither be thou dismayed: for the Lord thy God is with thee whithersoever thou goest." },
  { ref: "Philippians 4:13", text: "I can do all things through Christ which strengtheneth me." },
  { ref: "D&C 121:45", text: "Let thy bowels also be full of charity towards all men, and to the household of faith, and let virtue garnish thy thoughts unceasingly..." },
  { ref: "D&C 88:118", text: "Seek ye out of the best books words of wisdom; seek learning, even by study and also by faith." },
  { ref: "Ether 12:27", text: "And if men come unto me I will show unto them their weakness... for my grace is sufficient for all men that humble themselves before me." },
  { ref: "John 14:27", text: "Peace I leave with you, my peace I give unto you: not as the world giveth, give I unto you. Let not your heart be troubled, neither let it be afraid." },
  { ref: "Matthew 11:28-30", text: "Come unto me, all ye that labour and are heavy laden, and I will give you rest. Take my yoke upon you, and learn of me..." },
  { ref: "Isaiah 40:31", text: "But they that wait upon the Lord shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary..." },
  { ref: "D&C 19:23", text: "Learn of me, and listen to my words; walk in the meekness of my Spirit, and you shall have peace in me." },
  { ref: "D&C 50:44", text: "Wherefore, I am in your midst, and I am the good shepherd, and the stone of Israel. He that buildeth upon this rock shall never fall." },
  { ref: "Moroni 7:47", text: "But charity is the pure love of Christ, and it endureth forever; and whoso is found possessed of it at the last day, it shall be well with him." },
  { ref: "Alma 32:21", text: "Faith is not to have a perfect knowledge of things; therefore if ye have faith ye hope for things which are not seen, which are true." },
  { ref: "Mosiah 18:9", text: "Mourn with those that mourn; yea, and comfort those that stand in need of comfort, and to stand as witnesses of God at all times and in all things." },
  { ref: "Mosiah 4:15", text: "But ye will teach them to walk in the ways of truth and soberness; ye will teach them to love one another, and to serve one another." },
  { ref: "Mosiah 24:14", text: "And I will also ease the burdens which are put upon your shoulders, that even you cannot feel them upon your backs..." },
  { ref: "Alma 7:11-12", text: "And he shall go forth, suffering pains and afflictions and temptations of every kind; and this that the word might be fulfilled..." },
  { ref: "Helaman 5:12", text: "Remember that it is upon the rock of our Redeemer, who is Christ, the Son of God, that ye must build your foundation..." },
  { ref: "2 Nephi 2:25", text: "Adam fell that men might be; and men are, that they might have joy." },
  { ref: "2 Nephi 25:26", text: "And we talk of Christ, we rejoice in Christ, we preach of Christ, we prophesy of Christ, and we write according to our prophecies..." },
  { ref: "Mosiah 3:19", text: "For the natural man is an enemy to God, and has been from the fall of Adam, and will be, forever and ever, unless he yields to the enticings of the Holy Spirit..." },
  { ref: "Alma 34:32", text: "For behold, this life is the time for men to prepare to meet God; behold, the day of this life is the day for men to perform their labors." },
  { ref: "3 Nephi 12:48", text: "Therefore I would that ye should be perfect even as I, or your Father who is in heaven is perfect." },
  { ref: "D&C 84:88", text: "I will go before your face. I will be on your right hand and on your left, and my Spirit shall be in your hearts, and mine angels round about you, to bear you up." },
  { ref: "D&C 90:24", text: "Search diligently, pray always, and be believing, and all things shall work together for your good, if ye walk uprightly..." },
  { ref: "Russell M. Nelson", text: "Joy has little to do with the circumstances of our lives and everything to do with the focus of our lives." },
  { ref: "Russell M. Nelson", text: "The temple is at the center of strengthening our faith and spiritual fortitude, because the Savior and His doctrine are the very heart of the temple." },
  { ref: "Russell M. Nelson", text: "My dear brothers and sisters, the road ahead may be bumpy, but our destination is serene." },
  { ref: "Thomas S. Monson", text: "The future is as bright as your faith." },
  { ref: "Gordon B. Hinckley", text: "Just do the best you can, but be sure it is your very best." },
  { ref: "Dieter F. Uchtdorf", text: "The desire to create is one of the deepest yearnings of the human soul." }
];

function pickQuoteIndex(seed: string, count: number) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % count;
}

function getGreeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** SVG donut-progress ring */
function ProgressRing({ pct, size = 80 }: { pct: number; size?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <defs>
        <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0096c7" />
          <stop offset="100%" stopColor="#00c6fb" />
        </linearGradient>
      </defs>
      <circle
        className="progress-ring-track"
        cx={size / 2}
        cy={size / 2}
        r={r}
      />
      <circle
        className="progress-ring-fill"
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeDasharray={circ}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

export function DashboardPage({
  user,
  unit,
  onNavigate,
}: {
  user: User;
  unit: UnitSettings;
  onNavigate: (route: string) => void;
}) {
  const db = getDB();
  const now = new Date();
  const hour = now.getHours();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const [quoteIndex, setQuoteIndex] = useState(() => {
    const saved = localStorage.getItem("sac_meeting_spiritual_thought_index");
    if (saved !== null) {
      const idx = parseInt(saved, 10);
      if (idx >= 0 && idx < QUOTES.length) return idx;
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    return pickQuoteIndex(`${user.user_id}.${todayStr}`, QUOTES.length);
  });

  const quote = QUOTES[quoteIndex];

  const [copied, setCopied] = useState(false);

  const handleCopyQuote = () => {
    const textToCopy = `"${quote.text}" — ${quote.ref}`;
    void navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleShuffleQuote = () => {
    let nextIdx = quoteIndex;
    if (QUOTES.length > 1) {
      while (nextIdx === quoteIndex) {
        nextIdx = Math.floor(Math.random() * QUOTES.length);
      }
    }
    setQuoteIndex(nextIdx);
    localStorage.setItem("sac_meeting_spiritual_thought_index", String(nextIdx));
  };

  const currentMonthSundays = nextSundaysInMonth(month, year);
  const submittedPlanners = [...db.PLANNERS]
    .filter((p) => p.state === "SUBMITTED")
    .sort((a, b) => b.updated_date.localeCompare(a.updated_date));
  const latestSubmitted = submittedPlanners[0];

  const speakerCount = useMemo(() => {
    if (!latestSubmitted) return 0;
    return latestSubmitted.weeks.reduce(
      (acc, w) => acc + (w.speakers || []).filter((s) => s.name.trim()).length,
      0
    );
  }, [latestSubmitted]);

  const aggregateChecklistStats = useMemo(() => {
    if (!latestSubmitted) return { done: 0, total: 0, pct: 0 };
    const forPlanner = db.CHECKLISTS.filter((c) => c.planner_id === latestSubmitted.planner_id);
    const total = forPlanner.length;
    const done = forPlanner.filter((c) => c.status).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { done, total, pct };
  }, [db.CHECKLISTS, latestSubmitted]);

  const nextSundayInfo = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    const upcomingMeetings = submittedPlanners
      .flatMap((p) => p.weeks.map((w) => ({ planner_id: p.planner_id, week_id: w.week_id, date: w.date })))
      .filter((w) => w.date >= todayISO)
      .sort((a, b) => a.date.localeCompare(b.date));
    return upcomingMeetings[0] || null;
  }, [submittedPlanners]);

  const nextSundayChecklistStats = useMemo(() => {
    if (!nextSundayInfo) return { done: 0, total: 0, pct: 0 };
    const rows = db.CHECKLISTS.filter(
      (c) => c.planner_id === nextSundayInfo.planner_id && c.week_id === nextSundayInfo.week_id
    );
    const total = rows.length;
    const done = rows.filter((r) => r.status).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { done, total, pct };
  }, [db.CHECKLISTS, nextSundayInfo]);

  const readinessStats = nextSundayInfo ? nextSundayChecklistStats : aggregateChecklistStats;

  const nextSundayDetails = useMemo(() => {
    if (!nextSundayInfo) return null;
    const planner = db.PLANNERS.find((p) => p.planner_id === nextSundayInfo.planner_id);
    if (!planner) return null;
    return planner.weeks.find((w) => w.week_id === nextSundayInfo.week_id) || null;
  }, [db.PLANNERS, nextSundayInfo]);

  const upcoming = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    return [...new Set([...currentMonthSundays])].filter((d) => d >= todayISO).slice(0, 5);
  }, [currentMonthSundays]);

  const greeting = getGreeting(hour);
  const displayName = formatUserDisplayName(user);

  return (
    <div className="space-y-6">
      {/* ── Hero banner ── */}
      <div className="dash-hero animate-fade-in-up">
        <div className="relative z-10">
          <div className="text-xs font-bold uppercase tracking-widest text-white/60">
            {yyyyMmToLabel(month, year)} · {unit.unit_name}
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white sm:text-4xl">
            {greeting}, {displayName}
          </h1>
          <p className="mt-2 text-sm text-white/80 max-w-md">
            {user.role === "MUSIC" 
              ? "Your music coordination dashboard. Manage hymns and musical assignments for upcoming meetings."
              : "Your sacrament meeting coordinator dashboard. Everything you need for this month's planning is right here."}
          </p>

          {/* Summary pill row */}
          <div className="mt-4 flex flex-wrap gap-3">
            <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
              <span>📅</span>
              <span>{upcoming.length} upcoming Sunday{upcoming.length !== 1 ? "s" : ""}</span>
            </div>
            {user.role !== "MUSIC" && (
              <>
                <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
                  <span>🎙️</span>
                  <span>{speakerCount} speaker{speakerCount !== 1 ? "s" : ""} assigned</span>
                </div>
                <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
                  <span>✅</span>
                  <span>{readinessStats.pct}% checklist done</span>
                </div>
              </>
            )}
            {user.role === "MUSIC" && (
              <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
                <span>🎵</span>
                <span>{latestSubmitted?.music_status === "COMPLETE" ? "Music items finalized" : "Music input needed"}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Upcoming Sundays */}
        <div className="stat-card animate-fade-in-up stagger-1">
          <div className="stat-card-bar bar-blue" />
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Upcoming Sundays
              </div>
              <div className="stat-icon stat-icon-blue">📅</div>
            </div>
            <div className="mt-3 space-y-2">
              {upcoming.length === 0 ? (
                <div className="text-sm text-slate-400">No more Sundays this month.</div>
              ) : (
                upcoming.slice(0, 3).map((d, idx) => (
                  <div key={d} className={`sunday-chip stagger-${idx + 1}`}>
                    <span className="text-sm font-semibold text-slate-700">{formatDateShort(d)}</span>
                    <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">
                      Sunday
                    </span>
                  </div>
                ))
              )}
              {upcoming.length > 3 && (
                <div className="text-center text-xs font-medium text-slate-400">
                  +{upcoming.length - 3} more
                </div>
              )}
            </div>
            <div className="mt-4">
              {user.role !== "MUSIC" ? (
                <Button variant="primary" className="w-full" onClick={() => onNavigate("planner")}>
                  Open Planner →
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {user.role === "MUSIC" ? (
          <>
            <div className="stat-card animate-fade-in-up stagger-2">
              <div className="stat-card-bar bar-violet" />
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Music Status</div>
                  <div className="stat-icon stat-icon-violet">🎵</div>
                </div>
                <div className="mt-4">
                  <div className="text-sm text-slate-700">
                    {latestSubmitted
                      ? latestSubmitted.music_status === "COMPLETE"
                        ? "Latest submitted planner: music finalized"
                        : "Latest submitted planner: music input needed"
                      : "No submitted planner yet"}
                  </div>
                </div>
                <div className="mt-4">
                  <Button className="w-full" onClick={() => onNavigate("music")}>
                    Open Music Toolkit
                  </Button>
                </div>
              </div>
            </div>

            <div className="stat-card animate-fade-in-up stagger-3">
              <div className="stat-card-bar bar-green" />
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Hymn Library</div>
                  <div className="stat-icon stat-icon-green">📚</div>
                </div>
                <div className="mt-4">
                  <div className="text-3xl font-extrabold text-slate-800">{(db.HYMNS || []).length}</div>
                  <div className="text-xs text-slate-400">hymns available</div>
                </div>
                <div className="mt-4">
                  <Button variant="secondary" className="w-full" onClick={() => onNavigate("music")}>
                    Manage Hymns
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Speakers / Assignments */}
            <div className="stat-card animate-fade-in-up stagger-2">
              <div className="stat-card-bar bar-violet" />
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Assignments
                  </div>
                  <div className="stat-icon stat-icon-violet">🎙️</div>
                </div>
                <div className="mt-4 flex items-end gap-2">
                  <div className="animate-count-up text-5xl font-extrabold tracking-tight text-slate-800">
                    {speakerCount}
                  </div>
                  <div className="mb-1.5 text-sm text-slate-500">speaker{speakerCount !== 1 ? "s" : ""}</div>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  From the latest submitted plan
                </div>
                <div
                  className="mt-3 h-1.5 rounded-full"
                  style={{ background: "rgba(0,0,0,0.06)" }}
                >
                  <div
                    className="h-1.5 rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.min(speakerCount * 10, 100)}%`,
                      background: "linear-gradient(90deg, #7c3aed, #a78bfa)",
                    }}
                  />
                </div>
                <div className="mt-4">
                  <Button variant="secondary" className="w-full" onClick={() => onNavigate("assignments")}>
                    Generate Notifications
                  </Button>
                </div>
              </div>
            </div>

            {/* Readiness */}
            <div className="stat-card animate-fade-in-up stagger-3">
              <div className="stat-card-bar bar-green" />
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Readiness
                  </div>
                  <div className="stat-icon stat-icon-green">✅</div>
                </div>
                <div className="mt-4 flex items-center gap-4">
                  <div className="relative shrink-0">
                    <ProgressRing pct={readinessStats.pct} size={80} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-lg font-extrabold text-slate-800">{readinessStats.pct}%</span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-2xl font-bold text-slate-800">
                      {readinessStats.done}
                      <span className="text-base font-normal text-slate-400">
                        /{readinessStats.total}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {nextSundayInfo ? `Next Sunday (${formatDateShort(nextSundayInfo.date)})` : "Latest submitted planner"}
                    </div>
                    <div className="mt-2 text-xs font-medium text-emerald-600">
                      {readinessStats.pct >= 100
                        ? "🎉 All done!"
                        : readinessStats.pct >= 50
                        ? "Making progress!"
                        : "Getting started…"}
                    </div>
                    {nextSundayInfo && (
                      <div className="mt-1 text-[11px] text-slate-400">
                        Overall planner: {aggregateChecklistStats.done}/{aggregateChecklistStats.total} ({aggregateChecklistStats.pct}%)
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-4">
                  <Button variant="secondary" className="w-full" onClick={() => onNavigate("checklist")}>
                    Open Checklist
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Next Sunday Program Quick-View ── */}
      {nextSundayDetails && user.role !== "MUSIC" && (
        <div className="stat-card animate-fade-in-up stagger-4 overflow-hidden border border-slate-100 bg-white shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">⛪</span>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Next Sunday Service Outline</h3>
                <p className="text-[10px] text-slate-400 font-medium">
                  {formatDateShort(nextSundayDetails.date)} · Sacrament Meeting
                </p>
              </div>
            </div>
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              {nextSundayDetails.meeting_type || "Normal Service"}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            {/* Left Column: Leadership & Prayers */}
            <div className="space-y-3">
              <div className="font-bold uppercase tracking-wider text-slate-400 text-[10px]">
                Leadership & Prayers
              </div>
              <div className="space-y-2 rounded-xl bg-slate-50/50 p-3 border border-slate-100">
                <div className="flex justify-between py-1 border-b border-slate-100/50">
                  <span className="text-slate-500 font-medium">Presiding</span>
                  <span className="font-semibold text-slate-800">{nextSundayDetails.presiding || "Bishopric"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100/50">
                  <span className="text-slate-500 font-medium">Conducting</span>
                  <span className="font-semibold text-slate-800">{nextSundayDetails.conducting_officer || "—"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100/50">
                  <span className="text-slate-500 font-medium">Invocation</span>
                  <span className="font-semibold text-slate-800">{nextSundayDetails.prayers?.invocation || "—"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500 font-medium">Benediction</span>
                  <span className="font-semibold text-slate-800">{nextSundayDetails.prayers?.benediction || "—"}</span>
                </div>
              </div>

              {/* Music Details */}
              <div className="font-bold uppercase tracking-wider text-slate-400 text-[10px] pt-1">
                Sacrament Hymns
              </div>
              <div className="space-y-2 rounded-xl bg-slate-50/50 p-3 border border-slate-100">
                <div className="flex justify-between py-1 border-b border-slate-100/50">
                  <span className="text-slate-500 font-medium">Opening Hymn</span>
                  <span className="font-semibold text-slate-800">{nextSundayDetails.hymns?.opening || "—"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100/50">
                  <span className="text-slate-500 font-medium">Sacrament Hymn</span>
                  <span className="font-semibold text-slate-800">{nextSundayDetails.hymns?. sacrament || "—"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500 font-medium">Closing Hymn</span>
                  <span className="font-semibold text-slate-800">{nextSundayDetails.hymns?.closing || "—"}</span>
                </div>
              </div>
            </div>

            {/* Right Column: Speakers or Fast Meeting */}
            <div className="space-y-3">
              <div className="font-bold uppercase tracking-wider text-slate-400 text-[10px]">
                Speakers & Messages
              </div>
              {nextSundayDetails.fast_testimony ? (
                <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-4 text-center text-blue-800 h-full flex flex-col justify-center items-center">
                  <span className="text-2xl mb-1" role="img" aria-label="Dove">🕊️</span>
                  <div className="font-bold text-sm">Fast & Testimony Meeting</div>
                  <p className="text-[11px] text-slate-500 mt-1 max-w-[240px] leading-relaxed">
                    No speakers scheduled. Members of the congregation will be invited to bear their testimonies.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {(nextSundayDetails.speakers || []).filter(s => s.name.trim()).length === 0 ? (
                    <div className="text-slate-400 text-center py-6 border border-dashed border-slate-200 rounded-xl">
                      No speakers assigned yet.
                    </div>
                  ) : (
                    (nextSundayDetails.speakers || [])
                      .filter(s => s.name.trim())
                      .map((s, sIdx) => (
                        <div key={sIdx} className="rounded-xl bg-slate-50/50 p-3 border border-slate-100 flex justify-between items-start gap-3">
                          <div className="space-y-0.5 min-w-0">
                            <div className="font-bold text-slate-800 truncate">{s.name}</div>
                            {s.topic && (
                              <div className="text-[10px] text-slate-500 font-medium leading-normal">
                                Topic: <span className="text-slate-700">{s.topic}</span>
                              </div>
                            )}
                            {s.reference && (
                              <div className="text-[10px] text-slate-400 font-medium leading-normal">
                                Scripture: <span className="text-slate-600 italic">{s.reference}</span>
                              </div>
                            )}
                          </div>
                          {s.reference_link && (
                            <a
                              href={s.reference_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 hover:underline shrink-0 bg-blue-50 border border-blue-100 px-2 py-1 rounded-lg transition"
                            >
                              Link ↗
                            </a>
                          )}
                        </div>
                      ))
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-end pt-2 border-t border-slate-100">
            <Button onClick={() => onNavigate("agenda")} variant="secondary" className="text-xs">
              Open Agenda Program →
            </Button>
          </div>
        </div>
      )}

      {/* ── Upcoming Music Outlines (Music Coordinator Only) ── */}
      {user.role === "MUSIC" && (
        <div className="stat-card animate-fade-in-up stagger-4 overflow-hidden border border-slate-100 bg-white shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">🎶</span>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Upcoming Hymns & Music Outlines</h3>
                <p className="text-[10px] text-slate-400 font-medium">
                  Quick view of musical assignments for upcoming sacrament meetings
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {submittedPlanners.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                No submitted planners found. Hymns will appear here once plans are submitted.
              </div>
            ) : (
              submittedPlanners.slice(0, 3).map((p) => {
                const todayISO = new Date().toISOString().slice(0, 10);
                const upcomingWeeks = p.weeks.filter(w => w.date >= todayISO);
                if (upcomingWeeks.length === 0) return null;

                return (
                  <div key={p.planner_id} className="space-y-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {yyyyMmToLabel(p.month, p.year)} Planner
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {upcomingWeeks.map((w) => (
                        <div key={w.week_id} className="rounded-xl bg-slate-50/50 p-3.5 border border-slate-100 space-y-3 text-xs">
                          <div className="flex justify-between items-center border-b border-slate-100/50 pb-1.5">
                            <span className="font-bold text-slate-700">{formatDateShort(w.date)}</span>
                            <span className="text-[10px] font-semibold bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full border border-sky-100">
                              {w.meeting_type || "Normal"}
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div className="text-center p-1.5 bg-white rounded-lg border border-slate-100">
                              <div className="text-[9px] text-slate-400 font-bold uppercase">Opening</div>
                              <div className="font-bold text-slate-800 mt-1 truncate" title={w.hymns?.opening || "—"}>
                                {w.hymns?.opening ? w.hymns.opening.split(" ")[0] : "—"}
                              </div>
                            </div>
                            <div className="text-center p-1.5 bg-white rounded-lg border border-slate-100">
                              <div className="text-[9px] text-slate-400 font-bold uppercase">Sacrament</div>
                              <div className="font-bold text-slate-800 mt-1 truncate" title={w.hymns?.sacrament || "—"}>
                                {w.hymns?.sacrament ? w.hymns.sacrament.split(" ")[0] : "—"}
                              </div>
                            </div>
                            <div className="text-center p-1.5 bg-white rounded-lg border border-slate-100">
                              <div className="text-[9px] text-slate-400 font-bold uppercase">Closing</div>
                              <div className="font-bold text-slate-800 mt-1 truncate" title={w.hymns?.closing || "—"}>
                                {w.hymns?.closing ? w.hymns.closing.split(" ")[0] : "—"}
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1 text-[10px] text-slate-500 pt-1 border-t border-slate-100/30">
                            <div className="flex justify-between">
                              <span>Director:</span>
                              <span className="font-medium text-slate-700">{w.music?.director || "—"}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Organist:</span>
                              <span className="font-medium text-slate-700">{w.music?.accompanist || "—"}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-100">
            <Button onClick={() => onNavigate("music")} variant="secondary" className="text-xs">
              Open Music Toolkit →
            </Button>
          </div>
        </div>
      )}

      {/* ── Quick Actions ── */}
      <div className="animate-fade-in-up stagger-4">
        <div className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">
          Quick Actions
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {[
            { icon: "📅", label: "New Plan", color: "#e0f2fe", route: "planner" as const, roles: ["ADMIN", "BISHOPRIC", "CLERK", "SECRETARY"] },
            { icon: "📝", label: "Agenda", color: "#fee2e2", route: "agenda" as const, roles: ["ADMIN", "BISHOPRIC", "CLERK", "SECRETARY"] },
            { icon: "👥", label: "Members", color: "#ede9fe", route: "members" as const, roles: ["ADMIN", "BISHOPRIC", "CLERK"] },
            { icon: "✅", label: "Checklist", color: "#dcfce7", route: "checklist" as const, roles: ["ADMIN", "BISHOPRIC", "CLERK", "SECRETARY"] },
            { icon: "🎵", label: "Music", color: "#fdf4ff", route: "music" as const, roles: ["ADMIN", "MUSIC"] },
            { icon: "✉️", label: "Notify", color: "#fef9c3", route: "assignments" as const, roles: ["ADMIN", "BISHOPRIC", "CLERK", "SECRETARY"] },
          ]
            .filter(qa => !qa.roles || qa.roles.includes(user.role))
            .map((qa) => (
            <button
              key={qa.route}
              className="quick-action-btn"
              onClick={() => onNavigate(qa.route as any)}
              style={{ minWidth: "80px" }}
            >
              <div className="qa-icon" style={{ background: qa.color }}>
                {qa.icon}
              </div>
              <span className="text-xs font-semibold text-slate-600">{qa.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Spiritual Thought ── */}
      <div className="quote-card animate-fade-in-up stagger-5 shadow-sm hover:shadow-md transition-shadow">
        <div className="relative z-10">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-widest text-blue-600/80">
              ✦ Spiritual Thought
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyQuote}
                className="rounded-lg px-2 py-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all text-xs font-semibold flex items-center gap-1 cursor-pointer border border-slate-200 hover:border-blue-100"
                title="Copy to Clipboard"
              >
                <span>{copied ? "Copied! ✓" : "Copy 📋"}</span>
              </button>
              <button
                onClick={handleShuffleQuote}
                className="rounded-lg px-2 py-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all text-xs font-semibold flex items-center gap-1 cursor-pointer border border-slate-200 hover:border-blue-100"
                title="Next Thought"
              >
                <span>Next ↻</span>
              </button>
            </div>
          </div>
          <blockquote className="text-lg font-medium leading-relaxed text-slate-700 italic">
            "{quote.text}"
          </blockquote>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-blue-100 to-transparent" />
            <cite className="text-sm font-bold not-italic text-blue-600">
              {quote.ref}
            </cite>
          </div>
        </div>
      </div>

      {/* ── Recent Activity ── */}
      <div className="animate-fade-in-up stagger-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Recent Activity
          </div>
        </div>
        <div className="space-y-3">
          {db.PLANNERS.slice(0, 3).map((p) => (
            <div key={p.planner_id} className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-all hover:scale-[1.01] hover:shadow-md">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <span className="text-lg font-bold">{p.month}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-slate-800">
                  {yyyyMmToLabel(p.month, p.year)} Plan
                </div>
                <div className="text-xs text-slate-500">
                  Status: <span className={cn("font-semibold", p.state === "SUBMITTED" ? "text-emerald-600" : "text-amber-600")}>{p.state}</span> · Updated {formatDateShort(p.updated_date)}
                </div>
              </div>
              <Button variant="ghost" onClick={() => onNavigate("planner")}>
                View
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Empty state if no submitted plans ── */}
      {!latestSubmitted && (
        <EmptyState
          title="No submitted plans yet"
          body="Create a planner and submit it to unlock assignments and readiness workflows."
          action={<Button onClick={() => onNavigate("planner")}>Go to Planner →</Button>}
        />
      )}
    </div>
  );
}
