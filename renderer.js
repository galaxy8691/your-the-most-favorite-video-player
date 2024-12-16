const { ipcRenderer } = require('electron');
const path = require('path');

let videoList = [];
let watchFolders = new Set();
let currentVideoId = null;
let activeTagFilters = [];
let randomPlayEnabled = false;

// 加载状态控制
function showLoading(message) {
    const overlay = document.querySelector('.loading-overlay');
    const text = overlay.querySelector('.loading-text');
    const progress = overlay.querySelector('.loading-progress');
    
    // 确保有取消按钮
    let cancelBtn = overlay.querySelector('.cancel-scan-button');
    if (!cancelBtn) {
        cancelBtn = document.createElement('button');
        cancelBtn.className = 'cancel-scan-button';
        cancelBtn.textContent = '取消扫描';
        cancelBtn.onclick = () => {
            ipcRenderer.send('cancel-scan');
            hideLoading();
        };
        overlay.appendChild(cancelBtn);
    }
    
    text.textContent = message;
    progress.textContent = '';
    overlay.classList.add('active');
    // 移除阻塞样式
    overlay.style.pointerEvents = 'none';
    // 只让取消按钮可以点击
    cancelBtn.style.pointerEvents = 'auto';
}

function updateLoadingProgress(current, total) {
    const progress = document.querySelector('.loading-progress');
    if (progress) {
        progress.textContent = `${current} / ${total}`;
    }
}

function hideLoading() {
    const overlay = document.querySelector('.loading-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
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

// 视频播放结束处理
videoPlayer.addEventListener('ended', () => {
    // 不重置视频位置，保持在结束位置
    // 发送最终的播放进度
    if (currentVideoId) {
        ipcRenderer.send('update-video-progress', {
            videoId: currentVideoId,
            currentTime: videoPlayer.duration,
            duration: videoPlayer.duration
        });

        // 播放下一个视频
        playNextVideo();
    }
});

// 播放下一个视频
function playNextVideo() {
    const container = document.getElementById('video-list');
    const videoItems = Array.from(container.getElementsByClassName('video-item'));
    if (videoItems.length === 0) return;

    // 获取当前视频的索引
    const currentIndex = videoItems.findIndex(item => item.getAttribute('data-video-id') === currentVideoId);
    let nextItem;

    if (randomPlayEnabled) {
        // 随机模式：随机选择一个不是当前视频的项目
        let randomIndex;
        do {
            randomIndex = Math.floor(Math.random() * videoItems.length);
        } while (videoItems.length > 1 && randomIndex === currentIndex);
        nextItem = videoItems[randomIndex];
    } else {
        // 顺序模式：选择下一个视频，如果是最后一个则循环到第一个
        const nextIndex = (currentIndex + 1) % videoItems.length;
        nextItem = videoItems[nextIndex];
    }

    // 触发点击事件来播放下一个视频
    if (nextItem) {
        nextItem.click();
    }
}

// 播放上一个视频
function playPrevVideo() {
    const container = document.getElementById('video-list');
    const videoItems = Array.from(container.getElementsByClassName('video-item'));
    if (videoItems.length === 0) return;

    // 获取当前视频的索引
    const currentIndex = videoItems.findIndex(item => item.getAttribute('data-video-id') === currentVideoId);
    let prevItem;

    if (randomPlayEnabled) {
        // 随机模式：随机选择一个不是当前视频的项目
        let randomIndex;
        do {
            randomIndex = Math.floor(Math.random() * videoItems.length);
        } while (videoItems.length > 1 && randomIndex === currentIndex);
        prevItem = videoItems[randomIndex];
    } else {
        // 顺序模式：选择上一个视频，如果是第一个则循环到最后一个
        const prevIndex = (currentIndex - 1 + videoItems.length) % videoItems.length;
        prevItem = videoItems[prevIndex];
    }

    // 触发点击事件来播放上一个视频
    if (prevItem) {
        prevItem.click();
    }
}

// 添加随机播放控制按钮到控制栏
function addRandomPlayControl() {
    // 获取随机播放复选框
    const randomPlayCheckbox = document.getElementById('random-play-checkbox');
    
    // 添加事件监听器
    randomPlayCheckbox.addEventListener('change', (e) => {
        randomPlayEnabled = e.target.checked;
    });
}

// 跟踪视频播放进度
videoPlayer.addEventListener('timeupdate', () => {
    if (currentVideoId) {
        // 每次更新进度时都保存当前时间
        const currentTime = videoPlayer.currentTime;
        const duration = videoPlayer.duration;
        
        ipcRenderer.send('update-video-progress', {
            videoId: currentVideoId,
            currentTime: currentTime,
            duration: duration
        });
    }
});

// 视频加载完成后自动播放
videoPlayer.addEventListener('loadedmetadata', async () => {
    if (currentVideoId) {
        // 通知视频开始播放
        ipcRenderer.send('video-started', {
            videoId: currentVideoId
        });
        
        // 获取视频时长（如果还没有）
        const currentVideo = videoList.find(v => v.id === currentVideoId);
        if (currentVideo && !currentVideo.duration) {
            try {
                const duration = videoPlayer.duration;
                currentVideo.duration = duration;
                
                // 更新视频信息显示
                const videoItem = document.querySelector(`.video-item[data-video-id="${currentVideoId}"]`);
                if (videoItem) {
                    const info = videoItem.querySelector('.video-item-info');
                    if (info) {
                        const relativePath = getRelativePath(currentVideo.path, currentVideo.folder);
                        let infoText = `位置: ${relativePath}\n时长: ${formatDuration(duration)}`;
                        if (currentVideo.lastPlayed) {
                            infoText += `\n上次播放: ${formatDate(currentVideo.lastPlayed)}`;
                        }
                        if (currentVideo.watchTime > 0) {
                            const progress = Math.round((currentVideo.watchTime / duration) * 100);
                            infoText += `\n播放进度: ${progress}% (${formatDuration(currentVideo.watchTime)})`;
                        }
                        if (currentVideo.playCount > 0) {
                            infoText += `\n播放次数: ${currentVideo.playCount}次`;
                            if (currentVideo.significantPlays > 0) {
                                infoText += ` (完整观看${currentVideo.significantPlays}次)`;
                            }
                        }
                        info.textContent = infoText;
                    }
                }
                
                // 保存时长信息
                ipcRenderer.send('video-metadata-loaded', {
                    videoId: currentVideoId,
                    duration: duration
                });
            } catch (error) {
                console.error('Error getting video duration:', error);
            }
        }
    }
    
    // 确保视频可以播放
    videoPlayer.play().catch(e => {
        console.error('Autoplay failed:', e);
        // 如果自动播放失败，再次尝试播放
        const playPromise = videoPlayer.play();
        if (playPromise !== undefined) {
            playPromise.catch(() => {
                // 如果还是失败，添加点击事件让用户手动触发播放
                videoPlayer.addEventListener('click', () => {
                    videoPlayer.play();
                }, { once: true });
            });
        }
    });
});

// 添加文件夹按钮事件
document.getElementById('add-folder').addEventListener('click', () => {
    const quickScan = document.getElementById('quick-scan').checked;
    showLoading('正在选择文件夹...');
    ipcRenderer.send('select-folder', quickScan);
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

// 创建只读评分星星（用于列表显示）
function createRatingStars(rating) {
    const ratingDiv = document.createElement('div');
    ratingDiv.className = 'video-item-rating';
    
    for (let i = 1; i <= 5; i++) {
        const star = document.createElement('span');
        star.textContent = '★';
        star.className = i <= (rating || 0) ? 'active' : 'inactive';
        ratingDiv.appendChild(star);
    }
    
    return ratingDiv;
}

// 更新播放器评分显示
function updatePlayerRating(rating = 0) {
    const stars = document.querySelectorAll('#player-rating-stars span');
    stars.forEach((star, index) => {
        star.className = index < rating ? 'active' : 'inactive';
    });
}

// 初始化播放器评分控件
function initializePlayerRating() {
    const ratingStars = document.getElementById('player-rating-stars');
    const stars = ratingStars.querySelectorAll('span');
    
    stars.forEach((star, index) => {
        star.onclick = () => {
            if (currentVideoId) {
                const rating = index + 1;
                ipcRenderer.send('update-video-rating', {
                    videoId: currentVideoId,
                    rating: rating
                });
            }
        };
    });
}

// 在文档加载完成后初始化评分控件
document.addEventListener('DOMContentLoaded', initializePlayerRating);

// 排序视频列表
function sortVideoList(videos, sortType) {
    switch (sortType) {
        case 'rating':
            return videos.sort((a, b) => {
                if (b.rating !== a.rating) {
                    return (b.rating || 0) - (a.rating || 0);
                }
                return a.filename.localeCompare(b.filename);
            });
        case 'name':
            return videos.sort((a, b) => a.filename.localeCompare(b.filename));
        case 'new':
        default:
            return videos.sort((a, b) => {
                if (a.isNew !== b.isNew) {
                    return b.isNew - a.isNew;
                }
                return a.filename.localeCompare(b.filename);
            });
    }
}

// 创建视频标签显示
function createVideoTags(tags = []) {
    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'video-tags';
    
    tags.forEach(tag => {
        const tagSpan = document.createElement('span');
        tagSpan.className = 'video-tag';
        tagSpan.textContent = tag;
        tagsDiv.appendChild(tagSpan);
    });
    
    return tagsDiv;
}

// 更新播放器标签显示
function updatePlayerTags(tags = []) {
    const tagsList = document.getElementById('player-tags-list');
    tagsList.innerHTML = '';
    
    tags.forEach(tag => {
        const tagDiv = document.createElement('div');
        tagDiv.className = 'player-tag';
        
        const tagText = document.createElement('span');
        tagText.textContent = tag;
        
        const removeBtn = document.createElement('span');
        removeBtn.className = 'remove-tag';
        removeBtn.textContent = '×';
        removeBtn.onclick = () => {
            if (currentVideoId) {
                ipcRenderer.send('remove-tag', {
                    videoId: currentVideoId,
                    tag: tag
                });
            }
        };
        
        tagDiv.appendChild(tagText);
        tagDiv.appendChild(removeBtn);
        tagsList.appendChild(tagDiv);
    });
}

// 初始化标签过滤器
function initializeTagFilter() {
    const modal = document.getElementById('filter-modal');
    const filterButton = document.getElementById('filter-button');
    const closeBtn = document.getElementById('filter-close');
    const clearBtn = document.getElementById('filter-clear');
    const applyBtn = document.getElementById('filter-apply');
    
    // 显示对话框
    filterButton.onclick = () => {
        modal.classList.add('show');
        updateFilterList();
    };
    
    // 关闭对话框的各种方式
    const closeModal = () => modal.classList.remove('show');
    
    closeBtn.onclick = closeModal;
    
    // 点击对话框外部关闭
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeModal();
        }
    };
    
    // 清除所有过滤器
    clearBtn.onclick = () => {
        activeTagFilters = [];
        updateFilterList();
        updateFilterButton();
        ipcRenderer.send('save-tag-filters', activeTagFilters);
        updateVideoList(true);
    };
    
    // 应用过滤器
    applyBtn.onclick = () => {
        activeTagFilters = Array.from(document.querySelectorAll('.tag-filter-item.active'))
            .map(item => item.textContent);
        updateFilterButton();
        ipcRenderer.send('save-tag-filters', activeTagFilters);
        updateVideoList(true);
        closeModal();
    };
}

// 更新过滤器按钮状态
function updateFilterButton() {
    const filterButton = document.getElementById('filter-button');
    const filterCount = document.getElementById('filter-count');
    
    if (activeTagFilters.length > 0) {
        filterButton.classList.add('active');
        filterCount.textContent = activeTagFilters.length;
    } else {
        filterButton.classList.remove('active');
        filterCount.textContent = '0';
    }
}

// 更新过滤器列表
function updateFilterList() {
    const filterList = document.getElementById('filter-list');
    filterList.innerHTML = '';
    
    // 收集所有唯一的标签
    const allTags = new Set();
    videoList.forEach(video => {
        if (video.tags) {
            video.tags.forEach(tag => allTags.add(tag));
        }
    });
    
    // 按分类组织标签
    const categorizedTags = {};
    Object.keys(tagCategories).forEach(category => {
        categorizedTags[category] = [];
    });
    
    // 将标签分类
    allTags.forEach(tag => {
        const tagData = videoList.find(v => v.tags && v.tags.includes(tag));
        const category = (tagData && tagData.tagCategories && tagData.tagCategories[tag]) || 'other';
        if (!categorizedTags[category]) {
            categorizedTags[category] = [];
        }
        categorizedTags[category].push(tag);
    });
    
    // 创建分类容器
    Object.entries(tagCategories).forEach(([category, config]) => {
        if (categorizedTags[category].length > 0) {
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'tag-category';
            
            const header = document.createElement('div');
            header.className = 'tag-category-header';
            header.innerHTML = `
                <span class="tag-category-title">${config.title}</span>
                <span class="tag-category-arrow">▼</span>
            `;
            
            const content = document.createElement('div');
            content.className = 'tag-category-content';
            
            // 建该分类下的标签
            categorizedTags[category].sort().forEach(tag => {
                const tagItem = document.createElement('div');
                tagItem.className = 'tag-filter-item';
                if (activeTagFilters.includes(tag)) {
                    tagItem.classList.add('active');
                }
                tagItem.textContent = tag;
                tagItem.onclick = () => {
                    tagItem.classList.toggle('active');
                };
                content.appendChild(tagItem);
            });
            
            categoryDiv.appendChild(header);
            categoryDiv.appendChild(content);
            filterList.appendChild(categoryDiv);
        }
    });
}

// 标签分类定义（改为从设置中加载）
let tagCategories = {
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

// 更新快速标签选择对话框
function updateQuickTagsModal() {
    const tagsList = document.getElementById('quick-tags-list');
    tagsList.innerHTML = '';
    
    // 收集所有唯一的标签
    const allTags = new Set();
    videoList.forEach(video => {
        if (video.tags) {
            video.tags.forEach(tag => allTags.add(tag));
        }
    });
    
    // 获取当前视频的标签
    const currentVideo = videoList.find(v => v.id === currentVideoId);
    const currentTags = currentVideo ? currentVideo.tags || [] : [];
    
    // 按分类组织标签
    const categorizedTags = {};
    Object.keys(tagCategories).forEach(category => {
        categorizedTags[category] = [];
    });
    
    // 创建分类容器
    Object.entries(tagCategories).forEach(([category, config]) => {
        const categoryDiv = document.createElement('div');
        categoryDiv.className = `tag-category${config.defaultExpanded ? '' : ' collapsed'}`;
        categoryDiv.dataset.category = category;
        
        const header = document.createElement('div');
        header.className = 'tag-category-header';
        header.innerHTML = `
            <span class="tag-category-title">${config.title}</span>
            <span class="tag-category-arrow">▼</span>
        `;
        header.onclick = () => {
            categoryDiv.classList.toggle('collapsed');
        };
        
        const content = document.createElement('div');
        content.className = 'tag-category-content';
        
        categoryDiv.appendChild(header);
        categoryDiv.appendChild(content);
        tagsList.appendChild(categoryDiv);
    });
    
    // 创建标签选项并添加到相应的分类中
    allTags.forEach(tag => {
        const container = document.createElement('div');
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `tag-${tag}`;
        checkbox.className = 'quick-tag-checkbox';
        checkbox.checked = currentTags.includes(tag);
        
        const label = document.createElement('label');
        label.htmlFor = `tag-${tag}`;
        label.className = 'quick-tag-label';
        label.textContent = tag;
        
        container.appendChild(checkbox);
        container.appendChild(label);
        
        // 获取标签的分类（从标签数据中获取或默认为"其他"）
        const tagData = videoList.find(v => v.tags && v.tags.includes(tag));
        const category = (tagData && tagData.tagCategories && tagData.tagCategories[tag]) || 'other';
        
        // 将标签添加到相应的分类容器中
        const categoryContent = document.querySelector(`.tag-category[data-category="${category}"] .tag-category-content`);
        if (categoryContent) {
            categoryContent.appendChild(container);
        }
    });
}

// 初始化标签输入功能
function initializeTagInput() {
    const input = document.getElementById('add-tag-input');
    const categorySelect = document.getElementById('tag-category-select');
    
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && input.value.trim() && currentVideoId) {
            const tag = input.value.trim();
            const category = categorySelect.value || 'other';
            
            ipcRenderer.send('add-tag', {
                videoId: currentVideoId,
                tag: tag,
                category: category
            });
            
            input.value = '';
            categorySelect.value = '';
        }
    });
}

// 初始化快速标签功能
function initializeQuickTags() {
    const modal = document.getElementById('quick-tags-modal');
    const button = document.getElementById('quick-tags-button');
    const closeBtn = document.getElementById('quick-tags-close');
    const cancelBtn = document.getElementById('quick-tags-cancel');
    const applyBtn = document.getElementById('quick-tags-apply');
    
    // 显示对话框
    button.onclick = () => {
        if (currentVideoId) {
            modal.classList.add('show');
            updateQuickTagsModal();
        }
    };
    
    // 关闭对话框的各种方式
    const closeModal = () => modal.classList.remove('show');
    
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    
    // 点击对话框外部关闭
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeModal();
        }
    };
    
    // 应用选中的标签
    applyBtn.onclick = () => {
        if (currentVideoId) {
            const selectedTags = Array.from(document.querySelectorAll('.quick-tag-checkbox:checked'))
                .map(checkbox => checkbox.id.replace('tag-', ''));
            
            // 获取当前视频的标签
            const currentVideo = videoList.find(v => v.id === currentVideoId);
            const currentTags = currentVideo ? currentVideo.tags || [] : [];
            
            // 添加新选中的标签
            selectedTags.forEach(tag => {
                if (!currentTags.includes(tag)) {
                    ipcRenderer.send('add-tag', {
                        videoId: currentVideoId,
                        tag: tag
                    });
                }
            });
            
            // 移除未选中的标签
            currentTags.forEach(tag => {
                if (!selectedTags.includes(tag)) {
                    ipcRenderer.send('remove-tag', {
                        videoId: currentVideoId,
                        tag: tag
                    });
                }
            });
            
            closeModal();
        }
    };
}

// 初始化标签管理功能
function initializeTagManager() {
    const modal = document.getElementById('tag-manager-modal');
    const manageButton = document.getElementById('manage-tags');
    const closeBtn = document.getElementById('tag-manager-close');
    const cancelBtn = document.getElementById('tag-manager-cancel');
    const tabs = document.querySelectorAll('.tag-manager-tab');
    const addCategoryBtn = document.getElementById('add-category-btn');
    const newCategoryInput = document.getElementById('new-category-input');
    
    // 标签页切换
    tabs.forEach(tab => {
        tab.onclick = () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const panels = document.querySelectorAll('.tag-manager-panel');
            panels.forEach(p => p.classList.remove('active'));
            document.getElementById(`${tab.dataset.tab}-panel`).classList.add('active');
            
            if (tab.dataset.tab === 'tags') {
                updateTagManagerList();
            } else if (tab.dataset.tab === 'categories') {
                updateCategoryManager();
            }
        };
    });
    
    // 添加新分类
    addCategoryBtn.onclick = () => {
        const name = newCategoryInput.value.trim();
        if (name) {
            const key = name.toLowerCase().replace(/\s+/g, '-');
            if (!tagCategories[key]) {
                tagCategories[key] = {
                    title: name,
                    defaultExpanded: false
                };
                ipcRenderer.send('save-tag-categories', tagCategories);
                updateCategoryManager();
                newCategoryInput.value = '';
            }
        }
    };
    
    // 显示对话框
    manageButton.onclick = () => {
        modal.classList.add('show');
        updateTagManagerList();
    };
    
    // 关闭对话框的各种方式
    const closeModal = () => modal.classList.remove('show');
    
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    
    // 点击对话框外部关闭
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeModal();
        }
    };
}

// 更新分类管理界面
function updateCategoryManager() {
    const container = document.getElementById('category-manager');
    container.innerHTML = '';
    
    Object.entries(tagCategories).forEach(([key, category]) => {
        const item = document.createElement('div');
        item.className = 'category-item';
        
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'category-name';
        nameInput.value = category.title;
        nameInput.onchange = () => {
            category.title = nameInput.value;
            ipcRenderer.send('save-tag-categories', tagCategories);
        };
        
        const actions = document.createElement('div');
        actions.className = 'category-actions';
        
        // 不允许删除"其他"分类
        if (key !== 'other') {
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '删除';
            deleteBtn.className = 'remove-folder';
            deleteBtn.onclick = () => {
                if (confirm(`确定要删除分类"${category.title}"吗？所有使用此分类的标签将移至"其他"分类。`)) {
                    // 将该分类下的所有标签移到"其他"��类
                    videoList.forEach(video => {
                        if (video.tagCategories) {
                            Object.entries(video.tagCategories).forEach(([tag, cat]) => {
                                if (cat === key) {
                                    video.tagCategories[tag] = 'other';
                                    ipcRenderer.send('update-tag-category', {
                                        videoId: video.id,
                                        tag: tag,
                                        category: 'other'
                                    });
                                }
                            });
                        }
                    });
                    
                    delete tagCategories[key];
                    ipcRenderer.send('save-tag-categories', tagCategories);
                    updateCategoryManager();
                }
            };
            actions.appendChild(deleteBtn);
        }
        
        item.appendChild(nameInput);
        item.appendChild(actions);
        container.appendChild(item);
    });
}

// 更新标签管理列表
function updateTagManagerList() {
    const container = document.getElementById('tag-manager-list');
    container.innerHTML = '';
    
    // 收集所有标签信息
    const tagInfo = new Map(); // 存标签使用次数和分类信息
    videoList.forEach(video => {
        if (video.tags) {
            video.tags.forEach(tag => {
                if (!tagInfo.has(tag)) {
                    tagInfo.set(tag, {
                        count: 1,
                        category: (video.tagCategories && video.tagCategories[tag]) || 'other'
                    });
                } else {
                    tagInfo.get(tag).count++;
                }
            });
        }
    });
    
    // 按标签名称排序
    const sortedTags = Array.from(tagInfo.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    
    // 创建标签列表
    sortedTags.forEach(([tag, info]) => {
        const item = document.createElement('div');
        item.className = 'tag-manager-item';
        
        const name = document.createElement('div');
        name.className = 'tag-manager-name';
        name.textContent = tag;
        
        const category = document.createElement('select');
        category.className = 'tag-manager-category';
        Object.entries(tagCategories).forEach(([value, { title }]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = title;
            option.selected = value === info.category;
            category.appendChild(option);
        });
        
        // 当分类改变时更新所有使用该标签的视频
        category.onchange = () => {
            const newCategory = category.value;
            videoList.forEach(video => {
                if (video.tags && video.tags.includes(tag)) {
                    if (!video.tagCategories) {
                        video.tagCategories = {};
                    }
                    video.tagCategories[tag] = newCategory;
                    
                    // 通知主进程更新标签分类
                    ipcRenderer.send('update-tag-category', {
                        videoId: video.id,
                        tag: tag,
                        category: newCategory
                    });
                }
            });
        };
        
        const count = document.createElement('div');
        count.className = 'tag-manager-count';
        count.textContent = `${info.count}个视频`;
        
        item.appendChild(name);
        item.appendChild(category);
        item.appendChild(count);
        container.appendChild(item);
    });
}

// 初始化文件夹管理器
function initializeFolderManager() {
    const modal = document.getElementById('folder-manager-modal');
    const manageButton = document.getElementById('manage-folders');
    const closeBtn = document.getElementById('folder-manager-close');
    const cancelBtn = document.getElementById('folder-manager-cancel');
    
    // 显示对话框
    manageButton.onclick = () => {
        modal.classList.add('show');
        updateFolderList();
    };
    
    // 关闭对话框的各种方式
    const closeModal = () => modal.classList.remove('show');
    
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    
    // 点击对话框外部关闭
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeModal();
        }
    };
}

// 在文档加载完成后初始化所有功能
document.addEventListener('DOMContentLoaded', () => {
    initializePlayerRating();
    initializeTagInput();
    initializeQuickTags();
    initializeTagManager();
    initializeTagFilter();
    initializeFolderManager();
    addRandomPlayControl();  // 添加随机播放控制

    // 添加上一个/下一个视频按钮的事件监听
    document.getElementById('prev-video').addEventListener('click', playPrevVideo);
    document.getElementById('next-video').addEventListener('click', playNextVideo);

    // 添加键盘快捷键
    document.addEventListener('keydown', (e) => {
        // 只在没有输入框获得焦点时响应快捷键
        if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
            switch (e.key) {
                case 'PageUp':
                    playPrevVideo();
                    break;
                case 'PageDown':
                    playNextVideo();
                    break;
            }
        }
    });

    // 请求保存的标签过滤器状态
    ipcRenderer.send('request-tag-filters');
});

// 接收保存的标签过滤器状态
ipcRenderer.on('tag-filters-loaded', (event, filters) => {
    activeTagFilters = filters || [];
    updateFilterButton();
    updateVideoList(true);
});

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
    
    // 获取当前排序方式
    const sortType = document.getElementById('sort-type').value;
    
    // 获取选中的标签过滤器
    const activeFilters = Array.from(document.querySelectorAll('.tag-filter-item.active'))
        .map(item => item.textContent);
    
    // 过滤和序视频列表
    let filteredVideos = videoList;
    if (activeFilters.length > 0) {
        filteredVideos = videoList.filter(video => 
            activeFilters.every(tag => video.tags && video.tags.includes(tag))
        );
    }
    
    if (!maintainOrder) {
        filteredVideos = sortVideoList(filteredVideos, sortType);
    }
    
    filteredVideos.forEach(video => {
        const videoItem = document.createElement('div');
        videoItem.className = 'video-item' + (video.isNew ? ' new-video' : '') + (video.watched ? ' watched' : '');
        videoItem.setAttribute('data-video-id', video.id);
        
        const title = document.createElement('div');
        title.className = 'video-item-title';
        title.textContent = path.basename(video.path) + (video.isNew ? ' (新)' : '');
        
        const rating = createRatingStars(video.rating);
        
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
        videoItem.appendChild(rating);
        videoItem.appendChild(info);
        
        // 添加标签显示
        const tags = createVideoTags(video.tags);
        videoItem.appendChild(tags);
        
        videoItem.onclick = () => {
            document.querySelectorAll('.video-item').forEach(item => {
                item.classList.remove('active');
            });
            
            videoItem.classList.add('active');
            
            // 确保当前播放的视频在视野内
            videoItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            
            // 在切换视频前保存当前视频的播放进度
            if (currentVideoId) {
                const currentVideo = videoList.find(v => v.id === currentVideoId);
                if (currentVideo) {
                    currentVideo.watchTime = videoPlayer.currentTime;
                    // 发送最后的放进度
                    ipcRenderer.send('update-video-progress', {
                        videoId: currentVideoId,
                        currentTime: videoPlayer.currentTime,
                        duration: videoPlayer.duration
                    });
                }
            }
            
            // 切换到视频
            currentVideoId = video.id;
            const wasPlaying = !videoPlayer.paused;
            const oldSrc = videoPlayer.src;
            videoPlayer.src = video.path;
            
            // 检查是否应该从头开始播放
            const isVideoFinished = video.watchTime >= (video.duration * 0.98); // 如果播放进度超过98%，认为已完成
            if (isVideoFinished) {
                videoPlayer.currentTime = 0; // 从开始播放
            } else {
                videoPlayer.currentTime = video.watchTime || 0; // 否则从上次播放位置继续
            }
            
            // 如果之前播放，或者这是新选择的视频，就自动播放
            if (wasPlaying || oldSrc !== video.path) {
                const playPromise = videoPlayer.play();
                if (playPromise !== undefined) {
                    playPromise.catch(e => {
                        console.error('Play failed:', e);
                        // 如果放失败，添加一次性击事件
                        videoPlayer.addEventListener('click', () => {
                            videoPlayer.play();
                        }, { once: true });
                    });
                }
            }
            
            // 更新当前播放信息、评分和标签显示
            document.getElementById('current-video-info').textContent = 
                `正在播放: ${path.basename(video.path)} (${relativePath})`;
            updatePlayerRating(video.rating);
            updatePlayerTags(video.tags || []);
        };
        
        container.appendChild(videoItem);
    });
}

// 添加排序变化监听
document.getElementById('sort-type').addEventListener('change', () => {
    updateVideoList(false);
});

// 更新单个视频的状态
function updateVideoState(videoId, updates) {
    const videoItem = document.querySelector(`.video-item[data-video-id="${videoId}"]`);
    if (videoItem) {
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

            // 更新评分显示（列表和播放器）
            if (updates.rating !== undefined) {
                // 更新列表的评分显示
                const oldRating = videoItem.querySelector('.video-item-rating');
                if (oldRating) {
                    const newRating = createRatingStars(updates.rating);
                    oldRating.replaceWith(newRating);
                }
                
                // 如果是当前播放的视频，更新播放器评分
                if (videoId === currentVideoId) {
                    updatePlayerRating(updates.rating);
                }
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

            // 更新标签显示
            if (updates.tags !== undefined) {
                // 更新列表中的标签显示
                const oldTags = videoItem.querySelector('.video-tags');
                if (oldTags) {
                    const newTags = createVideoTags(updates.tags);
                    oldTags.replaceWith(newTags);
                }
                
                // 如果是当前播放的视频，新播放器标签
                if (videoId === currentVideoId) {
                    updatePlayerTags(updates.tags);
                }
                
                // 更新标签过滤器
                updateTagFilter();
            }
        }
    }
}

// 接收文件夹选择结果
ipcRenderer.on('folder-selected', (event, folderPath) => {
    if (!watchFolders.has(folderPath)) {
        const quickScan = document.getElementById('quick-scan').checked;
        showLoading('正在扫描视频文件夹...\n(扫描过程中您可以继续使用播放器)');
        watchFolders.add(folderPath);
        updateFolderList();
        ipcRenderer.send('add-folder', { folder: folderPath, quickScan });
    }
});

// 接收视频列表更新
ipcRenderer.on('update-video-list', (event, videos) => {
    videoList = videos;
    updateVideoList(false);
    hideLoading();
    // 更新快速标签下拉菜单
    updateQuickTagsDropdown();
});

// 接收视频状态更新
ipcRenderer.on('video-state-updated', (event, { videoId, updates }) => {
    updateVideoState(videoId, updates);
});

// 接收扫描进度更新
ipcRenderer.on('scan-progress', (event, { current, total, currentFile }) => {
    updateLoadingProgress(current, total);
    const text = document.querySelector('.loading-text');
    if (text) {
        text.textContent = `正在扫描: ${path.basename(currentFile)}\n(扫描过程中您可以继续使用播放器)`;
    }
});

// 接收标签分类更新
ipcRenderer.on('tag-categories-loaded', (event, categories) => {
    tagCategories = categories;
    updateTagManagerList();
    updateQuickTagsModal();
    updateFilterList();
});

// 扫描状态处理
let scanTimeout;

ipcRenderer.on('scan-start', () => {
    showLoading('正在扫描视频文件夹...');
    // 添加超时检测
    scanTimeout = setTimeout(() => {
        const overlay = document.querySelector('.loading-overlay');
        if (overlay.classList.contains('active')) {
            const cancelButton = document.createElement('button');
            cancelButton.textContent = '取消扫描';
            cancelButton.className = 'cancel-scan-button';
            cancelButton.onclick = () => {
                ipcRenderer.send('cancel-scan');
                hideLoading();
            };
            overlay.appendChild(cancelButton);
        }
    }, 10000); // 10秒后显示取消按钮
});

ipcRenderer.on('scan-progress', (event, { current, total, currentFile }) => {
    updateLoadingProgress(current, total);
    const text = document.querySelector('.loading-text');
    text.textContent = `正在扫描: ${path.basename(currentFile)}`;
});

ipcRenderer.on('scan-error', (event, message) => {
    if (scanTimeout) {
        clearTimeout(scanTimeout);
    }
    const text = document.querySelector('.loading-text');
    text.textContent = `扫描出错: ${message}`;
    setTimeout(hideLoading, 3000);
});

ipcRenderer.on('scan-complete', () => {
    if (scanTimeout) {
        clearTimeout(scanTimeout);
    }
    hideLoading();
});

// 添加样式
const style = document.createElement('style');
style.textContent = `
.cancel-scan-button {
    margin-top: 20px;
    padding: 8px 16px;
    background-color: #ff4444;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

.cancel-scan-button:hover {
    background-color: #ff6666;
}
`;
document.head.appendChild(style); 