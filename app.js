/**
 * QQ Sticker Viewer - App Logic
 * - 图片加载时同步缓存 Blob 到内存
 * - 打包下载完全在前端完成，直接取缓存 Blob，无重复网络请求
 * - 文件名格式：01.名称.gif / 01.名称.png
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

    // Blob 内存缓存：key = index, value = { gifBlob, pngBlob, actualExt }
    // actualExt: 'gif' 表示该贴纸有真实 GIF，'png' 表示只有 PNG
    const blobCache = new Map();

    let selectedSet = new Set();

    // ===== Init =====
    init();

    function init() {
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

            // 后台加载所有图片 Blob（检测类型 + 预缓存）
            preloadAll();

        } catch (err) {
            showError(err.message || '获取失败，请检查ID是否正确');
        } finally {
            showLoading(false);
        }
    }

    // ===== 预加载：同时完成类型检测 + Blob 缓存 =====
    // 策略：先 fetch GIF；若 content-type 是 gif → 动图，缓存 gifBlob；
    //       若返回非 gif（服务器给的是 PNG 占位）→ 静图，缓存 pngBlob。
    async function preloadAll() {
        const CONCURRENCY = 4; // 并发数，避免浏览器连接数限制

        async function loadOne(sticker, index) {
            try {
                // 1. 尝试加载 GIF
                const gifResp = await fetch(sticker.gifUrl);
                if (gifResp.ok) {
                    const gifBlob = await gifResp.blob();
                    if (gifBlob.type.includes('gif') && gifBlob.size > 500) {
                        // 真实动图
                        sticker.isAnimated = true;
                        blobCache.set(index, { gifBlob, pngBlob: null, actualExt: 'gif' });
                        // 懒加载 PNG（下载时按需）
                    } else {
                        // GIF 请求返回的是 PNG（无动图版本）
                        sticker.isAnimated = false;
                        blobCache.set(index, { gifBlob: null, pngBlob: gifBlob, actualExt: 'png' });
                    }
                } else {
                    // GIF 不存在，加载 PNG
                    const pngResp = await fetch(sticker.pngUrl);
                    sticker.isAnimated = false;
                    const pngBlob = pngResp.ok ? await pngResp.blob() : null;
                    blobCache.set(index, { gifBlob: null, pngBlob, actualExt: 'png' });
                }
            } catch {
                sticker.isAnimated = false;
                blobCache.set(index, { gifBlob: null, pngBlob: null, actualExt: 'png' });
            }
            updateItemBadge(index, sticker.isAnimated);
        }

        // 分批并发
        for (let i = 0; i < currentStickers.length; i += CONCURRENCY) {
            const batch = currentStickers
                .slice(i, i + CONCURRENCY)
                .map((s, j) => loadOne(s, i + j));
            await Promise.allSettled(batch);
        }
    }

    // 如果 PNG blob 还没缓存（动图包但用户选择了下载PNG），按需补充
    async function ensurePngBlob(index) {
        const cached = blobCache.get(index);
        if (!cached) return null;
        if (cached.pngBlob) return cached.pngBlob;
        try {
            const resp = await fetch(currentStickers[index].pngUrl);
            if (resp.ok) {
                cached.pngBlob = await resp.blob();
            }
        } catch (_) {}
        return cached.pngBlob || null;
    }

    function updateItemBadge(index, isAnimated) {
        const badge = stickerGrid.querySelector(`[data-index="${index}"] .type-badge`);
        if (!badge) return;
        badge.style.opacity = '1';
        badge.textContent   = isAnimated ? 'GIF' : 'PNG';
        badge.className     = `type-badge ${isAnimated ? 'gif' : 'png'}`;
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
                    <span class="type-badge" style="opacity:0.4;">…</span>
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
        const padLen  = String(total).length; // 位数：10张→2位，100张→3位
        let completed = 0;

        downloadProgress.style.display = 'flex';
        progressFill.style.width       = '0%';
        progressText.textContent       = '0%';
        downloadGifBtn.disabled        = true;
        downloadPngBtn.disabled        = true;

        try {
            const zip    = new JSZip();
            const folder = zip.folder(currentPackName);

            for (let rank = 0; rank < indices.length; rank++) {
                const idx     = indices[rank];
                const sticker = currentStickers[idx];
                const cached  = blobCache.get(idx);

                // 序号前缀：01. / 001.
                const seq = String(rank + 1).padStart(padLen, '0');

                let blob = null;
                let ext  = type;

                if (type === 'gif') {
                    if (cached?.gifBlob) {
                        blob = cached.gifBlob;
                        ext  = 'gif';
                    } else if (cached?.pngBlob) {
                        // 该贴纸只有 PNG（无动图），降级使用 PNG
                        blob = cached.pngBlob;
                        ext  = 'png';
                    }
                } else {
                    // type === 'png'
                    if (cached?.pngBlob) {
                        blob = cached.pngBlob;
                        ext  = 'png';
                    } else if (!cached?.pngBlob && cached) {
                        // 动图包但 PNG 未缓存，按需补充
                        blob = await ensurePngBlob(idx);
                        ext  = 'png';
                    }
                }

                // 最终兜底：重新 fetch（命中浏览器缓存，几乎无开销）
                if (!blob) {
                    try {
                        const url  = type === 'gif' ? sticker.gifUrl : sticker.pngUrl;
                        const resp = await fetch(url);
                        if (resp.ok) { blob = await resp.blob(); }
                    } catch (_) {}
                }

                if (blob) {
                    folder.file(`${seq}.${sticker.name}.${ext}`, blob, { binary: true });
                }

                completed++;
                const pct = Math.round((completed / total) * 100);
                progressFill.style.width = `${pct}%`;
                progressText.textContent = `${pct}%`;
            }

            // 生成 ZIP（图片本身已压缩，用 STORE 更快；GIF/PNG 再压无意义）
            const zipBlob = await zip.generateAsync({
                type:        'blob',
                compression: 'STORE',
            }, ({ percent }) => {
                progressFill.style.width = `${Math.round(percent)}%`;
                progressText.textContent = `打包 ${Math.round(percent)}%`;
            });

            saveAs(zipBlob, `${currentPackName}_${type}.zip`);

        } catch (err) {
            showError('下载失败: ' + (err.message || '未知错误'));
        } finally {
            downloadGifBtn.disabled = selectedSet.size === 0;
            downloadPngBtn.disabled = selectedSet.size === 0;
            setTimeout(() => { downloadProgress.style.display = 'none'; }, 1500);
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
