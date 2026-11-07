import { openDb } from "./lib/db.js";
import { createStorage } from "./lib/storage.js";
import { startWorker } from "./lib/worker.js";
const db = await openDb();
if (db.embedded)
  throw Error("Embedded database uses the local launcher worker");
const worker = startWorker({ db, storage: createStorage() });
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await worker.stop();
    await db.close();
    process.exit(0);
  });
