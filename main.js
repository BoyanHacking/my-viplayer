const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow;

function createWindow() {
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
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Handle file selection
ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Videos', extensions: ['mp4', 'webm', 'ogg', 'mkv', 'avi', 'mov'] }
        ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

// Handle save mark file
ipcMain.handle('save-mark-file', async (event, data) => {
    const { videoPath, inPoint, outPoint, note } = data;

    // Validate inputs
    if (!videoPath || typeof inPoint !== 'number' || typeof outPoint !== 'number') {
        return { success: false, error: 'Invalid input data' };
    }

    if (inPoint >= outPoint) {
        return { success: false, error: 'In point must be before out point' };
    }

    if (inPoint < 0 || outPoint < 0) {
        return { success: false, error: 'Points must be non-negative' };
    }

    // Sanitize note: remove pipe characters, limit length
    const sanitizedNote = (note || '').replace(/\|/g, '').substring(0, 500);

    // Build mark file path: <videofilename>.mark
    const markPath = videoPath + '.mark';

    // Build content line
    const content = `${inPoint}|${outPoint}|${sanitizedNote}`;

    try {
        await fs.promises.writeFile(markPath, content, 'utf8');
        return { success: true };
    } catch (err) {
        console.error('Failed to save mark file:', err);
        return { success: false, error: 'Failed to save mark file' };
    }
});
