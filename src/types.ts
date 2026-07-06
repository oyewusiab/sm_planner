export type Role = "ADMIN" | "BISHOPRIC" | "CLERK" | "SECRETARY" | "MUSIC";

export type Organisation = "Bishopric" | "Clerk" | "Secretary" | "Music" | "Other";

export type UnitType = "Ward" | "Branch";

export type Venue = {
  venue_id: string;
  name: string;
  address?: string;
  is_default?: boolean;
};

export type UnitSettings = {
  unit_name: string;
  stake_name?: string;
  unit_type: UnitType;
  leader_name: string;
  phone: string;
  venue: string; // Deprecated, use venues
  venues?: Venue[];
  meeting_time: string;
  created_date: string;
  prefs?: {
    /** Reminder scheduling defaults */
    reminder_offsets_days?: number[]; // e.g., [7, 2]

    /** Planner defaults */
    default_speakers?: number;
    default_meeting_duration_min?: number;

    /** Checklist */
    enable_checklist?: boolean;
    checklist_tasks?: string[];

    /** Assignments */
    assignment_message_template?: string;

    /** Locale */
    default_country?: "NG";

    /** Feature Flags */
    enable_music_toolkit?: boolean;
    enable_member_analytics?: boolean;
    gemini_api_key?: string;
  };
};

export type ReminderChannel = "INTERNAL" | "WHATSAPP" | "EMAIL";

export type ReminderStatus = "SCHEDULED" | "SENT" | "CANCELLED";

export type ReminderJob = {
  reminder_id: string;

  /** Related data */
  planner_id?: string;
  week_id?: string;
  assignment_id?: string;

  /** Target */
  to_person: string;
  to_user_id?: string;

  /** Message */
  channel: ReminderChannel;
  title: string;
  body: string;

  /** When to send */
  scheduled_for_date: string; // YYYY-MM-DD

  status: ReminderStatus;
  created_by_user_id: string;
  created_date: string;
  sent_date?: string;
};


export type User = {
  user_id: string;

  /** Display name (e.g., "Adeyemi Olajide"). */
  name: string;

  /** Optional preferred name (e.g., "Bro. Adeyemi" or "Olajide"). */
  preferred_name?: string;

  /** Optional username for login (Nigeria units often prefer short usernames). */
  username?: string;

  /** Email can also be used for login (or left blank in some units). */
  email: string;

  /** Profile/contact */
  phone?: string;
  whatsapp?: string;
  gender?: "M" | "F";
  address?: string;
  lga?: string;
  state?: string;
  country?: string;

  emergency_contact_name?: string;
  emergency_contact_phone?: string;

  /** Optional e-signature image (data URL) for printing assignment notifications. */
  signature_data_url?: string;

  notes?: string;

  /** Access control */
  role: Role;
  /** Optional grouping label (used in Nigeria role setup / directory). */
  organisation?: Organisation;
  /** Optional calling/title inside organisation (e.g., Bishop, Clerk, Music Coordinator). */
  calling?: string;

  /** Security */
  password_hash: string;
  created_date: string;
  last_login_date?: string;
  must_reset_password?: boolean;
  disabled?: boolean;
  auth_uid?: string;
};

export type WeekPlan = {
  week_id: string;
  date: string; // YYYY-MM-DD
  conducting_officer: string;
  presiding?: string;

  /** Fast & Testimony meeting flag (no speakers). */
  fast_testimony?: boolean;

  /** Speakers (gender used to print Brother/Sister prefix). */
  speakers: { name: string; topic: string; reference?: string; gender?: "M" | "F"; reference_link?: string }[];

  hymns: { opening: string; sacrament: string; closing: string };

  /** Filled by music coordinator (optional). */
  music?: {
    director?: string;
    director_gender?: "M" | "F";
    accompanist?: string;
    accompanist_gender?: "M" | "F";
  };

  /**
   * Sacrament administration can involve multiple people.
   * Stored as arrays to support printing and per-person assignment notifications.
   */
  sacrament: { preparing: string[]; blessing: string[]; passing: string[] };

  /** Prayers (gender used to print Brother/Sister prefix). */
  prayers: {
    invocation: string;
    invocation_gender?: "M" | "F";
    benediction: string;
    benediction_gender?: "M" | "F";
  };

  /** Optional notes for the week (printed on the Back Page). */
  note?: string;

  /** Venue override for this specific week */
  venue_id?: string;
  meeting_time_override?: string;
  meeting_type?: "Normal" | "Fast & Testimony" | "Combined" | "Stake Conference" | "Special";
  is_canceled?: boolean;
  cancel_reason?: string;
};

export type Hymn = {
  number: number;
  title: string;
  type?: string; // "Classic" or "New"
  theme?: string;
  last_used?: string; // ISO date
  usage_count?: number;
  tags?: string[];
  updated_date?: string;
};

export type MemberAnalytics = {
  member_id: string;
  assignment_count_12m: number;
  last_assignment_date?: string;
  unconfirmed_rate: number; // 0-1
  avg_completion_time_days?: number;
};

export type PlannerState = "DRAFT" | "SUBMITTED" | "ARCHIVED";

export type Planner = {
  planner_id: string;
  unit_name: string;
  month: number; // 1-12
  year: number;
  created_by: string;
  created_date: string;
  updated_date: string;
  state: PlannerState;
  conducting_officer: string;
  /** Music is entered by Music Coordinator after submission (optional). */
  music_status?: "PENDING" | "COMPLETE";
  weeks: WeekPlan[]; // 1-5
  archive_method?: "manual" | "auto";
  archive_date?: string;
};

export type Assignment = {
  assignment_id: string;
  planner_id: string;
  week_id: string;
  date: string;
  venue: string;
  meeting_time: string;
  person: string;
  role: string; // Speaker / Prayer / etc.
  topic?: string;
  reference?: string;
  reference_link?: string;

  /** Default time is generated per role but can be edited before printing. */
  minutes?: number;

  created_date: string;
  sent_status?: "PENDING" | "SENT" | "REMINDED";
  sent_date?: string;
};

export type Member = {
  member_id: string;
  name: string;
  age?: number;
  gender?: string;
  phone?: string;
  organisation?: string;
  status?: string;
  email?: string;
  notes?: string;
  created_date?: string;
  total_assignments?: number;
  spoken_count?: number;
  prayers_count?: number;
  last_assigned_date?: string;
  readiness_score?: number;
};

export type ChecklistTask = {
  checklist_id: string;
  planner_id: string;
  week_id: string;
  week_label: string; // e.g., "Week 1" or date label
  task: string;
  responsible?: string;
  status: boolean;
  updated_by?: string;
  updated_date: string;
};

export type NotificationType =
  | "SETTINGS_APPROVAL_REQUEST"
  | "SETTINGS_APPROVAL_DECISION"
  | "PLANNER_SUBMITTED"
  | "PLANNER_APPROVAL_REQUEST"
  | "PLANNER_APPROVAL_DECISION"
  | "MUSIC_INPUT_REQUEST"
  | "REMINDER"
  | "TODO_ASSIGNED"
  | "TODO_COMPLETED"
  | "SETTINGS_DECISION"
  | "PLANNER_EXPIRY_APPROVAL"
  | "AGENDA_EXPIRY_APPROVAL";

export type Notification = {
  notification_id: string;
  to_user_id: string;
  type: NotificationType;
  created_date: string;
  read: boolean;
  title: string;
  body: string;
  /** Extra metadata (e.g., planner_id). */
  meta?: Record<string, string>;
};

export type SettingsChangeRequest = {
  request_id: string;
  requested_by: string;
  created_date: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decided_by?: string;
  decided_date?: string;
  /** Partial UnitSettings patch (only supported fields). */
  patch: Partial<UnitSettings>;
  reason?: string;
  broadcast?: {
    role: string;
    title: string;
    body: string;
  };
};

export type TodoPriority = "LOW" | "NORMAL" | "HIGH";

export type TodoStatus = "OPEN" | "DONE";

export type TodoItem = {
  todo_id: string;
  title: string;
  details?: string;
  due_date?: string; // YYYY-MM-DD
  priority: TodoPriority;
  status: TodoStatus;

  /** Assignment */
  assigned_to_user_id?: string;
  created_by_user_id: string;

  /** Links */
  planner_id?: string;
  week_id?: string;

  created_date: string;
  updated_date: string;
  completed_date?: string;
};

export type PlannerApprovalType = "EDIT" | "SUBMIT";

export type PlannerApprovalRequest = {
  request_id: string;
  planner_id: string;
  requested_by: string;
  created_date: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  type: PlannerApprovalType;
  reason?: string;
  decided_by?: string;
  decided_date?: string;
};

export type Agenda = {
  agenda_id: string;
  planner_id: string;
  week_id: string;
  created_by: string;
  created_date: string;
  updated_date: string;
  state: "DRAFT" | "SUBMITTED" | "ARCHIVED";
  
  // Front page specific details
  ward_branch: string;
  stake_district: string;
  date: string;
  type_of_meeting: "Sacrament Meeting" | "Fast & Testimony" | "Stake/District Meeting" | "Ward/Branch Conference" | "Other";
  other_meeting_specify?: string;
  presiding: string;
  presiding_position?: string;
  conducting: string;
  conducting_position?: string;
  music_director: string;
  choir_director: string;
  organist: string;
  start_time: string;
  prelude_music: string;
  greetings_welcome: string;
  acknowledgements: string;
  ward_branch_business: string;
  stake_district_business: string;
  naming_blessing: string;
  confirmation_bestowal: string;
  opening_hymn: string;
  opening_hymn_number: string;
  opening_prayer: string;
  sacrament_hymn: string;
  sacrament_hymn_number: string;
  special_music: string;
  speakers: { name: string; topic: string; reference?: string }[];
  closing_hymn: string;
  closing_hymn_number: string;
  closing_prayer: string;
  postlude_music: string;

  // Back page items
  announcements: string[]; // 6 items
  releases: { name: string; calling: string }[];
  calls: { name: string; calling: string }[];
  baptized_children: string[];
  aaronic_ordinations: { name: string; office: string; ordained_by: string; ordained_by_office: string }[];
  aaronic_advancements: { name: string; office_from: string; office_to: string; ordained_by: string; ordained_by_office: string }[];
  achievements: string[];
  babies: { family: string; baby_name: string; blessed_by: string; blessed_by_office: string }[];
  confirmations: { name: string; confirmed_by: string; confirmed_by_office: string }[];
  fellowships: string[];
};

export type CalendarActivity = {
  activity_id: string;
  date: string; // YYYY-MM-DD
  activity: string;
  organisation: string;
  status: boolean; // completed
  email_sent: boolean;
  those_involved: string;
  report_submitted: "YES" | "NO" | "N/A";
  time: string;
  last_reminder?: string;
};

export type OtherChurchProgram = {
  program_id: string;
  date: string; // YYYY-MM-DD
  program: string;
  organisation: string;
};

export type PublicHoliday = {
  holiday_id: string;
  date: string; // YYYY-MM-DD
  holiday: string;
  theme?: string;
};

export type CalendarContact = {
  contact_id: string;
  name: string;
  calling: string;
  organisation: string;
  upcoming: string;
  report: string;
  email: string;
};

export type CalendarReportLog = {
  log_id: string;
  date: string;
  type: string; // "Follow-Up Notice", "Report Request", etc.
  recipient: string;
  status: "SUCCESS" | "FAILED";
  timestamp: string;
};

