import { useEffect, useMemo, useRef, useState } from "react";
import type { Member } from "../types";
import { cn } from "../utils/cn";
import { Input } from "./ui";

export function normalizeGender(g?: string): "M" | "F" | undefined {
  const s = String(g || "").trim().toLowerCase();
  if (!s) return undefined;
  if (s === "m" || s === "male" || s.startsWith("bro")) return "M";
  if (s === "f" || s === "female" || s.startsWith("sis")) return "F";
  return undefined;
}

export function MemberAutocomplete({
  members,
  value,
  onChange,
  disabled,
  placeholder,
  onPick,
  className,
}: {
  members: Member[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  onPick?: (member: Member) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const options = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = [...members].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const filtered = q
      ? list.filter((m) => (m.name || "").toLowerCase().includes(q))
      : list;
    return filtered.slice(0, 10);
  }, [members, value]);

  function pick(m: Member) {
    onChange(m.name);
    onPick?.(m);
    setOpen(false);
  }

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Input
        disabled={disabled}
        value={value}
        placeholder={placeholder || "Start typing a member name…"}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
      />

      {open && !disabled ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-[color:var(--border)] bg-white shadow-lg">
          {options.length === 0 ? (
            <div className="p-2 text-xs text-slate-500">No matches in Members directory.</div>
          ) : (
            <ul className="max-h-56 overflow-auto py-1">
              {options.map((m) => (
                <li key={m.member_id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => pick(m)}
                  >
                    <span className="font-medium text-slate-900">{m.name}</span>
                    <span className="text-xs text-slate-500">
                      {normalizeGender(m.gender) ? (normalizeGender(m.gender) === "M" ? "Brother" : "Sister") : ""}
                      {m.phone ? (normalizeGender(m.gender) ? ` • ${m.phone}` : m.phone) : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
