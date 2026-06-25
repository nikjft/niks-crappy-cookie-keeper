/**
 * NCCS - Cookie Keeper QA Console Scripts
 * 
 * You can copy-paste these helper functions directly into your browser console (F12 Developer Tools)
 * on any page running NCCS to debug, reset, or rewrite cookies.
 */

const NCCS_QA = {
    /**
     * Helper to read a cookie's value
     */
    get: function (name) {
        const value = "; " + document.cookie;
        const parts = value.split("; " + name + "=");
        if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift());
        return null;
    },

    /**
     * Helper to set a cookie's value client-side
     */
    set: function (name, value, days = 1, domain = "") {
        let expires = '';
        if (days) {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = "; expires=" + date.toUTCString();
        }
        const domainStr = domain ? "; domain=" + domain : '';
        const secureStr = window.location.protocol === 'https:' ? '; secure' : '';
        document.cookie = `${name}=${encodeURIComponent(value)}${expires}; path=/; samesite=lax${secureStr}${domainStr}`;
        console.log(`[NCCS QA] Set cookie: ${name}=${value}`);
    },

    /**
     * Delete a cookie client-side
     */
    delete: function (name, domain = "") {
        const domainStr = domain ? "; domain=" + domain : '';
        const secureStr = window.location.protocol === 'https:' ? '; secure' : '';
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; samesite=lax${secureStr}${domainStr}`;
        console.log(`[NCCS QA] Deleted cookie: ${name}`);
    },

    /**
     * Simulate ITP behavior (wiping monitored client cookies)
     */
    simulateITP: function () {
        const monitored = ['_ga', '_fbp', 'ajs_anonymous_id', 'nccs_qa_custom'];
        monitored.forEach(name => this.delete(name));
        console.log('[NCCS QA] Simulated ITP. All client-side cookies deleted. Server-side backups are still stored.');
    },

    /**
     * Force a full synchronisation run, bypassing the 30-minute session cache
     */
    forceSync: function () {
        if (window.cookie_saver) {
            console.log('[NCCS QA] Triggering force sync...');
            window.cookie_saver.init(
                '_ga', 
                '_fbp', 
                { name: 'ajs_anonymous_id', generate: false }, 
                { name: 'nccs_qa_custom', generate: true },
                { force: true }
            );
        } else {
            console.error('[NCCS QA] window.cookie_saver (NCCS) not found on this page.');
        }
    },

    /**
     * Clear the NCCS session lock cookie so the next page load/action hits the server
     */
    clearSessionLock: function () {
        this.delete('_nccs_session');
        console.log('[NCCS QA] Cleared NCCS 30-minute session lock cookie.');
    },

    /**
     * Perform a hard reset (wipes all cookies client-side and server-side)
     */
    hardReset: function () {
        if (window.cookie_saver) {
            console.log('[NCCS QA] Initiating hard reset...');
            window.cookie_saver.reset();
        } else {
            console.error('[NCCS QA] window.cookie_saver (NCCS) not found.');
        }
    },

    /**
     * Print a summary of current cookie states
     */
    status: function () {
        const monitored = ['_ga', '_fbp', 'ajs_anonymous_id', 'nccs_qa_custom', '_nccs_session'];
        console.group('=== NCCS COOKIE STATUS ===');
        monitored.forEach(name => {
            const clientVal = this.get(name);
            const serverVal = window._nccs ? window._nccs[name] : undefined;
            console.log(
                `%c${name.padEnd(20)}%c | Client: %c${String(clientVal).padEnd(25)}%c | Server Synced: %c${String(serverVal)}`,
                'font-weight: bold; color: #3b82f6;',
                'color: gray;',
                clientVal ? 'color: #10b981;' : 'color: #ef4444;',
                'color: gray;',
                serverVal ? 'color: #10b981;' : 'color: #f59e0b;'
            );
        });
        console.groupEnd();
    }
};

console.log('[NCCS QA] QA Helper scripts loaded. Use NCCS_QA.status() to view current state.');
