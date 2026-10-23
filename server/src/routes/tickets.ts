import fs from "fs";
import path from "path";
import { Router } from "express";
import { z } from "zod";
import { getDraft } from "../ai/drafter";
import { classifyInBackground, classifyTicket } from "../ai/classifier";
import { env } from "../config/env";
import { CATEGORIES, PRIORITIES, TICKET_STATUSES } from "../lib/domain";
import { authenticate, currentUser, requireRole } from "../middleware/auth";
import { ticketUpload } from "../middleware/upload";
import { asyncHandler, validate } from "../middleware/validate";
import * as tickets from "../services/ticketService";

const router = Router();
router.use(authenticate());
const adminOnly = requireRole("admin");

const IdParams = z.object({ ticketId: z.coerce.number().int().positive() });
const ticketIdOf = (res: { locals: Record<string, unknown> }) => (res.locals.params as { ticketId: number }).ticketId;

const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) => s.split(",").map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)));

const ListQuery = z.object({
  status: csvEnum(TICKET_STATUSES).optional(),
  category: z.enum(CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignee: z
    .union([z.enum(["me", "unassigned"]), z.coerce.number().int().positive()])
    .optional(),
  authorId: z.string().optional(),
  bookId: z.string().optional(),
  from: z.string().date("from must be YYYY-MM-DD").optional(),
  to: z.string().date("to must be YYYY-MM-DD").optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(["urgency", "newest", "oldest", "updated"]).default("urgency"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** GET /api/tickets — role-scoped list with filters. */
router.get("/", validate(ListQuery, "query"), (req, res) => {
  const user = currentUser(req);
  const query = res.locals.query as z.infer<typeof ListQuery>;
  // Authors' default view is newest-first; urgency ordering is an ops concept.
  if (user.role === "author" && req.query.sort === undefined) query.sort = "newest";
  res.json(tickets.listTickets(user, query));
});

const CreateBody = z.object({
  bookId: z
    .string()
    .trim()
    .transform((v) => (v === "" || v === "general" ? null : v))
    .nullable()
    .default(null),
  subject: z.string().trim().min(5, "Subject must be at least 5 characters").max(150),
  description: z.string().trim().min(20, "Please describe the issue in at least 20 characters").max(5000),
});

/** POST /api/tickets — author raises a ticket (JSON or multipart with `attachments`). */
router.post(
  "/",
  requireRole("author"),
  ticketUpload,
  (req, _res, next) => {
    // Validation failed after multer stored files → don't leave orphans on disk.
    _res.on("finish", () => {
      if (_res.statusCode >= 400) for (const f of (req.files as Express.Multer.File[]) ?? []) fs.rm(f.path, () => {});
    });
    next();
  },
  validate(CreateBody),
  (req, res) => {
    const user = currentUser(req);
    const id = tickets.createTicket(user, res.locals.body, (req.files as Express.Multer.File[]) ?? []);
    // Classification runs in the background: the author gets an instant response, and the
    // admin queue updates over SSE when the AI (or the rules fallback) finishes.
    classifyInBackground(id);
    res.status(201).json({ data: tickets.getTicketDetail(user, id) });
  },
);

/** GET /api/tickets/:ticketId — detail incl. messages (+ notes, timeline, book for admins). */
router.get("/:ticketId", validate(IdParams, "params"), (req, res) => {
  res.json({ data: tickets.getTicketDetail(currentUser(req), ticketIdOf(res)) });
});

const PatchBody = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    category: z.enum(CATEGORIES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assignedAdminId: z.number().int().positive().nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Provide at least one field to update");

/** PATCH /api/tickets/:ticketId — admin: status, category/priority override, assignment. */
router.patch("/:ticketId", adminOnly, validate(IdParams, "params"), validate(PatchBody), (req, res) => {
  const id = ticketIdOf(res);
  tickets.updateTicket(currentUser(req), id, res.locals.body);
  res.json({ data: tickets.getTicketDetail(currentUser(req), id) });
});

const MessageBody = z.object({
  body: z.string().trim().min(1, "Message cannot be empty").max(10000),
  status: z.enum(TICKET_STATUSES).optional(),
  aiAssisted: z.boolean().optional(),
});

/**
 * POST /api/tickets/:ticketId/messages — admin reply (optionally with a status change) or
 * author follow-up. `status` is ignored for authors.
 */
router.post("/:ticketId/messages", validate(IdParams, "params"), validate(MessageBody), (req, res) => {
  const user = currentUser(req);
  const id = ticketIdOf(res);
  const { body, status, aiAssisted } = res.locals.body as z.infer<typeof MessageBody>;
  tickets.addMessage(user, id, body, user.role === "admin" ? { status, aiAssisted } : {});
  res.status(201).json({ data: tickets.getTicketDetail(user, id) });
});

/** POST /api/tickets/:ticketId/notes — admin-only internal note. */
router.post(
  "/:ticketId/notes",
  adminOnly,
  validate(IdParams, "params"),
  validate(z.object({ body: z.string().trim().min(1, "Note cannot be empty").max(5000) })),
  (req, res) => {
    const id = ticketIdOf(res);
    tickets.addNote(currentUser(req), id, (res.locals.body as { body: string }).body);
    res.status(201).json({ data: tickets.listNotes(id) });
  },
);

/** GET /api/tickets/:ticketId/draft — cached AI draft (generated on first open). */
router.get(
  "/:ticketId/draft",
  adminOnly,
  validate(IdParams, "params"),
  asyncHandler(async (_req, res) => {
    res.json({ data: await getDraft(ticketIdOf(res)) });
  }),
);

/** POST /api/tickets/:ticketId/draft — force a fresh draft. */
router.post(
  "/:ticketId/draft",
  adminOnly,
  validate(IdParams, "params"),
  asyncHandler(async (_req, res) => {
    res.json({ data: await getDraft(ticketIdOf(res), { regenerate: true }) });
  }),
);

/** POST /api/tickets/:ticketId/classification — re-run AI classification (keeps admin overrides). */
router.post(
  "/:ticketId/classification",
  adminOnly,
  validate(IdParams, "params"),
  asyncHandler(async (req, res) => {
    const id = ticketIdOf(res);
    tickets.getTicketRow(id);
    await classifyTicket(id);
    res.json({ data: tickets.getTicketDetail(currentUser(req), id) });
  }),
);

/** GET /api/tickets/:ticketId/attachments/:attachmentId — download (same access rules as the ticket). */
router.get(
  "/:ticketId/attachments/:attachmentId",
  validate(IdParams.extend({ attachmentId: z.coerce.number().int().positive() }), "params"),
  (req, res) => {
    const { ticketId, attachmentId } = res.locals.params as { ticketId: number; attachmentId: number };
    tickets.assertCanAccess(currentUser(req), tickets.getTicketRow(ticketId));
    const file = tickets.getAttachment(ticketId, attachmentId);
    res.type(file.mime_type);
    res.download(path.join(env.UPLOAD_DIR, path.basename(file.stored_name)), file.original_name);
  },
);

export default router;
