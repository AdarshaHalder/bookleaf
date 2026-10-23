import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { env } from "../config/env";
import { getDb } from "../db/connection";
import { CATEGORIES, PRIORITIES, type Category, type Priority } from "../lib/domain";
import { findBook } from "../services/bookService";
import { getTicketRow, storeClassification } from "../services/ticketService";
import { isAiAvailable, trackedCall } from "./client";
import { clip } from "./context";
import { CLASSIFIER_SYSTEM } from "./prompts";
import { classifyWithRules } from "./rulesClassifier";

/**
 * Classifies a ticket into a category + priority.
 *
 * - Structured outputs (strict JSON schema via `zodResponseFormat`) guarantee the response
 *   matches the schema, so there is no brittle JSON parsing and the enums can only be valid.
 * - Temperature 0 and a small max_tokens: this is a short, deterministic classification.
 * - Input is small: subject + description (clipped) + a 1–2 line account hint. No KB, no
 *   history — the rubric in the static system prompt is all the model needs.
 * - Any failure falls back to the keyword classifier, so a ticket is never left unclassified.
 */

const ClassificationSchema = z.object({
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  reasoning: z.string().describe("One sentence an admin can scan, citing the decisive facts."),
});

export interface ClassificationResult {
  category: Category;
  priority: Priority;
  reasoning: string;
  source: "ai" | "fallback";
}

function accountHint(bookId: string | null): string {
  if (!bookId) return "Ticket is account-level (no specific book selected).";
  const book = findBook(bookId);
  if (!book) return "Ticket is account-level.";
  if (!book.isPublished) return `Book "${book.title}" is not yet published — status: ${book.status}.`;
  const payout = book.last_royalty_payout_date
    ? `last royalty payout ${book.last_royalty_payout_date}`
    : "has never received a royalty payout";
  return `Book "${book.title}" is live since ${book.publication_date}; ₹${book.royalty_pending} royalty pending; ${payout}.`;
}

export async function classifyText(
  ticketId: number | null,
  subject: string,
  description: string,
  bookId: string | null,
): Promise<ClassificationResult> {
  if (!isAiAvailable()) return { ...classifyWithRules(subject, description), source: "fallback" };

  const userContent = `<ticket>
Subject: ${clip(subject, 200)}
Description: ${clip(description, 2500)}
</ticket>
Account facts: ${accountHint(bookId)}
Today: ${new Date().toISOString().slice(0, 10)}`;

  try {
    const response = await trackedCall({ operation: "classify", ticketId }, (client) =>
      client.chat.completions.parse({
        model: env.AI_MODEL,
        max_completion_tokens: 300,
        temperature: 0,
        response_format: zodResponseFormat(ClassificationSchema, "ticket_classification"),
        messages: [
          { role: "system", content: CLASSIFIER_SYSTEM },
          { role: "user", content: userContent },
        ],
      }),
    );
    const parsed = response.choices[0]?.message.parsed;
    if (!parsed) throw new Error(`Unparseable classification (finish_reason=${response.choices[0]?.finish_reason})`);
    return { ...parsed, source: "ai" };
  } catch (err) {
    console.warn(`[ai] classification failed for ticket ${ticketId}, using rules:`, (err as Error).message);
    return { ...classifyWithRules(subject, description), source: "fallback" };
  }
}

/** Classifies a stored ticket and persists the result (respecting admin overrides). */
export async function classifyTicket(ticketId: number): Promise<ClassificationResult> {
  const t = getTicketRow(ticketId);
  const result = await classifyText(ticketId, t.subject, t.description, t.book_id);
  storeClassification(ticketId, result, result.source);
  return result;
}

// Background work tracking — lets tests (and graceful shutdown) wait for in-flight AI calls.
const inFlight = new Set<Promise<unknown>>();

/** Fire-and-forget classification: the author's request returns immediately. */
export function classifyInBackground(ticketId: number): void {
  const p = classifyTicket(ticketId)
    .catch((err) => console.error(`[ai] background classification crashed for ${ticketId}`, err))
    .finally(() => inFlight.delete(p));
  inFlight.add(p);
}

/** Classifies anything left pending (seed data, or tickets whose classification was interrupted). */
export function classifyPendingInBackground(): number {
  const pending = getDb().prepare("SELECT id FROM tickets WHERE classification_status = 'pending' ORDER BY id").all() as Array<{ id: number }>;
  for (const { id } of pending) classifyInBackground(id);
  return pending.length;
}

export async function waitForBackgroundWork(): Promise<void> {
  while (inFlight.size) await Promise.all([...inFlight]);
}
