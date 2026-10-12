# fnpm

**Install globally: `npm i -g @amank037/fnpm@latest`**

> ⚠️ **Note:** This tool was originally built for personal use to solve disk bloat across many local projects. It is published publicly in case it helps others with similar setups, but it is not intended as a production-grade npm replacement. Use at your own discretion.

## What it does

`fnpm` installs dependencies from your `package-lock.json` into a normal npm-style `node_modules`, but keeps only **one copy of each package on disk**. Every unique package (by name, version and integrity hash) is downloaded once into a global store (`~/.fnpm-store`) and **hardlinked** into every project that needs it.

- 10 projects using `react@18.3.1` → stored once on disk, hardlinked 10 times
- Tarballs are verified against the lockfile integrity hash before they enter the store
- Packages are extracted to a staging folder and moved into the store atomically, so an interrupted install never leaves a half-written package behind
- Store files are set read-only to prevent silent corruption
- Optional dependencies for other platforms (OS, CPU, libc) are skipped
- Re-running `fnpm install` is instant when nothing has changed

Disk savings grow with every additional project that shares dependencies.

### Measured example

Five real React projects with near-identical dependencies, on Windows 11 (same drive for store and projects):

|                                                          | Size                 |
| -------------------------------------------------------- | -------------------- |
| Five separate `node_modules` folders (about 216 MB each) | about 1.1 GB         |
| fnpm store (`_v2`) holding all five                      | about 257 MB on disk |

Explorer and tools like WizTree still show about 216 MB per project, because they count a hardlinked file at full size in every folder it appears in. Verify with `fsutil hardlink list <file>`: a file in `node_modules` should list the store path and the other projects that share it. Packages with install scripts are copied per project, so real usage is slightly above the store size.

## Requirements

- Node.js 18 or newer
- npm 7 or newer on your `PATH` (used only to resolve versions into a lockfile, never to install)

## Commands

```sh
fnpm install                    # Replaces "npm install"
fnpm i                          # Short alias
fnpm install --ignore-scripts   # Skip preinstall/install/postinstall scripts
fnpm install --no-lockfile      # Do not create or modify package-lock.json
fnpm run <script> [-- args]     # Replaces "npm run <script>" (thin passthrough)
fnpm --version
```

`fnpm` does not add or remove packages. To change dependencies, edit `package.json` (or use `npm install <pkg> --package-lock-only`) and run `fnpm install`.

## How installs work

1. **Resolve.** If `package-lock.json` exists and matches the dependencies in `package.json`, it is used as is. If it is missing or out of date, `npm install --package-lock-only` is run to create or update it. With `--no-lockfile`, resolution happens in a temporary folder and nothing is written to your project.
2. **Fetch.** Missing packages are downloaded in parallel (with retries and timeouts), verified, and added to the store.
3. **Link.** `node_modules` is rebuilt with hardlinks into the store, plus `.bin` links.
4. **Scripts.** Packages that declare install scripts are _copied_ instead of hardlinked, so their scripts can modify files without touching the shared store. Scripts run in dependency order.

`file:` directory dependencies and workspace packages are symlinked.

## Configuration

- `FNPM_STORE`: override the store location (default `~/.fnpm-store`). Keep it on the same drive as your projects; hardlinks cannot cross drives.
- `.npmrc` (project and user level): the `registry` and `@scope:registry` settings are honoured, as are `_authToken`, `_auth` and `username`/`_password` credentials for private registries. `${ENV_VAR}` expansion works.

## How it differs from pnpm

Both use a global content store and hardlinks. The differences:

|                         | fnpm                                 | pnpm                                                                    |
| ----------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| Resolution and lockfile | Uses npm's `package-lock.json`       | Own resolver, `pnpm-lock.yaml`                                          |
| `node_modules` layout   | Standard flat npm layout             | Symlinked, stricter layout                                              |
| Migration cost          | None, keep your lockfile and tooling | Switch lockfile and sometimes fix phantom dependencies                  |
| Deduplication           | Per `package@version`                | Per file, so different versions of a package also share unchanged files |
| Feature set             | `install` and `run` only             | Full package manager, workspaces, `add`/`remove`, patching and more     |

If you want a mature tool, use pnpm. fnpm is for people who want pnpm-style disk savings while staying on npm's lockfile and layout.

## Limitations

- No `add`/`remove` commands, no `update`, no `npm ci`-style strict mode, no `--omit=dev`.
- Needs the `npm` CLI (version 7+) to resolve dependencies when the lockfile is missing or stale. `--no-lockfile` does not support workspaces or `file:` dependencies, because resolution happens in a temporary folder.
- Only lockfile v2/v3 is supported. Older lockfiles are regenerated through npm.
- Dependencies from git, tarball files, or entries without an integrity hash are not installed. fnpm lists them, exits with code 1, and does not mark the install as complete.
- Packages with install scripts are copied rather than hardlinked, which reduces savings for those packages.
- Implicit `node-gyp rebuild` for packages with a `binding.gyp` needs `node-gyp` on your `PATH`.
- Hardlinks require the store and project to be on the same filesystem. Otherwise fnpm falls back to copying and prints a warning.
- Downloads do not use HTTP proxy settings.
- Windows has seen less testing than Linux and macOS; read-only store protection and hardlink limits behave differently there.
- Each install rebuilds `node_modules` from scratch rather than updating it incrementally.
- Upgrading from 0.2.x: the store layout changed. Old entries in `~/.fnpm-store` (everything except `_v2` and `_tmp`) are no longer used and can be deleted.

## License

MIT
