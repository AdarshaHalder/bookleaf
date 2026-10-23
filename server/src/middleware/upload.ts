import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import { env } from "../config/env";
import { badRequest } from "../lib/errors";

/** Ticket attachments: images and PDFs only, 5 MB each, max 3 per ticket. */
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);
export const MAX_FILES = 3;

fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

export const ticketUpload = multer({
  storage: multer.diskStorage({
    destination: env.UPLOAD_DIR,
    // Random stored name: never trust the client's filename on disk.
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase().slice(0, 8)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_FILES },
  fileFilter: (_req, file, cb) =>
    ALLOWED.has(file.mimetype) ? cb(null, true) : cb(badRequest(`Unsupported file type: ${file.mimetype}. Use images or PDF.`)),
}).array("attachments", MAX_FILES);
