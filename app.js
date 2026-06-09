/**
 * QQ Sticker Viewer - App Logic
 * - Images are preloaded into an in-memory Blob cache.
 * - Single-image downloads save the cached image directly.
 * - Multi-image downloads are zipped in the browser.
 */

(function () {
    'use strict';

    // ===== DOM Elements =====
    const stickerInput   = document.getElementById('sticker-input');
    const clearBtn       = document.getElementById('clear-btn');
    const fetchBtn       = document.getElementById('fetch-btn');
    const loadingEl      = document.getElementById('loading');
    const errorToast     = document.getElementById('error-toast');
    const errorMsg       = document.getElementById('error-msg');
    const resultSection  = document.getElementById('result-section');
    const stickerCover   = document.getElementById('sticker-cover');
    const stickerName    = document.getElementById('sticker-name');
    const stickerCount   = document.getElementById('sticker-count');
    const stickerUpdate  = document.getElementById('sticker-update');
    const selectAllCb    = document.getElementById('select-all-cb');
    const selectedCountEl= document.getElementById('selected-count');
    const viewGridBtn    = document.getElementById('view-grid');
    const viewListBtn    = document.getElementById('view-list');
    const downloadGifBtn = document.getElementById('download-gif-btn');
    const downloadPngBtn = document.getElementById('download-png-btn');
    const themeToggle    = document.getElementById('theme-toggle');
    const downloadProgress = document.getElementById('download-progress');
    const progressFill   = document.getElementById('progress-fill');
    const progressText   = document.getElementById('progress-text');
    const stickerGrid    = document.getElementById('sticker-grid');
    const shareSection   = document.getElementById('share-section');
    const shareLinkInput = document.getElementById('share-link');
    const copyShareBtn   = document.getElementById('copy-share-btn');

    // ===== State =====
    let currentStickers = [];
    // ^ { name, id, gifUrl, pngUrl, gifDirect, pngDirect, isAnimated }

    let currentPackName = '';

    // Blob cache: key = index, value = { gifBlob, pngBlob, actualExt }
    const blobCache = new Map();
    const preloadTasks = new Map();

    let selectedSet = new Set();
    let packVersion = 0;

    // ===== Init =====
    init();

    function init() {
        initTheme();

        const params = new URLSearchParams(window.location.search);
        const idFromUrl = params.get('id');
        if (idFromUrl) {
            stickerInput.value = idFromUrl;
            clearBtn.style.display = 'flex';
            fetchStickers(idFromUrl);
        }

        fetchBtn.addEventListener('click', onFetch);
        stickerInput.addEventListener('keydown', e => { if (e.key === 'Enter') onFetch(); });
        stickerInput.addEventListener('input', () => {
            clearBtn.style.display = stickerInput.value ? 'flex' : 'none';
        });
        clearBtn.addEventListener('click', () => {
            stickerInput.value = '';
            clearBtn.style.display = 'none';
            stickerInput.focus();
        });

        document.querySelectorAll('.tip-item').forEach(btn => {
            btn.addEventListener('click', () => {
                stickerInput.value = btn.dataset.id;
                clearBtn.style.display = 'flex';
                onFetch();
            });
        });

        selectAllCb.addEventListener('change', onSelectAll);
        viewGridBtn.addEventListener('click', () => setView('grid'));
        viewListBtn.addEventListener('click', () => setView('list'));
        downloadGifBtn.addEventListener('click', () => downloadSelected('gif'));
        downloadPngBtn.addEventListener('click', () => downloadSelected('png'));
        copyShareBtn.addEventListener('click', onCopyShare);
        themeToggle.addEventListener('click', toggleTheme);
    }

    function initTheme() {
        let stored = null;
        try { stored = localStorage.getItem('theme'); } catch (_) {}
        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        setTheme(stored || (prefersDark ? 'dark' : 'light'));
    }

    function toggleTheme() {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        try { localStorage.setItem('theme', next); } catch (_) {}
    }

    function setTheme(theme) {
        document.documentElement.dataset.theme = theme;
    }

    // ===== Parse Input =====
    function parseStickerId(input) {
        input = input.trim();
        if (!input) return null;
        try {
            const u = new URL(input);
            const id = u.searchParams.get('id');
            if (id) return id;
        } catch (_) {}
        if (/^\d+$/.test(input)) return input;
        const m = input.match(/id[=:](\d+)/i);
        return m ? m[1] : null;
    }

    // ===== Fetch Stickers =====
    function onFetch() {
        const id = parseStickerId(stickerInput.value);
        if (!id) { showError('请输入有效的表情包ID或链接'); return; }
        fetchStickers(id);
    }

    async function fetchStickers(id) {
        showLoading(true);
        hideError();
        resultSection.style.display = 'none';
        blobCache.clear();
        preloadTasks.clear();
        packVersion++;

        try {
            const resp = await fetch(`/api/sticker?id=${encodeURIComponent(id)}`);
            const data = await resp.json();
            if (!resp.ok || data.error) throw new Error(data.error || '获取失败');
            if (!data.imgs?.length) throw new Error('表情包数据为空');

            currentPackName = data.name || `sticker_${id}`;
            currentStickers = data.imgs.map(img => ({
                name:      img.name || img.id,
                id:        img.id,
                gifUrl:    img.gifUrl,      // via /api/proxy
                pngUrl:    img.pngUrl,      // via /api/proxy
                gifDirect: img.gifDirect,
                pngDirect: img.pngDirect,
                isAnimated: null,
            }));

            stickerCover.src = `/api/proxy?url=${encodeURIComponent(data.coverUrl)}`;
            stickerName.textContent = currentPackName;
            stickerCount.textContent = `${data.count} 个表情`;
            stickerUpdate.textContent = data.updateTime ? `更新: ${data.updateTime}` : '';

            shareLinkInput.value = `${location.origin}${location.pathname}?id=${id}`;
            shareSection.style.display = '';
            history.replaceState(null, '', `${location.pathname}?id=${id}`);

            selectedSet.clear();
            selectAllCb.checked = false;
            updateSelectedCount();

            renderGrid();
            resultSection.style.display = '';

            preloadAll(packVersion);

        } catch (err) {
            showError(err.message || '获取失败，请检查ID是否正确');
        } finally {
            showLoading(false);
        }
    }

    async function preloadAll(version) {
        const CONCURRENCY = 4;

        for (let i = 0; i < currentStickers.length; i += CONCURRENCY) {
            const batch = currentStickers
                .slice(i, i + CONCURRENCY)
                .map((_, j) => preloadSticker(i + j, version));
            await Promise.allSettled(batch);
        }
    }

    async function preloadSticker(index, version = packVersion) {
        if (preloadTasks.has(index)) return preloadTasks.get(index);

        const task = (async () => {
            const sticker = currentStickers[index];
            let entry = { gifBlob: null, pngBlob: null, actualExt: 'png' };

            try {
                const gifResp = await fetch(sticker.gifUrl);
                if (gifResp.ok) {
                    const gifBlob = await gifResp.blob();
                    if (await isGifBlob(gifBlob)) {
                        sticker.isAnimated = true;
                        entry = { gifBlob, pngBlob: null, actualExt: 'gif' };
                    } else {
                        sticker.isAnimated = false;
                        entry = { gifBlob: null, pngBlob: gifBlob, actualExt: 'png' };
                    }
                } else {
                    const pngResp = await fetch(sticker.pngUrl);
                    sticker.isAnimated = false;
                    entry.pngBlob = pngResp.ok ? await pngResp.blob() : null;
                }
            } catch {
                sticker.isAnimated = false;
            }

            if (version === packVersion) blobCache.set(index, entry);
            return entry;
        })();

        preloadTasks.set(index, task);
        return task;
    }

    async function isGifBlob(blob) {
        if (!blob || blob.size <= 500) return false;
        if (blob.type?.toLowerCase().includes('gif')) return true;
        try {
            const header = await blob.slice(0, 6).text();
            return header === 'GIF87a' || header === 'GIF89a';
        } catch {
            return false;
        }
    }

    async function ensurePngBlob(index, version = packVersion) {
        let cached = blobCache.get(index);
        if (!cached) cached = await preloadSticker(index, version);
        if (cached.pngBlob) return cached.pngBlob;
        try {
            const resp = await fetch(currentStickers[index].pngUrl);
            if (resp.ok) {
                cached.pngBlob = await resp.blob();
                if (version === packVersion) blobCache.set(index, cached);
            }
        } catch (_) {}
        return cached.pngBlob || null;
    }

    async function getStickerBlob(index, type) {
        const version = packVersion;
        let cached = blobCache.get(index);
        if (!cached) cached = await preloadSticker(index, version);
        if (version !== packVersion) return null;

        if (type === 'gif') {
            if (cached.gifBlob) return { blob: cached.gifBlob, ext: 'gif' };
            if (cached.pngBlob) return { blob: cached.pngBlob, ext: 'png' };
            return null;
        }

        const pngBlob = cached.pngBlob || await ensurePngBlob(index, version);
        return pngBlob ? { blob: pngBlob, ext: 'png' } : null;
    }

    // ===== Render Grid =====
    function renderGrid() {
        stickerGrid.innerHTML = '';
        currentStickers.forEach((sticker, index) => {
            const item = document.createElement('div');
            item.className   = 'sticker-item' + (selectedSet.has(index) ? ' selected' : '');
            item.dataset.index = index;

            item.innerHTML = `
                <div class="checkbox-wrapper">
                    <input type="checkbox" ${selectedSet.has(index) ? 'checked' : ''}>
                </div>
                <div class="sticker-img-wrapper">
                    <img class="sticker-img"
                         src="${sticker.gifUrl}"
                         onerror="this.onerror=null;this.src='${sticker.pngUrl}'"
                         alt="${sticker.name}"
                         loading="lazy">
                </div>
                <div class="sticker-item-name" title="${sticker.name}">${sticker.name}</div>
            `;

            item.addEventListener('click', e => {
                if (e.target.type === 'checkbox') return;
                toggleSelect(index);
            });
            item.querySelector('input[type="checkbox"]').addEventListener('change', e => {
                e.stopPropagation();
                toggleSelect(index);
            });

            stickerGrid.appendChild(item);
        });
    }

    // ===== Selection =====
    function toggleSelect(index) {
        selectedSet.has(index) ? selectedSet.delete(index) : selectedSet.add(index);
        updateItemUI(index);
        updateSelectedCount();
        selectAllCb.checked = selectedSet.size === currentStickers.length;
    }

    function onSelectAll() {
        if (selectAllCb.checked) {
            currentStickers.forEach((_, i) => selectedSet.add(i));
        } else {
            selectedSet.clear();
        }
        currentStickers.forEach((_, i) => updateItemUI(i));
        updateSelectedCount();
    }

    function updateItemUI(index) {
        const item = stickerGrid.querySelector(`[data-index="${index}"]`);
        if (!item) return;
        item.classList.toggle('selected', selectedSet.has(index));
        item.querySelector('input[type="checkbox"]').checked = selectedSet.has(index);
    }

    function updateSelectedCount() {
        selectedCountEl.textContent = `已选 ${selectedSet.size} 张`;
        downloadGifBtn.disabled = selectedSet.size === 0;
        downloadPngBtn.disabled = selectedSet.size === 0;
    }

    // ===== View Toggle =====
    function setView(mode) {
        if (mode === 'list') {
            stickerGrid.classList.add('list-view');
            viewListBtn.classList.add('active');
            viewGridBtn.classList.remove('active');
        } else {
            stickerGrid.classList.remove('list-view');
            viewGridBtn.classList.add('active');
            viewListBtn.classList.remove('active');
        }
    }

    // ===== Download（纯前端，直接取内存 Blob）=====
    async function downloadSelected(type) {
        if (selectedSet.size === 0) return;

        // 按原始顺序排列（保证编号连续）
        const indices = Array.from(selectedSet).sort((a, b) => a - b);
        const total   = indices.length;
        const padLen  = String(total).length;
        let completed = 0;

        downloadProgress.style.display = 'flex';
        progressFill.style.width       = '0%';
        progressText.textContent       = '0%';
        downloadGifBtn.disabled        = true;
        downloadPngBtn.disabled        = true;

        try {
            if (total === 1) {
                const idx = indices[0];
                const sticker = currentStickers[idx];
                const file = await getStickerBlob(idx, type);
                if (!file?.blob) throw new Error('No downloadable image found');

                progressFill.style.width = '100%';
                progressText.textContent = '100%';
                saveAs(file.blob, `${safeFileName(sticker.name)}.${file.ext}`);
                return;
            }

            const packFileName = safeFileName(currentPackName);
            const zip    = new JSZip();
            const folder = zip.folder(packFileName);

            for (let rank = 0; rank < indices.length; rank++) {
                const idx     = indices[rank];
                const sticker = currentStickers[idx];
                const seq = String(rank + 1).padStart(padLen, '0');
                const file = await getStickerBlob(idx, type);

                if (file?.blob) {
                    folder.file(`${seq}.${safeFileName(sticker.name)}.${file.ext}`, file.blob, { binary: true });
                }

                completed++;
                const pct = Math.round((completed / total) * 100);
                progressFill.style.width = `${pct}%`;
                progressText.textContent = `${pct}%`;
            }

            const zipBlob = await zip.generateAsync({
                type:        'blob',
                compression: 'STORE',
            }, ({ percent }) => {
                progressFill.style.width = `${Math.round(percent)}%`;
                progressText.textContent = `打包 ${Math.round(percent)}%`;
            });

            saveAs(zipBlob, `${packFileName}_${type}.zip`);

        } catch (err) {
            showError('下载失败: ' + (err.message || '未知错误'));
        } finally {
            downloadGifBtn.disabled = selectedSet.size === 0;
            downloadPngBtn.disabled = selectedSet.size === 0;
            setTimeout(() => { downloadProgress.style.display = 'none'; }, 1500);
        }
    }

    function safeFileName(name) {
        return String(name || 'sticker').replace(/[\\/:*?"<>|]/g, '_').trim() || 'sticker';
    }

    // ===== Share =====
    function onCopyShare() {
        shareLinkInput.select();
        navigator.clipboard.writeText(shareLinkInput.value).then(() => {
            copyShareBtn.textContent = '已复制!';
            setTimeout(() => { copyShareBtn.textContent = '复制'; }, 2000);
        }).catch(() => {
            document.execCommand('copy');
            copyShareBtn.textContent = '已复制!';
            setTimeout(() => { copyShareBtn.textContent = '复制'; }, 2000);
        });
    }

    // ===== UI Helpers =====
    function showLoading(show) {
        loadingEl.style.display = show ? '' : 'none';
        fetchBtn.classList.toggle('loading', show);
    }

    function showError(msg) {
        errorMsg.textContent    = msg;
        errorToast.style.display = 'flex';
        errorToast.style.animation = 'none';
        void errorToast.offsetWidth;
        errorToast.style.animation = '';
        clearTimeout(showError._timer);
        showError._timer = setTimeout(hideError, 4000);
    }

    function hideError() { errorToast.style.display = 'none'; }

})();
