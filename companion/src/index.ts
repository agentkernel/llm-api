import { loadConfig } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await runMigrations();
  const app = await buildServer();
  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
