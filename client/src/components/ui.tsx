import type { ReactNode } from "react";
import type { Priority, Source, TicketStatus } from "../api/types";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "-");

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge status-${slug(status)}`}>{status}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority | null }) {
  if (!priority) return <span className="badge muted">Classifying…</span>;
  return <span className={`badge priority-${slug(priority)}`}>{priority}</span>;
}

const SOURCE_LABEL: Record<NonNullable<Source>, string> = { ai: "AI", fallback: "Rules", admin: "Manual" };
const SOURCE_TITLE: Record<NonNullable<Source>, string> = {
  ai: "Set by the AI classifier",
  fallback: "Set by keyword rules because the AI was unavailable. Please double-check.",
  admin: "Overridden by an admin",
};

export function SourceTag({ source }: { source: Source }) {
  if (!source) return null;
  return (
    <span className={`source-tag source-${source}`} title={SOURCE_TITLE[source]}>
      {SOURCE_LABEL[source]}
    </span>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" /> {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function ErrorBanner({ error }: { error: Error | null | string }) {
  if (!error) return null;
  return <div className="alert alert-error">{typeof error === "string" ? error : error.message}</div>;
}
