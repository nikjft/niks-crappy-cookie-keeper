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

        // Locate boundary of CLIENT_JS_CODE by tracing backwards from the export default marker
        const startMarker = 'const CLIENT_JS_CODE = `';
        const exportMarker = 'export default {';
        const closingMarker = '`;';

        const startIndex = workerCode.indexOf(startMarker);
        if (startIndex === -1) {
            throw new Error('Could not find start of CLIENT_JS_CODE in worker.js');
        }

        const exportIndex = workerCode.indexOf(exportMarker);
        if (exportIndex === -1) {
            throw new Error('Could not find export default in worker.js');
        }

        const endIndex = workerCode.lastIndexOf(closingMarker, exportIndex);
        if (endIndex === -1 || endIndex < startIndex + startMarker.length) {
            throw new Error('Could not find closing `; of CLIENT_JS_CODE in worker.js');
        }

        // Escape backticks and template interpolation tokens to embed cleanly in worker.js
        const escapedMinified = minified.code
            .replace(/\\/g, '\\\\')
            .replace(/`/g, '\\`')
            .replace(/\${/g, '\\${');

        // Construct the new worker code
        const updatedWorkerCode = 
            workerCode.substring(0, startIndex + startMarker.length) +
            escapedMinified +
            workerCode.substring(endIndex);

        fs.writeFileSync(workerPath, updatedWorkerCode, 'utf8');
        console.log('[Build] Successfully updated worker.js');

    } catch (error) {
        console.error('[Build] Build failed:', error);
        process.exit(1);
    }
}

build();
