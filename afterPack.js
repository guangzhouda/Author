/**
 * electron-builder afterPack hook
 * Copies node_modules from standalone into the packaged app resources,
 * because electron-builder filters out node_modules from extraResources.
 */
const path = require('path');
const fs = require('fs');

function copyDirSync(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else if (entry.isSymbolicLink()) {
            // Resolve symlinks and copy the actual file/dir
            const realPath = fs.realpathSync(srcPath);
            if (fs.statSync(realPath).isDirectory()) {
                copyDirSync(realPath, destPath);
            } else {
                fs.copyFileSync(realPath, destPath);
            }
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

exports.default = async function afterPack(context) {
    const appOutDir = context.appOutDir; // e.g. dist/win-unpacked
    const standaloneNodeModules = path.join(__dirname, '.next', 'standalone', 'node_modules');
    const targetNodeModules = path.join(appOutDir, 'resources', 'standalone', 'node_modules');

    console.log(`[afterPack] Copying node_modules from ${standaloneNodeModules}`);
    console.log(`[afterPack] To ${targetNodeModules}`);

    if (!fs.existsSync(standaloneNodeModules)) {
        console.error('[afterPack] ERROR: standalone node_modules not found!');
        return;
    }

    copyDirSync(standaloneNodeModules, targetNodeModules);
    console.log('[afterPack] node_modules copied successfully');
};
