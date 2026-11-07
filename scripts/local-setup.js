import { mkdir, writeFile, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
try {
  await access(".env.local");
  console.log(".env.local already exists; configuration preserved.");
} catch {
  await mkdir(".local", { recursive: true });
  const password = randomBytes(24).toString("base64url");
  await writeFile(
    ".env.local",
    `NODE_ENV=development\nLOCAL_DATA_DIR=.local\nSTORAGE_MODE=local\nAPP_ORIGIN=http://localhost:3000\nPORT=3000\nADMIN_PASSWORD=${password}\n`,
  );
  await writeFile(".local/login.txt", password);
  console.log(
    "Created local configuration. Studio password is in .local/login.txt (ignored by git). Run npm run local.",
  );
}
