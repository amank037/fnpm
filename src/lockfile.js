"use strict";
const fs = require("fs");
const crypto = require("crypto");

function hashFile(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function parseLockfile(lockfilePath) {
  const raw = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));
  const packages = raw.packages;
  if (!packages || typeof packages !== "object") {
    throw new Error(
      "Unsupported package-lock.json. fnpm supports lockfileVersion 2 or 3 only.",
    );
  }
  const entries = [];
  for (const [pkgPath, info] of Object.entries(packages)) {
    if (!pkgPath) continue;
    if (!info || typeof info !== "object") continue;
    if (info.link) continue;
    if (!info.version || !info.resolved) continue;
    const resolved = String(info.resolved);
    if (/^(file:|git:|git\+|ssh:)/i.test(resolved)) continue;
    if (!info.integrity) continue;
    const name = nameFromLockfilePath(pkgPath);
    if (!name) continue;
    entries.push({
      path: pkgPath,
      name,
      version: info.version,
      resolved,
      integrity: info.integrity,
    });
  }
  return entries;
}

function nameFromLockfilePath(pkgPath) {
  const marker = "node_modules/";
  const idx = pkgPath.lastIndexOf(marker);
  if (idx === -1) return null;
  const name = pkgPath.slice(idx + marker.length).replace(/\/+$/, "");
  if (!name || name.startsWith(".")) return null;
  return name;
}

module.exports = { hashFile, parseLockfile };
