import fs from "fs";
import path from "path";
import cors from "cors";
import express from "express";
import { aiStatus } from "./ai/client";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import adminRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import bookRoutes from "./routes/books";
import eventRoutes from "./routes/events";
import ticketRoutes from "./routes/tickets";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()) }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", ai: { configured: aiStatus().configured, circuitOpen: aiStatus().circuitOpen } });
  });
  app.use("/api/auth", authRoutes);
  app.use("/api/tickets", ticketRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/events", eventRoutes);
  app.use("/api", bookRoutes);
  app.use("/api", notFoundHandler);

  // In production the API also serves the built React app (single deployable unit).
  const clientDist = path.resolve(__dirname, "../../client/dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
    app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
