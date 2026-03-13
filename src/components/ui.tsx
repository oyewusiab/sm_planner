import React from "react";
import { cn } from "../utils/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "stat-card",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border-b border-[color:var(--border)] px-5 py-4",
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "text-sm font-semibold tracking-wide text-slate-700 uppercase",
        className
      )}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-[10px] px-4 py-2 text-sm font-semibold transition-all duration-200 disabled:opacity-50 active:scale-[0.97]";
  const styles: Record<string, string> = {
    primary:
      "bg-gradient-to-r from-[color:var(--primary)] to-[color:var(--primary-light)] text-white shadow-sm hover:shadow-md hover:brightness-110",
    secondary:
      "bg-white text-slate-700 border border-[color:var(--border)] hover:bg-slate-50 shadow-sm",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100",
    danger: "bg-gradient-to-r from-rose-600 to-rose-500 text-white shadow-sm hover:brightness-110",
    outline: "bg-transparent text-slate-700 border border-[color:var(--border)] hover:bg-slate-50",
  };
  return <button className={cn(base, styles[variant], className)} {...props} />;
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-[10px] border border-[color:var(--border)] bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-[color:var(--primary)] focus:border-[color:var(--primary)]",
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
        "w-full rounded-[10px] border border-[color:var(--border)] bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-[color:var(--primary)] focus:border-[color:var(--primary)]",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-[10px] border border-[color:var(--border)] bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-[color:var(--primary)] focus:border-[color:var(--primary)]",
        className
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-xs font-semibold text-slate-500 uppercase tracking-wide", className)}
      {...props}
    />
  );
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
    gray: "bg-slate-100 text-slate-600",
    blue: "bg-sky-100 text-sky-700",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}

export function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-2xl font-bold tracking-tight text-[color:var(--text)]">{title}</div>
      {subtitle ? (
        <div className="text-sm text-slate-500 font-medium">{subtitle}</div>
      ) : null}
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
    <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-white/70 backdrop-blur-sm p-10 text-center">
      <div className="mx-auto max-w-lg space-y-3">
        <div className="text-3xl">📋</div>
        <div className="text-base font-semibold text-slate-800">{title}</div>
        {body ? <div className="text-sm text-slate-500 leading-relaxed">{body}</div> : null}
        {action ? <div className="pt-4">{action}</div> : null}
      </div>
    </div>
  );
}
