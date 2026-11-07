import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";

// Regression: server .env.local used to produce jsxDEV calls paired with a
// production React runtime. Type checking and HTTP 200 did not catch the crash.
const html = await readFile("dist/index.html", "utf8");
assert.match(html, /type="module"/);
const scripts = (await readdir("dist/assets")).filter((name) =>
  name.endsWith(".js"),
);
assert.ok(scripts.length > 0, "No frontend bundles");
for (const name of scripts) {
  const source = await readFile(`dist/assets/${name}`, "utf8");
  assert.ok(
    !source.includes("jsxDEV"),
    `${name} contains a development JSX runtime in production`,
  );
}
console.log(
  "Production frontend bundles use production JSX, even with server .env.local present.",
);
