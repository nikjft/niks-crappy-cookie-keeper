/**
 * NCCS - Nik's Crappy Cookie Keeper (Cloudflare Worker)
 * Manages server-side cookie storage, synchronization, resets, and serves the client library.
 */

// Embed the client script directly for single-deploy simplicity
const CLIENT_JS_CODE = `!function(e){"use strict";if(e.nccs&&e.nccs.initialized)return;let t="";if(document.currentScript&&document.currentScript.src)try{t=new URL(document.currentScript.src).origin}catch(e){}const n="_nccs_session",o={initialized:!0,isReady:!1,readyQueue:[],consent:!0,values:{},ready:function(e){if("function"==typeof e)if(this.isReady)try{e()}catch(e){console.error("[NCCS] Callback error:",e)}else this.readyQueue.push(e)},setConsent:function(e){this.consent=!!e,console.log(\`[NCCS] Consent status updated: \${this.consent}\`)},init:function(...t){let o={};const i=[];if(t.forEach(e=>{"string"==typeof e?i.push({name:e,generate:!1}):"object"==typeof e&&null!==e&&(e.name?i.push({name:e.name,generate:!!e.generate}):o={...o,...e})}),0===i.length)return console.warn("[NCCS] No cookies specified for monitoring."),void this._markReady();if(o.timeout=o.timeout||1e3,o.domain=o.domain||c(e.location.hostname),(o.workerUrl||o.workerHost)&&(this.workerUrl=o.workerUrl||o.workerHost),!this.consent)return console.log("[NCCS] Consent is false. Skipping sync."),void this._markReady();const r=this._getUrlOverrides(i),a=Object.keys(r).length>0,l=s(n),u=Date.now();let h=!0;if(l&&!a&&!o.force){const e=parseInt(l,10);!isNaN(e)&&u-e<18e5&&(h=!1)}if(!h)return console.log("[NCCS] Active session within 30 minutes. Skipping sync request."),i.forEach(e=>{const t=s(e.name);t&&(this.values[e.name]=t)}),this._updateSessionCookie(o.domain),this._exposeGlobals(),void this._markReady();const f={cookies:i.map(e=>({name:e.name,value:s(e.name)||null,generate:e.generate})),overrides:r,domain:o.domain};this._sync(f,o)},reset:function(t){const o=c(e.location.hostname);console.log(\`[NCCS] Triggering reset for: \${t||"ALL"}\`),r(n,o);const s=this._getWorkerUrl("/nccs/reset");if(t){r(t,o),delete this.values[t];const e=t.startsWith("_")?t.substring(1):t;delete this.values[e],s.searchParams.set("cookie",t)}else Object.keys(this.values).forEach(e=>{r(e,o),e.startsWith("_")||r("_"+e,o)}),this.values={};try{const e=new XMLHttpRequest;e.open("POST",s.toString(),!0),e.setRequestHeader("Content-Type","application/json"),e.send(JSON.stringify({cookie:t||null}))}catch(e){console.error("[NCCS] Reset network request failed:",e)}this._exposeGlobals()},generate:function(e){console.log(\`[NCCS] Explicitly requesting GUID generation for: \${e}\`),this.init({name:e,generate:!0},{force:!0})},_exposeGlobals:function(){e._nccs=e._nccs||{},Object.entries(this.values).forEach(([t,n])=>{if(e._nccs[t]=n,t.startsWith("_")){const o=t.substring(1);e._nccs[o]=n}})},_markReady:function(){for(this.isReady=!0,console.log("[NCCS] Initialization complete. Triggering callbacks.");this.readyQueue.length>0;){const e=this.readyQueue.shift();try{e()}catch(e){console.error("[NCCS] Callback execution error:",e)}}},_getUrlOverrides:function(t){const n={};try{const o=new URLSearchParams(e.location.search);t.forEach(e=>{const t=\`nccs_\${e.name}\`;if(o.has(t)){const s=o.get(t);s&&(n[e.name]=s)}})}catch(e){console.error("[NCCS] Error parsing URL overrides:",e)}return n},_getWorkerUrl:function(n){if(this.workerUrl)return new URL(n,this.workerUrl);let o=t||e.location.origin;if(!t){const e=document.getElementsByTagName("script");for(let t=0;t<e.length;t++){const n=e[t].src;if(n&&(-1!==n.indexOf("/nccs.js")||-1!==n.indexOf("/nccs.min.js")))try{o=new URL(n).origin;break}catch(e){}}}return new URL(n,o)},_updateSessionCookie:function(e){i(n,Date.now().toString(),365,e)},_sync:function(e,t){const n=this._getWorkerUrl("/nccs/sync");if(!0===t.sync){let o=!1,s=null;console.log("[NCCS] Synchronizing cookies with worker (blocking mode)...");try{const i=new XMLHttpRequest;i.open("POST",n.toString(),!1),i.setRequestHeader("Content-Type","application/json");try{i.timeout=t.timeout}catch(e){}i.send(JSON.stringify(e)),200===i.status?(s=JSON.parse(i.responseText),o=!0):console.warn(\`[NCCS] Sync HTTP error: \${i.status}\`)}catch(e){console.warn("[NCCS] Synchronous XHR failed, falling back to asynchronous fetch:",e)}if(o&&s&&s.cookies)return void this._processSyncResponse(s.cookies,t.domain)}this._syncAsync(e,t)},_syncAsync:function(e,t){const n=this._getWorkerUrl("/nccs/sync"),o=new AbortController,s=setTimeout(()=>o.abort(),t.timeout);fetch(n.toString(),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(e),signal:o.signal}).then(e=>{if(clearTimeout(s),!e.ok)throw new Error(\`HTTP \${e.status}\`);return e.json()}).then(e=>{if(!e||!e.cookies)throw new Error("Invalid response structure");this._processSyncResponse(e.cookies,t.domain)}).catch(t=>{console.error("[NCCS] Asynchronous sync failed:",t),e.cookies.forEach(e=>{e.value&&(this.values[e.name]=e.value)}),this._exposeGlobals(),this._markReady()})},_processSyncResponse:function(e,t){Object.entries(e).forEach(([e,n])=>{n?(i(e,n,365,t),this.values[e]=n):(r(e,t),delete this.values[e])}),this._updateSessionCookie(t),this._exposeGlobals(),this._markReady()}};function s(e){const t=\`; \${document.cookie}\`.split(\`; \${e}=\`);return 2===t.length?decodeURIComponent(t.pop().split(";").shift()):null}function i(t,n,o,s){let i="";if(o){const e=new Date;e.setTime(e.getTime()+24*o*60*60*1e3),i=\`; expires=\${e.toUTCString()}\`}const r=s?\`; domain=\${s}\`:"",c="https:"===e.location.protocol?"; secure":"";document.cookie=\`\${t}=\${encodeURIComponent(n)}\${i}; path=/\${r}; samesite=lax\${c}\`}function r(t,n){const o=n?\`; domain=\${n}\`:"",s="https:"===e.location.protocol?"; secure":"";document.cookie=\`\${t}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/\${o}; samesite=lax\${s}\`}function c(e){if("localhost"===e||"127.0.0.1"===e)return"";const t=e.split(".");if(t.length<=2)return\`.\${e}\`;return new Set(["co","com","org","net","gov","edu"]).has(t[t.length-2])&&t.length>2?\`.\${t.slice(-3).join(".")}\`:\`.\${t.slice(-2).join(".")}\`}e.nccs=o,e.cookie_saver=o}(window);`;

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
