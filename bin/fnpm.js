#!/usr/bin/env node
"use strict";

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "install" || command === "i") {
    const { install } = require("../src/install");
    await install(process.cwd());
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

  console.error("Usage: fnpm install | fnpm i | fnpm run <script>");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
