/**
 * PDF Reading Panel
 * In-browser document viewer with progress tracking and reading modes
 */

let readerState = {
  isOpen: false,
  currentFile: null,
  currentPage: 1,
  totalPages: 0,
  pdf: null,
  isReading: false,
  zoomLevel: 100,
  displayMode: 'continuous',
  scrollOffset: 0,
  renderQueue: [],
  renderGeneration: 0,
  _handleMouseMove: null,
  _handleMouseEnter: null,
  _scrollRAF: null,
  _autoSaveInterval: null,
  bookGenre: 'unknown',
  currentMusicIndex: 0,
  musicFiles: [],
  musicPlayer: null
};

/**
 * Open PDF in reading panel
 */
async function openReader(filePath) {
  try {
    // If switching files, save progress of previous file first
    if (readerState.currentFile && readerState.currentFile !== filePath && readerState.isOpen) {
      saveReadingProgress(readerState.currentFile, readerState.currentPage, readerState.scrollOffset);
    }

    // Clear state for new file
    readerState.currentFile = filePath;
    readerState.currentPage = 1;
    readerState.scrollOffset = 0;
    readerState.isOpen = true;

    // Create/show reader panel
    let panel = document.getElementById('readerPanel');
    if (!panel) {
      createReaderPanel();
      panel = document.getElementById('readerPanel');
    }
    
    // Small delay to ensure DOM is ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    panel.classList.add('active');

    // Hide main library UI
    document.querySelector('.page').classList.add('reading-mode-active');

    // Load saved reading position and genre from database
    try {
      const response = await fetch(`/api/get-page?file_path=${encodeURIComponent(filePath)}`);
      if (response.ok) {
        const data = await response.json();
        readerState.currentPage = data.page || 1;
        readerState.bookGenre = data.genre || 'unknown';
        readerState.scrollOffset = 0;
      }
    } catch (err) {
      console.warn('Failed to load page from database:', err);
      readerState.currentPage = 1;
      readerState.bookGenre = 'unknown';
    }

    // Load and render PDF
    await loadPdfDocument(filePath);
    await renderAllPages();
    
    // Load and play music for the book genre
    await loadMusicForGenre(readerState.bookGenre);
    
    enterReadingMode();

  } catch (err) {
    console.error('Error opening reader:', err);
    showMessage(`Error opening reader: ${err.message}`, 'error');
  }
}

/**
 * Create reader panel DOM structure
 */
function createReaderPanel() {
  const panel = document.createElement('div');
  panel.id = 'readerPanel';
  panel.className = 'reader-panel';
  panel.innerHTML = `
    <div class="reader-toolbar">
      <button class="reader-btn" onclick="closeReader()" title="Close reading panel">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
      
      <div class="reader-info">
        <span class="reader-page-display"><span id="currentPageNum">1</span> / <span id="totalPageNum">1</span></span>
      </div>

      <div class="reader-tools">
        <button class="reader-btn zoom-btn" onclick="zoomOut()" title="Zoom out">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" stroke-width="1.5"/>
            <path stroke-linecap="round" stroke-width="1.5" d="M21 21l-4.35-4.35M8 11h6"/>
          </svg>
        </button>
        <span class="zoom-display" id="zoomDisplay">100%</span>
        <button class="reader-btn zoom-btn" onclick="zoomIn()" title="Zoom in">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" stroke-width="1.5"/>
            <path stroke-linecap="round" stroke-width="1.5" d="M21 21l-4.35-4.35M11 8v6m3-3H8"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="reader-viewport continuous-mode" id="readerViewport">
      <div id="pagesContainer" style="display:flex;flex-direction:column;align-items:center;width:100%;gap:20px;padding:20px;">
        <!-- Pages will be rendered here -->
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  
  // Add throttled scroll listener to track current page
  const viewport = document.getElementById('readerViewport');
  viewport.addEventListener('scroll', () => {
    if (readerState._scrollRAF) cancelAnimationFrame(readerState._scrollRAF);
    readerState._scrollRAF = requestAnimationFrame(() => {
      updateCurrentPageFromScroll();
      readerState._scrollRAF = null;
    });
  });
}

/**
 * Load PDF document
 */
async function loadPdfDocument(filePath) {
  try {
    if (readerState.pdf) {
      readerState.pdf.destroy();
    }

    readerState.pdf = await pdfjsLib.getDocument({
      url: `/api/pdf?file_path=${encodeURIComponent(filePath)}`,
      withCredentials: false
    }).promise;

    readerState.totalPages = readerState.pdf.numPages;
    document.getElementById('totalPageNum').textContent = readerState.totalPages;

  } catch (err) {
    throw new Error(`Failed to load PDF: ${err.message}`);
  }
}

/**
 * Render all pages in continuous scroll mode
 */
async function renderAllPages(preserveScroll = false) {
  if (!readerState.pdf) return;

  // Save current scroll position if needed
  let savedScrollTop = 0;
  if (preserveScroll) {
    const viewport = document.getElementById('readerViewport');
    savedScrollTop = viewport.scrollTop;
  }

  const container = document.getElementById('pagesContainer');
  container.innerHTML = '';

  // Clear render queue before starting
  readerState.renderQueue = [];

  // Track render generation to cancel stale renders
  const generation = ++readerState.renderGeneration;

  // Pre-insert placeholder wrappers to maintain DOM order
  for (let pageNum = 1; pageNum <= readerState.totalPages; pageNum++) {
    const placeholder = document.createElement('div');
    placeholder.setAttribute('data-page', pageNum);
    placeholder.className = 'pdf-page';
    placeholder.style.position = 'relative';
    placeholder.style.backgroundColor = '#f0f0f0';
    placeholder.style.minHeight = '400px';
    container.appendChild(placeholder);
    readerState.renderQueue.push(pageNum);
  }

  // Render all pages with semaphore-based concurrency
  const maxConcurrent = 2;
  let active = 0;
  let resolveAll;
  const done = new Promise(r => resolveAll = r);
  const total = readerState.renderQueue.length;
  let completed = 0;

  function runNext() {
    while (active < maxConcurrent && readerState.renderQueue.length > 0) {
      const pageNum = readerState.renderQueue.shift();
      active++;
      renderPageToContainer(pageNum)
        .catch(err => console.error(`Error rendering page ${pageNum}:`, err))
        .finally(() => {
          active--;
          completed++;
          if (readerState.renderGeneration !== generation) return; // stale, abort
          if (completed === total) resolveAll();
          else runNext();
        });
    }
  }

  runNext();
  await done;

  // Cancel if this render was superseded
  if (readerState.renderGeneration !== generation) return;

  // Wait longer for browser to finish layout after all DOM replacements
  // Using multiple animation frames to ensure pages have painted their heights
  await new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 50);
      });
    });
  });

  const viewport = document.getElementById('readerViewport');
  
  // Always scroll to current page first
  const targetPage = container.querySelector(`[data-page="${readerState.currentPage}"]`);
  if (targetPage) {
    targetPage.scrollIntoView({ behavior: 'instant' });
  }

  // Then apply exact scroll offset if we're preserving scroll from same session
  if (preserveScroll && savedScrollTop > 0) {
    // Small delay to ensure scrollIntoView completed
    await new Promise(resolve => setTimeout(resolve, 10));
    viewport.scrollTop = savedScrollTop;
  } else if (readerState.scrollOffset > 0 && readerState.currentPage > 1) {
    // Only apply scrollOffset if we have a meaningful page number (don't apply to page 1)
    // This prevents cross-PDF offset issues
    await new Promise(resolve => setTimeout(resolve, 10));
    viewport.scrollTop = readerState.scrollOffset;
  }
}

/**
 * Render a single page to container
 */
async function renderPageToContainer(pageNum) {
  try {
    if (!readerState.pdf || pageNum < 1 || pageNum > readerState.totalPages) {
      return;
    }

    const page = await readerState.pdf.getPage(pageNum);
    const dpr = window.devicePixelRatio || 1;
    const baseScale = readerState.zoomLevel / 100;
    const viewport = page.getViewport({ scale: baseScale });

    // Create page wrapper
    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'pdf-page';
    pageWrapper.setAttribute('data-page', pageNum);
    pageWrapper.style.position = 'relative';
    pageWrapper.style.width = Math.round(viewport.width) + 'px';
    pageWrapper.style.height = Math.round(viewport.height) + 'px';
    pageWrapper.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    pageWrapper.style.backgroundColor = 'white';

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-canvas';
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    canvas.style.display = 'block';
    canvas.style.width = Math.round(viewport.width) + 'px';
    canvas.style.height = Math.round(viewport.height) + 'px';

    // Get canvas context with proper DPI support
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Render PDF page
    const renderTask = page.render({
      canvasContext: ctx,
      viewport: viewport
    });

    await renderTask.promise;

    // Create text layer
    const textLayer = document.createElement('div');
    textLayer.className = 'text-layer';
    textLayer.style.position = 'absolute';
    textLayer.style.left = '0';
    textLayer.style.top = '0';
    textLayer.style.width = '100%';
    textLayer.style.height = '100%';
    textLayer.style.zIndex = '1';

    // Add text items for selection
    const textContent = await page.getTextContent();
    textContent.items.forEach(item => {
      const span = document.createElement('span');
      span.textContent = item.str;
      span.style.position = 'absolute';
      span.style.fontSize = Math.round(item.height * baseScale) + 'px';
      span.style.left = Math.round(item.transform[4] * baseScale) + 'px';
      span.style.top = Math.round(viewport.height - (item.transform[5] * baseScale) - (item.height * baseScale)) + 'px';
      span.style.fontFamily = item.fontName || 'serif';
      span.style.userSelect = 'text';
      span.style.color = 'transparent';
      span.className = 'text-item';

      textLayer.appendChild(span);
    });

    pageWrapper.appendChild(canvas);
    pageWrapper.appendChild(textLayer);

    // Replace placeholder with actual rendered page
    const container = document.getElementById('pagesContainer');
    const existing = container.querySelector(`[data-page="${pageNum}"]`);
    if (existing) {
      existing.replaceWith(pageWrapper);
    } else {
      container.appendChild(pageWrapper);
    }

  } catch (err) {
    console.error(`Error rendering page ${pageNum}:`, err);
  }
}

/**
 * Update current page based on scroll position
 */
function updateCurrentPageFromScroll() {
  const viewport = document.getElementById('readerViewport');
  const scrollTop = viewport.scrollTop;
  const viewportHeight = viewport.clientHeight;
  const centerY = scrollTop + viewportHeight / 2;

  const container = document.getElementById('pagesContainer');
  const pages = container.querySelectorAll('[data-page]');

  let currentPage = 1;
  pages.forEach(pageEl => {
    const pageNum = parseInt(pageEl.getAttribute('data-page'));
    const pageTop = pageEl.offsetTop;
    const pageBottom = pageTop + pageEl.offsetHeight;

    if (centerY >= pageTop && centerY <= pageBottom) {
      currentPage = pageNum;
    }
  });

  readerState.currentPage = currentPage;
  document.getElementById('currentPageNum').textContent = currentPage;

  // Save scroll position
  readerState.scrollOffset = scrollTop;
}

/**
 * Navigate to specific page
 */
async function goToPage(pageNum) {
  const container = document.getElementById('pagesContainer');
  const pageElement = container.querySelector(`[data-page="${pageNum}"]`);
  if (pageElement) {
    pageElement.scrollIntoView({ behavior: 'smooth' });
  }
}

/**
 * Previous page
 */
async function previousPage() {
  if (readerState.currentPage > 1) {
    await goToPage(readerState.currentPage - 1);
  }
}

/**
 * Next page
 */
async function nextPage() {
  if (readerState.currentPage < readerState.totalPages) {
    await goToPage(readerState.currentPage + 1);
  }
}

/**
 * Zoom in
 */
async function zoomIn() {
  readerState.zoomLevel = Math.min(readerState.zoomLevel + 25, 400);
  updateZoomDisplay();
  await renderAllPages(true);
}

/**
 * Zoom out
 */
async function zoomOut() {
  readerState.zoomLevel = Math.max(readerState.zoomLevel - 25, 50);
  updateZoomDisplay();
  await renderAllPages(true);
}

/**
 * Update zoom display
 */
function updateZoomDisplay() {
  document.getElementById('zoomDisplay').textContent = readerState.zoomLevel + '%';
}

/**
 * Set display mode (continuous scroll only)
 */
function setDisplayMode(mode) {
  readerState.displayMode = 'continuous';
  // Always use continuous scroll mode
}

/**
 * Enter reading mode (fade out main UI, show toolbar)
 */
function enterReadingMode() {
  if (readerState.isReading) return; // Prevent duplicate setup
  
  readerState.isReading = true;
  const toolbar = document.querySelector('.reader-toolbar');
  const viewport = document.getElementById('readerViewport');

  toolbar.classList.add('visible');
  viewport.classList.add('visible');

  // Auto-hide toolbar on idle
  let hideTimeout;
  function resetHideTimer() {
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      if (readerState.isReading && !document.querySelector('.reader-toolbar:hover')) {
        toolbar.classList.add('hidden');
      }
    }, 5000);
  }

  // Store handlers on readerState for cleanup
  readerState._handleMouseMove = () => {
    toolbar.classList.remove('hidden');
    resetHideTimer();
  };

  readerState._handleMouseEnter = () => {
    clearTimeout(hideTimeout);
    toolbar.classList.remove('hidden');
  };

  viewport.addEventListener('mousemove', readerState._handleMouseMove);
  toolbar.addEventListener('mouseenter', readerState._handleMouseEnter);

  // Autosave progress every 3 seconds
  if (readerState._autoSaveInterval) clearInterval(readerState._autoSaveInterval);
  readerState._autoSaveInterval = setInterval(() => {
    if (readerState.currentFile && readerState.isReading) {
      saveReadingProgress(readerState.currentFile, readerState.currentPage, readerState.scrollOffset);
    }
  }, 3000);
}

/**
 * Close reader panel
 */
function closeReader() {
  // Save final reading progress BEFORE resetting state
  if (readerState.currentFile) {
    saveReadingProgress(readerState.currentFile, readerState.currentPage, readerState.scrollOffset);
  }

  readerState.isOpen = false;
  readerState.isReading = false;
  readerState.scrollOffset = 0;
  readerState.currentPage = 1;

  // Clear autosave interval
  if (readerState._autoSaveInterval) {
    clearInterval(readerState._autoSaveInterval);
    readerState._autoSaveInterval = null;
  }

  // Clear pending scroll RAF
  if (readerState._scrollRAF) {
    cancelAnimationFrame(readerState._scrollRAF);
    readerState._scrollRAF = null;
  }

  // Remove event listeners
  const viewport = document.getElementById('readerViewport');
  const toolbar = document.querySelector('.reader-toolbar');
  if (viewport && readerState._handleMouseMove) {
    viewport.removeEventListener('mousemove', readerState._handleMouseMove);
  }
  if (toolbar && readerState._handleMouseEnter) {
    toolbar.removeEventListener('mouseenter', readerState._handleMouseEnter);
  }

  // Hide reader
  const panel = document.getElementById('readerPanel');
  if (panel) panel.classList.remove('active');

  // Show main library UI
  document.querySelector('.page').classList.remove('reading-mode-active');

  // Clean up PDF
  if (readerState.pdf) {
    readerState.pdf.destroy();
    readerState.pdf = null;
  }

  // Stop music playback
  if (readerState.musicPlayer) {
    readerState.musicPlayer.pause();
    readerState.musicPlayer.src = '';
    readerState.musicPlayer = null;
  }
  readerState.musicFiles = [];
  readerState.currentMusicIndex = 0;
}

/**
 * Save reading progress to database
 */
function saveReadingProgress(filePath, pageNumber, scrollOffset) {
  // Save to database
  fetch('/api/update-page', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      path: filePath,
      page: pageNumber
    })
  }).catch(err => console.warn('Failed to save page to database:', err));
}



/**
 * Keyboard navigation for reader
 */
document.addEventListener('keydown', (e) => {
  if (!readerState.isReading) return;

  // Escape: close reader
  if (e.key === 'Escape') {
    closeReader();
  }

  // + / = : zoom in
  if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    zoomIn();
  }

  // - : zoom out
  if (e.key === '-') {
    e.preventDefault();
    zoomOut();
  }

  // Ctrl/Cmd + 0: reset zoom
  if ((e.ctrlKey || e.metaKey) && e.key === '0') {
    e.preventDefault();
    readerState.zoomLevel = 100;
    updateZoomDisplay();
    renderAllPages(true);
  }

  // Page Down or Right Arrow: next page
  if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !e.ctrlKey)) {
    e.preventDefault();
    nextPage();
  }

  // Page Up or Left Arrow: previous page
  if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !e.ctrlKey)) {
    e.preventDefault();
    previousPage();
  }
});

/**
 * Load and initialize music for a genre
 */
async function loadMusicForGenre(genre) {
  try {
    const response = await fetch(`/api/get-music-files?genre=${encodeURIComponent(genre)}`);
    if (response.ok) {
      const data = await response.json();
      readerState.musicFiles = data.files || [];
      readerState.currentMusicIndex = 0;

      if (readerState.musicFiles.length > 0) {
        console.log(`Loading music for genre: ${genre} (${readerState.musicFiles.length} files)`);
        playMusicTrack(0);
      }
    }
  } catch (err) {
    console.warn('Failed to load music files:', err);
  }
}

/**
 * Play a specific music track
 */
function playMusicTrack(index) {
  if (index < 0 || index >= readerState.musicFiles.length) return;

  readerState.currentMusicIndex = index;
  const track = readerState.musicFiles[index];

  // Destroy existing player if any
  if (readerState.musicPlayer) {
    readerState.musicPlayer.pause();
    readerState.musicPlayer.src = '';
    readerState.musicPlayer = null; // Clear player reference
  }

  // Create new audio element
  readerState.musicPlayer = new Audio();
  readerState.musicPlayer.volume = 0.3; // Start at 30% volume
  readerState.musicPlayer.addEventListener('ended', () => {
    playNextTrack();
  });

  // Set source and play
  readerState.musicPlayer.src = `/api/music-file?path=${encodeURIComponent(track.path)}`;
  readerState.musicPlayer.play().catch(err => {
    console.warn('Failed to play music:', err);
  });

  console.log(`🎵 Now playing: ${track.name}`);
}

/**
 * Play next music track
 */
function playNextTrack() {
  const next = (readerState.currentMusicIndex + 1) % readerState.musicFiles.length;
  playMusicTrack(next);
}

/**
 * Play previous music track
 */
function playPreviousTrack() {
  const prev = (readerState.currentMusicIndex - 1 + readerState.musicFiles.length) % readerState.musicFiles.length;
  playMusicTrack(prev);
}

/**
 * Toggle music playback
 */
function toggleMusicPlayback() {
  if (!readerState.musicPlayer) return;
  
  if (readerState.musicPlayer.paused) {
    readerState.musicPlayer.play();
  } else {
    readerState.musicPlayer.pause();
  }
}

/**
 * Set music volume (0-100)
 */
function setMusicVolume(percentage) {
  if (!readerState.musicPlayer) return;
  readerState.musicPlayer.volume = Math.max(0, Math.min(1, percentage / 100));
}

// NOTE: openFile behavior is controlled in app.js, not here
