import { projectSchema, fail } from "../domain.js";
export async function project(db, id, lock = false) {
  const r = await db.query(
    "SELECT * FROM projects WHERE id=$1" + (lock ? " FOR UPDATE" : ""),
    [id],
  );
  if (!r.rows[0]) fail("Project not found", 404);
  return { ...r.rows[0], document: projectSchema.parse(r.rows[0].document) };
}
export async function saveProject(db, p, document) {
  await db.query(
    "INSERT INTO project_history(project_id,revision,document) VALUES($1,$2,$3)",
    [p.id, p.revision, JSON.stringify(p.document)],
  );
  return (
    await db.query(
      "UPDATE projects SET document=$1,revision=revision+1,updated_at=now() WHERE id=$2 RETURNING *",
      [JSON.stringify(document), p.id],
    )
  ).rows[0];
}
export async function assetsFor(db, id) {
  return (
    await db.query(
      "SELECT * FROM assets WHERE project_id=$1 ORDER BY created_at DESC",
      [id],
    )
  ).rows;
}
export async function jobsFor(db, id) {
  return (
    await db.query(
      "SELECT * FROM jobs WHERE project_id=$1 ORDER BY created_at DESC",
      [id],
    )
  ).rows;
}
export function publicJob(j) {
  const { external, payload, ...safe } = j;
  return {
    ...safe,
    external_id: external?.request_id || null,
    prompt: payload?.prompt || null,
  };
}
