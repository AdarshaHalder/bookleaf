import type { Category } from "../lib/domain";
import type { RoyaltyCalendar } from "../lib/royaltyCalendar";
import type { Book } from "../services/bookService";

/**
 * Deterministic reply templates used when the AI is unavailable. They follow the same tone
 * guidelines and still fill in the author's real numbers, so an admin can send a decent reply
 * with light edits even during an outage.
 */

export interface TemplateContext {
  firstName: string;
  book: Book | null;
  calendar: RoyaltyCalendar;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const SIGN_OFF = "Warm regards,\nBookLeaf Author Support";

/** True when a payout should already have happened under the quarterly policy. */
export function isPayoutOverdue(book: Book, calendar: RoyaltyCalendar): boolean {
  if (!book.isPublished || book.royalty_pending < 1000) return false;
  const last = book.last_royalty_payout_date;
  return !last || last < calendar.lastPassedPayoutDeadline;
}

function royalty({ book, calendar }: TemplateContext): string {
  if (!book || !book.isPublished) {
    return `BookLeaf calculates royalties quarterly and pays them within 45 days of each quarter ending, by bank transfer to the account linked in your dashboard. Payouts are made once your accumulated royalty crosses ₹1,000; smaller amounts roll over to the next quarter. The next payout date is ${calendar.nextPayoutDeadline}.

I'll check your account in detail and confirm your royalty position within 48 hours. In the meantime, please make sure your bank details are up to date in your dashboard.`;
  }
  const lastPayout = book.last_royalty_payout_date
    ? `your last payout was on ${book.last_royalty_payout_date}`
    : `no payout has been made yet`;
  const facts = `I've looked at "${book.title}": it has sold ${book.total_copies_sold} copies, earning ${inr(
    book.total_royalty_earned,
  )} in royalties. ${inr(book.royalty_paid)} has been paid and ${inr(book.royalty_pending)} is pending, and ${lastPayout}.`;

  if (isPayoutOverdue(book, calendar)) {
    return `${facts}

Under our quarterly cycle, the pending amount is above the ₹1,000 threshold and should already have reached you. That is on us, and I'm sorry. I have escalated this to our finance team today, and we will confirm the payout (or the exact reason for the hold-up) within 48 hours.

Could you please double-check that your bank details are linked in your dashboard? That way nothing delays the transfer once it is released.`;
  }
  if (book.royalty_pending > 0 && book.royalty_pending < 1000) {
    return `${facts}

Because the pending amount is below our ₹1,000 minimum payout threshold, it rolls over to the next quarter rather than being lost. It will be paid with the first quarterly cycle in which your total crosses ₹1,000.`;
  }
  return `${facts}

Royalties are calculated quarterly and paid within 45 days of the quarter ending; the next payout date is ${calendar.nextPayoutDeadline}. Your royalty is 80% of the net profit per copy (MRP minus printing cost, platform commission and shipping). I'm happy to share a detailed line-by-line breakdown if that helps. Just reply here.`;
}

function isbn({ book }: TemplateContext): string {
  const ref = book ? ` for "${book.title}" (ISBN on our records: ${book.isbn ?? "not yet assigned"})` : "";
  return `An ISBN or metadata problem${ref} is serious, and we treat it as a high priority. I have escalated this to our production team today, and we will come back to you with a fix within 48 hours.

If you can, please reply with a screenshot or link showing where the incorrect details appear (for example, the Amazon listing). It will help us correct every platform in one go.`;
}

function printing({ book }: TemplateContext): string {
  const ref = book ? ` of "${book.title}"` : "";
  return `I'm really sorry that the copies${ref} didn't arrive in the condition they should have. That isn't the standard we hold ourselves to.

Could you please reply with a few clear photos of the defects (for example, blurry pages, misalignment or binding issues)? Once our print team verifies them, BookLeaf will arrange a free reprint, which typically takes 5–7 business days from confirmation. I'll keep you updated at each step.`;
}

function distribution({ book }: TemplateContext): string {
  const where = book?.platforms.length ? ` Our records show it listed on ${book.platforms.join(", ")}.` : "";
  return `Thank you for flagging this. I understand how worrying it is when readers can't buy your book.${where}

When a live book shows as unavailable, it is usually a stock sync issue between our system and the platform. I'm triggering a re-sync with our distribution team now, and the listing should be live again within 24–48 hours. If it isn't, reply here and I'll escalate it straight away.`;
}

function production({ book }: TemplateContext): string {
  if (book && !book.isPublished) {
    return `I understand the wait. You're keen to see "${book.title}" out in the world, and so are we. It is currently at the "${book.status.replace(
      "In Production - ",
      "",
    )}" stage.

The remaining steps are Typesetting, Proofreading, ISBN Assignment, Printing and Distribution Setup, followed by Published & Live. I'm checking with the production team on exactly where things stand and what is needed from either side. I'll get back to you with a specific updated timeline within 48 hours.`;
  }
  return `Thanks for checking in. I'm looking into the current production status with our team and will come back to you with a specific update and timeline within 48 hours.`;
}

function general(): string {
  return `Thanks for reaching out. Most account and book details, including metadata such as your book description, can be updated through your dashboard or by emailing the BookLeaf team. Changes typically reflect on platforms within 3–5 business days.

I'll look into your question in detail and get back to you within 48 hours with a complete answer.`;
}

const BODIES: Record<Category, (ctx: TemplateContext) => string> = {
  "Royalty & Payments": royalty,
  "ISBN & Metadata Issues": isbn,
  "Printing & Quality": printing,
  "Distribution & Availability": distribution,
  "Book Status & Production Updates": production,
  "General Inquiry": general,
};

export function templateReply(category: Category, ctx: TemplateContext): string {
  return `Hi ${ctx.firstName},\n\n${BODIES[category](ctx)}\n\n${SIGN_OFF}`;
}
