const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const crypto = require('crypto');
const { getVideoDurationInSeconds } = require('get-video-duration');

let mainWindow;
let watcher;
let watchFolders = new Set();
let videoHistory = new Map(); // 存储视频播放历史

// 支持的视频格式
const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv'];

// 统一的设置文件路径
const settingsPath = path.join(__dirname, 'settings.json');

// 默认标签分类
const defaultTagCategories = {
    type: {
        title: '类型',
        defaultExpanded: true
    },
    actor: {
        title: '演员',
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
function saveSettings() {
    try {
        // 获取标签过滤器状态，确保在窗口被销毁时不会出错
        let activeTagFilters = [];
        if (mainWindow && !mainWindow.isDestroyed()) {
            activeTagFilters = mainWindow.webContents.activeTagFilters || [];
        }

        const settings = {
            watchFolders: Array.from(watchFolders),
            videoHistory: Array.from(videoHistory.entries()).reduce((obj, [key, value]) => {
                obj[key] = value;
                return obj;
            }, {}),
            activeTagFilters: activeTagFilters,
            tagCategories: mainWindow ? mainWindow.tagCategories : defaultTagCategories,
            quickScanEnabled: mainWindow ? mainWindow.quickScanEnabled : false,  // 保存快速扫描状态
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { encoding: 'utf8' });
        console.log('Settings saved to:', settingsPath);
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
            quickScanEnabled: false  // 添加快速扫描状态的默认值
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

            // 加载视频历史
            if (loadedSettings.videoHistory) {
                videoHistory = new Map(Object.entries(loadedSettings.videoHistory));
            }

            // 加载标签分类
            if (loadedSettings.tagCategories) {
                settings.tagCategories = loadedSettings.tagCategories;
            }

            // 加载快速扫描状态
            if (loadedSettings.quickScanEnabled !== undefined) {
                settings.quickScanEnabled = loadedSettings.quickScanEnabled;
            }
        } else {
            console.log('No settings file found, will create one when saving');
        }

        return settings;
    } catch (err) {
        console.error('Error loading settings:', err);
        return {
            watchFolders: [],
            videoHistory: {},
            tagCategories: defaultTagCategories,
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
        mainWindow.webContents.send('tag-categories-loaded', mainWindow.tagCategories);
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
    let videos = [];
    let totalFiles = 0;
    let processedFiles = 0;
    
    async function scanFolder(folder) {
        try {
            const files = fs.readdirSync(folder);
            for (const file of files) {
                const filePath = path.join(folder, file);
                const stat = fs.statSync(filePath);
                
                if (stat.isDirectory()) {
                    await scanFolder(filePath);
                } else if (stat.isFile()) {
                    const ext = path.extname(file).toLowerCase();
                    if (videoExtensions.includes(ext)) {
                        const videoId = getVideoId(filePath);
                        let videoInfo = videoHistory.get(videoId);
                        
                        // 如果没有历史记录，创建一个新的记录
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
                        
                        // 只在非快速扫描模式下更新度和获取时长
                        if (!quickScan) {
                            processedFiles++;
                            mainWindow.webContents.send('scan-progress', {
                                current: processedFiles,
                                total: totalFiles,
                                currentFile: filePath
                            });
                            
                            // 只在非快速扫描模式下获取时长
                            if (!videoInfo.duration) {
                                try {
                                    videoInfo.duration = await getVideoDurationInSeconds(filePath);
                                    videoHistory.set(videoId, videoInfo);
                                    saveSettings();
                                } catch (err) {
                                    console.error(`Error getting duration for ${filePath}:`, err);
                                }
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
            }
        } catch (err) {
            console.error(`Error scanning folder ${folder}:`, err);
        }
    }

    // 只在非快速扫描模式下计算总文件数
    if (!quickScan) {
        function countFiles(folder) {
            try {
                const files = fs.readdirSync(folder);
                for (const file of files) {
                    const filePath = path.join(folder, file);
                    const stat = fs.statSync(filePath);
                    
                    if (stat.isDirectory()) {
                        countFiles(filePath);
                    } else if (stat.isFile()) {
                        const ext = path.extname(file).toLowerCase();
                        if (videoExtensions.includes(ext)) {
                            totalFiles++;
                        }
                    }
                }
            } catch (err) {
                console.error(`Error counting files in ${folder}:`, err);
            }
        }
        
        // 扫描所有文件夹以计算总数
        for (const folder of watchFolders) {
            countFiles(folder);
        }
    }

    for (const folder of watchFolders) {
        await scanFolder(folder);
    }

    return videos;
}

// 更新设置文件监视
function setupWatcher() {
    if (watcher) {
        watcher.close();
    }

    if (watchFolders.size === 0) {
        return;
    }

    watcher = chokidar.watch([...watchFolders], {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        recursive: true,
        ignoreInitial: false
    });

    watcher
        .on('add', filePath => {
            const ext = path.extname(filePath).toLowerCase();
            if (videoExtensions.includes(ext)) {
                // 文件变化时也要保持快速扫描模式
                const quickScan = mainWindow && mainWindow.quickScanEnabled;
                updateVideoList(quickScan);
            }
        })
        .on('unlink', filePath => {
            const ext = path.extname(filePath).toLowerCase();
            if (videoExtensions.includes(ext)) {
                // 文件变化时也要保持快速扫描模式
                const quickScan = mainWindow && mainWindow.quickScanEnabled;
                updateVideoList(quickScan);
            }
        })
        .on('addDir', () => {
            // 文件夹变化时也要保持快速扫描模式
            const quickScan = mainWindow && mainWindow.quickScanEnabled;
            updateVideoList(quickScan);
        })
        .on('unlinkDir', () => {
            // 文件夹变化时也要保持快速扫描模式
            const quickScan = mainWindow && mainWindow.quickScanEnabled;
            updateVideoList(quickScan);
        });
}

// 更新视频列表
async function updateVideoList(quickScan = false) {
    const videos = await scanVideoFiles(quickScan);
    if (mainWindow) {
        mainWindow.webContents.send('update-video-list', videos);
    }
}

app.whenReady().then(() => {
    // 先创建口
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
            saveSettings();
        }
    });

    // 处理视频播放进度更新
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
            videoInfo.recentPlayCounted = true;  // 标记本次播放已计数
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
        saveSettings();
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
            
            // 重置���放计数标记并记录开始时间
            videoInfo.recentPlayCounted = false;
            videoInfo.recentSignificantPlay = false;
            videoInfo.playStartTime = Date.now();  // 记录播放开始时间
            
            videoHistory.set(videoId, videoInfo);
            saveSettings();

            // 通知渲染进程更新视频状态
            if (Object.keys(updates).length > 0) {
                mainWindow.webContents.send('video-state-updated', {
                    videoId,
                    updates
                });
            }
        }
    });

    // 处理视频元数据加载完成
    ipcMain.on('video-metadata-loaded', (event, { videoId, duration }) => {
        const videoInfo = videoHistory.get(videoId);
        if (videoInfo) {
            videoInfo.duration = duration;
            videoHistory.set(videoId, videoInfo);
            saveSettings();
            
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
        // 移除文件夹时也要保持快速扫描模式
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
            saveSettings();

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
            if (!videoInfo.tagCategories) {
                videoInfo.tagCategories = {};
            }
            if (!videoInfo.tags.includes(tag)) {
                videoInfo.tags.push(tag);
                videoInfo.tagCategories[tag] = category || 'other';
                videoHistory.set(videoId, videoInfo);
                saveSettings();

                // 通知渲染进程更新标签
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
                saveSettings();

                // 通知渲染进程更新标签
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

    // 处理标签分类更新
    ipcMain.on('update-tag-category', (event, { videoId, tag, category }) => {
        const videoInfo = videoHistory.get(videoId);
        if (videoInfo) {
            if (!videoInfo.tagCategories) {
                videoInfo.tagCategories = {};
            }
            videoInfo.tagCategories[tag] = category;
            videoHistory.set(videoId, videoInfo);
            saveSettings();

            // 通知渲染进程更新标签
            mainWindow.webContents.send('video-state-updated', {
                videoId,
                updates: {
                    tagCategories: videoInfo.tagCategories
                }
            });
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
            saveSettings();
            // 通知所有渲染进程更新标签分类
            mainWindow.webContents.send('tag-categories-loaded', categories);
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            mainWindow = createWindow();
        }
    });
});

// 程序退出前保存设置
app.on('before-quit', () => {
    saveSettings();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});