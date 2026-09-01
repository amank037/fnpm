"use strict";
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const tar = require("tar");

const STORE_ROOT = path.join(os.homedir(), ".fnpm-store");

function storePath(name, version) {
  return path.join(STORE_ROOT, ...name.split("/"), version);
}

async function storeExists(dir) {
  try {
    const e = await fsp.readdir(dir);
    return e.length > 0;
  } catch {
    return false;
  }
}

async function addPackageToStore({ name, version, resolved, integrity }) {
  const dest = storePath(name, version);
  if (await storeExists(dest)) return dest;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.mkdir(dest, { recursive: true });
  const tmpFile = path.join(
    os.tmpdir(),
    `fnpm-${crypto.randomBytes(8).toString("hex")}.tgz`,
  );
  try {
    await downloadToFile(resolved, tmpFile);
    await verifyIntegrity(tmpFile, integrity, `${name}@${version}`);
    await extractTarball(tmpFile, dest);
    await makeReadOnlyRecursive(dest);
    return dest;
  } catch (err) {
    await fsp.rm(dest, { recursive: true, force: true });
    throw err;
  } finally {
    await fsp.rm(tmpFile, { force: true });
  }
}

async function downloadToFile(rawUrl, filePath, redirects = 0) {
  if (redirects > 5) throw new Error("Too many redirects");
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid resolved URL: ${rawUrl}`);
  }
  const lib =
    url.protocol === "http:" ? http : url.protocol === "https:" ? https : null;
  if (!lib) throw new Error(`Unsupported protocol: ${rawUrl}`);
  await new Promise((resolve, reject) => {
    const req = lib.get(url, { headers: { "user-agent": "fnpm" } }, (res) => {
      if (
        [301, 302, 303, 307, 308].includes(res.statusCode) &&
        res.headers.location
      ) {
        res.resume();
        return downloadToFile(
          new URL(res.headers.location, url).toString(),
          filePath,
          redirects + 1,
        ).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const file = fs.createWriteStream(filePath);
      res.pipe(file);
      file.on("finish", resolve);
      file.on("error", reject);
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

function chooseIntegrityEntry(integrity) {
  if (!integrity) return null;
  const entries = String(integrity)
    .trim()
    .split(/\s+/)
    .map((p) => {
      const i = p.indexOf("-");
      if (i <= 0) return null;
      return { algo: p.slice(0, i).toLowerCase(), digest: p.slice(i + 1) };
    })
    .filter(Boolean);
  for (const a of ["sha512", "sha256", "sha1"]) {
    const f = entries.find((e) => e.algo === a);
    if (f) return f;
  }
  return entries[0] || null;
}

async function verifyIntegrity(filePath, integrity, label) {
  const entry = chooseIntegrityEntry(integrity);
  if (!entry) throw new Error(`Missing integrity for ${label}`);
  let hash;
  try {
    hash = crypto.createHash(entry.algo);
  } catch {
    throw new Error(`Unsupported algo "${entry.algo}" for ${label}`);
  }
  await new Promise((res, rej) => {
    const s = fs.createReadStream(filePath);
    s.on("data", (c) => hash.update(c));
    s.on("end", res);
    s.on("error", rej);
  });
  const d = hash.digest();
  if (d.equals(Buffer.from(entry.digest, "base64"))) return;
  if (d.toString("hex").toLowerCase() === entry.digest.toLowerCase()) return;
  throw new Error(`Integrity check failed for ${label}. Aborting.`);
}

async function extractTarball(file, dest) {
  await new Promise((res, rej) => {
    const x = tar.extract({ cwd: dest, strip: 1 });
    x.on("finish", res);
    x.on("error", rej);
    fs.createReadStream(file).on("error", rej).pipe(x);
  });
}

async function makeReadOnlyRecursive(p) {
  const st = await fsp.lstat(p);
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) {
    for (const e of await fsp.readdir(p))
      await makeReadOnlyRecursive(path.join(p, e));
    await fsp.chmod(p, 0o555);
  } else if (st.isFile()) {
    await fsp.chmod(p, st.mode & 0o111 ? 0o555 : 0o444);
  }
}

module.exports = { addPackageToStore, storePath };
