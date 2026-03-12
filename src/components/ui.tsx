import React from "react";
import { cn } from "../utils/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[color:var(--border)] bg-white shadow-sm",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-[color:var(--border)] p-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-base font-semibold text-[color:var(--text)]", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50";
  const styles: Record<string, string> = {
    primary: "bg-[color:var(--primary)] text-white hover:bg-[color:var(--accent)]",
    secondary:
      "bg-white text-[color:var(--text)] border border-[color:var(--border)] hover:bg-slate-50",
    ghost: "bg-transparent text-[color:var(--text)] hover:bg-slate-100",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
  };
  return <button className={cn(base, styles[variant], className)} {...props} />;
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-[color:var(--border)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[color:var(--accent)]",
        className
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "w-full rounded-lg border border-[color:var(--border)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[color:var(--accent)]",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-[color:var(--border)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[color:var(--accent)]",
        className
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-xs font-medium text-slate-600", className)} {...props} />;
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-[color:var(--border)]", className)} />;
}

export function Badge({
  tone = "gray",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "gray" | "blue" | "green" | "amber" | "rose";
}) {
  const tones: Record<string, string> = {
    gray: "bg-slate-100 text-slate-700",
    blue: "bg-sky-100 text-sky-800",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-900",
    rose: "bg-rose-100 text-rose-800",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}

export function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-1">
      <div className="text-lg font-semibold text-[color:var(--text)]">{title}</div>
      {subtitle ? <div className="text-sm text-slate-500">{subtitle}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[color:var(--border)] bg-white p-8 text-center">
      <div className="mx-auto max-w-lg space-y-2">
        <div className="text-base font-semibold text-slate-900">{title}</div>
        {body ? <div className="text-sm text-slate-500">{body}</div> : null}
        {action ? <div className="pt-3">{action}</div> : null}
      </div>
    </div>
  );
}
