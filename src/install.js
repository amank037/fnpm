"use strict";
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const { hashFile, parseLockfile } = require("./lockfile");
const { addPackageToStore } = require("./store");
const { linkPackageIntoProject } = require("./link");

function shouldSkipPlatformOptional(rawPkg) {
  if (!rawPkg || !rawPkg.optional) return false;

  const currentOs = os.platform();
  const currentCpu = os.arch();

  if (Array.isArray(rawPkg.os)) {
    const negated = rawPkg.os
      .filter((s) => s.startsWith("!"))
      .map((s) => s.slice(1));
    const allowed = rawPkg.os.filter((s) => !s.startsWith("!"));

    if (negated.length > 0 && negated.includes(currentOs)) return true;
    if (allowed.length > 0 && !allowed.includes(currentOs)) return true;
  }

  if (Array.isArray(rawPkg.cpu)) {
    const negated = rawPkg.cpu
      .filter((s) => s.startsWith("!"))
      .map((s) => s.slice(1));
    const allowed = rawPkg.cpu.filter((s) => !s.startsWith("!"));

    if (negated.length > 0 && negated.includes(currentCpu)) return true;
    if (allowed.length > 0 && !allowed.includes(currentCpu)) return true;
  }

  return false;
}

async function install(projectDir) {
  const lf = path.join(projectDir, "package-lock.json");
  if (!fs.existsSync(lf)) {
    console.log(
      "No package-lock.json. Running npm install --package-lock-only...",
    );
    if (
      spawnSync("npm", ["install", "--package-lock-only"], {
        cwd: projectDir,
        stdio: "inherit",
      }).status !== 0
    )
      throw new Error("Failed to generate package-lock.json");
  }

  const hash = hashFile(lf);
  const nm = path.join(projectDir, "node_modules");
  const marker = path.join(nm, ".fnpm-synced");

  if (fs.existsSync(nm)) {
    try {
      if (
        JSON.parse(await fsp.readFile(marker, "utf8")).lockfileHash === hash
      ) {
        console.log("already up to date");
        return;
      }
    } catch {}
  }

  let lockfileRaw;
  try {
    lockfileRaw = JSON.parse(fs.readFileSync(lf, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse package-lock.json: ${err.message}`);
  }

  const pkgs = parseLockfile(lf).sort((a, b) => a.path.localeCompare(b.path));

  const filteredPkgs = pkgs.filter((p) => {
    const rawPkg = lockfileRaw.packages && lockfileRaw.packages[p.path];
    if (shouldSkipPlatformOptional(rawPkg)) return false;
    return true;
  });

  const skippedCount = pkgs.length - filteredPkgs.length;

  if (fs.existsSync(nm))
    await fsp.rm(nm, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });

  await fsp.mkdir(nm, { recursive: true });

  for (const p of filteredPkgs) {
    const store = await addPackageToStore(p);
    await linkPackageIntoProject({
      storeDir: store,
      projectDir,
      installRelPath: p.path,
      name: p.name,
    });
  }

  await fsp.writeFile(
    marker,
    JSON.stringify(
      { lockfileHash: hash, syncedAt: new Date().toISOString() },
      null,
      2,
    ),
  );

  let msg = `fnpm install complete: ${filteredPkgs.length} package(s) linked.`;
  if (skippedCount > 0) {
    msg += ` (${skippedCount} platform-optional package(s) skipped.)`;
  }
  console.log(msg);
}

module.exports = { install };
