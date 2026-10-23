import type OpenAI from "openai";
import request from "supertest";
import { vi } from "vitest";
import { createApp } from "../src/app";
import { classifyPendingInBackground, waitForBackgroundWork } from "../src/ai/classifier";
import { resetBreaker, setOpenAI } from "../src/ai/client";
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

/** Installs a fake OpenAI client whose `chat.completions.parse` is a vi.fn(). */
export function fakeAi() {
  const parse = vi.fn();
  setOpenAI({ chat: { completions: { parse } } } as unknown as OpenAI);
  return parse;
}

export const aiResponse = (parsed: unknown) => ({
  choices: [{ finish_reason: "stop", message: { parsed, refusal: null } }],
  usage: { prompt_tokens: 500, completion_tokens: 120, prompt_tokens_details: { cached_tokens: 400 } },
});

export async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return res.body.token;
}

export const asPriya = () => login("priya.sharma@email.com", "author123");
export const asAnanya = () => login("ananya.reddy@email.com", "author123");
export const asAdmin = () => login("admin@bookleaf.com", "admin123");
