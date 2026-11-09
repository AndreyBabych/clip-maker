import { test } from "node:test";
import assert from "node:assert/strict";
import { projectSchema, sceneSchema, normalizeUpdate } from "../domain.js";
const scene = {
  id: "163c1297-4fab-49bb-a417-6b51b60cd6b2",
  title: "Opening",
  start: 0,
  end: 5,
  description: "A quiet room",
  prompt: "Wide shot",
  approved: false,
};
test("accepts precise scene boundaries", () =>
  assert.equal(sceneSchema.parse({ ...scene, end: 5.04 }).end, 5.04));
test("rejects reversed or zero length scenes", () => {
  for (const end of [0, -1])
    assert.equal(sceneSchema.safeParse({ ...scene, end }).success, false);
});
test("rejects invalid timestamps and missing approval state", () => {
  assert.equal(sceneSchema.safeParse({ ...scene, start: NaN }).success, false);
  assert.equal(
    sceneSchema.safeParse({ ...scene, approved: undefined }).success,
    false,
  );
});
test("validates project and strips unknown storage fields", () => {
  const d = projectSchema.parse({
    title: "Film",
    idea: "Idea",
    ratio: "16:9",
    archived: false,
    scenes: [scene],
    characters: [],
    locations: [],
    secret: "bad",
  });
  assert.equal(d.secret, undefined);
  assert.deepEqual(d.workflow, {
    key: false,
    story: false,
    board: false,
    generation: false,
  });
});
test("revising an approved visual key preserves existing scene media while invalidating later approvals", () => {
  const old = projectSchema.parse({
    title: "Film",
    idea: "Idea",
    ratio: "16:9",
    archived: false,
    scenes: [
      {
        ...scene,
        approved: true,
        imageId: "146fbc01-e833-4d05-914e-c468a8c1acd0",
        videoId: "2c0bcdec-921a-4e96-8d69-2ebc23247cee",
      },
    ],
    characters: [],
    locations: [],
    stylePrompt: "blue",
    workflow: { key: true, story: true, board: true, generation: true },
  });
  const next = projectSchema.parse({ ...old, stylePrompt: "red" });
  normalizeUpdate(old, next);
  assert.deepEqual(next.workflow, {
    key: false,
    story: false,
    board: false,
    generation: false,
  });
  assert.equal(next.scenes[0].imageId, old.scenes[0].imageId);
  assert.equal(next.scenes[0].videoId, old.scenes[0].videoId);
});
