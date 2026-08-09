import type { Assignment, DB, Planner } from "../types";

export const AUGUST_2026_PLANNER: Planner = {
  planner_id: "planner_august_2026",
  unit_name: "OBANTOKO WARD",
  month: 8,
  year: 2026,
  state: "SUBMITTED",
  conducting_officer: "Obaji, Solomon Emmanuel",
  created_by: "Obaji, Solomon Emmanuel",
  created_date: "2026-08-01T00:00:00.000Z",
  updated_date: "2026-08-09T08:45:00.000Z",
  music_status: "COMPLETE",
  weeks: [
    {
      week_id: "week_1",
      date: "2026-08-02",
      conducting_officer: "Obaji, Solomon Emmanuel",
      fast_testimony: true,
      speakers: [],
      hymns: {
        opening: "1035, As I keep the Sabbath Day",
        sacrament: "146, Gently Raise The Sacred Strain",
        closing: "157, Thy Spirit Lord Has Stirred My Soul",
      },
      sacrament: { preparing: [], blessing: [], passing: [] },
      prayers: {
        invocation: "Sister Kushimo, Deborah Anuoluwapo",
        invocation_gender: "F",
        benediction: "Brother Olatunji, Matthew Okikijesu",
        benediction_gender: "M",
      },
    },
    {
      week_id: "week_2",
      date: "2026-08-09",
      conducting_officer: "Obaji, Solomon Emmanuel",
      fast_testimony: false,
      speakers: [
        {
          name: "Brother Iorna, Daniel Msughter",
          topic: "the purpose of the sacrament",
          reference: "The Sacrament, Gospel Principle page 23",
          gender: "M",
        },
        {
          name: "Brother Okoro, Eze Kingsley",
          topic: "The Sacrament: A Sacred Ordinance",
          reference: "general conference talk Dalin H. Oaks. Sacrament meeting and the sacrament.",
          gender: "M",
        },
        {
          name: "Brother Bankole, Olajide Isaiah",
          topic: "The Sabbath: A Sacred Day",
          reference: "The Sabbath Day is for Us By Elder Thierry K. Mutombo First Counselor in the Africa Central Area Presidency",
          gender: "M",
        },
      ],
      hymns: {
        opening: "280, Welcome, Welcome Sabbath Morning",
        sacrament: "190, In Memory Of The Crucified",
        closing: "1048, Our Prayer To Thee",
      },
      sacrament: { preparing: [], blessing: [], passing: [] },
      prayers: {
        invocation: "Brother Akande, Aaron Olamide",
        invocation_gender: "M",
        benediction: "Sister Adenola, Florence Fatimo",
        benediction_gender: "F",
      },
    },
    {
      week_id: "week_3",
      date: "2026-08-16",
      conducting_officer: "Obaji, Solomon Emmanuel",
      fast_testimony: false,
      speakers: [
        {
          name: "Sister Oke, Fridaos Darasimi",
          topic: "The Purpose of the Sabbath Day",
          reference: "The Sabbath Day. Gospel Library page 24",
          gender: "F",
        },
        {
          name: "Sister Ajayi, Omowumi Anike",
          topic: "Reverence in Worship: Focusing on the Lord",
          reference: "general conference talk Dalin H. Oaks. Sacrament meeting and the sacrament.",
          gender: "F",
        },
        {
          name: "Brother Oyewusi, Adebayo Babatunde",
          topic: "Reverence: A Path to Deeper Communion with God",
          reference: "Reverence for Sacred Things By Elder Ulisses Soares Of the Quorum of the Twelve Apostles",
          gender: "M",
        },
      ],
      hymns: {
        opening: "1026, Holy Places",
        sacrament: "192, He Died! The Great Redeemer Died",
        closing: "1013, God's Gracious Love",
      },
      sacrament: { preparing: [], blessing: [], passing: [] },
      prayers: {
        invocation: "Sister Aroge, Eniola Kofoworola",
        invocation_gender: "F",
        benediction: "Brother Ishola, Olajide Oluwapelumi",
        benediction_gender: "M",
      },
    },
    {
      week_id: "week_4",
      date: "2026-08-23",
      conducting_officer: "Obaji, Solomon Emmanuel",
      fast_testimony: false,
      speakers: [
        {
          name: "Brother Okorie, Emmanuel Chigoziri",
          topic: "faithfulness unlocks spiritual power",
          reference: "identifying covenants blessings already present in our homes and wards",
          gender: "M",
        },
        {
          name: "Sister Funmi Soremi",
          topic: "Agency and Accountability",
          reference: "helping youth and families make daily choices that align with covenant promises",
          gender: "F",
        },
      ],
      hymns: {
        opening: "70, Sing Praise to him",
        sacrament: "195, How great the wisdom and the love",
        closing: "243, Let Us All Press On",
      },
      sacrament: { preparing: [], blessing: [], passing: [] },
      prayers: {
        invocation: "Brother Sobakin, Oladimeji Olayinka",
        invocation_gender: "M",
        benediction: "Sister Oyewusi, Ejibusola Morenikeji",
        benediction_gender: "F",
      },
    },
    {
      week_id: "week_5",
      date: "2026-08-30",
      conducting_officer: "Obaji, Solomon Emmanuel",
      fast_testimony: false,
      speakers: [],
      hymns: {
        opening: "",
        sacrament: "",
        closing: "",
      },
      sacrament: { preparing: [], blessing: [], passing: [] },
      prayers: {
        invocation: "",
        benediction: "",
      },
    },
  ],
};

export const AUGUST_2026_ASSIGNMENTS: Assignment[] = [
  // Week 1
  {
    assignment_id: "ass_aug_2026_w1_inv",
    planner_id: "planner_august_2026",
    week_id: "week_1",
    date: "2026-08-02",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Sister Kushimo, Deborah Anuoluwapo",
    role: "Invocation",
    topic: "",
    minutes: undefined,
    created_date: "2026-08-01T00:00:00.000Z",
  },
  {
    assignment_id: "ass_aug_2026_w1_ben",
    planner_id: "planner_august_2026",
    week_id: "week_1",
    date: "2026-08-02",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Brother Olatunji, Matthew Okikijesu",
    role: "Benediction",
    topic: "",
    minutes: undefined,
    created_date: "2026-08-01T00:00:00.000Z",
  },
  // Week 2
  {
    assignment_id: "ass_aug_2026_w2_spk1",
    planner_id: "planner_august_2026",
    week_id: "week_2",
    date: "2026-08-09",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Brother Iorna, Daniel Msughter",
    role: "Speaker 1",
    topic: "the purpose of the sacrament",
    minutes: 10,
    created_date: "2026-08-01T00:00:00.000Z",
  },
  {
    assignment_id: "ass_aug_2026_w2_spk2",
    planner_id: "planner_august_2026",
    week_id: "week_2",
    date: "2026-08-09",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Brother Okoro, Eze Kingsley",
    role: "Speaker 2",
    topic: "The Sacrament: A Sacred Ordinance",
    minutes: 12,
    created_date: "2026-08-01T00:00:00.000Z",
  },
  {
    assignment_id: "ass_aug_2026_w2_spk3",
    planner_id: "planner_august_2026",
    week_id: "week_2",
    date: "2026-08-09",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Brother Bankole, Olajide Isaiah",
    role: "Speaker 3",
    topic: "The Sabbath: A Sacred Day",
    minutes: 15,
    created_date: "2026-08-01T00:00:00.000Z",
  },
  {
    assignment_id: "ass_aug_2026_w2_inv",
    planner_id: "planner_august_2026",
    week_id: "week_2",
    date: "2026-08-09",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Brother Akande, Aaron Olamide",
    role: "Invocation",
    topic: "",
    minutes: undefined,
    created_date: "2026-08-01T00:00:00.000Z",
  },
  {
    assignment_id: "ass_aug_2026_w2_ben",
    planner_id: "planner_august_2026",
    week_id: "week_2",
    date: "2026-08-09",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Sister Adenola, Florence Fatimo",
    role: "Benediction",
    topic: "",
    minutes: undefined,
    created_date: "2026-08-01T00:00:00.000Z",
  },
  // Week 3
  {
    assignment_id: "ass_aug_2026_w3_spk1",
    planner_id: "planner_august_2026",
    week_id: "week_3",
    date: "2026-08-16",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Sister Oke, Fridaos Darasimi",
    role: "Speaker 1",
    topic: "The Purpose of the Sabbath Day",
    minutes: 10,
    created_date: "2026-08-01T00:00:00.000Z",
  },
  {
    assignment_id: "ass_aug_2026_w3_spk2",
    planner_id: "planner_august_2026",
    week_id: "week_3",
    date: "2026-08-16",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Sister Ajayi, Omowumi Anike",
    role: "Speaker 2",
    topic: "Reverence in Worship: Focusing on the Lord",
    minutes: 12,
    created_date: "2026-08-01T00:00:00.000Z",
  },
  {
    assignment_id: "ass_aug_2026_w3_spk3",
    planner_id: "planner_august_2026",
    week_id: "week_3",
    date: "2026-08-16",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Brother Oyewusi, Adebayo Babatunde",
    role: "Speaker 3",
    topic: "Reverence: A Path to Deeper Communion with God",
    minutes: 15,
    created_date: "2026-08-01T00:00:00.000Z",
  },
  {
    assignment_id: "ass_aug_2026_w3_inv",
    planner_id: "planner_august_2026",
    week_id: "week_3",
    date: "2026-08-16",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Sister Aroge, Eniola Kofoworola",
    role: "Invocation",
    topic: "",
    minutes: undefined,
    created_date: "2026-08-01T00:00:00.000Z",
  },
  {
    assignment_id: "ass_aug_2026_w3_ben",
    planner_id: "planner_august_2026",
    week_id: "week_3",
    date: "2026-08-16",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Brother Ishola, Olajide Oluwapelumi",
    role: "Benediction",
    topic: "",
    minutes: undefined,
    created_date: "2026-08-01T00:00:00.000Z",
  },
  // Week 4
  {
    assignment_id: "ass_aug_2026_w4_spk1",
    planner_id: "planner_august_2026",
    week_id: "week_4",
    date: "2026-08-23",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Brother Okorie, Emmanuel Chigoziri",
    role: "Speaker 1",
    topic: "faithfulness unlocks spiritual power",
    minutes: 10,
    created_date: "2026-08-01T00:00:00.000Z",
  },
  {
    assignment_id: "ass_aug_2026_w4_spk2",
    planner_id: "planner_august_2026",
    week_id: "week_4",
    date: "2026-08-23",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Sister Funmi Soremi",
    role: "Speaker 2",
    topic: "Agency and Accountability",
    minutes: 15,
    created_date: "2026-08-01T00:00:00.000Z",
  },
  {
    assignment_id: "ass_aug_2026_w4_inv",
    planner_id: "planner_august_2026",
    week_id: "week_4",
    date: "2026-08-23",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Brother Sobakin, Oladimeji Olayinka",
    role: "Invocation",
    topic: "",
    minutes: undefined,
    created_date: "2026-08-01T00:00:00.000Z",
  },
  {
    assignment_id: "ass_aug_2026_w4_ben",
    planner_id: "planner_august_2026",
    week_id: "week_4",
    date: "2026-08-23",
    venue: "Chapel",
    meeting_time: "Not set",
    person: "Sister Oyewusi, Ejibusola Morenikeji",
    role: "Benediction",
    topic: "",
    minutes: undefined,
    created_date: "2026-08-01T00:00:00.000Z",
  },
];

export function resolveAugustPlannerSeed(p: Planner | null | undefined): Planner | null {
  if (!p) return null;
  if (p.month === 8 && p.year === 2026) {
    const hasNamedSpeakers = (p.weeks || []).some((w) =>
      (w.speakers || []).some((s) => s.name && s.name.trim().length > 0)
    );
    const hasHymns = (p.weeks || []).some(
      (w) => w.hymns && (w.hymns.opening || w.hymns.sacrament || w.hymns.closing)
    );
    if (!hasNamedSpeakers || !hasHymns) {
      return {
        ...AUGUST_2026_PLANNER,
        planner_id: p.planner_id || AUGUST_2026_PLANNER.planner_id,
        unit_name: p.unit_name || AUGUST_2026_PLANNER.unit_name,
        conducting_officer: p.conducting_officer || AUGUST_2026_PLANNER.conducting_officer,
      };
    }
  }
  return p;
}

export function ensureAugust2026PlannerInDB(db: DB): DB {
  let foundAugust = false;

  const updatedPlanners = db.PLANNERS.map((existing) => {
    if (existing.month === 8 && existing.year === 2026) {
      foundAugust = true;
      const hasNamedSpeakers = (existing.weeks || []).some((w) =>
        (w.speakers || []).some((s) => s.name && s.name.trim().length > 0)
      );
      const hasHymns = (existing.weeks || []).some(
        (w) => w.hymns && (w.hymns.opening || w.hymns.sacrament || w.hymns.closing)
      );
      
      // Force update if incomplete
      if (!hasNamedSpeakers || !hasHymns) {
        return {
          ...AUGUST_2026_PLANNER,
          planner_id: existing.planner_id || AUGUST_2026_PLANNER.planner_id,
        };
      }
    }
    return existing;
  });

  if (!foundAugust) {
    updatedPlanners.unshift(AUGUST_2026_PLANNER);
  }

  // Target planner IDs for August 2026
  const augustPlannerIds = new Set(
    updatedPlanners.filter((p) => p.month === 8 && p.year === 2026).map((p) => p.planner_id)
  );

  const augustAssignments: Assignment[] = [];
  for (const pid of augustPlannerIds) {
    for (const a of AUGUST_2026_ASSIGNMENTS) {
      augustAssignments.push({
        ...a,
        assignment_id: `ass_${pid}_${a.week_id}_${a.role.replace(/[^a-z0-9]/gi, "")}`,
        planner_id: pid,
      });
    }
  }

  const existingAssignIds = new Set(db.ASSIGNMENTS.map((a) => a.assignment_id));
  const newAssignments = augustAssignments.filter((a) => !existingAssignIds.has(a.assignment_id));
  const updatedAssignments = [...newAssignments, ...db.ASSIGNMENTS];

  return {
    ...db,
    PLANNERS: updatedPlanners,
    ASSIGNMENTS: updatedAssignments,
  };
}
