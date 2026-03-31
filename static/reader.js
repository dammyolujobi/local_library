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
  pageDimensions: {},
  renderQueue: [],
  isRendering: false
};

/**
 * Open PDF in reading panel
 */
async function openReader(filePath) {
  try {
    readerState.currentFile = filePath;
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

    // Load saved reading position
    const savedProgress = getReadingProgress(filePath);
    if (savedProgress) {
      readerState.currentPage = savedProgress.pageNumber || 1;
      readerState.scrollOffset = savedProgress.scrollOffset || 0;
    } else {
      readerState.currentPage = 1;
      readerState.scrollOffset = 0;
    }

    // Load and render PDF
    await loadPdfDocument(filePath);
    await renderAllPages();
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
  
  // Add scroll listener to track current page
  const viewport = document.getElementById('readerViewport');
  viewport.addEventListener('scroll', () => {
    updateCurrentPageFromScroll();
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
async function renderAllPages() {
  if (!readerState.pdf) return;

  const container = document.getElementById('pagesContainer');
  container.innerHTML = '';
  readerState.pageDimensions = {};

  // Render all pages asynchronously with queue to avoid memory issues
  for (let pageNum = 1; pageNum <= readerState.totalPages; pageNum++) {
    readerState.renderQueue.push(pageNum);
  }

  // Process render queue with max 2 concurrent renders
  const maxConcurrent = 2;
  let activeRenders = 0;

  while (readerState.renderQueue.length > 0 || activeRenders > 0) {
    // Start new renders if we have capacity
    while (activeRenders < maxConcurrent && readerState.renderQueue.length > 0) {
      const pageNum = readerState.renderQueue.shift();
      activeRenders++;

      renderPageToContainer(pageNum).then(() => {
        activeRenders--;
      }).catch(err => {
        console.error(`Error rendering page ${pageNum}:`, err);
        activeRenders--;
      });
    }

    // Wait for at least one render to complete
    if (activeRenders > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Restore scroll position
  const viewport = document.getElementById('readerViewport');
  if (readerState.scrollOffset > 0) {
    viewport.scrollTop = readerState.scrollOffset;
  } else {
    // Scroll to current page
    const firstPageElement = container.querySelector(`[data-page="1"]`);
    if (firstPageElement) {
      firstPageElement.scrollIntoView({ behavior: 'instant' });
    }
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
      span.style.top = Math.round((viewport.height / dpr) - (item.transform[5] * baseScale) - (item.height * baseScale)) + 'px';
      span.style.fontFamily = item.fontName || 'serif';
      span.style.userSelect = 'text';
      span.style.color = 'transparent';
      span.className = 'text-item';

      textLayer.appendChild(span);
    });

    pageWrapper.appendChild(canvas);
    pageWrapper.appendChild(textLayer);

    // Store dimensions for current page tracking
    readerState.pageDimensions[pageNum] = {
      offsetTop: pageWrapper.offsetTop,
      height: viewport.height
    };

    // Add to container
    const container = document.getElementById('pagesContainer');
    container.appendChild(pageWrapper);

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
  const viewport = document.getElementById('readerViewport');
  const pageElement = document.querySelector(`[data-page="${pageNum}"]`);
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
  await renderAllPages();
}

/**
 * Zoom out
 */
async function zoomOut() {
  readerState.zoomLevel = Math.max(readerState.zoomLevel - 25, 50);
  updateZoomDisplay();
  await renderAllPages();
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

  viewport.addEventListener('mousemove', () => {
    toolbar.classList.remove('hidden');
    resetHideTimer();
  });

  toolbar.addEventListener('mouseenter', () => {
    clearTimeout(hideTimeout);
    toolbar.classList.remove('hidden');
  });
}

/**
 * Close reader panel
 */
function closeReader() {
  readerState.isOpen = false;
  readerState.isReading = false;

  // Save final reading progress
  if (readerState.currentFile) {
    saveReadingProgress(readerState.currentFile, readerState.currentPage, readerState.scrollOffset);
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
}

/**
 * Save reading progress to localStorage
 */
function saveReadingProgress(filePath, pageNumber, scrollOffset) {
  const progress = {
    filePath,
    pageNumber,
    scrollOffset,
    timestamp: Date.now()
  };

  const key = `pdflib-progress-${encodeURIComponent(filePath)}`;
  localStorage.setItem(key, JSON.stringify(progress));
}

/**
 * Get saved reading progress from localStorage
 */
function getReadingProgress(filePath) {
  const key = `pdflib-progress-${encodeURIComponent(filePath)}`;
  const saved = localStorage.getItem(key);
  return saved ? JSON.parse(saved) : null;
}

/**
 * Clear reading progress for a file
 */
function clearReadingProgress(filePath) {
  const key = `pdflib-progress-${encodeURIComponent(filePath)}`;
  localStorage.removeItem(key);
}

/**
 * Get all reading progress entries
 */
function getAllReadingProgress() {
  const all = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('pdflib-progress-')) {
      all[key] = JSON.parse(localStorage.getItem(key));
    }
  }
  return all;
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
    renderAllPages();
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
 * UPDATE: Modify openFile() to use reader instead of system open
 * This will be patched into app.js
 */
const originalOpenFile = openFile;
async function openFile(filePath) {
  // Option 1: Open in reading panel (new behavior)
  await openReader(filePath);

  // Option 2: Keep system open as fallback
  // Uncomment below to disable in-browser reading:
  // await originalOpenFile(filePath);
}
