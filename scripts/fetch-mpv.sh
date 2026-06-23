#!/usr/bin/env bash
#
# fetch-mpv.sh — download a standalone mpv build into vendor/mpv/ so the app
# can bundle it (dev) or so CI can vendor it before packaging.
#
# Usage:
#   scripts/fetch-mpv.sh            # auto-detect host platform
#   scripts/fetch-mpv.sh win        # force Windows build (mpv.exe + dlls)
#   scripts/fetch-mpv.sh linux
#   scripts/fetch-mpv.sh mac
#
# Override the download URL with:
#   MPV_URL=https://example.com/mpv.7z   scripts/fetch-mpv.sh win
#
# Windows builds are fetched from the latest zhongfly/mpv-winbuild release
# (a widely-used community build of mpv for Windows). Refresh the URL if it
# ever moves. The decoded archive's mpv executable + sibling libs are copied
# into vendor/mpv/.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/vendor/mpv"
PLATFORM="${1:-auto}"

detect() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*|*Windows*) echo win ;;
    Darwin) echo mac ;;
    Linux) echo linux ;;
    *) echo linux ;;
  esac
}

if [[ "$PLATFORM" == "auto" ]]; then PLATFORM="$(detect)"; fi

mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1" >&2; exit 1; }; }

# Resolve a download URL for the requested platform.
resolve_url() {
  if [[ -n "${MPV_URL:-}" ]]; then echo "$MPV_URL"; return; fi
  case "$1" in
    win)
      need curl
      local api url
      api="https://api.github.com/repos/zhongfly/mpv-winbuild/releases/latest"
      # Pick the x86_64 non-vapoursynth 7z asset.
      url="$(curl -fsSL "$api" \
        | grep -oE 'https://[^"]+x86_64[^"]*\.7z' \
        | grep -iv vapoursynth | head -n1 || true)"
      [[ -n "$url" ]] || { echo "could not resolve mpv win build URL; set MPV_URL" >&2; exit 1; }
      echo "$url"
      ;;
    linux)
      echo "https://github.com/mpv-player/mpv/releases/download/v0.39.0/mpv-x86_64-appimage-v0.39.0.AppImage"
      ;;
    mac)
      echo "https://laboratory.stolendata.net/~criminal/mpv/latest/mpv-unsigned-v9.zip"
      ;;
    *) echo "unknown platform: $1" >&2; exit 1 ;;
  esac
}

extract_win() {
  local archive="$1"
  # 7z is available on windows runners; 7zz on macos; p7zip on linux.
  local sevenz=""
  for c in 7z 7zz 7za; do command -v "$c" >/dev/null 2>&1 && sevenz="$c" && break; done
  [[ -n "$sevenz" ]] || need 7z
  "$sevenz" x -y -o"$TMP/unpack" "$archive" >/dev/null
  # Find mpv.exe (nested under a build folder) and copy it + sibling libs.
  local exe dir
  exe="$(find "$TMP/unpack" -iname 'mpv.exe' -type f | head -n1)"
  [[ -n "$exe" ]] || { echo "mpv.exe not found in archive" >&2; exit 1; }
  dir="$(dirname "$exe")"
  cp -f "$exe" "$DEST/"
  # Copy runtime dlls / data that ship alongside mpv.exe.
  find "$dir" -maxdepth 1 -type f \( -iname '*.dll' -o -iname '*.pak' \) -exec cp -f {} "$DEST/" \; || true
  echo "vendored mpv.exe (+ $(find "$DEST" -maxdepth 1 -iname '*.dll' | wc -l) dlls) into vendor/mpv/"
}

extract_linux() {
  local archive="$1"
  cp -f "$archive" "$DEST/mpv"
  chmod +x "$DEST/mpv"
  echo "vendored mpv AppImage -> vendor/mpv/mpv"
}

extract_mac() {
  local archive="$1"
  local sevenz=""
  for c in 7z 7zz unzip; do command -v "$c" >/dev/null 2>&1 && sevenz="$c" && break; done
  if [[ "$sevenz" == "unzip" ]]; then
    unzip -o "$archive" -d "$TMP/unpack" >/dev/null
  else
    need 7z; "$sevenz" x -y -o"$TMP/unpack" "$archive" >/dev/null
  fi
  local bin
  bin="$(find "$TMP/unpack" -type f -perm -u+x -iname 'mpv' | head -n1)"
  [[ -n "$bin" ]] || bin="$(find "$TMP/unpack" -iname 'mpv' -type f | head -n1)"
  [[ -n "$bin" ]] || { echo "mpv binary not found in archive" >&2; exit 1; }
  cp -f "$bin" "$DEST/mpv"
  chmod +x "$DEST/mpv"
  echo "vendored mpv -> vendor/mpv/mpv"
}

echo "==> platform: $PLATFORM"
URL="$(resolve_url "$PLATFORM")"
echo "==> downloading: $URL"
archive="$TMP/mpv-archive"
curl -fSL -o "$archive" "$URL"

case "$PLATFORM" in
  win) extract_win "$archive" ;;
  linux) extract_linux "$archive" ;;
  mac) extract_mac "$archive" ;;
esac

echo "==> done. contents of vendor/mpv:"
ls -la "$DEST"
