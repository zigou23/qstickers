/**
 * QQ Sticker Viewer - App Logic
 * Calls /api/sticker and /api/proxy (CF Pages Functions) 
 * to fetch data and images, detects GIF/PNG, batch downloads as ZIP.
 */

(function () {
    'use strict';

    // ===== DOM Elements =====
    const stickerInput = document.getElementById('sticker-input');
    const clearBtn = document.getElementById('clear-btn');
    const fetchBtn = document.getElementById('fetch-btn');
    const loadingEl = document.getElementById('loading');
    const errorToast = document.getElementById('error-toast');
    const errorMsg = document.getElementById('error-msg');
    const resultSection = document.getElementById('result-section');
    const stickerCover = document.getElementById('sticker-cover');
    const stickerName = document.getElementById('sticker-name');
    const stickerCount = document.getElementById('sticker-count');
    const stickerUpdate = document.getElementById('sticker-update');
    const selectAllCb = document.getElementById('select-all-cb');
    const selectedCountEl = document.getElementById('selected-count');
    const viewGridBtn = document.getElementById('view-grid');
    const viewListBtn = document.getElementById('view-list');
    const downloadGifBtn = document.getElementById('download-gif-btn');
    const downloadPngBtn = document.getElementById('download-png-btn');
    const downloadProgress = document.getElementById('download-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const stickerGrid = document.getElementById('sticker-grid');
    const shareSection = document.getElementById('share-section');
    const shareLinkInput = document.getElementById('share-link');
    const copyShareBtn = document.getElementById('copy-share-btn');

    // ===== State =====
    let currentStickers = []; // { name, id, gifUrl, pngUrl, gifDirect, pngDirect, isAnimated }
    let currentPackName = '';
    let currentCoverUrl = '';
    let selectedSet = new Set();

    // ===== Init =====
    init();

    function init() {
        // Check URL params for auto-load
        const params = new URLSearchParams(window.location.search);
        const idFromUrl = params.get('id');
        if (idFromUrl) {
            stickerInput.value = idFromUrl;
            clearBtn.style.display = 'flex';
            fetchStickers(idFromUrl);
        }

        // Event listeners
        fetchBtn.addEventListener('click', onFetch);
        stickerInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') onFetch();
        });
        stickerInput.addEventListener('input', () => {
            clearBtn.style.display = stickerInput.value ? 'flex' : 'none';
        });
        clearBtn.addEventListener('click', () => {
            stickerInput.value = '';
            clearBtn.style.display = 'none';
            stickerInput.focus();
        });

        // Quick tips
        document.querySelectorAll('.tip-item').forEach(btn => {
            btn.addEventListener('click', () => {
                stickerInput.value = btn.dataset.id;
                clearBtn.style.display = 'flex';
                onFetch();
            });
        });

        // Toolbar
        selectAllCb.addEventListener('change', onSelectAll);
        viewGridBtn.addEventListener('click', () => setView('grid'));
        viewListBtn.addEventListener('click', () => setView('list'));
        downloadGifBtn.addEventListener('click', () => downloadSelected('gif'));
        downloadPngBtn.addEventListener('click', () => downloadSelected('png'));
        copyShareBtn.addEventListener('click', onCopyShare);
    }

    // ===== Parse Input =====
    function parseStickerId(input) {
        input = input.trim();
        if (!input) return null;

        // Try to extract id from QQ URL
        try {
            const urlObj = new URL(input);
            const id = urlObj.searchParams.get('id');
            if (id) return id;
        } catch (e) {
            // Not a URL
        }

        // Check if it looks like a sticker ID (numeric)
        if (/^\d+$/.test(input)) return input;

        // Try extracting id= from any string
        const match = input.match(/id[=:](\d+)/i);
        if (match) return match[1];

        return null;
    }

    // ===== Fetch Stickers =====
    function onFetch() {
        const id = parseStickerId(stickerInput.value);
        if (!id) {
            showError('请输入有效的表情包ID或链接');
            return;
        }
        fetchStickers(id);
    }

    async function fetchStickers(id) {
        showLoading(true);
        hideError();
        resultSection.style.display = 'none';

        try {
            // Call our CF Pages Function API
            const resp = await fetch(`/api/sticker?id=${encodeURIComponent(id)}`);
            const data = await resp.json();

            if (!resp.ok || data.error) {
                throw new Error(data.error || '获取失败');
            }

            if (!data.imgs || data.imgs.length === 0) {
                throw new Error('表情包数据为空');
            }

            // Store data
            currentPackName = data.name || `sticker_${id}`;
            currentCoverUrl = data.coverUrl;
            currentStickers = data.imgs.map(img => ({
                name: img.name || img.id,
                id: img.id,
                gifUrl: img.gifUrl,       // proxied URL via /api/proxy
                pngUrl: img.pngUrl,       // proxied URL via /api/proxy
                gifDirect: img.gifDirect, // direct CDN URL
                pngDirect: img.pngDirect, // direct CDN URL
                isAnimated: null,         // will detect
            }));

            // Update header
            stickerCover.src = `/api/proxy?url=${encodeURIComponent(data.coverUrl)}`;
            stickerName.textContent = currentPackName;
            stickerCount.textContent = `${data.count} 个表情`;
            stickerUpdate.textContent = data.updateTime ? `更新: ${data.updateTime}` : '';

            // Update share link
            const shareUrl = `${window.location.origin}${window.location.pathname}?id=${id}`;
            shareLinkInput.value = shareUrl;
            shareSection.style.display = '';

            // Update URL without reload
            window.history.replaceState(null, '', `${window.location.pathname}?id=${id}`);

            // Reset selection
            selectedSet.clear();
            selectAllCb.checked = false;
            updateSelectedCount();

            // Render grid
            renderGrid();

            // Show results
            resultSection.style.display = '';

            // Detect animated vs static
            detectAllTypes();

        } catch (err) {
            showError(err.message || '获取失败，请检查ID是否正确');
        } finally {
            showLoading(false);
        }
    }

    // ===== Detect Image Type (GIF vs PNG) =====
    async function detectAllTypes() {
        const promises = currentStickers.map(async (sticker, index) => {
            try {
                // Use HEAD via our proxy to check GIF existence
                const headUrl = `/api/proxy?url=${encodeURIComponent(sticker.gifDirect)}`;
                const resp = await fetch(headUrl, { method: 'HEAD' });
                if (resp.ok) {
                    const contentType = resp.headers.get('content-type') || '';
                    const contentLength = parseInt(resp.headers.get('content-length') || '0');
                    sticker.isAnimated = contentType.includes('gif') || contentLength > 1000;
                } else {
                    sticker.isAnimated = false;
                }
            } catch {
                sticker.isAnimated = false;
            }
            updateItemBadge(index, sticker.isAnimated);
        });

        await Promise.allSettled(promises);
    }

    function updateItemBadge(index, isAnimated) {
        const badge = stickerGrid.querySelector(`[data-index="${index}"] .type-badge`);
        if (!badge) return;
        badge.style.opacity = '1';
        if (isAnimated) {
            badge.textContent = 'GIF';
            badge.className = 'type-badge gif';
        } else {
            badge.textContent = 'PNG';
            badge.className = 'type-badge png';
        }
    }

    // ===== Render Grid =====
    function renderGrid() {
        stickerGrid.innerHTML = '';
        currentStickers.forEach((sticker, index) => {
            const item = document.createElement('div');
            item.className = 'sticker-item' + (selectedSet.has(index) ? ' selected' : '');
            item.dataset.index = index;
            item.style.animationDelay = `${index * 30}ms`;

            // Show via proxy - try GIF first, fallback to PNG
            const gifSrc = sticker.gifUrl;
            const pngSrc = sticker.pngUrl;

            item.innerHTML = `
                <div class="checkbox-wrapper">
                    <input type="checkbox" ${selectedSet.has(index) ? 'checked' : ''}>
                </div>
                <div class="sticker-img-wrapper">
                    <img class="sticker-img"
                         src="${gifSrc}"
                         onerror="this.onerror=null;this.src='${pngSrc}'"
                         alt="${sticker.name}"
                         loading="lazy">
                    <span class="type-badge" style="opacity:0.5;">...</span>
                </div>
                <div class="sticker-item-name" title="${sticker.name}">${sticker.name}</div>
            `;

            item.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox') return;
                toggleSelect(index);
            });

            const checkbox = item.querySelector('input[type="checkbox"]');
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                toggleSelect(index);
            });

            stickerGrid.appendChild(item);
        });
    }

    // ===== Selection =====
    function toggleSelect(index) {
        if (selectedSet.has(index)) {
            selectedSet.delete(index);
        } else {
            selectedSet.add(index);
        }
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
        const isSelected = selectedSet.has(index);
        item.classList.toggle('selected', isSelected);
        item.querySelector('input[type="checkbox"]').checked = isSelected;
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

    // ===== Download =====
    async function downloadSelected(type) {
        if (selectedSet.size === 0) return;

        const indices = Array.from(selectedSet);
        const total = indices.length;
        let completed = 0;

        downloadProgress.style.display = 'flex';
        progressFill.style.width = '0%';
        progressText.textContent = '0%';
        downloadGifBtn.disabled = true;
        downloadPngBtn.disabled = true;

        try {
            const zip = new JSZip();
            const folder = zip.folder(currentPackName);

            for (const idx of indices) {
                const sticker = currentStickers[idx];
                // Primary URL via proxy
                const primaryUrl = type === 'gif' ? sticker.gifUrl : sticker.pngUrl;
                const fallbackUrl = type === 'gif' ? sticker.pngUrl : sticker.gifUrl;
                const primaryExt = type === 'gif' ? 'gif' : 'png';
                const fallbackExt = type === 'gif' ? 'png' : 'gif';

                try {
                    let resp = await fetch(primaryUrl);
                    if (resp.ok) {
                        const blob = await resp.blob();
                        folder.file(`${sticker.name}.${primaryExt}`, blob);
                    } else {
                        // Fallback
                        resp = await fetch(fallbackUrl);
                        if (resp.ok) {
                            const blob = await resp.blob();
                            folder.file(`${sticker.name}.${fallbackExt}`, blob);
                        }
                    }
                } catch (e) {
                    console.warn(`Failed to download: ${sticker.name}`, e);
                }

                completed++;
                const pct = Math.round((completed / total) * 100);
                progressFill.style.width = `${pct}%`;
                progressText.textContent = `${pct}%`;
            }

            const blob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 },
            });

            saveAs(blob, `${currentPackName}_${type}.zip`);

        } catch (err) {
            showError('下载失败: ' + (err.message || '未知错误'));
        } finally {
            downloadGifBtn.disabled = selectedSet.size === 0;
            downloadPngBtn.disabled = selectedSet.size === 0;
            setTimeout(() => {
                downloadProgress.style.display = 'none';
            }, 1500);
        }
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
        errorMsg.textContent = msg;
        errorToast.style.display = 'flex';
        errorToast.style.animation = 'none';
        void errorToast.offsetWidth; // reflow
        errorToast.style.animation = '';
        clearTimeout(showError._timer);
        showError._timer = setTimeout(hideError, 4000);
    }

    function hideError() {
        errorToast.style.display = 'none';
    }

})();
