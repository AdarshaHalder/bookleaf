import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/client";
import { STATUSES, type AuthorTicket, type AuthorTicketDetail, type Paged, type TicketStatus } from "../../api/types";
import { date, timeAgo } from "../../components/format";
import { AttachmentList, Thread } from "../../components/Thread";
import { EmptyState, ErrorBanner, Spinner, StatusBadge } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { useTicketEvents } from "../../hooks/useTicketEvents";

export function MyTicketsPage() {
  const { ticketId } = useParams();
  const selectedId = ticketId ? Number(ticketId) : null;
  const [filter, setFilter] = useState<TicketStatus | "all">("all");

  const list = useAsync(
    () => api<Paged<AuthorTicket>>(`/tickets?pageSize=100${filter === "all" ? "" : `&status=${encodeURIComponent(filter)}`}`),
    [filter],
  );
  useTicketEvents(() => void list.reload());

  return (
    <div className="page">
      <div className="page-head">
        <h1>My Tickets</h1>
        <Link to="/tickets/new" className="btn btn-primary">New query</Link>
      </div>
      <div className="split">
        <aside className="split-list card">
          <div className="tabs">
            {(["all", ...STATUSES] as const).map((s) => (
              <button key={s} className={`tab ${filter === s ? "active" : ""}`} onClick={() => setFilter(s)}>
                {s === "all" ? "All" : s}
              </button>
            ))}
          </div>
          {list.loading ? <Spinner /> : list.error ? <ErrorBanner error={list.error} /> : list.data!.data.length === 0 ? (
            <EmptyState title={filter === "all" ? "No queries yet" : `No ${filter.toLowerCase()} tickets`}>
              {filter === "all" && <>Have a question about royalties, your ISBN or printing? <Link to="/tickets/new">Raise a query</Link>.</>}
            </EmptyState>
          ) : (
            <ul className="ticket-list">
              {list.data!.data.map((t) => (
                <li key={t.id}>
                  <Link to={`/tickets/${t.id}`} className={`ticket-item ${t.id === selectedId ? "selected" : ""}`}>
                    <div className="ticket-item-top">
                      <span className="ticket-subject">{t.subject}</span>
                      <StatusBadge status={t.status} />
                    </div>
                    <div className="muted small">
                      #{t.id} · {t.bookTitle ?? "General / Account"} · updated {timeAgo(t.updatedAt)}
                      {t.hasNewReply && (t.status === "Open" || t.status === "In Progress") && <span className="new-reply">New reply</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="split-detail">
          {selectedId ? <AuthorTicketView key={selectedId} id={selectedId} onChange={() => void list.reload()} /> : (
            <div className="card"><EmptyState title="Select a ticket">Pick a ticket to see the full conversation.</EmptyState></div>
          )}
        </section>
      </div>
    </div>
  );
}

function AuthorTicketView({ id, onChange }: { id: number; onChange: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const detail = useAsync(() => api<{ data: AuthorTicketDetail }>(`/tickets/${id}`).then((r) => r.data), [id]);
  useTicketEvents(() => void detail.reload(), id);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const justCreated = (location.state as { justCreated?: boolean } | null)?.justCreated;

  if (detail.loading) return <div className="card"><Spinner /></div>;
  if (detail.error?.message.includes("not found")) {
    return <div className="card"><EmptyState title="Ticket not found"><button className="link" onClick={() => navigate("/tickets")}>Back to my tickets</button></EmptyState></div>;
  }
  if (detail.error || !detail.data) return <ErrorBanner error={detail.error} />;
  const { ticket, messages, attachments } = detail.data;

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ data: AuthorTicketDetail }>(`/tickets/${id}/messages`, { method: "POST", json: { body: reply } });
      detail.setData(r.data);
      setReply("");
      onChange();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  const awaitingTeam = messages.at(-1)?.senderRole === "author" && (ticket.status === "Open" || ticket.status === "In Progress");

  return (
    <div className="card ticket-detail">
      {justCreated && <div className="alert alert-success">Thanks! Your query has been received. You'll see our reply here as soon as it's sent; no need to refresh.</div>}
      <div className="detail-head">
        <div>
          <h2>{ticket.subject}</h2>
          <div className="muted small">#{ticket.id} · {ticket.bookTitle ?? "General / Account level"} · opened {date(ticket.createdAt)}</div>
        </div>
        <StatusBadge status={ticket.status} />
      </div>
      <AttachmentList ticketId={ticket.id} attachments={attachments} />
      <Thread messages={messages} viewer="author" />
      {awaitingTeam && <p className="hint">⏳ Our team has your message and will reply here. You'll see it instantly.</p>}

      {ticket.status === "Closed" ? (
        <p className="muted">This ticket is closed. If you need more help, please <Link to="/tickets/new">raise a new query</Link>.</p>
      ) : (
        <form className="composer" onSubmit={send}>
          <ErrorBanner error={error} />
          <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)}
            placeholder={ticket.status === "Resolved" ? "Still need help? Replying will reopen this ticket." : "Add more details or reply to our team…"} />
          <div className="form-actions"><button className="btn btn-primary" disabled={busy || !reply.trim()}>{busy ? "Sending…" : "Send"}</button></div>
        </form>
      )}
    </div>
  );
}
