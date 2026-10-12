"use strict";
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { hashFile, manifestHash, parseLockfile } = require("./lockfile");
const { loadConfig } = require("./config");
const { shouldSkipForPlatform } = require("./platform");
const { addPackageToStore } = require("./store");
const { linkPackageIntoProject, linkWorkspace } = require("./link");
const { runInstallScripts, orderForScripts } = require("./scripts");
const {
  readPackageJson,
  inspectLockfile,
  regenerateLockfile,
  resolveWithoutWriting,
} = require("./resolve");

const MARKER = ".fnpm-synced";
const FETCH_CONCURRENCY = 8;

async function mapLimit(items, limit, fn) {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next++];
        await fn(item);
      }
    },
  );
  await Promise.all(workers);
}

async function readMarker(nm) {
  try {
    return JSON.parse(await fsp.readFile(path.join(nm, MARKER), "utf8"));
  } catch {
    return null;
  }
}

function isSynced(marker, source, key, ignoreScripts) {
  return (
    Boolean(marker) &&
    marker.source === source &&
    marker.key === key &&
    Boolean(marker.ignoreScripts) === ignoreScripts
  );
}

function nodeModulesRoot(rel) {
  const idx = rel.indexOf("node_modules/");
  return rel.slice(0, idx + "node_modules".length);
}

async function install(projectDir, options = {}) {
  const { ignoreScripts = false, writeLockfile = true } = options;
  const nm = path.join(projectDir, "node_modules");

  const pkg = readPackageJson(projectDir);
  const existing = inspectLockfile(projectDir, pkg);
  const config = loadConfig(projectDir);

  let source;
  let key = null;
  if (existing.fresh) {
    source = "lockfile";
    key = hashFile(existing.lockfilePath);
  } else if (writeLockfile) {
    source = "lockfile";
  } else {
    source = "resolved";
    key = manifestHash(pkg);
  }

  const upToDate = async () =>
    fs.existsSync(nm) &&
    key !== null &&
    isSynced(await readMarker(nm), source, key, ignoreScripts);

  if (await upToDate()) {
    console.log("already up to date");
    return;
  }

  let lock;
  if (existing.fresh) {
    lock = existing.lock;
  } else if (writeLockfile) {
    lock = regenerateLockfile(projectDir);
    key = hashFile(existing.lockfilePath);
    if (await upToDate()) {
      console.log("already up to date");
      return;
    }
  } else {
    lock = resolveWithoutWriting(projectDir, existing);
  }

  const { entries, links, unsupported } = parseLockfile(lock);
  const installable = entries.filter((e) => !shouldSkipForPlatform(e));
  const skippedCount = entries.length - installable.length;

  const stores = new Map();
  const fetchedDirs = new Set();
  if (installable.length > 0)
    console.log(`Preparing ${installable.length} package(s)...`);
  await mapLimit(installable, FETCH_CONCURRENCY, async (entry) => {
    const result = await addPackageToStore(entry, config);
    stores.set(entry.path, result.dir);
    if (result.fetched) fetchedDirs.add(result.dir);
  });

  const roots = new Set(["node_modules"]);
  for (const entry of installable) roots.add(nodeModulesRoot(entry.path));
  for (const link of links) roots.add(nodeModulesRoot(link.path));
  for (const root of roots) {
    await fsp.rm(path.join(projectDir, root), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
  await fsp.mkdir(nm, { recursive: true });

  for (const entry of installable) {
    await linkPackageIntoProject({
      storeDir: stores.get(entry.path),
      projectDir,
      installRelPath: entry.path,
      name: entry.name,
      forceCopy: !ignoreScripts && entry.hasInstallScript,
    });
  }

  for (const link of links) {
    await linkWorkspace({
      projectDir,
      installRelPath: link.path,
      target: link.target,
      name: link.name,
    });
  }

  if (!ignoreScripts) {
    const withScripts = orderForScripts(installable, lock.packages).filter(
      (e) => e.hasInstallScript,
    );
    if (withScripts.length > 0) {
      console.log("Running install scripts...");
      await runInstallScripts({ projectDir, packages: withScripts });
    }
  }

  if (unsupported.length === 0) {
    await fsp.writeFile(
      path.join(nm, MARKER),
      JSON.stringify(
        { source, key, ignoreScripts, syncedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
  }

  let msg = `fnpm install complete: ${installable.length + links.length} package(s) linked`;
  const notes = [];
  if (fetchedDirs.size > 0) notes.push(`${fetchedDirs.size} downloaded`);
  if (skippedCount > 0) notes.push(`${skippedCount} platform-optional skipped`);
  if (notes.length > 0) msg += ` (${notes.join(", ")})`;
  console.log(`${msg}.`);

  if (unsupported.length > 0) {
    console.warn(
      `\nfnpm warning: ${unsupported.length} package(s) were NOT installed because fnpm cannot handle them:`,
    );
    for (const item of unsupported) {
      console.warn(`  ${item.path}  (${item.reason})`);
    }
    console.warn(
      "Use npm for these (for example by pinning registry versions), or run `npm install` instead.",
    );
    process.exitCode = 1;
  }
}

module.exports = { install };
