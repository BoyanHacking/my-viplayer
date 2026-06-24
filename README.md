# My Video Player

A cross-platform desktop video player built with Electron, using **mpv (libmpv
architecture)** as its playback core. Works on Windows and Mac.

> **Playback core:** video decoding is handled by a bundled **mpv** child process,
> driven over JSON IPC and reparented into the app window. This gives full
> real-world codec support — including **AC3, EAC3, DTS, and TrueHD** audio — that
> Chromium's `<video>` element cannot decode. See issue [#2](../../issues/2).

## Features

- **Play** local video files (MP4, WebM, OGG, MKV, AVI, MOV, M4V, FLV, TS, M2TS)
- **Full codec support via mpv** — H.264/HEVC video and **AC3 / EAC3 / DTS / TrueHD**
  audio (and everything else mpv/FFmpeg decode), with GPU-accelerated decoding
- **Audio & subtitle track selection** — switch audio language and toggle
  subtitles for multi-track MKVs (dropdowns appear automatically when a file
  has more than one audio track or any subtitle tracks)
- **Volume & mute** controls
- **Pause/Stop** playback
- **Speed control** - Fine adjustment from 0.5x to 3.0x speed
  - Slider control with 0.1x increments
  - Quick preset buttons: 0.5x, 1x, 1.5x, 2x
  - +/- buttons for precise adjustment
- **Skip controls**
  - Back/Forward 10 seconds
  - Back/Forward 30 seconds
- **Progress bar** - Click anywhere to seek
- **Trim / marks** - Set In/Out points and save them to a `.mark` file
- **Keyboard shortcuts** for all controls

## Installation

1. Install Node.js from [nodejs.org](https://nodejs.org/)

2. Navigate to the project directory:
   ```bash
   cd ~/my-viplayer
   ```

3. Install dependencies (if not already installed):
   ```bash
   npm install
   ```

4. **Vendor mpv** (the playback core). Either run the helper script:
   ```bash
   bash scripts/fetch-mpv.sh          # auto-detect platform
   bash scripts/fetch-mpv.sh win      # force Windows build
   ```
   …or manually place the `mpv` binary (+ its DLLs on Windows) into `vendor/mpv/`.
   Without it, the app shows an "mpv not found" dialog on startup.

## Running the App

```bash
npm start
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `←` | Step back one frame (hold to continue stepping) |
| `→` | Step forward one frame (hold to continue stepping) |
| `↓` | Back 30 seconds |
| `↑` | Forward 30 seconds |
| `S` | Decrease speed |
| `D` | Increase speed |
| `R` | Reset speed to 1x |
| `O` | Open video file |
| `M` | Mute / Unmute |

## How to Use

1. Click **"Open Video"** button (or press `O`)
2. Select a video file from your computer
3. Use the controls to play, pause, skip, and adjust speed
4. Click on the progress bar to jump to any point in the video

## Speed Control

The player supports fine-grained speed control:
- Use the **slider** for continuous adjustment (0.5x - 3.0x)
- Click **+/-** buttons to adjust by 0.1x increments
- Use **preset buttons** for quick access to common speeds
- Press **S/D** keys to decrease/increase speed
- Press **R** to reset to normal speed (1x)

## Download Pre-built Executables

**Download ready-to-use builds from the [Releases](../../releases) page:**

- 🪟 **Windows**: `.exe` installer or portable version
- 🍎 **macOS**: `.dmg` disk image
- 🐧 **Linux**: `.AppImage` or `.deb` package

Just download, install, and run!

---

## Building from Source

If you want to build the app yourself:

1. Install Node.js from [nodejs.org](https://nodejs.org/)

2. Clone the repository:
   ```bash
   git clone https://github.com/BoyanHacking/my-viplayer.git
   cd my-viplayer
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Vendor mpv (see [Installation](#installation) above):
   ```bash
   bash scripts/fetch-mpv.sh
   ```

5. Run the app:
   ```bash
   npm start
   ```

6. Build for your platform:
   ```bash
   npm run build:win    # Windows
   npm run build:mac    # macOS
   npm run build:linux  # Linux
   ```

The built files will be in the `dist/` folder.

---

## For Developers

### Creating a New Release

When you push a new release on GitHub, the **GitHub Actions workflow** automatically builds executables for all platforms:

1. Update version in `package.json`
2. Create a new tag:
   ```bash
   git tag v1.x.x
   git push origin v1.x.x
   ```
3. Go to GitHub → Releases → "Draft a new release"
4. Select the tag and publish

The workflow will build Windows, macOS, and Linux versions and attach them to the release automatically.

## License

ISC
