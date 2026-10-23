import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { CATEGORIES, PRIORITIES, STATUSES, type AdminStats, type AdminTicket, type Paged } from "../../api/types";
import { timeAgo, timeUntil } from "../../components/format";
import { EmptyState, ErrorBanner, PriorityBadge, SourceTag, Spinner, StatusBadge } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { useTicketEvents } from "../../hooks/useTicketEvents";

interface Filters {
  status: string;
  category: string;
  priority: string;
  assignee: string;
  from: string;
  to: string;
  q: string;
  sort: string;
}

const DEFAULTS: Filters = { status: "Open,In Progress", category: "", priority: "", assignee: "", from: "", to: "", q: "", sort: "urgency" };

export function QueuePage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [page, setPage] = useState(1);
  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: "25" });
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    return p.toString();
  }, [filters, page]);

  const list = useAsync(() => api<Paged<AdminTicket>>(`/tickets?${query}`), [query]);
  const stats = useAsync(() => api<{ data: AdminStats }>("/admin/stats").then((r) => r.data), []);
  useTicketEvents(() => {
    void list.reload();
    void stats.reload();
  });

  const set = (k: keyof Filters) => (v: string) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: v }));
  };

  const s = stats.data;
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="page wide">
      <div className="page-head">
        <h1>Ticket queue</h1>
        {s && (
          <div className={`ai-pill ${s.ai.status.configured && !s.ai.status.circuitOpen ? "ok" : "warn"}`}
            title={s.ai.status.configured ? `Model: ${s.ai.status.model}` : "Set OPENAI_API_KEY to enable AI"}>
            {!s.ai.status.configured ? "AI off · rules & templates in use" : s.ai.status.circuitOpen ? "AI degraded · fallbacks in use" : "AI assist on"}
          </div>
        )}
      </div>

      {s && (
        <div className="stats">
          <button className="stat stat-btn" onClick={() => setFilters({ ...DEFAULTS, status: "Open" })}>
            <div className="stat-label">Open</div><div className="stat-value">{s.byStatus.Open ?? 0}</div>
          </button>
          <button className="stat stat-btn" onClick={() => setFilters({ ...DEFAULTS, status: "In Progress" })}>
            <div className="stat-label">In progress</div><div className="stat-value">{s.byStatus["In Progress"] ?? 0}</div>
          </button>
          <button className={`stat stat-btn ${s.overdue ? "stat-danger" : ""}`} onClick={() => setFilters(DEFAULTS)}>
            <div className="stat-label">Past response SLA</div><div className="stat-value">{s.overdue}</div>
          </button>
          <button className={`stat stat-btn ${s.openByPriority.Critical ? "stat-danger" : ""}`} onClick={() => setFilters({ ...DEFAULTS, priority: "Critical" })}>
            <div className="stat-label">Critical open</div><div className="stat-value">{s.openByPriority.Critical ?? 0}</div>
          </button>
          <button className="stat stat-btn" onClick={() => setFilters({ ...DEFAULTS, status: "Resolved,Closed", sort: "updated" })}>
            <div className="stat-label">Resolved / closed</div><div className="stat-value">{(s.byStatus.Resolved ?? 0) + (s.byStatus.Closed ?? 0)}</div>
          </button>
        </div>
      )}

      <div className="card filters">
        <input className="search" placeholder="Search subject, author or #id" value={filters.q} onChange={(e) => set("q")(e.target.value)} />
        <Select label="Status" value={filters.status} onChange={set("status")}
          options={[["Open,In Progress", "Active"], ["Resolved,Closed", "Done"], ["", "All statuses"], ...STATUSES.map((x) => [x, x] as [string, string])]} />
        <Select label="Category" value={filters.category} onChange={set("category")}
          options={[["", "All categories"], ...CATEGORIES.map((x) => [x, x] as [string, string])]} />
        <Select label="Priority" value={filters.priority} onChange={set("priority")}
          options={[["", "All priorities"], ...PRIORITIES.map((x) => [x, x] as [string, string])]} />
        <Select label="Assignee" value={filters.assignee} onChange={set("assignee")}
          options={[["", "Anyone"], ["me", "Assigned to me"], ["unassigned", "Unassigned"]]} />
        <label className="filter-date">From <input type="date" value={filters.from} onChange={(e) => set("from")(e.target.value)} /></label>
        <label className="filter-date">To <input type="date" value={filters.to} onChange={(e) => set("to")(e.target.value)} /></label>
        <Select label="Sort" value={filters.sort} onChange={set("sort")}
          options={[["urgency", "Most urgent first"], ["oldest", "Oldest first"], ["newest", "Newest first"], ["updated", "Recently updated"]]} />
        {JSON.stringify(filters) !== JSON.stringify(DEFAULTS) && <button className="btn btn-ghost btn-sm" onClick={() => setFilters(DEFAULTS)}>Reset</button>}
      </div>

      <div className="card table-card">
        {list.loading ? <Spinner /> : list.error ? <ErrorBanner error={list.error} /> : list.data!.data.length === 0 ? (
          <EmptyState title="Nothing here 🎉">No tickets match these filters.</EmptyState>
        ) : (
          <table className="queue">
            <thead>
              <tr><th>Priority</th><th>Ticket</th><th>Author / book</th><th>Category</th><th>Status</th><th>Response SLA</th><th>Assignee</th></tr>
            </thead>
            <tbody>
              {list.data!.data.map((t) => (
                <tr key={t.id} onClick={() => navigate(`/admin/tickets/${t.id}`)} className={t.isOverdue ? "row-overdue" : ""}>
                  <td><PriorityBadge priority={t.priority} /> <SourceTag source={t.prioritySource} /></td>
                  <td>
                    <div className="ticket-subject">{t.awaitingReply && <span className="dot" title="Waiting on BookLeaf" />}{t.subject}</div>
                    <div className="muted small">#{t.id} · opened {timeAgo(t.createdAt)} · {t.messageCount} msg</div>
                  </td>
                  <td>{t.authorName}<div className="muted small">{t.bookTitle ?? "General / Account"}</div></td>
                  <td>{t.category ?? <span className="muted">Classifying…</span>} <SourceTag source={t.categorySource} /></td>
                  <td><StatusBadge status={t.status} /></td>
                  <td className={t.isOverdue ? "text-danger" : "muted"}>
                    {t.firstResponseAt ? "Responded" : t.status === "Open" || t.status === "In Progress" ? timeUntil(t.responseDueAt) : "—"}
                  </td>
                  <td>{t.assignedAdmin?.name.split(" ")[0] ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pages > 1 && (
          <div className="pager">
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
            <span className="muted">Page {page} of {pages}</span>
            <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
