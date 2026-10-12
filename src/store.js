"use strict";
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { pipeline } = require("stream/promises");
const tar = require("tar");
const { authHeaderFor, mapResolvedUrl } = require("./config");

const STORE_ROOT = process.env.FNPM_STORE
  ? path.resolve(process.env.FNPM_STORE)
  : path.join(os.homedir(), ".fnpm-store");
const PACKAGES_DIR = path.join(STORE_ROOT, "_v2");
const TMP_DIR = path.join(STORE_ROOT, "_tmp");

const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 5;

const inflight = new Map();

function storePath(name, version, integrity) {
  const key = crypto
    .createHash("sha256")
    .update(String(integrity))
    .digest("hex")
    .slice(0, 16);
  return path.join(PACKAGES_DIR, ...name.split("/"), `${version}-${key}`);
}

async function storeExists(dir) {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

function addPackageToStore(entry, config) {
  const dir = storePath(entry.storeName, entry.version, entry.integrity);
  if (!inflight.has(dir)) {
    const job = populate(entry, dir, config).finally(() =>
      inflight.delete(dir),
    );
    inflight.set(dir, job);
  }
  return inflight.get(dir);
}

async function populate(entry, dir, config) {
  if (await storeExists(dir)) return { dir, fetched: false };

  await fsp.mkdir(TMP_DIR, { recursive: true });
  const id = crypto.randomBytes(8).toString("hex");
  const tarball = path.join(TMP_DIR, `${id}.tgz`);
  const staging = path.join(TMP_DIR, id);
  const label = `${entry.name}@${entry.version}`;

  try {
    const url = mapResolvedUrl(entry.resolved, entry.name, config);
    await downloadWithRetry(url, tarball, config);
    await verifyIntegrity(tarball, entry.integrity, label);
    await fsp.mkdir(staging, { recursive: true });
    await tar.extract({ file: tarball, cwd: staging, strip: 1 });
    await fsp.mkdir(path.dirname(dir), { recursive: true });
    try {
      await fsp.rename(staging, dir);
    } catch (err) {
      if (await storeExists(dir)) return { dir, fetched: false };
      throw err;
    }
    await makeReadOnlyRecursive(dir);
    return { dir, fetched: true };
  } finally {
    await fsp.rm(tarball, { force: true });
    await removeTree(staging);
  }
}

function fatal(message) {
  const err = new Error(message);
  err.fatal = true;
  return err;
}

function openResponse(url, headers) {
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { headers }, resolve);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Timed out fetching ${url}`));
    });
    req.on("error", reject);
  });
}

async function downloadToFile(rawUrl, filePath, config) {
  let current;
  try {
    current = new URL(rawUrl);
  } catch {
    throw fatal(`Invalid resolved URL: ${rawUrl}`);
  }
  const originHost = current.host;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "https:" && current.protocol !== "http:") {
      throw fatal(`Unsupported protocol: ${current}`);
    }
    const headers = { "user-agent": "fnpm" };
    if (current.host === originHost) {
      const auth = authHeaderFor(current.toString(), config);
      if (auth) headers.authorization = auth;
    }

    const res = await openResponse(current, headers);

    if (
      [301, 302, 303, 307, 308].includes(res.statusCode) &&
      res.headers.location
    ) {
      res.resume();
      current = new URL(res.headers.location, current);
      continue;
    }

    if (res.statusCode !== 200) {
      res.resume();
      let message = `HTTP ${res.statusCode} for ${current}`;
      if (res.statusCode === 401 || res.statusCode === 403) {
        message += " (check registry credentials in .npmrc)";
      }
      const err = new Error(message);
      err.status = res.statusCode;
      throw err;
    }

    await pipeline(res, fs.createWriteStream(filePath));
    return;
  }

  throw fatal("Too many redirects");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadWithRetry(url, filePath, config) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await downloadToFile(url, filePath, config);
      return;
    } catch (err) {
      lastError = err;
      const retriable =
        !err.fatal && (!err.status || err.status === 429 || err.status >= 500);
      if (!retriable || attempt === MAX_ATTEMPTS) break;
      await sleep(250 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
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
  for (const algo of ["sha512", "sha256", "sha1"]) {
    const found = entries.find((e) => e.algo === algo);
    if (found) return found;
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
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  const digest = hash.digest();
  if (digest.equals(Buffer.from(entry.digest, "base64"))) return;
  if (digest.toString("hex") === entry.digest.toLowerCase()) return;
  throw new Error(`Integrity check failed for ${label}. Aborting.`);
}

async function makeReadOnlyRecursive(p) {
  const st = await fsp.lstat(p);
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) {
    for (const e of await fsp.readdir(p)) {
      await makeReadOnlyRecursive(path.join(p, e));
    }
    await fsp.chmod(p, 0o555);
  } else if (st.isFile()) {
    await fsp.chmod(p, st.mode & 0o111 ? 0o555 : 0o444);
  }
}

async function makeWritableRecursive(p) {
  let st;
  try {
    st = await fsp.lstat(p);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) {
    await fsp.chmod(p, 0o755);
    for (const e of await fsp.readdir(p)) {
      await makeWritableRecursive(path.join(p, e));
    }
  } else if (st.isFile()) {
    await fsp.chmod(p, 0o644);
  }
}

async function removeTree(p) {
  await makeWritableRecursive(p);
  await fsp.rm(p, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  });
}

module.exports = { addPackageToStore, storePath, STORE_ROOT };
