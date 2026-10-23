/**
 * Compact, prompt-ready facts about the author's account. Only the fields the model needs are
 * serialised, as terse "key: value" lines (much cheaper than dumping JSON rows).
 */

export interface BookFacts {
  id: string;
  title: string;
  isbn: string | null;
  status: string;
  publication_date: string | null;
  mrp: number | null;
  author_royalty_per_copy: number | null;
  total_copies_sold: number;
  total_royalty_earned: number;
  royalty_paid: number;
  royalty_pending: number;
  last_royalty_payout_date: string | null;
  print_partner: string | null;
  platforms: string[];
}

const inr = (n: number | null) => (n === null ? "n/a" : `₹${n.toLocaleString("en-IN")}`);

export function formatBookFacts(b: BookFacts): string {
  if (b.status !== "Published & Live") {
    return [
      `Book: "${b.title}" (${b.id})`,
      `Status: ${b.status} — not yet published, so no sales or royalties yet`,
      `ISBN (assigned): ${b.isbn ?? "not yet assigned"}`,
    ].join("\n");
  }
  return [
    `Book: "${b.title}" (${b.id})`,
    `Status: ${b.status}, published ${b.publication_date}`,
    `ISBN: ${b.isbn}`,
    `MRP: ${inr(b.mrp)}; author royalty per copy: ${inr(b.author_royalty_per_copy)}`,
    `Copies sold: ${b.total_copies_sold}; royalty earned ${inr(b.total_royalty_earned)}, paid ${inr(
      b.royalty_paid,
    )}, pending ${inr(b.royalty_pending)}`,
    `Last royalty payout: ${b.last_royalty_payout_date ?? "never paid out yet"}`,
    `Print partner: ${b.print_partner ?? "n/a"}; available on: ${b.platforms.join(", ") || "none"}`,
  ].join("\n");
}

/** One line per book — used when the ticket is account-level rather than about one book. */
export function formatBookSummaryLine(b: BookFacts): string {
  return b.status === "Published & Live"
    ? `- "${b.title}": live, ${b.total_copies_sold} sold, ${inr(b.royalty_pending)} pending, last payout ${
        b.last_royalty_payout_date ?? "never"
      }`
    : `- "${b.title}": ${b.status}`;
}

/** Hard cap for any single piece of author text sent to the model. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [truncated]`;
}
