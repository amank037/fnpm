"use strict";
const fsp = require("fs").promises;
const path = require("path");
const os = require("os");

const FALLBACK_CODES = new Set(["EXDEV", "EPERM", "ENOTSUP", "EMLINK"]);

const state = { copyAll: false, warned: false };

async function linkPackageIntoProject({
  storeDir,
  projectDir,
  installRelPath,
  name,
  forceCopy = false,
}) {
  const destAbs = path.join(projectDir, installRelPath);
  await fsp.mkdir(path.dirname(destAbs), { recursive: true });
  await linkOrCopyDir(storeDir, destAbs, { forceCopy });
  await createBinLinks(destAbs, installRelPath, projectDir, name);
}

async function linkWorkspace({ projectDir, installRelPath, target, name }) {
  const destAbs = path.join(projectDir, installRelPath);
  const targetAbs = path.resolve(projectDir, target);
  await fsp.mkdir(path.dirname(destAbs), { recursive: true });
  await fsp.rm(destAbs, { recursive: true, force: true });
  const linkTarget =
    os.platform() === "win32"
      ? targetAbs
      : path.relative(path.dirname(destAbs), targetAbs);
  await fsp.symlink(linkTarget, destAbs, "junction");
  await createBinLinks(destAbs, installRelPath, projectDir, name);
}

async function linkOrCopyDir(src, dest, opts) {
  await fsp.mkdir(dest, { recursive: true });
  for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await linkOrCopyDir(s, d, opts);
      continue;
    }
    if (entry.isSymbolicLink()) {
      await fsp.rm(d, { force: true });
      await fsp.symlink(await fsp.readlink(s), d);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!opts.forceCopy && !state.copyAll && (await tryLink(s, d))) continue;
    await copyFile(s, d);
  }
}

async function tryLink(s, d) {
  try {
    await fsp.link(s, d);
    return true;
  } catch (e) {
    if (e.code === "EEXIST") {
      await fsp.rm(d, { recursive: true, force: true });
      return tryLink(s, d);
    }
    if (!FALLBACK_CODES.has(e.code)) throw e;
    if (e.code !== "EMLINK") state.copyAll = true;
    if (!state.warned) {
      state.warned = true;
      console.warn(
        `fnpm warning: hardlinking failed (${e.code}); falling back to copying files. ` +
          "Keep the store and your projects on the same drive, or set FNPM_STORE.",
      );
    }
    return false;
  }
}

async function copyFile(s, d) {
  await fsp.rm(d, { recursive: true, force: true });
  await fsp.copyFile(s, d);
  const st = await fsp.stat(s);
  await fsp.chmod(d, st.mode & 0o111 ? 0o755 : 0o644);
}

function nodeModulesDirFor(projectDir, relPath) {
  const marker = "node_modules/";
  const idx = relPath.lastIndexOf(marker);
  return path.join(projectDir, relPath.slice(0, idx + marker.length - 1));
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function createBinLinks(pkgDir, relPath, projDir, name) {
  let pkg;
  try {
    pkg = JSON.parse(
      await fsp.readFile(path.join(pkgDir, "package.json"), "utf8"),
    );
  } catch {
    return;
  }
  const bins = getBins(pkg, name, relPath);
  if (!bins.length) return;

  const binDir = path.join(nodeModulesDirFor(projDir, relPath), ".bin");
  await fsp.mkdir(binDir, { recursive: true });

  const isWindows = os.platform() === "win32";

  for (const [bn, br] of bins) {
    if (!bn || bn === "." || bn === ".." || path.basename(bn) !== bn) continue;
    if (/[\\/:\0]/.test(bn)) continue;

    const tgt = path.resolve(pkgDir, br);
    if (!isInside(pkgDir, tgt)) continue;
    try {
      await fsp.access(tgt);
    } catch {
      continue;
    }

    try {
      const st = await fsp.stat(tgt);
      if (st.isFile() && !(st.mode & 0o111)) await fsp.chmod(tgt, 0o555);
    } catch {}

    const lnk = path.join(binDir, bn);

    if (isWindows) {
      const relTarget = path.relative(binDir, tgt);
      const shimContent =
        `@IF EXIST "%~dp0\\node.exe" (\r\n` +
        `  "%~dp0\\node.exe" "%~dp0\\${relTarget}" %*\r\n` +
        `) ELSE (\r\n` +
        `  @SETLOCAL\r\n` +
        `  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n` +
        `  node "%~dp0\\${relTarget}" %*\r\n` +
        `)\r\n`;
      await fsp.writeFile(path.join(binDir, `${bn}.cmd`), shimContent);
      await fsp.rm(lnk, { force: true });
      try {
        await fsp.symlink(path.relative(binDir, tgt), lnk);
      } catch {}
    } else {
      await fsp.rm(lnk, { force: true });
      await fsp.symlink(path.relative(binDir, tgt), lnk);
    }
  }
}

function getBins(pkg, name, rel) {
  if (!pkg || !pkg.bin) return [];
  if (typeof pkg.bin === "string") {
    const n = pkg.name
      ? pkg.name.split("/").pop()
      : name
        ? name.split("/").pop()
        : path.basename(rel);
    return [[n || "bin", pkg.bin]];
  }
  if (typeof pkg.bin === "object" && !Array.isArray(pkg.bin)) {
    return Object.entries(pkg.bin).filter(
      ([k, v]) => k && typeof v === "string",
    );
  }
  return [];
}

module.exports = { linkPackageIntoProject, linkWorkspace };
