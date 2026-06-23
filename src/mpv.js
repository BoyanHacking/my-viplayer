'use strict';

/**
 * MpvController
 * --------------
 * Spawns mpv as a child process in idle mode, reparented into a host window via
 * `--wid`, and drives it over its JSON IPC (named pipe on Windows, unix domain
 * socket on macOS/Linux). Provides Promise-based command methods and an
 * EventEmitter surface for property changes and mpv events.
 *
 * This is the playback core that replaces Chromium's `<video>` element, so that
 * AC3 / EAC3 / DTS / TrueHD (unsupported by the HTML5 media pipeline) decode
 * correctly. See issue #2.
 */

const { spawn } = require('child_process');
const net = require('net');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const fs = require('fs');

class MpvController extends EventEmitter {
    /**
     * @param {object} opts
     * @param {string} opts.executable  Absolute path to the mpv binary.
     * @param {number|string} opts.wid  Native window id to render into (HWND on win, NSView ptr on mac, X11 id on linux).
     * @param {string} [opts.instanceId] Unique id used to derive a unique ipc socket path. Defaults to process.pid.
     * @param {number} [opts.connectTimeoutMs=5000]  How long to wait for the ipc socket to appear.
     * @param {boolean} [opts.logIpc=false]          Verbose logging of ipc traffic (debug).
     */
    constructor(opts) {
        super();
        this.executable = opts.executable;
        this.wid = String(opts.wid);
        this.instanceId = opts.instanceId || String(process.pid);
        this.connectTimeoutMs = opts.connectTimeoutMs != null ? opts.connectTimeoutMs : 5000;
        this.logIpc = !!opts.logIpc;

        this.proc = null;
        this.socket = null;
        this._reqId = 0;
        this._pending = new Map(); // request_id -> {resolve, reject, command}
        this._observed = new Map(); // name -> id  (property name -> observer id)
        this._buffer = '';
        this._ipcPath = this._deriveIpcPath();
        this._started = false;
        this._intentionalQuit = false;
        this._socketFileToDelete = null;
    }

    /* ------------------------------------------------------------------ *
     * Lifecycle
     * ------------------------------------------------------------------ */

    /**
     * Spawn mpv and connect to its ipc socket. Resolves once the socket is
     * connected and ready to accept commands.
     */
    async start() {
        if (this._started) return;
        this._started = true;

        const args = [
            '--idle=yes',
            `--wid=${this.wid}`,
            `--input-ipc-server=${this._ipcPath}`,
            '--no-config',
            '--no-terminal',
            '--no-osc',           // we provide our own controls
            '--force-window=no',  // no standalone window; render only into --wid
            '--keep-open=yes',    // pause at end instead of closing (matches old behavior)
            '--hwdec=auto-safe',  // gpu decode when available
            '--no-input-default-bindings',
            '--no-input-terminal',
            '--osd-font-size=32',
            '--osd-duration=600',
            // Sensible defaults; keep volume starting at 100 (mpv default).
        ];

        // Optional extra args for debugging / portability (e.g. forcing a
        // software video output under a headless environment). Does not affect
        // production defaults. Set MYVIPLAYER_MPV_EXTRA_ARGS="--vo=x11 --v".
        if (process.env.MYVIPLAYER_MPV_EXTRA_ARGS) {
            args.push(...process.env.MYVIPLAYER_MPV_EXTRA_ARGS.split(/\s+/).filter(Boolean));
        }

        this.proc = spawn(this.executable, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: false,
        });

        this.proc.once('error', (err) => {
            this.emit('error', new Error(`Failed to spawn mpv: ${err.message}`));
        });

        this.proc.once('exit', (code, signal) => {
            this._onProcExit(code, signal);
        });

        if (this.proc.stdout) {
            this.proc.stdout.on('data', () => { /* swallowed; mpv is --no-terminal */ });
        }
        if (this.proc.stderr) {
            this.proc.stderr.on('data', (d) => {
                const msg = d.toString().trim();
                if (msg) this.emit('log', msg);
            });
        }

        await this._connectSocket();
        // observe core properties the renderer needs
        await this._observeCoreProperties();
        this.emit('ready');
    }

    /**
     * Gracefully shut mpv down. Safe to call multiple times.
     * @param {number} [forceKillMs=1500] Wait this long for mpv to quit, then SIGKILL.
     */
    async quit(forceKillMs = 1500) {
        this._intentionalQuit = true;
        if (!this.proc) return;

        let timer = null;
        try {
            await Promise.race([
                this.command(['quit']).catch(() => {}),
                new Promise((resolve) => {
                    timer = setTimeout(resolve, forceKillMs);
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }

        if (this.proc && !this.proc.killed && this.proc.exitCode === null) {
            try { this.proc.kill('SIGKILL'); } catch (_) {}
        }
        if (this.socket) {
            try { this.socket.destroy(); } catch (_) {}
            this.socket = null;
        }
        this._cleanupSocketFile();
    }

    /* ------------------------------------------------------------------ *
     * Public command API (Promise based)
     * ------------------------------------------------------------------ */

    /** @returns {Promise<object>} resolved value is mpv's `data` field (may be null). */
    command(args, opts = {}) {
        return new Promise((resolve, reject) => {
            if (!this.socket || this.socket.destroyed) {
                reject(new Error('mpv socket not connected'));
                return;
            }
            const id = ++this._reqId;
            const msg = {
                command: args,
                request_id: id,
            };
            if (opts.async) msg.async = true;

            this._pending.set(id, { resolve, reject, command: args });

            this._sendRaw(msg);
            // Safety timeout so a dropped response never hangs a caller.
            setTimeout(() => {
                if (this._pending.has(id)) {
                    this._pending.delete(id);
                    reject(new Error(`mpv command timed out: ${JSON.stringify(args)}`));
                }
            }, opts.timeoutMs || 8000);
        });
    }

    /** Observe a property; changes emit as `property:<name>` and `property-change`. */
    async observeProperty(name) {
        if (this._observed.has(name)) return this._observed.get(name);
        const id = ++this._reqId;
        this._observed.set(name, id);
        await this.command(['observe_property', id, name]);
        return id;
    }

    /* ---- High-level playback helpers ---- */

    async loadFile(filePath) {
        // replace=true so loading a new file swaps the current one
        await this.command(['loadfile', filePath, 'replace']);
    }

    async play()  { await this.command(['set_property', 'pause', false]); }
    async pause() { await this.command(['set_property', 'pause', true]); }
    async stop()  { await this.command(['stop']); }

    /** @param {number} seconds  absolute target time */
    async seekAbsolute(seconds) {
        await this.command(['seek', seconds, 'absolute', 'exact'], { async: true });
    }

    /** @param {number} delta  relative seconds (may be negative) */
    async seekRelative(delta) {
        await this.command(['seek', delta, 'relative', 'exact'], { async: true });
    }

    async setSpeed(n) { await this.command(['set_property', 'speed', Number(n)]); }

    async setVolume(n) { await this.command(['set_property', 'volume', Number(n)]); }

    async setMute(bool) { await this.command(['set_property', 'mute', !!bool]); }

    async frameStep()     { await this.command(['frame-step']); }
    async frameBackStep() { await this.command(['frame-back-step']); }

    async getProperty(name) {
        const res = await this.command(['get_property', name]);
        return res;
    }

    /** Show a transient OSD message on the mpv surface. */
    async showText(text, durationMs = 600) {
        await this.command(['show-text', String(text), durationMs], { async: true });
    }

    /* ------------------------------------------------------------------ *
     * Internals
     * ------------------------------------------------------------------ */

    _deriveIpcPath() {
        if (process.platform === 'win32') {
            // Windows named pipe. Must match what mpv's --input-ipc-server expects.
            return `\\\\.\\pipe\\myviplayer-mpv-${this.instanceId}`;
        }
        // unix domain socket
        const file = path.join(os.tmpdir(), `myviplayer-mpv-${this.instanceId}.sock`);
        this._socketFileToDelete = file;
        return file;
    }

    _connectSocket() {
        return new Promise((resolve, reject) => {
            const deadline = Date.now() + this.connectTimeoutMs;
            let lastErr = null;

            const tryConnect = () => {
                if (Date.now() > deadline) {
                    reject(new Error(`Timed out connecting to mpv ipc socket at ${this._ipcPath}. Last error: ${lastErr}`));
                    return;
                }
                const sock = process.platform === 'win32'
                    ? net.connect(this._ipcPath)
                    : net.connect(this._ipcPath);

                sock.once('connect', () => {
                    this.socket = sock;
                    this._wireSocket(sock);
                    resolve();
                });
                sock.once('error', (err) => {
                    lastErr = err;
                    sock.destroy();
                    setTimeout(tryConnect, 100);
                });
            };
            tryConnect();
        });
    }

    _wireSocket(sock) {
        sock.setEncoding('utf8');
        sock.on('data', (chunk) => {
            this._buffer += chunk;
            let idx;
            while ((idx = this._buffer.indexOf('\n')) >= 0) {
                const line = this._buffer.slice(0, idx);
                this._buffer = this._buffer.slice(idx + 1);
                if (line.trim()) this._handleLine(line);
            }
        });
        sock.on('error', (err) => {
            this.emit('error', new Error(`mpv ipc socket error: ${err.message}`));
        });
        sock.on('close', () => {
            // Reject any in-flight requests; they'll never get a reply.
            for (const [, p] of this._pending) {
                try { p.reject(new Error('mpv ipc socket closed')); } catch (_) {}
            }
            this._pending.clear();
        });
    }

    _handleLine(line) {
        let msg;
        try {
            msg = JSON.parse(line);
        } catch (_) {
            if (this.logIpc) console.warn('[mpv] non-JSON line:', line);
            return;
        }
        if (this.logIpc) console.debug('[mpv<-]', line);

        if ('request_id' in msg) {
            const p = this._pending.get(msg.request_id);
            if (!p) return;
            this._pending.delete(msg.request_id);
            if (msg.error && msg.error !== 'success') {
                p.reject(new Error(`mpv error: ${msg.error} (${JSON.stringify(p.command)})`));
            } else {
                p.resolve(msg.data);
            }
            return;
        }
        if (msg.event) {
            this.emit('event', msg.event, msg);
            if (msg.event === 'property-change') {
                this.emit('property-change', msg);
                this.emit(`property:${msg.name}`, msg.data, msg);
            } else {
                this.emit(msg.event, msg);
            }
        }
    }

    _sendRaw(obj) {
        if (!this.socket || this.socket.destroyed) return;
        const data = JSON.stringify(obj) + '\n';
        if (this.logIpc) console.debug('[mpv->]', data.trim());
        this.socket.write(data);
    }

    async _observeCoreProperties() {
        const props = [
            'time-pos',       // current playback time (null when idle)
            'duration',       // file duration
            'pause',          // paused state
            'eof-reached',    // end of file
            'idle-active',    // no file loaded
            'volume',         // current volume
            'mute',           // mute state
            'speed',          // playback rate
            'filename',       // currently loaded file basename
            'track-list',     // audio/sub/video tracks (for later UI)
        ];
        for (const p of props) {
            try { await this.observeProperty(p); } catch (e) { /* non-fatal */ }
        }
    }

    _cleanupSocketFile() {
        if (process.platform === 'win32') return; // named pipes auto-clean
        if (this._socketFileToDelete) {
            try { fs.unlinkSync(this._socketFileToDelete); } catch (_) {}
            this._socketFileToDelete = null;
        }
    }

    _onProcExit(code, signal) {
        this.proc = null;
        // reject stragglers
        for (const [, p] of this._pending) {
            try { p.reject(new Error('mpv process exited')); } catch (_) {}
        }
        this._pending.clear();
        this._cleanupSocketFile();

        if (this._intentionalQuit) {
            this.emit('exited', { code, signal, intentional: true });
            return;
        }
        // Unexpected crash -> give listeners a chance to restart.
        this.emit('crashed', { code, signal });
        this._started = false;
    }
}

module.exports = { MpvController };
