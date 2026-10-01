// MM.api — MediaMTX control-API client with version-aware endpoints,
// Basic/Bearer auth, timeouts, normalized errors and pagination.
'use strict';
window.MM = window.MM || {};

(function () {
    class ApiError extends Error {
        constructor(message, { status = 0, isAuth = false, isNetwork = false } = {}) {
            super(message);
            this.name = 'ApiError';
            this.status = status;
            this.isAuth = isAuth;
            this.isNetwork = isNetwork;
        }
    }

    // Version-gated endpoints. `new` is the v1.21+ nested name, `legacy` the
    // pre-1.21 flat name. `min` gates entirely-new endpoints; when a version
    // is unknown (old server without /v3/info) we assume the legacy surface.
    const ENDPOINTS = {
        info:                 { min: '1.15.2', new: '/info' },
        configGlobalGet:      { new: '/config/global/get' },
        configGlobalPatch:    { new: '/config/global/patch' },
        pathDefaultsGet:      { new: '/config/path-defaults/get', legacy: '/config/pathdefaults/get' },
        pathDefaultsPatch:    { new: '/config/path-defaults/patch', legacy: '/config/pathdefaults/patch' },
        configPathsList:      { new: '/config/paths/list' },
        configPathGet:        { new: '/config/paths/get/{name}' },
        configPathAdd:        { new: '/config/paths/add/{name}' },
        configPathPatch:      { new: '/config/paths/patch/{name}' },
        configPathReplace:    { new: '/config/paths/replace/{name}' },
        configPathDelete:     { new: '/config/paths/delete/{name}' },
        pathsList:            { new: '/paths/list' },
        pathsGet:             { new: '/paths/get/{name}' },
        forwardDestsList:     { min: '1.20', new: '/paths/forward-dests/list', legacy: '/paths/forward/list' },
        staticSourceGet:      { min: '1.21', new: '/paths/static-sources/get/{name}' },
        hlsMuxersList:        { new: '/hls/muxers/list', legacy: '/hlsmuxers/list' },
        hlsSessionsList:      { min: '1.18', new: '/hls/sessions/list' },
        hlsSessionGet:        { min: '1.18', new: '/hls/sessions/get/{id}' },
        hlsSessionKick:       { min: '1.18', new: '/hls/sessions/kick/{id}' },
        moqSessionsList:      { min: '1.19', new: '/moq/sessions/list' },
        moqSessionGet:        { min: '1.19', new: '/moq/sessions/get/{id}' },
        moqSessionKick:       { min: '1.19', new: '/moq/sessions/kick/{id}' },
        rtspConnsList:        { new: '/rtsp/conns/list', legacy: '/rtspconns/list' },
        rtspConnsGet:         { new: '/rtsp/conns/get/{id}', legacy: '/rtspconns/get/{id}' },
        rtspSessionsList:     { new: '/rtsp/sessions/list', legacy: '/rtspsessions/list' },
        rtspSessionsGet:      { new: '/rtsp/sessions/get/{id}', legacy: '/rtspsessions/get/{id}' },
        rtspSessionsKick:     { new: '/rtsp/sessions/kick/{id}', legacy: '/rtspsessions/kick/{id}' },
        rtspsConnsList:       { min: '1.21', new: '/rtsps/conns/list', legacy: '/rtspsconns/list' },
        rtspsConnsGet:        { min: '1.21', new: '/rtsps/conns/get/{id}', legacy: '/rtspsconns/get/{id}' },
        rtspsSessionsList:    { min: '1.21', new: '/rtsps/sessions/list', legacy: '/rtspsessions/list' },
        rtspsSessionsGet:     { min: '1.21', new: '/rtsps/sessions/get/{id}', legacy: '/rtspsessions/get/{id}' },
        rtspsSessionsKick:    { min: '1.21', new: '/rtsps/sessions/kick/{id}', legacy: '/rtspsessions/kick/{id}' },
        rtmpConnsList:        { new: '/rtmp/conns/list', legacy: '/rtmpconns/list' },
        rtmpConnsGet:         { new: '/rtmp/conns/get/{id}', legacy: '/rtmpconns/get/{id}' },
        rtmpConnsKick:        { new: '/rtmp/conns/kick/{id}', legacy: '/rtmpconns/kick/{id}' },
        rtmpsConnsList:       { min: '1.21', new: '/rtmps/conns/list', legacy: '/rtmpsconns/list' },
        rtmpsConnsGet:        { min: '1.21', new: '/rtmps/conns/get/{id}', legacy: '/rtmpsconns/get/{id}' },
        rtmpsConnsKick:       { min: '1.21', new: '/rtmps/conns/kick/{id}', legacy: '/rtmpsconns/kick/{id}' },
        webrtcSessionsList:   { new: '/webrtc/sessions/list', legacy: '/webrtcsessions/list' },
        webrtcSessionsGet:    { new: '/webrtc/sessions/get/{id}', legacy: '/webrtcsessions/get/{id}' },
        webrtcSessionsKick:   { new: '/webrtc/sessions/kick/{id}', legacy: '/webrtcsessions/kick/{id}' },
        srtConnsList:         { new: '/srt/conns/list', legacy: '/srtconns/list' },
        srtConnsGet:          { new: '/srt/conns/get/{id}', legacy: '/srtconns/get/{id}' },
        srtConnsKick:         { new: '/srt/conns/kick/{id}', legacy: '/srtconns/kick/{id}' },
        recordingsList:       { new: '/recordings/list' },
        recordingsGet:        { new: '/recordings/get/{name}' },
        recordingsSegmentDelete: {
            min: '1.21',
            new: '/recordings/segments/delete',
            legacy: '/recordings/deletesegment',
        },
    };

    function parseVersion(v) {
        const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(v || ''));
        if (!m) return null;
        return { major: +m[1], minor: +m[2], patch: +(m[3] || 0) };
    }

    function versionAtLeast(version, min) {
        const v = parseVersion(version);
        const m = parseVersion(min);
        if (!v || !m) return false;
        if (v.major !== m.major) return v.major > m.major;
        if (v.minor !== m.minor) return v.minor > m.minor;
        return v.patch >= m.patch;
    }

    function basicAuthHeader(user, pass) {
        // TextEncoder keeps non-ASCII credentials from throwing in btoa().
        const bytes = new TextEncoder().encode(user + ':' + pass);
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        return 'Basic ' + btoa(bin);
    }

    const api = {
        ApiError,
        instance: null,
        apiBase: '',
        info: null,
        version: null,
        legacy: false,
        _lastAuthErrorAt: 0,

        setInstance(inst) {
            this.instance = inst || null;
            this.info = null;
            this.version = null;
            this.legacy = false;
            this.apiBase = inst && inst.url ? inst.url.replace(/\/+$/, '') + '/v3' : '';
        },

        authHeaders() {
            const inst = this.instance;
            if (!inst) return {};
            if (inst.authType === 'token' && inst.token) {
                return { 'Authorization': 'Bearer ' + inst.token };
            }
            const user = inst.user || '';
            const pass = this.sessionPassword || inst.pass || '';
            if (!user && !pass) return {};
            return { 'Authorization': basicAuthHeader(user, pass) };
        },

        // Password typed for this session only (never persisted).
        sessionPassword: null,

        endpoint(name) {
            const def = ENDPOINTS[name];
            if (!def) throw new ApiError('Unknown endpoint: ' + name);
            const available = def.min
                ? (this.version ? versionAtLeast(this.version, def.min) : false)
                : true;
            if (available && def.new) return def.new;
            if (def.legacy && (this.legacy || this.version === null || !available)) return def.legacy;
            throw new ApiError('Endpoint /v3' + def.new + ' requires a newer MediaMTX server' +
                (def.min ? ' (>= v' + def.min + ')' : '') + '.');
        },

        has(name) {
            try { this.endpoint(name); return true; } catch (e) { return false; }
        },

        async request(method, pathOrUrl, { query, body, timeout = 15000, absolute = false } = {}) {
            if (!absolute && !this.apiBase) {
                throw new ApiError('No instance selected.');
            }
            let url = absolute ? pathOrUrl : this.apiBase + pathOrUrl;
            if (query) {
                const qs = new URLSearchParams(query).toString();
                if (qs) url += (url.includes('?') ? '&' : '?') + qs;
            }

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);
            let res;
            try {
                res = await fetch(url, {
                    method,
                    headers: {
                        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                        ...this.authHeaders(),
                    },
                    body: body !== undefined ? JSON.stringify(body) : undefined,
                    signal: controller.signal,
                });
            } catch (err) {
                clearTimeout(timer);
                if (err.name === 'AbortError') {
                    throw new ApiError('Request timed out after ' + (timeout / 1000) + 's.', { isNetwork: true });
                }
                throw new ApiError(
                    'Cannot reach the server. Check the URL, that the server is running, and that this page\'s origin is whitelisted in "apiAllowOrigins".',
                    { isNetwork: true },
                );
            }
            clearTimeout(timer);

            if (res.status === 401) {
                throw new ApiError('Authentication failed (401). Check the instance credentials.', { status: 401, isAuth: true });
            }

            let data = null;
            const text = await res.text();
            if (text) {
                try { data = JSON.parse(text); } catch (e) { data = null; }
            }

            if (!res.ok) {
                const msg = (data && data.error) ? data.error : ('HTTP ' + res.status + ' ' + res.statusText);
                throw new ApiError(msg, { status: res.status });
            }
            if (data && data.status === 'error') {
                throw new ApiError(data.error || 'Unknown API error', { status: res.status });
            }
            return data;
        },

        // Follows server-side pagination (itemsPerPage/page + pageCount).
        async listAll(name, { itemsPerPage = 100, maxPages = 50, query } = {}) {
            const out = [];
            let page = 0;
            for (;;) {
                const data = await this.request('GET', this.endpoint(name), {
                    query: { ...query, itemsPerPage, page },
                });
                const items = data.items || [];
                out.push(...items);
                const pageCount = typeof data.pageCount === 'number' ? data.pageCount : 1;
                page += 1;
                if (items.length === 0 || page >= pageCount || page >= maxPages) break;
            }
            return out;
        },

        async list(name, query) {
            return this.request('GET', this.endpoint(name), { query });
        },

        async get(name, params = {}) {
            let path = this.endpoint(name);
            for (const [key, value] of Object.entries(params)) {
                path = path.replace('{' + key + '}', encodeURIComponent(String(value)));
            }
            return this.request('GET', path);
        },

        async post(name, params = {}, body = {}) {
            let path = this.endpoint(name);
            for (const [key, value] of Object.entries(params)) {
                path = path.replace('{' + key + '}', encodeURIComponent(String(value)));
            }
            return this.request('POST', path, { body });
        },

        async patch(name, params = {}, body = {}) {
            let path = this.endpoint(name);
            for (const [key, value] of Object.entries(params)) {
                path = path.replace('{' + key + '}', encodeURIComponent(String(value)));
            }
            return this.request('PATCH', path, { body });
        },

        async del(name, params = {}, query) {
            let path = this.endpoint(name);
            for (const [key, value] of Object.entries(params)) {
                path = path.replace('{' + key + '}', encodeURIComponent(String(value)));
            }
            return this.request('DELETE', path, { query });
        },

        // Connects to the current instance: fetches /v3/info when available
        // and derives feature flags. Returns {ok, error?}.
        async connect() {
            if (!this.apiBase) return { ok: false, error: 'No instance selected.' };
            try {
                const data = await this.request('GET', ENDPOINTS.info.new, { timeout: 8000 });
                this.info = data;
                this.version = (data && data.version) || null;
                this.legacy = false;
                return { ok: true };
            } catch (err) {
                if (err.isAuth) return { ok: false, error: err.message, auth: true };
                if (err.status === 404) {
                    // Pre-v1.15.2 server without /v3/info — reachable, legacy surface.
                    this.info = null;
                    this.version = null;
                    this.legacy = true;
                    return { ok: true, legacy: true };
                }
                return { ok: false, error: err.message, network: err.isNetwork };
            }
        },

        feature(name) {
            const MIN = {
                hlsSessions: '1.18', moq: '1.19', forward: '1.20',
                tracks2: '1.17', availableProps: '1.16', userField: '1.17',
                staticSources: '1.21', forwardDests: '1.20', playbackTimespan: '1.11',
            };
            if (!(name in MIN)) return false;
            if (this.legacy) return false;
            if (!this.version) return false; // unknown version: hide uncertain features
            return versionAtLeast(this.version, MIN[name]);
        },

        // ---- Derived media URLs (from the server's own config) ----
        _mediaBase(address, encryption) {
            if (!address || !this.instance || !this.instance.url) return null;
            let host;
            try { host = new URL(this.instance.url).hostname; } catch (e) { return null; }
            // address forms: ":8889", "0.0.0.0:8889", "host:8889", "[::]:8889"
            const m = /^(?:\[(.+)\]|([^:]*)):?(\d+)$/.exec(String(address).trim());
            if (!m) return null;
            let addrHost = m[1] || m[2] || '';
            const port = m[3];
            if (!addrHost || addrHost === '0.0.0.0' || addrHost === '::') {
                addrHost = host;
            } else if (addrHost.includes(':') && !addrHost.startsWith('[')) {
                addrHost = '[' + addrHost + ']';
            }
            const scheme = encryption ? 'https' : 'http';
            return scheme + '://' + addrHost + ':' + port;
        },

        webrtcBase(global) {
            return this._mediaBase(global && global.webrtcAddress, !!(global && global.webrtcEncryption));
        },
        hlsBase(global) {
            return this._mediaBase(global && global.hlsAddress, !!(global && global.hlsEncryption));
        },
        playbackBase(global) {
            return this._mediaBase(global && global.playbackAddress, !!(global && global.playbackEncryption));
        },
        metricsBase(global) {
            return this._mediaBase(global && global.metricsAddress, !!(global && global.metricsEncryption));
        },
    };

    MM.api = api;
    MM.versionAtLeast = versionAtLeast;
})();
