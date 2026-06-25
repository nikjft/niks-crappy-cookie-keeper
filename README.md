# NCCS (Nik's Crappy Cookie Keeper)

> [!WARNING]
> **Vibe-Coded Disclaimer:** This project is heavily vibe-coded and provided entirely **"as-is"**, without warranty of any kind, express or implied. If it breaks your tracking, deletes your user IDs, or summons browser errors, you are on your own. Use at your own risk!

NCCS is a high-performance, mirrored server-side/client-side cookie synchronization setup designed to mitigate Intelligent Tracking Prevention (ITP) and browser-based cookie clearing behaviors. 

By mirroring client-side JavaScript cookies (which Safari caps to 1–7 days) with HTTP-set `HttpOnly` server-side cookies (which are exempt from ITP caps) on a first-party subdomain, NCCS guarantees that analytics, segment, and marketing identifiers persist for up to 1 year.

---

## ⚙️ How It Works

1. **Client-Side Script (`nccs.js`):** Runs at the top of the page, gathers current cookie values, and sends them to the Cloudflare Worker.
2. **Cloudflare Worker (`worker.js`):** Receives the sync request, compares client values against its own HTTP-level `_nccs_`-prefixed cookies, and returns the correct source-of-truth value. It also appends `Set-Cookie` response headers with `HttpOnly` enabled.
3. **Synchronization Priorities:**
   * **Priority 1: Hard URL Override** (e.g., `?nccs__ga=12345` on the page URL) always takes precedence, overwriting both server and client cookies.
   * **Priority 2: Server-side Mirrored Cookie** (e.g., `_nccs__ga` cookie sent in request headers).
   * **Priority 3: Client-side Cookie** (e.g., `_ga` read from the document context).
   * **Priority 4: GUID Generator** (dynamically generates a UUID v4 if configured).
4. **Compute Limiting:** To prevent overloading the server, NCCS writes a `_nccs_session` timestamp cookie. Unless 30 minutes of inactivity have elapsed, or a hard URL override is detected, NCCS bypasses the server sync entirely and runs instantly offline.

---

## 🛠️ API & Configuration

NCCS exposes the global namespace **`window.cookie_saver`** (aliased to **`window.nccs`**).

### `cookie_saver.init(...cookies, [options])`
Initializes synchronization. Accepts cookie names, custom cookie configuration objects, and an optional trailing options object.

#### Parameters:
* **`cookies` (String | Object):** 
  * Pass a `string` to mirror an existing cookie (e.g. `'_ga'`).
  * Pass an `object` to specify options for a target cookie, such as auto-generating a value if empty:  
    `{ name: 'ajs_anonymous_id', generate: true }`
* **`options` (Object) [Optional]:**
  * `timeout` (Number): Network timeout in milliseconds. Defaults to `1000`.
  * `domain` (String): Cookie domain. Defaults to the highest possible root domain (e.g. `.example.com`).
  * `sync` (Boolean): Set to `true` to force a blocking synchronous XHR request (discouraged due to browser warnings). Defaults to `false` (high-performance async fetch).
  * `force` (Boolean): Force a network sync even if the 30-minute session lock is active.

```javascript
window.cookie_saver.init(
  '_ga',
  '_fbp',
  { name: 'ajs_anonymous_id', generate: true }, // Generates a GUID if missing
  { timeout: 800 } // Global options
);
```

---

### `cookie_saver.ready(callback)`
Queues a callback function to execute once NCCS completes its synchronization. This is critical for holding off third-party analytics scripts (like Segment or Amplitude) until client cookies are fully restored.

```javascript
window.cookie_saver.ready(function() {
  console.log("Cookies are restored. Safe to load Segment/GTM!");
  // Initialize your tracking tags here
});
```

---

### `cookie_saver.reset([cookieName])`
Clears cookies both client-side and server-side.
* **`cookieName` (String) [Optional]:** Resets the specified cookie and its mirrored backup. If omitted, resets **all** monitored cookies.

```javascript
// Hard reset everything
window.cookie_saver.reset();

// Reset just the segment anonymous ID
window.cookie_saver.reset('ajs_anonymous_id');
```

---

### `cookie_saver.generate(cookieName)`
Generates a fresh GUID (UUID v4) for a cookie immediately, saving it to both client and server storage.

```javascript
window.cookie_saver.generate('my_user_id');
```

---

### `cookie_saver.setConsent(boolean)`
Updates the user consent status. If set to `false`, NCCS will skip all network calls, ignore overrides, and immediately trigger ready callbacks.

```javascript
// Disable sync (e.g. CMP banner denied)
window.cookie_saver.setConsent(false);
```

---

### Global Variable Access
When initialization completes, all cookie values are mapped to the global **`window._nccs`** object. You can access values with their exact names or with leading underscores stripped:

```javascript
console.log(window._nccs['_ga']); // "GA1.2.1337..."
console.log(window._nccs['ga']);  // "GA1.2.1337..." (Convenient alias)
```

---

## ⚡ Integration Examples

### Segment Integration
To prevent Segment from generating a temporary capped anonymous ID before NCCS can restore the persistent server-side value, wrap the Segment initialization snippet in the `cookie_saver.ready()` callback:

```html
<script src="https://nccs.yourdomain.com/nccs.js"></script>
<script>
  // 1. Initialize NCCS
  window.cookie_saver.init(
    '_ga',
    { name: 'ajs_anonymous_id', generate: true } // Restore or generate anonymous ID
  );

  // 2. Wrap Segment Snippet in ready callback
  window.cookie_saver.ready(function() {
    // Segment snippet begins
    !function(){var i="analytics",analytics=window[i]=window[i]||[];...
    analytics.load("YOUR_WRITE_KEY");
    analytics.page();
    }();
  });
</script>
```

---

## 🚀 Deployment to Cloudflare

### 1. Wrangler CLI Deployment
1. Log in to your Cloudflare account:
   ```bash
   npx wrangler login
   ```
2. Deploy the worker:
   ```bash
   npm run deploy
   ```

### 2. Configure 1st-Party CNAME Mapping (Essential)
For cookie-writing to bypass ITP restrictions, your worker **must be served on a subdomain of your primary website**:
1. Log in to your **Cloudflare Dashboard**.
2. Navigate to **Workers & Pages > niks-crappy-cookie-keeper**.
3. Go to the **Settings** or **Triggers** tab.
4. Under **Custom Domains**, click **Add Custom Domain**.
5. Enter a subdomain on your site (e.g., `nccs.yourdomain.com`) and save.

---

## 🧪 Local Testing & Verification
NCCS includes an interactive dashboard and testing utilities for local development.

1. Start the worker dev server and static dashboard:
   ```bash
   npm run dev
   # (In a separate terminal)
   npm run serve
   ```
2. Open your browser and navigate to:  
   👉 **`http://localhost:8787/`**

*Note: Since browsers restrict cookies on `file://` protocols and block cross-origin cookies on mismatching ports, the worker automatically proxies the testing dashboard under its own same-origin port (`8787`) to ensure local cookie writing works perfectly.*
