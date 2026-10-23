import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api/client";
import {
  CATEGORIES,
  PRIORITIES,
  STATUSES,
  type AdminTicketDetail,
  type Book,
  type Draft,
  type TicketStatus,
  type User,
} from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { date, dateTime, inr, timeAgo, timeUntil } from "../../components/format";
import { AttachmentList, Thread } from "../../components/Thread";
import { ErrorBanner, PriorityBadge, SourceTag, Spinner, StatusBadge } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { useTicketEvents } from "../../hooks/useTicketEvents";

export function AdminTicketPage() {
  const id = Number(useParams().ticketId);
  const { user } = useAuth();
  const detail = useAsync(() => api<{ data: AdminTicketDetail }>(`/tickets/${id}`).then((r) => r.data), [id]);
  const admins = useAsync(() => api<{ data: Pick<User, "id" | "name">[] }>("/admin/users").then((r) => r.data), []);
  useTicketEvents(() => void detail.reload(), id);
  const [error, setError] = useState<Error | null>(null);

  if (detail.loading) return <Spinner />;
  if (detail.error || !detail.data) return <ErrorBanner error={detail.error} />;
  const { ticket, messages, attachments, notes, events, book } = detail.data;

  async function patch(body: Record<string, unknown>) {
    setError(null);
    try {
      const r = await api<{ data: AdminTicketDetail }>(`/tickets/${id}`, { method: "PATCH", json: body });
      detail.setData(r.data);
    } catch (e) {
      setError(e as Error);
    }
  }

  async function reclassify() {
    setError(null);
    try {
      const r = await api<{ data: AdminTicketDetail }>(`/tickets/${id}/classification`, { method: "POST" });
      detail.setData(r.data);
    } catch (e) {
      setError(e as Error);
    }
  }

  return (
    <div className="page wide">
      <Link to="/admin/tickets" className="back">← Back to queue</Link>
      <div className="ticket-layout">
        <section className="ticket-main">
          <div className="card">
            <div className="detail-head">
              <div>
                <h1 className="h2">{ticket.subject}</h1>
                <div className="muted small">
                  #{ticket.id} · {ticket.authorName} · {ticket.bookTitle ?? "General / Account"} · opened {dateTime(ticket.createdAt)} ({timeAgo(ticket.createdAt)})
                </div>
              </div>
              <div className="head-badges">
                <PriorityBadge priority={ticket.priority} />
                <StatusBadge status={ticket.status} />
              </div>
            </div>
            <AttachmentList ticketId={ticket.id} attachments={attachments} />
            <Thread messages={messages} viewer="admin" />
          </div>

          {ticket.status !== "Closed" ? (
            <ReplyComposer
              ticketId={id}
              messageCount={messages.length}
              category={ticket.category}
              awaitingReply={ticket.awaitingReply}
              onSent={(d) => detail.setData(d)}
            />
          ) : (
            <div className="card muted">This ticket is closed. Reopen it from the sidebar to reply.</div>
          )}
        </section>

        <aside className="ticket-side">
          <ErrorBanner error={error} />
          <div className="card side-card">
            <h3>Ticket</h3>
            <label className="field">
              <span>Status</span>
              <select value={ticket.status} onChange={(e) => patch({ status: e.target.value })}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Category <SourceTag source={ticket.categorySource} /></span>
              <select value={ticket.category ?? ""} onChange={(e) => patch({ category: e.target.value })}>
                {!ticket.category && <option value="">Classifying…</option>}
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Priority <SourceTag source={ticket.prioritySource} /></span>
              <select value={ticket.priority ?? ""} onChange={(e) => patch({ priority: e.target.value })}>
                {!ticket.priority && <option value="">Classifying…</option>}
                {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
            {ticket.aiReasoning && (
              <p className="ai-reasoning">
                <strong>{ticket.classificationStatus === "fallback" ? "Rules:" : "AI:"}</strong> {ticket.aiReasoning}{" "}
                <button className="link" onClick={reclassify}>Re-run</button>
              </p>
            )}
            <label className="field">
              <span>Assignee</span>
              <div className="row">
                <select value={ticket.assignedAdmin?.id ?? ""} onChange={(e) => patch({ assignedAdminId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Unassigned</option>
                  {admins.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {ticket.assignedAdmin?.id !== user?.id && (
                  <button className="btn btn-secondary btn-sm" onClick={() => patch({ assignedAdminId: user!.id })}>Assign to me</button>
                )}
              </div>
            </label>
            <div className="muted small">
              {ticket.firstResponseAt
                ? `First response ${timeAgo(ticket.firstResponseAt)}`
                : ticket.status === "Open" || ticket.status === "In Progress"
                  ? <span className={ticket.isOverdue ? "text-danger" : ""}>First response {timeUntil(ticket.responseDueAt)}</span>
                  : null}
            </div>
          </div>

          {book && <BookCard book={book} />}
          <NotesCard ticketId={id} notes={notes} onAdded={() => void detail.reload()} />

          <div className="card side-card">
            <h3>Timeline</h3>
            <ul className="timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <span>{EVENT_LABEL[e.type] ?? e.type}</span>{e.detail && <span className="muted">: {e.detail}</span>}
                  <div className="muted small">{e.actorName ?? "System"} · {timeAgo(e.createdAt)}</div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  created: "Ticket created",
  ai_classified: "AI classified",
  rules_classified: "Rules classified (AI unavailable)",
  category_overridden: "Category changed",
  priority_overridden: "Priority changed",
  status_changed: "Status",
  assigned: "Assigned",
  replied: "Replied",
  reopened: "Reopened",
};

function BookCard({ book: b }: { book: Book }) {
  return (
    <div className="card side-card">
      <h3>{b.title}</h3>
      <div className="muted small">{b.id} · ISBN {b.isbn ?? "—"}</div>
      <dl className="facts compact">
        <div><dt>Status</dt><dd>{b.status}</dd></div>
        {b.isPublished && (
          <>
            <div><dt>Published</dt><dd>{date(b.publication_date)}</dd></div>
            <div><dt>Sold</dt><dd>{b.total_copies_sold}</dd></div>
            <div><dt>Earned</dt><dd>{inr(b.total_royalty_earned)}</dd></div>
            <div><dt>Paid</dt><dd>{inr(b.royalty_paid)}</dd></div>
            <div><dt>Pending</dt><dd>{inr(b.royalty_pending)}</dd></div>
            <div><dt>Last payout</dt><dd>{b.last_royalty_payout_date ? date(b.last_royalty_payout_date) : "Never"}</dd></div>
            <div><dt>Printer</dt><dd>{b.print_partner ?? "—"}</dd></div>
          </>
        )}
      </dl>
      {b.platforms.length > 0 && <div className="platforms">{b.platforms.map((p) => <span key={p} className="chip">{p}</span>)}</div>}
    </div>
  );
}

function NotesCard({ ticketId, notes, onAdded }: { ticketId: number; notes: AdminTicketDetail["notes"]; onAdded: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/tickets/${ticketId}/notes`, { method: "POST", json: { body } });
      setBody("");
      onAdded();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card side-card notes">
      <h3>Internal notes <span className="muted small">(never shown to the author)</span></h3>
      {notes.map((n) => (
        <div key={n.id} className="note">
          <div>{n.body}</div>
          <div className="muted small">{n.authorName} · {timeAgo(n.createdAt)}</div>
        </div>
      ))}
      <form onSubmit={add}>
        <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note for the team…" />
        <button className="btn btn-secondary btn-sm" disabled={busy || !body.trim()}>Add note</button>
      </form>
    </div>
  );
}

/**
 * Reply box pre-filled with the AI draft. The admin can edit freely; "AI-assisted" is
 * recorded when the sent reply started from a draft, which lets us measure draft usefulness.
 */
function ReplyComposer({ ticketId, messageCount, category, awaitingReply, onSent }: {
  ticketId: number;
  messageCount: number;
  category: string | null;
  awaitingReply: boolean;
  onSent: (d: AdminTicketDetail) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [body, setBody] = useState("");
  const [fromDraft, setFromDraft] = useState(false);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function loadDraft(regenerate = false) {
    setDrafting(true);
    setDraftError(null);
    try {
      const r = await api<{ data: Draft }>(`/tickets/${ticketId}/draft`, { method: regenerate ? "POST" : "GET" });
      setDraft(r.data);
      // Never clobber what the admin is typing; only prefill an untouched composer.
      if (!edited || regenerate) {
        setBody(r.data.body);
        setFromDraft(true);
        setEdited(false);
      }
    } catch (e) {
      setDraftError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  }

  // Auto-draft only when the author is waiting on us (and again when they follow up or the
  // category changes). After we've replied, drafting is on demand: no wasted AI calls.
  useEffect(() => {
    if (awaitingReply) void loadDraft();
    else setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, messageCount, category, awaitingReply]);

  async function send(status?: TicketStatus) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ data: AdminTicketDetail }>(`/tickets/${ticketId}/messages`, {
        method: "POST",
        json: { body, status, aiAssisted: fromDraft },
      });
      setBody("");
      setFromDraft(false);
      setEdited(false);
      onSent(r.data);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }

  const m = draft?.meta;
  return (
    <div className="card composer-card">
      <div className="composer-head">
        <h3>Reply to author</h3>
        <div className="row">
          {draft && (
            <span className={`source-tag ${draft.source === "ai" ? "source-ai" : "source-fallback"}`}
              title={m?.fallbackReason ?? `Generated ${timeAgo(draft.generatedAt)}${draft.cached ? " (cached)" : ""}`}>
              {draft.source === "ai" ? "AI draft" : "Template draft"}
            </span>
          )}
          <button className="btn btn-ghost btn-sm" disabled={drafting} onClick={() => loadDraft(Boolean(draft))}>
            {drafting ? "Drafting…" : draft ? "↻ Regenerate" : "✨ Draft with AI"}
          </button>
        </div>
      </div>

      {draftError && <div className="alert alert-warn">Couldn't load a draft ({draftError}). You can write the reply manually.</div>}
      {m?.fallbackReason && <div className="alert alert-warn">{m.fallbackReason}. Review carefully before sending.</div>}

      {m && draft?.source === "ai" && (m.escalation.required || m.authorActions.length > 0 || m.adminChecklist.length > 0) && (
        <div className="draft-insights">
          {m.escalation.required && <div><strong>Escalate to {m.escalation.team}:</strong> {m.escalation.reason}</div>}
          {m.adminChecklist.length > 0 && (
            <div><strong>Before sending:</strong><ul>{m.adminChecklist.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
          )}
          {m.authorActions.length > 0 && <div><strong>Asks the author to:</strong> {m.authorActions.join("; ")}</div>}
        </div>
      )}

      <div className="composer-body">
        {drafting && !body && <div className="draft-skeleton"><Spinner label="Drafting a reply from the knowledge base…" /></div>}
        <textarea rows={12} value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }}
          placeholder={drafting ? "" : "Write your reply…"} />
      </div>
      <ErrorBanner error={error} />
      <div className="form-actions">
        {fromDraft && edited && <span className="muted small">Edited from draft</span>}
        <button className="btn btn-secondary" disabled={busy || !body.trim()} onClick={() => send("In Progress")}>Send · keep In Progress</button>
        <button className="btn btn-primary" disabled={busy || !body.trim()} onClick={() => send("Resolved")}>
          Send & resolve{m?.suggestedStatus === "Resolved" ? " (suggested)" : ""}
        </button>
      </div>
    </div>
  );
}
