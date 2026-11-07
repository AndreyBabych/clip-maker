import https from "node:https";
import { lookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { BlockList, isIPv4 } from "node:net";
const reserved = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  reserved.addSubnet(address, prefix, "ipv4");
export const isPublicAddress = (address) =>
  isIPv4(address) && !reserved.check(address, "ipv4");
export function mediaUrl(url) {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    (u.port && u.port !== "443") ||
    u.username ||
    u.password ||
    !(
      u.hostname === "fal.media" ||
      u.hostname.endsWith(".fal.media") ||
      (u.hostname === "storage.googleapis.com" &&
        u.pathname.startsWith("/falserverless/"))
    )
  )
    throw Error("Provider media host is not allowed");
  return u;
}
export async function downloadProviderMedia(url, destination, redirects = 0) {
  const u = mediaUrl(url);
  if (redirects > 3) throw Error("Too many media redirects");
  const addresses = await lookup(u.hostname, { all: true, family: 4 });
  const a = addresses.find((a) => isPublicAddress(a.address));
  if (!a) throw Error("Unsafe media destination");
  const response = await new Promise((resolve, reject) => {
    const req = https.get(
      u,
      {
        lookup: (_host, options, callback) =>
          options.all
            ? callback(null, [{ address: a.address, family: 4 }])
            : callback(null, a.address, 4),
      },
      resolve,
    );
    req.setTimeout(120000, () =>
      req.destroy(Error("Media download timed out")),
    );
    req.on("error", reject);
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.resume();
    return downloadProviderMedia(
      new URL(response.headers.location, u).href,
      destination,
      redirects + 1,
    );
  }
  if (response.statusCode !== 200) {
    response.resume();
    throw Error("Media download failed; retry retrieval without regenerating");
  }
  let size = 0;
  const limit = new Transform({
    transform(chunk, encoding, cb) {
      size += chunk.length;
      cb(
        size > 256 * 1024 * 1024
          ? Error("Provider media exceeds 256 MB")
          : null,
        chunk,
      );
    },
  });
  await pipeline(response, limit, createWriteStream(destination));
  return size;
}
