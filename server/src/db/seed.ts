import bcrypt from "bcryptjs";
import type { DB } from "./connection";
import sampleData from "./bookleaf_sample_data.json";

/** Demo credentials — documented in the README. */
export const DEMO_AUTHOR_PASSWORD = "author123";
export const DEMO_ADMINS = [
  { email: "admin@bookleaf.com", name: "Aisha Verma (Support Lead)", password: "admin123" },
  { email: "ops@bookleaf.com", name: "Karan Mehta (Operations)", password: "admin123" },
];

type SampleBook = (typeof sampleData.authors)[number]["books"][number];

/**
 * A few realistic historical tickets so the admin queue isn't empty on first login.
 * They are pre-classified (category_source = 'admin') so seeding never calls the AI.
 */
const SEED_TICKETS = [
  {
    authorId: "AUTH003",
    bookId: "BK005",
    subject: "Haven't received any royalty since publication",
    description:
      "My book Between Two Temples was published in July 2024 and the dashboard shows ₹2,546 pending, but I have never received a single payout. My bank details were added months ago. What is going on?",
    category: "Royalty & Payments",
    priority: "High",
    hoursAgo: 52,
  },
  {
    authorId: "AUTH009",
    bookId: "BK015",
    subject: "Raising Roots stuck in typesetting",
    description:
      "It's been over 3 weeks and my book is still showing 'Typesetting'. I approved the cover long ago. When will it move to proofreading?",
    category: "Book Status & Production Updates",
    priority: "Medium",
    hoursAgo: 30,
  },
  {
    authorId: "AUTH002",
    bookId: "BK004",
    subject: "Startup Sutra shows 'Currently Unavailable' on Amazon US",
    description:
      "Readers in the US are telling me the book shows as currently unavailable on Amazon US since last week. It is my best-selling title, please fix this urgently.",
    category: "Distribution & Availability",
    priority: "High",
    hoursAgo: 6,
  },
  {
    authorId: "AUTH001",
    bookId: null,
    subject: "How do I update my author bio?",
    description: "I'd like to update the author bio that appears on my book pages. Where can I do this?",
    category: "General Inquiry",
    priority: "Low",
    hoursAgo: 75,
  },
] as const;

export function seedDatabase(db: DB, { reset = false } = {}): { seeded: boolean } {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM authors").get() as { n: number };
  if (existing.n > 0 && !reset) return { seeded: false };

  const authorHash = bcrypt.hashSync(DEMO_AUTHOR_PASSWORD, 10);

  const tx = db.transaction(() => {
    if (reset) {
      for (const table of [
        "ai_usage", "ticket_events", "ticket_attachments", "internal_notes", "ticket_messages",
        "tickets", "book_platforms", "books", "users", "authors",
      ]) {
        db.prepare(`DELETE FROM ${table}`).run();
      }
      db.prepare("DELETE FROM sqlite_sequence").run();
    }

    const insertAuthor = db.prepare(
      `INSERT INTO authors (id, name, email, phone, city, joined_date)
       VALUES (@author_id, @name, @email, @phone, @city, @joined_date)`,
    );
    const insertUser = db.prepare(
      `INSERT INTO users (email, password_hash, name, role, author_id)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertBook = db.prepare(
      `INSERT INTO books (id, author_id, title, isbn, genre, publication_date, status, mrp,
         author_royalty_per_copy, total_copies_sold, total_royalty_earned, royalty_paid,
         royalty_pending, last_royalty_payout_date, print_partner)
       VALUES (@book_id, @author_id, @title, @isbn, @genre, @publication_date, @status, @mrp,
         @author_royalty_per_copy, @total_copies_sold, @total_royalty_earned, @royalty_paid,
         @royalty_pending, @last_royalty_payout_date, @print_partner)`,
    );
    const insertPlatform = db.prepare("INSERT INTO book_platforms (book_id, platform) VALUES (?, ?)");

    for (const author of sampleData.authors) {
      insertAuthor.run(author);
      insertUser.run(author.email.toLowerCase(), authorHash, author.name, "author", author.author_id);
      for (const book of author.books as SampleBook[]) {
        insertBook.run({ ...book, author_id: author.author_id });
        for (const platform of book.available_on) insertPlatform.run(book.book_id, platform);
      }
    }

    for (const admin of DEMO_ADMINS) {
      insertUser.run(admin.email, bcrypt.hashSync(admin.password, 10), admin.name, "admin", null);
    }

    const userIdFor = db.prepare("SELECT id FROM users WHERE author_id = ?");
    const insertTicket = db.prepare(
      `INSERT INTO tickets (author_id, book_id, subject, description, status, category, category_source,
         priority, priority_source, classification_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Open', ?, 'admin', ?, 'admin', 'done', ?, ?)`,
    );
    const insertMessage = db.prepare(
      "INSERT INTO ticket_messages (ticket_id, sender_role, sender_user_id, body, created_at) VALUES (?, 'author', ?, ?, ?)",
    );
    for (const t of SEED_TICKETS) {
      const createdAt = new Date(Date.now() - t.hoursAgo * 3_600_000).toISOString();
      const { lastInsertRowid } = insertTicket.run(
        t.authorId, t.bookId, t.subject, t.description, t.category, t.priority, createdAt, createdAt,
      );
      const user = userIdFor.get(t.authorId) as { id: number };
      insertMessage.run(lastInsertRowid, user.id, t.description, createdAt);
    }
  });
  tx();
  return { seeded: true };
}

// `npm run seed` — wipes and reseeds the configured database.
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv/config");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getDb } = require("./connection") as typeof import("./connection");
  const reset = process.argv.includes("--reset");
  const result = seedDatabase(getDb(), { reset });
  console.log(result.seeded ? "Database seeded." : "Database already seeded (use --reset).");
}
