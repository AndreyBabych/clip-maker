import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile, mkdir } from "node:fs/promises";
export async function openDb(env = process.env) {
  let db;
  if (env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
    db = {
      query: (...args) => pool.query(...args),
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const r = await fn(c);
          await c.query("COMMIT");
          return r;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    if (env.NODE_ENV === "production" || !env.LOCAL_DATA_DIR)
      throw Error("DATABASE_URL required");
    await mkdir(env.LOCAL_DATA_DIR, { recursive: true });
    const p = new PGlite(env.LOCAL_DATA_DIR + "/db");
    let tail = Promise.resolve();
    const serial = (fn) => {
      const r = tail.then(fn);
      tail = r.catch(() => {});
      return r;
    };
    db = {
      query: (...args) => serial(() => p.query(...args)),
      transaction: (fn) => serial(() => p.transaction(fn)),
      close: () => p.close(),
      embedded: true,
    };
  }
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY)",
  );
  for (const name of (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.transaction(async (c) => {
      await c.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
      if (
        (await c.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]))
          .rows.length
      )
        return;
      const sql = await readFile(
        new URL("../migrations/" + name, import.meta.url),
        "utf8",
      );
      for (const statement of sql.split(";").filter((s) => s.trim()))
        await c.query(statement);
      await c.query("INSERT INTO schema_migrations VALUES($1)", [name]);
    });
  return db;
}
