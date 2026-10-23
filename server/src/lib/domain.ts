/** Domain vocabulary shared by validation, the AI layer and the database. */

export const TICKET_STATUSES = ["Open", "In Progress", "Resolved", "Closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const CATEGORIES = [
  "Royalty & Payments",
  "ISBN & Metadata Issues",
  "Printing & Quality",
  "Distribution & Availability",
  "Book Status & Production Updates",
  "General Inquiry",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ["Critical", "High", "Medium", "Low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type Role = "author" | "admin";

export interface AuthUser {
  id: number;
  role: Role;
  name: string;
  email: string;
  authorId: string | null;
}

/**
 * First-response targets per priority (hours). Used to flag tickets as "overdue" in the
 * admin queue so the oldest urgent work is impossible to miss.
 */
export const RESPONSE_SLA_HOURS: Record<Priority, number> = {
  Critical: 4,
  High: 24,
  Medium: 48,
  Low: 72,
};

export const PRIORITY_RANK: Record<Priority, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
