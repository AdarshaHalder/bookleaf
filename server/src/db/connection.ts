import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { SCHEMA_SQL } from "./schema";

export type DB = Database.Database;

let instance: DB | null = null;

export function openDatabase(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

/** Process-wide connection. better-sqlite3 is synchronous, so one connection is enough. */
export function getDb(): DB {
  if (!instance) instance = openDatabase(env.DATABASE_PATH);
  return instance;
}

/** Used by tests to inject an in-memory database. */
export function setDb(db: DB): void {
  instance = db;
}
