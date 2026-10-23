import type Anthropic from "@anthropic-ai/sdk";
import request from "supertest";
import { vi } from "vitest";
import { createApp } from "../src/app";
import { classifyPendingInBackground, waitForBackgroundWork } from "../src/ai/classifier";
import { resetBreaker, setAnthropic } from "../src/ai/client";
import { getDb } from "../src/db/connection";
import { seedDatabase } from "../src/db/seed";

export const app = createApp();

/** Reseeds and classifies the seed tickets with the rules fallback (AI "down"). */
export async function resetData() {
  seedDatabase(getDb(), { reset: true });
  resetBreaker();
  fakeAi().mockRejectedValue(new Error("connect ECONNREFUSED"));
  classifyPendingInBackground();
  await waitForBackgroundWork();
  resetBreaker();
}

/** Installs a fake Anthropic client whose `beta.messages.parse` is a vi.fn(). */
export function fakeAi() {
  const parse = vi.fn();
  setAnthropic({ beta: { messages: { parse } } } as unknown as Anthropic);
  return parse;
}

export const aiResponse = (parsed: unknown) => ({
  parsed_output: parsed,
  stop_reason: "end_turn",
  usage: { input_tokens: 500, output_tokens: 120, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 },
});

export async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return res.body.token;
}

export const asPriya = () => login("priya.sharma@email.com", "author123");
export const asAnanya = () => login("ananya.reddy@email.com", "author123");
export const asAdmin = () => login("admin@bookleaf.com", "admin123");
