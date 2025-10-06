// Rabbit Receipt Scanner
// feat: Rabbit R1 Hardware Integration (Scrollwheel, PTT, Storage), optimized preprocessing, robust error handling
// - Pre-OCR image preprocessing (brightness/grayscale/threshold)
// - Scrollwheel: navigate/zoom; PTT: trigger capture; Storage: persist tokens/images
// - OCR languages: 'deu+eng'
// - Defensive null checks and try/catch to avoid common errors (e.g., SetImageFile null)
// - Web UI fallbacks if Rabbit APIs not available
(function () {
  'use strict';
  /* =============================
   * Utilities
   * ============================= */
  function errToString(err) {
    try { return (err && (err.message || (err.toString && err.toString()))) || JSON.stringify(err) || 'Unknown error'; }
    catch { return 'Unknown error'; }
  }
  const hasRabbit = () => typeof rabbit !== 'undefined';

  /* =============================
   * State
   * ============================= */
  let stream = null, isScanning = false, currentState = 'idle';
  let capturedImageData = null, ocrResultText = '';
  let statusText, scanBtn, cameraContainer, video, canvas, preview, previewImg;
  let results, ocrText, processing, processText, retryBtn, captureBtn, actions;
  // Zoom state for scrollwheel
  let zoom = 1.0; const ZOOM_MIN = 0.75, ZOOM_MAX = 2.0, ZOOM_STEP = 0.1;

  /* =============================
   * Storage Abstraction (Rabbit storage -> fallback localStorage)
   * ============================= */
  const storage = {
    async set(key, value) {
      try {
        if (hasRabbit() && rabbit.storage && typeof rabbit.storage.setItem === 'function') {
          return await rabbit.storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
      } catch (e) { console.warn('[STORAGE] set failed:', errToString(e)); }
    },
    async get(key) {
      try {
        if (hasRabbit() && rabbit.storage && typeof rabbit.storage.getItem === 'function') {
          return await rabbit.storage.getItem(key);
        }
        if (typeof localStorage !== 'undefined') {
          return localStorage.getItem(key);
        }
        return null;
      } catch (e) { console.warn('[STORAGE] get failed:', errToString(e)); return null; }
    }
  };

  /* =============================
   * UI Init
   * ============================= */
  function init() {
    try {
      console.log('[INIT] Initializing Receipt Scanner...');
      statusText = document.getElementById('statusText');
      scanBtn = document.getElementById('scanBtn');
      cameraContainer = document.getElementById('cameraContainer');
      video = document.getElementById('video');
      canvas = document.getElementById('canvas');
      preview = document.getElementById('preview');
      previewImg = document.getElementById('previewImg');
      results = document.getElementById('results');
      ocrText = document.getElementById('ocrText');
      processing = document.getElementById('processing');
      processText = document.getElementById('processText');
      retryBtn = document.getElementById('retryBtn');
      captureBtn = document.getElementById('captureBtn');
      actions = document.getElementById('actions');

      if (statusText) statusText.setAttribute('title', 'Scrollwheel: Zoom/Scroll • PTT: Capture');

      if (scanBtn) scanBtn.addEventListener('click', (e) => { e.preventDefault(); startCamera(); });
      if (video) video.addEventListener('click', captureImage);
      if (cameraContainer) cameraContainer.addEventListener('click', captureImage);
      if (captureBtn) captureBtn.addEventListener('click', captureImage);
      if (retryBtn) retryBtn.addEventListener('click', reset);

      bindScrollwheel();
      bindPTT();
      restorePersistedState();
      console.log('[INIT] Receipt Scanner initialized successfully');
    } catch (e) {
      console.error('[INIT] Failed:', errToString(e));
      alert('Initialization error: ' + errToString(e));
    }
  }

  async function restorePersistedState() {
    try {
      const lastImage = await storage.get('r1.lastImage');
      if (lastImage && previewImg) {
        capturedImageData = lastImage; previewImg.src = capturedImageData;
      }
    } catch (e) { console.warn('[RESTORE] No persisted state found'); }
  }

  /* =============================
   * Rabbit R1 Hardware Integrations
   * - Scrollwheel: zoom in preview/camera; scroll results
   * - PTT: trigger capture when camera is active, or start camera from idle
   * ============================= */
  function bindScrollwheel() {
    try {
      // Web fallback: mouse wheel
      document.addEventListener('wheel', (ev) => {
        if (currentState === 'camera' || currentState === 'preview' || currentState === 'processing') {
          const delta = ev.deltaY < 0 ? 1 : -1; applyZoom(delta);
        } else if (currentState === 'results') {
          if (results) results.scrollTop += ev.deltaY;
        }
      }, { passive: true });
      // Rabbit SDK, if available
      if (hasRabbit() && rabbit.hardware && typeof rabbit.hardware.onScroll === 'function') {
        rabbit.hardware.onScroll(({ direction }) => { const delta = direction === 'up' ? 1 : -1; applyZoom(delta); });
      }
    } catch (e) { console.warn('[R1] bindScrollwheel failed:', errToString(e)); }
  }
  function applyZoom(delta) {
    try {
      const before = zoom; zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + delta * ZOOM_STEP));
      if (previewImg && (currentState === 'preview' || currentState === 'processing')) {
        previewImg.style.transformOrigin = 'center center'; previewImg.style.transform = `scale(${zoom})`;
      }
      if (video && currentState === 'camera') {
        video.style.transformOrigin = 'center center'; video.style.transform = `scale(${zoom})`;
      }
      if (before !== zoom) console.log('[ZOOM] set to', zoom.toFixed(2));
    } catch (e) { console.warn('[ZOOM] applyZoom failed:', errToString(e)); }
  }

  function bindPTT() {
    try {
      // Web fallback: Space key
      document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') { e.preventDefault(); if (currentState === 'camera') captureImage(); else if (currentState === 'idle') startCamera(); }
      });
      // Rabbit SDK PTT
      if (hasRabbit() && rabbit.hardware && typeof rabbit.hardware.onPTT === 'function') {
        rabbit.hardware.onPTT(() => { if (currentState === 'camera') captureImage(); else if (currentState === 'idle') startCamera(); });
      }
    } catch (e) { console.warn('[R1] bindPTT failed:', errToString(e)); }
  }

  /* =============================
   * Camera / Capture
   * ============================= */
  async function startCamera() {
    console.log('[CAMERA] Starting camera...');
    try {
      currentState = 'camera'; updateUI();
      const md = navigator.mediaDevices; if (!md || !md.getUserMedia) throw new Error('MediaDevices not available');
      stream = await md.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
      if (video) { video.srcObject = stream; await video.play(); video.style.transform = ''; }
      zoom = 1.0; console.log('[CAMERA] Camera started successfully');
    } catch (err) { const msg = errToString(err); console.error('[CAMERA] Error accessing camera:', msg, err); alert('Could not access camera: ' + msg); reset(); }
  }

  function captureImage() {
    try {
      if (currentState !== 'camera' || isScanning) return;
      if (!video || !canvas) { alert('Camera not ready'); return; }
      console.log('[CAPTURE] Capturing image...');
      canvas.width = video.videoWidth || 0; canvas.height = video.videoHeight || 0;
      if (canvas.width === 0 || canvas.height === 0) { alert('Camera frame not available'); return; }
      const ctx = canvas.getContext('2d'); if (!ctx) { alert('Canvas context unavailable'); return; }
      ctx.drawImage(video, 0, 0);
      capturedImageData = canvas.toDataURL('image/jpeg', 0.92);
      storage.set('r1.lastImage', capturedImageData);
      console.log('[CAPTURE] Captured image size:', capturedImageData ? capturedImageData.length : 0);
      stopCamera(); if (previewImg) previewImg.src = capturedImageData; currentState = 'preview'; updateUI(); processOCR(capturedImageData);
    } catch (err) { const msg = errToString(err); console.error('[CAPTURE] Error capturing image:', msg, err); alert('Error capturing image: ' + msg); }
  }

  function stopCamera() { try { if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; if (video) video.srcObject = null; } } catch (err) { console.warn('[CAMERA] stopCamera error:', errToString(err)); } }

  /* =============================
   * Image Preprocessing (Brightness/Grayscale/Threshold)
   * ============================= */
  function preprocessImageToDataURL(imageDataURL, opts = {}) {
    const { brightness = 15, contrast = 10, threshold = 170 } = opts; // default tuned for receipts
    return new Promise((resolve, reject) => {
      try {
        if (!imageDataURL) return resolve(null); // allow OCR to fallback gracefully
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = function () {
          try {
            const w = img.naturalWidth || img.width; const h = img.naturalHeight || img.height;
            if (!w || !h) return resolve(null);
            const off = document.createElement('canvas'); off.width = w; off.height = h;
            const ictx = off.getContext('2d'); if (!ictx) return resolve(null);
            ictx.drawImage(img, 0, 0, w, h);
            const imageData = ictx.getImageData(0, 0, w, h); const data = imageData.data;
            // brightness: -100..100 (add), contrast: -100..100 (scale)
            const b = Math.max(-100, Math.min(100, brightness));
            const c = Math.max(-100, Math.min(100, contrast));
            const factor = (259 * (c + 255)) / (255 * (259 - c));
            for (let i = 0; i < data.length; i += 4) {
              const r = data[i], g = data[i + 1], bl = data[i + 2];
              let gray = 0.299 * r + 0.587 * g + 0.114 * bl; // luma
              gray = factor * (gray - 128) + 128 + b; // adjust
              if (gray < 0) gray = 0; else if (gray > 255) gray = 255;
              const bin = gray >= threshold ? 255 : 0; // binarize
              data[i] = data[i + 1] = data[i + 2] = bin; // keep alpha
            }
            ictx.putImageData(imageData, 0, 0);
            const out = off.toDataURL('image/png'); // lossless for OCR
            resolve(out);
          } catch (e) { console.warn('[PREPROC] Failed, fallback to original:', errToString(e)); resolve(null); }
        };
        img.onerror = () => resolve(null); // fallback gracefully
        img.src = imageDataURL;
      } catch (e) { console.warn('[PREPROC] Exception, fallback to original:', errToString(e)); resolve(null); }
    });
  }

  /* =============================
   * OCR
   * ============================= */
  async function processOCR(imageData) {
    if (isScanning) return; isScanning = true; console.log('[OCR] Starting OCR processing...');
    try {
      currentState = 'processing'; updateUI(); if (processText) processText.textContent = 'Initializing OCR...';

      // Preprocess image before OCR
      if (processText) processText.textContent = 'Preprocessing image...';
      const preprocessed = await preprocessImageToDataURL(imageData, { brightness: 15, contrast: 10, threshold: 170 });
      const inputForOCR = preprocessed || imageData; // fallback to original if preprocessing failed
      if (!inputForOCR) throw new Error('No image data for OCR');

      console.log('[OCR] Creating Tesseract worker with version 5.1.1...');
      const worker = await Tesseract.createWorker('deu+eng', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        langPath: 'https://cdn.jsdelivr.net/npm/tessdata-fast@4.1.0',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0',
        logger: m => { try { if (m && m.status) { const p = typeof m.progress === 'number' ? Math.round(m.progress * 100) : null; if (processText) processText.textContent = p === null ? m.status : (m.status === 'recognizing text' ? `Processing: ${p}%` : `${m.status} ${p}%`); } } catch {} }
      });

      console.log('[OCR] Worker created, recognizing...');
      const res = await worker.recognize(inputForOCR).catch(e => { throw e; });
      const data = res && res.data; ocrResultText = (data && data.text) ? data.text : '';
      console.log('[OCR] Recognize finished. Text length:', ocrResultText.length);
      try { await worker.terminate(); } catch (termErr) { console.warn('[OCR] Worker termination failed:', errToString(termErr)); }

      const interpretedText = interpretReceipt(ocrResultText);
      if (ocrText) ocrText.innerHTML = interpretedText;
      currentState = 'results'; updateUI(); isScanning = false;
      await storage.set('r1.lastOCR', ocrResultText);
      console.log('[OCR] Completed, sending via Rabbit Mail...'); await sendReceiptViaRabbitMail(ocrResultText);
    } catch (err) {
      const msg = errToString(err);
      console.error('[OCR] Error during OCR:', msg, err);
      if (ocrText) ocrText.textContent = 'Error: Could not process receipt. ' + msg;
      currentState = 'results'; updateUI(); isScanning = false;
    }
  }

  function interpretReceipt(text) {
    try {
      if (!text || text.trim().length === 0) { return '<span style="color: #ff6b00;">No text detected. Please try again.</span>'; }
      let formatted = '<div style="font-size: 10px; line-height: 1.5;">';
      const lines = text.split('\n').filter(line => line.trim().length > 0);
      const totalPatterns = [/(?:total|gesamt|summe|betrag).*?(\d+[.,]\d{2})/i, /(\d+[.,]\d{2}).*?(?:€|EUR|eur)/i, /(?:€|EUR)\s*(\d+[.,]\d{2})/i];
      let foundTotal = null; for (const pattern of totalPatterns) { for (const line of lines) { const match = line.match(pattern); if (match) { foundTotal = match[1] || match[0]; break; } } if (foundTotal) break; }
      const datePatterns = [/\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}/, /\d{2,4}[\.\/-]\d{1,2}[\.
