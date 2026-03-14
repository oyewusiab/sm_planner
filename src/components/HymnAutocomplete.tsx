import { useEffect, useMemo, useRef, useState } from "react";
import type { Hymn } from "../types";
import { cn } from "../utils/cn";
import { Badge, Input } from "./ui";

export function HymnAutocomplete({
  hymns,
  value,
  onChange,
  disabled,
  placeholder,
  onPick,
  className,
}: {
  hymns: Hymn[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  onPick?: (hymn: Hymn) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const options = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = [...hymns].sort((a, b) => a.number - b.number);
    if (!q) return list.slice(0, 10);
    
    return list.filter((h) => 
      h.title.toLowerCase().includes(q) || 
      h.number.toString().includes(q) ||
      (h.theme || "").toLowerCase().includes(q)
    ).slice(0, 15);
  }, [hymns, value]);

  function pick(h: Hymn) {
    const label = `${h.number} - ${h.title}`;
    onChange(label);
    onPick?.(h);
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
        placeholder={placeholder || "Search hymn number or title…"}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
      />

      {open && !disabled ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-[color:var(--border)] bg-white shadow-xl max-h-72 overflow-y-auto">
          {options.length === 0 ? (
            <div className="p-3 text-xs text-slate-500 italic">No matching hymns found.</div>
          ) : (
            <ul className="py-1">
              {options.map((h) => (
                <li key={h.number}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-50 transition-colors"
                    onClick={() => pick(h)}
                  >
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-900">
                        {h.number}. {h.title}
                      </span>
                      <span className="text-[10px] text-slate-500 italic">
                        {h.theme}
                      </span>
                    </div>
                    <Badge tone={h.type === "New" ? "green" : (h.type === "Sacrament" ? "blue" : "gray")}>
                      {h.type || "Classic"}
                    </Badge>
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
