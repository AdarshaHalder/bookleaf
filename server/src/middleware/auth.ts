import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { AuthUser, Role } from "../lib/domain";
import { forbidden, unauthorized } from "../lib/errors";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface TokenPayload {
  sub: string;
  role: Role;
  name: string;
  email: string;
  authorId: string | null;
}

export function signToken(user: AuthUser): string {
  const payload: TokenPayload = {
    sub: String(user.id),
    role: user.role,
    name: user.name,
    email: user.email,
    authorId: user.authorId,
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

function verify(token: string): AuthUser {
  try {
    const p = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    return { id: Number(p.sub), role: p.role, name: p.name, email: p.email, authorId: p.authorId };
  } catch {
    throw unauthorized("Invalid or expired token");
  }
}

/**
 * Requires a valid `Authorization: Bearer <jwt>` header.
 * `allowQueryToken` exists only for the SSE stream, because the browser EventSource API
 * cannot set headers.
 */
export function authenticate({ allowQueryToken = false } = {}) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    let token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token && allowQueryToken && typeof req.query.token === "string") token = req.query.token;
    if (!token) return next(unauthorized());
    try {
      req.user = verify(token);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** Narrowing helper for handlers mounted behind `authenticate()`. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
