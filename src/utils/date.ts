import { APP_LOCALE, APP_TIME_ZONE } from "./locale";

export function monthName(m: number) {
  return new Date(2000, m - 1, 1).toLocaleString(APP_LOCALE, { month: "long", timeZone: APP_TIME_ZONE });
}

export function toISODateLocal(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatDateShort(isoDate: string) {
  if (!isoDate) return "None";
  // Detect Google Sheets zero-date (1899-12-30)
  if (isoDate.startsWith("1899-12-30")) return "Not set";
  
  // Always format as dd-MMM-yyyy regardless of browser locale input.
  const parts = isoDate.split("-");
  if (parts.length < 3) return isoDate;
  
  const [yyyy, mm, ddFull] = parts;
  // Handle ISO strings with time-parts
  const dd = ddFull.split("T")[0];
  
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mIdx = Math.max(1, Math.min(12, Number(mm || 1))) - 1;
  return `${dd}-${months[mIdx]}-${yyyy}`;
}

export function yyyyMmToLabel(month: number, year: number) {
  return `${monthName(month)} ${year}`;
}

export function getTodayPartsInTimeZone(d: Date = new Date(), timeZone: string = APP_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const year = Number(parts.find((p) => p.type === "year")?.value || "1970");
  const month = Number(parts.find((p) => p.type === "month")?.value || "1");
  const day = Number(parts.find((p) => p.type === "day")?.value || "1");
  return { year, month, day };
}

export function nextSundaysInMonth(month: number, year: number) {
  const sundays: string[] = [];
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);

  // find first Sunday
  const d = new Date(first);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  while (d <= last) {
    sundays.push(toISODateLocal(d));
    d.setDate(d.getDate() + 7);
  }
  return sundays;
}
