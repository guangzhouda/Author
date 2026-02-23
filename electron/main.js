const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');
const fs = require('fs');

// 日志文件 - 写到用户桌面方便查看
const logFile = path.join(app.getPath('desktop'), 'author-debug.log');
function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    console.log(msg);
    try { fs.appendFileSync(logFile, line); } catch (e) { }
}

// 防止多开
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    log('Another instance is running, quitting.');
    app.quit();
    process.exit(0);
}

let mainWindow;
let serverProcess;

const isDev = process.argv.includes('--dev');
const PORT = 3000;
let loadRetries = 0;
const MAX_LOAD_RETRIES = 10;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: 'Author — AI-Powered Creative Writing',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        autoHideMenuBar: true,
        show: false,
    });

    mainWindow.loadURL(`http://localhost:${PORT}`);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        // F12 打开开发者工具
        mainWindow.webContents.on('before-input-event', (event, input) => {
            if (input.key === 'F12') {
                mainWindow.webContents.toggleDevTools();
            }
        });
    });

    // 加载失败时有限次重试
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        loadRetries++;
        log(`Load failed (${loadRetries}/${MAX_LOAD_RETRIES}): ${errorDescription}`);
        if (loadRetries < MAX_LOAD_RETRIES) {
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.loadURL(`http://localhost:${PORT}`);
                }
            }, 2000);
        } else {
            mainWindow.show();
            dialog.showErrorBox(
                'Author 启动失败',
                '无法连接到内置服务器。\n\n' +
                '查看日志: ' + logFile
            );
        }
    });

    mainWindow.webContents.on('did-finish-load', () => {
        log('Page loaded successfully');
        loadRetries = 0;
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http') && !url.includes('localhost')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function waitForServer(port, maxRetries = 30) {
    return new Promise((resolve) => {
        let retries = 0;
        const check = () => {
            const req = http.get(`http://localhost:${port}`, (res) => {
                resolve(true);
            });
            req.on('error', () => {
                retries++;
                if (retries >= maxRetries) {
                    resolve(false);
                } else {
                    setTimeout(check, 1000);
                }
            });
            req.setTimeout(2000, () => {
                req.destroy();
                retries++;
                if (retries >= maxRetries) {
                    resolve(false);
                } else {
                    setTimeout(check, 1000);
                }
            });
        };
        check();
    });
}

function startNextServer() {
    return new Promise(async (resolve) => {
        if (isDev) {
            log('Dev mode — connecting to existing dev server...');
            resolve(true);
            return;
        }

        const isPackaged = app.isPackaged;
        let standaloneDir;

        if (isPackaged) {
            standaloneDir = path.join(process.resourcesPath, 'standalone');
        } else {
            standaloneDir = path.join(__dirname, '..', '.next', 'standalone');
        }

        const serverPath = path.join(standaloneDir, 'server.js');

        log(`isPackaged: ${isPackaged}`);
        log(`resourcesPath: ${process.resourcesPath}`);
        log(`standaloneDir: ${standaloneDir}`);
        log(`serverPath: ${serverPath}`);
        log(`serverExists: ${fs.existsSync(serverPath)}`);

        // 检查关键目录
        const staticDir = path.join(standaloneDir, '.next', 'static');
        const publicDir = path.join(standaloneDir, 'public');
        log(`staticDir exists: ${fs.existsSync(staticDir)}`);
        log(`publicDir exists: ${fs.existsSync(publicDir)}`);

        if (!fs.existsSync(serverPath)) {
            const msg = '找不到 server.js\n路径: ' + serverPath;
            log('ERROR: ' + msg);
            dialog.showErrorBox('Author 启动失败', msg);
            resolve(false);
            return;
        }

        log('Starting Next.js server via fork...');

        serverProcess = fork(serverPath, [], {
            cwd: standaloneDir,
            env: {
                ...process.env,
                NODE_ENV: 'production',
                PORT: String(PORT),
                HOSTNAME: 'localhost',
                ELECTRON_RUN_AS_NODE: '1',
            },
            stdio: 'pipe',
        });

        serverProcess.stdout.on('data', (data) => {
            log('[Next.js stdout] ' + data.toString().trim());
        });

        serverProcess.stderr.on('data', (data) => {
            log('[Next.js stderr] ' + data.toString().trim());
        });

        serverProcess.on('error', (err) => {
            log('[Server process error] ' + err.message);
        });

        serverProcess.on('close', (code) => {
            log('[Server process closed] code: ' + code);
        });

        const ready = await waitForServer(PORT);
        log(`Server ready: ${ready}`);
        resolve(ready);
    });
}

app.whenReady().then(async () => {
    log('=== Author Desktop Starting ===');
    log(`Electron version: ${process.versions.electron}`);
    log(`Node version: ${process.versions.node}`);
    log(`Platform: ${process.platform} ${process.arch}`);
    log(`App path: ${app.getAppPath()}`);
    log(`Exe path: ${process.execPath}`);

    await startNextServer();
    createWindow();
});

app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

app.on('window-all-closed', () => {
    if (serverProcess) serverProcess.kill();
    app.quit();
});

app.on('before-quit', () => {
    if (serverProcess) serverProcess.kill();
});
