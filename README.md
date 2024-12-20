# YTMFVP - Your The Most Favorite Video Player

[English](./README_EN.md) | 简体中文

YTMFVP 是一个基于 Electron 开发的本地视频播放器，专注于视频管理和观看体验。它不仅仅是一个简单的播放器，更是一个强大的视频管理工具。

> 特别说明：这是一个由 AI（Cursor）完全编写的软件项目，人类作者仅提供功能建议和必要的技术支持。这个项目展示了 AI 辅助开发的潜力，以及人机协作在软件开发中的新可能。

## 运行方法

### 环境要求
- Node.js 14.0.0 或更高版本
- npm 6.0.0 或更高版本

### 安装步骤
1. 克隆仓库
```bash
git clone https://github.com/galaxy8691/your-the-most-favorite-video-player.git
cd your-the-most-favorite-video-player
```

2. 安装依赖
```bash
npm install
```

3. 运行应用
```bash
npm start
```

### 打包发布
首先确保已安装所有依赖，然后运行相应的打包命令：

```bash
# 打包所有平台
npm run build

# 仅打包 Windows 版本
npm run build:win

# 仅打包 macOS 版本
npm run build:mac

# 仅打包 Linux 版本
npm run build:linux
```

打包后的文件将保存在 `dist` 目录中。

## 主要特性

### 📁 智能文件管理
- 支持多文件夹监控和管理
- 快速扫描模式，延迟获取视频时长
- 自动记忆播放位置和观看进度
- 支持视频新旧状态标记

### 🎯 强大的分类系统
- 灵活的标签管理系统
- 支持自定义标签分类
- 多维度标签筛选
- 快速标签添加和批量管理

### 🎬 智能播放控制
- 自动记忆播放进度
- 支持随机播放模式
- 上一个/下一个视频快速切换
- 播放历史追踪

### 📊 数据统计
- 视频观看次数统计
- 完整观看次数记录
- 播放时长统计
- 最后播放时间记录

### ⭐ 评分系统
- 五星评分系统
- 按评分排序
- 可视化评分展示

### 🎨 现代化界面
- 深色主题设计
- 响应式布局
- 流畅的动画效果
- 直观的用户界面

### 🔍 多样化排序
- 按新旧排序
- 按评分排序
- 按名排序

## 技术特点
- 基于 Electron 框架开发
- 使用原生 JavaScript
- 高性能文件监控系统
- 本地数据持久化存储

## 使用方法
1. 点击"管理文件夹"添加视频文件夹
2. 选择是否启用快速扫描模式
3. 等待视频扫描完成
4. 开始享受你的视频之旅！

## 键盘快捷键
- `Space` - 播放/暂停
- `Left/Right` - 快进/快退
- `Up/Down` - 调节音量
- `PageUp` - 播放上一个视频
- `PageDown` - 播放下一个视频

## 系统要求
- Windows 7 及以上
- macOS 10.12 及以上
- Linux (主流发行版)

## 开发计划
- [ ] 视频缩略图预览
- [ ] 自定义快捷键
- [ ] 播放列表导出/导入
- [ ] 更多视频格式支持
- [ ] 网络视频流支持

## 贡献
欢迎提交 Issue 和 Pull Request！

## 许可证
MIT License 