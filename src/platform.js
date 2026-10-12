"use strict";
const os = require("os");

let cachedLibc;

function detectLibc() {
  if (cachedLibc !== undefined) return cachedLibc;
  cachedLibc = null;
  if (os.platform() === "linux") {
    try {
      const header = process.report.getReport().header;
      cachedLibc = header && header.glibcVersionRuntime ? "glibc" : "musl";
    } catch {
      cachedLibc = null;
    }
  }
  return cachedLibc;
}

function mismatches(list, current) {
  if (!Array.isArray(list) || list.length === 0 || current === null) {
    return false;
  }
  const negated = list.filter((s) => s.startsWith("!")).map((s) => s.slice(1));
  const allowed = list.filter((s) => !s.startsWith("!"));
  if (negated.includes(current)) return true;
  if (allowed.length > 0 && !allowed.includes(current)) return true;
  return false;
}

function shouldSkipForPlatform(entry) {
  if (!entry.optional) return false;
  return (
    mismatches(entry.os, os.platform()) ||
    mismatches(entry.cpu, os.arch()) ||
    mismatches(entry.libc, detectLibc())
  );
}

module.exports = { shouldSkipForPlatform };
