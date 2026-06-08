/**
 * CF Pages Function: /api/sticker?id=241071
 * Fetches QQ sticker pack metadata from i.gtimg.cn and returns structured JSON.
 */

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const id = url.searchParams.get('id');

    if (!id || !/^\d+$/.test(id)) {
        return new Response(JSON.stringify({ error: '请提供有效的表情包ID' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
    }

    try {
        const lastChar = id.charAt(id.length - 1);
        const apiUrl = `https://i.gtimg.cn/club/item/parcel/${lastChar}/${id}_android.json`;

        const resp = await fetch(apiUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
        });

        if (!resp.ok) {
            return new Response(JSON.stringify({ error: '表情包不存在或接口异常' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
            });
        }

        const raw = await resp.json();

        if (!raw || !raw.imgs || raw.imgs.length === 0) {
            return new Response(JSON.stringify({ error: '表情包数据为空' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
            });
        }

        // Build clean response
        const data = {
            name: raw.name,
            id: raw.id,
            mark: raw.mark || '',
            coverUrl: `https://i.gtimg.cn/club/item/parcel/img/parcel/${lastChar}/${id}/200x200.png`,
            supportSize: raw.supportSize || '',
            updateTime: raw.updateTime || '',
            count: raw.imgs.length,
            imgs: raw.imgs.map(img => ({
                name: img.name,
                id: img.id,
                gifUrl: `/api/proxy?url=${encodeURIComponent(`https://i.gtimg.cn/club/item/parcel/item/${img.id.slice(0, 2)}/${img.id}/raw300.gif`)}`,
                pngUrl: `/api/proxy?url=${encodeURIComponent(`https://i.gtimg.cn/club/item/parcel/item/${img.id.slice(0, 2)}/${img.id}/300x300.png`)}`,
                // Also provide direct CDN URLs for reference
                gifDirect: `https://i.gtimg.cn/club/item/parcel/item/${img.id.slice(0, 2)}/${img.id}/raw300.gif`,
                pngDirect: `https://i.gtimg.cn/club/item/parcel/item/${img.id.slice(0, 2)}/${img.id}/300x300.png`,
            })),
        };

        return new Response(JSON.stringify(data), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=3600',
                ...CORS_HEADERS,
            },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: '获取失败: ' + err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
    }
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}
