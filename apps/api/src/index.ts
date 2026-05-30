import { loadConfig } from "./config";
import { createDb, runMigrations } from "./db";
import { createRealtime } from "./realtime";
import { createApi } from "./server";
import { createStorage } from "./storage";

const config = loadConfig();
const db = createDb(config);
const storage = createStorage(config);
const runtime = { realtime: null as ReturnType<typeof createRealtime> | null };

await runMigrations(db);

const app = createApi(config, db, storage, runtime);

await app.listen({ port: config.PORT, host: "0.0.0.0" });
runtime.realtime = createRealtime(app.server, config, db);

const shutdown = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
