#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");

function isRunningLocally() {
  try {
    const packageRoot = path.resolve(__dirname, "..");
    let container = path.dirname(packageRoot);
    if (path.basename(container).startsWith("@")) {
      container = path.dirname(container);
    }
    if (path.basename(container) !== "node_modules") return false;

    const projectRoot = path.dirname(container);
    if (projectRoot.split(path.sep).includes("_npx")) return false;

    const pkgPath = path.join(projectRoot, "package.json");
    if (!fs.existsSync(pkgPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.optionalDependencies,
    };
    return "@amank037/fnpm" in deps || "fnpm" in deps;
  } catch {
    return false;
  }
}

if (isRunningLocally()) {
  console.error(
    "\n" +
      "  ⚠️  fnpm is designed to be installed globally.\n" +
      "\n" +
      "  Install globally:\n" +
      "    npm i -g @amank037/fnpm@latest\n" +
      "\n" +
      "  Or use via npx without installing:\n" +
      "    npx @amank037/fnpm install\n" +
      "\n" +
      "  Local installs are not recommended because fnpm uses a\n" +
      "  shared store (~/.fnpm-store) that works best when invoked\n" +
      "  consistently across all projects.\n",
  );
  process.exit(1);
}

const USAGE = [
  "Usage:",
  "  fnpm install [--ignore-scripts] [--no-lockfile]",
  "  fnpm i       (alias for install)",
  "  fnpm run <script> [-- args...]",
  "  fnpm --version",
  "",
  "Options for install:",
  "  --ignore-scripts   Do not run preinstall/install/postinstall scripts",
  "  --no-lockfile      Do not create or modify package-lock.json",
].join("\n");

function parseInstallFlags(args) {
  const options = { ignoreScripts: false, writeLockfile: true };
  for (const arg of args) {
    if (arg === "--ignore-scripts") options.ignoreScripts = true;
    else if (arg === "--no-lockfile") options.writeLockfile = false;
    else throw new Error(`Unknown option for install: ${arg}\n\n${USAGE}`);
  }
  return options;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "--version" || command === "-v") {
    console.log(require("../package.json").version);
    return;
  }

  if (command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }

  if (command === "install" || command === "i") {
    const options = parseInstallFlags(rest);
    const { install } = require("../src/install");
    await install(process.cwd(), options);
    return;
  }

  if (command === "run") {
    const script = rest[0];
    if (!script) {
      console.error("Usage: fnpm run <script> [-- args...]");
      process.exitCode = 1;
      return;
    }
    const { run } = require("../src/run");
    await run(process.cwd(), script, rest.slice(1));
    return;
  }

  console.error(USAGE);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exitCode = 1;
});
