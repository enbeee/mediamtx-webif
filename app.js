// MediaMTX Web Interface Application
class MediaMTXApp {
    constructor() {
        this.apiBase = 'http://localhost:9997/v3';
        this.globalData = null;
        this.paths = [];
        this.recordings = [];
        this.instances = this.loadInstances();
        this.currentInstanceId = null;
        this._readers = new Map();  // path -> { reader, mediaStream }
        this._playerRefreshInterval = null;
        this.init();
    }

    loadInstances() {
        try {
            const stored = localStorage.getItem('mediamtx_instances');
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (error) {
            console.error('Error loading instances from localStorage:', error);
        }
        return [];
    }

    saveInstances() {
        localStorage.setItem('mediamtx_instances', JSON.stringify(this.instances));
    }

    getInstanceAuth(instanceId) {
        const instance = this.instances.find(i => i.id === instanceId);
        if (!instance || (!instance.user && !instance.pass)) {
            return {};
        }
        return { user: instance.user, pass: instance.pass };
    }

    loadInstanceSelector() {
        const selector = document.getElementById('instanceSelector');
        if (!selector) {
            console.error('Instance selector element not found!');
            return;
        }

        console.log('Populating instance selector with:', this.instances);
        selector.innerHTML = this.instances.map(inst => {
            const hasAuth = inst.user && inst.pass;
            const authIcon = hasAuth ? ' 🔒' : '';
            return '<option value="' + inst.id + '"' + (inst.id === this.currentInstanceId ? ' selected' : '') + '>' +
                this.escapeHtml(inst.name) + authIcon + '</option>';
        }).join('');

        selector.addEventListener('change', () => {
            this.switchInstance(selector.value);
        });
    }

    selectCurrentInstance() {
        const lastInstanceId = localStorage.getItem('mediamtx_current_instance');
        if (lastInstanceId) {
            const inst = this.instances.find(i => i.id === lastInstanceId);
            if (inst) {
                this.currentInstanceId = lastInstanceId;
            }
        }
        if (!this.currentInstanceId && this.instances.length > 0) {
            this.currentInstanceId = this.instances[0].id;
        }
        this.updateApiBase();
    }

    updateApiBase() {
        const instance = this.instances.find(i => i.id === this.currentInstanceId);
        if (instance) {
            const url = instance.url.replace(/\/$/, '');
            this.apiBase = url + '/v3';
        }
    }

    switchInstance(instanceId) {
        this.destroyPlayers();
        this.currentInstanceId = instanceId;
        localStorage.setItem('mediamtx_current_instance', instanceId);
        this.updateApiBase();
        this.checkConnection().then(connected => {
            if (connected) {
                this.loadAllData();
            }
        });
    }

    addInstance(name, url, user = '', pass = '') {
        const id = 'inst_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.instances.push({ id, name, url, user, pass });
        this.saveInstances();
        this.loadInstanceSelector();
        this.switchInstance(id);
        this.showToast('Instance added successfully', 'success');
    }

    updateInstance(id, name, url, user = '', pass = '') {
        const index = this.instances.findIndex(i => i.id === id);
        if (index >= 0) {
            this.instances[index] = { id, name, url, user, pass };
            this.saveInstances();
            this.loadInstanceSelector();
            if (id === this.currentInstanceId) {
                this.updateApiBase();
            }
        }
        this.showToast('Instance updated successfully', 'success');
    }

    deleteInstance(id) {
        if (this.instances.length <= 1) {
            this.showToast('Cannot delete the last instance', 'error');
            return;
        }
        const index = this.instances.findIndex(i => i.id === id);
        this.instances.splice(index, 1);
        this.saveInstances();

        this.loadInstanceSelector();

        if (id === this.currentInstanceId) {
            this.switchInstance(this.instances[0]?.id);
        }

        this.showToast('Instance deleted successfully', 'success');
    }

    setupEventListeners() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = item.dataset.section;
                this.navigateTo(section);
            });
        });

        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.slice(1);
            if (hash) {
                this.navigateTo(hash);
            }
        });

        document.getElementById('addInstanceBtn').addEventListener('click', () => {
            this.showInstanceModal();
        });

        document.getElementById('editInstanceBtn').addEventListener('click', () => {
            const currentInstance = this.instances.find(i => i.id === this.currentInstanceId);
            if (currentInstance) {
                this.showInstanceModal(currentInstance.id);
            }
        });

        document.getElementById('deleteInstanceBtn').addEventListener('click', () => {
            this.deleteCurrentInstance();
        });
    }

    init() {
        console.log('Initializing MediaMTX App...');
        console.log('Loaded instances:', this.instances);
        this.setupEventListeners();
        this.loadInstanceSelector();
        this.selectCurrentInstance();
        console.log('Current instance ID:', this.currentInstanceId);
        console.log('API Base URL:', this.apiBase);

        if (this.instances.length === 0) {
            this.showToast('No instances configured. Click + to add a MediaMTX instance.', 'error');
            document.getElementById('connectionStatusText').textContent = 'No instances';
            document.getElementById('serverVersion').textContent = 'No instance configured';
            return;
        }

        this.checkConnection().then(connected => {
            if (connected) {
                this.loadAllData();
            }
        }).catch(error => {
            console.error('Initialization error:', error);
        });
    }

    async loadAllData() {
        // loadGlobalConfig MUST finish first — loadVideoPlayers depends on globalData
        // (specifically webrtcEncryption to pick http vs https for WHEP URLs)
        await this.loadGlobalConfig();

        const results = await Promise.allSettled([
            this.loadPaths(),
            this.loadConnections(),
            this.loadUsers(),
            this.loadServices(),
            this.loadRecordings(),
            this.loadVideoPlayers()
        ]);

        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) {
            console.error('Some data loading failed:', failed);
        }

        this.updateDashboard();
    }

    async loadGlobalConfig() {
        try {
            this.globalData = await this.apiCall('/config/global/get');
        } catch (error) {
            console.error('Error loading global config:', error);
        }
    }

    async loadPaths() {
        try {
            const response = await this.apiCall('/config/paths/list');
            this.paths = response.items || [];
            this.renderPaths();
        } catch (error) {
            console.error('Error loading paths:', error);
            const instance = this.instances.find(i => i.id === this.currentInstanceId);
            this.showToast('Failed to load paths from ' + (instance?.name || 'instance') + ': ' + error.message, 'error');
        }
    }

    async loadConnections() {
        const results = await Promise.allSettled([
            this.apiCall('/rtspsessions/list'),
            this.apiCall('/rtmpconns/list'),
            this.apiCall('/srtconns/list'),
            this.apiCall('/webrtcsessions/list')
        ]);

        const [rtsp, rtmp, srt, webrtc] = results.map(r =>
            r.status === 'fulfilled' ? (r.value.items || []) : []
        );

        this._lastConnCounts = [rtsp.length, rtmp.length, srt.length, webrtc.length];
        this.renderMultiViewConnections({ rtsp, rtmp, srt, webrtc });
    }

    renderMultiViewConnections(connections) {
        const container = document.getElementById('connectionsList');
        const typeLabels = {
            rtsp: 'RTSP',
            rtmp: 'RTMP',
            srt: 'SRT',
            webrtc: 'WebRTC'
        };

        let html = '';

        for (const [type, conns] of Object.entries(connections)) {
            const typeLabel = typeLabels[type] || type.toUpperCase();
            const count = conns.length;

            html += '<div class="conn-type-section">' +
                '<h3 class="conn-type-title">' + typeLabel + ' Connections <span class="count">(' + count + ')</span></h3>';

            if (count === 0) {
                html += '<p class="text-muted">No active ' + typeLabel + ' connections.</p>';
            } else {
                html += '<div class="connections-grid">' +
                    conns.map(conn => {
                        const safeId = this.escapeHtml(conn.id || '');
                        const safeAddr = this.escapeHtml(conn.remoteAddr || 'Unknown address');
                        return '<div class="connection-card">' +
                            '<div class="card-header">' +
                                '<div>' +
                                    '<h3 class="card-title">' + (safeId || 'Unknown') + '</h3>' +
                                    '<p class="card-subtitle">' + safeAddr + '</p>' +
                                '</div>' +
                                '<div class="card-actions">' +
                                    '<button class="btn btn-icon" onclick="app.showConnDetail(\'' + safeId + '\', \'' + type + '\')" title="View Details">' +
                                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>' +
                                        '</svg>' +
                                    '</button>' +
                                    '<button class="btn btn-icon" onclick="app.kickConnection(\'' + safeId + '\', \'' + type + '\')" title="Kick" style="color: var(--danger-color)">' +
                                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="18" y2="6"></line><line x1="6" y1="18" x2="18" y2="6"></line>' +
                                        '</svg>' +
                                    '</button>' +
                                '</div>' +
                            '</div>' +
                            '<div class="card-body">' +
                                '<div class="info-item"><span class="info-label">State</span><span class="info-value">' + (conn.state || 'Unknown') + '</span></div>' +
                                '<div class="info-item"><span class="info-label">Path</span><span class="info-value">' + (conn.path || 'N/A') + '</span></div>' +
                                '<div class="info-item"><span class="info-label">User</span><span class="info-value">' + (conn.user || 'N/A') + '</span></div>' +
                                '<div class="info-item"><span class="info-label">Created</span><span class="info-value">' + this.formatDate(conn.created) + '</span></div>' +
                            '</div>' +
                        '</div>';
                    }).join('') +
                '</div>';
            }

            html += '</div>';
        }

        container.innerHTML = html;
    }

    async loadVideoPlayers() {
        try {
            // Get all active connections
            const results = await Promise.allSettled([
                this.apiCall('/rtspsessions/list'),
                this.apiCall('/rtmpconns/list'),
                this.apiCall('/srtconns/list'),
                this.apiCall('/webrtcsessions/list')
            ]);

            const [rtsp, rtmp, srt, webrtc] = results.map(r =>
                r.status === 'fulfilled' ? (r.value.items || []) : []
            );

            // Build connection info per path
            const connectionMap = new Map();
            const addConn = (conn, type) => {
                if (!conn.path) return;
                if (!connectionMap.has(conn.path)) {
                    connectionMap.set(conn.path, { types: [], count: 0 });
                }
                const entry = connectionMap.get(conn.path);
                if (!entry.types.includes(type)) entry.types.push(type);
                entry.count++;
            };
            rtsp.forEach(c => addConn(c, 'RTSP'));
            rtmp.forEach(c => addConn(c, 'RTMP'));
            srt.forEach(c => addConn(c, 'SRT'));
            webrtc.forEach(c => addConn(c, 'WebRTC'));

            // Fetch all configured paths
            const pathsConfig = await this.apiCall('/config/paths/list');
            const pathItems = pathsConfig.items || [];

            // Fetch runtime paths — includes dynamic paths (e.g. published via all_others)
            // that may not appear in config/paths/list
            let runtimePaths = new Map();
            try {
                const rpResp = await this.apiCall('/paths/list');
                (rpResp.items || []).forEach(p => {
                    if (p.name) runtimePaths.set(p.name, p);
                });
            } catch (e) {}

            // Also check HLS muxers as a source-availability signal
            let hlsPaths = new Set();
            try {
                const hlsMuxers = await this.apiCall('/hlsmuxers/list');
                (hlsMuxers.items || []).forEach(m => { if (m.path) hlsPaths.add(m.path); });
            } catch (e) {}

            const pathRecordState = {};
            pathItems.forEach(p => { pathRecordState[p.name] = p.record || false; });

            // Auto-disable recording for dynamic paths (no config entry, likely from all_others)
            const allDynamicPaths = new Set([...connectionMap.keys(), ...runtimePaths.keys()]);
            for (const pathName of allDynamicPaths) {
                if (pathName === 'all_others') continue;
                if (!(pathName in pathRecordState)) {
                    try {
                        await this.apiCall('/config/paths/add/' + encodeURIComponent(pathName), {
                            method: 'POST',
                            body: JSON.stringify({ record: false })
                        });
                        pathRecordState[pathName] = false;
                    } catch (e) {
                        try {
                            await this.apiCall('/config/paths/patch/' + encodeURIComponent(pathName), {
                                method: 'PATCH',
                                body: JSON.stringify({ record: false })
                            });
                            pathRecordState[pathName] = false;
                        } catch (e2) {}
                    }
                }
            }

            // Build stream objects for ALL paths (hide "all_others" catch-all)
            const streamMap = new Map();

            pathItems.forEach(p => {
                if (p.name === 'all_others') return;
                const conn = connectionMap.get(p.name) || { types: [], count: 0 };
                const hasSource = p.ready === true || p.available === true || p.online === true || conn.count > 0 || hlsPaths.has(p.name);
                streamMap.set(p.name, {
                    path: p.name,
                    ready: hasSource,
                    connectionTypes: conn.types,
                    connectionCount: conn.count,
                    recording: pathRecordState[p.name] || false,
                });
            });

            // Dynamic paths from runtime API (e.g. published via all_others)
            for (const [pathName, rp] of runtimePaths) {
                if (pathName === 'all_others') continue;
                const rpReady = rp.ready || rp.available || rp.online;
                if (streamMap.has(pathName)) {
                    // Update readiness from runtime data
                    const existing = streamMap.get(pathName);
                    if (rpReady) existing.ready = true;
                    continue;
                }
                const conn = connectionMap.get(pathName) || { types: [], count: 0 };
                streamMap.set(pathName, {
                    path: pathName,
                    ready: rpReady || conn.count > 0 || hlsPaths.has(pathName),
                    connectionTypes: conn.types,
                    connectionCount: conn.count,
                    recording: pathRecordState[pathName] || false,
                });
            }

            // Dynamic paths from connections (fallback)
            for (const [pathName, conn] of connectionMap) {
                if (!streamMap.has(pathName)) {
                    streamMap.set(pathName, {
                        path: pathName,
                        ready: true,
                        connectionTypes: conn.types,
                        connectionCount: conn.count,
                        recording: pathRecordState[pathName] || false,
                    });
                }
            }

            this._lastPlayerCount = streamMap.size;
            await this.ensureWebRTCReachability();
            this.renderVideoPlayers(Array.from(streamMap.values()));
        } catch (error) {
            console.error('Error loading video players:', error);
        }

        // Start auto-refresh (5s) so players start when a source connects
        if (!this._playerRefreshInterval) {
            this._playerRefreshInterval = setInterval(() => this.loadVideoPlayers(), 5000);
        }
    }

    async ensureWebRTCReachability() {
        if (this._webrtcHostsPatched) return;
        const instance = this.instances.find(i => i.id === this.currentInstanceId);
        let baseHost;
        try { baseHost = new URL(instance?.url || '').hostname; } catch (e) { return; }
        const currentHosts = this.globalData?.webrtcAdditionalHosts || [];
        if (currentHosts.includes(baseHost)) { this._webrtcHostsPatched = true; return; }
        try {
            await this.apiCall('/config/global/patch', {
                method: 'PATCH',
                body: JSON.stringify({ webrtcAdditionalHosts: [...currentHosts, baseHost] })
            });
            if (this.globalData) this.globalData.webrtcAdditionalHosts = [...currentHosts, baseHost];
            this._webrtcHostsPatched = true;
        } catch (e) {}
    }

    async renderVideoPlayers(streams) {
        const container = document.getElementById('playersList');

        if (streams.length === 0) {
            this.destroyPlayers();
            container.innerHTML = '<div class="empty-state"><p class="text-muted">No paths configured. Add a path to see the video player.</p></div>';
            return;
        }

        const instance = this.instances.find(i => i.id === this.currentInstanceId);
        const instanceUrl = instance?.url || 'http://localhost:9997';

        let baseHost;
        try {
            const urlObj = new URL(instanceUrl);
            baseHost = urlObj.hostname;
        } catch (e) {
            baseHost = 'localhost';
        }

        const webrtcEncrypted = this.globalData?.webrtcEncryption === true;

        if (webrtcEncrypted) {
            const certAccepted = await this.probeCertAccepted(baseHost, 8889);
            if (!certAccepted) {
                this.destroyPlayers();
                container.innerHTML =
                    '<div class="cert-accept-banner">' +
                        '<h3>WebRTC Certificate Required</h3>' +
                        '<p>The WebRTC server uses a self-signed certificate. Click below to accept it.</p>' +
                        '<button class="btn btn-primary btn-lg" onclick="app.acceptWebRTCCert(\'' + this.escapeHtml(baseHost) + '\')">' +
                            'Accept Certificate' +
                        '</button>' +
                    '</div>';
                return;
            }
        }

        const whepScheme = webrtcEncrypted ? 'https' : 'http';
        const auth = this.getInstanceAuth(this.currentInstanceId);
        const self = this;

        const currentPaths = new Set(streams.map(s => s.path));
        const renderedPaths = this._renderedPaths || new Set();
        const pathsChanged = currentPaths.size !== renderedPaths.size ||
            [...currentPaths].some(p => !renderedPaths.has(p));

        // Also detect state changes (ready, connection types) for existing paths
        let statesChanged = false;
        if (!pathsChanged && this._renderedStates) {
            for (const stream of streams) {
                const key = stream.ready + '|' + stream.connectionTypes.join(',');
                if (this._renderedStates.get(stream.path) !== key) {
                    statesChanged = true;
                    break;
                }
            }
        }
        const needsRender = pathsChanged || statesChanged;

        // Close readers for streams that no longer exist or went offline
        for (const [path, entry] of this._readers) {
            if (!currentPaths.has(path)) {
                try { entry.reader.close(); } catch (e) {}
                this._readers.delete(path);
            } else if (entry.reader.state === 'closed') {
                // Reader stopped itself (e.g. stream not found) — remove it
                // so it can be recreated when the source comes back
                const stream = streams.find(s => s.path === path);
                if (stream && !stream.ready) {
                    this._readers.delete(path);
                    const safePath = path.replace(/[^a-zA-Z0-9_-]/g, '');
                    const loadingEl = document.getElementById('loading-' + safePath);
                    if (loadingEl) {
                        loadingEl.innerHTML = 'Waiting for source...';
                        loadingEl.style.display = 'flex';
                    }
                    const videoEl = document.getElementById('video-' + safePath);
                    if (videoEl) videoEl.srcObject = null;
                }
            }
        }

        // Only re-render HTML if paths or stream states actually changed
        if (needsRender) {
            container.innerHTML = streams.map(stream => {
                const safePath = stream.path.replace(/[^a-zA-Z0-9_-]/g, '');
                const hasReader = this._readers.has(stream.path);
                const connectionBadges = stream.connectionTypes.length > 0
                    ? stream.connectionTypes.map(t => '<span class="status-badge online">' + t + '</span>').join(' ')
                    : '<span class="status-badge offline">Offline</span>';
                const encodedPath = encodeURIComponent(stream.path);
                const isRecording = stream.recording === true;
                const loadingStyle = hasReader ? ' style="display:none"' : '';
                const loadingContent = hasReader ? '' : '<div class="spinner"></div>Connecting...';

                return '<div class="video-player-card">' +
                    '<div class="player-header">' +
                        '<h3>' + this.escapeHtml(stream.path) + '</h3>' +
                        '<div class="connection-badges">' + connectionBadges + '</div>' +
                    '</div>' +
                    '<div class="video-player-wrapper">' +
                        '<video id="video-' + safePath + '" class="video-player-video" autoplay muted playsinline></video>' +
                        '<div class="player-loading" id="loading-' + safePath + '"' + loadingStyle + '>' + loadingContent + '</div>' +
                    '</div>' +
                    '<div class="player-controls">' +
                        '<button id="recbtn-' + safePath + '" class="btn btn-sm btn-record' + (isRecording ? ' active' : '') + '" onclick="app.toggleRecording(\'' + encodedPath + '\', ' + isRecording + ')">' +
                            (isRecording ? 'Stop Recording' : 'Record') +
                        '</button>' +
                        '<button class="btn btn-sm btn-snapshot" onclick="app.takeSnapshot(\'' + encodedPath + '\')">' +
                            'Snapshot' +
                        '</button>' +
                    '</div>' +
                    '<div class="player-info">' +
                        '<span>Connections: <strong>' + stream.connectionCount + '</strong></span>' +
                    '</div>' +
                '</div>';
            }).join('');

            // Re-attach existing readers' media streams to new video elements
            for (const [path, entry] of this._readers) {
                if (entry.mediaStream) {
                    const safePath = path.replace(/[^a-zA-Z0-9_-]/g, '');
                    const videoEl = document.getElementById('video-' + safePath);
                    if (videoEl) {
                        videoEl.srcObject = entry.mediaStream;
                        videoEl.play().catch(() => {});
                    }
                }
            }

            // Remember rendered state to avoid unnecessary re-renders
            this._renderedPaths = currentPaths;
            this._renderedStates = new Map(streams.map(s =>
                [s.path, s.ready + '|' + s.connectionTypes.join(',')]
            ));
        }

        // Create new readers ONLY for online paths (have active source).
        // Offline paths just show "Waiting for source..." — no WHEP session flood.
        streams.forEach(stream => {
            if (self._readers.has(stream.path)) return;

            const safePath = stream.path.replace(/[^a-zA-Z0-9_-]/g, '');
            const loadingEl = document.getElementById('loading-' + safePath);

            if (!stream.ready) {
                // Offline path — show waiting message, no reader
                if (loadingEl) {
                    loadingEl.innerHTML = 'Waiting for source...';
                    loadingEl.style.display = 'flex';
                }
                return;
            }

            const streamPath = stream.path;
            const whepUrl = whepScheme + '://' + baseHost + ':8889/' + streamPath + '/whep';

            const reader = new MediaMTXWebRTCReader({
                url: whepUrl,
                user: auth.user || '',
                pass: auth.pass || '',
                onError: (err) => {
                    const el = document.getElementById('loading-' + safePath);
                    if (el) {
                        if (err.includes('stream not found')) {
                            el.innerHTML = 'Waiting for source...';
                        } else {
                            const short = err.length > 80 ? err.substring(0, 80) + '...' : err;
                            el.innerHTML = '<div class="spinner"></div>' + short;
                        }
                        el.style.display = 'flex';
                    }
                },
                onTrack: (evt) => {
                    if (evt.track.kind !== 'video') return;
                    const el = document.getElementById('video-' + safePath);
                    if (el && evt.streams[0]) {
                        el.srcObject = evt.streams[0];
                        el.play().catch(() => {});
                    }
                    const el2 = document.getElementById('loading-' + safePath);
                    if (el2) el2.style.display = 'none';
                    const entry = self._readers.get(streamPath);
                    if (entry) entry.mediaStream = evt.streams[0];
                },
            });

            self._readers.set(streamPath, { reader, mediaStream: null });
        });
    }

    destroyPlayers() {
        if (this._playerRefreshInterval) {
            clearInterval(this._playerRefreshInterval);
            this._playerRefreshInterval = null;
        }
        this._readers.forEach((entry) => {
            try { entry.reader.close(); } catch (e) {}
        });
        this._readers.clear();
        this._renderedPaths = null;
        this._renderedStates = null;
    }

    async probeCertAccepted(host, port) {
        const cacheKey = host + ':' + port;
        if (this._certCache && this._certCache[cacheKey]) {
            return true;
        }
        try {
            // mode:'no-cors' resolves even with bad certs — useless for probing.
            // Use mode:'cors' with a known endpoint. If the cert isn't trusted,
            // the TLS handshake fails and fetch throws.
            const res = await fetch('https://' + host + ':' + port + '/nonexistent-probe', {
                mode: 'cors',
                cache: 'no-store',
            });
            // We got a response (even 404) — cert is accepted
            if (!this._certCache) this._certCache = {};
            this._certCache[cacheKey] = true;
            return true;
        } catch (e) {
            // Network error = cert not trusted (or server down)
            return false;
        }
    }

    async acceptWebRTCCert(host) {
        const popup1 = window.open('https://' + host + ':8889/', 'cert_8889', 'width=600,height=400');

        // Wait for port 8889 to be accepted
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const ok = await this.probeCertAccepted(host, 8889);
            if (ok) break;
            if (i === 59) {
                this.showToast('Certificate acceptance timed out', 'error');
                return;
            }
        }
        if (popup1) popup1.close();

        // Now open port 9996 for playback
        const playbackEncrypted = this.globalData?.playbackEncryption === true;
        if (playbackEncrypted) {
            const ok9996 = await this.probeCertAccepted(host, 9996);
            if (!ok9996) {
                const popup2 = window.open('https://' + host + ':9996/', 'cert_9996', 'width=600,height=400');
                for (let i = 0; i < 60; i++) {
                    await new Promise(r => setTimeout(r, 1000));
                    if (await this.probeCertAccepted(host, 9996)) break;
                    if (i === 59) {
                        this.showToast('Playback certificate acceptance timed out', 'error');
                        return;
                    }
                }
                if (popup2) popup2.close();
            }
        }

        this.showToast('Certificates accepted — loading', 'success');
        this.loadVideoPlayers();
        this.loadRecordings();
    }

    async toggleRecording(pathName, currentState) {
        const newState = !currentState;
        const decodedPath = decodeURIComponent(pathName);
        const safePath = decodedPath.replace(/[^a-zA-Z0-9_-]/g, '');
        try {
            // Try patch first (works for manually created paths and previously added paths)
            try {
                await this.apiCall('/config/paths/patch/' + pathName, {
                    method: 'PATCH',
                    body: JSON.stringify({ record: newState })
                });
            } catch (patchErr) {
                if (newState) {
                    // Path has no config entry — create one with add
                    await this.apiCall('/config/paths/add/' + pathName, {
                        method: 'POST',
                        body: JSON.stringify({ record: true })
                    });
                }
                // If stopping and patch failed, the entry doesn't exist, so record is already false
            }
            // Update just the button in place
            const btn = document.getElementById('recbtn-' + safePath);
            if (btn) {
                btn.textContent = newState ? 'Stop Recording' : 'Record';
                btn.className = 'btn btn-sm btn-record' + (newState ? ' active' : '');
                btn.setAttribute('onclick', "app.toggleRecording('" + pathName + "', " + newState + ")");
            }
            this.showToast('Recording ' + (newState ? 'started' : 'stopped') + ' for ' + decodedPath, 'success');
        } catch (error) {
            this.showToast('Failed to toggle recording: ' + error.message, 'error');
        }
    }

    async takeSnapshot(pathName) {
        const decodedPath = decodeURIComponent(pathName);
        const safePath = decodedPath.replace(/[^a-zA-Z0-9_-]/g, '');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = decodedPath + '_' + timestamp + '.jpg';

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Try to capture from an existing active video element
        const activeVideo = document.getElementById('video-' + safePath);
        if (activeVideo && activeVideo.readyState >= 2 && activeVideo.videoWidth > 0) {
            canvas.width = activeVideo.videoWidth;
            canvas.height = activeVideo.videoHeight;
            ctx.drawImage(activeVideo, 0, 0);
            const link = document.createElement('a');
            link.download = filename;
            link.href = canvas.toDataURL('image/jpeg', 0.95);
            link.click();
            this.showToast('Snapshot saved for ' + decodedPath, 'success');
            return;
        }

        // Fall back to creating a temporary WebRTC reader
        const instance = this.instances.find(i => i.id === this.currentInstanceId);
        if (!instance) {
            this.showToast('No instance selected', 'error');
            return;
        }

        try {
            const urlObj = new URL(instance.url);

            if (typeof MediaMTXWebRTCReader === 'undefined') {
                this.showToast('WebRTC reader not loaded', 'error');
                return;
            }

            const webrtcEncrypted = this.globalData?.webrtcEncryption === true;
            const whepScheme = webrtcEncrypted ? 'https' : 'http';

            if (webrtcEncrypted) {
                const accepted = await this.probeCertAccepted(urlObj.hostname, 8889);
                if (!accepted) {
                    this.showToast('WebRTC certificate not accepted. Go to Embedded Players and accept the certificate first.', 'error');
                    return;
                }
            }

            const whepUrl = whepScheme + '://' + urlObj.hostname + ':8889/' + decodedPath + '/whep';
            const auth = this.getInstanceAuth(this.currentInstanceId);

            this.showToast('Capturing snapshot...', 'info');

            const video = document.createElement('video');
            video.muted = true;
            video.autoplay = true;
            video.playsInline = true;

            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reader.close();
                    reject(new Error('Snapshot timed out'));
                }, 30000);

                let snapshotTaken = false;
                const reader = new MediaMTXWebRTCReader({
                    url: whepUrl,
                    user: auth.user || '',
                    pass: auth.pass || '',
                    onError: (err) => {
                        clearTimeout(timeout);
                        reject(new Error(err));
                    },
                    onTrack: (evt) => {
                        if (snapshotTaken) return;
                        if (evt.track.kind !== 'video') return;
                        snapshotTaken = true;

                        video.srcObject = evt.streams[0];
                        video.play().catch(() => {});

                        const checkFrame = setInterval(() => {
                            if (video.readyState >= 2 && video.videoWidth > 0) {
                                clearInterval(checkFrame);
                                clearTimeout(timeout);

                                canvas.width = video.videoWidth;
                                canvas.height = video.videoHeight;
                                ctx.drawImage(video, 0, 0);

                                const link = document.createElement('a');
                                link.download = filename;
                                link.href = canvas.toDataURL('image/jpeg', 0.95);
                                link.click();

                                reader.close();
                                resolve();
                            }
                        }, 200);

                        setTimeout(() => clearInterval(checkFrame), 12000);
                    },
                });
            });

            this.showToast('Snapshot saved for ' + decodedPath, 'success');
        } catch (error) {
            this.showToast('Snapshot failed: ' + error.message, 'error');
        }
    }

    updateDashboard() {
        document.getElementById('totalPaths').textContent = this.paths.length;

        // Count actual connections across all types
        const connCount = (this._lastConnCounts || []).reduce((sum, c) => sum + c, 0);
        document.getElementById('totalConnections').textContent = connCount;

        // Count active streams (paths with connections or HLS muxers)
        document.getElementById('totalHLSMuxers').textContent = this._lastPlayerCount || 0;

        const servicesContainer = document.getElementById('dashboardServices');
        servicesContainer.innerHTML = '';

        const services = [
            { key: 'rtsp', name: 'RTSP Server', enabled: this.globalData?.rtsp },
            { key: 'rtmp', name: 'RTMP Server', enabled: this.globalData?.rtmp },
            { key: 'hls', name: 'HLS Server', enabled: this.globalData?.hls },
            { key: 'webrtc', name: 'WebRTC Server', enabled: this.globalData?.webrtc },
            { key: 'srt', name: 'SRT Server', enabled: this.globalData?.srt },
            { key: 'api', name: 'API', enabled: this.globalData?.api },
            { key: 'metrics', name: 'Metrics', enabled: this.globalData?.metrics },
            { key: 'playback', name: 'Playback', enabled: this.globalData?.playback },
        ];

        services.forEach(service => {
            const badge = document.createElement('div');
            badge.className = 'service-badge ' + (service.enabled ? 'enabled' : 'disabled');
            badge.innerHTML = '<span class="dot"></span>' + service.name;
            servicesContainer.appendChild(badge);
        });

        const recordings = (this.recordings || []).reduce((sum, rec) => sum + (rec.segments?.length || rec.playbackSegments?.length || 0), 0);
        document.getElementById('totalRecordings').textContent = recordings;

        const activityList = document.getElementById('activityList');
        activityList.innerHTML = '<p class="text-muted">No recent activity</p>';
    }

    async apiCall(endpoint, options = {}) {
        const url = this.apiBase + endpoint;
        const auth = this.getInstanceAuth(this.currentInstanceId);

        const defaults = {
            headers: {
                'Content-Type': 'application/json',
            },
        };

        // Add Basic Auth if credentials are provided
        if (auth.user && auth.pass) {
            const credentials = btoa(auth.user + ':' + auth.pass);
            defaults.headers['Authorization'] = 'Basic ' + credentials;
        }

        try {
            // Merge headers properly
            const fetchOptions = {
                ...defaults,
                ...options,
                headers: {
                    ...defaults.headers,
                    ...(options.headers || {}),
                },
            };
            const response = await fetch(url, fetchOptions);
            if (!response.ok) {
                const text = await response.text();
                let errorMessage;
                try {
                    const errorJson = JSON.parse(text);
                    errorMessage = errorJson.error || response.status + ' ' + response.statusText;
                } catch {
                    // Not JSON - use status code instead of raw HTML
                    errorMessage = response.status + ' ' + response.statusText;
                }
                throw new Error(errorMessage);
            }
            const text = await response.text();
            if (!text) return {};
            return JSON.parse(text);
        } catch (error) {
            throw error;
        }
    }

    async checkConnection() {
        try {
            const info = await this.apiCall('/info');
            const instance = this.instances.find(i => i.id === this.currentInstanceId);
            document.getElementById('serverVersion').textContent = info.version + ' (' + (instance?.name || 'Unknown') + ')';
            this.updateConnectionStatus(true);
            return true;
        } catch (error) {
            console.error('Connection check failed:', error);
            this.updateConnectionStatus(false);
            const instance = this.instances.find(i => i.id === this.currentInstanceId);
            const msg = error.message.length > 100
                ? error.message.substring(0, 100) + '...'
                : error.message;
            this.showToast('Failed to connect to ' + (instance?.url || 'unknown') + ': ' + msg, 'error');
            return false;
        }
    }

    updateConnectionStatus(connected) {
        const dot = document.getElementById('connectionStatus');
        const text = document.getElementById('connectionStatusText');
        dot.classList.toggle('connected', connected);
        dot.classList.toggle('disconnected', !connected);
        const instance = this.instances.find(i => i.id === this.currentInstanceId);
        const instanceName = instance?.name || 'Unknown';
        text.textContent = connected ? ('Connected (' + instanceName + ')') : 'Disconnected';
    }

    navigateTo(section) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.section === section);
        });

        document.querySelectorAll('.section').forEach(s => {
            s.classList.toggle('active', s.id === section);
        });
    }

    showPathModal(pathName = null) {
        const modal = document.getElementById('pathModal');
        const title = document.getElementById('pathModalTitle');
        const nameInput = document.getElementById('pathNameInput');

        nameInput.value = '';
        document.getElementById('pathName').value = '';
        document.getElementById('pathSource').value = '';
        document.getElementById('pathMaxReaders').value = 0;
        document.getElementById('pathRecord').checked = false;
        document.getElementById('pathRecordPath').value = '';
        document.getElementById('pathSourceOnDemand').checked = false;

        if (pathName) {
            title.textContent = 'Edit Path';
            nameInput.value = pathName;
            nameInput.disabled = true;

            const path = this.paths.find(p => p.name === pathName);
            if (path) {
                document.getElementById('pathName').value = path.name;
                document.getElementById('pathSource').value = path.source || '';
                document.getElementById('pathMaxReaders').value = path.maxReaders || 0;
                document.getElementById('pathRecord').checked = path.record || false;
                document.getElementById('pathRecordPath').value = path.recordPath || '';
                document.getElementById('pathSourceOnDemand').checked = path.sourceOnDemand || false;
            }
        } else {
            title.textContent = 'Add Path';
            nameInput.disabled = false;
        }

        modal.classList.add('active');
    }

    closePathModal() {
        document.getElementById('pathModal').classList.remove('active');
    }

    async savePath() {
        const nameInput = document.getElementById('pathNameInput');
        const name = nameInput.value.trim();

        if (!name) {
            this.showToast('Path name is required', 'error');
            return;
        }

        const data = {};
        const source = document.getElementById('pathSource').value.trim();
        if (source) data.source = source;
        const maxReaders = parseInt(document.getElementById('pathMaxReaders').value) || 0;
        if (maxReaders > 0) data.maxReaders = maxReaders;
        const record = document.getElementById('pathRecord').checked;
        data.record = record;
        const recordPath = document.getElementById('pathRecordPath').value.trim();
        if (recordPath) data.recordPath = recordPath;
        const sourceOnDemand = document.getElementById('pathSourceOnDemand').checked;
        if (sourceOnDemand) data.sourceOnDemand = sourceOnDemand;

        try {
            const existingPath = this.paths.find(p => p.name === name);
            if (existingPath) {
                await this.apiCall('/config/paths/patch/' + encodeURIComponent(name), {
                    method: 'PATCH',
                    body: JSON.stringify(data)
                });
                this.showToast('Path updated successfully', 'success');
            } else {
                await this.apiCall('/config/paths/add/' + encodeURIComponent(name), {
                    method: 'POST',
                    body: JSON.stringify(data)
                });
                this.showToast('Path added successfully', 'success');
            }
            this.closePathModal();
            this.loadPaths();
        } catch (error) {
            this.showToast('Failed to save path: ' + error.message, 'error');
        }
    }

    async editPath(name) {
        this.showPathModal(name);
    }

    async deletePath(name) {
        if (!confirm('Are you sure you want to delete path "' + name + '"?')) {
            return;
        }

        try {
            await this.apiCall('/config/paths/delete/' + encodeURIComponent(name), {
                method: 'DELETE'
            });
            this.showToast('Path deleted successfully', 'success');
            this.loadPaths();
        } catch (error) {
            this.showToast('Failed to delete path: ' + error.message, 'error');
        }
    }

    renderPaths() {
        const container = document.getElementById('pathsList');

        if (this.paths.length === 0) {
            container.innerHTML = '<div class="empty-state"><p class="text-muted">No paths configured. Click "Add Path" to create your first stream key.</p></div>';
            return;
        }

        container.innerHTML = this.paths.map(path => {
            return '<div class="path-card">' +
                '<div class="card-header">' +
                    '<div>' +
                        '<h3 class="card-title">' + this.escapeHtml(path.name) + '</h3>' +
                        '<p class="card-subtitle">' + (path.source ? 'Source: ' + this.escapeHtml(path.source) : 'Publisher-based') + '</p>' +
                    '</div>' +
                    '<div class="card-actions">' +
                        '<button class="btn btn-icon" onclick="app.editPath(\'' + encodeURIComponent(path.name) + '\')" title="Edit">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>' +
                        '</button>' +
                        '<button class="btn btn-icon" onclick="app.deletePath(\'' + encodeURIComponent(path.name) + '\')" title="Delete" style="color: var(--danger-color)">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>' +
                        '</button>' +
                    '</div>' +
                    '</div>' +
                    '<div class="card-body">' +
                        '<div class="info-item"><span class="info-label">Max Readers</span><span class="info-value">' + (path.maxReaders || 'Unlimited') + '</span></div>' +
                        '<div class="info-item"><span class="info-label">Recording</span><span class="info-value ' + (path.record ? '' : 'muted') + '">' + (path.record ? 'Enabled' : 'Disabled') + '</span></div>' +
                        '<div class="info-item"><span class="info-label">On Demand</span><span class="info-value ' + (path.sourceOnDemand ? '' : 'muted') + '">' + (path.sourceOnDemand ? 'Enabled' : 'Disabled') + '</span></div>' +
                    '</div>' +
                '</div>';
        }).join('');
    }

    showUserModal(userIndex = -1) {
        const modal = document.getElementById('userModal');
        const title = document.getElementById('userModalTitle');
        const idInput = document.getElementById('userIndex');

        idInput.value = -1;
        document.getElementById('userName').value = '';
        document.getElementById('userName').disabled = false;
        document.getElementById('userPassword').value = '';
        document.getElementById('userIPs').value = '';
        document.getElementById('userPermPath').value = '';
        document.querySelectorAll('.perm-checkbox').forEach(cb => cb.checked = false);

        if (userIndex >= 0) {
            title.textContent = 'Edit User';
            const users = this.globalData?.authInternalUsers || [];
            const user = users[userIndex];
            if (user) {
                idInput.value = userIndex;
                document.getElementById('userName').value = user.user || '';
                document.getElementById('userName').disabled = true;
                document.getElementById('userPassword').value = user.pass || '';
                document.getElementById('userIPs').value = user.ips?.join(', ') || '';
                document.getElementById('userPermPath').value = user.permissions?.[0]?.path || '';

                if (user.permissions?.length) {
                    document.getElementById('userPermPath').value = user.permissions[0].path || '';
                    user.permissions.forEach(perm => {
                        const cb = document.querySelector('.perm-checkbox[value="' + perm.action + '"]');
                        if (cb) cb.checked = true;
                    });
                }
            }
        } else {
            title.textContent = 'Add User';
        }

        modal.classList.add('active');
    }

    closeUserModal() {
        document.getElementById('userModal').classList.remove('active');
    }

    async saveUser() {
        const username = document.getElementById('userName').value.trim();
        const password = document.getElementById('userPassword').value;
        const ips = document.getElementById('userIPs').value.split(',').map(ip => ip.trim()).filter(ip => ip);
        const path = document.getElementById('userPermPath').value.trim() || undefined;
        const actions = [];
        document.querySelectorAll('.perm-checkbox:checked').forEach(cb => actions.push(cb.value));

        if (!username) {
            this.showToast('Username is required', 'error');
            return;
        }

        if (actions.length === 0) {
            this.showToast('At least one permission is required', 'error');
            return;
        }

        try {
            let users = this.globalData?.authInternalUsers || [];
            const index = parseInt(document.getElementById('userIndex').value);

            // Build permissions array
            const permissions = actions.map(action => ({ action, path }));

            if (index >= 0) {
                users[index] = { user: username, pass: password, ips, permissions };
            } else {
                users.push({ user: username, pass: password, ips, permissions });
            }

            await this.apiCall('/config/global/patch', {
                method: 'PATCH',
                body: JSON.stringify({ authInternalUsers: users })
            });

            this.globalData.authInternalUsers = users;
            this.showToast('User saved successfully', 'success');
            this.closeUserModal();
            this.loadUsers();
        } catch (error) {
            this.showToast('Failed to save user: ' + error.message, 'error');
        }
    }

    editUser(username) {
        const users = this.globalData?.authInternalUsers || [];
        const index = users.findIndex(u => u.user === decodeURIComponent(username));
        if (index >= 0) {
            this.showUserModal(index);
        }
    }

    async deleteUser(username) {
        const users = this.globalData?.authInternalUsers || [];
        const index = users.findIndex(u => u.user === decodeURIComponent(username));
        if (index < 0) return;

        const user = users[index];
        if (!confirm('Are you sure you want to delete user "' + user.user + '"?')) {
            return;
        }

        try {
            users.splice(index, 1);
            await this.apiCall('/config/global/patch', {
                method: 'PATCH',
                body: JSON.stringify({ authInternalUsers: users })
            });

            this.globalData.authInternalUsers = users;
            this.showToast('User deleted successfully', 'success');
            this.loadUsers();
        } catch (error) {
            this.showToast('Failed to delete user: ' + error.message, 'error');
        }
    }

    async loadUsers() {
        try {
            await this.loadGlobalConfig();
            this.renderUsers();
        } catch (error) {
            console.error('Error loading users:', error);
            const instance = this.instances.find(i => i.id === this.currentInstanceId);
            this.showToast('Failed to load users from ' + (instance?.name || 'instance') + ': ' + error.message, 'error');
        }
    }

    renderUsers() {
        const container = document.getElementById('usersList');
        const users = this.globalData?.authInternalUsers || [];

        if (users.length === 0) {
            container.innerHTML = '<div class="empty-state"><p class="text-muted">No users configured. Click "Add User" to create your first user.</p></div>';
            return;
        }

        container.innerHTML = users.map((user, index) => {
            const encodedUser = encodeURIComponent(user.user || '');
            const permissions = user.permissions || [];
            const permActions = permissions.map(p => p.action || '').join(', ');

            return '<div class="user-card">' +
                '<div class="card-header">' +
                    '<div>' +
                        '<h3 class="card-title">' + this.escapeHtml(user.user || 'Unknown') + '</h3>' +
                        '<p class="card-subtitle">' + (permActions ? 'Permissions: ' + this.escapeHtml(permActions) : 'No permissions') + '</p>' +
                    '</div>' +
                    '<div class="card-actions">' +
                        '<button class="btn btn-icon" onclick="app.editUser(\'' + encodedUser + '\')" title="Edit">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>' +
                        '</button>' +
                        '<button class="btn btn-icon" onclick="app.deleteUser(\'' + encodedUser + '\')" title="Delete" style="color: var(--danger-color)">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>' +
                        '</button>' +
                    '</div>' +
                '</div>' +
                '<div class="card-body">' +
                    '<div class="info-item"><span class="info-label">IPs Allowed</span><span class="info-value">' + (user.ips?.length ? user.ips.join(', ') : 'All') + '</span></div>' +
                    '<div class="info-item"><span class="info-label">Path</span><span class="info-value">' + (permissions[0]?.path || 'All paths') + '</span></div>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    async showConnDetail(id, type) {
        try {
            const safeId = encodeURIComponent(id);
            let endpoint;
            switch (type) {
                case 'rtsp':
                    endpoint = '/rtspsessions/get/' + safeId;
                    break;
                case 'rtmp':
                    endpoint = '/rtmpconns/get/' + safeId;
                    break;
                case 'srt':
                    endpoint = '/srtconns/get/' + safeId;
                    break;
                case 'webrtc':
                    endpoint = '/webrtcsessions/get/' + safeId;
                    break;
                default:
                    this.showToast('Unknown connection type: ' + type, 'error');
                    return;
            }

            const conn = await this.apiCall(endpoint);
            document.getElementById('connDetail').textContent = JSON.stringify(conn, null, 2);
            document.getElementById('connModal').classList.add('active');
        } catch (error) {
            this.showToast('Failed to load connection details: ' + error.message, 'error');
        }
    }

    closeConnModal() {
        document.getElementById('connModal').classList.remove('active');
    }

    async kickConnection(id, type) {
        if (!confirm('Are you sure you want to kick this connection?')) {
            return;
        }

        try {
            let endpoint;
            switch (type) {
                case 'rtsp':
                    endpoint = '/rtspsessions/kick/' + id;
                    break;
                case 'rtmp':
                    endpoint = '/rtmpconns/kick/' + id;
                    break;
                case 'srt':
                    endpoint = '/srtconns/kick/' + id;
                    break;
                case 'webrtc':
                    endpoint = '/webrtcsessions/kick/' + id;
                    break;
            }

            await this.apiCall(endpoint, { method: 'POST' });
            this.showToast('Connection kicked successfully', 'success');
            this.loadConnections();
        } catch (error) {
            this.showToast('Failed to kick connection: ' + error.message, 'error');
        }
    }

    async loadRecordings() {
        try {
            const response = await this.apiCall('/recordings/list');
            this.recordings = response.items || [];

            // Try to enrich with playback server segment data (includes duration)
            const instance = this.instances.find(i => i.id === this.currentInstanceId);
            if (instance) {
                const urlObj = new URL(instance.url);
                const playbackEncrypted = this.globalData?.playbackEncryption === true;
                const playbackScheme = playbackEncrypted ? 'https' : 'http';
                const playbackBase = playbackScheme + '://' + urlObj.hostname + ':9996';

                // Check if playback cert is accepted (if encrypted)
                let playbackAvailable = true;
                if (playbackEncrypted) {
                    playbackAvailable = await this.probeCertAccepted(urlObj.hostname, 9996);
                }

                if (playbackAvailable) {
                    const enriched = await Promise.allSettled(
                        this.recordings.map(async (rec) => {
                            try {
                                const listUrl = playbackBase + '/list?path=' + encodeURIComponent(rec.name);
                                const res = await fetch(listUrl);
                                if (res.ok) {
                                    const segments = await res.json();
                                    // Fix playback URLs: replace localhost with actual host, use mp4 format
                                    segments.forEach(seg => {
                                        if (seg.url) {
                                            seg.url = seg.url.replace(/https?:\/\/[^\/]+/, playbackBase) + '&format=mp4';
                                        }
                                    });
                                    return { ...rec, playbackSegments: segments, playbackBase };
                                }
                            } catch (e) { /* fall back to API segments */ }
                            return { ...rec, playbackSegments: null, playbackBase };
                        })
                    );
                    this.recordings = enriched.map(r => r.status === 'fulfilled' ? r.value : { playbackSegments: null });
                } else {
                    // Playback cert not accepted — use API segments as fallback
                    this.recordings = this.recordings.map(rec => ({
                        ...rec,
                        playbackSegments: (rec.segments || []).map(seg => ({
                            start: seg.start,
                            duration: null
                        })),
                        playbackBase
                    }));
                }
            }

            this.renderRecordings(this.recordings);
        } catch (error) {
            console.error('Error loading recordings:', error);
        }
    }

    async loadHLS() {
        try {
            const response = await this.apiCall('/hlsmuxers/list');
            this.renderEmbeddedPlayers(response.items || []);
        } catch (error) {
            console.error('Error loading HLS muxers:', error);
        }
    }

    refreshRecordings() {
        this.loadRecordings();
    }

    refreshConnections() {
        this.loadConnections();
    }

    refreshVideoPlayers() {
        this.loadVideoPlayers();
    }

    refreshHLS() {
        this.loadVideoPlayers();
    }

    refreshAll() {
        this.loadAllData();
        this.showToast('Data refreshed', 'success');
    }

    async exportSettings() {
        try {
            const [globalRes, pathsRes] = await Promise.all([
                this.apiCall('/config/global/get'),
                this.apiCall('/config/paths/list')
            ]);

            const exportData = {
                _exported: new Date().toISOString(),
                _source: 'MediaMTX Web Interface',
                global: globalRes,
                paths: (pathsRes.items || []).map(p => ({ name: p.name, ...p }))
            };

            const json = JSON.stringify(exportData, null, 2);
            const date = new Date().toISOString().split('T')[0];
            const link = document.createElement('a');
            link.download = 'mediamtx-settings-' + date + '.json';
            link.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
            link.click();

            this.showToast('Settings exported', 'success');
        } catch (error) {
            this.showToast('Export failed: ' + error.message, 'error');
        }
    }

    async importSettings(input) {
        const file = input.files?.[0];
        if (!file) return;
        input.value = '';

        // Read-only state fields returned by GET but rejected by PATCH
        const pathReadOnlyFields = [
            'name', 'confName', 'ready', 'readyTime', 'available', 'availableTime',
            'online', 'onlineTime', 'source', 'tracks', 'tracks2', 'readers',
            'inboundBytes', 'outboundBytes', 'inboundFramesInError',
            'bytesReceived', 'bytesSent'
        ];

        function stripReadOnly(obj, blacklist) {
            const clean = {};
            for (const key of Object.keys(obj)) {
                if (blacklist.includes(key)) continue;
                if (key.startsWith('_')) continue;  // strip any metadata fields
                clean[key] = obj[key];
            }
            return clean;
        }

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (!data.global && !data.paths) {
                this.showToast('Invalid settings file — missing global or paths sections', 'error');
                return;
            }

            const parts = [];
            if (data.global) parts.push('global configuration');
            if (data.paths) parts.push(data.paths.length + ' path(s)');
            const summary = parts.join(' and ');

            if (!confirm('Import ' + summary + ' from "' + file.name + '"?\n\nThis will overwrite current settings (in-memory only, not persisted to disk).')) {
                return;
            }

            const errors = [];

            if (data.global) {
                try {
                    const cleanGlobal = stripReadOnly(data.global, []);
                    await this.apiCall('/config/global/patch', {
                        method: 'PATCH',
                        body: JSON.stringify(cleanGlobal)
                    });
                } catch (e) {
                    errors.push('Global: ' + e.message);
                }
            }

            if (data.paths) {
                for (const path of data.paths) {
                    const name = path.name;
                    if (!name) continue;
                    const cleanPath = stripReadOnly(path, pathReadOnlyFields);
                    try {
                        await this.apiCall('/config/paths/patch/' + encodeURIComponent(name), {
                            method: 'PATCH',
                            body: JSON.stringify(cleanPath)
                        });
                    } catch (e) {
                        // Path may not exist yet (dynamic or new), try add
                        try {
                            await this.apiCall('/config/paths/add/' + encodeURIComponent(name), {
                                method: 'POST',
                                body: JSON.stringify(cleanPath)
                            });
                        } catch (e2) {
                            errors.push('Path "' + name + '": ' + e2.message);
                        }
                    }
                }
            }

            if (errors.length > 0) {
                this.showToast('Import errors: ' + errors.join('; '), 'error');
            } else {
                this.showToast('Settings imported successfully', 'success');
            }

            this.loadAllData();
        } catch (error) {
            this.showToast('Import failed: ' + error.message, 'error');
        }
    }

    async loadServices() {
        try {
            await this.loadGlobalConfig();
            this.renderServices();
        } catch (error) {
            console.error('Error loading services:', error);
            this.showToast('Failed to load services configuration', 'error');
        }
    }

    renderServices() {
        const container = document.getElementById('servicesConfig');
        if (!this.globalData) {
            container.innerHTML = '<p class="text-muted">Unable to load services configuration.</p>';
            return;
        }

        const services = [
            { key: 'rtsp', name: 'RTSP Server', desc: 'Receive and serve RTSP streams' },
            { key: 'rtmp', name: 'RTMP Server', desc: 'Receive and serve RTMP streams' },
            { key: 'hls', name: 'HLS Server', desc: 'Transmux to HLS and serve to clients' },
            { key: 'webrtc', name: 'WebRTC Server', desc: 'Receive and serve WebRTC streams' },
            { key: 'srt', name: 'SRT Server', desc: 'Receive and serve SRT streams' },
            { key: 'api', name: 'API', desc: 'REST API for configuration and monitoring' },
            { key: 'metrics', name: 'Metrics', desc: 'Prometheus metrics endpoint' },
            { key: 'playback', name: 'Playback', desc: 'Play recordings on demand' },
        ];

        container.innerHTML = services.map(service => {
            const enabled = this.globalData[service.key] === true;
            return '<div class="service-section">' +
                '<h4 class="service-section-title">' + service.name + '</h4>' +
                '<div class="service-toggle">' +
                    '<div class="toggle-label">' +
                        '<span>' + service.name + '</span>' +
                        '<small>' + service.desc + '</small>' +
                    '</div>' +
                    '<label class="toggle">' +
                        '<input type="checkbox" id="service_' + service.key + '" ' + (enabled ? 'checked' : '') + '>' +
                        '<span class="toggle-slider"></span>' +
                    '</label>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    async saveServices() {
        const serviceKeys = ['rtsp', 'rtmp', 'hls', 'webrtc', 'srt', 'api', 'metrics', 'playback'];
        const patchData = {};

        serviceKeys.forEach(key => {
            const checkbox = document.getElementById('service_' + key);
            if (checkbox) {
                patchData[key] = checkbox.checked;
            }
        });

        try {
            await this.apiCall('/config/global/patch', {
                method: 'PATCH',
                body: JSON.stringify(patchData)
            });

            // Update local data
            if (this.globalData) {
                Object.assign(this.globalData, patchData);
            }

            this.showToast('Services configuration saved successfully', 'success');
            this.updateDashboard();
        } catch (error) {
            this.showToast('Failed to save services configuration: ' + error.message, 'error');
        }
    }

    renderRecordings(recordings) {
        const container = document.getElementById('recordingsList');

        // Store segment playback URLs for playRecording() to use
        this._segmentUrls = {};

        if (recordings.length === 0) {
            container.innerHTML = '<div class="empty-state"><p class="text-muted">No recordings found. Start recording on a stream to see recordings here.</p></div>';
            return;
        }

        container.innerHTML = recordings.map(rec => {
            const segments = rec.playbackSegments || [];
            const encodedName = encodeURIComponent(rec.name);

            const segmentRows = segments.length > 0
                ? segments.map((seg, idx) => {
                    const encodedStart = encodeURIComponent(seg.start);
                    const duration = seg.duration ? this.formatDuration(seg.duration) : 'N/A';
                    // Store the playback URL (from playback server) for this segment
                    const segKey = rec.name + '::' + seg.start;
                    this._segmentUrls[segKey] = seg.url || null;
                    return '<div class="recording-segment-row">' +
                        '<span class="segment-index">#' + (idx + 1) + '</span>' +
                        '<span class="segment-start">' + this.formatDate(seg.start) + '</span>' +
                        '<span class="segment-duration">' + duration + '</span>' +
                        '<div class="segment-actions">' +
                            '<button class="btn btn-sm btn-snapshot" onclick="app.playRecording(\'' + encodedName + '\', \'' + encodedStart + '\')">Play</button>' +
                            '<button class="btn btn-sm btn-record" onclick="app.deleteRecordingSegment(\'' + encodedName + '\', \'' + encodedStart + '\')">Delete</button>' +
                        '</div>' +
                    '</div>';
                }).join('')
                : '<p class="text-muted" style="padding: 0.5rem 0;">No segments available</p>';

            return '<div class="recording-card">' +
                '<div class="card-header">' +
                    '<div>' +
                        '<h3 class="card-title">' + this.escapeHtml(rec.name) + '</h3>' +
                        '<p class="card-subtitle">' + segments.length + ' segment(s)</p>' +
                    '</div>' +
                '</div>' +
                '<div class="recording-segments">' + segmentRows + '</div>' +
            '</div>';
        }).join('');
    }

    formatDuration(seconds) {
        if (seconds < 60) return Math.round(seconds) + 's';
        if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + Math.round(seconds % 60) + 's';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return h + 'h ' + m + 'm';
    }

    async playRecording(pathName, start) {
        const decodedPath = decodeURIComponent(pathName);
        const decodedStart = decodeURIComponent(start);
        const instance = this.instances.find(i => i.id === this.currentInstanceId);
        if (!instance) {
            this.showToast('No instance selected', 'error');
            return;
        }

        const urlObj = new URL(instance.url);
        const playbackEncrypted = this.globalData?.playbackEncryption === true;
        const playbackScheme = playbackEncrypted ? 'https' : 'http';

        // Check cert acceptance if encrypted
        if (playbackEncrypted) {
            const accepted = await this.probeCertAccepted(urlObj.hostname, 9996);
            if (!accepted) {
                this.showToast('Playback certificate not accepted. Go to the Embedded Players section and click "Accept Certificate" to accept both WebRTC and Playback certs.', 'error');
                return;
            }
        }

        // Use the pre-built URL from the playback server if available
        const segKey = decodedPath + '::' + decodedStart;
        let playbackUrl = this._segmentUrls?.[segKey] || null;

        if (!playbackUrl) {
            // Fallback: construct URL manually
            playbackUrl = playbackScheme + '://' + urlObj.hostname + ':9996/get?path=' +
                encodeURIComponent(decodedPath) + '&start=' + encodeURIComponent(decodedStart) +
                '&duration=7200&format=mp4';
        }

        const modal = document.getElementById('recordingPlayerModal');
        const video = document.getElementById('recordingPlayerVideo');
        const title = document.getElementById('recordingPlayerTitle');

        title.textContent = decodedPath + ' — ' + this.formatDate(decodedStart);
        video.onerror = () => {
            this.showToast('Failed to load recording. The recording may still be in progress or the format is not supported.', 'error');
        };
        video.src = playbackUrl;
        modal.style.display = 'flex';
        video.play().catch(() => {});
    }

    closeRecordingPlayer() {
        const modal = document.getElementById('recordingPlayerModal');
        const video = document.getElementById('recordingPlayerVideo');
        video.onerror = null;
        video.pause();
        video.src = '';
        modal.style.display = 'none';
    }

    async deleteRecordingSegment(pathName, start) {
        const decodedPath = decodeURIComponent(pathName);
        const decodedStart = decodeURIComponent(start);
        if (!confirm('Delete recording segment for "' + decodedPath + '" starting at ' + this.formatDate(decodedStart) + '?')) {
            return;
        }
        try {
            await this.apiCall('/recordings/deletesegment?path=' + pathName + '&start=' + start, {
                method: 'DELETE'
            });
            this.showToast('Recording segment deleted', 'success');
            this.loadRecordings();
        } catch (error) {
            this.showToast('Failed to delete segment: ' + error.message, 'error');
        }
    }

    showInstanceModal(instanceId = null) {
        const modal = document.getElementById('instanceModal');
        const title = document.getElementById('instanceModalTitle');
        const idInput = document.getElementById('instanceId');

        idInput.value = '';
        document.getElementById('instanceName').value = '';
        document.getElementById('instanceUrl').value = '';
        document.getElementById('instanceUser').value = '';
        document.getElementById('instancePassword').value = '';

        if (instanceId) {
            title.textContent = 'Edit Instance';
            const instance = this.instances.find(i => i.id === instanceId);
            if (instance) {
                idInput.value = instance.id;
                document.getElementById('instanceName').value = instance.name;
                document.getElementById('instanceUrl').value = instance.url;
                document.getElementById('instanceUser').value = instance.user || '';
                document.getElementById('instancePassword').value = instance.pass || '';
            }
        } else {
            title.textContent = 'Add Instance';
        }

        modal.classList.add('active');
    }

    closeInstanceModal() {
        document.getElementById('instanceModal').classList.remove('active');
    }

    async saveInstance() {
        const id = document.getElementById('instanceId').value;
        const name = document.getElementById('instanceName').value.trim();
        const url = document.getElementById('instanceUrl').value.trim();
        const user = document.getElementById('instanceUser').value.trim();
        const pass = document.getElementById('instancePassword').value.trim();

        if (!name || !url) {
            this.showToast('Instance name and URL are required', 'error');
            return;
        }

        if (id) {
            this.updateInstance(id, name, url, user, pass);
        } else {
            this.addInstance(name, url, user, pass);
        }

        this.closeInstanceModal();
    }

    deleteCurrentInstance() {
        if (!this.currentInstanceId) {
            return;
        }
        const instance = this.instances.find(i => i.id === this.currentInstanceId);
        if (instance && confirm('Are you sure you want to delete instance "' + instance.name + '"?')) {
            this.deleteInstance(this.currentInstanceId);
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatDate(dateStr) {
        if (!dateStr) return 'N/A';
        try {
            const date = new Date(dateStr);
            return date.toLocaleString();
        } catch {
            return dateStr;
        }
    }

    formatBytes(bytes) {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    showToast(message, type) {
        const toast = document.getElementById('toast');
        const toastMessage = document.getElementById('toastMessage');

        toast.className = 'toast ' + type;
        toastMessage.textContent = message;
        toast.classList.add('active');

        setTimeout(() => {
            this.hideToast();
        }, 5000);
    }

    hideToast() {
        document.getElementById('toast').classList.remove('active');
    }
}

const app = new MediaMTXApp();

if (window.location.hash) {
    const hash = window.location.hash.slice(1);
    if (hash) {
        app.navigateTo(hash);
    }
}
