// MM.sections — all section views, editors and their API interactions.
'use strict';
window.MM = window.MM || {};

(function () {
    const { esc, fmtBytes, fmtDuration, fmtDate, showToast, openModal, closeModal,
        confirmDialog, skeleton, emptyState } = MM.ui;
    const app = () => MM.app;
    const state = () => MM.app.state;

    const $ = (id) => document.getElementById(id);

    // Event delegation: one click handler per container, dispatch on data-action.
    function bindActions(container, handler) {
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            handler(btn.dataset.action, btn, e);
        });
    }

    // data-refresh buttons live in the static HTML; bind once.
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-refresh]');
        if (!btn) return;
        MM.app.loadSection(btn.dataset.refresh, true);
    });

    function renderError(node, err) {
        node.innerHTML = '<div class="empty-state"><div class="big">Something went wrong</div><div>' +
            esc(err && err.message ? err.message : String(err)) + '</div>' +
            '<div style="margin-top:10px"><button class="btn" data-refresh="' + esc(MM.app.state.activeSection) + '">Retry</button></div></div>';
    }

    function availableOf(runtimePath) {
        if (!runtimePath) return null;
        return 'available' in runtimePath ? !!runtimePath.available : !!runtimePath.ready;
    }

    function runtimeByName(name) {
        return state().runtimePaths.find((p) => p.name === name) || null;
    }

    function configByName(name) {
        return state().configPaths.find((p) => p.name === name) || null;
    }

    MM.sections = {};

    // =====================================================================
    // Dashboard
    // =====================================================================
    let _lastBytesSample = null; // {t, total}

    function fmtBits(bitsPerSec) {
        if (!isFinite(bitsPerSec) || bitsPerSec < 0) return '–';
        const units = ['bps', 'Kbps', 'Mbps', 'Gbps'];
        let i = 0, v = bitsPerSec;
        while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
        return (i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + units[i];
    }

    async function countFor(name, query) {
        try {
            const data = await MM.api.list(name, query);
            if (typeof data.itemCount === 'number') return data.itemCount;
            return Array.isArray(data.items) ? data.items.length : 0;
        } catch (e) { return null; }
    }

    MM.sections.dashboard = {
        interval: 15000,
        async load() {
            const g = state().global || {};
            const runtime = state().runtimePaths;
            const available = runtime.filter((p) => availableOf(p)).length;
            const totalBytes = runtime.reduce((acc, p) =>
                acc + (p.inboundBytes || 0) + (p.outboundBytes || 0), 0);
            let bitrate = null;
            const now = Date.now();
            if (_lastBytesSample && now > _lastBytesSample.t) {
                bitrate = 8 * (totalBytes - _lastBytesSample.total) / ((now - _lastBytesSample.t) / 1000);
            }
            _lastBytesSample = { t: now, total: totalBytes };

            const [rtsp, rtmp, srt, webrtc, hls, moq, recordings] = await Promise.all([
                countFor('rtspSessionsList'), countFor('rtmpConnsList'), countFor('srtConnsList'),
                countFor('webrtcSessionsList'),
                MM.api.has('hlsSessionsList') ? countFor('hlsSessionsList') : Promise.resolve(null),
                MM.api.has('moqSessionsList') ? countFor('moqSessionsList') : Promise.resolve(null),
                countFor('recordingsList'),
            ]);
            const connCount = [rtsp, rtmp, srt, webrtc, hls, moq].reduce((a, n) => a + (n || 0), 0);
            const readers = runtime.reduce((a, p) => a + (p.readers ? p.readers.length : 0), 0);

            $('dashStats').innerHTML =
                statCard(state().configPaths.length, 'Configured paths') +
                statCard(available, 'Streams available', runtime.length + ' runtime') +
                statCard(connCount, 'Active sessions', readers + ' readers attached') +
                statCard(bitrate === null ? '–' : fmtBits(bitrate), 'Total throughput') +
                statCard(recordings === null ? '–' : recordings, 'Recordings', 'paths with segments');

            const started = MM.api.info ? MM.api.info.startUtc || MM.api.info.started : null;
            $('dashServer').innerHTML =
                '<dl class="kv">' +
                kv('Version', MM.api.version || 'unknown (legacy server)') +
                kv('Started', fmtDate(started)) +
                kv('API', g.api && g.api.address) +
                kv('Auth method', g.authMethod || 'internal') +
                kv('RTSP', g.rtsp ? g.rtspAddress : null) +
                kv('RTMP', g.rtmp ? g.rtmpAddress : null) +
                kv('SRT', g.srt ? g.srtAddress : null) +
                kv('HLS', g.hls ? g.hlsAddress : null) +
                kv('WebRTC', g.webrtc ? g.webrtcAddress : null) +
                kv('Playback', g.playback && g.playback.enabled ? g.playbackAddress : null) +
                '</dl>';

            $('dashServices').innerHTML = serviceDefs()
                .map((s) => {
                    const on = !!(g[s.key]);
                    return '<span class="chip ' + (on ? 'green' : '') + '" style="margin:2px">' + esc(s.label) + '</span>';
                }).join('');
        },
    };

    function statCard(value, label, sub) {
        return '<div class="stat-card"><div class="stat-value">' + esc(value) + '</div>' +
            '<div class="stat-label">' + esc(label) + '</div>' +
            (sub ? '<div class="stat-sub">' + esc(sub) + '</div>' : '') + '</div>';
    }
    function kv(key, value) {
        if (value === undefined || value === null || value === '') return '';
        return '<dt>' + esc(key) + '</dt><dd>' + esc(value) + '</dd>';
    }

    function serviceDefs() {
        const g = state().global || {};
        const defs = [
            { key: 'rtsp', label: 'RTSP', addr: 'rtspAddress' },
            { key: 'rtmp', label: 'RTMP', addr: 'rtmpAddress' },
            { key: 'srt', label: 'SRT', addr: 'srtAddress' },
            { key: 'hls', label: 'HLS', addr: 'hlsAddress' },
            { key: 'webrtc', label: 'WebRTC', addr: 'webrtcAddress' },
            { key: 'api', label: 'API', addr: 'apiAddress' },
            { key: 'metrics', label: 'Metrics', addr: 'metricsAddress' },
            { key: 'pprof', label: 'Pprof', addr: 'pprofAddress' },
            { key: 'playback', label: 'Playback', addr: 'playbackAddress' },
        ];
        if (MM.api.feature('moq') || g.moq !== undefined) {
            defs.splice(5, 0, { key: 'moq', label: 'MoQ', addr: 'moqHTTP2Address' });
        }
        return defs;
    }

    // =====================================================================
    // Paths (config) + full path editor
    // =====================================================================
    const PATH_FIELDS = [
        { title: 'Source' },
        { key: 'sourceOnDemand', type: 'bool', label: 'Source on demand' },
        { key: 'sourceOnDemandStartTimeout', type: 'duration', label: 'On-demand start timeout' },
        { key: 'sourceOnDemandCloseAfter', type: 'duration', label: 'On-demand close after' },
        { key: 'sourceFingerprint', type: 'text', label: 'Source fingerprint (SHA256, optional)' },
        { key: 'overridePublisher', type: 'bool', label: 'Override publisher' },
        { key: 'rtspTransport', type: 'select', label: 'RTSP transport (static RTSP source)',
            options: [['', 'default'], ['udp', 'UDP'], ['multicast', 'Multicast'], ['tcp', 'TCP'], ['automatic', 'Automatic']] },
        { key: 'rtspAnyPort', type: 'bool', label: 'RTSP any port' },
        { key: 'rtspDemuxMpegts', type: 'bool', label: 'RTSP demux MPEG-TS' },
        { key: 'rtspRangeType', type: 'select', label: 'RTSP range type', options: [['', 'none'], ['clock', 'Clock'], ['npt', 'NPT']] },
        { key: 'rtspStart', type: 'text', label: 'RTSP start' },
        { key: 'rtspScale', type: 'text', label: 'RTSP scale' },
        { key: 'rtspUDPSourcePortRange', type: 'text', label: 'RTSP UDP source port range' },
        { key: 'rtpSDP', type: 'textarea', label: 'RTP SDP (for rtp:// sources)' },
        { key: 'srtPublishPassphrase', type: 'text', label: 'SRT publish passphrase' },
        { key: 'srtReadPassphrase', type: 'text', label: 'SRT read passphrase' },
        { key: 'moqTransport', type: 'text', label: 'MoQ transport (for moq:// sources)' },
        { title: 'Recording' },
        { key: 'record', type: 'bool', label: 'Record' },
        { key: 'recordPath', type: 'text', label: 'Record path' },
        { key: 'recordFormat', type: 'select', label: 'Record format', options: [['fmp4', 'fMP4'], ['mpegts', 'MPEG-TS']] },
        { key: 'recordPartDuration', type: 'duration', label: 'Part duration' },
        { key: 'recordMaxPartSize', type: 'text', label: 'Max part size (e.g. 30MB)' },
        { key: 'recordSegmentDuration', type: 'duration', label: 'Segment duration' },
        { key: 'recordDeleteAfter', type: 'duration', label: 'Delete after' },
        { key: 'useAbsoluteTimestamp', type: 'bool', label: 'Use absolute timestamps' },
        { title: 'Availability' },
        { key: 'alwaysAvailable', type: 'bool', label: 'Always available (placeholder stream)' },
        { key: 'alwaysAvailableTracks', type: 'text', label: 'Always-available tracks' },
        { key: 'alwaysAvailableFile', type: 'text', label: 'Always-available file' },
        { key: 'alwaysAvailableRecorded', type: 'bool', label: 'Always available recorded' },
        { key: 'maxReaders', type: 'number', label: 'Max readers (0 = unlimited)' },
        { title: 'Forwarding (MediaMTX v1.20+)' },
        { key: 'forward', type: 'json', label: 'Forward destinations', min: 'forward',
            hint: 'JSON object of named destinations, e.g. {"srv2":{"rtsp":"rtsp://addr/path"}} — see server docs for the exact schema of your version.' },
        { title: 'Hooks' },
        { key: 'runOnInit', type: 'text', label: 'runOnInit' },
        { key: 'runOnInitRestart', type: 'bool', label: 'runOnInitRestart' },
        { key: 'runOnDemand', type: 'text', label: 'runOnDemand' },
        { key: 'runOnDemandRestart', type: 'bool', label: 'runOnDemandRestart' },
        { key: 'runOnDemandStartTimeout', type: 'duration', label: 'runOnDemandStartTimeout' },
        { key: 'runOnDemandCloseAfter', type: 'duration', label: 'runOnDemandCloseAfter' },
        { key: 'runOnUnDemand', type: 'text', label: 'runOnUnDemand' },
        { key: 'runOnAvailable', type: 'text', label: 'runOnAvailable' },
        { key: 'runOnAvailableRestart', type: 'bool', label: 'runOnAvailableRestart' },
        { key: 'runOnUnavailable', type: 'text', label: 'runOnUnavailable' },
        { key: 'runOnOnline', type: 'text', label: 'runOnOnline' },
        { key: 'runOnOnlineRestart', type: 'bool', label: 'runOnOnlineRestart' },
        { key: 'runOnOffline', type: 'text', label: 'runOnOffline' },
        { key: 'runOnRead', type: 'text', label: 'runOnRead' },
        { key: 'runOnReadRestart', type: 'bool', label: 'runOnReadRestart' },
        { key: 'runOnUnread', type: 'text', label: 'runOnUnread' },
        { key: 'runOnRecordSegmentCreate', type: 'text', label: 'runOnRecordSegmentCreate' },
        { key: 'runOnRecordSegmentComplete', type: 'text', label: 'runOnRecordSegmentComplete' },
    ];

    const SOURCE_TYPES = [
        ['publisher', 'Publisher (push)'],
        ['static', 'Static source (pull)'],
        ['redirect', 'Redirect'],
    ];

    function sourceParts(pathConf) {
        const source = pathConf && pathConf.source !== undefined ? String(pathConf.source) : 'publisher';
        if (source === 'publisher') return { type: 'publisher', value: '' };
        if (source.startsWith('redirect:')) return { type: 'redirect', value: source.slice('redirect:'.length) };
        return { type: 'static', value: source === '' ? '' : source };
    }

    function pathEditorBody({ conf, isDefaults, defaults }) {
        const base = conf || defaults || {};
        const src = sourceParts(conf);
        const wrap = document.createElement('div');

        let html = '';
        if (!isDefaults) {
            html +=
                '<div class="form-row"><label>Path name</label>' +
                '<input id="peName" type="text" value="' + esc(conf ? conf.name : '') + '" ' + (conf ? '' : 'placeholder="e.g. mystream"') + '>' +
                '<div class="form-hint">Use <code>all_others</code> to edit the catch-all path (must not already exist).</div></div>' +
                '<div class="form-grid"><div class="form-row"><label>Source type</label><select id="peSourceType">' +
                SOURCE_TYPES.map(([v, l]) => '<option value="' + v + '"' + (src.type === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('') +
                '</select></div>' +
                '<div class="form-row" id="peSourceRow"><label>Source URL / target</label>' +
                '<input id="peSource" type="text" value="' + esc(src.value) + '" placeholder="rtsp://… rtmp://… srt://… udp://…"></div></div>';
        }
        wrap.innerHTML = html;

        for (const field of PATH_FIELDS) {
            if (field.title) {
                const t = document.createElement('div');
                t.className = 'form-group-title';
                t.textContent = field.title;
                wrap.appendChild(t);
                continue;
            }
            if (field.min && !MM.api.feature(field.min)) continue;
            const row = document.createElement('div');
            row.className = 'form-row';
            const current = base[field.key];
            if (field.type === 'bool') {
                row.innerHTML = '<div class="check-row"><input type="checkbox" data-field="' + esc(field.key) + '"' +
                    (current ? ' checked' : '') + ' id="pe_' + esc(field.key) + '"><label for="pe_' + esc(field.key) + '">' +
                    esc(field.label) + '</label></div>';
            } else if (field.type === 'select') {
                row.innerHTML = '<label>' + esc(field.label) + '</label><select data-field="' + esc(field.key) + '">' +
                    field.options.map(([v, l]) => '<option value="' + esc(v) + '"' +
                        (String(current === undefined ? v : current) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') +
                    '</select>';
            } else if (field.type === 'textarea' || field.type === 'json') {
                row.innerHTML = '<label>' + esc(field.label) + '</label>' +
                    '<textarea data-field="' + esc(field.key) + '" rows="4">' +
                    esc(field.type === 'json' && current !== undefined ? JSON.stringify(current, null, 2) : (current || '')) +
                    '</textarea>' +
                    (field.hint ? '<div class="form-hint">' + esc(field.hint) + '</div>' : '');
            } else {
                const type = field.type === 'number' ? 'number' : 'text';
                row.innerHTML = '<label>' + esc(field.label) + '</label>' +
                    '<input type="' + type + '" data-field="' + esc(field.key) + '" value="' +
                    esc(current === undefined || current === null ? '' : current) + '">' +
                    (field.hint ? '<div class="form-hint">' + esc(field.hint) + '</div>' : '');
            }
            wrap.appendChild(row);
        }

        if (!isDefaults) {
            const srcType = wrap.querySelector('#peSourceType');
            const srcRow = wrap.querySelector('#peSourceRow');
            const syncSource = () => { srcRow.style.display = srcType.value === 'publisher' ? 'none' : ''; };
            srcType.addEventListener('change', syncSource);
            syncSource();
        }
        return wrap;
    }

    // Builds the PATCH/POST body from the form. Only fields that differ from
    // `original` are included. Returns {ok, body|error, name, sourceOmitted}.
    function collectPathForm(bodyEl, { conf, isDefaults, defaults }) {
        const original = conf || defaults || {};
        const body = {};

        for (const field of PATH_FIELDS) {
            if (field.title) continue;
            const node = bodyEl.querySelector('[data-field="' + field.key + '"]');
            if (!node) continue;
            let value;
            if (field.type === 'bool') value = node.checked;
            else if (field.type === 'number') value = node.value.trim() === '' ? null : Number(node.value);
            else value = node.value;

            const orig = original[field.key] === undefined ? null : original[field.key];
            if (field.type === 'json') {
                const text = String(node.value).trim();
                if (text === '') {
                    // Only send an explicit null when clearing an existing value.
                    if (orig === null || orig === undefined) continue;
                    body[field.key] = null;
                    continue;
                }
                try {
                    const parsed = JSON.parse(text);
                    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
                        throw new Error('must be a JSON object');
                    }
                    body[field.key] = parsed;
                } catch (err) {
                    return { ok: false, error: 'Field "' + field.label + '" is not valid JSON: ' + err.message };
                }
                continue;
            }
            const changed = field.type === 'bool'
                ? value !== !!orig
                : String(value === null ? '' : value) !== String(orig === null || orig === undefined ? '' : orig);
            if (!changed) continue;
            if (value === null || value === '') body[field.key] = null;
            else body[field.key] = value;
        }

        let name = null;
        let source;
        if (!isDefaults) {
            name = bodyEl.querySelector('#peName').value.trim();
            if (!name) return { ok: false, error: 'Path name is required.' };
            const srcType = bodyEl.querySelector('#peSourceType').value;
            const srcValue = bodyEl.querySelector('#peSource').value.trim();
            if (srcType === 'publisher') {
                // The literal string "publisher" is not a patchable value: omit.
                source = undefined;
            } else if (srcType === 'redirect') {
                if (!srcValue) return { ok: false, error: 'Redirect target is required.' };
                source = 'redirect:' + srcValue;
            } else {
                if (!srcValue) return { ok: false, error: 'Source URL is required for a static source.' };
                source = srcValue;
            }
        }
        return { ok: true, body, name, source };
    }

    async function openPathEditor({ conf, isDefaults }) {
        let defaults = null;
        try {
            defaults = await MM.api.request('GET', MM.api.endpoint('pathDefaultsGet'));
        } catch (err) { /* form works without defaults */ }

        const body = pathEditorBody({ conf, isDefaults, defaults });
        openModal({
            title: isDefaults ? 'Path defaults' : (conf ? 'Edit path "' + conf.name + '"' : 'Add path'),
            wide: true,
            body,
            buttons: [{
                label: isDefaults ? 'Save defaults' : 'Save', class: 'primary',
                async onClick(bodyEl) {
                    const collected = collectPathForm(bodyEl, { conf, isDefaults, defaults });
                    if (!collected.ok) throw new Error(collected.error);
                    const { name, source } = collected;
                    const payload = { ...collected.body };
                    if (!isDefaults && source !== undefined) payload.source = source;

                    if (isDefaults) {
                        await MM.api.request('PATCH', MM.api.endpoint('pathDefaultsPatch'), { body: payload });
                    } else if (conf) {
                        await MM.api.request('PATCH', MM.api.endpoint('configPathPatch').replace('{name}', encodeURIComponent(name)), { body: payload });
                    } else {
                        // For a new path the server defaults to a publisher source
                        // when "source" is omitted.
                        await MM.api.request('POST', MM.api.endpoint('configPathAdd').replace('{name}', encodeURIComponent(name)), { body: payload });
                    }
                    await app().refreshCoreQuiet();
                    MM.sections.paths.load(true);
                    showToast(isDefaults ? 'Path defaults saved' : 'Path "' + name + '" saved', 'success');
                },
            }],
        });
    }

    MM.sections.paths = {
        interval: 20000,
        async load() {
            const node = $('pathsList');
            const rows = state().configPaths.map((conf) => {
                const rt = runtimeByName(conf.name);
                const avail = availableOf(rt);
                const src = sourceParts(conf);
                const srcLabel = src.type === 'publisher' ? 'publisher' : esc(src.value.length > 42 ? src.value.slice(0, 42) + '…' : src.value);
                const isCatchAll = conf.name === 'all_others' || conf.name === 'all' || conf.name === '~^.*$';
                return '<tr data-path="' + esc(conf.name) + '">' +
                    '<td><span class="status-dot ' + (avail ? 'on' : 'off') + '"></span>' +
                    esc(conf.name) + (isCatchAll ? ' <span class="chip warn">catch-all</span>' : '') + '</td>' +
                    '<td>' + srcLabel + '</td>' +
                    '<td>' + (conf.record ? '<span class="chip red">recording</span>' : '<span class="chip">off</span>') + '</td>' +
                    '<td>' + (rt && rt.readers ? rt.readers.length : 0) + '</td>' +
                    '<td class="actions">' +
                    '<button class="btn small" data-action="edit">Edit</button> ' +
                    '<button class="btn small" data-action="toggle-record">' + (conf.record ? 'Stop rec' : 'Record') + '</button> ' +
                    '<button class="btn small danger" data-action="delete">Delete</button>' +
                    '</td></tr>';
            });
            node.innerHTML = rows.length
                ? '<table><thead><tr><th>Path</th><th>Source</th><th>Recording</th><th>Readers</th><th></th></tr></thead><tbody>' +
                  rows.join('') + '</tbody></table>'
                : emptyState('No configured paths', 'Add a path, or publish directly and let the catch-all handle it.');
        },
    };

    bindActions($('pathsList'), async (action, btn) => {
        const name = btn.closest('tr').dataset.path;
        const conf = configByName(name);
        if (action === 'edit') {
            openPathEditor({ conf, isDefaults: false });
        } else if (action === 'delete') {
            const yes = await confirmDialog('Delete path', 'Delete path "' + name + '" from the configuration?');
            if (!yes) return;
            try {
                await MM.api.request('DELETE', MM.api.endpoint('configPathDelete').replace('{name}', encodeURIComponent(name)));
                await app().refreshCoreQuiet();
                MM.sections.paths.load(true);
                showToast('Path deleted', 'success');
            } catch (err) { showToast(err.message, 'error', 6000); }
        } else if (action === 'toggle-record') {
            try {
                await MM.api.request('PATCH', MM.api.endpoint('configPathPatch').replace('{name}', encodeURIComponent(name)), { body: { record: !(conf && conf.record) } });
                await app().refreshCoreQuiet();
                MM.sections.paths.load(true);
                showToast('Recording ' + (conf && conf.record ? 'stopped' : 'started') + ' for "' + name + '"', 'success');
            } catch (err) { showToast(err.message, 'error', 6000); }
        }
    });

    $('btnAddPath').addEventListener('click', () => openPathEditor({ conf: null, isDefaults: false }));
    $('btnPathDefaults').addEventListener('click', () => openPathEditor({ conf: null, isDefaults: true }));

    // =====================================================================
    // Users & permissions
    // =====================================================================
    const ACTIONS = ['publish', 'read', 'playback', 'api', 'metrics', 'pprof'];

    MM.sections.users = {
        interval: 30000,
        async load() {
            const g = state().global || {};
            const users = g.authInternalUsers || [];
            $('usersNotice').innerHTML = (g.authMethod && g.authMethod !== 'internal')
                ? '<div class="notice">Server auth method is "' + esc(g.authMethod) + '" — internal users below may not be enforced.</div>'
                : '';
            const node = $('usersList');
            node.innerHTML = users.length
                ? '<table><thead><tr><th>User</th><th>IPs</th><th>Permissions</th><th></th></tr></thead><tbody>' +
                  users.map((u, i) => '<tr data-user="' + esc(u.user) + '" data-index="' + i + '">' +
                      '<td>' + esc(u.user) + (u.pass ? '' : ' <span class="chip warn">no password</span>') + '</td>' +
                      '<td>' + esc((u.ips || []).join(', ') || 'any') + '</td>' +
                      '<td>' + (u.permissions || []).map((p) =>
                          '<span class="chip' + (p.action === 'api' ? ' accent' : '') + '">' +
                          esc(p.action) + ':' + esc(p.path || '') + '</span>').join(' ') + '</td>' +
                      '<td class="actions">' +
                      '<button class="btn small" data-action="edit">Edit</button> ' +
                      '<button class="btn small danger" data-action="delete">Delete</button>' +
                      '</td></tr>').join('') + '</tbody></table>'
                : emptyState('No internal users', 'The API is reachable because your IP is in the default localhost exception.');
        },
    };

    bindActions($('usersList'), async (action, btn) => {
        const user = btn.closest('tr').dataset.user;
        if (action === 'edit') {
            openUserEditor(user);
        } else if (action === 'delete') {
            const yes = await confirmDialog('Delete user', 'Delete internal user "' + user + '"?');
            if (!yes) return;
            try {
                const g = state().global;
                const next = (g.authInternalUsers || []).filter((u) => u.user !== user);
                await MM.api.request('PATCH', MM.api.endpoint('configGlobalPatch'), { body: { authInternalUsers: next } });
                await app().refreshCoreQuiet();
                MM.sections.users.load(true);
                showToast('User deleted', 'success');
            } catch (err) { showToast(err.message, 'error', 6000); }
        }
    });

    function openUserEditor(username) {
        const g = state().global || {};
        const users = g.authInternalUsers || [];
        const existing = username ? users.find((u) => u.user === username) : null;
        const perms = existing ? (existing.permissions || []) : [{ action: 'publish', path: '' }, { action: 'read', path: '' }];

        const body = document.createElement('div');
        body.innerHTML =
            '<div class="form-grid"><div class="form-row"><label>User</label>' +
            '<input id="ueUser" type="text" value="' + esc(existing ? existing.user : '') + '" autocomplete="off"></div>' +
            '<div class="form-row"><label>Password ' + (existing ? '(leave blank to keep)' : '') + '</label>' +
            '<input id="uePass" type="password" autocomplete="new-password" placeholder="' + (existing ? 'unchanged' : 'required') + '"></div></div>' +
            '<div class="form-row"><label>Allowed IPs (comma-separated, empty = any)</label>' +
            '<input id="ueIps" type="text" value="' + esc((existing && existing.ips || []).join(', ')) + '" placeholder="e.g. 127.0.0.1, ::1"></div>' +
            '<div class="form-group-title">Permissions</div>' +
            '<div id="uePerms"></div>' +
            '<button class="btn small" id="ueAddPerm">Add permission</button>';

        const permsNode = body.querySelector('#uePerms');
        function permRow(perm = { action: 'publish', path: '' }) {
            const row = document.createElement('div');
            row.className = 'perm-row';
            row.innerHTML = '<select>' + ACTIONS.map((a) =>
                '<option value="' + a + '"' + (perm.action === a ? ' selected' : '') + '>' + a + '</option>').join('') +
                '</select><input type="text" value="' + esc(perm.path || '') + '" placeholder="path (empty = all)">' +
                '<button class="icon-btn" title="Remove" aria-label="Remove">' + MM.ui.svg('close') + '</button>';
            row.querySelector('button').addEventListener('click', () => row.remove());
            permsNode.appendChild(row);
        }
        perms.forEach(permRow);
        body.querySelector('#ueAddPerm').addEventListener('click', () => permRow());

        openModal({
            title: existing ? 'Edit user "' + existing.user + '"' : 'Add user',
            wide: true,
            body,
            buttons: [{
                label: 'Save', class: 'primary',
                async onClick(bodyEl) {
                    const user = bodyEl.querySelector('#ueUser').value.trim();
                    if (!user) throw new Error('Username is required.');
                    const pass = bodyEl.querySelector('#uePass').value;
                    if (!existing && !pass) throw new Error('A password is required for a new user.');
                    const ips = bodyEl.querySelector('#ueIps').value.split(',').map((s) => s.trim()).filter(Boolean);
                    const permissions = [...bodyEl.querySelectorAll('.perm-row')].map((row) => ({
                        action: row.querySelector('select').value,
                        path: row.querySelector('input').value.trim(),
                    }));

                    // Build the full next user list from the server copy; never
                    // mutate cached state before the PATCH succeeds.
                    let next = users.filter((u) => u.user !== (existing ? existing.user : null));
                    if (existing && existing.user === user) {
                        // keep position
                        const idx = users.findIndex((u) => u.user === existing.user);
                        next = users.slice();
                        next[idx] = {
                            user,
                            pass: pass || existing.pass,
                            ips,
                            permissions,
                        };
                    } else {
                        if (users.some((u) => u.user === user)) throw new Error('A user with that name already exists.');
                        next.push({ user, pass, ips, permissions });
                    }
                    await MM.api.request('PATCH', MM.api.endpoint('configGlobalPatch'), { body: { authInternalUsers: next } });
                    await app().refreshCoreQuiet();
                    MM.sections.users.load(true);
                    showToast('User "' + user + '" saved', 'success');
                },
            }],
        });
    }

    $('btnAddUser').addEventListener('click', () => openUserEditor(null));

    // =====================================================================
    // Services
    // =====================================================================
    MM.sections.services = {
        interval: 30000,
        async load() {
            const g = state().global || {};
            const node = $('servicesList');
            node.innerHTML = serviceDefs().map((s) => {
                const on = !!g[s.key];
                const addr = s.addr && g[s.addr] ? g[s.addr] : '';
                return '<div class="service-card" data-service="' + esc(s.key) + '">' +
                    '<div class="svc-info"><div class="svc-name">' + esc(s.label) + '</div>' +
                    '<div class="svc-addr">' + esc(addr) + '</div></div>' +
                    '<label class="switch"><input type="checkbox" data-action="toggle"' + (on ? ' checked' : '') + '>' +
                    '<span class="slider"></span></label></div>';
            }).join('');
        },
    };

    // Change listener bound once at module scope (never inside load()).
    $('servicesList').addEventListener('change', async (e) => {
        const input = e.target.closest('input[data-action="toggle"]');
        if (!input) return;
        const key = input.closest('.service-card').dataset.service;
        const value = input.checked;
        try {
            await MM.api.request('PATCH', MM.api.endpoint('configGlobalPatch'), { body: { [key]: value } });
            state().global[key] = value;
            showToast((value ? 'Enabled ' : 'Disabled ') + key, 'success');
            MM.sections.dashboard.load().catch(() => {});
        } catch (err) {
            input.checked = !value; // revert on failure
            showToast(err.message, 'error', 6000);
        }
    });

    // =====================================================================
    // Connections
    // =====================================================================
    const CONN_DEFS = [
        { id: 'rtsp-conns', label: 'RTSP conns', list: 'rtspConnsList', get: 'rtspConnsGet', kick: null, isConn: true },
        { id: 'rtsp-sessions', label: 'RTSP sessions', list: 'rtspSessionsList', get: 'rtspSessionsGet', kick: 'rtspSessionsKick' },
        { id: 'rtsps-conns', label: 'RTSPS conns', list: 'rtspsConnsList', get: 'rtspsConnsGet', kick: null, isConn: true },
        { id: 'rtsps-sessions', label: 'RTSPS sessions', list: 'rtspsSessionsList', get: 'rtspsSessionsGet', kick: 'rtspsSessionsKick' },
        { id: 'rtmp', label: 'RTMP', list: 'rtmpConnsList', get: 'rtmpConnsGet', kick: 'rtmpConnsKick', isConn: true },
        { id: 'rtmps', label: 'RTMPS', list: 'rtmpsConnsList', get: 'rtmpsConnsGet', kick: 'rtmpsConnsKick', isConn: true },
        { id: 'srt', label: 'SRT', list: 'srtConnsList', get: 'srtConnsGet', kick: 'srtConnsKick', isConn: true },
        { id: 'webrtc', label: 'WebRTC', list: 'webrtcSessionsList', get: 'webrtcSessionsGet', kick: 'webrtcSessionsKick' },
        { id: 'hls', label: 'HLS sessions', list: 'hlsSessionsList', get: 'hlsSessionGet', kick: 'hlsSessionKick' },
        { id: 'moq', label: 'MoQ sessions', list: 'moqSessionsList', get: 'moqSessionGet', kick: 'moqSessionKick' },
    ];

    function fieldOf(item, names) {
        for (const n of names) {
            if (item[n] !== undefined && item[n] !== null && item[n] !== '') return item[n];
        }
        return null;
    }

    const connData = { activeTab: null, items: [], def: null };

    MM.sections.connections = {
        interval: 10000,
        async load() {
            const defs = CONN_DEFS.filter((d) => MM.api.has(d.list));
            const counts = await Promise.all(defs.map((d) => countFor(d.list)));
            const tabsNode = $('connTabs');
            if (!connData.activeTab || !defs.some((d) => d.id === connData.activeTab)) {
                const firstNonEmpty = defs.findIndex((d, i) => counts[i] > 0);
                connData.activeTab = defs[firstNonEmpty >= 0 ? firstNonEmpty : 0].id;
            }
            // Only re-render the tab bar when something changed — re-rendering
            // on every poll can eat clicks mid-action.
            const signature = JSON.stringify(counts) + '|' + connData.activeTab;
            if (signature !== connData.tabSignature) {
                connData.tabSignature = signature;
                tabsNode.innerHTML = defs.map((d, i) =>
                    '<button class="tab' + (d.id === connData.activeTab ? ' active' : '') + '" data-action="tab" data-tab="' + esc(d.id) + '">' +
                    esc(d.label) + (counts[i] !== null ? ' <span class="count">' + counts[i] + '</span>' : '') + '</button>').join('');
            }
            await loadConnTab();
        },
    };

    async function loadConnTab() {
        const defs = CONN_DEFS.filter((d) => MM.api.has(d.list));
        const def = defs.find((d) => d.id === connData.activeTab);
        const node = $('connList');
        if (!def) { node.innerHTML = emptyState('No connection types available', 'Enable a protocol in Services.'); return; }
        connData.def = def;
        try {
            connData.items = await MM.api.listAll(def.list, { itemsPerPage: 100 });
        } catch (err) {
            renderError(node, err);
            return;
        }
        if (!connData.items.length) {
            node.innerHTML = emptyState('No ' + def.label.toLowerCase(), 'Nothing is connected right now.');
            return;
        }
        node.innerHTML = '<table><thead><tr><th>ID</th><th>User</th><th>Path</th><th>State</th>' +
            '<th>Bytes in</th><th>Bytes out</th><th>Since</th><th></th></tr></thead><tbody>' +
            connData.items.map((item) => {
                const id = fieldOf(item, ['id', 'sessionId', 'uuid']) || '?';
                return '<tr data-conn="' + esc(id) + '">' +
                    '<td title="' + esc(id) + '">' + esc(String(id).slice(0, 14)) + '</td>' +
                    '<td>' + esc(fieldOf(item, ['user', 'username']) || '–') + '</td>' +
                    '<td>' + esc(fieldOf(item, ['path', 'sourcePath']) || '–') + '</td>' +
                    '<td>' + esc(fieldOf(item, ['state']) || '–') + '</td>' +
                    '<td>' + esc(fmtBytes(fieldOf(item, ['inboundBytes', 'bytesIn']))) + '</td>' +
                    '<td>' + esc(fmtBytes(fieldOf(item, ['outboundBytes', 'bytesOut']))) + '</td>' +
                    '<td>' + esc(fmtDate(fieldOf(item, ['created', 'established', 'sessionCreated', 'started']))) + '</td>' +
                    '<td class="actions">' +
                    '<button class="btn small" data-action="details">Details</button>' +
                    (def.kick ? ' <button class="btn small danger" data-action="kick">Kick</button>' : '') +
                    '</td></tr>';
            }).join('') + '</tbody></table>';
    }

    bindActions($('connTabs'), (action, btn) => {
        if (action !== 'tab') return;
        connData.activeTab = btn.dataset.tab;
        $('connTabs').querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === connData.activeTab));
        loadConnTab().catch((err) => showToast(err.message, 'error', 6000));
    });

    bindActions($('connList'), async (action, btn) => {
        const id = btn.closest('tr').dataset.conn;
        const item = connData.items.find((it) => String(fieldOf(it, ['id', 'sessionId', 'uuid'])) === id);
        if (action === 'details') {
            openModal({
                title: 'Connection details',
                body: '<pre class="json-view">' + esc(JSON.stringify(item, null, 2)) + '</pre>',
                buttons: [{ label: 'Close' }],
            });
        } else if (action === 'kick') {
            const yes = await confirmDialog('Kick connection', 'Kick ' + connData.def.label + ' connection ' + id + '?');
            if (!yes) return;
            try {
                await MM.api.post(connData.def.kick, { id });
                showToast('Connection kicked', 'success');
                await loadConnTab();
            } catch (err) { showToast(err.message, 'error', 6000); }
        }
    });

    // =====================================================================
    // Recordings
    // =====================================================================
    const recData = { expanded: new Set() };

    MM.sections.recordings = {
        interval: 60000,
        async load() {
            const node = $('recordingsList');
            let recordings;
            try {
                recordings = await MM.api.listAll('recordingsList');
            } catch (err) {
                renderError(node, err);
                return;
            }
            if (!recordings.length) {
                node.innerHTML = emptyState('No recordings', 'Enable "Record" on a path to start recording.');
                return;
            }
            node.innerHTML = '<table><thead><tr><th>Path</th><th>Segments</th><th>Duration</th><th>Size</th><th></th></tr></thead><tbody>' +
                recordings.map((rec) => {
                    const segs = rec.segments || [];
                    const totalDur = segs.reduce((a, s) => a + (s.duration || 0), 0);
                    const totalSize = segs.reduce((a, s) => a + (s.size || 0), 0);
                    const open = recData.expanded.has(rec.name);
                    return '<tr class="rec-row" data-rec="' + esc(rec.name) + '">' +
                        '<td>' + esc(rec.name) + '</td>' +
                        '<td>' + segs.length + '</td>' +
                        '<td>' + esc(fmtDuration(totalDur)) + '</td>' +
                        '<td>' + esc(fmtBytes(totalSize)) + '</td>' +
                        '<td class="actions"><button class="btn small" data-action="expand">' + (open ? 'Hide segments' : 'Segments') + '</button></td></tr>' +
                        (open ? '<tr class="seg-row"><td colspan="5" data-segfor="' + esc(rec.name) + '">' + skeleton(2) + '</td></tr>' : '');
                }).join('') + '</tbody></table>';

            for (const name of recData.expanded) {
                if (recordings.some((r) => r.name === name)) renderSegments(name).catch(() => {});
            }
        },
    };

    async function renderSegments(name) {
        const cell = document.querySelector('[data-segfor="' + CSS.escape(name) + '"]');
        if (!cell) return;
        let rec;
        try {
            rec = await MM.api.get('recordingsGet', { name });
        } catch (err) {
            cell.innerHTML = '<div class="notice">' + esc(err.message) + '</div>';
            return;
        }
        const segs = rec.segments || [];
        if (!segs.length) { cell.innerHTML = '<div class="notice">No segments.</div>'; return; }
        const g = state().global || {};
        const playbackOk = !!(g.playback && g.playback.enabled) && !!MM.api.playbackBase(g);
        cell.innerHTML = '<table><thead><tr><th>Start</th><th>Duration</th><th>Size</th><th></th></tr></thead><tbody>' +
            segs.slice().reverse().map((seg) => '<tr>' +
                '<td>' + esc(fmtDate(seg.start)) + '</td>' +
                '<td>' + esc(fmtDuration(seg.duration)) + '</td>' +
                '<td>' + esc(fmtBytes(seg.size)) + '</td>' +
                '<td class="actions">' +
                '<button class="btn small" data-action="play" data-start="' + esc(seg.start) + '"' + (playbackOk ? '' : ' disabled title="Playback server disabled"') + '>Play</button> ' +
                '<button class="btn small danger" data-action="delete-seg" data-start="' + esc(seg.start) + '">Delete</button>' +
                '</td></tr>').join('') + '</tbody></table>' +
            '<div class="btn-row" style="margin-top:10px">' +
            '<button class="btn small" data-action="play-range">Play custom range…</button></div>';
    }

    async function fetchSegmentMp4(query) {
        const g = state().global || {};
        const base = MM.api.playbackBase(g);
        if (!base) throw new Error('Playback server address unknown or disabled.');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        let res;
        try {
            res = await fetch(base + '/get?' + new URLSearchParams(query), {
                headers: MM.api.authHeaders(), signal: controller.signal,
            });
        } catch (err) {
            throw new Error('Cannot reach the playback server. Check "playbackAddress" and CORS settings.');
        } finally { clearTimeout(timer); }
        if (!res.ok) throw new Error('Playback server error: HTTP ' + res.status);
        return URL.createObjectURL(await res.blob());
    }

    function playMp4Modal(title, query) {
        const body = openModal({
            title,
            body: '<div class="video-wrap"><video controls autoplay style="width:100%"></video>' +
                  '<div class="player-overlay"><div class="spinner"></div><div>Loading…</div></div></div>',
            wide: true,
            buttons: [{ label: 'Close' }],
            onOpen: async (el) => {
                try {
                    const url = await fetchSegmentMp4(query);
                    const video = el.querySelector('video');
                    const overlay = el.querySelector('.player-overlay');
                    if (overlay) overlay.remove();
                    video.src = url;
                    video.play().catch(() => {});
                } catch (err) {
                    el.querySelector('.video-wrap').innerHTML = '<div class="notice" style="margin:10px">' + esc(err.message) + '</div>';
                }
            },
        });
        return body;
    }

    bindActions($('recordingsList'), async (action, btn) => {
        const recRow = btn.closest('tr[data-rec]');
        const segCell = btn.closest('td[data-segfor]');
        const recName = recRow ? recRow.dataset.rec : (segCell ? segCell.dataset.segfor : null);
        if (!recName) return;
        if (action === 'expand') {
            if (recData.expanded.has(recName)) {
                recData.expanded.delete(recName);
            } else {
                recData.expanded.add(recName);
            }
            MM.sections.recordings.load(true);
        } else if (action === 'play') {
            const start = btn.dataset.start;
            playMp4Modal('Playback: ' + recName, { path: recName, start });
        } else if (action === 'play-range') {
            openRangeModal(recName);
        } else if (action === 'delete-seg') {
            const start = btn.dataset.start;
            const yes = await confirmDialog('Delete segment', 'Delete the segment of "' + recName + '" starting at ' + start + '? This cannot be undone.');
            if (!yes) return;
            try {
                await MM.api.del('recordingsSegmentDelete', {}, { path: recName, start });
                showToast('Segment deleted', 'success');
                await renderSegments(recName);
                MM.sections.recordings.load(true);
            } catch (err) { showToast(err.message, 'error', 6000); }
        }
    });

    function openRangeModal(path) {
        const body = document.createElement('div');
        body.innerHTML =
            '<div class="form-grid"><div class="form-row"><label>Start (optional)</label>' +
            '<input type="datetime-local" id="rgStart"></div>' +
            '<div class="form-row"><label>End (optional)</label>' +
            '<input type="datetime-local" id="rgEnd"></div></div>' +
            '<div class="form-hint">Reads the recording between the two times into a single MP4.</div>';
        openModal({
            title: 'Playback range: ' + path,
            body,
            buttons: [{
                label: 'Play', class: 'primary',
                onClick(el) {
                    const start = el.querySelector('#rgStart').value;
                    const end = el.querySelector('#rgEnd').value;
                    const query = { path };
                    if (start) query.start = new Date(start).toISOString();
                    if (end) query.end = new Date(end).toISOString();
                    playMp4Modal('Playback: ' + path, query);
                },
            }],
        });
    }

    // =====================================================================
    // Live players
    // =====================================================================
    const playerCards = new Map(); // path -> {el, refs, controller}

    MM.sections.players = {
        interval: 10000,
        async load(force) {
            const grid = $('playersGrid');
            const runtime = state().runtimePaths;
            if (!runtime.length) {
                playerCards.forEach((c) => MM.players.stopPlayer(c.controller));
                playerCards.clear();
                grid.innerHTML = emptyState('No active paths', 'Publish a stream to see it here.');
                return;
            }

            // Remove cards for paths that disappeared (stops their players).
            for (const [path, card] of [...playerCards]) {
                if (!runtime.some((p) => p.name === path)) {
                    MM.players.stopPlayer(card.controller);
                    card.el.remove();
                    playerCards.delete(path);
                }
            }

            for (const rt of runtime) {
                let card = playerCards.get(rt.name);
                if (!card) {
                    card = buildPlayerCard(rt);
                    playerCards.set(rt.name, card);
                    grid.appendChild(card.el);
                    startCardPlayer(card, rt);
                }
                updatePlayerCard(card, rt);
            }
        },
    };

    function buildPlayerCard(rt) {
        const el = document.createElement('div');
        el.className = 'player-card';
        el.innerHTML =
            '<div class="player-head">' +
            '<div class="player-title"><span class="status-dot off"></span>' + esc(rt.name) + '</div>' +
            '<span class="chip" data-ref="transport"></span></div>' +
            '<div class="player-video-wrap"><video muted playsinline></video>' +
            '<div class="player-overlay" data-ref="overlay"><div class="spinner"></div><div data-ref="ovtext">Connecting…</div></div></div>' +
            '<div class="player-controls">' +
            '<button class="icon-btn" data-action="mute" title="Mute / unmute">' + MM.ui.svg('play') + '</button>' +
            '<input type="range" min="0" max="100" value="100" data-action="volume" title="Volume">' +
            '<span class="grow"></span>' +
            '<button class="icon-btn" data-action="snapshot" title="Snapshot">' + MM.ui.svg('snapshot') + '</button>' +
            '<button class="icon-btn" data-action="fullscreen" title="Fullscreen">' + MM.ui.svg('fullscreen') + '</button>' +
            '<button class="icon-btn" data-action="info" title="Stream info">' + MM.ui.svg('info') + '</button>' +
            '</div>' +
            '<div class="player-foot" style="padding:0 12px 10px;display:flex;gap:8px;align-items:center;justify-content:space-between">' +
            '<span class="muted" style="font-size:11.5px" data-ref="bytes"></span>' +
            '<button class="btn small" data-action="record">Record</button></div>';
        const refs = {
            dot: el.querySelector('.status-dot'),
            transport: el.querySelector('[data-ref="transport"]'),
            overlay: el.querySelector('[data-ref="overlay"]'),
            ovtext: el.querySelector('[data-ref="ovtext"]'),
            video: el.querySelector('video'),
            bytes: el.querySelector('[data-ref="bytes"]'),
            muteBtn: el.querySelector('[data-action="mute"]'),
        };
        const card = { el, refs, controller: null };

        const video = refs.video;
        refs.muteBtn.innerHTML = MM.ui.svg('close'); // start muted; icon = "click to unmute" approximation
        video.addEventListener('volumechange', () => {
            refs.muteBtn.innerHTML = MM.ui.svg(video.muted ? 'close' : 'play');
        });
        refs.muteBtn.addEventListener('click', () => { video.muted = !video.muted; });
        el.querySelector('[data-action="volume"]').addEventListener('input', (e) => {
            video.volume = e.target.value / 100;
            video.muted = e.target.value === '0';
        });
        el.querySelector('[data-action="fullscreen"]').addEventListener('click', () => {
            const wrap = el.querySelector('.player-video-wrap');
            if (document.fullscreenElement) document.exitFullscreen();
            else wrap.requestFullscreen().catch(() => {});
        });
        el.querySelector('[data-action="snapshot"]').addEventListener('click', () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth || 640;
                canvas.height = video.videoHeight || 360;
                canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => {
                    if (!blob) { showToast('Snapshot failed', 'error'); return; }
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = rt.name.replace(/[^\w.-]+/g, '_') + '_' + Date.now() + '.png';
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                    showToast('Snapshot saved', 'success');
                }, 'image/png');
            } catch (err) {
                showToast('Snapshot failed: ' + err.message, 'error');
            }
        });
        el.querySelector('[data-action="info"]').addEventListener('click', () => {
            const rtNow = runtimeByName(rt.name);
            openModal({
                title: 'Stream: ' + rt.name,
                body: '<pre class="json-view">' + esc(JSON.stringify(rtNow || rt, null, 2)) + '</pre>',
                buttons: [{ label: 'Close' }],
            });
        });
        el.querySelector('[data-action="record"]').addEventListener('click', async () => {
            const conf = configByName(rt.name);
            if (conf) {
                try {
                    await MM.api.request('PATCH', MM.api.endpoint('configPathPatch').replace('{name}', encodeURIComponent(rt.name)), { body: { record: !conf.record } });
                    await app().refreshCoreQuiet();
                    showToast('Recording ' + (conf.record ? 'stopped' : 'started') + ' for "' + rt.name + '"', 'success');
                } catch (err) { showToast(err.message, 'error', 6000); }
            } else {
                const yes = await confirmDialog('Create configured path?', '"' + rt.name + '" is not in the configuration. Add it with recording enabled?', 'Add & record');
                if (!yes) return;
                try {
                    await MM.api.request('POST', MM.api.endpoint('configPathAdd').replace('{name}', encodeURIComponent(rt.name)), { body: { record: true } });
                    await app().refreshCoreQuiet();
                    showToast('Path "' + rt.name + '" added with recording', 'success');
                } catch (err) { showToast(err.message, 'error', 6000); }
            }
        });
        return card;
    }

    function startCardPlayer(card, rt) {
        const g = state().global || {};
        card.controller = MM.players.startPlayer(card.refs.video, rt.name, {
            global: g,
            headers: MM.api.authHeaders(),
            onStatus: (status, detail) => {
                const { overlay, ovtext, dot, transport } = card.refs;
                if (status === 'connecting') {
                    overlay.classList.remove('hidden');
                    ovtext.textContent = detail || 'Connecting…';
                    dot.className = 'status-dot off';
                } else if (status === 'live') {
                    overlay.classList.add('hidden');
                    dot.className = 'status-dot on';
                    transport.textContent = detail && detail.includes('HLS') ? 'HLS' : 'WebRTC';
                    transport.className = 'chip green';
                } else if (status === 'offline') {
                    overlay.classList.remove('hidden');
                    ovtext.textContent = 'Offline' + (detail ? ' — ' + detail : '');
                    dot.className = 'status-dot off';
                    transport.textContent = '';
                } else if (status === 'error') {
                    overlay.classList.remove('hidden');
                    ovtext.textContent = detail || 'Error';
                    dot.className = 'status-dot off';
                }
            },
        });
    }

    function updatePlayerCard(card, rt) {
        const inB = rt.inboundBytes || 0;
        const outB = rt.outboundBytes || 0;
        if (inB + outB > 0) {
            card.refs.bytes.textContent = '↓ ' + fmtBytes(inB) + ' · ↑ ' + fmtBytes(outB);
        } else {
            card.refs.bytes.textContent = '';
        }
        if (card.controller && card.controller.status === 'live') {
            const dot = card.refs.dot;
            dot.className = 'status-dot on';
        }
    }

    // =====================================================================
    // Metrics (Prometheus endpoint)
    // =====================================================================
    let metricsCache = [];

    function parseProm(text) {
        const families = new Map();
        for (const rawLine of text.split('\n')) {
            const line = rawLine.trim();
            if (!line) continue;
            if (line.startsWith('#')) {
                const m = /^#\s*(HELP|TYPE)\s+(\S+)\s*(.*)$/.exec(line);
                if (m) {
                    const fam = families.get(m[2]) || { samples: [] };
                    if (m[1] === 'TYPE') fam.type = m[3];
                    else fam.help = m[3];
                    families.set(m[2], fam);
                }
                continue;
            }
            const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)(?:\s+\d+)?$/.exec(line);
            if (!m) continue;
            const fam = families.get(m[1]) || { samples: [] };
            const labels = {};
            if (m[2]) {
                const re = /(\w+)="((?:[^"\\]|\\.)*)"/g;
                let lm;
                while ((lm = re.exec(m[2]))) labels[lm[1]] = lm[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            }
            fam.samples.push({ labels, value: m[3] });
            families.set(m[1], fam);
        }
        return [...families.entries()].map(([name, fam]) => ({ name, ...fam }));
    }

    function metricsMatch(fam, filter) {
        if (!filter) return true;
        const eq = filter.indexOf('=');
        if (eq > 0) {
            const key = filter.slice(0, eq).trim().replace(/^"|"$/g, '');
            const value = filter.slice(eq + 1).trim().replace(/^"|"$/g, '');
            return fam.samples.some((s) => s.labels[key] === value);
        }
        // bare term: match the family name or any label value
        return fam.name.includes(filter) || fam.samples.some((s) =>
            Object.values(s.labels).some((v) => v.includes(filter)));
    }

    MM.sections.metrics = {
        async load() {
            const node = $('metricsContent');
            const g = state().global || {};
            if (!g.metrics) {
                node.innerHTML = emptyState('Metrics are disabled', 'Enable the Metrics service, then reload this page.');
                return;
            }
            const base = MM.api.metricsBase(g);
            if (!base) {
                node.innerHTML = emptyState('Cannot derive the metrics URL', 'Check "metricsAddress" in the server configuration.');
                return;
            }
            node.innerHTML = skeleton(4);
            let text;
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 10000);
                const res = await fetch(base + '/metrics', { headers: MM.api.authHeaders(), signal: controller.signal });
                clearTimeout(timer);
                if (res.status === 401) throw new Error('Authentication failed (401) for the metrics endpoint.');
                if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + base + '/metrics');
                text = await res.text();
            } catch (err) {
                node.innerHTML = emptyState('Could not load metrics', err.message +
                    ' — the metrics endpoint must allow this page\'s origin via metricsAllowOrigins.');
                return;
            }
            metricsCache = parseProm(text);
            renderMetrics();
        },
    };

    function renderMetrics() {
        const node = $('metricsContent');
        const filter = $('metricsFilter').value.trim();
        const fams = metricsCache.filter((f) => metricsMatch(f, filter));
        if (!fams.length) {
            node.innerHTML = emptyState('No matching metrics', 'Try a different filter.');
            return;
        }
        node.innerHTML =
            '<div class="metrics-summary">' +
            statCard(metricsCache.length, 'Metric families') +
            statCard(metricsCache.reduce((a, f) => a + f.samples.length, 0), 'Time series') +
            statCard(fams.length, 'Matching') +
            '</div>' +
            fams.map((fam) =>
                '<div class="metric-family card"><h3>' + esc(fam.name) +
                (fam.type ? ' <span class="chip">' + esc(fam.type) + '</span>' : '') + '</h3>' +
                (fam.help ? '<div class="muted" style="font-size:12px">' + esc(fam.help) + '</div>' : '') +
                '<table><thead><tr><th>Series</th><th>Value</th></tr></thead><tbody>' +
                fam.samples.map((s) => {
                    const labelStr = Object.entries(s.labels).map(([k, v]) => k + '="' + v + '"').join(', ');
                    return '<tr><td>' + esc(labelStr || '(no labels)') + '</td><td>' + esc(s.value) + '</td></tr>';
                }).join('') + '</tbody></table></div>').join('');
    }

    $('metricsFilter').addEventListener('input', () => {
        if (metricsCache.length) renderMetrics();
    });

    // =====================================================================
    // Settings / instances / import-export
    // =====================================================================
    function download(name, content, mime = 'application/json') {
        const blob = new Blob([content], { type: mime });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }

    MM.sections.renderSettingsInstances = function () {
        const node = $('settingsInstances');
        node.innerHTML = state().instances.map((inst) => {
            const active = inst.id === state().currentId;
            return '<div class="service-card" data-instance="' + esc(inst.id) + '" style="margin-bottom:8px">' +
                '<div class="svc-info"><div class="svc-name">' + esc(inst.name) +
                (active ? ' <span class="chip accent">active</span>' : '') + '</div>' +
                '<div class="svc-addr">' + esc(inst.url) + ' · ' + esc(inst.authType || 'basic') + '</div></div>' +
                '<div style="display:flex;gap:6px">' +
                (!active ? '<button class="btn small" data-action="use">Use</button>' : '') +
                '<button class="btn small" data-action="edit">Edit</button>' +
                '<button class="btn small danger" data-action="delete">Delete</button></div></div>';
        }).join('') || '<p class="muted">No instances yet.</p>';
    };

    MM.sections.settings = {
        async load() {
            MM.sections.renderSettingsInstances();
            $('settingsAbout').innerHTML =
                '<dl class="kv">' +
                kv('Interface', 'static, no build step, works from any host') +
                kv('Server version', MM.api.version || (MM.api.legacy ? 'legacy (< v1.15.2)' : 'not connected')) +
                kv('Credential storage', 'localStorage of this browser; passwords optional per session') +
                '</dl>' +
                '<p class="muted" style="margin-top:10px">To let this page talk to a MediaMTX server, the server\'s <code>apiAllowOrigins</code> must include this page\'s origin.</p>';
        },
    };

    bindActions($('settingsInstances'), (action, btn) => {
        const id = btn.closest('[data-instance]').dataset.instance;
        const inst = state().instances.find((i) => i.id === id);
        if (!inst) return;
        if (action === 'edit') instanceModal(inst);
        else if (action === 'delete') app().deleteInstance(id);
        else if (action === 'use') app().switchInstance(id);
    });

    $('btnExport').addEventListener('click', () => {
        if (!state().connected) { showToast('Connect to an instance first', 'warn'); return; }
        openModal({
            title: 'Export server configuration',
            body: '<div class="check-row"><input type="checkbox" id="exCreds"><label for="exCreds">Include user passwords ' +
                  '(<strong>plaintext</strong> — anyone with this file can access the server)</label></div>',
            buttons: [{
                label: MM.ui.svg('download') + ' Export', class: 'primary',
                onClick(el) {
                    const includeCreds = el.querySelector('#exCreds').checked;
                    const g = { ...(state().global || {}) };
                    delete g.paths;
                    delete g.pathDefaults;
                    if (!includeCreds && Array.isArray(g.authInternalUsers)) {
                        g.authInternalUsers = g.authInternalUsers.map((u) => ({ ...u, pass: '' }));
                    }
                    const out = {
                        exportedAt: new Date().toISOString(),
                        instance: app().currentInstance() ? { name: app().currentInstance().name, url: app().currentInstance().url } : null,
                        global: g,
                        pathDefaults: state().global ? state().global.pathDefaults : undefined,
                        paths: state().configPaths,
                    };
                    delete out.global.pathDefaults;
                    download('mediamtx-config-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(out, null, 2));
                    showToast('Config exported', 'success');
                },
            }, { label: 'Cancel' }],
        });
    });

    $('btnImport').addEventListener('click', () => {
        if (!state().connected) { showToast('Connect to an instance first', 'warn'); return; }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;
            let data;
            try { data = JSON.parse(await file.text()); } catch (err) { showToast('Invalid JSON file', 'error'); return; }
            const paths = data.paths || {};
            const pathCount = Array.isArray(paths) ? paths.length : Object.keys(paths).length;
            const yes = await confirmDialog('Import configuration',
                'Apply this configuration? This will overwrite the server\'s global settings' +
                (pathCount ? ' and replace ' + pathCount + ' path definitions' : '') + '.', 'Import');
            if (!yes) return;
            try {
                if (data.global && Object.keys(data.global).length) {
                    const g = { ...data.global };
                    delete g.paths;
                    delete g.pathDefaults;
                    await MM.api.request('PATCH', MM.api.endpoint('configGlobalPatch'), { body: g });
                }
                if (data.pathDefaults && Object.keys(data.pathDefaults).length) {
                    await MM.api.request('PATCH', MM.api.endpoint('pathDefaultsPatch'), { body: data.pathDefaults });
                }
                const entries = Array.isArray(paths) ? paths.map((p) => [p.name, p]) : Object.entries(paths);
                for (const [name, conf] of entries) {
                    const bodyObj = typeof conf === 'object' && conf !== null ? { ...conf } : {};
                    delete bodyObj.name;
                    const exists = configByName(name);
                    if (exists) {
                        await MM.api.request('POST', MM.api.endpoint('configPathReplace').replace('{name}', encodeURIComponent(name)), { body: bodyObj }).catch(async () => {
                            await MM.api.request('PATCH', MM.api.endpoint('configPathPatch').replace('{name}', encodeURIComponent(name)), { body: bodyObj });
                        });
                    } else {
                        await MM.api.request('POST', MM.api.endpoint('configPathAdd').replace('{name}', encodeURIComponent(name)), { body: bodyObj });
                    }
                }
                await app().refreshCoreQuiet();
                showToast('Configuration imported', 'success');
            } catch (err) {
                showToast('Import failed: ' + err.message, 'error', 8000);
            }
        });
        input.click();
    });

    $('btnExportInstances').addEventListener('click', () => {
        openModal({
            title: 'Export instances',
            body: '<div class="check-row"><input type="checkbox" id="ixCreds"><label for="ixCreds">Include credentials (plaintext passwords/tokens)</label></div>',
            buttons: [{
                label: 'Export', class: 'primary',
                onClick(el) {
                    const includeCreds = el.querySelector('#ixCreds').checked;
                    const list = state().instances.map((inst) => includeCreds ? inst : { ...inst, pass: '', token: '' });
                    download('mediamtx-instances.json', JSON.stringify({ exportedAt: new Date().toISOString(), instances: list }, null, 2));
                    showToast('Instances exported', 'success');
                },
            }, { label: 'Cancel' }],
        });
    });

    $('btnImportInstances').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;
            let data;
            try { data = JSON.parse(await file.text()); } catch (err) { showToast('Invalid JSON file', 'error'); return; }
            const list = Array.isArray(data) ? data : data.instances;
            if (!Array.isArray(list)) { showToast('No instances found in file', 'error'); return; }
            const yes = await confirmDialog('Import instances', 'Add/replace ' + list.length + ' instance(s) in this browser?', 'Import');
            if (!yes) return;
            for (const raw of list) {
                if (!raw || !raw.url) continue;
                const inst = {
                    id: raw.id || ('inst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9)),
                    name: raw.name || raw.url,
                    url: raw.url,
                    authType: raw.authType || ((raw.user || raw.pass) ? 'basic' : 'none'),
                    user: raw.user || '',
                    pass: raw.pass || '',
                    rememberPass: !!raw.pass,
                    token: raw.token || '',
                };
                const idx = state().instances.findIndex((i) => i.id === inst.id || i.url === inst.url);
                if (idx >= 0) state().instances[idx] = inst;
                else state().instances.push(inst);
            }
            app().saveInstances();
            app().populateInstanceSelector();
            MM.sections.renderSettingsInstances();
            showToast('Instances imported', 'success');
        });
        input.click();
    });

    // ---------- Instance add/edit modal ----------
    function testConnection(cfg) {
        const url = cfg.url.replace(/\/+$/, '') + '/v3/info';
        const headers = {};
        if (cfg.authType === 'token' && cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
        else if (cfg.authType === 'basic') headers.Authorization = basicHeader(cfg.user || '', cfg.pass || '');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        return fetch(url, { headers, signal: controller.signal })
            .then(async (res) => {
                clearTimeout(timer);
                if (res.status === 401) return { ok: false, error: 'Authentication failed (401) — check user/password or token.' };
                if (!res.ok) return { ok: false, error: 'HTTP ' + res.status + ' from the server.' };
                let data = null;
                try { data = await res.json(); } catch (e) { /* legacy */ }
                return { ok: true, version: data && data.version ? data.version : 'unknown (legacy)' };
            })
            .catch(() => {
                clearTimeout(timer);
                return { ok: false, error: 'Unreachable — check the URL, server status and CORS (apiAllowOrigins).' };
            });
    }

    function basicHeader(user, pass) {
        const bytes = new TextEncoder().encode(user + ':' + pass);
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        return 'Basic ' + btoa(bin);
    }

    function instanceModal(inst) {
        const isNew = !inst;
        const body = document.createElement('div');
        body.innerHTML =
            '<div class="form-row"><label>Name</label><input id="imName" type="text" value="' + esc(isNew ? '' : inst.name) + '" placeholder="My server"></div>' +
            '<div class="form-row"><label>API URL</label><input id="imUrl" type="url" value="' + esc(isNew ? '' : inst.url) + '" placeholder="http://192.168.1.10:9997">' +
            '<div class="form-hint">The MediaMTX API address (<code>apiAddress</code>, default port 9997), without <code>/v3</code>.</div></div>' +
            '<div class="form-row"><label>Authentication</label><select id="imAuthType">' +
            '<option value="none"' + (inst && inst.authType === 'none' ? ' selected' : '') + '>None</option>' +
            '<option value="basic"' + ((!inst || !inst.authType || inst.authType === 'basic') ? ' selected' : '') + '>User &amp; password</option>' +
            '<option value="token"' + (inst && inst.authType === 'token' ? ' selected' : '') + '>Bearer / JWT token</option>' +
            '</select></div>' +
            '<div id="imBasic">' +
            '<div class="form-grid"><div class="form-row"><label>User</label><input id="imUser" type="text" value="' + esc(isNew ? '' : inst.user || '') + '" autocomplete="username"></div>' +
            '<div class="form-row"><label>Password ' + (!isNew && !inst.rememberPass ? '(session password may be active)' : '') + '</label>' +
            '<input id="imPass" type="password" autocomplete="new-password" placeholder="' + (!isNew && inst.rememberPass ? 'saved — type to change' : '') + '"></div></div>' +
            '<div class="check-row"><input type="checkbox" id="imRemember"' + (isNew || !inst || inst.rememberPass ? ' checked' : '') + '>' +
            '<label for="imRemember">Remember password on this device (otherwise it is asked once per browser session)</label></div>' +
            '</div>' +
            '<div id="imToken" class="form-row hidden"><label>Token</label><input id="imTokenValue" type="password" value="' + esc(isNew ? '' : inst.token || '') + '" autocomplete="off"></div>' +
            '<div id="imTestResult"></div>';

        const authTypeSel = body.querySelector('#imAuthType');
        const syncAuth = () => {
            body.querySelector('#imBasic').classList.toggle('hidden', authTypeSel.value !== 'basic');
            body.querySelector('#imToken').classList.toggle('hidden', authTypeSel.value !== 'token');
        };
        authTypeSel.addEventListener('change', syncAuth);
        syncAuth();

        openModal({
            title: isNew ? 'Add instance' : 'Edit instance "' + inst.name + '"',
            body,
            buttons: [
                {
                    label: 'Test connection',
                    async onClick(el) {
                        const cfg = readInstanceForm(el, inst, isNew, false);
                        const result = el.querySelector('#imTestResult');
                        result.innerHTML = '<div class="notice">Testing…</div>';
                        const res = await testConnection(cfg);
                        result.innerHTML = res.ok
                            ? '<div class="notice" style="color:var(--green)">✓ Connected — server version ' + esc(res.version) + '</div>'
                            : '<div class="notice" style="color:var(--red)">' + esc(res.error) + '</div>';
                        return false; // keep modal open
                    },
                },
                { label: isNew ? 'Add' : 'Save', class: 'primary', onClick: (el) => saveInstanceForm(el, inst, isNew) },
            ],
        });
    }

    function readInstanceForm(el, inst, isNew, forSave) {
        return {
            id: isNew ? null : inst.id,
            name: el.querySelector('#imName').value.trim(),
            url: el.querySelector('#imUrl').value.trim().replace(/\/+$/, ''),
            authType: el.querySelector('#imAuthType').value,
            user: el.querySelector('#imUser') ? el.querySelector('#imUser').value.trim() : '',
            pass: el.querySelector('#imPass') ? el.querySelector('#imPass').value : '',
            rememberPass: el.querySelector('#imRemember') ? el.querySelector('#imRemember').checked : false,
            token: el.querySelector('#imTokenValue') ? el.querySelector('#imTokenValue').value.trim() : '',
        };
    }

    async function saveInstanceForm(el, inst, isNew) {
        const form = readInstanceForm(el, inst, isNew, true);
        if (!form.name) throw new Error('A name is required.');
        let parsed;
        try { parsed = new URL(form.url); } catch (e) { throw new Error('The API URL is not a valid absolute URL.'); }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('The URL must start with http:// or https://');
        if (form.authType === 'basic' && !form.user && !form.pass && !isNew) {
            // keep old user if fields left untouched
            form.user = inst.user || '';
        }

        const record = {
            id: isNew ? ('inst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9)) : inst.id,
            name: form.name,
            url: form.url,
            authType: form.authType,
            user: form.user,
            pass: form.authType === 'basic' && form.rememberPass ? form.pass : '',
            rememberPass: form.authType === 'basic' && form.rememberPass && !!form.pass,
            token: form.authType === 'token' ? form.token : '',
        };
        if (form.authType === 'basic') {
            if (form.rememberPass && form.pass) {
                app().setSessionPassword(record.id, '');
            } else if (form.pass) {
                app().setSessionPassword(record.id, form.pass);
            }
        }

        const idx = state().instances.findIndex((i) => i.id === record.id);
        const isCurrent = !isNew && inst.id === state().currentId;
        if (idx >= 0) state().instances[idx] = record;
        else state().instances.push(record);
        app().saveInstances();
        app().populateInstanceSelector();
        MM.sections.renderSettingsInstances();
        showToast(isNew ? 'Instance added' : 'Instance saved', 'success');
        if (isNew || isCurrent) {
            await app().switchInstance(record.id);
        }
    }

    MM.sections.instanceModal = instanceModal;
})();
