# fnpm

**Install globally: `npm i -g @amank037/fnpm@latest`**

> ⚠️ **Note:** This tool was originally built for personal use to solve disk bloat across many local projects. It is published publicly in case it helps others with similar setups, but it is not intended as a production-grade npm replacement. Use at your own discretion.

## What it does

`fnpm` eliminates duplicate `node_modules` disk usage by storing each unique `package@version` **once** in a global store (`~/.fnpm-store`) and **hardlinking** it into every project that needs it.

- 10 projects using `react@18.3.1` → stored once on disk, hardlinked 10 times
- Platform-specific optional dependencies (e.g., `@esbuild/linux-arm64` on Windows) are automatically skipped — only binaries matching your current OS and architecture are downloaded and stored
- Store files are set read-only to prevent silent corruption
- Subsequent installs fast-path instantly if `package-lock.json` hasn't changed

In real-world usage across multiple React/Vite projects, per-project `node_modules` dropped by **85–97%** compared to regular `npm install`, and total shared store size reduced by over **90%** after platform-aware filtering was added. Savings compound with every additional project sharing the same tech stack.

## Commands

```sh
fnpm install          # Replaces "npm install"
fnpm i                # Short alias
fnpm run <script>     # Replaces "npm run <script>" (thin passthrough)
```
