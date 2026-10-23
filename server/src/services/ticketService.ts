import { getDb } from "../db/connection";
import {
  RESPONSE_SLA_HOURS,
  type AuthUser,
  type Category,
  type Priority,
  type TicketStatus,
} from "../lib/domain";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { publish } from "../realtime/hub";
import { findBook } from "./bookService";

/**
 * Ticket lifecycle. All reads go through `getTicketRow` / `assertCanAccess` so the
 * "authors only see their own tickets" rule lives in one place. Authors get a reduced
 * projection: no priority, no AI reasoning, no assignment, never internal notes.
 */

export interface TicketRow {
  id: number;
  author_id: string;
  book_id: string | null;
  subject: string;
  description: string;
  status: TicketStatus;
  category: Category | null;
  category_source: "ai" | "fallback" | "admin" | null;
  priority: Priority | null;
  priority_source: "ai" | "fallback" | "admin" | null;
  ai_reasoning: string | null;
  classification_status: "pending" | "done" | "fallback";
  assigned_admin_id: number | null;
  ai_draft: string | null;
  ai_draft_meta: string | null;
  ai_draft_source: "ai" | "template" | null;
  ai_draft_message_count: number | null;
  ai_draft_generated_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ListRow extends TicketRow {
  author_name: string;
  book_title: string | null;
  assigned_admin_name: string | null;
  message_count: number;
  last_message_at: string | null;
  last_message_role: "author" | "admin" | null;
}

const now = () => new Date().toISOString();

const LIST_SELECT = `
  SELECT t.*, a.name AS author_name, b.title AS book_title, u.name AS assigned_admin_name,
    (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count,
    (SELECT MAX(created_at) FROM ticket_messages m WHERE m.ticket_id = t.id) AS last_message_at,
    (SELECT sender_role FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_message_role
  FROM tickets t
  JOIN authors a ON a.id = t.author_id
  LEFT JOIN books b ON b.id = t.book_id
  LEFT JOIN users u ON u.id = t.assigned_admin_id`;

const isOpen = (s: TicketStatus) => s === "Open" || s === "In Progress";

/** SLA: time to first admin response, by priority. Unclassified tickets use the Medium SLA. */
function sla(row: TicketRow) {
  const hours = RESPONSE_SLA_HOURS[row.priority ?? "Medium"];
  const dueAt = new Date(new Date(row.created_at).getTime() + hours * 3_600_000).toISOString();
  const isOverdue = isOpen(row.status) && !row.first_response_at && Date.now() > Date.parse(dueAt);
  return { responseDueAt: dueAt, isOverdue };
}

function toAdminDto(row: ListRow) {
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_name,
    bookId: row.book_id,
    bookTitle: row.book_title,
    subject: row.subject,
    description: row.description,
    status: row.status,
    category: row.category,
    categorySource: row.category_source,
    priority: row.priority,
    prioritySource: row.priority_source,
    aiReasoning: row.ai_reasoning,
    classificationStatus: row.classification_status,
    assignedAdmin: row.assigned_admin_id ? { id: row.assigned_admin_id, name: row.assigned_admin_name } : null,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
    awaitingReply: isOpen(row.status) && row.last_message_role === "author",
    firstResponseAt: row.first_response_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...sla(row),
  };
}

function toAuthorDto(row: ListRow) {
  return {
    id: row.id,
    bookId: row.book_id,
    bookTitle: row.book_title,
    subject: row.subject,
    description: row.description,
    status: row.status,
    category: row.category,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
    hasNewReply: row.last_message_role === "admin",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type AdminTicket = ReturnType<typeof toAdminDto>;
export type AuthorTicket = ReturnType<typeof toAuthorDto>;

export function project(user: AuthUser, row: ListRow): AdminTicket | AuthorTicket {
  return user.role === "admin" ? toAdminDto(row) : toAuthorDto(row);
}

// ---------------------------------------------------------------------------------------
// Reads

export function getTicketRow(id: number): TicketRow {
  const row = getDb().prepare("SELECT * FROM tickets WHERE id = ?").get(id) as TicketRow | undefined;
  if (!row) throw notFound("Ticket");
  return row;
}

/** Authors get a 404 (not 403) for other authors' tickets so ids can't be probed. */
export function assertCanAccess(user: AuthUser, ticket: TicketRow): void {
  if (user.role === "admin") return;
  if (ticket.author_id !== user.authorId) throw notFound("Ticket");
}

function getListRow(id: number): ListRow {
  const row = getDb().prepare(`${LIST_SELECT} WHERE t.id = ?`).get(id) as ListRow | undefined;
  if (!row) throw notFound("Ticket");
  return row;
}

export interface TicketFilters {
  status?: TicketStatus[];
  category?: Category;
  priority?: Priority;
  assignee?: "me" | "unassigned" | number;
  authorId?: string;
  bookId?: string;
  from?: string;
  to?: string;
  q?: string;
  sort: "urgency" | "newest" | "oldest" | "updated";
  page: number;
  pageSize: number;
}

const SORTS: Record<TicketFilters["sort"], string> = {
  // Unresolved first, then most urgent, then oldest — the order an ops person should work in.
  urgency: `CASE WHEN t.status IN ('Open', 'In Progress') THEN 0 ELSE 1 END,
            CASE t.priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 2 END,
            t.created_at ASC`,
  newest: "t.created_at DESC",
  oldest: "t.created_at ASC",
  updated: "t.updated_at DESC",
};

export function listTickets(user: AuthUser, f: TicketFilters) {
  const where: string[] = [];
  const params: unknown[] = [];

  if (user.role === "author") {
    where.push("t.author_id = ?");
    params.push(user.authorId);
  } else if (f.authorId) {
    where.push("t.author_id = ?");
    params.push(f.authorId);
  }
  if (f.status?.length) {
    where.push(`t.status IN (${f.status.map(() => "?").join(", ")})`);
    params.push(...f.status);
  }
  if (f.category) where.push("t.category = ?"), params.push(f.category);
  if (f.priority) where.push("t.priority = ?"), params.push(f.priority);
  if (f.bookId) where.push("t.book_id = ?"), params.push(f.bookId);
  if (f.assignee === "unassigned") where.push("t.assigned_admin_id IS NULL");
  else if (f.assignee === "me") where.push("t.assigned_admin_id = ?"), params.push(user.id);
  else if (typeof f.assignee === "number") where.push("t.assigned_admin_id = ?"), params.push(f.assignee);
  if (f.from) where.push("t.created_at >= ?"), params.push(f.from);
  if (f.to) where.push("t.created_at < date(?, '+1 day')"), params.push(f.to);
  if (f.q) {
    where.push("(t.subject LIKE ? OR t.description LIKE ? OR a.name LIKE ? OR CAST(t.id AS TEXT) = ?)");
    const like = `%${f.q}%`;
    params.push(like, like, like, f.q.replace(/^#/, ""));
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const db = getDb();
  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM tickets t JOIN authors a ON a.id = t.author_id ${whereSql}`)
    .get(...params) as { total: number };
  const rows = db
    .prepare(`${LIST_SELECT} ${whereSql} ORDER BY ${SORTS[f.sort]} LIMIT ? OFFSET ?`)
    .all(...params, f.pageSize, (f.page - 1) * f.pageSize) as ListRow[];

  return { data: rows.map((r) => project(user, r)), page: f.page, pageSize: f.pageSize, total };
}

export function listMessages(user: AuthUser, ticketId: number) {
  const rows = getDb()
    .prepare(
      `SELECT m.id, m.sender_role, m.body, m.ai_assisted, m.created_at, u.name AS sender_name
       FROM ticket_messages m JOIN users u ON u.id = m.sender_user_id
       WHERE m.ticket_id = ? ORDER BY m.id`,
    )
    .all(ticketId) as Array<{
    id: number;
    sender_role: "author" | "admin";
    body: string;
    ai_assisted: number;
    created_at: string;
    sender_name: string;
  }>;
  return rows.map((m) => ({
    id: m.id,
    senderRole: m.sender_role,
    // Authors see "BookLeaf Support (Aisha)" style names; admins see the full name.
    senderName: m.sender_role === "admin" && user.role === "author" ? `${m.sender_name.split(" ")[0]} · BookLeaf Support` : m.sender_name,
    body: m.body,
    ...(user.role === "admin" ? { aiAssisted: m.ai_assisted === 1 } : {}),
    createdAt: m.created_at,
  }));
}

export function listAttachments(ticketId: number) {
  return getDb()
    .prepare(
      "SELECT id, original_name AS name, mime_type AS mimeType, size_bytes AS size, created_at AS createdAt FROM ticket_attachments WHERE ticket_id = ? ORDER BY id",
    )
    .all(ticketId) as Array<{ id: number; name: string; mimeType: string; size: number; createdAt: string }>;
}

export function getAttachment(ticketId: number, attachmentId: number) {
  const row = getDb()
    .prepare("SELECT * FROM ticket_attachments WHERE id = ? AND ticket_id = ?")
    .get(attachmentId, ticketId) as
    | { original_name: string; stored_name: string; mime_type: string }
    | undefined;
  if (!row) throw notFound("Attachment");
  return row;
}

export function listNotes(ticketId: number) {
  return getDb()
    .prepare(
      `SELECT n.id, n.body, n.created_at AS createdAt, u.id AS authorId, u.name AS authorName
       FROM internal_notes n JOIN users u ON u.id = n.admin_user_id WHERE n.ticket_id = ? ORDER BY n.id`,
    )
    .all(ticketId);
}

export function listEvents(ticketId: number) {
  return getDb()
    .prepare(
      `SELECT e.id, e.type, e.detail, e.created_at AS createdAt, u.name AS actorName
       FROM ticket_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.ticket_id = ? ORDER BY e.id`,
    )
    .all(ticketId);
}

/** Full ticket view: the ticket, its conversation and attachments (+ notes/timeline for admins). */
export function getTicketDetail(user: AuthUser, id: number) {
  const row = getTicketRow(id);
  assertCanAccess(user, row);
  const base = {
    ticket: project(user, getListRow(id)),
    messages: listMessages(user, id),
    attachments: listAttachments(id),
  };
  if (user.role !== "admin") return base;
  return { ...base, notes: listNotes(id), events: listEvents(id), book: row.book_id ? findBook(row.book_id) : null };
}

// ---------------------------------------------------------------------------------------
// Writes

function logEvent(ticketId: number, actorId: number | null, type: string, detail: string | null) {
  getDb()
    .prepare("INSERT INTO ticket_events (ticket_id, actor_user_id, type, detail) VALUES (?, ?, ?, ?)")
    .run(ticketId, actorId, type, detail);
}

export interface NewTicketInput {
  bookId: string | null;
  subject: string;
  description: string;
}

export interface UploadedFile {
  originalname: string;
  filename: string;
  mimetype: string;
  size: number;
}

export function createTicket(user: AuthUser, input: NewTicketInput, files: UploadedFile[] = []): number {
  if (user.role !== "author" || !user.authorId) throw forbidden("Only authors can raise tickets");
  if (input.bookId) {
    const book = findBook(input.bookId);
    // Same 404-not-403 rule: don't reveal that another author's book id exists.
    if (!book || book.authorId !== user.authorId) throw badRequest("Request validation failed", [
      { field: "bookId", message: "Book not found on your account" },
    ]);
  }

  const db = getDb();
  const ts = now();
  const id = db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO tickets (author_id, book_id, subject, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(user.authorId, input.bookId, input.subject, input.description, ts, ts);
    const ticketId = Number(lastInsertRowid);
    db.prepare(
      "INSERT INTO ticket_messages (ticket_id, sender_role, sender_user_id, body, created_at) VALUES (?, 'author', ?, ?, ?)",
    ).run(ticketId, user.id, input.description, ts);
    const insertFile = db.prepare(
      "INSERT INTO ticket_attachments (ticket_id, original_name, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)",
    );
    for (const f of files) insertFile.run(ticketId, f.originalname, f.filename, f.mimetype, f.size);
    logEvent(ticketId, user.id, "created", null);
    return ticketId;
  })();

  publish({ type: "ticket.created", ticketId: id, authorId: user.authorId });
  return id;
}

export function addMessage(
  user: AuthUser,
  ticketId: number,
  body: string,
  opts: { status?: TicketStatus; aiAssisted?: boolean } = {},
): void {
  const ticket = getTicketRow(ticketId);
  assertCanAccess(user, ticket);
  if (ticket.status === "Closed") throw conflict("This ticket is closed. Please raise a new ticket.");

  const db = getDb();
  const ts = now();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO ticket_messages (ticket_id, sender_role, sender_user_id, body, ai_assisted, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(ticketId, user.role, user.id, body, user.role === "admin" && opts.aiAssisted ? 1 : 0, ts);

    let nextStatus: TicketStatus = ticket.status;
    if (user.role === "admin") {
      // Replying implies someone is working on it; the admin can also resolve in the same action.
      nextStatus = opts.status ?? (ticket.status === "Open" ? "In Progress" : ticket.status);
      db.prepare(
        `UPDATE tickets SET first_response_at = COALESCE(first_response_at, ?),
           assigned_admin_id = COALESCE(assigned_admin_id, ?) WHERE id = ?`,
      ).run(ts, user.id, ticketId);
      logEvent(ticketId, user.id, "replied", opts.aiAssisted ? "AI-assisted reply" : null);
    } else if (ticket.status === "Resolved") {
      // An author following up on a resolved ticket reopens it.
      nextStatus = "Open";
      logEvent(ticketId, user.id, "reopened", "Author replied to a resolved ticket");
    }
    applyStatus(ticket, nextStatus, user.id, ts);
    db.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").run(ts, ticketId);
  })();

  publish({ type: "ticket.message", ticketId, authorId: ticket.author_id });
}

function applyStatus(ticket: TicketRow, status: TicketStatus, actorId: number, ts: string) {
  if (status === ticket.status) return;
  const resolvedAt = status === "Resolved" || status === "Closed" ? ts : null;
  getDb()
    .prepare("UPDATE tickets SET status = ?, resolved_at = COALESCE(?, CASE WHEN ? IN ('Open','In Progress') THEN NULL ELSE resolved_at END) WHERE id = ?")
    .run(status, resolvedAt, status, ticket.id);
  logEvent(ticket.id, actorId, "status_changed", `${ticket.status} → ${status}`);
}

export interface TicketPatch {
  status?: TicketStatus;
  category?: Category;
  priority?: Priority;
  assignedAdminId?: number | null;
}

export function updateTicket(admin: AuthUser, ticketId: number, patch: TicketPatch): void {
  const ticket = getTicketRow(ticketId);
  const db = getDb();
  const ts = now();

  if (patch.assignedAdminId) {
    const assignee = db.prepare("SELECT role FROM users WHERE id = ?").get(patch.assignedAdminId) as
      | { role: string }
      | undefined;
    if (assignee?.role !== "admin") {
      throw badRequest("Request validation failed", [{ field: "assignedAdminId", message: "Not an admin user" }]);
    }
  }

  db.transaction(() => {
    if (patch.status) applyStatus(ticket, patch.status, admin.id, ts);
    if (patch.category && patch.category !== ticket.category) {
      db.prepare("UPDATE tickets SET category = ?, category_source = 'admin' WHERE id = ?").run(patch.category, ticketId);
      logEvent(ticketId, admin.id, "category_overridden", `${ticket.category ?? "Unclassified"} → ${patch.category}`);
    }
    if (patch.priority && patch.priority !== ticket.priority) {
      db.prepare("UPDATE tickets SET priority = ?, priority_source = 'admin' WHERE id = ?").run(patch.priority, ticketId);
      logEvent(ticketId, admin.id, "priority_overridden", `${ticket.priority ?? "Unset"} → ${patch.priority}`);
    }
    if (patch.assignedAdminId !== undefined && patch.assignedAdminId !== ticket.assigned_admin_id) {
      db.prepare("UPDATE tickets SET assigned_admin_id = ? WHERE id = ?").run(patch.assignedAdminId, ticketId);
      const name = patch.assignedAdminId
        ? (db.prepare("SELECT name FROM users WHERE id = ?").get(patch.assignedAdminId) as { name: string }).name
        : "Unassigned";
      logEvent(ticketId, admin.id, "assigned", name);
    }
    db.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").run(ts, ticketId);
  })();

  // Status is author-visible; classification/assignment changes are admin-only.
  publish({ type: "ticket.updated", ticketId, authorId: ticket.author_id, adminOnly: !patch.status });
}

export function addNote(admin: AuthUser, ticketId: number, body: string): void {
  const ticket = getTicketRow(ticketId);
  getDb().prepare("INSERT INTO internal_notes (ticket_id, admin_user_id, body) VALUES (?, ?, ?)").run(ticketId, admin.id, body);
  publish({ type: "ticket.note", ticketId, authorId: ticket.author_id, adminOnly: true });
}

/** Called by the AI classifier (or its rules fallback) — never overrides an admin's choice. */
export function storeClassification(
  ticketId: number,
  result: { category: Category; priority: Priority; reasoning: string },
  source: "ai" | "fallback",
): void {
  const ticket = getTicketRow(ticketId);
  const db = getDb();
  db.prepare(
    `UPDATE tickets SET
       category = CASE WHEN category_source = 'admin' THEN category ELSE ? END,
       category_source = CASE WHEN category_source = 'admin' THEN category_source ELSE ? END,
       priority = CASE WHEN priority_source = 'admin' THEN priority ELSE ? END,
       priority_source = CASE WHEN priority_source = 'admin' THEN priority_source ELSE ? END,
       ai_reasoning = ?, classification_status = ?
     WHERE id = ?`,
  ).run(result.category, source, result.priority, source, result.reasoning, source === "ai" ? "done" : "fallback", ticketId);
  logEvent(ticketId, null, source === "ai" ? "ai_classified" : "rules_classified", `${result.category} · ${result.priority}`);
  publish({ type: "ticket.updated", ticketId, authorId: ticket.author_id });
}

export function countMessages(ticketId: number): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM ticket_messages WHERE ticket_id = ?").get(ticketId) as { n: number }).n;
}
