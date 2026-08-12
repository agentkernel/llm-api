import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "./pool.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function runMigrations(): Promise<string[]> {
  const pool = getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    const { rowCount } = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
    if (rowCount) continue;
    const sql = await readFile(join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  runMigrations()
    .then((applied) => {
      console.log(applied.length ? `applied: ${applied.join(", ")}` : "already up to date");
      return closePool();
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
      return closePool();
    });
}
