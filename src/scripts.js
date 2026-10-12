"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PHASES = ["preinstall", "install", "postinstall"];

function readPackageJson(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function installCommands(pkg, dir) {
  const scripts = (pkg && pkg.scripts) || {};
  const hasGyp = fs.existsSync(path.join(dir, "binding.gyp"));
  const commands = [];
  for (const phase of PHASES) {
    if (typeof scripts[phase] === "string" && scripts[phase]) {
      commands.push({ phase, command: scripts[phase] });
    } else if (phase === "install" && hasGyp && !scripts.preinstall) {
      commands.push({ phase, command: "node-gyp rebuild" });
    }
  }
  return commands;
}

function binDirsFor(projectDir, dir) {
  const root = path.resolve(projectDir);
  const dirs = [];
  let current = dir;
  for (;;) {
    dirs.push(path.join(current, "node_modules", ".bin"));
    if (current === root || current === path.dirname(current)) break;
    current = path.dirname(current);
  }
  return dirs;
}

function buildEnv(projectDir, dir, pkg, phase) {
  const env = { ...process.env };
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  env[pathKey] = [
    ...binDirsFor(projectDir, dir),
    path.dirname(process.execPath),
    env[pathKey] || "",
  ]
    .filter(Boolean)
    .join(path.delimiter);
  env.npm_lifecycle_event = phase;
  env.npm_node_execpath = process.execPath;
  env.INIT_CWD = projectDir;
  if (pkg && pkg.name) env.npm_package_name = pkg.name;
  if (pkg && pkg.version) env.npm_package_version = pkg.version;
  return env;
}

function resolveDependencyPath(fromPath, depName, byPath) {
  let base = fromPath;
  for (;;) {
    const candidate = `${base}/node_modules/${depName}`;
    if (byPath.has(candidate)) return candidate;
    const idx = base.lastIndexOf("/node_modules/");
    if (idx === -1) break;
    base = base.slice(0, idx);
  }
  const top = `node_modules/${depName}`;
  return byPath.has(top) ? top : null;
}

function orderForScripts(entries, lockPackages) {
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const visited = new Set();
  const ordered = [];

  function visit(p) {
    if (visited.has(p)) return;
    visited.add(p);
    const info = lockPackages[p] || {};
    const names = [
      ...Object.keys(info.dependencies || {}),
      ...Object.keys(info.optionalDependencies || {}),
      ...Object.keys(info.peerDependencies || {}),
    ];
    for (const depName of names) {
      const dep = resolveDependencyPath(p, depName, byPath);
      if (dep) visit(dep);
    }
    ordered.push(byPath.get(p));
  }

  for (const entry of entries) visit(entry.path);
  return ordered;
}

function tail(text, lines = 40) {
  return String(text || "")
    .split(/\r?\n/)
    .slice(-lines)
    .join("\n")
    .trim();
}

async function runInstallScripts({ projectDir, packages }) {
  for (const entry of packages) {
    const dir = path.join(projectDir, entry.path);
    const pkg = readPackageJson(dir);
    const commands = installCommands(pkg, dir);
    if (!commands.length) continue;

    for (const { phase, command } of commands) {
      console.log(`  ${phase} ${entry.name}`);
      const result = spawnSync(command, {
        cwd: dir,
        env: buildEnv(projectDir, dir, pkg, phase),
        shell: true,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      const failed = result.error || result.status !== 0;
      if (!failed) continue;

      const output = tail(`${result.stdout}\n${result.stderr}`);
      const reason = result.error
        ? result.error.message
        : `exit code ${result.status}`;
      if (entry.optional) {
        console.warn(
          `fnpm warning: optional package ${entry.name} failed its ${phase} script (${reason}); removing it.`,
        );
        await fs.promises.rm(dir, { recursive: true, force: true });
        break;
      }
      throw new Error(
        `${phase} script failed for ${entry.name} (${reason})${output ? `\n${output}` : ""}`,
      );
    }
  }
}

module.exports = { runInstallScripts, orderForScripts };
