/**
 * BookLeaf pays royalties quarterly, within 45 days of the quarter ending.
 * These helpers give the AI (and the UI) concrete dates instead of vague reassurances.
 */

const DAY_MS = 86_400_000;

function quarterEnd(date: Date): Date {
  const q = Math.floor(date.getUTCMonth() / 3);
  return new Date(Date.UTC(date.getUTCFullYear(), q * 3 + 3, 0)); // last day of quarter
}

export interface RoyaltyCalendar {
  today: string;
  currentQuarter: string;
  currentQuarterEnds: string;
  /** Payout deadline for the most recently completed quarter. */
  lastQuarterPayoutDeadline: string;
  /** The next payout date that hasn't passed yet. */
  nextPayoutDeadline: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function royaltyCalendar(now = new Date()): RoyaltyCalendar {
  const currentEnd = quarterEnd(now);
  const prevEnd = quarterEnd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)));
  const prevDeadline = new Date(prevEnd.getTime() + 45 * DAY_MS);
  const currentDeadline = new Date(currentEnd.getTime() + 45 * DAY_MS);
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  return {
    today: iso(now),
    currentQuarter: `Q${q} ${now.getUTCFullYear()}`,
    currentQuarterEnds: iso(currentEnd),
    lastQuarterPayoutDeadline: iso(prevDeadline),
    nextPayoutDeadline: iso(prevDeadline >= now ? prevDeadline : currentDeadline),
  };
}
