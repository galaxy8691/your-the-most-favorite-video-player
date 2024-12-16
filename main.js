const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const crypto = require('crypto');
const { getVideoDurationInSeconds } = require('get-video-duration');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

let mainWindow;
let watcher;
let watchFolders = new Set();
let videoHistory = new Map(); // 存储视频播放历史
let globalTagCategories = new Map();  // 存储标签到分类的映射
let historicalTags = new Set();  // 存储所有历史使用过的标签

// 支持的视频格式
const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv'];

// 统一的设置文件路径
const settingsPath = app.isPackaged
  ? path.join(process.cwd(), 'settings.json')
  : path.join(__dirname, 'settings.json');
console.log('Settings file path:', settingsPath);

// 默认标签分类
const defaultTagCategories = {
    type: {
        title: '类型',
        defaultExpanded: true
    },
    content: {
        title: '内容',
        defaultExpanded: true
    },
    quality: {
        title: '质量',
        defaultExpanded: false
    },
    status: {
        title: '状态',
        defaultExpanded: false
    },
    other: {
        title: '其他',
        defaultExpanded: false
    }
};

// 计算文件的唯一标识
function getVideoId(filePath) {
    const stats = fs.statSync(filePath);
    const identifier = `${filePath}-${stats.size}-${stats.mtime.getTime()}`;
    return crypto.createHash('md5').update(identifier).digest('hex');
}

// 保存所有设置
function saveSettings(immediate = false) {
    try {
        // 检查目录是否可写
        try {
            fs.accessSync(path.dirname(settingsPath), fs.constants.W_OK);
        } catch (err) {
            console.error('Settings directory is not writable:', err);
            if (mainWindow) {
                mainWindow.webContents.send('settings-save-error', '无法保存设置文件，请确保程序有写入权限');
            }
            return;
        }

        // 获取标签过滤器状态，确保在窗口被销毁时会出错
        let activeTagFilters = [];
        if (mainWindow && !mainWindow.isDestroyed()) {
            activeTagFilters = mainWindow.webContents.activeTagFilters || [];
        }

        const settings = {
            watchFolders: Array.from(watchFolders),
            videoHistory: Array.from(videoHistory.entries()).reduce((obj, [key, value]) => {
                // 不再在每个视频中存储标签分类
                const { tagCategories, ...rest } = value;
                obj[key] = rest;
                return obj;
            }, {}),
            activeTagFilters: activeTagFilters,
            tagCategories: mainWindow ? mainWindow.tagCategories : defaultTagCategories,
            globalTagCategories: Object.fromEntries(globalTagCategories),  // 保存全局标签分类映射
            historicalTags: Array.from(historicalTags),  // 保存历史标签
            quickScanEnabled: mainWindow ? mainWindow.quickScanEnabled : false,
            lastUpdated: new Date().toISOString()
        };

        // 使用临时文件进行写入
        const tempPath = settingsPath + '.tmp';
        fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2), { encoding: 'utf8' });
        
        // 重命名临时文件为正式文件
        fs.renameSync(tempPath, settingsPath);
    } catch (err) {
        console.error('Error saving settings:', err);
    }
}

// 加载所有设置
function loadSettings() {
    try {
        let settings = {
            watchFolders: [],
            videoHistory: {},
            tagCategories: defaultTagCategories,
            globalTagCategories: {},
            historicalTags: [],
            quickScanEnabled: false
        };

        if (fs.existsSync(settingsPath)) {
            console.log('Loading settings from:', settingsPath);
            const loadedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            
            // 加载文件夹列表
            if (Array.isArray(loadedSettings.watchFolders)) {
                loadedSettings.watchFolders.forEach(folder => {
                    if (fs.existsSync(folder)) {
                        watchFolders.add(folder);
                    } else {
                        console.log('Folder no longer exists:', folder);
                    }
                });
            }

            // 加载标签分类
            if (loadedSettings.tagCategories) {
                settings.tagCategories = {
                    ...defaultTagCategories,
                    ...loadedSettings.tagCategories
                };
            }

            // 加载全局标签分类映射
            if (loadedSettings.globalTagCategories) {
                globalTagCategories = new Map(Object.entries(loadedSettings.globalTagCategories));
                settings.globalTagCategories = loadedSettings.globalTagCategories;
            }

            // 加载历史标签
            if (loadedSettings.historicalTags) {
                historicalTags = new Set(loadedSettings.historicalTags);
            }

            // 加载视频历史
            if (loadedSettings.videoHistory) {
                videoHistory = new Map(Object.entries(loadedSettings.videoHistory));
                // 从视频历史中恢复标签到历史标签集合
                videoHistory.forEach(video => {
                    if (video.tags) {
                        video.tags.forEach(tag => historicalTags.add(tag));
                    }
                });
            }

            // 加载快速扫描状态
            if (loadedSettings.quickScanEnabled !== undefined) {
                settings.quickScanEnabled = loadedSettings.quickScanEnabled;
            }
        } else {
            console.log('No settings file found, will create one when saving');
        }

        // 如果主窗口存在，立即更新标签分类和映射
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.tagCategories = settings.tagCategories;
            mainWindow.webContents.send('tag-categories-loaded', {
                categories: settings.tagCategories,
                tagMapping: Object.fromEntries(globalTagCategories),
                historicalTags: Array.from(historicalTags)  // 发送历史标签
            });
        }

        return settings;
    } catch (err) {
        console.error('Error loading settings:', err);
        return {
            watchFolders: [],
            videoHistory: {},
            tagCategories: defaultTagCategories,
            globalTagCategories: {},
            historicalTags: [],
            quickScanEnabled: false
        };
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: true,
            // 添加媒体访问权限
            defaultEncoding: 'UTF-8',
            enableWebAudio: true,
            allowRunningInsecureContent: false
        },
        minWidth: 800,
        minHeight: 600,
        show: false
    });

    // 设置媒体权限
    mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = ['media', 'mediaKeySystem'];
        if (allowedPermissions.includes(permission)) {
            callback(true);
        } else {
            callback(false);
        }
    });

    mainWindow.maximize();
    mainWindow.show();

    mainWindow.loadFile('index.html');
    
    // 加载设置并应用到窗口
    const settings = loadSettings();
    mainWindow.tagCategories = settings.tagCategories;
    mainWindow.quickScanEnabled = settings.quickScanEnabled;  // 恢复快速扫描状态

    // 发送标签分类到渲染进程
    mainWindow.webContents.on('did-finish-load', () => {
        // 发送标签分类和映射数据
        mainWindow.webContents.send('tag-categories-loaded', {
            categories: settings.tagCategories,
            tagMapping: Object.fromEntries(globalTagCategories),
            historicalTags: Array.from(historicalTags)  // 发送历史标签
        });

        // 如果有文件夹，使用保存的快速扫描状态进行扫描
        if (watchFolders.size > 0) {
            setupWatcher();
            watchFolders.forEach(folder => {
                mainWindow.webContents.send('folder-selected', folder);
            });
            updateVideoList(mainWindow.quickScanEnabled);
        }
    });

    return mainWindow;
}

// 递归扫描文件夹中的视频文件
async function scanVideoFiles(quickScan = false) {
    const videos = [];
    let totalFiles = 0;
    let processedFiles = 0;
    let isScanning = true;

    // 分块处理文件列表
    async function processFilesInChunks(files, folder, chunkSize = 50) {
        const chunks = [];
        for (let i = 0; i < files.length; i += chunkSize) {
            chunks.push(files.slice(i, i + chunkSize));
        }

        for (const chunk of chunks) {
            if (!isScanning) break;
            await Promise.all(chunk.map(file => processFile(file, folder)));
            // 给UI线程一个响应的机会
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    // 处理单个文件
    async function processFile(file, folder) {
        if (!isScanning) return;

        const filePath = path.join(folder, file);
        try {
            const stat = await fs.promises.stat(filePath);
            if (!isScanning) return;

            if (stat.isDirectory()) {
                const subFiles = await fs.promises.readdir(filePath);
                if (isScanning) {
                    await processFilesInChunks(subFiles, filePath);
                }
            } else if (stat.isFile()) {
                const ext = path.extname(file).toLowerCase();
                if (videoExtensions.includes(ext)) {
                    if (!quickScan) {
                        processedFiles++;
                        if (mainWindow && processedFiles % 10 === 0) {
                            mainWindow.webContents.send('scan-progress', {
                                current: processedFiles,
                                total: totalFiles,
                                currentFile: filePath
                            });
                        }
                    }

                    const videoId = getVideoId(filePath);
                    let videoInfo = videoHistory.get(videoId);

                    if (!videoInfo) {
                        videoInfo = {
                            watched: false,
                            watchTime: 0,
                            duration: 0,
                            lastPlayed: null,
                            firstSeen: new Date().toISOString(),
                            playCount: 0,
                            significantPlays: 0,
                            rating: 0,
                            tags: []
                        };
                        videoHistory.set(videoId, videoInfo);
                    }

                    if (!quickScan && !videoInfo.duration) {
                        try {
                            videoInfo.duration = await getVideoDurationInSeconds(filePath);
                            videoHistory.set(videoId, videoInfo);
                        } catch (err) {
                            console.error(`Error getting duration for ${filePath}:`, err);
                        }
                    }

                    videos.push({
                        id: videoId,
                        path: filePath,
                        folder: folder,
                        filename: file,
                        watched: videoInfo.watched,
                        watchTime: videoInfo.watchTime,
                        duration: videoInfo.duration,
                        lastPlayed: videoInfo.lastPlayed,
                        firstSeen: videoInfo.firstSeen,
                        isNew: !videoInfo.watched,
                        playCount: videoInfo.playCount,
                        significantPlays: videoInfo.significantPlays,
                        rating: videoInfo.rating,
                        tags: videoInfo.tags || []
                    });
                }
            }
        } catch (err) {
            console.error(`Error processing file ${filePath}:`, err);
        }
    }

    // 计算总文件数
    async function countFiles(folder) {
        try {
            const files = await fs.promises.readdir(folder);
            await Promise.all(files.map(async file => {
                const filePath = path.join(folder, file);
                try {
                    const stat = await fs.promises.stat(filePath);
                    if (stat.isDirectory()) {
                        await countFiles(filePath);
                    } else if (stat.isFile()) {
                        const ext = path.extname(file).toLowerCase();
                        if (videoExtensions.includes(ext)) {
                            totalFiles++;
                        }
                    }
                } catch (err) {
                    console.error(`Error accessing file ${filePath}:`, err);
                }
            }));
        } catch (err) {
            console.error(`Error reading directory ${folder}:`, err);
        }
    }

    try {
        if (!quickScan) {
            await Promise.all([...watchFolders].map(folder => countFiles(folder)));
        }

        for (const folder of watchFolders) {
            if (!isScanning) break;
            try {
                const files = await fs.promises.readdir(folder);
                await processFilesInChunks(files, folder);
            } catch (err) {
                console.error(`Error scanning folder ${folder}:`, err);
            }
        }

        return videos;
    } finally {
        isScanning = false;
        ipcMain.removeAllListeners('cancel-scan');
    }
}

// 更新设置文件监视
function setupWatcher() {
    if (watcher) {
        watcher.close();
    }

    if (watchFolders.size === 0) {
        return;
    }

    // 修改 chokidar 配置
    watcher = chokidar.watch([...watchFolders], {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        recursive: true,
        ignoreInitial: true,  // 改为 true，避免重复扫描
        awaitWriteFinish: {   // 添加文件写入完成检测
            stabilityThreshold: 2000,
            pollInterval: 100
        },
        usePolling: false,    // 禁用轮询以提高性能
        depth: 10             // 限制递归深度
    });

    let debounceTimeout;
    const debouncedUpdate = () => {
        if (debounceTimeout) {
            clearTimeout(debounceTimeout);
        }
        debounceTimeout = setTimeout(() => {
            const quickScan = mainWindow && mainWindow.quickScanEnabled;
            updateVideoList(quickScan);
        }, 1000);
    };

    watcher
        .on('add', filePath => {
            const ext = path.extname(filePath).toLowerCase();
            if (videoExtensions.includes(ext)) {
                debouncedUpdate();
            }
        })
        .on('unlink', filePath => {
            const ext = path.extname(filePath).toLowerCase();
            if (videoExtensions.includes(ext)) {
                debouncedUpdate();
            }
        })
        .on('addDir', debouncedUpdate)
        .on('unlinkDir', debouncedUpdate);
}

// 更新视频列表
async function updateVideoList(quickScan = false) {
    if (mainWindow) {
        mainWindow.webContents.send('scan-start');
    }
    
    try {
        const videos = await scanVideoFiles(quickScan);
        if (mainWindow) {
            mainWindow.webContents.send('update-video-list', videos);
        }
    } catch (err) {
        console.error('Error updating video list:', err);
        if (mainWindow) {
            mainWindow.webContents.send('scan-error', err.message);
        }
    } finally {
        if (mainWindow) {
            mainWindow.webContents.send('scan-complete');
        }
    }
}

// 设置 ffmpeg 路径
process.env.FFMPEG_PATH = app.isPackaged
  ? path.join(process.resourcesPath, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  : ffmpeg.path;

app.whenReady().then(() => {
    // 先建口
    mainWindow = createWindow();
    
    // 处理标签过滤器状态请求
    ipcMain.on('request-tag-filters', (event) => {
        try {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            event.reply('tag-filters-loaded', settings.activeTagFilters || []);
        } catch (err) {
            console.error('Error loading tag filters:', err);
            event.reply('tag-filters-loaded', []);
        }
    });

    // 保存标签过滤器态
    ipcMain.on('save-tag-filters', (event, filters) => {
        if (mainWindow) {
            mainWindow.webContents.activeTagFilters = filters;
        }
    });

    // 处理视频播放进度新
    ipcMain.on('update-video-progress', (event, { videoId, currentTime, duration }) => {
        const videoInfo = videoHistory.get(videoId) || {
            watched: false,
            watchTime: 0,
            duration: 0,
            lastPlayed: null,
            firstSeen: new Date().toISOString(),
            playCount: 0,
            significantPlays: 0,
            recentPlayCounted: false,
            rating: 0,
            playStartTime: null  // 添加播放开始时间字段
        };

        // 更新最长播放时间
        videoInfo.watchTime = Math.max(videoInfo.watchTime, currentTime);
        videoInfo.duration = duration;
        videoInfo.lastPlayed = new Date().toISOString();
        
        // 检查是否需要增加播放次数
        const now = Date.now();
        const playDuration = videoInfo.playStartTime ? (now - videoInfo.playStartTime) / 1000 : 0;  // 转换为秒
        const isLongEnough = playDuration >= 120;  // 本次播放超过2分钟
        const isAlmostComplete = duration > 0 && currentTime >= duration * 0.98;  // 播放完成98%
        
        if (!videoInfo.recentPlayCounted && (isLongEnough || isAlmostComplete)) {
            videoInfo.playCount++;
            videoInfo.recentPlayCounted = true;  // 标记本次播放次数
            videoInfo.significantPlays++;  // 同时增加有效播放次数
            videoInfo.recentSignificantPlay = true;  // 标记本次有效播放已计数
            
            // 通知渲染进程更新播放次数
            mainWindow.webContents.send('video-state-updated', {
                videoId,
                updates: {
                    playCount: videoInfo.playCount,
                    significantPlays: videoInfo.significantPlays
                }
            });
        }

        videoHistory.set(videoId, videoInfo);
    });

    // 处理视频开始播放
    ipcMain.on('video-started', (event, { videoId }) => {
        const videoInfo = videoHistory.get(videoId);
        if (videoInfo) {
            const updates = {};
            
            if (!videoInfo.watched) {
                videoInfo.watched = true;  // 只要开始播放就标记为已看
                updates.watched = true;
                updates.isNew = false;
            }
            
            // 重置放计数标记并记录开始时间
            videoInfo.recentPlayCounted = false;
            videoInfo.recentSignificantPlay = false;
            videoInfo.playStartTime = Date.now();  // 记录播放开始时间
            
            videoHistory.set(videoId, videoInfo);
        }
    });

    // 处理视频元数据加载完成
    ipcMain.on('video-metadata-loaded', (event, { videoId, duration }) => {
        const videoInfo = videoHistory.get(videoId);
        if (videoInfo) {
            videoInfo.duration = duration;
            videoHistory.set(videoId, videoInfo);
            
            // 通知渲染进程更新视频状态
            mainWindow.webContents.send('video-state-updated', {
                videoId,
                updates: {
                    duration: duration
                }
            });
        }
    });

    ipcMain.on('select-folder', async (event) => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            event.reply('folder-selected', result.filePaths[0]);
        }
    });

    ipcMain.on('add-folder', (event, { folder, quickScan }) => {
        watchFolders.add(folder);
        // 保存快速扫描状态
        if (mainWindow) {
            mainWindow.quickScanEnabled = quickScan;
        }
        setupWatcher();
        updateVideoList(quickScan);
        saveSettings();
    });

    ipcMain.on('remove-folder', (event, folder) => {
        watchFolders.delete(folder);
        setupWatcher();
        // 移除文件夹时也保持快速扫描模式
        const quickScan = mainWindow && mainWindow.quickScanEnabled;
        updateVideoList(quickScan);
        saveSettings();
    });

    // 处理视频评分更新
    ipcMain.on('update-video-rating', (event, { videoId, rating }) => {
        const videoInfo = videoHistory.get(videoId);
        if (videoInfo) {
            videoInfo.rating = rating;
            videoHistory.set(videoId, videoInfo);
            
            // 通知渲染进程更新评分
            mainWindow.webContents.send('video-state-updated', {
                videoId,
                updates: {
                    rating: rating
                }
            });
        }
    });

    // 处理添加标签
    ipcMain.on('add-tag', (event, { videoId, tag, category }) => {
        const videoInfo = videoHistory.get(videoId);
        if (videoInfo) {
            if (!videoInfo.tags) {
                videoInfo.tags = [];
            }
            if (!videoInfo.tags.includes(tag)) {
                videoInfo.tags.push(tag);
                // 更新全局标签映射和历史标签
                globalTagCategories.set(tag, category || 'other');
                historicalTags.add(tag);  // 添加到历史标签
                videoHistory.set(videoId, videoInfo);
                
                // 通知渲染进程更新视频状态和标签分类
                mainWindow.webContents.send('video-state-updated', {
                    videoId,
                    updates: {
                        tags: videoInfo.tags
                    }
                });

                // 发送更新后的标签映射到渲染进程
                mainWindow.webContents.send('tag-categories-loaded', {
                    categories: mainWindow.tagCategories,
                    tagMapping: Object.fromEntries(globalTagCategories),
                    historicalTags: Array.from(historicalTags)  // 发送历史标签
                });

                // 保存设置
                saveSettings(true);
            }
        }
    });

    // 处理移除标签
    ipcMain.on('remove-tag', (event, { videoId, tag }) => {
        const videoInfo = videoHistory.get(videoId);
        if (videoInfo && videoInfo.tags) {
            const index = videoInfo.tags.indexOf(tag);
            if (index !== -1) {
                videoInfo.tags.splice(index, 1);
                if (videoInfo.tagCategories) {
                    delete videoInfo.tagCategories[tag];
                }
                videoHistory.set(videoId, videoInfo);
                
                // 通知渲染进程更新视频状态
                mainWindow.webContents.send('video-state-updated', {
                    videoId,
                    updates: {
                        tags: videoInfo.tags,
                        tagCategories: videoInfo.tagCategories
                    }
                });
            }
        }
    });

    // 处理标签分类保存
    ipcMain.on('save-tag-categories', (event, categories) => {
        if (mainWindow) {
            // 确保保留"其他"分类
            if (!categories.other) {
                categories.other = defaultTagCategories.other;
            }
            mainWindow.tagCategories = categories;
            
            // 标记有未保存的更改
            hasUnsavedChanges = true;
            // 立即保存设置
            saveSettings(true);
        }
    });

    // 处理标签分类更新
    ipcMain.on('update-tag-category', (event, { tag, category }) => {
        // 更新全局标签分类映射
        globalTagCategories.set(tag, category);
        
        // 通知渲染进程更新标签分类
        mainWindow.webContents.send('tag-categories-updated', {
            tag,
            category
        });
        
        // 标记有未保存的更改
        hasUnsavedChanges = true;
        // 立即保存设置
        saveSettings(true);
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            mainWindow = createWindow();
        }
    });
});

// 添加保存点
let hasUnsavedChanges = false;

// 定期检查是否需要保存（作为备份）
setInterval(() => {
    if (hasUnsavedChanges) {
        saveSettings();
        hasUnsavedChanges = false;
    }
}, 300000); // 每5分钟检查一次

// 程序退出前保存
app.on('before-quit', () => {
    saveSettings();
});

// 处理意外关闭
app.on('window-all-closed', () => {
    saveSettings();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});