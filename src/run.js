"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

async function run(projectDir, scriptName, args = []) {
  let sa = Array.isArray(args) ? [...args] : [];
  if (sa[0] === "--") sa = sa.slice(1);

  const pkgPath = path.join(projectDir, "package.json");

  if (!fs.existsSync(pkgPath)) {
    console.error("fnpm error: package.json not found in current directory");
    process.exitCode = 1;
    return;
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch (err) {
    console.error(`fnpm error: failed to parse package.json: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const script = (pkg.scripts || {})[scriptName];

  if (!script) {
    console.error(`fnpm error: missing script "${scriptName}" in package.json`);
    process.exitCode = 1;
    return;
  }

  const binDir = path.join(projectDir, "node_modules", ".bin");
  const nodeDir = path.dirname(process.execPath);

  const env = { ...process.env };

  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";

  env[pathKey] = [binDir, nodeDir, env[pathKey] || ""]
    .filter(Boolean)
    .join(path.delimiter);

  env.npm_lifecycle_event = scriptName;
  env.INIT_CWD = process.cwd();

  if (pkg.name) env.npm_package_name = pkg.name;
  if (pkg.version) env.npm_package_version = pkg.version;

  const isWindows = os.platform() === "win32";

  const extraArgs = sa.length
    ? " " + sa.map((arg) => quoteArg(arg, isWindows)).join(" ")
    : "";

  const command = `${script}${extraArgs}`;

  const child = spawn(command, {
    cwd: projectDir,
    env,
    stdio: "inherit",
    shell: true,
  });

  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      if (signal) {
        resolve(1);
      } else {
        resolve(exitCode ?? 0);
      }
    });
  });

  process.exitCode = code;
}

function quoteArg(arg, isWindows) {
  const value = String(arg);

  if (isWindows) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

module.exports = { run };
