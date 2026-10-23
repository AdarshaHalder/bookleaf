import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env } from "../config/env";
import { getDb } from "../db/connection";
import type { Category } from "../lib/domain";
import { royaltyCalendar } from "../lib/royaltyCalendar";
import { findBook, getAuthor, listBooks, type Book } from "../services/bookService";
import { countMessages, getTicketRow, type TicketRow } from "../services/ticketService";
import { isAiAvailable, trackedCall } from "./client";
import { clip, formatBookFacts, formatBookSummaryLine } from "./context";
import { knowledgeForCategory } from "./knowledgeBase";
import { DRAFTER_SYSTEM } from "./prompts";
import { isPayoutOverdue, templateReply } from "./templates";

/**
 * Drafts the next BookLeaf reply for a ticket.
 *
 * Cost controls:
 *  - The draft is cached on the ticket and only regenerated when the conversation or category
 *    changes (or an admin explicitly asks). Opening the same ticket twice costs nothing.
 *  - Only the KB sections for the ticket's category are sent, not the whole KB.
 *  - The system prompt (persona + tone) and the category KB are separate cached blocks, so
 *    repeated drafts in the same category hit the prompt cache.
 *  - Conversation history is capped to the last MAX_MESSAGES messages, each clipped.
 *  - Account data is pre-formatted as terse facts: one book in detail, or one line per book.
 */

const MAX_MESSAGES = 6;
const MAX_MESSAGE_CHARS = 1500;
const MAX_NOTES = 3;

const ESCALATION_TEAMS = ["None", "Finance", "Production", "Distribution", "Print Quality", "Account Management"] as const;

const DraftSchema = z.object({
  reply: z.string().describe("The full reply to send to the author, plain text, including greeting and sign-off."),
  escalation: z.object({
    required: z.boolean(),
    team: z.enum(ESCALATION_TEAMS),
    reason: z.string().describe("Why escalation is (not) needed, one sentence for the admin."),
  }),
  suggested_status: z.enum(["In Progress", "Resolved"]).describe(
    "Resolved only if this reply fully answers the author and nothing further is pending on BookLeaf's side.",
  ),
  author_actions: z.array(z.string()).describe("Things the reply asks the author to do (may be empty)."),
  admin_checklist: z.array(z.string()).describe("Short internal to-dos for the admin before or after sending."),
});

export interface DraftMeta {
  escalation: { required: boolean; team: (typeof ESCALATION_TEAMS)[number]; reason: string };
  suggestedStatus: "In Progress" | "Resolved";
  authorActions: string[];
  adminChecklist: string[];
  category: Category;
  fallbackReason?: string;
}

export interface Draft {
  body: string;
  source: "ai" | "template";
  generatedAt: string;
  cached: boolean;
  meta: DraftMeta;
}

function bookContext(ticket: TicketRow, book: Book | null, calendar: ReturnType<typeof royaltyCalendar>): string {
  if (book) {
    const overdue = isPayoutOverdue(book, calendar)
      ? `\nPayout check: ₹${book.royalty_pending} pending is above the ₹1,000 threshold and the last passed payout deadline (${calendar.lastPassedPayoutDeadline}) is after the last payout, so this payout is OVERDUE — BookLeaf's fault.`
      : "";
    return `Book this ticket is about:\n${formatBookFacts(book)}${overdue}`;
  }
  const books = listBooks(ticket.author_id);
  return `Ticket is account-level. Author's books:\n${books.map(formatBookSummaryLine).join("\n") || "- none"}`;
}

function buildUserPrompt(ticket: TicketRow, category: Category): string {
  const author = getAuthor(ticket.author_id);
  const book = ticket.book_id ? findBook(ticket.book_id) : null;
  const calendar = royaltyCalendar();
  const db = getDb();

  const messages = db
    .prepare(
      `SELECT sender_role, body, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(ticket.id, MAX_MESSAGES) as Array<{ sender_role: string; body: string; created_at: string }>;
  const total = countMessages(ticket.id);
  const omitted = total - messages.length;
  const conversation = messages
    .reverse()
    .map((m) => `[${m.created_at.slice(0, 16).replace("T", " ")}] ${m.sender_role === "author" ? "AUTHOR" : "BOOKLEAF"}:\n${clip(m.body, MAX_MESSAGE_CHARS)}`)
    .join("\n\n");

  const notes = db
    .prepare("SELECT body FROM internal_notes WHERE ticket_id = ? ORDER BY id DESC LIMIT ?")
    .all(ticket.id, MAX_NOTES) as Array<{ body: string }>;

  const royaltyDates =
    category === "Royalty & Payments" || category === "General Inquiry"
      ? `\nRoyalty calendar: today ${calendar.today}; current quarter ${calendar.currentQuarter} ends ${calendar.currentQuarterEnds}; most recent passed payout deadline ${calendar.lastPassedPayoutDeadline}; next payout deadline ${calendar.nextPayoutDeadline}.`
      : `\nToday: ${calendar.today}.`;

  return `<ticket_context>
Ticket #${ticket.id} · Category: ${category} · Priority: ${ticket.priority ?? "unset"} · Status: ${ticket.status} · Opened ${ticket.created_at.slice(0, 10)}
Author: ${author.name} (${author.city ?? "city unknown"}), BookLeaf author since ${author.joined_date ?? "unknown"}
Subject: ${clip(ticket.subject, 200)}
${bookContext(ticket, book, calendar)}${royaltyDates}
</ticket_context>
${notes.length ? `\n<internal_notes note="Staff-only context. Use it to inform the reply, never quote it.">\n${notes.map((n) => `- ${clip(n.body, 500)}`).join("\n")}\n</internal_notes>\n` : ""}
<conversation>${omitted > 0 ? `\n(${omitted} earlier messages omitted)` : ""}
${conversation}
</conversation>

Write BookLeaf's next reply to the author.`;
}

async function generate(ticket: TicketRow, category: Category): Promise<Omit<Draft, "cached" | "generatedAt">> {
  const author = getAuthor(ticket.author_id);
  const firstName = author.name.split(" ")[0];
  const fallback = (reason: string) => ({
    body: templateReply(category, {
      firstName,
      book: ticket.book_id ? findBook(ticket.book_id) : null,
      calendar: royaltyCalendar(),
    }),
    source: "template" as const,
    meta: {
      escalation: { required: false, team: "None" as const, reason: "Template draft — decide on escalation manually." },
      suggestedStatus: "In Progress" as const,
      authorActions: [],
      adminChecklist: ["AI drafting was unavailable: review this template and personalise it before sending."],
      category,
      fallbackReason: reason,
    },
  });

  if (!isAiAvailable()) return fallback("AI service not configured or temporarily unavailable");

  try {
    const response = await trackedCall({ operation: "draft", ticketId: ticket.id }, (client) =>
      client.beta.messages.parse({
        model: env.AI_MODEL,
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: betaZodOutputFormat(DraftSchema) },
        system: [
          { type: "text", text: DRAFTER_SYSTEM, cache_control: { type: "ephemeral" } },
          {
            type: "text",
            text: `# BookLeaf knowledge base (relevant sections)\n\n${knowledgeForCategory(category)}`,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: buildUserPrompt(ticket, category) }],
      }),
    );
    const d = response.parsed_output;
    if (!d) throw new Error(`Unparseable draft (stop_reason=${response.stop_reason})`);
    return {
      body: d.reply.trim(),
      source: "ai",
      meta: {
        escalation: d.escalation,
        suggestedStatus: d.suggested_status,
        authorActions: d.author_actions,
        adminChecklist: d.admin_checklist,
        category,
      },
    };
  } catch (err) {
    console.warn(`[ai] draft failed for ticket ${ticket.id}, using template:`, (err as Error).message);
    return fallback("AI request failed — showing a policy-based template instead");
  }
}

const inFlight = new Map<number, Promise<Draft>>();

/** Returns the cached draft when still valid; otherwise generates (deduplicating concurrent calls). */
export async function getDraft(ticketId: number, { regenerate = false } = {}): Promise<Draft> {
  const ticket = getTicketRow(ticketId);
  const category: Category = ticket.category ?? "General Inquiry";
  const messageCount = countMessages(ticketId);

  if (!regenerate && ticket.ai_draft && ticket.ai_draft_meta && ticket.ai_draft_message_count === messageCount) {
    const meta = JSON.parse(ticket.ai_draft_meta) as DraftMeta;
    // A template draft is retried once AI is back; an AI draft is reused while still valid.
    const stillValid = meta.category === category && (ticket.ai_draft_source === "ai" || !isAiAvailable());
    if (stillValid) {
      return {
        body: ticket.ai_draft,
        source: ticket.ai_draft_source ?? "ai",
        generatedAt: ticket.ai_draft_generated_at ?? ticket.updated_at,
        cached: true,
        meta,
      };
    }
  }

  const existing = inFlight.get(ticketId);
  if (existing) return existing;

  const p = generate(ticket, category)
    .then((d) => {
      const generatedAt = new Date().toISOString();
      getDb()
        .prepare(
          `UPDATE tickets SET ai_draft = ?, ai_draft_meta = ?, ai_draft_source = ?, ai_draft_message_count = ?,
             ai_draft_generated_at = ? WHERE id = ?`,
        )
        .run(d.body, JSON.stringify(d.meta), d.source, messageCount, generatedAt, ticketId);
      return { ...d, generatedAt, cached: false };
    })
    .finally(() => inFlight.delete(ticketId));
  inFlight.set(ticketId, p);
  return p;
}
