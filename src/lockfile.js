"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

function hashFile(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function sortedJson(obj) {
  const out = {};
  for (const key of Object.keys(obj || {}).sort()) out[key] = obj[key];
  return JSON.stringify(out);
}

function manifestHash(pkg) {
  const picked = {};
  for (const field of DEP_FIELDS) picked[field] = sortedJson(pkg[field]);
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(picked))
    .digest("hex");
}

function isLockfileStale(pkg, lock) {
  if (!lock || !lock.packages || typeof lock.packages !== "object") {
    return true;
  }
  const root = lock.packages[""];
  if (!root) return true;
  return DEP_FIELDS.some(
    (field) => sortedJson(pkg[field]) !== sortedJson(root[field]),
  );
}

function nameFromLockfilePath(pkgPath) {
  const marker = "node_modules/";
  const idx = pkgPath.lastIndexOf(marker);
  if (idx === -1) return null;
  const name = pkgPath.slice(idx + marker.length).replace(/\/+$/, "");
  if (!name || name.startsWith(".")) return null;
  return name;
}

function isSafeName(name) {
  const parts = name.split("/");
  if (parts.length > 2) return false;
  if (parts.length === 2 && !parts[0].startsWith("@")) return false;
  return parts.every((p) => p && p !== "." && p !== ".." && !/[\\:\0]/.test(p));
}

function parseLockfile(lock) {
  const packages = lock && lock.packages;
  if (!packages || typeof packages !== "object") {
    throw new Error(
      "Unsupported package-lock.json. fnpm supports lockfileVersion 2 or 3 only.",
    );
  }
  const entries = [];
  const links = [];
  const unsupported = [];

  for (const [rawPath, info] of Object.entries(packages)) {
    if (/[\\:\0]/.test(rawPath)) {
      throw new Error(`Refusing suspicious path in package-lock.json: ${rawPath}`);
    }
    if (!rawPath || !info || typeof info !== "object") continue;

    const rel = path.posix.normalize(rawPath);
    if (rel === ".." || rel.startsWith("../") || path.posix.isAbsolute(rel)) {
      continue;
    }

    const name = nameFromLockfilePath(rel);
    if (!name || !isSafeName(name)) continue;
    if (info.inBundle) continue;

    if (info.link) {
      if (typeof info.resolved === "string" && info.resolved) {
        links.push({ path: rel, name, target: info.resolved });
      }
      continue;
    }

    const resolved = typeof info.resolved === "string" ? info.resolved : "";
    const version = typeof info.version === "string" ? info.version : "";

    if (!version || /[\\/\0]/.test(version)) {
      unsupported.push({ path: rel, reason: "missing or invalid version" });
      continue;
    }
    if (!resolved) {
      unsupported.push({ path: rel, reason: "no resolved URL in lockfile" });
      continue;
    }
    if (!/^https?:\/\//i.test(resolved)) {
      const scheme = resolved.split(":")[0].toLowerCase();
      unsupported.push({ path: rel, reason: `unsupported source (${scheme})` });
      continue;
    }
    if (!info.integrity) {
      unsupported.push({ path: rel, reason: "no integrity hash in lockfile" });
      continue;
    }

    entries.push({
      path: rel,
      name,
      storeName: isSafeName(String(info.name || "")) ? info.name : name,
      version,
      resolved,
      integrity: String(info.integrity),
      optional: Boolean(info.optional),
      hasInstallScript: Boolean(info.hasInstallScript),
      os: info.os,
      cpu: info.cpu,
      libc: info.libc,
    });
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  links.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entries, links, unsupported };
}

module.exports = {
  hashFile,
  manifestHash,
  isLockfileStale,
  parseLockfile,
};
