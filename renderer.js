const { ipcRenderer } = require('electron');

// Video element and controls
const video = document.getElementById('video');
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
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Update progress bar
function updateProgress() {
    const percent = (video.currentTime / video.duration) * 100;
    progressFill.style.width = `${percent}%`;
    currentTimeEl.textContent = formatTime(video.currentTime);
}

// Set video speed
function setSpeed(speed) {
    currentPlaybackRate = parseFloat(speed);
    video.playbackRate = currentPlaybackRate;
    speedSlider.value = currentPlaybackRate;
    speedDisplay.textContent = `${currentPlaybackRate.toFixed(1)}x`;

    // Update preset buttons
    speedPresets.forEach(btn => {
        btn.classList.toggle('active', parseFloat(btn.dataset.speed) === currentPlaybackRate);
    });
}

// Update trim overlay position on progress bar
function updateTrimOverlay() {
    if (trimInPoint === null || trimOutPoint === null || !video.duration) {
        trimOverlay.classList.remove('visible');
        return;
    }

    const startPercent = (trimInPoint / video.duration) * 100;
    const endPercent = (trimOutPoint / video.duration) * 100;
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
    if (!video.duration) return;
    video.currentTime = Math.min(video.duration, video.currentTime + frameDuration);
}

// Step backward by one frame
function stepBackward() {
    if (!video.duration) return;
    video.currentTime = Math.max(0, video.currentTime - frameDuration);
}

// Load and play video
async function loadVideo(filePath) {
    video.src = filePath;
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

    video.play().then(() => {
        updatePlayPauseIcon(true);
    }).catch(err => {
        console.error('Error playing video:', err);
    });
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

// Click feedback overlay
const clickFeedback = document.createElement('div');
clickFeedback.id = 'clickFeedback';
clickFeedback.innerHTML = `
    <svg id="feedbackPlayIcon" width="64" height="64" viewBox="0 0 24 24" fill="white">
        <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
    <svg id="feedbackPauseIcon" width="64" height="64" viewBox="0 0 24 24" fill="white" style="display:none">
        <rect x="6" y="4" width="4" height="16"/>
        <rect x="14" y="4" width="4" height="16"/>
    </svg>
`;
document.querySelector('.video-wrapper').appendChild(clickFeedback);

let feedbackTimer = null;
function showClickFeedback(isPaused) {
    const playIc = document.getElementById('feedbackPlayIcon');
    const pauseIc = document.getElementById('feedbackPauseIcon');
    playIc.style.display = isPaused ? 'block' : 'none';
    pauseIc.style.display = isPaused ? 'none' : 'block';
    clickFeedback.classList.add('visible');
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
        clickFeedback.classList.remove('visible');
    }, 500);
}

// Event Listeners

// Open file
openBtn.addEventListener('click', async () => {
    const filePath = await ipcRenderer.invoke('select-file');
    if (filePath) {
        loadVideo(filePath);
    }
});

// Play/Pause
playPauseBtn.addEventListener('click', () => {
    if (video.paused) {
        video.play();
        updatePlayPauseIcon(true);
    } else {
        video.pause();
        updatePlayPauseIcon(false);
    }
});

// Stop
stopBtn.addEventListener('click', () => {
    video.pause();
    video.currentTime = 0;
    updatePlayPauseIcon(false);
});

// Seek controls
back10Btn.addEventListener('click', () => {
    video.currentTime = Math.max(0, video.currentTime - 10);
});

back30Btn.addEventListener('click', () => {
    video.currentTime = Math.max(0, video.currentTime - 30);
});

forward10Btn.addEventListener('click', () => {
    video.currentTime = Math.min(video.duration, video.currentTime + 10);
});

forward30Btn.addEventListener('click', () => {
    video.currentTime = Math.min(video.duration, video.currentTime + 30);
});

// Progress bar click
progressBar.addEventListener('click', (e) => {
    const rect = progressBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    video.currentTime = percent * video.duration;
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

// Speed presets
speedPresets.forEach(btn => {
    btn.addEventListener('click', () => {
        setSpeed(btn.dataset.speed);
    });
});

// Set In point
setInBtn.addEventListener('click', () => {
    if (!video.src) return;
    trimInPoint = video.currentTime;
    inTimeDisplay.textContent = formatTime(trimInPoint);
    updateTrimOverlay();
    updateSaveButtonState();
});

// Set Out point
setOutBtn.addEventListener('click', () => {
    if (!video.src) return;
    trimOutPoint = video.currentTime;
    outTimeDisplay.textContent = formatTime(trimOutPoint);
    updateTrimOverlay();
    updateSaveButtonState();
});

// Save mark
saveMarkBtn.addEventListener('click', async () => {
    if (trimInPoint === null || trimOutPoint === null) return;

    // Validate
    if (trimInPoint >= trimOutPoint) {
        alert('In point must be before out point.');
        return;
    }

    if (video.duration && (trimOutPoint > video.duration)) {
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

// Video events
video.addEventListener('timeupdate', updateProgress);

video.addEventListener('loadedmetadata', () => {
    durationEl.textContent = formatTime(video.duration);
    // Disable trim controls if duration is invalid
    if (!video.duration || isNaN(video.duration)) {
        enableTrimControls(false);
    }
});

video.addEventListener('ended', () => {
    updatePlayPauseIcon(false);
});

video.addEventListener('play', () => {
    updatePlayPauseIcon(true);
});

video.addEventListener('pause', () => {
    updatePlayPauseIcon(false);
});

// Click on video to toggle play/pause with visual feedback
video.addEventListener('click', () => {
    if (!video.src || video.src === window.location.href || playPauseBtn.disabled) return;
    if (video.paused) {
        video.play();
        showClickFeedback(false);
    } else {
        video.pause();
        showClickFeedback(true);
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Don't trigger if typing in an input
    if (e.target.tagName === 'INPUT') return;

    switch(e.key.toLowerCase()) {
        case ' ':
            e.preventDefault();
            if (!playPauseBtn.disabled) {
                playPauseBtn.click();
            }
            break;
        case 'arrowleft':
            e.preventDefault();
            if (!video.src) return;
            // Prevent repeat events - only step once on initial press
            if (!e.repeat) {
                stepBackward();
                // Start continuous stepping while held
                leftArrowInterval = setInterval(() => {
                    stepBackward();
                }, 50); // Step every 50ms while holding
            }
            break;
        case 'arrowright':
            e.preventDefault();
            if (!video.src) return;
            // Prevent repeat events - only step once on initial press
            if (!e.repeat) {
                stepForward();
                // Start continuous stepping while held
                rightArrowInterval = setInterval(() => {
                    stepForward();
                }, 50); // Step every 50ms while holding
            }
            break;
        case 'arrowdown':
            e.preventDefault();
            if (!back30Btn.disabled) {
                back30Btn.click();
            }
            break;
        case 'arrowup':
            e.preventDefault();
            if (!forward30Btn.disabled) {
                forward30Btn.click();
            }
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
    }
});

// Stop continuous frame stepping when arrow keys are released
document.addEventListener('keyup', (e) => {
    switch(e.key.toLowerCase()) {
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
ipcRenderer.on('load-video-from-path', (event, filePath) => {
    loadVideo(filePath);
});
