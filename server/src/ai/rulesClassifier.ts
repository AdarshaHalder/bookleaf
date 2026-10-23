import type { Category, Priority } from "../lib/domain";

/**
 * Deterministic keyword classifier used when the AI is unavailable (no key, outage, rate
 * limit, circuit open). It is deliberately conservative: it never assigns Critical, and the
 * ticket is marked `fallback` so admins know to double-check it.
 */

const CATEGORY_KEYWORDS: Array<[Category, RegExp]> = [
  ["ISBN & Metadata Issues", /\b(isbn|metadata|imprint|barcode|blurb|author bio|wrong (title|author|book))\b/i],
  ["Printing & Quality", /\b(print(ing|ed)?|misprint|binding|blurr?y|faded|smudge|torn|pages? (missing|misaligned)|quality|defect|reprint|author copies)\b/i],
  ["Distribution & Availability", /\b(unavailable|out of stock|not (listed|showing|available)|amazon|flipkart|listing|distribution|buy link)\b/i],
  ["Royalty & Payments", /\b(royalt(y|ies)|payment|payout|paid|bank|earning|invoice|tds|statement|₹|rs\.?|inr)\b/i],
  ["Book Status & Production Updates", /\b(status|typesetting|proof(read)?|cover design|editing|production|stage|timeline|delay(ed)?|when will)\b/i],
];

const HIGH_SIGNALS =
  /\b(never received|not received|haven'?t received|months?|overdue|urgent|asap|wrong isbn|duplicate|legal|lawyer|refund|cancel|fraud|unacceptable)\b/i;
const LOW_SIGNALS = /\b(how (do|can) i|can i|is it possible|question|curious|update (my )?(bio|photo)|just wondering)\b/i;

export function classifyWithRules(subject: string, description: string): {
  category: Category;
  priority: Priority;
  reasoning: string;
} {
  const text = `${subject}\n${description}`;
  const match = CATEGORY_KEYWORDS.find(([, re]) => re.test(text));
  const category: Category = match ? match[0] : "General Inquiry";

  let priority: Priority = "Medium";
  if (HIGH_SIGNALS.test(text) || category === "ISBN & Metadata Issues") priority = "High";
  else if (LOW_SIGNALS.test(text) || category === "General Inquiry") priority = "Low";

  return {
    category,
    priority,
    reasoning: "Classified by keyword rules because the AI service was unavailable — please verify.",
  };
}
