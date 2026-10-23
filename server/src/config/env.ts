import path from "path";
import { z } from "zod";

/**
 * All runtime configuration is read from environment variables exactly once, validated,
 * and exported as a typed object. Secrets (JWT_SECRET, OPENAI_API_KEY) never leave the
 * server process — the client bundle has no access to them.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_PATH: z.string().default(path.resolve(__dirname, "../../data/bookleaf.db")),
  UPLOAD_DIR: z.string().default(path.resolve(__dirname, "../../data/uploads")),
  JWT_SECRET: z.string().min(16).default("dev-only-secret-change-me-in-production"),
  JWT_EXPIRES_IN: z.string().default("12h"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  // AI — the key is optional so the app still runs (with rules-based fallbacks) without one.
  OPENAI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AI_DISABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.issues);
  process.exit(1);
}

export const env = parsed.data;

if (env.NODE_ENV === "production" && env.JWT_SECRET.startsWith("dev-only")) {
  console.error("JWT_SECRET must be set in production.");
  process.exit(1);
}
