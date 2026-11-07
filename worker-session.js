import { openDb } from "./lib/db.js";
import { createStorage } from "./lib/storage.js";
import { workOnce } from "./lib/worker.js";

// Explicitly launched session: no Render API credentials or automatic billing.
const seconds = Number(process.env.WORKER_SESSION_SECONDS || 900);
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600)
  throw Error("WORKER_SESSION_SECONDS must be between 1 and 3600");
const db = await openDb();
if (db.embedded) {
  await db.close();
  throw Error(
    "Worker sessions require PostgreSQL; local mode already runs a worker",
  );
}
let stop = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stop = true;
  });
const deadline = Date.now() + seconds * 1000;
try {
  const storage = createStorage();
  while (!stop && Date.now() < deadline) {
    const worked = await workOnce({ db, storage });
    if (!worked) {
      const pending = await db.query(
        "SELECT 1 FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.state IN ('queued','polling','processing','submitting') AND COALESCE((p.document->>'paused')::boolean,false)=false AND COALESCE((p.document->>'archived')::boolean,false)=false LIMIT 1",
      );
      if (!pending.rows.length) break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
} finally {
  await db.close();
}
// Deadline stops claiming work; an already-running FFmpeg/provider call finishes
// gracefully. Remaining durable jobs resume on the next explicit session.
