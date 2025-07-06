// 内容脚本 - 用于监听popup的消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.type === 'START_EXPORT') {
        // 这里会被exporter.js中的实际导出脚本替换
        // 目前只是一个占位符，实际的导出逻辑在exporter.js中
        sendResponse({success: true});
    }
});

// 检查页面是否已经加载了导出脚本
if (!window.noteExporterLoaded) {
    console.log('笔记导出助手已准备就绪');
    window.noteExporterLoaded = true;
}