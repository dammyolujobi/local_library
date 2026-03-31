// Global state
let allFiles = [];
let currentFolder = '';
let thumbnailQueue = [];
let concurrentThumbnailLoads = 0;
const MAX_CONCURRENT_LOADS = 2;

/**
 * Load folder from localStorage on page load
 */
function loadSavedFolder() {
  const saved = localStorage.getItem('pdflib-folder');
  if (saved) {
    document.getElementById('folderInput').value = saved;
    currentFolder = saved;
    loadFiles().then(() => {
      const lastFile = localStorage.getItem('pdflib-last-file');
      if (lastFile) openFile(lastFile);
    });
  }
}

/**
 * Load files from specified folder
 */
async function loadFiles() {
  const folderName = document.getElementById('folderInput').value.trim();
  if (!folderName) { showMessage('Enter a folder name', 'error'); return; }

  localStorage.setItem('pdflib-folder', folderName);
  clearMessage();
  showLoading();
  currentFolder = folderName;

  try {
    const folderRes = await fetch(`/api/get_folder?folder_name=${encodeURIComponent(folderName)}`);
    if (!folderRes.ok) {
      showMessage('Folder not found', 'error');
      document.getElementById('fileList').innerHTML = '';
      hideInfoBar();
      return;
    }

    const folderData = await folderRes.json();
    const folderPath = folderData.Folder;

    const filesRes = await fetch(`/api/get_files?folder_name=${encodeURIComponent(folderName)}`);
    if (!filesRes.ok) {
      showMessage('Could not load files', 'error');
      document.getElementById('fileList').innerHTML = '';
      hideInfoBar();
      return;
    }

    const filesData = await filesRes.json();
    allFiles = filesData.map(filePath => {
      const parts = filePath.replace(/\\/g, '/').split('/');
      return { name: parts[parts.length - 1], path: filePath };
    });

    document.getElementById('searchInput').value = '';
    displayFiles(allFiles);
    showInfoBar(allFiles.length, folderPath);

  } catch (err) {
    showMessage(`Error: ${err.message}`, 'error');
    document.getElementById('fileList').innerHTML = '';
  }
}

/**
 * Generate PDF thumbnail using pdf.js
 */
async function generatePdfThumbnail(filePath, canvasId) {
  try {
    concurrentThumbnailLoads++;
    const pdf = await pdfjsLib.getDocument({
      url: `/api/pdf?file_path=${encodeURIComponent(filePath)}`,
      withCredentials: false
    }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 0.8 });
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    pdf.destroy();
  } catch {
    const canvas = document.getElementById(canvasId);
    if (canvas?.parentElement) {
      canvas.parentElement.innerHTML = `
        <div class="thumb-placeholder">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
          </svg>
          <span>PDF</span>
        </div>`;
    }
  } finally {
    concurrentThumbnailLoads--;
    processNextThumbnail();
  }
}

/**
 * Process next thumbnail from queue with concurrency limit
 */
function processNextThumbnail() {
  if (concurrentThumbnailLoads < MAX_CONCURRENT_LOADS && thumbnailQueue.length > 0) {
    const next = thumbnailQueue.shift();
    generatePdfThumbnail(next.path, next.canvasId);
  }
}

/**
 * Display files in grid layout
 */
function displayFiles(files) {
  const list = document.getElementById('fileList');

  if (files.length === 0) {
    list.innerHTML = `
      <div class="file-grid">
        <div class="empty-state">
          <svg class="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.2"
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
          </svg>
          <p>No documents found</p>
          <small>Try a different folder or search term</small>
        </div>
      </div>`;
    return;
  }

  let html = '';
  if (files.length > 0) {
    html += `<div class="section-header"><h2>Your Collection</h2></div>`;
  }
  html += '<div class="file-grid">';
  files.forEach((file, i) => {
    const id = `thumb-${i}`;
    const safePath = file.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    html += `
      <div class="file-card" style="animation-delay:${i * 60}ms" onclick="openFile('${safePath}')">
        <div class="file-card-thumb">
          <canvas id="${id}" style="max-width:100%;max-height:100%"></canvas>
          <div class="thumb-overlay"></div>
        </div>
        <div class="file-card-info">
          <div class="file-card-name">${escapeHtml(file.name.replace(/\.pdf$/i, ''))}</div>
          <span class="file-ext-badge">PDF</span>
        </div>
      </div>`;
  });
  html += '</div>';
  list.innerHTML = html;

  files.forEach((file, i) => {
    setTimeout(() => {
      thumbnailQueue.push({ path: file.path, canvasId: `thumb-${i}` });
      processNextThumbnail();
    }, i * 100);
  });
}

/**
 * Handle search input (real-time filtering)
 */
async function handleSearch(e) {
  const term = document.getElementById('searchInput').value.toLowerCase();
  if (e.key === 'Enter') { await performSearch(); return; }
  if (!term) { displayFiles(allFiles); return; }
  displayFiles(allFiles.filter(f => f.name.toLowerCase().includes(term)));
}

/**
 * Perform backend search (opens matching files)
 */
async function performSearch() {
  const term = document.getElementById('searchInput').value.trim();
  const folder = document.getElementById('folderInput').value.trim();
  if (!term || !folder) { showMessage('Enter both folder and search term', 'error'); return; }
  clearMessage();
  showLoading();
  try {
    const res = await fetch('/api/search_files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `search=${encodeURIComponent(term)}&folder_name=${encodeURIComponent(folder)}`
    });
    if (res.ok) { showMessage('Opened matching files', 'success'); loadFiles(); }
    else showMessage('No files found', 'error');
  } catch (err) {
    showMessage(`Error: ${err.message}`, 'error');
  }
}

/**
 * Open PDF file in reading panel
 */
async function openFile(filePath) {
  localStorage.setItem('pdflib-last-file', filePath);
  // Open in in-browser reading panel
  await openReader(filePath);
}

/**
 * Show loading state
 */
function showLoading() {
  document.getElementById('fileList').innerHTML = `
    <div class="file-grid">
      <div class="loading-state">
        <div class="spinner-ring"></div>
        <p>Gathering your library…</p>
      </div>
    </div>`;
}

/**
 * Show message (error or success)
 */
function showMessage(text, type) {
  const icon = type === 'error'
    ? `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="1.8"/><path stroke-linecap="round" stroke-width="1.8" d="M12 8v4m0 4h.01"/></svg>`
    : `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M5 13l4 4L19 7"/></svg>`;
  document.getElementById('messageBox').innerHTML =
    `<div class="message ${type}-message">${icon}${escapeHtml(text)}</div>`;
}

/**
 * Clear message
 */
function clearMessage() { document.getElementById('messageBox').innerHTML = ''; }

/**
 * Show info bar with file count and path
 */
function showInfoBar(count, path) {
  const bar = document.getElementById('infoBar');
  bar.innerHTML = `<span><span class="info-count">${count} document${count !== 1 ? 's' : ''}</span> in <code>${escapeHtml(path)}</code></span>`;
  bar.classList.add('visible');
}

/**
 * Hide info bar
 */
function hideInfoBar() {
  document.getElementById('infoBar').classList.remove('visible');
}

/**
 * Clear all data and reset UI
 */
function clearAll() {
  document.getElementById('folderInput').value = 'Documents';
  document.getElementById('searchInput').value = '';
  localStorage.setItem('pdflib-folder', 'Documents');
  document.getElementById('fileList').innerHTML = '';
  hideInfoBar();
  clearMessage();
  allFiles = [];
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

/**
 * Open settings modal
 */
function openSettings() {
  document.getElementById('settingsModal').classList.add('active');
}

/**
 * Close settings modal
 */
function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active');
}

/**
 * Initialize event listeners
 */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target.id === 'settingsModal') closeSettings();
  });
});

/**
 * Load saved folder on page load
 */
window.addEventListener('load', loadSavedFolder);
