// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const DEFAULT_FOLDER = 'Documents';

// Common genres for music organisation
const COMMON_GENRES = [
  // FICTION
  'horror', 'romance', 'adventure', 'mystery', 'fantasy', 'science fiction', 'thriller',
  'crime', 'dystopian', 'historical fiction', 'literary fiction', 'western', 'mythology',
  'war fiction', 'gothic', 'comedy', 'drama',
  // NON-FICTION / ACADEMIC
  'computer science', 'programming', 'mathematics', 'engineering', 'physics', 'biology',
  'chemistry', 'medicine', 'self-help', 'biography', 'history', 'philosophy', 'psychology',
  'business', 'economics', 'politics', 'science', 'travel', 'religion', 'true crime',
  'memoir', 'art', 'cooking', 'sports',
  // CHILDREN / YA
  'children', 'young adult', 'fairy tale',
];

// ─── GLOBAL STATE ────────────────────────────────────────────────────────────

let allFiles = [];
let currentFolder = '';

// ─── GLOBAL FUNCTION REGISTRATION ───────────────────────────────────────────
// Register immediately so inline onclick handlers never throw on first paint.

(function registerGlobalFunctions() {
  window.openSettings = function () {
    document.getElementById('settingsModal').classList.add('active');
  };

  window.closeSettings = function () {
    document.getElementById('settingsModal').classList.remove('active');
  };

  window.toggleMusicConfig = function () {
    const section = document.getElementById('musicConfigSection');
    const isHidden = section.hidden;

    if (isHidden) {
      section.hidden = false;
      loadMusicSettingsUI();
    } else {
      section.hidden = true;
    }
  };

  window.selectFolderForGenre = function (genre) {
    const folderInput = document.getElementById(`genre-${genre}`);
    const currentPath = folderInput.value || '';

    const userInput = prompt(
      `Enter the full folder path for "${genre}" music:\n\n` +
      `Examples:\n` +
      `Windows: C:\\Users\\YOUR_NAME\\Music\\${genre}\n` +
      `Mac: /Users/YOUR_NAME/Music/${genre}\n` +
      `Linux: ~/Music/${genre}`,
      currentPath
    );

    if (userInput && userInput.trim()) {
      folderInput.value = userInput.trim();
      folderInput.dataset.folder = userInput.trim();
      showMessage(`Folder set for ${genre}`, 'success');
    }
  };

  window.saveMusicSettings = async function () {
    const entries = COMMON_GENRES
      .map(genre => {
        const input = document.getElementById(`genre-${genre}`);
        const folder = (input?.value || input?.dataset.folder || '').trim();
        return folder ? { genre, folder } : null;
      })
      .filter(Boolean);

    if (entries.length === 0) {
      showMessage('No music folders configured', 'warning');
      return;
    }

    const results = await Promise.allSettled(
      entries.map(({ genre, folder }) =>
        fetch('/api/set-music-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ genre, folder }),
        }).then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return genre;
        })
      )
    );

    const failed = results
      .filter(r => r.status === 'rejected')
      .map((_, i) => entries[i].genre);

    if (failed.length > 0) {
      showMessage(`Failed to save: ${failed.join(', ')}. Check folder paths exist.`, 'error');
    } else {
      showMessage(`Saved music folders for ${entries.length} genre(s)`, 'success');
    }
  };
})();

// ─── FILE LOADING ─────────────────────────────────────────────────────────────

/**
 * Restore saved folder from localStorage on page load.
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
 * Fetch and display files from the configured folder.
 */
async function loadFiles() {
  const folderName = document.getElementById('folderInput').value.trim();
  if (!folderName) { showMessage('Enter a folder name', 'error'); return; }

  localStorage.setItem('pdflib-folder', folderName);
  clearMessage();
  showLoading();
  currentFolder = folderName;

  try {
    const [folderRes, filesRes] = await Promise.all([
      fetch(`/api/get_folder?folder_name=${encodeURIComponent(folderName)}`),
      fetch(`/api/get_files?folder_name=${encodeURIComponent(folderName)}`),
    ]);

    if (!folderRes.ok) {
      showMessage('Folder not found', 'error');
      document.getElementById('fileList').innerHTML = '';
      hideInfoBar();
      return;
    }

    if (!filesRes.ok) {
      showMessage('Could not load files', 'error');
      document.getElementById('fileList').innerHTML = '';
      hideInfoBar();
      return;
    }

    const [folderData, filesData] = await Promise.all([folderRes.json(), filesRes.json()]);
    const folderPath = folderData.Folder;

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

// ─── THUMBNAIL RENDERING ─────────────────────────────────────────────────────

/**
 * Generate thumbnail for a single PDF (lazy, IntersectionObserver-driven).
 */
async function generatePdfThumbnailLazy(filePath, elementId) {
  const thumbDiv = document.querySelector(`[data-thumbnail-id="${elementId}"]`);
  if (!thumbDiv) return;

  try {
    const pdf = await pdfjsLib.getDocument({
      url: `/api/pdf?file_path=${encodeURIComponent(filePath)}`,
      withCredentials: false,
    }).promise;

    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 0.8 });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.cssText = 'max-width:100%;max-height:100%;display:block;';

    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    const overlay = document.createElement('div');
    overlay.className = 'thumb-overlay';

    thumbDiv.innerHTML = '';
    thumbDiv.append(canvas, overlay);

    pdf.destroy();
  } catch (err) {
    console.warn(`Thumbnail failed for ${filePath}:`, err.message);
  }
}

// ─── DISPLAY ──────────────────────────────────────────────────────────────────

/**
 * Render the file grid from a file array.
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

  let html = '<div class="file-grid">';

  files.forEach((file, index) => {
    const id = `thumb-${index}`;
    const delay = Math.min(index * 0.04, 0.6);
    html += `
      <div class="file-card" data-file-path="${escapeHtml(file.path)}"
           onclick="openFile('${escapeHtml(file.path)}')"
           style="animation-delay:${delay}s">
        <div class="file-card-thumb" data-thumbnail-id="${id}">
          <div class="thumb-placeholder">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
            </svg>
            <span>PDF</span>
          </div>
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

  // Lazy-load thumbnails via IntersectionObserver
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const thumbDiv = entry.target;
      if (thumbDiv.dataset.loaded) return;
      thumbDiv.dataset.loaded = 'true';
      observer.unobserve(thumbDiv);
      const filePath = thumbDiv.closest('.file-card').getAttribute('data-file-path');
      generatePdfThumbnailLazy(filePath, thumbDiv.dataset.thumbnailId);
    });
  }, { rootMargin: '100px' });

  document.querySelectorAll('.file-card-thumb').forEach(thumb => observer.observe(thumb));
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────

/**
 * Real-time client-side filtering as the user types.
 */
async function handleSearch(e) {
  const term = document.getElementById('searchInput').value.toLowerCase();
  if (e.key === 'Enter') { await performSearch(); return; }
  displayFiles(term ? allFiles.filter(f => f.name.toLowerCase().includes(term)) : allFiles);
}

/**
 * Full-text backend search (opens matching files).
 */
async function performSearch() {
  const term   = document.getElementById('searchInput').value.trim();
  const folder = document.getElementById('folderInput').value.trim();
  if (!term || !folder) { showMessage('Enter both folder and search term', 'error'); return; }

  clearMessage();
  showLoading();

  try {
    const res = await fetch('/api/search_files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `search=${encodeURIComponent(term)}&folder_name=${encodeURIComponent(folder)}`,
    });

    if (res.ok) { showMessage('Opened matching files', 'success'); loadFiles(); }
    else showMessage('No files found', 'error');
  } catch (err) {
    showMessage(`Error: ${err.message}`, 'error');
  }
}

// ─── FILE OPEN ────────────────────────────────────────────────────────────────

async function openFile(filePath) {
  localStorage.setItem('pdflib-last-file', filePath);
  await openReader(filePath);
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────

function showLoading() {
  document.getElementById('fileList').innerHTML = `
    <div class="file-grid">
      <div class="loading-state">
        <div class="spinner-ring"></div>
        <p>Gathering your library…</p>
      </div>
    </div>`;
}

function showMessage(text, type = 'info') {
  const icons = {
    error:   `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="1.8"/><path stroke-linecap="round" stroke-width="1.8" d="M12 8v4m0 4h.01"/></svg>`,
    success: `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M5 13l4 4L19 7"/></svg>`,
    warning: `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>`,
    info:    `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="1.8"/><path stroke-linecap="round" stroke-width="1.8" d="M12 16v-4m0-4h.01"/></svg>`,
  };
  document.getElementById('messageBox').innerHTML =
    `<div class="message ${type}-message">${icons[type] ?? ''}${escapeHtml(text)}</div>`;
}

function clearMessage() {
  document.getElementById('messageBox').innerHTML = '';
}

function showInfoBar(count, path) {
  const bar = document.getElementById('infoBar');
  bar.innerHTML = `<span><span class="info-count">${count} document${count !== 1 ? 's' : ''}</span> in <code>${escapeHtml(path)}</code></span>`;
  bar.classList.add('visible');
}

function hideInfoBar() {
  document.getElementById('infoBar').classList.remove('visible');
}

function clearAll() {
  document.getElementById('folderInput').value = DEFAULT_FOLDER;
  document.getElementById('searchInput').value = '';
  localStorage.setItem('pdflib-folder', DEFAULT_FOLDER);
  document.getElementById('fileList').innerHTML = '';
  hideInfoBar();
  clearMessage();
  allFiles = [];
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// ─── MUSIC CONFIG UI ─────────────────────────────────────────────────────────

/**
 * Build the music-genre configuration UI.
 * Fetches all saved folders in parallel (Promise.all) instead of sequentially.
 */
async function loadMusicSettingsUI() {
  const genreList = document.getElementById('genreListMain');
  if (!genreList) return;

  // Render genre inputs first so the panel isn't empty while fetching
  genreList.innerHTML = COMMON_GENRES.map(genre => `
    <div class="genre-config">
      <label for="genre-${genre}">${genre}</label>
      <input type="text" id="genre-${genre}" placeholder="No folder selected" readonly>
      <button class="folder-picker-btn" onclick="selectFolderForGenre('${genre}')">Browse</button>
    </div>`
  ).join('');

  // Fetch all saved folders in parallel
  const fetches = COMMON_GENRES.map(genre =>
    fetch(`/api/get-music-files?genre=${encodeURIComponent(genre)}`)
      .then(res => res.ok ? res.json() : null)
      .catch(() => null)
  );

  const results = await Promise.all(fetches);

  results.forEach((data, i) => {
    if (!data?.folder?.trim()) return;
    const input = document.getElementById(`genre-${COMMON_GENRES[i]}`);
    if (input) {
      input.value = data.folder;
      input.dataset.folder = data.folder;
    }
  });
}

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Close modal on backdrop click
  document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target.id === 'settingsModal') window.closeSettings();
  });
});

window.addEventListener('load', loadSavedFolder);
