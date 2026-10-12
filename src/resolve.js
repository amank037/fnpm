"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { isLockfileStale } = require("./lockfile");

const NPM_ARGS = [
  "install",
  "--package-lock-only",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
];

function readPackageJson(projectDir) {
  const file = path.join(projectDir, "package.json");
  if (!fs.existsSync(file)) {
    throw new Error("package.json not found in current directory");
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse package.json: ${err.message}`);
  }
}

function readLockfile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function inspectLockfile(projectDir, pkg) {
  const lockfilePath = path.join(projectDir, "package-lock.json");
  const lock = fs.existsSync(lockfilePath) ? readLockfile(lockfilePath) : null;
  return {
    lockfilePath,
    lock,
    fresh: Boolean(lock) && !isLockfileStale(pkg, lock),
  };
}

function runNpm(cwd) {
  const isWindows = process.platform === "win32";
  const result = spawnSync(isWindows ? "npm.cmd" : "npm", NPM_ARGS, {
    cwd,
    stdio: "inherit",
    shell: isWindows,
  });
  if (result.error) {
    throw new Error(`Could not run npm: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error("npm failed to resolve dependencies");
  }
}

function requireModernLock(lock) {
  if (!lock || !lock.packages || typeof lock.packages !== "object") {
    throw new Error(
      "Could not produce a lockfile with a packages map. fnpm needs npm 7 or newer.",
    );
  }
  return lock;
}

function regenerateLockfile(projectDir) {
  console.log("Updating package-lock.json with npm...");
  runNpm(projectDir);
  return requireModernLock(
    readLockfile(path.join(projectDir, "package-lock.json")),
  );
}

function resolveWithoutWriting(projectDir, existing) {
  console.log(
    "Resolving dependencies with npm (no package-lock.json will be written)...",
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fnpm-resolve-"));
  try {
    fs.copyFileSync(
      path.join(projectDir, "package.json"),
      path.join(tmp, "package.json"),
    );
    const npmrc = path.join(projectDir, ".npmrc");
    if (fs.existsSync(npmrc)) fs.copyFileSync(npmrc, path.join(tmp, ".npmrc"));
    if (existing.lock) {
      fs.writeFileSync(
        path.join(tmp, "package-lock.json"),
        JSON.stringify(existing.lock),
      );
    }
    runNpm(tmp);
    return requireModernLock(readLockfile(path.join(tmp, "package-lock.json")));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = {
  readPackageJson,
  inspectLockfile,
  regenerateLockfile,
  resolveWithoutWriting,
};
