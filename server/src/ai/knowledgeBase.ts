import type { Category } from "../lib/domain";

/**
 * The BookLeaf Knowledge Base, split into sections so each prompt carries only what it needs.
 *
 * Cost note: sending the whole KB on every draft would be ~1.5k extra tokens per call. Instead
 * the draft prompt includes the always-relevant sections (company overview + tone) plus the
 * sections mapped to the ticket's category, and the one worked example for that category.
 */

export const KB_COMPANY_OVERVIEW = `## Company overview
- BookLeaf Publishing is a self-publishing company operating in India and the US.
- Publishing packages: Standard Free (no upfront cost) and Bestseller Breakthrough (premium, paid package with marketing and distribution add-ons).
- BookLeaf handles cover design, typesetting, ISBN assignment, printing, distribution and royalty management.
- In-house printing facility and warehouse in Delhi. Print partners: Repro India and Epitome Books.`;

export const KB_TONE = `## Communication tone (mandatory)
- Always empathetic and professional. Authors are partners, not customers to be managed.
- Acknowledge the author's concern before jumping to solutions.
- Be specific: use actual numbers, dates and statuses from the context rather than vague reassurances.
- If something is BookLeaf's fault (delayed royalties, ISBN error), own it directly. No corporate deflection.
- If the issue needs escalation or investigation, give a clear timeline (e.g. "Our team will look into this and get back to you within 48 hours"), never open-ended promises.
- Always end with a clear next step for the author and/or the BookLeaf team.`;

const KB_ROYALTY = `## Royalty policy
- 80/20 split: 80% of net profit per book goes to the author, 20% to BookLeaf.
- Net profit = MRP minus printing cost, platform commission (Amazon/Flipkart) and shipping charges.
- Royalties are calculated quarterly and paid within 45 days of the quarter ending.
- Minimum payout threshold: ₹1,000. Accumulated royalties below this roll over to the next quarter.
- Payouts are made by bank transfer to the account linked in the author's dashboard.
- Authors can view a detailed royalty breakdown (sales per platform) in their dashboard.`;

const KB_ISBN = `## ISBN policy
- Every BookLeaf book gets a unique ISBN assigned by BookLeaf, registered under BookLeaf's publisher imprint.
- Authors wanting an ISBN under their own imprint must obtain it independently.
- ISBN errors (duplicate, wrong book linked) are high priority and escalated to the production team.
- Metadata updates (e.g. description) can be submitted via the dashboard or by emailing the BookLeaf team; changes reflect on platforms within 3–5 business days.`;

const KB_PRINTING = `## Printing & quality
- In-house printing handles most orders; overflow or special formats go to Repro India or Epitome Books.
- Standard print turnaround: 5–7 business days from order confirmation.
- Quality issues (misprints, binding defects, colour inconsistency): BookLeaf arranges a free reprint after verification. The author may need to share photos of the defective copy.`;

const KB_DISTRIBUTION = `## Distribution & availability
- Books are listed on Amazon India, Flipkart, Amazon US, Amazon UK and the BookLeaf Store.
- New listings typically go live within 7–10 business days after publication is complete.
- "Unavailable" on a platform usually indicates a stock sync issue — BookLeaf can trigger a re-sync, live again within 24–48 hours.`;

const KB_PRODUCTION = `## Production stages
- Manuscript Received → Editing (if opted) → Cover Design → Typesetting → Proofreading → ISBN Assignment → Printing → Distribution Setup → Published & Live.
- Authors are emailed at each stage. Delays typically happen at Cover Design (waiting for author approval) and Proofreading (revision rounds).
- Never blame the author for a delay, even if it is on their side — frame it collaboratively.`;

/** Worked examples from BookLeaf, used as few-shot guidance for tone and content. */
const EXAMPLES: Record<Category, string> = {
  "Royalty & Payments": `Example query: "I published my book 4 months ago and still haven't received any royalty."
Expected handling: acknowledge the frustration; explain the quarterly cycle and 45-day payout window; ask them to confirm bank details are linked; give the specific next payout date; if genuinely overdue, escalate with a 48-hour resolution timeline.
Example query: "My royalty seems too low. I sold 200 copies but only received ₹3,000."
Expected handling: explain net profit (MRP minus printing, platform commission, shipping); offer a line-by-line royalty breakdown; be transparent, never defensive.`,
  "ISBN & Metadata Issues": `Example query: "My book shows a different ISBN on Amazon than on the physical copy."
Expected handling: treat as high priority; acknowledge it is a serious data issue; confirm immediate escalation to the production team; give a 48-hour resolution timeline.`,
  "Printing & Quality": `Example query: "The print quality of my author copies is terrible — blurry images, misaligned pages."
Expected handling: apologise sincerely; ask for photos of the defective copies; confirm a free reprint once verified; give a 5–7 business day reprint timeline.`,
  "Distribution & Availability": `Example query: "My book is published but shows 'Currently Unavailable' on Amazon."
Expected handling: explain this is typically a stock sync issue; confirm you are triggering a re-sync with the distribution team; set the expectation of 24–48 hours.`,
  "Book Status & Production Updates": `Example query: "It's been 3 weeks and my book is still in typesetting."
Expected handling: check the actual production status; if delayed, be honest about why (e.g. waiting on proof approval); give a specific updated timeline; frame it collaboratively, never blame the author.`,
  "General Inquiry": `Example query: "Can I update my book's description on Amazon after it's live?"
Expected handling: yes — metadata updates can be submitted via the dashboard or by emailing the team; changes reflect within 3–5 business days.`,
};

const SECTIONS_BY_CATEGORY: Record<Category, string[]> = {
  "Royalty & Payments": [KB_ROYALTY],
  "ISBN & Metadata Issues": [KB_ISBN],
  "Printing & Quality": [KB_PRINTING],
  "Distribution & Availability": [KB_DISTRIBUTION],
  "Book Status & Production Updates": [KB_PRODUCTION, KB_DISTRIBUTION],
  // General questions can touch anything, so they get the lightweight policy sections.
  "General Inquiry": [KB_ISBN, KB_ROYALTY, KB_DISTRIBUTION],
};

/** The category-specific knowledge block for a draft prompt (stable per category → cacheable). */
export function knowledgeForCategory(category: Category): string {
  return [...SECTIONS_BY_CATEGORY[category], `## Reference handling for this category\n${EXAMPLES[category]}`].join(
    "\n\n",
  );
}
