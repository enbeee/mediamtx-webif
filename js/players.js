// MM.players — WHEP (WebRTC) playback with HLS fallback.
// Fixes over the old reader.js: Authorization on every request including the
// session DELETE, ICE-gathering timeout (no infinite hang), single retry
// state machine with backoff, strict teardown.
'use strict';
window.MM = window.MM || {};

(function () {
    const HLS_URL = 'https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.min.js';
    const HLS_SRI = 'sha384-iZBI1/lW9u8FcBjxuQ8nPTsU7TXhZNtzkV8H3gQHSTgz+VYQoKWqGlBHqhO84alJ';
    let hlsPromise = null;

    function ensureHls() {
        if (window.Hls) return Promise.resolve(window.Hls);
        if (hlsPromise) return hlsPromise;
        hlsPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = HLS_URL;
            script.integrity = HLS_SRI;
            script.crossOrigin = 'anonymous';
            script.onload = () => resolve(window.Hls);
            script.onerror = () => { hlsPromise = null; reject(new Error('Could not load hls.js (CDN unreachable?).')); };
            document.head.appendChild(script);
        });
        return hlsPromise;
    }

    class WHEPReader {
        /**
         * @param {string} url WHEP endpoint
         * @param {Object} opts {headers, onStatus(status, detail)}
         *   statuses: connecting | live | offline (404, no retry) | error | closed
         */
        constructor(url, opts = {}) {
            this.url = url;
            this.headers = opts.headers || {};
            this.onStatus = opts.onStatus || (() => {});
            this.pc = null;
            this.sessionUrl = null;
            this.closed = false;
            this._retries = 0;
        }

        _status(s, detail) { if (!this.closed) this.onStatus(s, detail); }

        async start() {
            return this._loop();
        }

        async _loop() {
            if (this._looping) return;
            this._looping = true;
            // Retry loop: transient failures back off and retry; after two
            // consecutive failures (or an auth failure) give up and signal
            // 'unrecoverable' so the caller can try a fallback transport.
            try {
                while (!this.closed) {
                    try {
                        return await this._run();
                    } catch (err) {
                        if (this.closed) return;
                        if (err.isNotFound) { this._status('offline', err.message); return; }
                        this._retries += 1;
                        this._status('error', err.message);
                        if (err.isAuth || this._retries >= 2) {
                            this._status('unrecoverable', err.message);
                            return;
                        }
                        await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * this._retries, 8000)));
                    }
                }
            } finally {
                this._looping = false;
            }
        }

        async _run() {
            this._status('connecting');
            const headers = this.headers;

            // WHEP: OPTIONS first to discover ICE servers.
            let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
            try {
                const optRes = await fetch(this.url, { method: 'OPTIONS', headers });
                if (optRes.status === 404) throw this._notFound('Path does not exist or is not available');
                if (optRes.status === 401) throw new Error('Authentication failed for WebRTC (401)');
                const link = optRes.headers.get('Link');
                if (link) {
                    const servers = this._parseIceServers(link);
                    if (servers.length) iceServers = servers;
                }
            } catch (err) {
                if (err.isNotFound) { this._status('offline', err.message); return; }
                // OPTIONS failures are non-fatal (some setups lack CORS on OPTIONS);
                // the POST below surfaces real problems.
            }

            const pc = new RTCPeerConnection({ iceServers });
            this.pc = pc;
            const stream = new MediaStream();
            pc.ontrack = (event) => {
                for (const track of event.streams[0] ? event.streams[0].getTracks() : [event.track]) {
                    if (!stream.getTracks().some((t) => t.id === track.id)) stream.addTrack(track);
                }
                this._status('live');
            };
            pc.onconnectionstatechange = () => {
                if (this.closed) return;
                const state = pc.connectionState;
                if (state === 'failed') {
                    this._teardownPeer();
                    this._loop();
                }
            };
            pc.addTransceiver('video', { direction: 'recvonly' });
            pc.addTransceiver('audio', { direction: 'recvonly' });

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await this._waitForIce(pc, 4000);

            const res = await fetch(this.url, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/sdp' },
                body: pc.localDescription.sdp,
            });
            if (res.status === 404) throw this._notFound('Stream not found (path not publishing?)');
            if (res.status === 401) { const e = new Error('Authentication failed for WebRTC (401)'); e.isAuth = true; throw e; }
            if (res.status === 415) throw new Error('Server rejected the WebRTC offer (415): no compatible tracks');
            if (!res.ok) throw new Error('WHEP setup failed: HTTP ' + res.status);

            this.sessionUrl = res.headers.get('Location') || this.url;
            const answerSdp = await res.text();
            await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

            this._retries = 0;
            return stream;
        }

        _notFound(message) {
            const err = new Error(message);
            err.isNotFound = true;
            return err;
        }

        _parseIceServers(linkHeader) {
            const servers = [];
            for (const part of linkHeader.split(',')) {
                const m = /<([^>]+)>;\s*rel="ice-server"/.exec(part) || /<([^>]+)>;\s*rel=ice-server/.exec(part);
                if (m) {
                    try { servers.push({ urls: m[1] }); } catch (e) { /* ignore malformed */ }
                }
            }
            return servers;
        }

        // Resolve after gathering completes, or after `ms` — never hang forever.
        _waitForIce(pc, ms) {
            if (pc.iceGatheringState === 'complete') return Promise.resolve();
            return new Promise((resolve) => {
                const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', onChange); resolve(); };
                const onChange = () => { if (pc.iceGatheringState === 'complete') done(); };
                const timer = setTimeout(done, ms);
                pc.addEventListener('icegatheringstatechange', onChange);
            });
        }

        _teardownPeer() {
            if (this.pc) {
                try { this.pc.close(); } catch (e) { /* noop */ }
                this.pc = null;
            }
        }

        close() {
            if (this.closed) return;
            this.closed = true;
            const sessionUrl = this.sessionUrl;
            this._teardownPeer();
            if (sessionUrl) {
                // Send the Authorization header: without it, teardown 401s and
                // the session leaks until the server-side timeout.
                fetch(sessionUrl, { method: 'DELETE', headers: this.headers }).catch(() => {});
            }
            this._status('closed');
        }
    }

    // ---------- HLS ----------
    async function playHls(videoEl, url, { onStatus } = {}) {
        const Hls = await ensureHls();
        if (videoEl.canPlayType('application/vnd.apple.mpegurl') && !Hls.isSupported()) {
            videoEl.src = url;
            return { destroy() { videoEl.removeAttribute('src'); videoEl.load(); } };
        }
        const hls = new Hls({ maxBufferLength: 10 });
        let firstError = null;
        hls.loadSource(url);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { if (onStatus) onStatus('live'); });
        hls.on(Hls.Events.ERROR, (event, data) => {
            if (!data.fatal) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && (data.details === 'manifestLoadError' || data.details === 'manifestParsingError')) {
                firstError = firstError || new Error('HLS failed: ' + data.details + ' (check CORS/encryption/auth on the HLS port)');
                if (onStatus) onStatus('error', firstError.message);
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                hls.recoverMediaError();
            } else {
                firstError = firstError || new Error('HLS failed: ' + data.details);
                if (onStatus) onStatus('error', firstError.message);
            }
        });
        return {
            destroy() { try { hls.destroy(); } catch (e) { /* noop */ } },
        };
    }

    // ---------- Player manager ----------
    const controllers = new Map(); // path -> controller

    function stopPlayer(controller) {
        if (!controller || controller.destroyed) return;
        controller.destroyed = true;
        controllers.delete(controller.path);
        if (controller.reader) controller.reader.close();
        if (controller.hls) controller.hls.destroy();
        controller.video.removeAttribute('src');
        try { controller.video.load(); } catch (e) { /* noop */ }
        controller.video.srcObject = null;
    }

    function stopAll() {
        for (const c of [...controllers.values()]) stopPlayer(c);
    }

    /**
     * Start playback for one path into `videoEl`. Tries WHEP first; on a
     * transport-level failure falls back to HLS once.
     * @returns controller — pass to stopPlayer()
     */
    function startPlayer(videoEl, path, { global, headers, onStatus }) {
        stopPlayer(controllers.get(path));
        const controller = { path, video: videoEl, reader: null, hls: null, mode: null, destroyed: false, status: null };
        controllers.set(path, controller);
        const api = MM.api;

        const webrtcBase = api.webrtcBase(global);
        const hlsBase = api.hlsBase(global);
        const notify = (status, detail) => {
            if (controller.destroyed) return;
            controller.status = status;
            if (onStatus) onStatus(status, detail);
        };

        async function startHlsFallback(reason) {
            if (controller.fallbackTried) { notify('error', 'WebRTC: ' + reason); return; }
            controller.fallbackTried = true;
            if (!hlsBase) { notify('error', 'WebRTC: ' + reason); return; }
            controller.mode = 'hls';
            notify('connecting', 'WebRTC failed (' + reason + '); trying HLS…');
            controller.hls = await playHls(videoEl, hlsBase + '/' + encodeURIComponent(path) + '/index.m3u8', {
                onStatus: (status, detail) => {
                    if (status === 'live') notify('live', 'via HLS');
                    else if (status === 'error') notify('error', detail);
                },
            });
            videoEl.play().catch(() => {});
        }

        (async () => {
            if (!webrtcBase) { await startHlsFallback('WebRTC address unknown'); return; }
            controller.mode = 'webrtc';
            const reader = new WHEPReader(webrtcBase + '/' + encodeURIComponent(path) + '/whep', {
                headers,
                onStatus: (status, detail) => {
                    if (controller.destroyed) return;
                    if (status === 'live') { notify('live', 'via WebRTC'); return; }
                    if (status === 'unrecoverable') {
                        reader.close();
                        startHlsFallback(detail).catch((e) => notify('error', e.message));
                        return;
                    }
                    notify(status, detail);
                },
            });
            controller.reader = reader;
            const stream = await reader.start();
            if (controller.destroyed) { reader.close(); return; }
            if (stream) {
                videoEl.srcObject = stream;
                videoEl.play().catch(() => {});
            }
        })();

        return controller;
    }

    MM.players = { WHEPReader, ensureHls, startPlayer, stopPlayer, stopAll };
})();
