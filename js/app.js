// MM.app — boot, routing, instance management, polling scheduler.
'use strict';
window.MM = window.MM || {};

(function () {
    const { esc, showToast, openModal, closeModal, skeleton, emptyState } = MM.ui;

    const LS_INSTANCES = 'mediamtx_instances_v2';
    const LS_CURRENT = 'mediamtx_current_instance_v2';
    const LS_LEGACY = 'mediamtx_instances';
    const SS_PASS_PREFIX = 'mm_session_pass_';

    const SECTIONS = ['dashboard', 'players', 'paths', 'connections', 'recordings', 'users', 'services', 'metrics', 'settings'];

    const app = {
        state: {
            instances: [],
            currentId: null,
            connected: false,
            connecting: false,
            pollingPaused: false,
            global: null,
            configPaths: [],
            runtimePaths: [],
            lastUpdated: null,
            activeSection: 'dashboard',
        },

        // ---------- Instances ----------
        loadInstances() {
            let raw = localStorage.getItem(LS_INSTANCES);
            if (!raw) raw = localStorage.getItem(LS_LEGACY); // migrate pre-rewrite storage
            if (!raw) return [];
            try {
                const list = JSON.parse(raw);
                if (!Array.isArray(list)) return [];
                return list.map((inst) => ({
                    id: inst.id || ('inst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9)),
                    name: inst.name || inst.url,
                    url: inst.url || '',
                    authType: inst.authType || ((inst.user || inst.pass) ? 'basic' : 'none'),
                    user: inst.user || '',
                    // Passwords persisted by the old version are kept but will not be
                    // re-persisted unless "remember password" is checked on edit.
                    pass: inst.pass || '',
                    rememberPass: inst.rememberPass !== undefined ? !!inst.rememberPass : !!inst.pass,
                    token: inst.token || '',
                }));
            } catch (err) {
                console.error('Corrupt instance storage:', err);
                return [];
            }
        },

        saveInstances() {
            localStorage.setItem(LS_INSTANCES, JSON.stringify(this.state.instances));
        },

        currentInstance() {
            return this.state.instances.find((i) => i.id === this.state.currentId) || null;
        },

        _persistedPassword(inst) {
            return inst && inst.rememberPass ? (inst.pass || '') : '';
        },

        _sessionPassword(inst) {
            return inst ? (sessionStorage.getItem(SS_PASS_PREFIX + inst.id) || '') : '';
        },

        // Password used for auth: session value wins over persisted one.
        _applyAuthToApi(inst) {
            MM.api.setInstance(inst);
            MM.api.sessionPassword = inst && inst.authType === 'basic'
                ? (this._sessionPassword(inst) || this._persistedPassword(inst))
                : '';
        },

        // Session-only password storage (cleared when the tab closes).
        setSessionPassword(instanceId, pass) {
            if (pass) sessionStorage.setItem(SS_PASS_PREFIX + instanceId, pass);
            else sessionStorage.removeItem(SS_PASS_PREFIX + instanceId);
        },

        // ---------- Connect ----------
        async connectCurrent() {
            const inst = this.currentInstance();
            this.state.connected = false;
            this.setConnBadge('connecting');
            if (!inst || !inst.url) {
                this.setConnBadge('offline');
                this.showGlobalError('No instance selected. Add a MediaMTX instance to get started.');
                this.renderVersionBadge();
                return;
            }
            this.state.connecting = true;
            this._applyAuthToApi(inst);
            const res = await MM.api.connect();
            this.state.connecting = false;

            if (res.auth) {
                const retried = await this.promptCredentials(inst, res.error);
                if (retried) { await this.connectCurrent(); return; }
            }
            if (!res.ok) {
                this.setConnBadge('offline');
                this.showGlobalError('Cannot connect to "' + inst.name + '": ' + res.error);
                this.renderVersionBadge();
                return;
            }

            this.state.connected = true;
            this.hideGlobalError();
            this.setConnBadge('online');
            this.renderVersionBadge();
            await this.refreshCore();
            this.loadSection(this.state.activeSection, true);
        },

        async refreshCore() {
            const [global, configPaths, runtimePaths] = await Promise.all([
                MM.api.request('GET', MM.api.endpoint('configGlobalGet')),
                MM.api.listAll('configPathsList').catch(() => []),
                MM.api.listAll('pathsList').catch(() => []),
            ]);
            this.state.global = global;
            this.state.configPaths = configPaths;
            this.state.runtimePaths = runtimePaths;
            this.state.lastUpdated = Date.now();
            this.renderStaleness();
        },

        async refreshCoreQuiet() {
            if (!this.state.connected) return;
            try {
                await this.refreshCore();
            } catch (err) {
                this.handleApiError(err);
            }
        },

        // ---------- Credentials prompt ----------
        promptCredentials(inst, reason) {
            return new Promise((resolve) => {
                const body = document.createElement('div');
                body.innerHTML =
                    '<p class="muted">' + esc(reason || 'Authentication failed.') + '</p>' +
                    '<div class="form-row"><label>User</label><input id="authUser" type="text" value="' + esc(inst.user || '') + '" autocomplete="username"></div>' +
                    '<div class="form-row"><label>Password</label><input id="authPass" type="password" autocomplete="current-password"></div>' +
                    '<div class="check-row"><input id="authRemember" type="checkbox" checked><label for="authRemember">Remember on this device</label></div>';
                openModal({
                    title: 'Credentials for ' + inst.name,
                    body,
                    buttons: [{
                        label: 'Connect', class: 'primary',
                        onClick: (el) => {
                            const user = el.querySelector('#authUser').value.trim();
                            const pass = el.querySelector('#authPass').value;
                            const remember = el.querySelector('#authRemember').checked;
                            inst.user = user;
                            inst.pass = remember ? pass : '';
                            inst.rememberPass = remember;
                            inst.authType = 'basic';
                            this.saveInstances();
                            if (remember) sessionStorage.removeItem(SS_PASS_PREFIX + inst.id);
                            else sessionStorage.setItem(SS_PASS_PREFIX + inst.id, pass);
                            resolve(true);
                        },
                    }],
                    onClose: () => resolve(false),
                });
            });
        },

        // ---------- Header / badges ----------
        setConnBadge(state) {
            const badge = document.getElementById('connBadge');
            const text = document.getElementById('connBadgeText');
            badge.classList.remove('online', 'offline', 'connecting');
            badge.classList.add(state);
            text.textContent = state.charAt(0).toUpperCase() + state.slice(1);
        },

        renderVersionBadge() {
            const badge = document.getElementById('versionBadge');
            if (MM.api.version) {
                badge.textContent = 'v' + String(MM.api.version).replace(/^v/, '');
                badge.classList.remove('hidden');
                badge.title = this.state.global && this.state.global.api
                    ? 'API: ' + this.state.global.api.address : '';
            } else if (MM.api.legacy) {
                badge.textContent = 'legacy server';
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        },

        showGlobalError(message) {
            const box = document.getElementById('globalError');
            box.innerHTML = MM.ui.svg('warn') + '<span>' + esc(message) + '</span>';
            box.classList.remove('hidden');
        },

        hideGlobalError() {
            document.getElementById('globalError').classList.add('hidden');
        },

        handleApiError(err) {
            if (err && err.isAuth) {
                this.setConnBadge('offline');
                this.state.connected = false;
                const inst = this.currentInstance();
                if (inst) {
                    this.promptCredentials(inst, err.message).then((retried) => {
                        if (retried) this.connectCurrent();
                    });
                }
                return;
            }
            if (err && err.isNetwork) {
                this.state.connected = false;
                this.setConnBadge('offline');
                this.showGlobalError(err.message);
                return;
            }
            showToast(err && err.message ? err.message : String(err), 'error', 6000);
        },

        // ---------- Routing ----------
        navigateTo(section) {
            if (!SECTIONS.includes(section)) section = 'dashboard';
            if (section !== this.state.activeSection) {
                MM.players.stopAll();
            }
            this.state.activeSection = section;
            if (location.hash !== '#' + section) {
                history.replaceState(null, '', '#' + section);
            }
            document.querySelectorAll('.nav-item').forEach((item) => {
                item.classList.toggle('active', item.dataset.section === section);
            });
            document.querySelectorAll('.section').forEach((node) => {
                node.classList.toggle('hidden', node.id !== 'section-' + section);
            });
            this.closeMobileNav();
            this.loadSection(section, false);
        },

        loadSection(section, force) {
            const def = MM.sections[section];
            if (!def) return;
            if (!this.state.connected && section !== 'settings') return;
            Promise.resolve(def.load(force)).catch((err) => this.handleApiError(err));
        },

        // ---------- Polling ----------
        _pollers: [],

        startPolling() {
            // Core data (config + runtime paths + global) feeds dashboard & staleness.
            this._addPoller(15000, () => this.refreshCoreQuiet());
            this._addPoller(60000, () => {
                if (this.state.connected) this.renderVersionBadge();
                this.renderStaleness();
            });
            setInterval(() => this.renderStaleness(), 1000);
        },

        _addPoller(intervalMs, fn) {
            const poller = { intervalMs, fn, running: false };
            this._pollers.push(poller);
            setInterval(async () => {
                if (this.state.pollingPaused || document.hidden || poller.running || !this.state.connected) return;
                poller.running = true;
                try { await poller.fn(); } finally { poller.running = false; }
            }, intervalMs);
        },

        // Per-section polling: sections register {name: {load, interval}} and the
        // active section's loader runs on its interval (single-flight).
        startSectionPolling() {
            setInterval(async () => {
                if (this.state.pollingPaused || document.hidden || !this.state.connected) return;
                const def = MM.sections[this.state.activeSection];
                if (!def || !def.interval || def._running) return;
                const now = Date.now();
                if (def._lastRun && now - def._lastRun < def.interval) return;
                def._lastRun = now;
                def._running = true;
                try { await Promise.resolve(def.load(false)); } catch (err) { /* surfaced by load */ } finally { def._running = false; }
            }, 1000);
        },

        renderStaleness() {
            const node = document.getElementById('staleness');
            if (!this.state.lastUpdated) { node.textContent = ''; return; }
            const secs = Math.round((Date.now() - this.state.lastUpdated) / 1000);
            node.textContent = this.state.pollingPaused ? 'auto-refresh paused' :
                (secs < 5 ? 'up to date' : 'updated ' + (secs < 60 ? secs + 's' : Math.floor(secs / 60) + 'm') + ' ago');
        },

        // ---------- Mobile nav ----------
        closeMobileNav() {
            document.getElementById('sidebar').classList.remove('open');
            const backdrop = document.querySelector('.sidebar-backdrop');
            if (backdrop) backdrop.remove();
        },

        toggleMobileNav() {
            const sidebar = document.getElementById('sidebar');
            const opening = !sidebar.classList.contains('open');
            sidebar.classList.toggle('open', opening);
            if (opening) {
                const backdrop = document.createElement('div');
                backdrop.className = 'sidebar-backdrop';
                backdrop.addEventListener('click', () => this.closeMobileNav());
                document.body.appendChild(backdrop);
            } else {
                this.closeMobileNav();
            }
        },

        // ---------- Boot ----------
        init() {
            this.state.instances = this.loadInstances();
            this.state.currentId = localStorage.getItem(LS_CURRENT);
            if (!this.currentInstance() && this.state.instances.length) {
                this.state.currentId = this.state.instances[0].id;
            }

            const selector = document.getElementById('instanceSelector');
            selector.addEventListener('change', () => this.switchInstance(selector.value));

            document.querySelectorAll('.nav-item').forEach((item) => {
                item.addEventListener('click', (e) => { e.preventDefault(); this.navigateTo(item.dataset.section); });
            });
            window.addEventListener('hashchange', () => {
                const section = location.hash.replace('#', '') || 'dashboard';
                if (section !== this.state.activeSection) this.navigateTo(section);
            });

            document.getElementById('navToggle').addEventListener('click', () => this.toggleMobileNav());
            document.getElementById('btnPausePolling').addEventListener('click', (e) => {
                this.state.pollingPaused = !this.state.pollingPaused;
                e.currentTarget.classList.toggle('active', this.state.pollingPaused);
                this.renderStaleness();
                showToast(this.state.pollingPaused ? 'Auto-refresh paused' : 'Auto-refresh resumed');
            });
            document.getElementById('btnRefreshAll').addEventListener('click', async () => {
                if (!this.state.connected) { await this.connectCurrent(); return; }
                await this.refreshCoreQuiet();
                this.loadSection(this.state.activeSection, true);
                showToast('Refreshed', 'success');
            });
            document.getElementById('btnAddInstance').addEventListener('click', () => MM.sections.instanceModal(null));
            document.getElementById('btnAddInstance2').addEventListener('click', () => MM.sections.instanceModal(null));
            document.getElementById('btnEditInstance').addEventListener('click', () => {
                MM.sections.instanceModal(this.currentInstance());
            });

            this.populateInstanceSelector();
            this.startPolling();
            this.startSectionPolling();

            const initial = (location.hash || '#dashboard').replace('#', '');
            this.navigateTo(SECTIONS.includes(initial) ? initial : 'dashboard');
            this.connectCurrent();
        },

        populateInstanceSelector() {
            const selector = document.getElementById('instanceSelector');
            selector.innerHTML = this.state.instances.map((inst) =>
                '<option value="' + esc(inst.id) + '"' + (inst.id === this.state.currentId ? ' selected' : '') + '>' +
                esc(inst.name) + '</option>').join('');
        },

        async switchInstance(id) {
            if (!id) return;
            this.state.currentId = id;
            localStorage.setItem(LS_CURRENT, id);
            this.populateInstanceSelector();
            MM.players.stopAll();
            this.state.global = null;
            this.state.configPaths = [];
            this.state.runtimePaths = [];
            this.state.lastUpdated = null;
            this.renderStaleness();
            await this.connectCurrent();
        },

        deleteInstance(id) {
            const inst = this.state.instances.find((i) => i.id === id);
            if (!inst) return;
            MM.ui.confirmDialog('Delete instance', 'Remove "' + inst.name + '" from this browser? The server itself is not touched.').then((yes) => {
                if (!yes) return;
                this.state.instances = this.state.instances.filter((i) => i.id !== id);
                sessionStorage.removeItem(SS_PASS_PREFIX + id);
                this.saveInstances();
                this.populateInstanceSelector();
                if (id === this.state.currentId) {
                    const next = this.state.instances[0];
                    if (next) this.switchInstance(next.id);
                    else {
                        this.state.currentId = null;
                        localStorage.removeItem(LS_CURRENT);
                        this.state.connected = false;
                        this.setConnBadge('offline');
                        this.showGlobalError('No instance selected. Add a MediaMTX instance to get started.');
                    }
                }
                if (MM.sections.renderSettingsInstances) MM.sections.renderSettingsInstances();
                showToast('Instance deleted', 'success');
            });
        },
    };

    MM.app = app;
    document.addEventListener('DOMContentLoaded', () => app.init());
})();
