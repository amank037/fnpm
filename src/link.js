"use strict";
const fsp = require("fs").promises;
const path = require("path");
const os = require("os");

async function linkPackageIntoProject({
  storeDir,
  projectDir,
  installRelPath,
  name,
}) {
  const destAbs = path.join(projectDir, installRelPath);
  await fsp.mkdir(path.dirname(destAbs), { recursive: true });
  const opts = { copy: false, warned: false, packageName: name };
  await linkOrCopyDir(storeDir, destAbs, opts);
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
    if (!opts.copy) {
      try {
        await fsp.link(s, d);
        continue;
      } catch (e) {
        if (e.code === "EXDEV") {
          opts.copy = true;
          if (!opts.warned) {
            console.warn(
              `fnpm warning: hardlink failed for ${opts.packageName}; falling back to copy.`,
            );
            opts.warned = true;
          }
        } else if (e.code !== "EEXIST") throw e;
      }
    }
    await fsp.copyFile(s, d);
    const st = await fsp.stat(s);
    await fsp.chmod(d, st.mode & 0o111 ? 0o555 : 0o444);
  }
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

  const binDir = path.join(path.dirname(path.join(projDir, relPath)), ".bin");
  await fsp.mkdir(binDir, { recursive: true });

  const isWindows = os.platform() === "win32";

  for (const [bn, br] of bins) {
    const tgt = path.join(pkgDir, br);
    try {
      await fsp.access(tgt);
    } catch {
      continue;
    }

    try {
      const st = await fsp.stat(tgt);
      if (st.isFile() && !(st.mode & 0o111)) await fsp.chmod(tgt, 0o555);
    } catch {}

    if (isWindows) {
      const cmdShim = path.join(binDir, `${bn}.cmd`);
      const relTarget = path.relative(binDir, tgt).replace(/\//g, "\\");
      const shimContent =
        `@IF EXIST "%~dp0\\node.exe" (\r\n` +
        `  "%~dp0\\node.exe" "%~dp0\\${relTarget}" %*\r\n` +
        `) ELSE (\r\n` +
        `  @SETLOCAL\r\n` +
        `  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n` +
        `  node "%~dp0\\${relTarget}" %*\r\n` +
        `)\r\n`;
      await fsp.writeFile(cmdShim, shimContent);

      const lnk = path.join(binDir, bn);
      await fsp.rm(lnk, { force: true });
      try {
        await fsp.symlink(path.relative(binDir, tgt), lnk);
      } catch {}
    } else {
      const lnk = path.join(binDir, bn);
      await fsp.rm(lnk, { force: true });
      await fsp.symlink(path.relative(binDir, tgt), lnk);
    }
  }
}

function getBins(pkg, name, rel) {
  if (!pkg?.bin) return [];
  if (typeof pkg.bin === "string") {
    const n = pkg.name
      ? pkg.name.split("/").pop()
      : name
        ? name.split("/").pop()
        : path.basename(rel);
    return [[n || "bin", pkg.bin]];
  }
  if (typeof pkg.bin === "object" && !Array.isArray(pkg.bin))
    return Object.entries(pkg.bin).filter(
      ([k, v]) => k && typeof v === "string",
    );
  return [];
}

module.exports = { linkPackageIntoProject };
