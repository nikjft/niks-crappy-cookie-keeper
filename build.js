const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

async function build() {
    try {
        console.log('[Build] Reading nccs.js...');
        const clientCode = fs.readFileSync(path.join(__dirname, 'nccs.js'), 'utf8');

        console.log('[Build] Minifying client script...');
        const minified = await minify(clientCode, {
            mangle: {
                toplevel: false,
            },
            compress: {
                dead_code: true,
                drop_console: false, // Keep console logs for QA/debugging
            }
        });

        if (!minified.code) {
            throw new Error('Minification output was empty.');
        }

        // Write nccs.min.js
        fs.writeFileSync(path.join(__dirname, 'nccs.min.js'), minified.code, 'utf8');
        console.log('[Build] Successfully wrote nccs.min.js');

        // Read worker.js and replace the CLIENT_JS_CODE string
        console.log('[Build] Updating worker.js with minified client code...');
        const workerPath = path.join(__dirname, 'worker.js');
        let workerCode = fs.readFileSync(workerPath, 'utf8');

        const regex = /(const CLIENT_JS_CODE = `)([\s\S]*?)(`;)/;
        if (!regex.test(workerCode)) {
            throw new Error('Could not find CLIENT_JS_CODE definition in worker.js');
        }

        // Escape backticks and template interpolation tokens to embed cleanly in worker.js
        const escapedMinified = minified.code
            .replace(/\\/g, '\\\\')
            .replace(/`/g, '\\`')
            .replace(/\${/g, '\\${');

        workerCode = workerCode.replace(regex, `$1${escapedMinified}$3`);
        fs.writeFileSync(workerPath, workerCode, 'utf8');
        console.log('[Build] Successfully updated worker.js');

    } catch (error) {
        console.error('[Build] Build failed:', error);
        process.exit(1);
    }
}

build();
