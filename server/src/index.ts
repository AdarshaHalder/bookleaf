import "dotenv/config";
import { createApp } from "./app";
import { classifyPendingInBackground } from "./ai/classifier";
import { aiStatus } from "./ai/client";
import { env } from "./config/env";
import { getDb } from "./db/connection";
import { seedDatabase } from "./db/seed";

// Seed on first boot so a fresh deploy works out of the box with the sample dataset.
const { seeded } = seedDatabase(getDb());
if (seeded) console.log("Seeded database with BookLeaf sample data.");

const ai = aiStatus();
console.log(ai.configured ? `AI enabled (model: ${ai.model})` : "AI not configured — using rules/template fallbacks.");

const pending = classifyPendingInBackground();
if (pending) console.log(`Classifying ${pending} pending ticket(s) in the background.`);

createApp().listen(env.PORT, () => {
  console.log(`BookLeaf API listening on http://localhost:${env.PORT}`);
});
