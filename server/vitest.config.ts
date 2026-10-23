import os from "os";
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_PATH: ":memory:",
      UPLOAD_DIR: path.join(os.tmpdir(), "bookleaf-test-uploads"),
      JWT_SECRET: "test-secret-at-least-16-chars",
      // A dummy key so the AI path is exercised; tests always inject a fake client.
      OPENAI_API_KEY: "test-key",
      AI_MODEL: "gpt-4o-mini",
    },
    // Single shared in-memory database per file; keep files sequential for clarity.
    fileParallelism: false,
  },
});
