/**
 * NCCS - Nik's Crappy Cookie Keeper (Cloudflare Worker)
 * Manages server-side cookie storage, synchronization, resets, and serves the client library.
 */

// Embed the client script directly for single-deploy simplicity
const CLIENT_JS_CODE = `/**
 * NCCS - Nik's Crappy Cookie Keeper (Client-side Library)
 * Exposes window.nccs and window.cookie_saver APIs for mirrored cookie synchronization.
 */
(function (window) {
    'use strict';

    if (window.nccs && window.nccs.initialized) {
        return;
    }

    const SESSION_COOKIE_NAME = '_nccs_session';
    const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
    const DEFAULT_TIMEOUT_MS = 1000; // 1 second timeout

    const nccs = {
        initialized: true,
        isReady: false,
        readyQueue: [],
        consent: true,
        values: {},

        ready: function (callback) {
            if (typeof callback !== 'function') return;
            if (this.isReady) {
                try { callback(); } catch (e) { console.error('[NCCS] Callback error:', e); }
            } else {
                this.readyQueue.push(callback);
            }
        },

        setConsent: function (hasConsent) {
            this.consent = !!hasConsent;
            console.log("[NCCS] Consent status updated: " + this.consent);
        },

        init: function (...args) {
            let options = {};
            const cookies = [];

            args.forEach(arg => {
                if (typeof arg === 'string') {
                    cookies.push({ name: arg, generate: false });
                } else if (typeof arg === 'object' && arg !== null) {
                    if (arg.name) {
                        cookies.push({
                            name: arg.name,
                            generate: !!arg.generate
                        });
                    } else {
                        options = { ...options, ...arg };
                    }
                }
            });

            if (cookies.length === 0) {
                console.warn('[NCCS] No cookies specified for monitoring.');
                this._markReady();
                return;
            }

            options.timeout = options.timeout || DEFAULT_TIMEOUT_MS;
            options.domain = options.domain || getRootDomain(window.location.hostname);

            if (!this.consent) {
                console.log('[NCCS] Consent is false. Skipping sync.');
                this._markReady();
                return;
            }

            const urlOverrides = this._getUrlOverrides(cookies);
            const hasOverrides = Object.keys(urlOverrides).length > 0;

            const sessionCookie = getCookie(SESSION_COOKIE_NAME);
            const now = Date.now();
            let shouldSync = true;

            if (sessionCookie && !hasOverrides && !options.force) {
                const lastSyncTime = parseInt(sessionCookie, 10);
                if (!isNaN(lastSyncTime) && (now - lastSyncTime < SESSION_EXPIRY_MS)) {
                    shouldSync = false;
                }
            }

            if (!shouldSync) {
                console.log('[NCCS] Active session within 30 minutes. Skipping sync request.');
                cookies.forEach(c => {
                    const localVal = getCookie(c.name);
                    if (localVal) {
                        this.values[c.name] = localVal;
                    }
                });
                this._updateSessionCookie(options.domain);
                this._exposeGlobals();
                this._markReady();
                return;
            }

            const payload = {
                cookies: cookies.map(c => ({
                    name: c.name,
                    value: getCookie(c.name) || null,
                    generate: c.generate
                })),
                overrides: urlOverrides,
                domain: options.domain
            };

            this._sync(payload, options);
        },

        reset: function (cookieName) {
            const domain = getRootDomain(window.location.hostname);
            console.log("[NCCS] Triggering reset for: " + (cookieName || 'ALL'));

            deleteCookie(SESSION_COOKIE_NAME, domain);

            const workerUrl = this._getWorkerUrl('/nccs/reset');
            if (cookieName) {
                deleteCookie(cookieName, domain);
                delete this.values[cookieName];
                const stripped = cookieName.startsWith('_') ? cookieName.substring(1) : cookieName;
                delete this.values[stripped];
                workerUrl.searchParams.set('cookie', cookieName);
            } else {
                Object.keys(this.values).forEach(key => {
                    deleteCookie(key, domain);
                    if (!key.startsWith('_')) {
                        deleteCookie('_' + key, domain);
                    }
                });
                this.values = {};
            }

            try {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', workerUrl.toString(), true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.withCredentials = true; // Crucial for cross-domain cookie manipulation!
                xhr.send(JSON.stringify({ cookie: cookieName || null }));
            } catch (e) {
                console.error('[NCCS] Reset network request failed:', e);
            }

            this._exposeGlobals();
        },

        generate: function (cookieName) {
            console.log("[NCCS] Explicitly requesting GUID generation for: " + cookieName);
            this.init({ name: cookieName, generate: true }, { force: true });
        },

        _exposeGlobals: function () {
            window._nccs = window._nccs || {};
            Object.entries(this.values).forEach(([key, val]) => {
                window._nccs[key] = val;
                if (key.startsWith('_')) {
                    const stripped = key.substring(1);
                    window._nccs[stripped] = val;
                }
            });
        },

        _markReady: function () {
            this.isReady = true;
            console.log('[NCCS] Initialization complete. Triggering callbacks.');
            while (this.readyQueue.length > 0) {
                const callback = this.readyQueue.shift();
                try { callback(); } catch (e) { console.error('[NCCS] Callback execution error:', e); }
            }
        },

        _getUrlOverrides: function (monitoredCookies) {
            const overrides = {};
            try {
                const searchParams = new URLSearchParams(window.location.search);
                monitoredCookies.forEach(c => {
                    const paramName = 'nccs_' + c.name;
                    if (searchParams.has(paramName)) {
                        const val = searchParams.get(paramName);
                        if (val) {
                            overrides[c.name] = val;
                        }
                    }
                });
            } catch (e) {
                console.error('[NCCS] Error parsing URL overrides:', e);
            }
            return overrides;
        },

        _getWorkerUrl: function (path) {
            let base = window.location.origin;
            if (document.currentScript && document.currentScript.src) {
                try {
                    const scriptUrl = new URL(document.currentScript.src);
                    base = scriptUrl.origin;
                } catch (e) {}
            }
            return new URL(path, base);
        },

        _updateSessionCookie: function (domain) {
            setCookie(SESSION_COOKIE_NAME, Date.now().toString(), 365, domain);
        },

        _sync: function (payload, options) {
            const workerUrl = this._getWorkerUrl('/nccs/sync');

            // Synchronous (blocking) mode is optional to prevent browser main-thread throttling
            if (options.sync === true) {
                let success = false;
                let responseData = null;

                console.log('[NCCS] Synchronizing cookies with worker (blocking mode)...');

                try {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', workerUrl.toString(), false); // Synchronous
                    xhr.setRequestHeader('Content-Type', 'application/json');
                    xhr.withCredentials = true; // Pass cookies in cross-origin request
                    
                    try {
                        xhr.timeout = options.timeout;
                    } catch (e) {}

                    xhr.send(JSON.stringify(payload));

                    if (xhr.status === 200) {
                        responseData = JSON.parse(xhr.responseText);
                        success = true;
                    } else {
                        console.warn('[NCCS] Sync HTTP error: ' + xhr.status);
                    }
                } catch (err) {
                    console.warn('[NCCS] Synchronous XHR failed, falling back to asynchronous fetch:', err);
                }

                if (success && responseData && responseData.cookies) {
                    this._processSyncResponse(responseData.cookies, options.domain);
                    return;
                }
            }

            // Default to high-performance asynchronous fetch (non-blocking)
            this._syncAsync(payload, options);
        },

        _syncAsync: function (payload, options) {
            const workerUrl = this._getWorkerUrl('/nccs/sync');
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), options.timeout);

            fetch(workerUrl.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                credentials: 'include', // Pass cookies in cross-origin request
                signal: controller.signal
            })
            .then(res => {
                clearTimeout(timeoutId);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(data => {
                if (data && data.cookies) {
                    this._processSyncResponse(data.cookies, options.domain);
                } else {
                    throw new Error('Invalid response structure');
                }
            })
            .catch(err => {
                console.error('[NCCS] Asynchronous sync failed:', err);
                payload.cookies.forEach(c => {
                    if (c.value) {
                        this.values[c.name] = c.value;
                    }
                });
                this._exposeGlobals();
                this._markReady();
            });
        },

        _processSyncResponse: function (cookies, domain) {
            Object.entries(cookies).forEach(([name, value]) => {
                if (value) {
                    setCookie(name, value, 365, domain);
                    this.values[name] = value;
                } else {
                    deleteCookie(name, domain);
                    delete this.values[name];
                }
            });

            this._updateSessionCookie(domain);
            this._exposeGlobals();
            this._markReady();
        }
    };

    function getCookie(name) {
        const value = "; " + document.cookie;
        const parts = value.split("; " + name + "=");
        if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift());
        return null;
    }

    function setCookie(name, value, days, domain) {
        let expires = '';
        if (days) {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = "; expires=" + date.toUTCString();
        }
        const domainStr = domain ? "; domain=" + domain : '';
        const secureStr = window.location.protocol === 'https:' ? '; secure' : '';
        document.cookie = name + "=" + encodeURIComponent(value) + expires + "; path=/; samesite=lax" + secureStr;
    }

    function deleteCookie(name, domain) {
        const domainStr = domain ? "; domain=" + domain : '';
        const secureStr = window.location.protocol === 'https:' ? '; secure' : '';
        document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; samesite=lax" + secureStr;
    }

    function getRootDomain(hostname) {
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return '';
        }
        const parts = hostname.split('.');
        if (parts.length <= 2) {
            return '.' + hostname;
        }
        const slds = new Set(['co', 'com', 'org', 'net', 'gov', 'edu']);
        if (slds.has(parts[parts.length - 2]) && parts.length > 2) {
            return '.' + parts.slice(-3).join('.');
        }
        return '.' + parts.slice(-2).join('.');
    }

    window.nccs = nccs;
    window.cookie_saver = nccs;

})(window);`;

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin') || '*';
        const method = request.method;

        console.log(`[NCCS Worker] ${method} request received for: ${url.pathname}`);

        // Helper to construct CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': origin === 'null' ? '*' : origin,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
            'Access-Control-Allow-Credentials': 'true',
        };

        // Handle preflight OPTIONS requests
        if (method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: corsHeaders,
            });
        }

        try {
            // Route 1: Serve client library script
            if (url.pathname === '/nccs.js') {
                return new Response(CLIENT_JS_CODE, {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/javascript; charset=utf-8',
                        'Cache-Control': 'no-cache',
                        ...corsHeaders
                    }
                });
            }

            // Route 2: Sync Endpoint
            if (url.pathname === '/nccs/sync') {
                if (method !== 'POST' && method !== 'GET') {
                    return new Response('Method Not Allowed', { status: 450, headers: corsHeaders });
                }

                // Parse incoming cookies from request headers (prefixed with _nccs_)
                const cookieHeader = request.headers.get('Cookie') || '';
                const requestCookies = parseCookies(cookieHeader);

                // Parse payload from body (if POST) or construct from defaults
                let payload = { cookies: [], overrides: {}, domain: '' };
                if (method === 'POST') {
                    try {
                        payload = await request.json();
                    } catch (e) {
                        console.error('[NCCS Worker] Failed to parse JSON payload:', e);
                    }
                }

                // Resolve domain
                const hostname = url.hostname;
                const rootDomain = getRootDomain(hostname);
                let finalDomain = rootDomain;

                // Validate requested domain parameter
                if (payload.domain && isSubdomainOrSame(hostname, payload.domain)) {
                    finalDomain = payload.domain;
                }

                const responseHeaders = new Headers(corsHeaders);
                responseHeaders.set('Content-Type', 'application/json');

                const resolvedCookies = {};
                const cookiesToSync = payload.cookies || [];

                // Check for URL overrides: accept URL parameters on the worker call as well
                // E.g. worker calls with ?nccs__ga=value
                const urlOverrides = {};
                url.searchParams.forEach((val, key) => {
                    if (key.startsWith('nccs_')) {
                        const cookieName = key.substring(5);
                        urlOverrides[cookieName] = val;
                    }
                });
                // Merge payload overrides
                const mergedOverrides = { ...payload.overrides, ...urlOverrides };

                // Process each cookie
                for (const c of cookiesToSync) {
                    const cookieName = c.name;
                    const serverCookieName = `_nccs_${cookieName}`;
                    let finalVal = null;
                    let source = '';

                    // 1. Hard URL Override
                    if (mergedOverrides[cookieName]) {
                        finalVal = mergedOverrides[cookieName];
                        source = 'URL override';
                    }
                    // 2. Server-side Cookie
                    else if (requestCookies[serverCookieName]) {
                        finalVal = requestCookies[serverCookieName];
                        source = 'Server-side mirrored cookie';
                    }
                    // 3. Client-side Cookie
                    else if (c.value) {
                        finalVal = c.value;
                        source = 'Client-side cookie';
                    }
                    // 4. GUID Generation (if requested and empty)
                    else if (c.generate) {
                        finalVal = crypto.randomUUID();
                        source = 'GUID generator';
                    }

                    if (finalVal) {
                        resolvedCookies[cookieName] = finalVal;
                        console.log(`[NCCS Worker] Syncing cookie [${cookieName}] -> [${finalVal}] (Source: ${source})`);

                        // Set/Renew the server-side mirrored cookie
                        const cookieAttributes = [
                            `${serverCookieName}=${encodeURIComponent(finalVal)}`,
                            'Max-Age=31536000', // 1 year
                            'Path=/',
                            finalDomain ? `Domain=${finalDomain}` : '',
                            url.protocol === 'https:' ? 'Secure' : '',
                            'SameSite=Lax',
                            'HttpOnly' // Shielded from ITP and client JS deletion
                        ].filter(Boolean).join('; ');

                        responseHeaders.append('Set-Cookie', cookieAttributes);
                    }
                }

                return new Response(JSON.stringify({ success: true, cookies: resolvedCookies }), {
                    status: 200,
                    headers: responseHeaders
                });
            }

            // Route 3: Reset Endpoint
            if (url.pathname === '/nccs/reset') {
                let cookieToReset = null;

                if (method === 'POST') {
                    try {
                        const body = await request.json();
                        cookieToReset = body.cookie;
                    } catch (e) {}
                } else {
                    cookieToReset = url.searchParams.get('cookie');
                }

                const cookieHeader = request.headers.get('Cookie') || '';
                const requestCookies = parseCookies(cookieHeader);
                const responseHeaders = new Headers(corsHeaders);
                responseHeaders.set('Content-Type', 'application/json');

                const hostname = url.hostname;
                const finalDomain = getRootDomain(hostname);

                const expireCookieString = (name) => {
                    return [
                        `${name}=`,
                        'Expires=Thu, 01 Jan 1970 00:00:00 UTC',
                        'Path=/',
                        finalDomain ? `Domain=${finalDomain}` : '',
                        url.protocol === 'https:' ? 'Secure' : '',
                        'SameSite=Lax',
                        'HttpOnly'
                    ].filter(Boolean).join('; ');
                };

                if (cookieToReset) {
                    // Reset specific cookie
                    const serverName = `_nccs_${cookieToReset}`;
                    responseHeaders.append('Set-Cookie', expireCookieString(serverName));
                    console.log(`[NCCS Worker] Expired server cookie: ${serverName}`);
                } else {
                    // Reset all _nccs_ prefixed cookies
                    Object.keys(requestCookies).forEach(name => {
                        if (name.startsWith('_nccs_')) {
                            responseHeaders.append('Set-Cookie', expireCookieString(name));
                            console.log(`[NCCS Worker] Expired server cookie: ${name}`);
                        }
                    });
                }

                return new Response(JSON.stringify({ success: true, message: 'Reset successful' }), {
                    status: 200,
                    headers: responseHeaders
                });
            }

            // Route 4: Fallback to serving the QA dashboard or Origin Proxying
            // If local running or standalone, serve a premium HTML dashboard
            const acceptHeader = request.headers.get('Accept') || '';
            if (acceptHeader.includes('text/html') || url.pathname === '/' || url.pathname === '/index.html') {
                // If there's an origin configuration, we can fetch it, otherwise serve a local HTML page.
                // We'll write the HTML content to a file, and if this worker runs locally, we can return it.
                // For direct Cloudflare Worker deployment, we serve the built-in HTML page or fetch the origin.
                // Since this is a test/QA project, serving the HTML directly is very convenient!
                // We will attempt to proxy to an origin if it exists, or fall back to serving our index.html.
                // Let's implement the HTML serving so it runs standalone easily.
                return serveDashboard(request, corsHeaders);
            }

            // Normal asset or API request -> Proxy to origin if needed.
            // For a standalone worker, return 404
            return new Response('Not Found', { status: 404, headers: corsHeaders });

        } catch (error) {
            console.error(`[NCCS Worker] Error: ${error.message}`, error.stack);
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }
    },
};

// Helper: Serve the dashboard HTML content
async function serveDashboard(request, corsHeaders) {
    const fallbackMessage = `
    <!DOCTYPE html>
    <html lang="en">
    <head><title>NCCS Dashboard Fallback</title></head>
    <body style="font-family: sans-serif; background: #0b0f19; color: #f3f4f6; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; text-align: center;">
      <h1>NCCS Worker Active</h1>
      <p style="color: #9ca3af; max-width: 600px; margin-bottom: 24px;">
        To test NCCS with full local cookie support (first-party context without HTTPS), the static server must be running.
      </p>
      <div style="background: rgba(255,255,255,0.05); padding: 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); font-family: monospace; font-size: 14px; text-align: left; margin-bottom: 24px; line-height: 1.5;">
        # Run the local static server in your workspace:<br>
        npm run serve
      </div>
      <p style="color: #3b82f6;">Once started, refresh this page (http://localhost:8787) to view the live dashboard!</p>
    </body>
    </html>`;

    try {
        // Attempt to fetch index.html from the local static web server
        const res = await fetch('http://localhost:3000/index.html');
        if (res.ok) {
            const html = await res.text();
            // Return index.html from the same origin to ensure cookies work perfectly on HTTP localhost!
            return new Response(html, {
                status: 200,
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    ...corsHeaders
                }
            });
        }
    } catch (e) {
        console.warn('[NCCS Worker] Local static server on port 3000 not reachable. Serving fallback HTML.');
    }

    return new Response(fallbackMessage, {
        status: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            ...corsHeaders
        }
    });
}

// Helper: Parse cookies from header
function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
        let [name, ...rest] = cookie.split('=');
        name = name?.trim();
        if (!name) return;
        const value = rest.join('=').trim();
        if (!value) return;
        list[name] = decodeURIComponent(value);
    });
    return list;
}

// Helper: Extract root domain
function getRootDomain(hostname) {
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return '';
    }
    const parts = hostname.split('.');
    if (parts.length <= 2) {
        return `.${hostname}`;
    }
    const slds = new Set(['co', 'com', 'org', 'net', 'gov', 'edu']);
    if (slds.has(parts[parts.length - 2]) && parts.length > 2) {
        return `.${parts.slice(-3).join('.')}`;
    }
    return `.${parts.slice(-2).join('.')}`;
}

// Helper: Validate domain overrides to prevent security issues
function isSubdomainOrSame(hostname, domain) {
    if (!domain) return false;
    const cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain;
    if (hostname === cleanDomain) return true;
    return hostname.endsWith(`.${cleanDomain}`);
}
