export type Role = "author" | "admin";
export type TicketStatus = "Open" | "In Progress" | "Resolved" | "Closed";
export type Priority = "Critical" | "High" | "Medium" | "Low";
export type Source = "ai" | "fallback" | "admin" | null;

export const STATUSES: TicketStatus[] = ["Open", "In Progress", "Resolved", "Closed"];
export const PRIORITIES: Priority[] = ["Critical", "High", "Medium", "Low"];
export const CATEGORIES = [
  "Royalty & Payments",
  "ISBN & Metadata Issues",
  "Printing & Quality",
  "Distribution & Availability",
  "Book Status & Production Updates",
  "General Inquiry",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface User {
  id: number;
  role: Role;
  name: string;
  email: string;
  authorId: string | null;
}

export interface Book {
  id: string;
  authorId: string;
  title: string;
  isbn: string | null;
  genre: string | null;
  status: string;
  isPublished: boolean;
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

export interface BookSummary {
  totalBooks: number;
  publishedBooks: number;
  totalCopiesSold: number;
  totalRoyaltyEarned: number;
  totalRoyaltyPaid: number;
  totalRoyaltyPending: number;
}

interface TicketBase {
  id: number;
  bookId: string | null;
  bookTitle: string | null;
  subject: string;
  description: string;
  status: TicketStatus;
  category: Category | null;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorTicket extends TicketBase {
  hasNewReply: boolean;
}

export interface AdminTicket extends TicketBase {
  authorId: string;
  authorName: string;
  categorySource: Source;
  priority: Priority | null;
  prioritySource: Source;
  aiReasoning: string | null;
  classificationStatus: "pending" | "done" | "fallback";
  assignedAdmin: { id: number; name: string } | null;
  awaitingReply: boolean;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  responseDueAt: string;
  isOverdue: boolean;
}

export interface Message {
  id: number;
  senderRole: Role;
  senderName: string;
  body: string;
  aiAssisted?: boolean;
  createdAt: string;
}

export interface Attachment {
  id: number;
  name: string;
  mimeType: string;
  size: number;
}

export interface Note {
  id: number;
  body: string;
  createdAt: string;
  authorName: string;
}

export interface TimelineEvent {
  id: number;
  type: string;
  detail: string | null;
  createdAt: string;
  actorName: string | null;
}

export interface AuthorTicketDetail {
  ticket: AuthorTicket;
  messages: Message[];
  attachments: Attachment[];
}

export interface AdminTicketDetail {
  ticket: AdminTicket;
  messages: Message[];
  attachments: Attachment[];
  notes: Note[];
  events: TimelineEvent[];
  book: Book | null;
}

export interface Draft {
  body: string;
  source: "ai" | "template";
  generatedAt: string;
  cached: boolean;
  meta: {
    escalation: { required: boolean; team: string; reason: string };
    suggestedStatus: "In Progress" | "Resolved";
    authorActions: string[];
    adminChecklist: string[];
    fallbackReason?: string;
  };
}

export interface Paged<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminStats {
  byStatus: Partial<Record<TicketStatus, number>>;
  openByPriority: Partial<Record<Priority | "Unclassified", number>>;
  overdue: number;
  ai: {
    status: { configured: boolean; model: string; circuitOpen: boolean };
    usage: Array<{ operation: string; calls: number; ok: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; avgLatencyMs: number }>;
    overrides: { aiClassified: number; categoryOverrides: number; priorityOverrides: number };
  };
}
