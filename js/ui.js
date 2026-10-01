// MM.ui — DOM helpers, escaping, toasts, modals, icons, formatting
'use strict';
window.MM = window.MM || {};

(function () {
    const ICONS = {
        dashboard: '<path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/>',
        play: '<path d="M8 5v14l11-7z"/>',
        key: '<path d="M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>',
        plug: '<path d="M16 7V3h-2v4h-4V3H8v4H6v6c0 2.97 2.16 5.44 5 5.92V22h2v-3.08c2.84-.48 5-2.95 5-5.92V7h-2z"/>',
        film: '<path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/>',
        users: '<path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>',
        toggle: '<path d="M17 6H7c-3.31 0-6 2.69-6 6s2.69 6 6 6h10c3.31 0 6-2.69 6-6s-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/>',
        chart: '<path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/>',
        gear: '<path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>',
        edit: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
        trash: '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
        plus: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>',
        refresh: '<path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>',
        pause: '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>',
        info: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>',
        snapshot: '<path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"/><path d="M9 2L7.17 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3.17L15 2H9zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/>',
        fullscreen: '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>',
        close: '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
        warn: '<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>',
        download: '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>',
        upload: '<path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>',
        kick: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31A7.902 7.902 0 0 1 12 20zm6.31-3.1L7.1 5.69A7.902 7.902 0 0 1 12 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z"/>',
    };

    function svg(name) {
        return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + (ICONS[name] || ICONS.info) + '</svg>';
    }

    // Inject static icons into placeholders (nav, topbar buttons)
    document.querySelectorAll('[data-icon]').forEach((node) => {
        node.innerHTML = svg(node.dataset.icon);
    });
    const btnIcons = {
        navToggle: 'dashboard', btnEditInstance: 'edit', btnAddInstance: 'plus',
        btnPausePolling: 'pause', btnRefreshAll: 'refresh',
    };
    for (const [id, icon] of Object.entries(btnIcons)) {
        const node = document.getElementById(id);
        if (node) node.innerHTML = svg(icon);
    }

    // Escape for text content and double-quoted attribute contexts.
    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[ch]));
    }

    function fmtBytes(n) {
        if (typeof n !== 'number' || !isFinite(n) || n < 0) return '–';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0, v = n;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
    }

    function fmtDuration(seconds) {
        if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) return '–';
        const s = Math.floor(seconds % 60);
        const m = Math.floor((seconds / 60) % 60);
        const h = Math.floor(seconds / 3600);
        if (h > 0) return h + 'h ' + m + 'm';
        if (m > 0) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
        return s + 's';
    }

    function fmtDate(value) {
        if (!value) return '–';
        const d = new Date(value);
        if (isNaN(d.getTime())) return String(value);
        return d.toLocaleString();
    }

    // ---------- Toasts ----------
    const toastContainer = document.getElementById('toastContainer');
    function showToast(message, type = 'info', timeout = 4000) {
        const toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.textContent = message;
        toastContainer.appendChild(toast);
        const timer = setTimeout(() => {
            toast.classList.add('leaving');
            setTimeout(() => toast.remove(), 260);
        }, timeout);
        toast.addEventListener('click', () => { clearTimeout(timer); toast.remove(); });
    }

    // ---------- Modals ----------
    const modalRoot = document.getElementById('modalRoot');
    let activeModal = null;
    let confirmResolve = null;

    function closeModal() {
        const closing = activeModal;
        if (activeModal) {
            activeModal.overlay.remove();
            document.removeEventListener('keydown', activeModal.onKey);
            activeModal = null;
        }
        if (confirmResolve) {
            confirmResolve(false);
            confirmResolve = null;
        }
        if (closing && closing.onClose) {
            const cb = closing.onClose;
            closing.onClose = null;
            cb();
        }
    }

    // openModal({title, body (Node | html string), wide, buttons: [{label, class, async onClick(bodyEl) -> false keeps modal open}]})
    // Returns the modal body element.
    function openModal(opts) {
        closeModal();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const modal = document.createElement('div');
        modal.className = 'modal' + (opts.wide ? ' modal-wide' : '');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');

        const head = document.createElement('div');
        head.className = 'modal-head';
        const title = document.createElement('h3');
        title.textContent = opts.title || '';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'icon-btn';
        closeBtn.innerHTML = svg('close');
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.addEventListener('click', closeModal);
        head.append(title, closeBtn);

        const body = document.createElement('div');
        body.className = 'modal-body';
        if (typeof opts.body === 'string') body.innerHTML = opts.body;
        else if (opts.body) body.appendChild(opts.body);

        modal.append(head, body);

        if (opts.buttons && opts.buttons.length) {
            const foot = document.createElement('div');
            foot.className = 'modal-foot';
            for (const def of opts.buttons) {
                const btn = document.createElement('button');
                btn.className = 'btn' + (def.class ? ' ' + def.class : '');
                btn.textContent = def.label;
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    let keepOpen = false;
                    try {
                        keepOpen = def.onClick ? (await def.onClick(body)) === false : false;
                    } catch (err) {
                        showFormError(body, err);
                        keepOpen = true;
                    }
                    if (keepOpen) btn.disabled = false;
                    else closeModal();
                });
                foot.appendChild(btn);
            }
            modal.appendChild(foot);
        }

        overlay.appendChild(modal);
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
        const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
        document.addEventListener('keydown', onKey);
        modalRoot.appendChild(overlay);
        activeModal = { overlay, onKey, onClose: opts.onClose || null };
        const firstInput = body.querySelector('input, select, textarea');
        if (firstInput) firstInput.focus();
        if (opts.onOpen) opts.onOpen(body);
        return body;
    }

    function showFormError(bodyEl, err) {
        const existing = bodyEl.querySelector('.form-error');
        if (existing) existing.remove();
        const box = document.createElement('div');
        box.className = 'form-error';
        box.textContent = err && err.message ? err.message : String(err);
        bodyEl.prepend(box);
        MM.ui.showToast(err && err.message ? err.message : String(err), 'error', 6000);
    }

    // Resolves true only when the confirm button is clicked; Esc/backdrop/X resolve false.
    function confirmDialog(title, message, confirmLabel = 'Delete') {
        return new Promise((resolve) => {
            // openModal must run first: it starts by closing any previous modal,
            // which would otherwise fire a resolver set too early.
            openModal({
                title,
                body: '<p style="margin:0">' + esc(message) + '</p>',
                buttons: [
                    { label: 'Cancel', onClick: () => resolve(false) },
                    { label: confirmLabel, class: 'danger', onClick: () => resolve(true) },
                ],
            });
            confirmResolve = resolve;
        });
    }

    // ---------- Loading / empty states ----------
    function skeleton(lines = 3) {
        let html = '<div class="skeleton-card">';
        const widths = ['', 'w60', 'w40'];
        for (let i = 0; i < lines; i++) {
            html += '<div class="skeleton-line ' + widths[i % 3] + '"></div>';
        }
        return html + '</div>';
    }

    function emptyState(title, subtitle) {
        return '<div class="empty-state"><div class="big">' + esc(title) + '</div><div>' + esc(subtitle || '') + '</div></div>';
    }

    MM.ui = {
        svg, esc, fmtBytes, fmtDuration, fmtDate,
        showToast, openModal, closeModal, confirmDialog, showFormError,
        skeleton, emptyState,
    };
})();
