import type { BookFacts } from "../ai/context";
import { getDb } from "../db/connection";
import { notFound } from "../lib/errors";

interface BookRow {
  id: string;
  author_id: string;
  title: string;
  isbn: string | null;
  genre: string | null;
  publication_date: string | null;
  status: string;
  mrp: number | null;
  author_royalty_per_copy: number | null;
  total_copies_sold: number;
  total_royalty_earned: number;
  royalty_paid: number;
  royalty_pending: number;
  last_royalty_payout_date: string | null;
  print_partner: string | null;
  platforms: string | null;
}

export interface Book extends BookFacts {
  authorId: string;
  genre: string | null;
  isPublished: boolean;
}

const SELECT_BOOKS = `
  SELECT b.*, (SELECT GROUP_CONCAT(platform, '|') FROM book_platforms p WHERE p.book_id = b.id) AS platforms
  FROM books b`;

function toBook(row: BookRow): Book {
  return {
    id: row.id,
    authorId: row.author_id,
    title: row.title,
    isbn: row.isbn,
    genre: row.genre,
    status: row.status,
    isPublished: row.status === "Published & Live",
    publication_date: row.publication_date,
    mrp: row.mrp,
    author_royalty_per_copy: row.author_royalty_per_copy,
    total_copies_sold: row.total_copies_sold,
    total_royalty_earned: row.total_royalty_earned,
    royalty_paid: row.royalty_paid,
    royalty_pending: row.royalty_pending,
    last_royalty_payout_date: row.last_royalty_payout_date,
    print_partner: row.print_partner,
    platforms: row.platforms ? row.platforms.split("|").sort() : [],
  };
}

export function listBooks(authorId?: string): Book[] {
  const rows = authorId
    ? getDb().prepare(`${SELECT_BOOKS} WHERE b.author_id = ? ORDER BY b.publication_date IS NULL, b.publication_date DESC`).all(authorId)
    : getDb().prepare(`${SELECT_BOOKS} ORDER BY b.author_id, b.id`).all();
  return (rows as BookRow[]).map(toBook);
}

export function findBook(id: string): Book | null {
  const row = getDb().prepare(`${SELECT_BOOKS} WHERE b.id = ?`).get(id) as BookRow | undefined;
  return row ? toBook(row) : null;
}

export function getBook(id: string): Book {
  const book = findBook(id);
  if (!book) throw notFound("Book");
  return book;
}

/** Account-level totals shown at the top of the author's "My Books" page. */
export function summarise(books: Book[]) {
  return {
    totalBooks: books.length,
    publishedBooks: books.filter((b) => b.isPublished).length,
    totalCopiesSold: books.reduce((n, b) => n + b.total_copies_sold, 0),
    totalRoyaltyEarned: books.reduce((n, b) => n + b.total_royalty_earned, 0),
    totalRoyaltyPaid: books.reduce((n, b) => n + b.royalty_paid, 0),
    totalRoyaltyPending: books.reduce((n, b) => n + b.royalty_pending, 0),
  };
}

export interface AuthorProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  joined_date: string | null;
}

export function getAuthor(id: string): AuthorProfile {
  const row = getDb().prepare("SELECT * FROM authors WHERE id = ?").get(id) as AuthorProfile | undefined;
  if (!row) throw notFound("Author");
  return row;
}

export function listAuthors(): Array<AuthorProfile & { book_count: number; open_tickets: number }> {
  return getDb()
    .prepare(
      `SELECT a.*,
         (SELECT COUNT(*) FROM books b WHERE b.author_id = a.id) AS book_count,
         (SELECT COUNT(*) FROM tickets t WHERE t.author_id = a.id AND t.status IN ('Open', 'In Progress')) AS open_tickets
       FROM authors a ORDER BY a.name`,
    )
    .all() as Array<AuthorProfile & { book_count: number; open_tickets: number }>;
}
