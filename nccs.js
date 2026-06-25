/**
 * NCCS - Nik's Crappy Cookie Keeper (Client-side Library)
 * Exposes window.nccs and window.cookie_saver APIs for mirrored cookie synchronization.
 */
(function (window) {
    'use strict';

    // Prevent double initialization
    if (window.nccs && window.nccs.initialized) {
        return;
    }

    // Capture the worker URL immediately on load while document.currentScript points to this script
    let initialWorkerUrl = '';
    if (document.currentScript && document.currentScript.src) {
        try {
            initialWorkerUrl = new URL(document.currentScript.src).origin;
        } catch (e) {}
    }

    const SESSION_COOKIE_NAME = '_nccs_session';
    const STATE_COOKIE_NAME = '_nccs_sync_state';
    const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
    const DEFAULT_TIMEOUT_MS = 1000; // 1 second timeout for blocking sync

    const nccs = {
        initialized: true,
        isReady: false,
        readyQueue: [],
        consent: true,
        values: {}, // Stores synchronized cookie values

        /**
         * Register callback to execute when NCCS is ready
         * @param {Function} callback 
         */
        ready: function (callback) {
            if (typeof callback !== 'function') return;
            if (this.isReady) {
                try { callback(); } catch (e) { console.error('[NCCS] Callback error:', e); }
            } else {
                this.readyQueue.push(callback);
            }
        },

        /**
         * Set consent status for tracking / cookie storage
         * @param {boolean} hasConsent 
         */
        setConsent: function (hasConsent) {
            this.consent = !!hasConsent;
            console.log(`[NCCS] Consent status updated: ${this.consent}`);
        },

        /**
         * Initialize synchronization for specified cookies
         * @param {...(string|Object)} args Cookie names or configuration objects
         */
        init: function (...args) {
            let options = {};
            const cookies = [];

            // Parse arguments
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
                        // It is a trailing options object
                        options = { ...options, ...arg };
                    }
                }
            });

            if (cookies.length === 0) {
                console.warn('[NCCS] No cookies specified for monitoring.');
                this._markReady();
                return;
            }

            // Apply default options
            options.timeout = options.timeout || DEFAULT_TIMEOUT_MS;
            options.domain = options.domain || getRootDomain(window.location.hostname);

            if (options.workerUrl || options.workerHost) {
                this.workerUrl = options.workerUrl || options.workerHost;
            }

            if (!this.consent) {
                console.log('[NCCS] Consent is false. Skipping sync.');
                this._markReady();
                return;
            }

            // 1. Detect URL Overrides
            const urlOverrides = this._getUrlOverrides(cookies);
            const hasOverrides = Object.keys(urlOverrides).length > 0;

            // 2. Read last-synced state
            const stateCookie = getCookie(STATE_COOKIE_NAME);
            let lastSyncState = {};
            if (stateCookie) {
                try {
                    lastSyncState = JSON.parse(stateCookie);
                } catch (e) {
                    console.warn('[NCCS] Failed to parse sync state cookie:', e);
                }
            }

            // 3. Check for any cookie value changes (new, changed, or deleted by ITP)
            let hasChanges = false;
            cookies.forEach(c => {
                const currentVal = getCookie(c.name);
                const stateVal = lastSyncState[c.name];
                
                const valA = currentVal === null ? undefined : currentVal;
                const valB = stateVal === null ? undefined : stateVal;
                
                if (valA !== valB) {
                    hasChanges = true;
                    console.log(`[NCCS] Cookie [${c.name}] state changed: "${valB}" -> "${valA}"`);
                }
            });

            // 4. Check session timestamp (Compute Limiting)
            const sessionCookie = getCookie(SESSION_COOKIE_NAME);
            const now = Date.now();
            let shouldSync = true;

            if (sessionCookie && !hasOverrides && !hasChanges && !options.force) {
                const lastSyncTime = parseInt(sessionCookie, 10);
                if (!isNaN(lastSyncTime) && (now - lastSyncTime < SESSION_EXPIRY_MS)) {
                    shouldSync = false;
                }
            }

            if (!shouldSync) {
                console.log('[NCCS] Active session within 30 minutes and no cookie changes detected. Skipping sync request.');
                // Read existing local cookies and prime globals
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

            // 3. Prepare payload for synchronization
            const payload = {
                cookies: cookies.map(c => ({
                    name: c.name,
                    value: getCookie(c.name) || null,
                    generate: c.generate
                })),
                overrides: urlOverrides,
                domain: options.domain
            };

            // 4. Perform Synchronization
            this._sync(payload, options);
        },

        /**
         * Reset one or all cookies on client and server
         * @param {string} [cookieName] Specific cookie to reset, otherwise resets all
         */
        reset: function (cookieName) {
            const domain = getRootDomain(window.location.hostname);
            console.log(`[NCCS] Triggering reset for: ${cookieName || 'ALL'}`);

            // Clear local session cookie
            deleteCookie(SESSION_COOKIE_NAME, domain);

            // Make request to worker reset endpoint
            const workerUrl = this._getWorkerUrl('/nccs/reset');
            if (cookieName) {
                deleteCookie(cookieName, domain);
                delete this.values[cookieName];
                const stripped = cookieName.startsWith('_') ? cookieName.substring(1) : cookieName;
                delete this.values[stripped];

                // Remove specific key from client sync state
                const stateCookie = getCookie(STATE_COOKIE_NAME);
                if (stateCookie) {
                    try {
                        const state = JSON.parse(stateCookie);
                        delete state[cookieName];
                        setCookie(STATE_COOKIE_NAME, JSON.stringify(state), 365, domain);
                    } catch (e) {}
                }

                workerUrl.searchParams.set('cookie', cookieName);
            } else {
                // Read all keys from NCCS and clear them
                Object.keys(this.values).forEach(key => {
                    deleteCookie(key, domain);
                    if (!key.startsWith('_')) {
                        deleteCookie('_' + key, domain);
                    }
                });
                this.values = {};
                deleteCookie(STATE_COOKIE_NAME, domain);
            }

            // Make async call to reset server-side cookies
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', workerUrl.toString(), true);
                xhr.withCredentials = true;
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(JSON.stringify({ cookie: cookieName || null }));
            } catch (e) {
                console.error('[NCCS] Reset network request failed:', e);
            }

            this._exposeGlobals();
        },

        /**
         * Force generate a GUID for a cookie immediately
         * @param {string} cookieName 
         */
        generate: function (cookieName) {
            console.log(`[NCCS] Explicitly requesting GUID generation for: ${cookieName}`);
            this.init({ name: cookieName, generate: true }, { force: true });
        },

        /**
         * Internal: Expose global variable window._nccs
         */
        _exposeGlobals: function () {
            window._nccs = window._nccs || {};
            // Populate values with both exact name and underscore-stripped name
            Object.entries(this.values).forEach(([key, val]) => {
                window._nccs[key] = val;
                if (key.startsWith('_')) {
                    const stripped = key.substring(1);
                    window._nccs[stripped] = val;
                }
            });
        },

        /**
         * Internal: Mark initialization complete and fire callbacks
         */
        _markReady: function () {
            this.isReady = true;
            console.log('[NCCS] Initialization complete. Triggering callbacks.');
            while (this.readyQueue.length > 0) {
                const callback = this.readyQueue.shift();
                try { callback(); } catch (e) { console.error('[NCCS] Callback execution error:', e); }
            }
        },

        /**
         * Internal: Resolve URL overrides of the form ?nccs_[cookie]=value
         */
        _getUrlOverrides: function (monitoredCookies) {
            const overrides = {};
            try {
                const searchParams = new URLSearchParams(window.location.search);
                monitoredCookies.forEach(c => {
                    const paramName = `nccs_${c.name}`;
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

        /**
         * Internal: Resolve worker base URL based on script location
         */
        _getWorkerUrl: function (path) {
            if (this.workerUrl) {
                return new URL(path, this.workerUrl);
            }
            let base = initialWorkerUrl || window.location.origin;
            
            // Final fallback: if initialWorkerUrl is not captured, search DOM script tags
            if (!initialWorkerUrl) {
                const scripts = document.getElementsByTagName('script');
                for (let i = 0; i < scripts.length; i++) {
                    const src = scripts[i].src;
                    if (src && (src.indexOf('/nccs.js') !== -1 || src.indexOf('/nccs.min.js') !== -1)) {
                        try {
                            base = new URL(src).origin;
                            break;
                        } catch (e) {}
                    }
                }
            }
            return new URL(path, base);
        },

        /**
         * Internal: Update local session cookie for compute limiting
         */
        _updateSessionCookie: function (domain) {
            setCookie(SESSION_COOKIE_NAME, Date.now().toString(), 365, domain);
        },

        /**
         * Internal: Execute sync request to worker (Sync XHR with Async Fallback)
         */
        _sync: function (payload, options) {
            const workerUrl = this._getWorkerUrl('/nccs/sync');

            // Synchronous (blocking) mode is optional to prevent browser main-thread throttling
            if (options.sync === true) {
                let success = false;
                let responseData = null;

                console.log('[NCCS] Synchronizing cookies with worker (blocking mode)...');

                try {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', workerUrl.toString(), false);
                    xhr.withCredentials = true;
                    xhr.setRequestHeader('Content-Type', 'application/json');
                    
                    try {
                        xhr.timeout = options.timeout;
                    } catch (e) {}

                    xhr.send(JSON.stringify(payload));

                    if (xhr.status === 200) {
                        responseData = JSON.parse(xhr.responseText);
                        success = true;
                    } else {
                        console.warn(`[NCCS] Sync HTTP error: ${xhr.status}`);
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

        /**
         * Internal: Fallback asynchronous sync
         */
        _syncAsync: function (payload, options) {
            const workerUrl = this._getWorkerUrl('/nccs/sync');
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), options.timeout);

            fetch(workerUrl.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal,
                credentials: 'include'
            })
            .then(res => {
                clearTimeout(timeoutId);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
                // Fallback: use existing client-side cookies
                const newState = {};
                payload.cookies.forEach(c => {
                    if (c.value) {
                        this.values[c.name] = c.value;
                        newState[c.name] = c.value;
                    }
                });
                setCookie(STATE_COOKIE_NAME, JSON.stringify(newState), 365, options.domain);
                this._exposeGlobals();
                this._markReady();
            });
        },

        /**
         * Internal: Process successful sync responses and write cookies/globals
         */
        _processSyncResponse: function (cookies, domain) {
            const newState = {};
            Object.entries(cookies).forEach(([name, value]) => {
                if (value) {
                    // Update client-side cookie with long lifetime
                    setCookie(name, value, 365, domain);
                    this.values[name] = value;
                    newState[name] = value;
                } else {
                    // Clear cookie if deleted on server
                    deleteCookie(name, domain);
                    delete this.values[name];
                }
            });

            // Save new sync state
            setCookie(STATE_COOKIE_NAME, JSON.stringify(newState), 365, domain);

            this._updateSessionCookie(domain);
            this._exposeGlobals();
            this._markReady();
        }
    };

    // --- COOKIE HELPERS ---

    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift());
        return null;
    }

    function setCookie(name, value, days, domain) {
        let expires = '';
        if (days) {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = `; expires=${date.toUTCString()}`;
        }
        const domainStr = domain ? `; domain=${domain}` : '';
        const secureStr = window.location.protocol === 'https:' ? '; secure' : '';
        document.cookie = `${name}=${encodeURIComponent(value)}${expires}; path=/${domainStr}; samesite=lax${secureStr}`;
    }

    function deleteCookie(name, domain) {
        const domainStr = domain ? `; domain=${domain}` : '';
        const secureStr = window.location.protocol === 'https:' ? '; secure' : '';
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/${domainStr}; samesite=lax${secureStr}`;
    }

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

    // Expose global APIs
    window.nccs = nccs;
    window.cookie_saver = nccs;

})(window);
