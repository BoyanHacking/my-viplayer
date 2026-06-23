#!/usr/bin/env node
//
// scripts/build.js — cross-platform build wrapper around electron-builder.
//
// WHY THIS EXISTS
// electron-builder hardcodes -mx=9 (ultra) for 7z archives and IGNORES the
// `compression` config field for the 7z path. From
// node_modules/app-builder-lib/out/targets/archive.js:
//
//   args.push("-mx=" + (!isZip || options.compression === "maximum" ? "9" : "7"))
//
// For 7z, `!isZip` is true, so it's always "9". The Windows "portable" target
// (NSIS) packs a ~456 MiB solid 7z payload (mpv alone is ~117 MB); at -mx=9 the
// bundled 7za 21.07 exhausts memory and fails with "Can't allocate required
// memory!". The ONLY supported override for the 7z level is the env var
// ELECTRON_BUILDER_COMPRESSION_LEVEL. -mx=7 is near-identical in ratio for this
// payload and uses a fraction of the memory, so the portable build succeeds.
//
// USAGE (mirrors electron-builder CLI flags):
//   node scripts/build.js --win --publish never
//   node scripts/build.js --mac
//   node scripts/build.js --linux
//   node scripts/build.js --win --linux --mac
//
// You can still override the level explicitly:
//   ELECTRON_BUILDER_COMPRESSION_LEVEL=5 node scripts/build.js --win
//
if (!process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL) {
  process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL = "7";
}

const { spawn } = require("child_process");
const electronBuilderBin = require.resolve("electron-builder/cli.js");

const child = spawn(
  process.execPath,
  [electronBuilderBin, ...process.argv.slice(2)],
  { stdio: "inherit" }
);

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
