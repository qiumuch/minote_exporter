// 后台脚本 - 处理插件生命周期和消息传递
chrome.runtime.onInstalled.addListener(function() {
    console.log('笔记导出助手已安装');
});

// 处理来自content script的消息并转发给popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    // 转发消息到popup（如果popup是打开的）
    if (request.type && request.type.startsWith('EXPORT_')) {
        // 这里的消息会被popup.js接收
        return true; // 保持消息通道开放
    }
});

// 处理插件图标点击
chrome.action.onClicked.addListener(function(tab) {
    // 当用户点击插件图标时，会自动打开popup
    // 这里可以添加额外的逻辑
});

// 处理标签页更新
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete' && tab.url) {
        // 页面加载完成后可以进行一些初始化操作
        if (tab.url.includes('note') || tab.url.includes('笔记')) {
            // 可以在这里检测是否是笔记相关页面
            console.log('检测到笔记页面:', tab.url);
        }
    }
});