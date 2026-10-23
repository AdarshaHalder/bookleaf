import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { waitForBackgroundWork } from "../src/ai/classifier";
import { getDb } from "../src/db/connection";
import { aiResponse, app, asAdmin, asAnanya, asPriya, fakeAi, resetData } from "./helpers";

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeEach(async () => {
  await resetData();
  // Default: AI is "down" — every call rejects, exercising the fallback paths.
  fakeAi().mockRejectedValue(new Error("connect ECONNREFUSED"));
});

describe("auth", () => {
  it("logs in a seeded author and rejects bad credentials with one generic message", async () => {
    const ok = await request(app).post("/api/auth/login").send({ email: "Priya.Sharma@email.com", password: "author123" });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ role: "author", authorId: "AUTH001" });

    const bad = await request(app).post("/api/auth/login").send({ email: "priya.sharma@email.com", password: "nope" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toBe("Invalid email or password");
  });

  it("returns field-level validation errors", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(["email", "password"]);
  });

  it("protects every route", async () => {
    for (const path of ["/api/books", "/api/tickets", "/api/admin/stats"]) {
      expect((await request(app).get(path)).status).toBe(401);
    }
    expect((await request(app).get("/api/books").set(auth("garbage"))).status).toBe(401);
  });
});

describe("books", () => {
  it("shows an author only their own books with totals", async () => {
    const res = await request(app).get("/api/books").set(auth(await asPriya()));
    expect(res.body.data.map((b: { id: string }) => b.id).sort()).toEqual(["BK001", "BK002"]);
    expect(res.body.summary).toMatchObject({ totalRoyaltyPending: 3570, totalCopiesSold: 531 });
  });

  it("hides other authors' books (404, not 403)", async () => {
    const res = await request(app).get("/api/books/BK003").set(auth(await asPriya()));
    expect(res.status).toBe(404);
  });

  it("handles books still in production", async () => {
    const token = await login("sneha.kulkarni@email.com");
    const res = await request(app).get("/api/books/BK013").set(auth(token));
    expect(res.body.data).toMatchObject({ isPublished: false, mrp: null, platforms: [] });
  });
});

async function login(email: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password: "author123" });
  return res.body.token as string;
}

describe("ticket lifecycle", () => {
  it("creates a ticket even when the AI is down, classifying it with rules", async () => {
    const token = await asAnanya();
    const res = await request(app)
      .post("/api/tickets")
      .set(auth(token))
      .send({ bookId: "BK005", subject: "No royalty received", description: "I have not received any royalty payment for 6 months now." });
    expect(res.status).toBe(201);
    const id = res.body.data.ticket.id;
    expect(res.body.data.ticket.priority).toBeUndefined(); // authors never see priority

    await waitForBackgroundWork();
    const detail = await request(app).get(`/api/tickets/${id}`).set(auth(await asAdmin()));
    expect(detail.body.data.ticket).toMatchObject({
      category: "Royalty & Payments",
      categorySource: "fallback",
      priority: "High",
      classificationStatus: "fallback",
    });
    const usage = getDb().prepare("SELECT success, error FROM ai_usage WHERE ticket_id = ?").get(id);
    expect(usage).toMatchObject({ success: 0 });
  });

  it("uses the AI classification when available", async () => {
    const parse = fakeAi();
    parse.mockResolvedValue(
      aiResponse({ category: "ISBN & Metadata Issues", priority: "Critical", reasoning: "Live book has the wrong ISBN." }),
    );
    const res = await request(app)
      .post("/api/tickets")
      .set(auth(await asPriya()))
      .send({ bookId: "BK001", subject: "Wrong ISBN on Amazon", description: "Amazon shows a different ISBN than my printed copy." });
    await waitForBackgroundWork();

    const call = parse.mock.calls[0][0];
    expect(call.output_config.effort).toBe("low");
    expect(call.messages[0].content).toContain("<ticket>");
    expect(call.messages[0].content).toContain("Whispers of the Ganges");

    const detail = await request(app).get(`/api/tickets/${res.body.data.ticket.id}`).set(auth(await asAdmin()));
    expect(detail.body.data.ticket).toMatchObject({ category: "ISBN & Metadata Issues", priority: "Critical", categorySource: "ai" });
  });

  it("rejects a book that belongs to someone else", async () => {
    const res = await request(app)
      .post("/api/tickets")
      .set(auth(await asPriya()))
      .send({ bookId: "BK005", subject: "Hello there", description: "This is not my book but let me try anyway." });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe("bookId");
  });

  it("scopes ticket lists and details by author", async () => {
    const ananya = await asAnanya();
    const list = await request(app).get("/api/tickets").set(auth(ananya));
    expect(list.body.data.every((t: { bookTitle: string }) => t.bookTitle === "Between Two Temples")).toBe(true);

    const priyaTicket = getDb().prepare("SELECT id FROM tickets WHERE author_id = 'AUTH001'").get() as { id: number };
    expect((await request(app).get(`/api/tickets/${priyaTicket.id}`).set(auth(ananya))).status).toBe(404);
  });

  it("lets admins reply; authors see the reply but never internal notes", async () => {
    const admin = await asAdmin();
    const { id } = getDb().prepare("SELECT id FROM tickets WHERE author_id = 'AUTH003'").get() as { id: number };

    await request(app).post(`/api/tickets/${id}/notes`).set(auth(admin)).send({ body: "Finance confirmed a bank detail mismatch." }).expect(201);
    const reply = await request(app)
      .post(`/api/tickets/${id}/messages`)
      .set(auth(admin))
      .send({ body: "Hi Ananya, we're on it.", aiAssisted: true });
    expect(reply.status).toBe(201);
    expect(reply.body.data.ticket.status).toBe("In Progress");
    expect(reply.body.data.ticket.assignedAdmin.name).toMatch(/Aisha/);

    const authorView = await request(app).get(`/api/tickets/${id}`).set(auth(await asAnanya()));
    expect(authorView.body.data.messages.at(-1).body).toBe("Hi Ananya, we're on it.");
    expect(authorView.body.data.notes).toBeUndefined();
    expect(JSON.stringify(authorView.body)).not.toContain("bank detail mismatch");
  });

  it("enforces admin-only actions", async () => {
    const priya = await asPriya();
    const { id } = getDb().prepare("SELECT id FROM tickets WHERE author_id = 'AUTH001'").get() as { id: number };
    expect((await request(app).patch(`/api/tickets/${id}`).set(auth(priya)).send({ status: "Closed" })).status).toBe(403);
    expect((await request(app).get(`/api/tickets/${id}/draft`).set(auth(priya))).status).toBe(403);
    expect((await request(app).get("/api/admin/stats").set(auth(priya))).status).toBe(403);
  });

  it("keeps admin overrides when classification is re-run", async () => {
    const admin = await asAdmin();
    const { id } = getDb().prepare("SELECT id FROM tickets WHERE author_id = 'AUTH001'").get() as { id: number };
    await request(app).patch(`/api/tickets/${id}`).set(auth(admin)).send({ priority: "High" }).expect(200);
    const res = await request(app).post(`/api/tickets/${id}/classification`).set(auth(admin));
    expect(res.body.data.ticket).toMatchObject({ priority: "High", prioritySource: "admin" });
    expect(res.body.data.events.map((e: { type: string }) => e.type)).toContain("priority_overridden");
  });

  it("reopens a resolved ticket when the author follows up, and blocks replies on closed tickets", async () => {
    const admin = await asAdmin();
    const priya = await asPriya();
    const { id } = getDb().prepare("SELECT id FROM tickets WHERE author_id = 'AUTH001'").get() as { id: number };
    await request(app).patch(`/api/tickets/${id}`).set(auth(admin)).send({ status: "Resolved" }).expect(200);
    const follow = await request(app).post(`/api/tickets/${id}/messages`).set(auth(priya)).send({ body: "One more thing…" });
    expect(follow.body.data.ticket.status).toBe("Open");

    await request(app).patch(`/api/tickets/${id}`).set(auth(admin)).send({ status: "Closed" }).expect(200);
    expect((await request(app).post(`/api/tickets/${id}/messages`).set(auth(priya)).send({ body: "hi" })).status).toBe(409);
  });

  it("sorts the admin queue by urgency and supports filters", async () => {
    const admin = await asAdmin();
    const res = await request(app).get("/api/tickets").set(auth(admin));
    expect(res.body.data.map((t: { priority: string }) => t.priority)).toEqual(["High", "High", "Medium", "Low"]);
    // The two High tickets: oldest first.
    expect(res.body.data[0].authorName).toBe("Ananya Reddy");
    expect(res.body.data[0].isOverdue).toBe(true);

    const filtered = await request(app).get("/api/tickets?priority=Low&status=Open,In%20Progress").set(auth(admin));
    expect(filtered.body.total).toBe(1);
    const invalid = await request(app).get("/api/tickets?status=Pending").set(auth(admin));
    expect(invalid.status).toBe(400);
  });
});

describe("AI drafts", () => {
  const ticketFor = (authorId: string) =>
    (getDb().prepare("SELECT id FROM tickets WHERE author_id = ?").get(authorId) as { id: number }).id;

  it("falls back to a policy template filled with the author's real numbers", async () => {
    const res = await request(app).get(`/api/tickets/${ticketFor("AUTH003")}/draft`).set(auth(await asAdmin()));
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe("template");
    expect(res.body.data.body).toContain("Hi Ananya");
    expect(res.body.data.body).toContain("₹2,546");
    expect(res.body.data.body).toContain("48 hours");
  });

  it("sends only the category's KB and caches the draft until the conversation changes", async () => {
    const parse = fakeAi();
    parse.mockResolvedValue(
      aiResponse({
        reply: "Hi Ananya,\n\nI'm sorry…\n\nWarm regards,\nBookLeaf Author Support",
        escalation: { required: true, team: "Finance", reason: "Payout overdue" },
        suggested_status: "In Progress",
        author_actions: ["Confirm bank details"],
        admin_checklist: ["Ping finance"],
      }),
    );
    const admin = await asAdmin();
    const id = ticketFor("AUTH003");

    const first = await request(app).get(`/api/tickets/${id}/draft`).set(auth(admin));
    expect(first.body.data).toMatchObject({ source: "ai", cached: false, meta: { escalation: { team: "Finance" } } });

    const call = parse.mock.calls[0][0];
    const kb = call.system[1].text as string;
    expect(kb).toContain("Royalty policy");
    expect(kb).not.toContain("Printing & quality");
    expect(call.messages[0].content).toContain("OVERDUE");

    const second = await request(app).get(`/api/tickets/${id}/draft`).set(auth(admin));
    expect(second.body.data.cached).toBe(true);
    expect(parse).toHaveBeenCalledTimes(1);

    await request(app).post(`/api/tickets/${id}/messages`).set(auth(await asAnanya())).send({ body: "Any update?" });
    await request(app).get(`/api/tickets/${id}/draft`).set(auth(admin));
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("opens the circuit after repeated failures and stops calling the API", async () => {
    const parse = fakeAi();
    parse.mockRejectedValue(new Error("overloaded"));
    const admin = await asAdmin();
    for (const author of ["AUTH001", "AUTH002", "AUTH003"]) {
      await request(app).post(`/api/tickets/${ticketFor(author)}/draft`).set(auth(admin));
    }
    expect(parse).toHaveBeenCalledTimes(3);
    const res = await request(app).post(`/api/tickets/${ticketFor("AUTH009")}/draft`).set(auth(admin));
    expect(res.body.data.source).toBe("template");
    expect(parse).toHaveBeenCalledTimes(3);

    const stats = await request(app).get("/api/admin/stats").set(auth(admin));
    expect(stats.body.data.ai.status.circuitOpen).toBe(true);
  });
});

describe("rules fallback classifier", () => {
  it("separates ISBN errors from routine metadata edits", async () => {
    const { classifyWithRules } = await import("../src/ai/rulesClassifier");
    expect(classifyWithRules("Wrong ISBN", "Amazon shows a different ISBN than my book")).toMatchObject({
      category: "ISBN & Metadata Issues",
      priority: "High",
    });
    expect(classifyWithRules("Bio", "How do I update my author bio?")).toMatchObject({ priority: "Low" });
  });
});
