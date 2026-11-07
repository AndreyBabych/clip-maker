import { openDb } from "./lib/db.js";
import { createStorage } from "./lib/storage.js";
import { createApp } from "./lib/app.js";
import { startWorker } from "./lib/worker.js";
const db = await openDb(),
  storage = createStorage(),
  app = await createApp({ db, storage });
const worker = db.embedded ? startWorker({ db, storage }) : null;
const server = app.listen(
  Number(process.env.PORT) || 3000,
  process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1",
  () =>
    console.log(
      "Clip Maker is listening on port " + (process.env.PORT || 3000),
    ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    server.close();
    await worker?.stop();
    await db.close();
    process.exit(0);
  });
