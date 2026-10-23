import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/connection";
import type { Role } from "../lib/domain";
import { unauthorized } from "../lib/errors";
import { authenticate, currentUser, signToken } from "../middleware/auth";
import { validate } from "../middleware/validate";

const router = Router();

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  role: Role;
  author_id: string | null;
}

/** POST /api/auth/login → { token, user } */
router.post("/login", validate(LoginSchema), (_req, res) => {
  const { email, password } = res.locals.body as z.infer<typeof LoginSchema>;
  const row = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  // Same error for unknown email and wrong password, so accounts can't be enumerated.
  if (!row || !bcrypt.compareSync(password, row.password_hash)) throw unauthorized("Invalid email or password");
  const user = { id: row.id, role: row.role, name: row.name, email: row.email, authorId: row.author_id };
  res.json({ token: signToken(user), user });
});

/** GET /api/auth/me → the user encoded in the token */
router.get("/me", authenticate(), (req, res) => {
  res.json({ user: currentUser(req) });
});

export default router;
