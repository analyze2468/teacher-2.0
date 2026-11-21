/**
 * 拍照 / 相册上传（移动端优先）
 *
 * 约定：
 * 1. <input type="file" accept="image/*" capture="environment"> 在手机上直接调用后置摄像头；
 * 2. 统一走 utils.compressImage 压缩（默认 ≤1280px、JPEG 0.78），避免存档体积过大；
 * 3. 压缩后写入 IndexedDB photos 表（storage.savePhoto），可在「记录」页回看；
 * 4. 缩略图点开走 utils.showPhotoOverlay 全屏预览，右上角 × 删除（同时删库）。
 * 5. images() 返回已压缩图片的 dataURL，评分时原样交给多模态模型读图 —— 不做本地 OCR。
 */

import { compressImage, showPhotoOverlay, toast } from './utils.js';
import { savePhoto, deletePhoto, isIdbSupported } from './storage.js';

export function setupPhotoUpload({
  input,
  preview,
  status,
  mode = 'math',
  limit = 3,
  getContext
} = {}) {
  if (!input || !preview) {
    return { count: () => 0, images: () => [], reset() {}, destroy() {} };
  }

  let items = [];
  let busy = false;

  function paintStatus(text) {
    if (!status) return;
    if (text) {
      status.textContent = text;
      return;
    }
    status.textContent = items.length
      ? `已存 ${items.length}/${limit} 张板书照片`
      : '未上传板书照片';
  }

  function render() {
    preview.innerHTML = '';
    preview.classList.toggle('hidden', items.length === 0);
    items.forEach((item) => {
      const cell = document.createElement('div');
      cell.className = 'photo-item';

      const thumb = document.createElement('img');
      thumb.src = item.dataUrl;
      thumb.alt = '板书照片';
      thumb.loading = 'lazy';
      thumb.addEventListener('click', () => showPhotoOverlay(item.dataUrl));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'photo-item__del';
      remove.setAttribute('aria-label', '删除这张板书照片');
      remove.textContent = '×';
      remove.addEventListener('click', async (event) => {
        event.stopPropagation();
        items = items.filter((current) => current.key !== item.key);
        render();
        paintStatus();
        if (item.id != null && isIdbSupported()) {
          try {
            await deletePhoto(item.id);
          } catch (error) {
            console.warn('[photo] 删除失败', error);
          }
        } else {
          toast('已从本页移除');
        }
      });

      cell.appendChild(thumb);
      cell.appendChild(remove);
      preview.appendChild(cell);
    });
  }

  async function handleChange() {
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length || busy) return;

    const remain = Math.max(0, limit - items.length);
    if (!remain) {
      toast(`最多保存 ${limit} 张，先删掉一张再传`, { type: 'warning' });
      return;
    }

    busy = true;
    paintStatus('正在压缩图片…');
    const context = typeof getContext === 'function' ? getContext() || {} : {};

    for (const file of files.slice(0, remain)) {
      if (!String(file.type).startsWith('image/')) {
        toast('请选择图片文件', { type: 'error' });
        continue;
      }
      try {
        const compressed = await compressImage(file, { maxSize: 1280, quality: 0.78 });
        const item = {
          key: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          dataUrl: compressed.dataUrl,
          id: null
        };
        items.push(item);
        render();
        if (isIdbSupported()) {
          try {
            item.id = await savePhoto({
              mode: context.mode || mode,
              questionId: context.questionId || '',
              title: context.title || '',
              dataUrl: compressed.dataUrl,
              width: compressed.width,
              height: compressed.height
            });
          } catch (error) {
            console.warn('[photo] 写入 IndexedDB 失败', error);
            toast('照片已显示，但存档写入失败（存储空间可能不足）', { type: 'warning' });
          }
        }
      } catch (error) {
        console.warn('[photo] 处理失败', error);
        toast(error?.message || '图片处理失败，请重新拍照', { type: 'error' });
      }
    }

    busy = false;
    paintStatus();
    if (items.length) toast('板书照片已存档，点缩略图可放大查看');
  }

  input.addEventListener('change', handleChange);
  render();
  paintStatus();

  return {
    count: () => items.length,
    /** 已压缩图片的 dataURL（按上传顺序），评分页据此判断「读图评分」还是提示配置 API */
    images: () => items.map((item) => item.dataUrl),
    reset() {
      items = [];
      input.value = '';
      render();
      paintStatus();
    },
    destroy() {
      input.removeEventListener('change', handleChange);
    }
  };
}
