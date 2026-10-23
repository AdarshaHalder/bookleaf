import { Router } from "express";
import { z } from "zod";
import { notFound } from "../lib/errors";
import { authenticate, currentUser, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { getAuthor, getBook, listAuthors, listBooks, summarise } from "../services/bookService";

const router = Router();
router.use(authenticate());

/**
 * GET /api/books — authors get their own books (+ totals); admins get every book, optionally
 * filtered by ?authorId=.
 */
router.get("/books", validate(z.object({ authorId: z.string().optional() }), "query"), (req, res) => {
  const user = currentUser(req);
  const { authorId } = res.locals.query as { authorId?: string };
  const books = listBooks(user.role === "author" ? user.authorId! : authorId);
  res.json({ data: books, summary: summarise(books) });
});

/** GET /api/books/:bookId */
router.get("/books/:bookId", (req, res) => {
  const user = currentUser(req);
  const book = getBook(req.params.bookId);
  if (user.role === "author" && book.authorId !== user.authorId) throw notFound("Book");
  res.json({ data: book });
});

/** GET /api/authors (admin) — author directory with open-ticket counts. */
router.get("/authors", requireRole("admin"), (_req, res) => {
  res.json({ data: listAuthors() });
});

/** GET /api/authors/:authorId — admins: anyone; authors: only themselves. */
router.get("/authors/:authorId", (req, res) => {
  const user = currentUser(req);
  if (user.role === "author" && user.authorId !== req.params.authorId) throw notFound("Author");
  const books = listBooks(req.params.authorId);
  res.json({ data: { ...getAuthor(req.params.authorId), books, summary: summarise(books) } });
});

export default router;
