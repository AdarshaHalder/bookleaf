import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { z } from "zod";
import { badRequest } from "../lib/errors";

type Source = "body" | "query" | "params";

/**
 * Validates and coerces a request part against a zod schema. The parsed value is stored on
 * `res.locals[source]` so handlers read typed data rather than the raw request.
 */
export function validate(schema: z.ZodType, source: Source = "body"): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join(".") || source,
        message: i.message,
      }));
      return next(badRequest("Request validation failed", details));
    }
    res.locals[source] = result.data;
    next();
  };
}

/** Express 4 does not forward rejected promises to the error handler; this does. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
