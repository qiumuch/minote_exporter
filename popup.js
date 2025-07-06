document.addEventListener('DOMContentLoaded', function() {
    const exportBtn = document.getElementById('exportBtn');
    const statusDiv = document.getElementById('status');
    const progressDiv = document.getElementById('progress');
    const progressBar = document.getElementById('progress-bar');
    const statsDiv = document.getElementById('stats');
    const folderCountSpan = document.getElementById('folderCount');
    const noteCountSpan = document.getElementById('noteCount');
    const imageCountSpan = document.getElementById('imageCount');

    function updateStatus(message, type = 'info') {
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
    }

    function updateProgress(percent) {
        progressBar.style.width = percent + '%';
    }

    function updateStats(folders, notes, images) {
        folderCountSpan.textContent = folders;
        noteCountSpan.textContent = notes;
        imageCountSpan.textContent = images;
        statsDiv.style.display = 'flex';
    }

    function showProgress() {
        progressDiv.style.display = 'block';
        updateProgress(0);
    }

    function hideProgress() {
        progressDiv.style.display = 'none';
    }

    exportBtn.addEventListener('click', async function() {
        try {
            // 获取当前活动标签页
            const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
            
            if (!tab) {
                updateStatus('无法获取当前页面', 'error');
                return;
            }

            // 禁用按钮
            exportBtn.disabled = true;
            exportBtn.textContent = '导出中...';
            
            // 显示进度条
            showProgress();
            updateStatus('正在注入脚本...', 'info');
            updateProgress(10);

            // 注入内容脚本
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['exporter.js']
            });

            updateProgress(20);
            updateStatus('正在获取数据...', 'info');

            // 监听来自内容脚本的消息
            const messageListener = function(message, sender, sendResponse) {
                if (message.type === 'EXPORT_PROGRESS') {
                    updateProgress(message.progress);
                    updateStatus(message.message, 'info');
                } else if (message.type === 'EXPORT_STATS') {
                    updateStats(message.folders, message.notes, message.images);
                } else if (message.type === 'EXPORT_COMPLETE') {
                    updateProgress(100);
                    updateStatus('导出完成！', 'success');
                    exportBtn.disabled = false;
                    exportBtn.textContent = '重新导出';
                    setTimeout(() => {
                        hideProgress();
                    }, 2000);
                    chrome.runtime.onMessage.removeListener(messageListener);
                } else if (message.type === 'EXPORT_ERROR') {
                    updateStatus(`导出失败: ${message.error}`, 'error');
                    exportBtn.disabled = false;
                    exportBtn.textContent = '重试导出';
                    hideProgress();
                    chrome.runtime.onMessage.removeListener(messageListener);
                }
            };

            chrome.runtime.onMessage.addListener(messageListener);

            // 开始导出
            await chrome.tabs.sendMessage(tab.id, {type: 'START_EXPORT'});

        } catch (error) {
            console.error('导出失败:', error);
            updateStatus('导出失败: ' + error.message, 'error');
            exportBtn.disabled = false;
            exportBtn.textContent = '重试导出';
            hideProgress();
        }
    });

    // 检查页面兼容性
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const tab = tabs[0];
        if (tab && tab.url) {
            if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
                updateStatus('此页面不支持导出功能', 'warning');
                exportBtn.disabled = true;
                exportBtn.textContent = '页面不支持';
            }
        }
    });
});