/**
 * CF Pages Function: /api/proxy?url=https://i.gtimg.cn/...
 * Proxies image requests to bypass CORS restrictions.
 * Only allows requests to whitelisted domains.
 */

const ALLOWED_HOSTS = [
    'i.gtimg.cn',
    'gxh.vip.qq.com',
    'p.qpic.cn',
];

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestGet(context) {
    const reqUrl = new URL(context.request.url);
    const targetUrl = reqUrl.searchParams.get('url');

    if (!targetUrl) {
        return new Response(JSON.stringify({ error: '缺少 url 参数' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
    }

    let parsed;
    try {
        parsed = new URL(targetUrl);
    } catch {
        return new Response(JSON.stringify({ error: '无效的 URL' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
    }

    // Security: only allow whitelisted hosts
    if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
        return new Response(JSON.stringify({ error: '不允许代理此域名' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
    }

    try {
        const resp = await fetch(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
        });

        if (!resp.ok) {
            return new Response(null, {
                status: resp.status,
                headers: CORS_HEADERS,
            });
        }

        const contentType = resp.headers.get('content-type') || 'application/octet-stream';
        const contentLength = resp.headers.get('content-length');
        const body = resp.body;

        const headers = {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
            ...CORS_HEADERS,
        };

        if (contentLength) {
            headers['Content-Length'] = contentLength;
        }

        return new Response(body, { status: 200, headers });
    } catch (err) {
        return new Response(JSON.stringify({ error: '代理请求失败: ' + err.message }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
    }
}

// Support HEAD requests for type detection
export async function onRequestHead(context) {
    const reqUrl = new URL(context.request.url);
    const targetUrl = reqUrl.searchParams.get('url');

    if (!targetUrl) {
        return new Response(null, { status: 400, headers: CORS_HEADERS });
    }

    let parsed;
    try {
        parsed = new URL(targetUrl);
    } catch {
        return new Response(null, { status: 400, headers: CORS_HEADERS });
    }

    if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
        return new Response(null, { status: 403, headers: CORS_HEADERS });
    }

    try {
        const resp = await fetch(targetUrl, {
            method: 'HEAD',
            headers: { 'User-Agent': 'Mozilla/5.0' },
        });

        const headers = {
            ...CORS_HEADERS,
        };

        const ct = resp.headers.get('content-type');
        const cl = resp.headers.get('content-length');
        if (ct) headers['Content-Type'] = ct;
        if (cl) headers['Content-Length'] = cl;

        return new Response(null, { status: resp.status, headers });
    } catch {
        return new Response(null, { status: 502, headers: CORS_HEADERS });
    }
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}
