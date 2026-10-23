# Approach note: BookLeaf Author Support Portal

**What I prioritised.** The brief puts AI integration and architecture at 50% of the score and says to favour the core ticket flow, so I built the full ticket lifecycle first. An author raises a ticket. It is classified and prioritised. An admin opens it with a grounded draft, edits and sends. The author sees the reply live. Then I invested in what makes the AI usable in production rather than a demo: grounding, structured output, degradation and cost control.

**How the AI is grounded.** I don't trust the model with business facts, so the server prepares them. The drafter gets the author's real figures as terse facts, only the knowledge-base sections for the ticket's category, and the worked example for that category. It also gets facts the server *computes*: the next payout date and whether a payout is overdue under the "quarterly + 45 days, ₹1,000 threshold" rule. LLMs are unreliable at date arithmetic. Computing "this payout is overdue, BookLeaf's fault" in code means the model can follow the tone guide ("own it, give a 48-hour timeline") instead of reasoning about dates. Outputs are schema-validated JSON, so the admin also gets an escalation flag, a suggested status and a checklist, not just text.

**Graceful degradation was a design constraint, not an afterthought.** A ticket is stored before any AI runs, and classification happens in the background. Failures go through SDK retries, then a circuit breaker, then deterministic fallbacks: a keyword classifier and policy templates that still fill in the author's real numbers. The UI always says where a value came from (AI, rules or manual), and admins can override anything without the AI overwriting their choice.

**Trade-offs.**
- *SQLite and one process* instead of Postgres and Redis: the demo boots seeded with no infrastructure. The schema is Postgres-portable, and the SSE hub is the one piece that needs pub/sub to scale out.
- *SSE instead of WebSockets*: updates only flow one way. Events carry ids only and clients refetch, so access control lives in one place.
- *Claude Opus 5.5 with tuned effort* (low for classification, medium for drafts) instead of a cheaper model: draft quality is what support staff feel. The model is one env var, and the override and usage data being logged is what I'd use to decide when to move classification to a cheaper model.
- *A static knowledge base in code* instead of a CMS or retrieval: the KB is small, and slicing it by category already keeps prompts lean.

**Evolving this into production.**
1. **Measure the AI**: build an eval set from real tickets (expected category and priority, plus a rubric for drafts). Use admin override rates and "sent as drafted vs. edited" (already tracked) as live quality signals. Gate prompt and model changes on the eval.
2. **Infrastructure**: Postgres, a job queue for AI work (retries, rate limiting, dead-letter queue), Redis pub/sub for SSE, object storage for attachments, structured logs and tracing.
3. **Product**: email notifications to authors, SLA dashboards per agent, canned macros next to AI drafts, vision on defect photos for printing tickets, and auto-resolution suggestions for purely informational queries, always with a human sending.
4. **Security**: httpOnly cookie sessions with refresh rotation, login throttling, audit export, and PII minimisation in prompts.
