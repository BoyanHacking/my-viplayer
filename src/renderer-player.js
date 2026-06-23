'use strict';

/**
 * Player — renderer-side playback facade
 * --------------------------------------
 * Mirrors the *surface* renderer.js used against the `<video>` element
 * (load/play/pause/seek/speed/currentTime/duration/paused) but routes every
 * call to the main process (which owns the mpv child) over IPC, and derives
 * its state from mpv `property-change` events rather than the HTML5 media API.
 *
 * This keeps renderer.js's control logic (trim/marks, shortcuts, progress) nearly
 * unchanged: it just talks to `player` instead of `video`.
 */

const { ipcRenderer } = require('electron');

class Player extends EventTarget {
    constructor() {
        super();
        // Live playback state, updated by mpv property-change events.
        this.currentTime = 0;
        this.duration = 0;
        this.paused = true;
        this.speed = 1;
        this.volume = 100;
        this.muted = false;
        this.eofReached = false;
        this.filename = null;
        this.ready = false;       // a file is loaded and we know its duration
        this.trackList = [];

        this._wireIncoming();
    }

    _wireIncoming() {
        ipcRenderer.on('player:event', (_event, payload) => {
            const { name, data } = payload;
            switch (name) {
                case 'time-pos':
                    this.currentTime = (typeof data === 'number') ? data : this.currentTime;
                    this._emit('timeupdate');
                    break;
                case 'duration':
                    this.duration = (typeof data === 'number') ? data : this.duration;
                    if (this.duration) {
                        this.ready = true;
                        this._emit('loadedmetadata');
                    }
                    break;
                case 'pause':
                    this.paused = !!data;
                    this.eofReached = false;
                    this._emit(this.paused ? 'pause' : 'play');
                    break;
                case 'eof-reached':
                    // mpv fires eof-reached when playback ends; with keep-open the
                    // file stays loaded but paused.
                    if (data) {
                        this.eofReached = true;
                        this.paused = true;
                        this._emit('ended');
                    }
                    break;
                case 'speed':
                    this.speed = Number(data) || this.speed;
                    this._emit('ratechange');
                    break;
                case 'volume':
                    this.volume = Number(data) || this.volume;
                    this._emit('volumechange');
                    break;
                case 'mute':
                    this.muted = !!data;
                    this._emit('volumechange');
                    break;
                case 'filename':
                    this.filename = data;
                    break;
                case 'track-list':
                    this.trackList = Array.isArray(data) ? data : [];
                    this._emit('tracklist');
                    break;
                case 'idle-active':
                    if (data) {
                        this.ready = false;
                        this.currentTime = 0;
                        this.duration = 0;
                        this._emit('unloaded');
                    }
                    break;
                case 'file-loaded':
                    this._emit('canplay');
                    break;
                case 'end-file':
                    // (informational) a file is being closed/changed
                    break;
                default:
                    break;
            }
        });
    }

    _emit(type) {
        this.dispatchEvent(new CustomEvent(type));
    }

    on(type, cb) {
        this.addEventListener(type, cb);
        return this;
    }

    /* ---- Commands (all return Promises, mirroring ipcRenderer.invoke) ---- */

    load(filePath) {
        this.ready = false;
        this.currentTime = 0;
        this.duration = 0;
        this.eofReached = false;
        return ipcRenderer.invoke('player:load', filePath);
    }

    play()  { return ipcRenderer.invoke('player:play'); }
    pause() { return ipcRenderer.invoke('player:pause'); }

    togglePlay() {
        return this.paused ? this.play() : this.pause();
    }

    stop() { return ipcRenderer.invoke('player:stop'); }

    /** @param {number} seconds absolute seek target */
    seekTo(seconds) { return ipcRenderer.invoke('player:seek', { mode: 'absolute', value: seconds }); }

    /** @param {number} delta relative seek (seconds, may be negative) */
    seekBy(delta)   { return ipcRenderer.invoke('player:seek', { mode: 'relative', value: delta }); }

    frameStep()     { return ipcRenderer.invoke('player:frame-step'); }
    frameBackStep() { return ipcRenderer.invoke('player:frame-back-step'); }

    setSpeed(n)     { return ipcRenderer.invoke('player:set-speed', Number(n)); }
    setVolume(n)    { return ipcRenderer.invoke('player:set-volume', Number(n)); }
    setMute(bool)   { return ipcRenderer.invoke('player:set-mute', !!bool); }
    toggleMute()    { return this.setMute(!this.muted); }

    /** Forward an OSD text message to be drawn on the mpv surface. */
    showText(text, durationMs) {
        return ipcRenderer.invoke('player:show-text', { text, durationMs });
    }
}

module.exports = { Player };
