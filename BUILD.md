# Building DD Connect Desktop

Reference for producing the Windows NSIS installer on a Linux build
host. Captures the lessons from the 0.1.8 build so the next person
doesn't re-derive them.

## What `npm run build:win` actually does (and what it doesn't)

The script in `package.json`:

```json
"build:win": "electron-builder --win nsis"
```

invokes electron-builder **without** running `tsc` or `vite build` first.
Electron-builder expects `dist-electron/main.js`, `dist-electron/preload.js`,
and the renderer bundle in `dist/` to already be in place. On a clean
checkout (or after `rm -rf dist dist-electron`) `build:win` alone fails
with:

```
Application entry file "dist-electron/main.js" in the "...resources/app.asar"
does not exist. Seems like a wrong configuration.
```

The full chain is:

```
npx tsc && npx vite build && npx electron-builder --win nsis
```

`npm run build` runs that whole chain (`tsc && vite build && electron-builder`),
but with no platform flag — relies on the configured `win` target block
in `package.json` to drive output. Use `npm run build` for a host-default
build, or run the explicit chain when you want to be sure.

## Cross-compiling to Windows from Linux requires wine

Electron-builder's post-package step uses `rcedit-ia32.exe` to write
version strings, file description, and copyright into the produced
`.exe`. On Linux that runs through wine. Without wine the build fails
at:

```
⨯ wine is required, please see https://electron.build/multi-platform-build#linux
```

Even unsigned builds need wine for this rcedit pass — the "no signing
info, signing is skipped" log message is harmless and expected.

## The container approach (recommended)

Use the official `electronuserland/builder:wine` image. It bundles
node, electron-builder, and a working wine prefix. From the project
root:

```bash
mkdir -p .wine-home
chmod 700 .wine-home

docker run --rm \
  -v "$PWD":/project \
  -w /project \
  --user "$(id -u):$(id -g)" \
  -e HOME=/project/.wine-home \
  -e ELECTRON_CACHE=/project/.electron-cache \
  -e ELECTRON_BUILDER_CACHE=/project/.electron-builder-cache \
  electronuserland/builder:wine \
  /bin/bash -c "npx tsc && npx vite build && npx electron-builder --win nsis"
```

Notes on the flags:

- `--user "$(id -u):$(id -g)"` runs as the host user so the produced
  `dist/` and `dist-electron/` are owned by you, not root. Skipping
  this is what produced the root-owned artifacts that blocked the
  next host-side build until `chown` was run.
- `HOME=/project/.wine-home` gives wine a writable config directory
  it owns. Without this, wine sees `/tmp` (owned by container-root),
  refuses to write its config there, and rcedit fails with:
  ```
  wine: '/tmp' is not owned by you, refusing to create a configuration
  directory there
  ```
  The `.wine-home` dir is gitignored under the existing `.electron-cache`
  / `.electron-builder-cache` siblings.
- `ELECTRON_CACHE` and `ELECTRON_BUILDER_CACHE` keep the downloaded
  Electron binary and winCodeSign tooling on the host, so subsequent
  builds reuse them instead of re-downloading.

## Output locations

Despite electron-builder building intermediate output in `dist-electron/`,
the **final installer lands in `dist/`** because of the `directories.output`
setting in `package.json`:

```
dist/dd-connect-desktop-setup-<version>.exe        # NSIS installer
dist/dd-connect-desktop-setup-<version>.exe.blockmap
dist/latest.yml                                     # electron-updater manifest
dist/win-unpacked/                                  # unpacked app dir
```

The `win-unpacked/` directory contains a runnable but uninstalled copy of
the app — useful for quick spot-checks without running the installer.

## Code signing

There is no Windows code-signing certificate configured. Builds emit
multiple `signing is skipped` lines per signtool target — expected and
harmless. SmartScreen on Windows will warn the user the first time they
run an unsigned installer; "More info" → "Run anyway" gets through it.

When a signing cert is available, set `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`
env vars on the build invocation; electron-builder picks them up
automatically without further config changes.

## Auto-update (`latest.yml`)

`dist/latest.yml` is what `electron-updater` fetches from
`https://portal.decisivedatatech.com/download/latest.yml` to decide
whether a newer version is available. **Do not upload this file along
with manual-test or staging builds** — it points at a versioned `.exe`
filename, and uploading it will cause every running 0.1.7 client to
attempt to auto-upgrade to whatever you just built.

For staging / smoke-test builds, distribute the `.exe` out-of-band (scp
from this host, private MinIO bucket, etc.) and only update the public
`download/latest.yml` after the build is approved for release.

## Quick reference

| Want to do | Run |
|---|---|
| Local dev (host node, no installer) | `npm run dev` |
| Just type-check + bundle | `npx tsc && npx vite build` |
| Full Win NSIS installer (Linux host) | docker `electronuserland/builder:wine` block above |
| Just rerun the installer step (artifacts already built) | `docker run ... npx electron-builder --win nsis` |
| Run the unit tests | `npm test` |
