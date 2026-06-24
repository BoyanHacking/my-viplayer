const { ipcRenderer } = require('electron');
const { Player } = require('./src/renderer-player');

// Playback core — replaces the <video> element. Routes to mpv via the main
// process and exposes an HTML5-media-like surface (currentTime, duration,
// paused, play/pause/seek/speed + on('timeupdate') etc.) so the control logic
// below stays almost unchanged.
const player = new Player();

// DOM elements
const placeholder = document.getElementById('placeholder');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');

// Buttons
const openBtn = document.getElementById('openBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
const stopBtn = document.getElementById('stopBtn');
const back10Btn = document.getElementById('back10Btn');
const back30Btn = document.getElementById('back30Btn');
const forward10Btn = document.getElementById('forward10Btn');
const forward30Btn = document.getElementById('forward30Btn');

// Speed controls
const speedSlider = document.getElementById('speedSlider');
const speedDisplay = document.getElementById('speedDisplay');
const speedUp = document.getElementById('speedUp');
const speedDown = document.getElementById('speedDown');
const speedPresets = document.querySelectorAll('.speed-preset');

// Volume controls (NEW — was missing in the <video> version)
const volumeSlider = document.getElementById('volumeSlider');
const volumeDisplay = document.getElementById('volumeDisplay');
const muteBtn = document.getElementById('muteBtn');

// Trim controls
const setInBtn = document.getElementById('setInBtn');
const setOutBtn = document.getElementById('setOutBtn');
const inTimeDisplay = document.getElementById('inTimeDisplay');
const outTimeDisplay = document.getElementById('outTimeDisplay');
const noteInput = document.getElementById('noteInput');
const saveMarkBtn = document.getElementById('saveMarkBtn');
const trimOverlay = document.getElementById('trimOverlay');
const trimControls = document.getElementById('trimControls');

// Icons
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');

// State
let currentPlaybackRate = 1.0;

// Trim state
let currentVideoPath = null;
let trimInPoint = null;
let trimOutPoint = null;

// Frame stepping state
let frameDuration = 1 / 30; // Default to 30fps (33.33ms per frame)
let leftArrowInterval = null;
let rightArrowInterval = null;

// Format time (seconds to MM:SS)
function formatTime(seconds) {
    if (isNaN(seconds) || seconds == null) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Update progress bar
function updateProgress() {
    const dur = player.duration;
    const cur = player.currentTime;
    if (!dur || isNaN(dur)) return;
    const percent = (cur / dur) * 100;
    progressFill.style.width = `${percent}%`;
    currentTimeEl.textContent = formatTime(cur);
}

// Set video speed
function setSpeed(speed) {
    currentPlaybackRate = parseFloat(speed);
    player.setSpeed(currentPlaybackRate);
    speedSlider.value = currentPlaybackRate;
    speedDisplay.textContent = `${currentPlaybackRate.toFixed(1)}x`;

    speedPresets.forEach(btn => {
        btn.classList.toggle('active', parseFloat(btn.dataset.speed) === currentPlaybackRate);
    });
}

// Update trim overlay position on progress bar
function updateTrimOverlay() {
    if (trimInPoint === null || trimOutPoint === null || !player.duration) {
        trimOverlay.classList.remove('visible');
        return;
    }

    const startPercent = (trimInPoint / player.duration) * 100;
    const endPercent = (trimOutPoint / player.duration) * 100;
    const width = endPercent - startPercent;

    trimOverlay.style.left = `${startPercent}%`;
    trimOverlay.style.width = `${width}%`;
    trimOverlay.classList.add('visible');
}

// Enable/disable trim controls based on video state
function enableTrimControls(enabled) {
    setInBtn.disabled = !enabled;
    setOutBtn.disabled = !enabled;
    noteInput.disabled = !enabled;
    saveMarkBtn.disabled = !enabled;
}

// Reset all trim state
function resetTrimState() {
    trimInPoint = null;
    trimOutPoint = null;
    inTimeDisplay.textContent = '--:--';
    outTimeDisplay.textContent = '--:--';
    noteInput.value = '';
    trimOverlay.classList.remove('visible');
    saveMarkBtn.disabled = true;
}

// Enable save button only when both in and out points are set
function updateSaveButtonState() {
    const bothSet = trimInPoint !== null && trimOutPoint !== null;
    saveMarkBtn.disabled = !bothSet;
}

// Step forward by one frame
function stepForward() {
    if (!player.duration) return;
    player.frameStep();
}

// Step backward by one frame
function stepBackward() {
    if (!player.duration) return;
    player.frameBackStep();
}

// Load and play video
async function loadVideo(filePath) {
    if (!filePath) return;
    placeholder.classList.add('hidden');
    playPauseBtn.disabled = false;
    stopBtn.disabled = false;
    back10Btn.disabled = false;
    back30Btn.disabled = false;
    forward10Btn.disabled = false;
    forward30Btn.disabled = false;

    currentVideoPath = filePath;
    resetTrimState();
    enableTrimControls(true);

    const result = await player.load(filePath);
    if (result && result.success === false) {
        alert('Failed to load video: ' + (result.error || 'Unknown error'));
    }
}

// Update play/pause icon
function updatePlayPauseIcon(isPlaying) {
    if (isPlaying) {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
    } else {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
    }
}

// Click feedback: now driven through mpv OSD (since the native mpv surface
// covers the DOM overlay region). Falls back to a DOM flash if OSD fails.
let feedbackTimer = null;
function showClickFeedback(isPaused) {
    player.showText(isPaused ? '❚❚' : '▶', 500).catch(() => {});
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {}, 500);
}

/* ------------------------------------------------------------------ *
 * Keep the mpv host window positioned over .video-wrapper
 * ------------------------------------------------------------------ */
const videoWrapper = document.querySelector('.video-wrapper');

function sendVideoRect() {
    if (!videoWrapper) return;
    const r = videoWrapper.getBoundingClientRect();
    ipcRenderer.send('video-rect', {
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height
    });
}

ipcRenderer.on('video-rect-request', sendVideoRect);
window.addEventListener('resize', sendVideoRect);
window.addEventListener('scroll', sendVideoRect, true);
if (window.ResizeObserver && videoWrapper) {
    new ResizeObserver(sendVideoRect).observe(videoWrapper);
}
// Send an initial rect once layout has settled.
window.addEventListener('load', () => {
    setTimeout(sendVideoRect, 0);
});

/* ------------------------------------------------------------------ *
 * Wire player events -> UI (replaces the old <video> event listeners)
 * ------------------------------------------------------------------ */
player.on('timeupdate', updateProgress);

player.on('loadedmetadata', () => {
    durationEl.textContent = formatTime(player.duration);
    if (!player.duration || isNaN(player.duration)) {
        enableTrimControls(false);
    }
});

player.on('play', () => updatePlayPauseIcon(true));
player.on('pause', () => updatePlayPauseIcon(false));
player.on('ended', () => updatePlayPauseIcon(false));

player.on('ratechange', () => {
    // keep slider in sync if speed changed from elsewhere
    if (Math.abs(player.speed - currentPlaybackRate) > 1e-6) {
        currentPlaybackRate = player.speed;
        speedSlider.value = currentPlaybackRate;
        speedDisplay.textContent = `${currentPlaybackRate.toFixed(1)}x`;
        speedPresets.forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.speed) === currentPlaybackRate);
        });
    }
});

player.on('volumechange', () => {
    if (volumeSlider) volumeSlider.value = player.volume;
    if (volumeDisplay) volumeDisplay.textContent = `${Math.round(player.volume)}%`;
    if (muteBtn) muteBtn.classList.toggle('muted', player.muted);
});

/* ------------------------------------------------------------------ *
 * Button / control event listeners
 * ------------------------------------------------------------------ */

// Open file
openBtn.addEventListener('click', async () => {
    const filePath = await ipcRenderer.invoke('select-file');
    if (filePath) loadVideo(filePath);
});

// Play/Pause
playPauseBtn.addEventListener('click', () => {
    player.togglePlay();
});

// Stop
stopBtn.addEventListener('click', () => {
    player.stop();
    player.seekTo(0);
    updatePlayPauseIcon(false);
});

// Seek controls
back10Btn.addEventListener('click', () => {
    player.seekBy(-10);
});

back30Btn.addEventListener('click', () => {
    player.seekBy(-30);
});

forward10Btn.addEventListener('click', () => {
    player.seekBy(10);
});

forward30Btn.addEventListener('click', () => {
    player.seekBy(30);
});

// Progress bar click
progressBar.addEventListener('click', (e) => {
    const dur = player.duration;
    if (!dur) return;
    const rect = progressBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    player.seekTo(percent * dur);
});

// Speed controls
speedSlider.addEventListener('input', (e) => {
    setSpeed(e.target.value);
});

speedUp.addEventListener('click', () => {
    const newSpeed = Math.min(3, currentPlaybackRate + 0.1);
    setSpeed(newSpeed);
});

speedDown.addEventListener('click', () => {
    const newSpeed = Math.max(0.5, currentPlaybackRate - 0.1);
    setSpeed(newSpeed);
});

speedPresets.forEach(btn => {
    btn.addEventListener('click', () => {
        setSpeed(btn.dataset.speed);
    });
});

// Volume controls
if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
        player.setVolume(parseFloat(e.target.value));
        if (player.muted && parseFloat(e.target.value) > 0) player.setMute(false);
    });
}
if (muteBtn) {
    muteBtn.addEventListener('click', () => {
        player.toggleMute();
    });
}

// Set In point
setInBtn.addEventListener('click', () => {
    if (!currentVideoPath) return;
    trimInPoint = player.currentTime;
    inTimeDisplay.textContent = formatTime(trimInPoint);
    updateTrimOverlay();
    updateSaveButtonState();
});

// Set Out point
setOutBtn.addEventListener('click', () => {
    if (!currentVideoPath) return;
    trimOutPoint = player.currentTime;
    outTimeDisplay.textContent = formatTime(trimOutPoint);
    updateTrimOverlay();
    updateSaveButtonState();
});

// Save mark
saveMarkBtn.addEventListener('click', async () => {
    if (trimInPoint === null || trimOutPoint === null) return;

    if (trimInPoint >= trimOutPoint) {
        alert('In point must be before out point.');
        return;
    }

    if (player.duration && (trimOutPoint > player.duration)) {
        alert('Out point exceeds video duration.');
        return;
    }

    const note = noteInput.value.replace(/\|/g, '').substring(0, 500);

    const result = await ipcRenderer.invoke('save-mark-file', {
        videoPath: currentVideoPath,
        inPoint: trimInPoint,
        outPoint: trimOutPoint,
        note: note
    });

    if (result.success) {
        saveMarkBtn.textContent = 'Saved!';
        saveMarkBtn.disabled = true;
        setTimeout(() => {
            saveMarkBtn.textContent = 'Save Mark';
            saveMarkBtn.disabled = false;
        }, 2000);
    } else {
        alert('Failed to save mark: ' + (result.error || 'Unknown error'));
    }
});

// Click on the video region to toggle play/pause with visual feedback.
// The mpv host window is click-through, so this still receives the clicks.
videoWrapper.addEventListener('click', () => {
    if (!player.ready || playPauseBtn.disabled) return;
    player.togglePlay();
    showClickFeedback(player.paused);
});

/* ------------------------------------------------------------------ *
 * Keyboard shortcuts (unchanged behavior; routed through player)
 * ------------------------------------------------------------------ */
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;

    switch (e.key.toLowerCase()) {
        case ' ':
            e.preventDefault();
            if (!playPauseBtn.disabled) playPauseBtn.click();
            break;
        case 'arrowleft':
            e.preventDefault();
            if (!player.ready) return;
            if (!e.repeat) {
                stepBackward();
                leftArrowInterval = setInterval(() => stepBackward(), 50);
            }
            break;
        case 'arrowright':
            e.preventDefault();
            if (!player.ready) return;
            if (!e.repeat) {
                stepForward();
                rightArrowInterval = setInterval(() => stepForward(), 50);
            }
            break;
        case 'arrowdown':
            e.preventDefault();
            if (!back30Btn.disabled) back30Btn.click();
            break;
        case 'arrowup':
            e.preventDefault();
            if (!forward30Btn.disabled) forward30Btn.click();
            break;
        case 's':
            e.preventDefault();
            speedDown.click();
            break;
        case 'd':
            e.preventDefault();
            speedUp.click();
            break;
        case 'r':
            e.preventDefault();
            setSpeed(1);
            break;
        case 'o':
            e.preventDefault();
            openBtn.click();
            break;
        case 'm':
            e.preventDefault();
            if (muteBtn) muteBtn.click();
            break;
    }
});

document.addEventListener('keyup', (e) => {
    switch (e.key.toLowerCase()) {
        case 'arrowleft':
            if (leftArrowInterval) {
                clearInterval(leftArrowInterval);
                leftArrowInterval = null;
            }
            break;
        case 'arrowright':
            if (rightArrowInterval) {
                clearInterval(rightArrowInterval);
                rightArrowInterval = null;
            }
            break;
    }
});

// Handle loading video from main process (when opening file with app)
ipcRenderer.on('load-video-from-path', (_event, filePath) => {
    loadVideo(filePath);
});
