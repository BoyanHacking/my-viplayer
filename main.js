const { app, BrowserWindow, dialog, ipcMain, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { MpvController } = require('./src/mpv');

let mainWindow;
let videoHost;      // frameless child BrowserWindow that mpv renders into
let mpv;            // MpvController instance
let pendingFilePath = null;
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mkv', 'avi', 'mov', 'm4v', 'flv', 'ts', 'm2ts'];

/* ------------------------------------------------------------------ *
 * mpv executable resolution
 * ------------------------------------------------------------------ */
function resolveMpvExecutable() {
    const exe = process.platform === 'win32' ? 'mpv.exe' : 'mpv';
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'mpv', exe);
    }
    return path.join(__dirname, 'vendor', 'mpv', exe);
}

/* ------------------------------------------------------------------ *
 * Window creation
 * ------------------------------------------------------------------ */
function createWindow(filePath = null) {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: path.join(__dirname, 'icon.png')
    });

    mainWindow.loadFile('index.html');

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Load video file if provided (command-line / open-file / second-instance)
    if (filePath) {
        mainWindow.webContents.on('did-finish-load', () => {
            mainWindow.webContents.send('load-video-from-path', filePath);
        });
    }
}

/* ------------------------------------------------------------------ *
 * mpv host window (child BrowserWindow mpv renders into via --wid)
 * ------------------------------------------------------------------ */
function createVideoHost() {
    videoHost = new BrowserWindow({
        parent: mainWindow,
        frame: false,
        show: false,
        backgroundColor: '#000000',
        hasShadow: false,
        skipTaskbar: true,
        resizable: false,
        focusable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    // Minimal page; mpv draws over this HWND directly.
    videoHost.loadURL('data:text/html;charset=utf-8,<body style="margin:0;background:%23000"></body>');
    // The host window sits on top of the renderer's .video-wrapper. Make it
    // click-through so mouse events reach the renderer's overlay/click logic
    // (play/pause toggle, future controls). mpv still renders into it; we just
    // don't need it to capture the pointer. Feedback is drawn via mpv OSD.
    videoHost.setIgnoreMouseEvents(true, { forward: true });
    videoHost.on('closed', () => { videoHost = null; });
}

function getHostWindowHandle() {
    if (!videoHost) return null;
    const buf = videoHost.getNativeWindowHandle();
    // HWND may be 4 or 8 bytes depending on arch; read as unsigned.
    let hwnd;
    if (buf.length === 4) {
        hwnd = buf.readUInt32LE(0);
    } else {
        // 64-bit: read as two 32-bit halves -> bigint-safe string
        hwnd = buf.readUInt32LE(0) + 0x100000000 * buf.readUInt32LE(4);
        hwnd = String(hwnd);
    }
    return hwnd;
}

/* ------------------------------------------------------------------ *
 * mpv lifecycle
 * ------------------------------------------------------------------ */
async function startMpv() {
    if (mpv) return;
    const exe = resolveMpvExecutable();
    if (!fs.existsSync(exe)) {
        const msg = `mpv binary not found.\nExpected: ${exe}\n\nIn dev, place mpv (+ DLLs) into vendor/mpv/. In a packaged build it ships under resources/mpv/.`;
        console.error(msg);
        if (mainWindow) {
            dialog.showErrorBox('mpv not found', msg);
        }
        return;
    }

    const hwnd = getHostWindowHandle();
    if (hwnd == null) {
        console.error('Could not get host window handle for mpv.');
        return;
    }

    mpv = new MpvController({
        executable: exe,
        wid: hwnd,
        instanceId: String(process.pid),
        logIpc: !!process.env.MYVIPLAYER_MPV_DEBUG
    });

    // Bridge mpv property/event traffic -> renderer.
    mpv.on('property-change', (msg) => {
        if (process.env.MYVIPLAYER_DEBUG) console.log(`[mpv->renderer] property ${msg.name} =`, JSON.stringify(msg.data));
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('player:event', { name: msg.name, data: msg.data });
        }
    });
    // Raw mpv events (e.g. file-loaded, end-file, start-file).
    mpv.on('event', (name, msg) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('player:event', { name, data: msg && msg });
        }
    });
    mpv.on('log', (line) => console.log(`[mpv] ${line}`));
    mpv.on('error', (err) => console.error('[mpv] error:', err.message));
    mpv.on('crashed', (info) => {
        console.error('[mpv] crashed:', JSON.stringify(info));
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('player:event', { name: 'crashed', data: info });
        }
        // Single auto-restart attempt to recover from an unexpected crash.
        scheduleMpvRestart();
    });

    try {
        await mpv.start();
        console.log('[mpv] ready');
    } catch (err) {
        console.error('[mpv] failed to start:', err.message);
        if (mainWindow) dialog.showErrorBox('mpv failed to start', err.message);
    }
}

let restartTimer = null;
let restartAttempts = 0;
function scheduleMpvRestart() {
    if (restartAttempts >= 2) {
        console.error('[mpv] giving up after restart attempts');
        return;
    }
    restartAttempts++;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(async () => {
        mpv = null;
        await startMpv();
    }, 500);
}

async function stopMpv() {
    clearTimeout(restartTimer);
    restartAttempts = 99; // suppress restart during intentional quit
    if (mpv) {
        try { await mpv.quit(); } catch (_) {}
        mpv = null;
    }
}

/* ------------------------------------------------------------------ *
 * App lifecycle
 * ------------------------------------------------------------------ */
app.whenReady().then(async () => {
    const filePath = process.argv.find(arg =>
        VIDEO_EXTENSIONS.some(ext => arg.toLowerCase().endsWith('.' + ext))
    );

    createWindow(filePath || pendingFilePath);
    pendingFilePath = null;

    // Host window + mpv core must exist before the renderer tries to play.
    createVideoHost();
    await startMpv();

    // Keep the mpv host window positioned over the renderer's .video-wrapper.
    const syncHost = () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('video-rect-request');
        }
    };
    mainWindow.on('resize', syncHost);
    mainWindow.on('move', syncHost);
    mainWindow.on('maximize', () => setTimeout(syncHost, 50));
    mainWindow.on('unmaximize', () => setTimeout(syncHost, 50));
    mainWindow.webContents.on('did-finish-load', syncHost);
});

app.on('window-all-closed', async () => {
    await stopMpv();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', async (event) => {
    if (mpv) {
        event.preventDefault();
        await stopMpv();
        app.exit(0);
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Handle opening files from OS (macOS)
app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (mainWindow) {
        mainWindow.webContents.send('load-video-from-path', filePath);
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    } else {
        pendingFilePath = filePath;
    }
});

// Handle second instance (Windows - when app is already running)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine) => {
        if (mainWindow) {
            const filePath = commandLine.find(arg =>
                VIDEO_EXTENSIONS.some(ext => arg.toLowerCase().endsWith('.' + ext))
            );
            if (filePath) {
                mainWindow.webContents.send('load-video-from-path', filePath);
            }
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

/* ------------------------------------------------------------------ *
 * IPC: file handling (unchanged) + mark files (unchanged)
 * ------------------------------------------------------------------ */
ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Videos', extensions: VIDEO_EXTENSIONS }
        ]
    });
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

ipcMain.handle('save-mark-file', async (event, data) => {
    const { videoPath, inPoint, outPoint, note } = data;

    if (!videoPath || typeof inPoint !== 'number' || typeof outPoint !== 'number') {
        return { success: false, error: 'Invalid input data' };
    }
    if (inPoint >= outPoint) {
        return { success: false, error: 'In point must be before out point' };
    }
    if (inPoint < 0 || outPoint < 0) {
        return { success: false, error: 'Points must be non-negative' };
    }

    const sanitizedNote = (note || '').replace(/\|/g, '').substring(0, 500);
    const markPath = videoPath + '.mark';
    const content = `${inPoint}|${outPoint}|${sanitizedNote}\n`;

    try {
        const fileExists = await fs.promises.access(markPath).then(() => true).catch(() => false);
        if (fileExists) {
            await fs.promises.appendFile(markPath, content, 'utf8');
        } else {
            await fs.promises.writeFile(markPath, content, 'utf8');
        }
        return { success: true };
    } catch (err) {
        console.error('Failed to save mark file:', err);
        return { success: false, error: 'Failed to save mark file' };
    }
});

/* ------------------------------------------------------------------ *
 * IPC: mpv playback bridge (renderer <-> mpv)
 * ------------------------------------------------------------------ */
async function requireMpv() {
    if (!mpv) {
        // Try to (re)start lazily if it isn't up yet.
        if (!videoHost) createVideoHost();
        if (!mpv) await startMpv();
    }
    return mpv;
}

ipcMain.handle('player:load', async (_event, filePath) => {
    const m = await requireMpv();
    if (!m) return { success: false, error: 'mpv unavailable' };
    try {
        await m.loadFile(filePath);
        await m.play();
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});
ipcMain.handle('player:play', async () => { const m = await requireMpv(); if (m) { await m.play(); return true; } return false; });
ipcMain.handle('player:pause', async () => { const m = await requireMpv(); if (m) { await m.pause(); return true; } return false; });
ipcMain.handle('player:stop', async () => { const m = await requireMpv(); if (m) { await m.stop(); return true; } return false; });

ipcMain.handle('player:seek', async (_event, { mode, value }) => {
    const m = await requireMpv();
    if (!m) return false;
    try {
        if (mode === 'absolute') await m.seekAbsolute(value);
        else await m.seekRelative(value);
        return true;
    } catch (_) { return false; }
});

ipcMain.handle('player:set-speed', async (_event, n) => { const m = await requireMpv(); if (m) { await m.setSpeed(n); return true; } return false; });
ipcMain.handle('player:set-volume', async (_event, n) => { const m = await requireMpv(); if (m) { await m.setVolume(n); return true; } return false; });
ipcMain.handle('player:set-mute', async (_event, bool) => { const m = await requireMpv(); if (m) { await m.setMute(bool); return true; } return false; });
ipcMain.handle('player:frame-step', async () => { const m = await requireMpv(); if (m) { await m.frameStep(); return true; } return false; });
ipcMain.handle('player:frame-back-step', async () => { const m = await requireMpv(); if (m) { await m.frameBackStep(); return true; } return false; });
ipcMain.handle('player:show-text', async (_event, { text, durationMs }) => {
    const m = await requireMpv();
    if (m) { try { await m.showText(text, durationMs); } catch (_) {} return true; }
    return false;
});

/* ------------------------------------------------------------------ *
 * IPC: position the mpv host window over the renderer's video region.
 * Renderer sends a rect in viewport (content) coords; we translate to
 * screen coords using the main window's content bounds.
 * ------------------------------------------------------------------ */
ipcMain.on('video-rect', (_event, rect) => {
    if (!videoHost || !mainWindow || mainWindow.isDestroyed()) return;
    const content = mainWindow.getContentBounds();
    const x = Math.round(content.x + (rect.x || 0));
    const y = Math.round(content.y + (rect.y || 0));
    const w = Math.max(1, Math.round(rect.width || 0));
    const h = Math.max(1, Math.round(rect.height || 0));
    try {
        videoHost.setBounds({ x, y, width: w, height: h });
        if (!videoHost.isVisible()) videoHost.show();
    } catch (err) {
        console.error('[video-rect] failed:', err.message);
    }
});

// Allow renderer to open external links (mpv docs etc.) safely if ever needed.
ipcMain.handle('open-external', async (_event, url) => {
    try { await shell.openExternal(url); } catch (_) {}
});
