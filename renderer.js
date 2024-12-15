const { ipcRenderer } = require('electron');
const path = require('path');

let videoList = [];
let watchFolders = new Set();
let currentVideoId = null;

// 加载状态控制
function showLoading(message) {
    const overlay = document.querySelector('.loading-overlay');
    const text = overlay.querySelector('.loading-text');
    const progress = overlay.querySelector('.loading-progress');
    text.textContent = message;
    progress.textContent = '';
    overlay.classList.add('active');
}

function updateLoadingProgress(current, total) {
    const progress = document.querySelector('.loading-progress');
    progress.textContent = `${current} / ${total}`;
}

function hideLoading() {
    const overlay = document.querySelector('.loading-overlay');
    overlay.classList.remove('active');
}

// 初始化视频播放器
const videoPlayer = document.getElementById('video-player');

// 音频错误处理
videoPlayer.addEventListener('error', (e) => {
    console.error('Video Error:', e);
    document.getElementById('current-video-info').textContent = 
        '视频播放出错，请尝试其他视频';
});

// 确保音量正
videoPlayer.volume = 1.0;

// 跟踪视频播放进度
videoPlayer.addEventListener('timeupdate', () => {
    if (currentVideoId) {
        ipcRenderer.send('update-video-progress', {
            videoId: currentVideoId,
            currentTime: videoPlayer.currentTime,
            duration: videoPlayer.duration
        });
    }
});

// 视频加载完成后自动播放
videoPlayer.addEventListener('loadedmetadata', () => {
    if (currentVideoId) {
        // 通知视频开始播放
        ipcRenderer.send('video-started', {
            videoId: currentVideoId
        });
        
        ipcRenderer.send('video-metadata-loaded', {
            videoId: currentVideoId,
            duration: videoPlayer.duration
        });
    }
    videoPlayer.play().catch(e => {
        console.error('Autoplay failed:', e);
    });
});

// 添加文件夹按钮事件
document.getElementById('add-folder').addEventListener('click', () => {
    showLoading('正在选择文件夹...');
    ipcRenderer.send('select-folder');
});

// 更新文件夹列表显示
function updateFolderList() {
    const container = document.getElementById('folder-container');
    container.innerHTML = '';
    
    watchFolders.forEach(folderPath => {
        const folderItem = document.createElement('div');
        folderItem.className = 'folder-item';
        
        const pathText = document.createElement('div');
        pathText.className = 'folder-path';
        pathText.textContent = folderPath;
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-folder';
        removeBtn.textContent = '移除';
        removeBtn.onclick = () => {
            watchFolders.delete(folderPath);
            updateFolderList();
            ipcRenderer.send('remove-folder', folderPath);
        };
        
        folderItem.appendChild(pathText);
        folderItem.appendChild(removeBtn);
        container.appendChild(folderItem);
    });
}

// 获取相对路径
function getRelativePath(videoPath, folderPath) {
    const relativePath = path.relative(folderPath, path.dirname(videoPath));
    // 如果视频就在监视文件夹中，显示所在文件夹名称
    if (relativePath === '') {
        return path.basename(folderPath);
    }
    // 否则显示完整的相对路径
    return path.join(path.basename(folderPath), relativePath);
}

// 格式化时间
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString();
}

// 格式化时间
function formatDuration(seconds) {
    if (!seconds) return '未时长';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// 更新视频列表显示
function updateVideoList(maintainOrder = false) {
    const container = document.getElementById('video-list');
    container.innerHTML = '';
    
    if (videoList.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-message';
        emptyMessage.textContent = '暂无视频文件';
        container.appendChild(emptyMessage);
        return;
    }
    
    // 在初始加载时进行排序
    if (!maintainOrder) {
        videoList.sort((a, b) => {
            if (a.isNew !== b.isNew) {
                return b.isNew - a.isNew; // 新视频排在前面
            }
            return a.filename.localeCompare(b.filename);
        });
    }
    
    videoList.forEach(video => {
        const videoItem = document.createElement('div');
        videoItem.className = 'video-item' + (video.isNew ? ' new-video' : '') + (video.watched ? ' watched' : '');
        videoItem.setAttribute('data-video-id', video.id); // 添加视频ID属性
        
        const title = document.createElement('div');
        title.className = 'video-item-title';
        title.textContent = path.basename(video.path) + (video.isNew ? ' (新)' : '');
        
        const info = document.createElement('div');
        info.className = 'video-item-info';
        const relativePath = getRelativePath(video.path, video.folder);
        let infoText = `位置: ${relativePath}`;
        if (video.duration) {
            infoText += `\n时长: ${formatDuration(video.duration)}`;
        }
        if (video.lastPlayed) {
            infoText += `\n上次播放: ${formatDate(video.lastPlayed)}`;
        }
        if (video.watchTime > 0) {
            const progress = video.duration ? Math.round((video.watchTime / video.duration) * 100) : 0;
            infoText += `\n播放进度: ${progress}% (${formatDuration(video.watchTime)})`;
        }
        if (video.playCount > 0) {
            infoText += `\n播放次数: ${video.playCount}次`;
            if (video.significantPlays > 0) {
                infoText += ` (完整观看${video.significantPlays}次)`;
            }
        }
        info.textContent = infoText;
        
        videoItem.appendChild(title);
        videoItem.appendChild(info);
        
        videoItem.onclick = () => {
            document.querySelectorAll('.video-item').forEach(item => {
                item.classList.remove('active');
            });
            
            videoItem.classList.add('active');
            
            currentVideoId = video.id;
            videoPlayer.src = video.path;
            videoPlayer.currentTime = video.watchTime || 0; // 从上次播放位置继续
            videoPlayer.play();
            
            document.getElementById('current-video-info').textContent = 
                `正在播放: ${path.basename(video.path)} (${relativePath})`;
        };
        
        container.appendChild(videoItem);
    });
}

// 更新单个视频的状态
function updateVideoState(videoId, updates) {
    const videoItem = document.querySelector(`.video-item[data-video-id="${videoId}"]`);
    if (videoItem) {
        // 更新视频列表中的对应项
        const videoIndex = videoList.findIndex(v => v.id === videoId);
        if (videoIndex !== -1) {
            Object.assign(videoList[videoIndex], updates);
            
            // 更新UI显示
            if (updates.watched) {
                videoItem.classList.add('watched');
                videoItem.classList.remove('new-video');
                const title = videoItem.querySelector('.video-item-title');
                title.textContent = title.textContent.replace(' (新)', '');
            }

            // 更新播放次数显示
            const info = videoItem.querySelector('.video-item-info');
            const video = videoList[videoIndex];
            const relativePath = getRelativePath(video.path, video.folder);
            let infoText = `位置: ${relativePath}`;
            if (video.duration) {
                infoText += `\n时长: ${formatDuration(video.duration)}`;
            }
            if (video.lastPlayed) {
                infoText += `\n上次播放: ${formatDate(video.lastPlayed)}`;
            }
            if (video.watchTime > 0) {
                const progress = video.duration ? Math.round((video.watchTime / video.duration) * 100) : 0;
                infoText += `\n播放进度: ${progress}% (${formatDuration(video.watchTime)})`;
            }
            if (video.playCount > 0) {
                infoText += `\n播放次数: ${video.playCount}次`;
                if (video.significantPlays > 0) {
                    infoText += ` (完整观看${video.significantPlays}次)`;
                }
            }
            info.textContent = infoText;
        }
    }
}

// 接收文件夹选择结果
ipcRenderer.on('folder-selected', (event, folderPath) => {
    if (!watchFolders.has(folderPath)) {
        showLoading('正在扫描视频文件夹...');
        watchFolders.add(folderPath);
        updateFolderList();
        ipcRenderer.send('add-folder', folderPath);
    } else {
        hideLoading();
    }
});

// 接收视频列表更新
ipcRenderer.on('update-video-list', (event, videos) => {
    videoList = videos;
    // 初始加载时进行排序
    updateVideoList(false);
    hideLoading();
});

// 接收视频状态更新
ipcRenderer.on('video-state-updated', (event, { videoId, updates }) => {
    updateVideoState(videoId, updates);
});

// 接收扫描进度更新
ipcRenderer.on('scan-progress', (event, { current, total, currentFile }) => {
    const progress = document.querySelector('.loading-progress');
    progress.textContent = `正在处理: ${current} / ${total}\n${path.basename(currentFile)}`;
}); 