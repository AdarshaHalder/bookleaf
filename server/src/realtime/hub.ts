import type { Response } from "express";
import type { AuthUser } from "../lib/domain";

/**
 * Server-Sent Events hub. SSE was chosen over WebSockets because updates only flow
 * server → browser, it works over plain HTTP (no extra infra on Render/Railway), and the
 * browser's EventSource reconnects automatically.
 *
 * Every event is scoped: admins receive everything, an author only receives events for
 * tickets they own. Events carry ids only — clients refetch through the normal REST
 * endpoints, so RBAC is enforced in exactly one place.
 */

export type TicketEventType = "ticket.created" | "ticket.updated" | "ticket.message" | "ticket.note";

export interface TicketEvent {
  type: TicketEventType;
  ticketId: number;
  authorId: string;
  /** Admin-only events (internal notes, AI classification) are never sent to authors. */
  adminOnly?: boolean;
}

interface Client {
  user: AuthUser;
  res: Response;
}

const clients = new Set<Client>();
const HEARTBEAT_MS = 25_000;

export function subscribe(user: AuthUser, res: Response): () => void {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable proxy buffering (nginx, Render)
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: {}\n\n`);

  const client: Client = { user, res };
  clients.add(client);
  const heartbeat = setInterval(() => res.write(`: ping\n\n`), HEARTBEAT_MS);

  return () => {
    clearInterval(heartbeat);
    clients.delete(client);
  };
}

function canReceive(user: AuthUser, event: TicketEvent): boolean {
  if (user.role === "admin") return true;
  return !event.adminOnly && user.authorId === event.authorId;
}

export function publish(event: TicketEvent): void {
  const payload = JSON.stringify({ type: event.type, ticketId: event.ticketId });
  for (const client of clients) {
    if (canReceive(client.user, event)) client.res.write(`event: ticket\ndata: ${payload}\n\n`);
  }
}

export function connectedClients(): number {
  return clients.size;
}
