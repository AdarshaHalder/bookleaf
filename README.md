# BookLeaf Author Support & Communication Portal

A support portal for BookLeaf Publishing with two interfaces:

- **Author portal**: authors sign in, see their books (sales and royalties), raise support queries with attachments, and follow their tickets. Replies appear live, with no page refresh.
- **Admin console**: the ops team works an urgency-sorted queue. Each ticket gets an **AI category and priority**, and each reply starts from an **AI-drafted response** grounded in the BookLeaf knowledge base and the author's real account data. Admins can override everything, add internal notes, assign tickets and change status.

When the AI is down, rate-limited or not configured, the app keeps working: tickets are still created, a keyword classifier takes over, and admins get a policy template filled with the author's real numbers. Either way, they can always write a reply by hand.

---

## Contents

1. [Quick start](#quick-start)
2. [Demo credentials](#demo-credentials)
3. [Architecture](#architecture)
4. [AI integration](#ai-integration)
5. [API reference](#api-reference)
6. [Testing](#testing)
7. [Deployment](#deployment)
8. [Known limitations & next steps](#known-limitations--next-steps)

See also [`docs/WRITEUP.md`](docs/WRITEUP.md) for the one-page approach note.

---

## Quick start

Requirements: Node.js 20+ (22 recommended).

```bash
npm run install:all                  # installs server/ and client/
cp server/.env.example server/.env   # optionally add ANTHROPIC_API_KEY

npm run dev:server   # API on http://localhost:4000 (seeds the DB on first boot)
npm run dev:client   # UI on  http://localhost:5173 (proxies /api to :4000)
```

Production-style single process (Express serves the built React app):

```bash
npm run build && npm start           # http://localhost:4000
```

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Server test suite (Vitest + Supertest, in-memory SQLite, mocked AI) |
| `npm run seed` | Wipe and reseed the database from `server/src/db/bookleaf_sample_data.json` |
| `AI_DISABLED=true npm run dev:server` | Simulate an AI outage to see the fallbacks |

No API key? Everything still works, using the rules classifier and template drafts. The queue header shows "AI off · rules & templates in use".

## Demo credentials

All 10 authors from the sample dataset can sign in with their dataset email and the password **`author123`**. The login page has one-click buttons for these.

| Role | Email | Password | Good for testing |
|---|---|---|---|
| Author | `priya.sharma@email.com` | `author123` | Two live books, partial payouts |
| Author | `ananya.reddy@email.com` | `author123` | Live since 2024, **never paid out** |
| Author | `sneha.kulkarni@email.com` | `author123` | Has a book **in production** (no MRP or sales) |
| Author | `kavita.deshmukh@email.com` | `author123` | One book in typesetting; ₹850 pending (**below the ₹1,000 threshold**) |
| Admin | `admin@bookleaf.com` | `admin123` | Aisha Verma, Support Lead |
| Admin | `ops@bookleaf.com` | `admin123` | Karan Mehta, Operations (to test assignment) |

The database is seeded with four realistic open tickets, so the queue isn't empty. On boot they go through the same classification pipeline as a new ticket.

---

## Architecture

```
client/  React 18 + Vite + TypeScript + React Router (SPA)
server/  Express 4 + TypeScript, SQLite (better-sqlite3), Zod, Anthropic SDK
  src/
    config/env.ts           typed, validated env (secrets only live here)
    db/                     schema, connection, seed (sample dataset + demo admins)
    middleware/             auth (JWT + RBAC), validation (Zod), uploads (multer), errors
    services/               business logic: tickets, books (all SQL lives here)
    ai/                     client wrapper (circuit breaker, usage log), classifier, drafter,
                            prompts, knowledge base, rules fallback, reply templates
    realtime/hub.ts         Server-Sent Events fan-out, scoped per user
    routes/                 thin HTTP layer: parse → call service → respond
```

**Key decisions**

| Decision | Why |
|---|---|
| **One deployable** (Express serves the built SPA) | One URL, no CORS in production, one service to run on Render, Railway or a VPS. |
| **SQLite** with a Postgres-portable schema | No database to provision, so the demo boots seeded from one file. CHECK constraints model the enums and nothing is SQLite-specific, so moving to Postgres is a driver swap. |
| **Layering: routes → services → db** | Routes only validate and translate HTTP. Services hold the rules: RBAC checks, status transitions, audit events. That keeps logic testable and in one place. |
| **Authors get 404, not 403**, for other authors' tickets and books | Ids can't be probed to discover what exists. |
| **Separate `internal_notes` table** | Notes never sit in the author-visible messages table, so a forgotten `WHERE` clause can't leak them. |
| **`*_source` columns** (`ai` / `fallback` / `admin`) on category and priority | The UI shows where each value came from, re-classification never overwrites an admin override, and override rates measure AI accuracy (`/api/admin/stats`). |
| **SSE instead of WebSockets** | Updates flow one way (server → browser), SSE is plain HTTP, and `EventSource` reconnects on its own. Events carry only `{type, ticketId}`. Clients refetch over REST, so RBAC is enforced in one place and no data leaks through the push channel. |
| **AI classification runs in the background** | The author's submit returns instantly. The admin queue updates over SSE seconds later. |
| **Audit trail** (`ticket_events`) | Status changes, overrides, assignments, AI/rules classification and replies appear as a timeline on each ticket. |
| **Response SLA per priority** (Critical 4h, High 24h, Medium 48h, Low 72h) | The queue flags overdue first responses in red. The default sort is unresolved → priority → oldest, so "most urgent and oldest" sits at the top. |

**Data model**

`authors` (dataset profile), `users` (credentials and role, linked to an author), `books` plus `book_platforms` (the normalised `available_on` array), `tickets`, `ticket_messages` (author-visible conversation), `internal_notes` (admin only), `ticket_attachments`, `ticket_events` (audit), and `ai_usage` (one row per model call: tokens, cache reads, latency, outcome). See `server/src/db/schema.ts`.

---

## AI integration

All AI code lives in `server/src/ai/`. The model is called only from the server, and the key is read from `ANTHROPIC_API_KEY` in `config/env.ts`. It is never sent to the browser or committed.

### 1. Classification (category + priority): `ai/classifier.ts`

- **Prompt**: a static system prompt with a definition for each category and a **priority rubric** with concrete examples ("royalties unpaid 6+ months → Critical", "update my bio → Low, even if marked URGENT").
- **Input**: only the subject, the description (clipped) and a one-line account hint, such as *"Book X is live since 2024-07-05; ₹2,546 pending; has never received a royalty payout"*. That hint lets the model rank "where's my royalty?" higher for an author who has genuinely never been paid.
- **Output**: structured outputs (`output_config.format` from a Zod schema via `client.beta.messages.parse`). The result is parsed and validated against the schema: no regex-scraping of JSON, and an invalid enum value is rejected and handled by the fallback.
- **Effort `low`**: this is a short classification task, so we don't pay for deep reasoning.
- Admins can override either field. Re-running classification never touches an overridden field.

### 2. Draft responses: `ai/drafter.ts`

The draft is grounded in three things:

1. **Knowledge base** (`ai/knowledgeBase.ts`): BookLeaf's policies split into sections. Each draft includes the company overview and tone guide, plus **only the sections relevant to the ticket's category** and that category's worked example from the brief (used as few-shot guidance).
2. **Account facts** (`ai/context.ts`): the ticket's book as terse `key: value` lines (sales, earned, paid, pending, last payout, platforms, print partner). For account-level tickets, one line per book.
3. **Computed policy facts** (`lib/royaltyCalendar.ts`): the next quarterly payout date and whether a payout is **overdue** under the "quarterly + 45 days, ₹1,000 threshold" rule. LLMs are unreliable at date arithmetic, so the server computes this and states it, e.g. *"this payout is OVERDUE, BookLeaf's fault"*. The tone guide then makes the model own it instead of deflecting.

The system prompt encodes the tone guidelines: acknowledge first, use real numbers, own BookLeaf's mistakes, give concrete timelines (48h escalation, 24–48h re-sync, 5–7 day reprint), and end with a clear next step. Hard rules: never invent numbers or policies, no markdown, fixed sign-off.

The draft comes back structured, so the admin sees more than text:
`reply`, `escalation {required, team, reason}`, `suggested_status`, `author_actions[]` and `admin_checklist[]`. The UI shows these above the editable reply box. The admin edits and sends; replies sent from a draft are flagged `aiAssisted`, so draft usefulness can be measured.

**Prompt-injection hygiene**: author text is wrapped in `<ticket>` / `<conversation>` tags, and the system prompt says to treat it as data, not instructions. Internal notes go in as context marked "never quote".

### 3. Error handling & graceful degradation

| Failure | What happens |
|---|---|
| No API key / `AI_DISABLED=true` | Rules classifier (`ai/rulesClassifier.ts`) and policy templates (`ai/templates.ts`) are used from the start. The UI says so. |
| Timeout, 429, 5xx, network error | The SDK retries twice with backoff (`maxRetries: 2`, `AI_TIMEOUT_MS` per attempt). Then we fall back. The ticket is **always** created, because classification runs after the insert, in the background. |
| Repeated failures | **Circuit breaker** (`ai/client.ts`): after 3 consecutive failures, AI calls stop for 60s and fallbacks are used immediately, so nobody waits on timeouts during an outage. |
| Model refusal / unparseable output | Treated as a failure, so the fallback is used. Requests also opt into the API's server-side refusal fallback (`fallbacks: "default"`). |
| Fallback classification | Marked `classification_status = 'fallback'` and tagged **RULES** in the UI. Admins can click *Re-run* once AI is back. |
| Template draft | Tagged **Template draft** with a warning banner. It still includes the author's name, book, real ₹ figures, payout dates and the correct policy timelines, so it's usable with light edits. It is regenerated automatically once AI is available again. |

Every call, successful or not, is logged to `ai_usage` with its tokens, cache reads, latency and error class.

### 4. Cost awareness

- **The KB is sliced by category**: each draft carries only the policy sections relevant to its category (plus the always-needed tone guide), not the whole KB. Classification sends no KB at all.
- **History is capped**: the last 6 messages, each clipped to 1,500 characters, with a marker saying how many earlier messages were left out. Internal notes are capped at 3.
- **Account data is pre-formatted** as compact facts, never raw JSON rows.
- **Drafts are cached on the ticket** and reused until the conversation or category changes. Opening a ticket ten times costs one call. Concurrent requests for the same ticket are de-duplicated.
- **Drafts are only auto-generated when the author is waiting on BookLeaf.** After an admin replies, drafting is on demand ("✨ Draft with AI").
- **Effort per task**: `low` for classification, `medium` for drafts.
- **Prompt caching**: the system prompt and the category KB are separate, fully static blocks with `cache_control`, so drafts in the same category share a cached prefix. Note: prompts below the model's minimum cacheable length are silently not cached. `cache_read_tokens` in `ai_usage` shows whether caching is actually happening.
- **Observability**: `GET /api/admin/stats` returns call counts, success rates, input/output/cache tokens and average latency per operation, plus admin override counts (a proxy for classification accuracy).

### 5. Model choice

Default: **Claude Opus 5.5** (`claude-opus-5-5`), via the official Anthropic TypeScript SDK.

- Draft quality is the highest-weighted part of this system: tone, policy accuracy, and using the numbers correctly. A strong model gets the empathetic-but-specific BookLeaf voice right with little prompt tuning.
- The **effort** setting is the main cost lever: classification runs at `low`, drafts at `medium`, so the stronger model is only paid for where it matters.
- **Structured outputs** remove a whole class of parsing failures.
- The model is configurable via `AI_MODEL`. For production I'd measure moving classification to **Claude Haiku 5.5** (much cheaper per token) against the admin-override rate, keeping the stronger model for drafts. That split is a one-line change per operation.

---

## API reference

Base URL: `/api`. All requests and responses are JSON (except ticket creation with files, which is `multipart/form-data`).

**Auth**: `Authorization: Bearer <jwt>` on every route except `POST /auth/login` and `GET /health`. Tokens expire after 12h.

**Errors** use one consistent envelope:

```json
{ "error": { "code": "BAD_REQUEST", "message": "Request validation failed",
             "details": [{ "field": "subject", "message": "Subject must be at least 5 characters" }] } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `BAD_REQUEST`, `INVALID_JSON`, `UPLOAD_ERROR` | Validation failure (with per-field `details`), malformed JSON, bad file |
| 401 | `UNAUTHORIZED` | Missing, invalid or expired token; wrong credentials |
| 403 | `FORBIDDEN` | Authenticated but wrong role (e.g. author calling an admin route) |
| 404 | `NOT_FOUND` | Unknown resource, or a resource that belongs to another author |
| 409 | `CONFLICT` | Replying to a closed ticket |
| 500 | `INTERNAL_ERROR` | Unexpected; details are logged server-side, never leaked |

### Auth

| Method & path | Access | Description |
|---|---|---|
| `POST /auth/login` | public | Body `{ email, password }` → `{ token, user }`. Same error for unknown email and wrong password. |
| `GET /auth/me` | any | → `{ user: { id, role, name, email, authorId } }` |

### Books & authors

| Method & path | Access | Description |
|---|---|---|
| `GET /books` | author, admin | Authors: their own books. Admins: all books, optional `?authorId=`. → `{ data: Book[], summary: { totalBooks, publishedBooks, totalCopiesSold, totalRoyaltyEarned, totalRoyaltyPaid, totalRoyaltyPending } }` |
| `GET /books/:bookId` | owner, admin | → `{ data: Book }`. 404 for other authors' books. |
| `GET /authors` | admin | Author directory with `book_count` and `open_tickets`. |
| `GET /authors/:authorId` | self, admin | Profile plus books and summary. |

`Book` has: `id, authorId, title, isbn, genre, status, isPublished, publication_date, mrp, author_royalty_per_copy, total_copies_sold, total_royalty_earned, royalty_paid, royalty_pending, last_royalty_payout_date, print_partner, platforms[]`.

### Tickets

| Method & path | Access | Description |
|---|---|---|
| `GET /tickets` | author, admin | Role-scoped list. Query: `status` (comma list of `Open,In Progress,Resolved,Closed`), `category`, `priority`, `assignee` (`me` \| `unassigned` \| admin id), `authorId`, `bookId`, `from` / `to` (`YYYY-MM-DD`), `q` (subject, author name or `#id`), `sort` (`urgency` default for admins \| `newest` default for authors \| `oldest` \| `updated`), `page`, `pageSize` (≤100). → `{ data, page, pageSize, total }` |
| `POST /tickets` | author | Create. JSON or multipart: `bookId` (book id, or `""` / `"general"` for account-level), `subject` (5–150), `description` (20–5000), `attachments` (≤3 files, images/PDF, 5 MB each). → `201 { data: TicketDetail }`. Classification runs in the background. |
| `GET /tickets/:id` | owner, admin | → `{ data: { ticket, messages, attachments } }`. Admins also get `notes`, `events` (timeline) and `book`. |
| `PATCH /tickets/:id` | admin | Any of `{ status, category, priority, assignedAdminId (number \| null) }`. Category and priority changes are recorded as admin overrides. |
| `POST /tickets/:id/messages` | owner, admin | `{ body, status?, aiAssisted? }`. Admin: replies, sets first-response time, auto-assigns if unassigned, moves `Open` to `In Progress` (or to the given `status`). Author: a follow-up; replying to a `Resolved` ticket reopens it. 409 on `Closed`. |
| `POST /tickets/:id/notes` | admin | `{ body }`. Internal note, never visible to authors. |
| `GET /tickets/:id/draft` | admin | AI draft (cached). → `{ data: { body, source: "ai" \| "template", generatedAt, cached, meta: { escalation, suggestedStatus, authorActions, adminChecklist, fallbackReason? } } }` |
| `POST /tickets/:id/draft` | admin | Force regeneration. |
| `POST /tickets/:id/classification` | admin | Re-run AI classification (keeps admin overrides). |
| `GET /tickets/:id/attachments/:attachmentId` | owner, admin | Download a file. |

Ticket fields visible to **authors**: `id, bookId, bookTitle, subject, description, status, category, messageCount, lastMessageAt, hasNewReply, createdAt, updatedAt`. **Admins** also see `authorId, authorName, priority, prioritySource, categorySource, aiReasoning, classificationStatus, assignedAdmin, awaitingReply, firstResponseAt, resolvedAt, responseDueAt, isOverdue`.

### Admin

| Method & path | Access | Description |
|---|---|---|
| `GET /admin/users` | admin | Admins available for assignment. |
| `GET /admin/stats` | admin | `byStatus`, `openByPriority`, `overdue` count, and `ai: { status, usage (per operation: calls, ok, tokens, cache reads, latency), overrides }`. |

### Real-time

| Method & path | Access | Description |
|---|---|---|
| `GET /events?token=<jwt>` | any | Server-Sent Events stream. `EventSource` can't set headers, so this one endpoint accepts the token as a query parameter. Emits `event: ticket` with `data: { type, ticketId }`, where `type` is `ticket.created`, `ticket.updated`, `ticket.message` or `ticket.note`. Admins receive all events. Authors receive only events for their own tickets, and never note or classification events. 25s heartbeat. |
| `GET /health` | public | `{ status, ai: { configured, circuitOpen } }` |

Example:

```bash
TOKEN=$(curl -s localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ananya.reddy@email.com","password":"author123"}' | jq -r .token)

curl -s localhost:4000/api/tickets -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"bookId":"BK005","subject":"Royalty not received","description":"My book has been live since July 2024 but I have never received a payout."}'
```

---

## Testing

```bash
npm test
```

`server/tests/api.test.ts` runs the real Express app against an in-memory SQLite database with an **injected fake Anthropic client**. Nothing hits the network. It covers:

- login, generic credential errors, field-level validation errors, 401 on every protected route
- RBAC: authors only see their own books and tickets (404 for others), admin-only actions return 403, internal notes never reach the author
- ticket lifecycle: create → classify → reply (auto In Progress plus assignment) → resolve → author follow-up reopens → closed rejects replies
- urgency sort and filters, books in production, the ₹1,000 threshold case
- AI path: classification uses structured output at low effort with account context; drafts send only the category's KB, flag overdue payouts, and are cached until the conversation changes
- degradation: AI down → rules classification and template drafts with real numbers; circuit breaker opens after repeated failures and stops calling the API
- rules classifier: ISBN errors vs routine metadata edits

The UI was checked end to end in headless Chromium: author submits → admin sees the classified ticket, draft and notes → admin replies → the author's open page shows the reply live.

---

## Deployment

The repo includes a `Dockerfile` (one image: API plus built SPA) and a Render Blueprint (`render.yaml`, with a persistent disk for SQLite and uploads).

**Render**: New → Blueprint → select this repo → set `ANTHROPIC_API_KEY` → deploy. `JWT_SECRET` is generated automatically. The database seeds itself on first boot.

**Any Docker host**:

```bash
docker build -t bookleaf .
docker run -p 4000:4000 -v bookleaf-data:/data \
  -e JWT_SECRET=$(openssl rand -hex 32) -e ANTHROPIC_API_KEY=sk-ant-... bookleaf
```

Environment variables are documented in `server/.env.example`. In production the server refuses to start with the development `JWT_SECRET`.

---

## Known limitations & next steps

- **SQLite, single instance.** Fine for a demo and modest load. For production: Postgres (the schema ports directly), plus Redis pub/sub so SSE fan-out works across multiple instances.
- **Background AI work is in-process.** A crash mid-classification is recovered on boot (pending tickets are re-classified), but a real job queue (BullMQ or SQS) would add retries, visibility and rate control.
- **Auth is basic**: email/password JWT stored in `localStorage`, with no refresh tokens, password reset or rate limiting on login. Next: httpOnly cookies, refresh rotation and login throttling.
- **Attachments** are stored on local disk and not sent to the AI. Next: object storage (S3), virus scanning, and letting the drafter see defect photos via vision for printing-quality tickets.
- **The knowledge base is static code.** At scale it would live in a CMS that ops can edit, with retrieval over a larger corpus (past resolved tickets as examples).
- **No live AI evaluation yet.** The AI paths are tested with a mocked client. Next: an eval set of real tickets with expected category and priority, plus a rubric for drafts, run before any prompt or model change. The `aiAssisted` and override data already being collected would seed it.
- **Notifications**: authors are only notified in-app. Email notification on admin replies is the obvious next step.
