// 笔记导出核心脚本
(function() {
    'use strict';

    // 全局变量声明
    const JSZip = window.JSZip;
    const saveAs = window.saveAs;

    // 确保库已加载
    if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
        console.error('JSZip 或 FileSaver 库未正确加载');
        utils.sendMessage('EXPORT_ERROR', { error: 'JSZip 或 FileSaver 库未正确加载' });
        return;
    }

    // 防止重复注入
    if (window.noteExporterInjected) {
        return;
    }
    window.noteExporterInjected = true;

    // 核心工具函数
    const utils = {
        substitute: (string, attributes = {}) => {
            return string.replace(/:([^:]*?):/g, (match, key) => 
                attributes[key] ?? match
            );
        },

        formatDate: (timestamp) => {
            const date = new Date(timestamp);
            return date.getFullYear() + 
                   String(date.getMonth() + 1).padStart(2, '0') + 
                   String(date.getDate()).padStart(2, '0');
        },

        sanitizeFileName: (fileName) => 
            fileName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim(),

        downloadFile: (fileName, content, type = 'text/plain') => {
            const blob = new Blob([content], { type });
            const url = URL.createObjectURL(blob);
            const a = Object.assign(document.createElement('a'), {
                href: url,
                download: fileName,
                style: 'display: none'
            });
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },

        downloadImage: (fileName, base64Data) => {
            try {
                const [header, data] = base64Data.split(',');
                const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
                const bytes = new Uint8Array(
                    atob(data).split('').map(char => char.charCodeAt(0))
                );
                utils.downloadFile(fileName, new Blob([bytes], { type: mimeType }));
            } catch (error) {
                console.error('图片下载失败:', fileName, error);
            }
        },

        sendMessage: (type, data) => {
            try {
                chrome.runtime.sendMessage({type, ...data});
            } catch (error) {
                console.error('消息发送失败:', error);
            }
        }
    };

    // 网络请求函数
    const network = {
        fetchWithRetry: async (url, maxAttempts = 20) => {
            for (let i = 0; i < maxAttempts; i++) {
                try {
                    const response = await fetch(url);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    return response;
                } catch (error) {
                    if (i === maxAttempts - 1) throw error;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        },

        fetchImage: async (id) => {
            let image;
            const maxAttempts = 20;
            const exceptions = [];

            for(let i = 0; i < maxAttempts; i++) {  
                try {
                    image = new Image();
                    image.setAttribute('crossOrigin', 'anonymous');
                    image.src = utils.substitute('/file/full?type=note_img&fileid=:id:', { id });
                    
                    await new Promise((resolve, reject) => {
                        image.addEventListener('load', resolve);
                        image.addEventListener('error', reject);
                    });
                    break;
                } catch (error) {
                    exceptions.push(error);
                    console.warn(`图片获取失败: ${id}，尝试 ${i+1}/${maxAttempts}`, error);
                    // 继续尝试，不立即返回null
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            
            if(exceptions.length === maxAttempts) { // 所有尝试都失败
                console.error(`图片获取失败: ${id}，已达到最大尝试次数`, exceptions);
                return null;
            }

            const canvas = document.createElement('canvas');
            const { width, height } = image; //  获取图片的宽度和高度
            canvas.width = width; //  设置canvas的宽度和高度
            canvas.height = height;
            canvas.getContext('2d').drawImage(image, 0, 0, width, height); //  在canvas上绘制图片
            return canvas.toDataURL('image/png'); //  将canvas转换为png格式的base64字符串
        },

        query: async (endpoint, params = {}) => {
            const url = utils.substitute(endpoint, { time: Date.now(), ...params });
            const response = await network.fetchWithRetry(url);
            return response.json();
        }
    };

    // 文件处理
    const fileHandler = {
        generateFileName: (note, fileNameCounter) => {
            const dateStr = utils.formatDate(note.createDate);
            const title = note.title?.trim();
            
            if (title) {
                return utils.sanitizeFileName(`${dateStr}_${title}`);
            }
            
            const preview = note.content.split('\n')[0].substring(0, 10);
            const count = fileNameCounter[dateStr] = (fileNameCounter[dateStr] || 0) + 1;
            const suffix = count > 1 ? `_${count}` : '';
            
            return utils.sanitizeFileName(`${dateStr}${suffix}_${preview}`);
        },

        convertToMarkdown: (note, imageMap) => {
            const lines = note.content.replace(/\<0\/\>\<.*?\/\>/g, '').split('\n');
            const imageFiles = [];
            
            const processedLines = lines.map(line => {
                if (line.startsWith('☺ ')) {
                    const imageId = line.substr(2);
                    if (imageMap[imageId]) {
                        const imageName = `${imageId}.png`;
                        imageFiles.push({ name: imageName, data: imageMap[imageId] });
                        return `![${imageName}](images/${imageName})`;
                    } else {
                        console.warn(`图片未找到，无法在Markdown中引用: ${imageId}`);
                        return `![图片未找到: ${imageId}]()`;
                    }
                }
                return line;
            });

            let content = processedLines.join('\n');
            if (note.title) {
                content = `# ${note.title}\n\n${content}`;
            }
            
            content += `\n\n---\n创建时间: ${new Date(note.createDate).toLocaleString()}\n修改时间: ${new Date(note.modifyDate).toLocaleString()}`;
            
            return { content, imageFiles };
        }
    };

    // 主导出函数
    const exportNotes = async () => {
        const urls = {
            list: '/note/full/page/?ts=:time:&limit=200',
            listWithSyncTag: '/note/full/page/?ts=:time:&limit=200&syncTag=:syncTag:',
            note: '/note/note/:id:/?ts=:time:'
        };

        let folders = [];
        let notes = [];
        let images = [];
        let syncTag;
        let neededToContinue = 0;

        try {
            utils.sendMessage('EXPORT_PROGRESS', { progress: 20, message: '正在获取笔记列表...' });

            // 获取数据
            do {
                const { data } = await network.query(syncTag ? urls.listWithSyncTag : urls.list, { syncTag });
                
                if (data.folders) folders.push(...data.folders);
                
                utils.sendMessage('EXPORT_PROGRESS', { 
                    progress: 30, 
                    message: `发现 ${data.entries.length} 个笔记条目` 
                });

                for (let i = 0; i < data.entries.length; i++) {
                    const { id } = data.entries[i];
                    const { data: { entry: noteData } } = await network.query(urls.note, { id });
                    
                    // 处理图片
                    const imagePromises = [];
                    const noteImages = [];
                    
                    // 提取所有图片ID
                    for (const line of noteData.content.replace(/\<0\/\>\<.*?\/\>/g, '').split('\n')) {
                        if (line.startsWith('☺ ')) {
                            const imageId = line.substr(2);
                            noteImages.push(imageId);
                        }
                    }
                    
                    // 并行获取所有图片
                    for (const imageId of noteImages) {
                        imagePromises.push(
                            network.fetchImage(imageId).then(imageData => {
                                if (imageData) {
                                    images.push({ id: imageId, image: imageData });
                                    console.log(`成功获取图片: ${imageId}`);
                                } else {
                                    console.error(`无法获取图片: ${imageId}`);
                                }
                            }).catch(error => {
                                console.error(`处理图片时出错: ${imageId}`, error);
                            })
                        );
                    }
                    
                    // 等待所有图片处理完成
                    await Promise.all(imagePromises);
                    notes.push(noteData);
                    
                    const progress = 30 + (i / data.entries.length) * 40;
                    utils.sendMessage('EXPORT_PROGRESS', { 
                        progress: progress, 
                        message: `处理笔记 ${i + 1}/${data.entries.length}` 
                    });
                }
                
                syncTag = data.syncTag;
                neededToContinue = data.entries.length;
            } while (neededToContinue);

            utils.sendMessage('EXPORT_STATS', { 
                folders: folders.length, 
                notes: notes.length, 
                images: images.length 
            });

            utils.sendMessage('EXPORT_PROGRESS', { progress: 70, message: '开始打包为 ZIP...' });

            const zip = new JSZip();
            const folderMap = Object.fromEntries(folders.map(f => [f.id, f.subject]));
            const imageMap = Object.fromEntries(images.map(img => [img.id, img.image]));
            const fileNameCounter = {};
            const notesFolder = zip.folder("notes");

            for (let i = 0; i < notes.length; i++) {
                const note = notes[i];
                const folderName = folderMap[note.folderId] || '默认文件夹';
                const fileName = fileHandler.generateFileName(note, fileNameCounter);
                const { content, imageFiles } = fileHandler.convertToMarkdown(note, imageMap);

                // 创建对应文件夹并写入 Markdown 文件
                notesFolder.folder(folderName).file(`${fileName}.md`, content);

                // 写入图片文件
                const imageFolder = notesFolder.folder(`${folderName}/images`);
                imageFiles.forEach(imageFile => {
                    const base64Data = imageFile.data.split(',')[1]; // 去掉 data:image/png;base64,
                    imageFolder.file(imageFile.name, base64Data, { base64: true });
                });

                const progress = 70 + (i / notes.length) * 29;
                utils.sendMessage('EXPORT_PROGRESS', {
                    progress: Math.round(progress),
                    message: `打包笔记 ${i + 1}/${notes.length}`
                });

                await new Promise(resolve => setTimeout(resolve, 50));
            }

            // 生成 ZIP 并触发下载
            const blob = await zip.generateAsync({ type: "blob" });
            utils.downloadFile("MiNote_导出笔记.zip", blob, "application/zip");

            utils.sendMessage('EXPORT_COMPLETE', {
                folders: folders.length,
                notes: notes.length,
                images: images.length
            });
        } catch (error) {
            console.error('导出失败:', error);
            utils.sendMessage('EXPORT_ERROR', { error: error.message });
        }
    };

    // 监听来自popup的消息
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.type === 'START_EXPORT') {
            exportNotes();
            sendResponse({success: true});
        }
    });

    console.log('笔记导出脚本已注入');
})();