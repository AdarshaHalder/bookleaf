import { Router } from "express";
import { aiStatus } from "../ai/client";
import { getDb } from "../db/connection";
import { RESPONSE_SLA_HOURS } from "../lib/domain";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();
router.use(authenticate(), requireRole("admin"));

/** GET /api/admin/users — admins available for assignment. */
router.get("/users", (_req, res) => {
  res.json({ data: getDb().prepare("SELECT id, name, email FROM users WHERE role = 'admin' ORDER BY name").all() });
});

/** GET /api/admin/stats — queue health + AI cost/reliability for the dashboard header. */
router.get("/stats", (_req, res) => {
  const db = getDb();
  const byStatus = db.prepare("SELECT status, COUNT(*) AS n FROM tickets GROUP BY status").all() as Array<{ status: string; n: number }>;
  const byPriority = db
    .prepare("SELECT priority, COUNT(*) AS n FROM tickets WHERE status IN ('Open','In Progress') GROUP BY priority")
    .all() as Array<{ priority: string | null; n: number }>;

  const slaCase = Object.entries(RESPONSE_SLA_HOURS)
    .map(([p, h]) => `WHEN '${p}' THEN ${h}`)
    .join(" ");
  const { overdue } = db
    .prepare(
      `SELECT COUNT(*) AS overdue FROM tickets
       WHERE status IN ('Open','In Progress') AND first_response_at IS NULL
         AND julianday('now') - julianday(created_at) > (CASE priority ${slaCase} ELSE 48 END) / 24.0`,
    )
    .get() as { overdue: number };

  const ai = db
    .prepare(
      `SELECT operation, COUNT(*) AS calls, SUM(success) AS ok,
         COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(output_tokens),0) AS outputTokens,
         COALESCE(SUM(cache_read_tokens),0) AS cacheReadTokens, CAST(AVG(latency_ms) AS INTEGER) AS avgLatencyMs
       FROM ai_usage GROUP BY operation`,
    )
    .all();
  const accuracy = db
    .prepare(
      `SELECT COUNT(*) AS aiClassified,
         SUM(CASE WHEN category_source = 'admin' THEN 1 ELSE 0 END) AS categoryOverrides,
         SUM(CASE WHEN priority_source = 'admin' THEN 1 ELSE 0 END) AS priorityOverrides
       FROM tickets WHERE ai_reasoning IS NOT NULL`,
    )
    .get();

  res.json({
    data: {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
      openByPriority: Object.fromEntries(byPriority.map((r) => [r.priority ?? "Unclassified", r.n])),
      overdue,
      ai: { status: aiStatus(), usage: ai, overrides: accuracy },
    },
  });
});

export default router;
