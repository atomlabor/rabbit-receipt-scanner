// Rabbit Receipt Scanner für Rabbit R1 & moderne Browser
// Features: Kamera-Capture, Tesseract-OCR (deu+eng), Hardwarekontrolle, Local Storage, Rabbit LLM Mail
(function () {
  'use strict';
  // === STATE & DOM
  let stream = null, isScanning = false, currentState = 'idle', zoom = 1.0, ZOOM_MIN = 0.75, ZOOM_MAX = 2.0, ZOOM_STEP = 0.1;
  let statusText, scanBtn, cameraContainer, video, canvas, previewImg, results, processing, processText, retryBtn;
  // Persistent Storage abstraction: priority Rabbit R1, fallback localStorage
  const storage = {
    async set(key, value) {
      try {
        if (window.rabbit && rabbit.storage && typeof rabbit.storage.setItem === 'function')
          await rabbit.storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        else if (window.localStorage)
          localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      } catch (e) { console.warn('[STORAGE] Set Failed:', e); }
    },
    async get(key) {
      try {
        if (window.rabbit && rabbit.storage && typeof rabbit.storage.getItem === 'function')
          return await rabbit.storage.getItem(key);
        else if (window.localStorage)
          return localStorage.getItem(key);
      } catch (e) { console.warn('[STORAGE] Get Failed:', e); }
      return null;
    }
  };
  // === INIT & EVENT BINDING
  function init() {
    console.log('[INIT] Starting initialization...');
    statusText = document.getElementById('statusText');
    scanBtn = document.getElementById('scanBtn');
    cameraContainer = document.getElementById('cameraContainer');
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    previewImg = document.getElementById('previewImg');
    results = document.getElementById('results');
    processing = document.getElementById('processing');
    processText = document.getElementById('processText');
    retryBtn = document.getElementById('retryBtn');
    console.log('[INIT] Elements found:', { scanBtn: !!scanBtn, video: !!video, cameraContainer: !!cameraContainer });
    scanBtn && scanBtn.addEventListener('click', startCamera);
    video && video.addEventListener('click', captureImage);
    cameraContainer && cameraContainer.addEventListener('click', captureImage);
    retryBtn && retryBtn.addEventListener('click', reset);
    bindScrollwheel();
    bindPTT();
    restorePrevImage();
    updateUI();
    console.log('[INIT] Initialization complete');
  }
  function bindScrollwheel() {
    document.addEventListener('wheel', ev => {
      if (currentState === 'camera' || currentState === 'preview') applyZoom(ev.deltaY < 0 ? 1 : -1);
      else if (currentState === 'results' && results) results.scrollTop += ev.deltaY;
    }, { passive: true });
    if (window.rabbit && rabbit.hardware && typeof rabbit.hardware.onScroll === 'function') {
      rabbit.hardware.onScroll(({ direction }) => applyZoom(direction === 'up' ? 1 : -1));
    }
  }
  function applyZoom(delta) {
    const before = zoom;
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta * ZOOM_STEP));
    if (video && currentState === 'camera') video.style.transform = `scale(${zoom})`;
    if (previewImg && currentState === 'preview') previewImg.style.transform = `scale(${zoom})`;
    if (before !== zoom) console.log('[ZOOM]', zoom.toFixed(2));
  }
  function bindPTT() {
    document.addEventListener('keydown', e => {
      if (e.code === 'Space') { 
        e.preventDefault(); 
        console.log('[PTT] Space key pressed, currentState:', currentState);
        if (currentState === 'camera') captureImage(); 
        else if (currentState === 'idle') startCamera(); 
      }
    });
    if (window.rabbit && rabbit.hardware && typeof rabbit.hardware.onPTT === 'function') {
      rabbit.hardware.onPTT(() => { 
        console.log('[PTT] Rabbit PTT pressed, currentState:', currentState);
        if (currentState === 'camera') captureImage(); 
        else if (currentState === 'idle') startCamera(); 
      });
    }
  }
  // === CAMERA
  async function startCamera() {
    console.log('[CAMERA] Starting camera...');
    try {
      currentState = 'camera'; updateUI();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
      video.srcObject = stream; await video.play();
      zoom = 1.0;
      console.log('[CAMERA] Camera started successfully');
    } catch (err) {
      console.error('[CAMERA] Error:', err);
      alert('Camera error: ' + err); reset();
    }
  }
  function stopCamera() {
    console.log('[CAMERA] Stopping camera...');
    try {
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (video) video.srcObject = null;
    } catch (err) { console.error('[CAMERA] Stop error:', err); }
  }
  function captureImage(event) {
    console.log('[CAPTURE] captureImage called, currentState:', currentState, 'isScanning:', isScanning, 'event.target:', event ? event.target : 'no event');
    if (currentState !== 'camera' || isScanning) {
      console.log('[CAPTURE] Aborted - wrong state or already scanning');
      return;
    }
    if (!video || !canvas) { 
      console.error('[CAPTURE] Missing video or canvas element');
      alert('Camera not ready'); 
      return; 
    }
    console.log('[CAPTURE] Capturing image from video...');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    let image = canvas.toDataURL('image/jpeg', 0.9);
    console.log('[CAPTURE] Image captured, size:', image.length, 'bytes');
    storage.set('r1.lastImage', image);
    stopCamera();
    if (previewImg) previewImg.src = image;
    currentState = 'preview'; updateUI();
    console.log('[CAPTURE] Starting OCR processing...');
    processOCR(image);
  }
  // === OCR
  async function processOCR(imgDataUrl) {
    console.log('[OCR] processOCR called, isScanning:', isScanning);
    if (isScanning) {
      console.log('[OCR] Already scanning, aborting');
      return;
    }
    isScanning = true;
    currentState = 'processing'; updateUI();
    if (processText) processText.textContent = 'Initializing OCR ...';
    console.log('[OCR] Preprocessing image...');
    let preprocessedImg = await preprocessImage(imgDataUrl);
    let inputImg = preprocessedImg || imgDataUrl;
    console.log('[OCR] Starting Tesseract worker...');
    try {
      const worker = await Tesseract.createWorker(['deu', 'eng'], 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        langPath: 'https://cdn.jsdelivr.net/npm/tessdata-fast@4.1.0',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0',
        logger: m => {
          console.log('[OCR] Tesseract:', m);
          if (processText) processText.textContent = m.status + (m.progress ? ` ${Math.round(m.progress*100)}%` : '');
        },
      });
      console.log('[OCR] Worker created, recognizing text...');
      const result = await worker.recognize(inputImg);
      console.log('[OCR] Recognition complete:', result?.data?.text?.substring(0, 100));
      await worker.terminate();
      showResult(result?.data?.text || '');
      await storage.set('r1.lastOCR', result?.data?.text || '');
      await sendReceiptViaRabbitMail(result?.data?.text, inputImg);
    } catch (err) {
      console.error('[OCR] Error:', err);
      showResult('OCR Error: ' + (err?.message || err));
    }
    isScanning = false;
    currentState = 'results';
    updateUI();
    console.log('[OCR] Processing complete');
  }
  // === Preprocessing
  function preprocessImage(imgDataUrl) {
    console.log('[PREPROCESS] Starting image preprocessing...');
    return new Promise(resolve => {
      const img = new Image();
      img.onload = function () {
        const w = img.width, h = img.height;
        console.log('[PREPROCESS] Image loaded, size:', w, 'x', h);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        let data = ctx.getImageData(0, 0, w, h);
        // brightness/contrast/threshold
        for (let i = 0; i < data.data.length; i += 4) {
          let gray = 0.299 * data.data[i] + 0.587 * data.data[i+1] + 0.114 * data.data[i+2];
          gray = Math.min(255, Math.max(0, gray + 15)); // brightness
          let bin = gray >= 170 ? 255 : 0;
          data.data[i] = data.data[i+1] = data.data[i+2] = bin;
        }
        ctx.putImageData(data, 0, 0);
        console.log('[PREPROCESS] Preprocessing complete');
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => {
        console.error('[PREPROCESS] Image loading failed');
        resolve(null);
      };
      img.src = imgDataUrl;
    });
  }
  // === Interpretation
  function showResult(text) {
    console.log('[RESULT] Showing result, text length:', text?.length);
    let html = '<div style="font-size:14px;">';
    const lines = (text||"").split('\n').filter(l=>l.trim());
    const total = lines.map(l=>l.match(/(?:total|summe|betrag|gesamt).*?(\d+[.,]\d{2})/i)).find(Boolean);
    const date = lines.map(l=>l.match(/\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}/)).find(Boolean);
    if (total) html += `<div style="color:#06cd98;">Betrag: ${total[1]||total[0]}</div>`;
    if (date) html += `<div style="color:#bd8cff;">Datum: ${date[0]}</div>`;
    html += '<pre style="color:#eee;">'+text+'</pre></div>';
    if (results) results.innerHTML = html;
  }
  // === Rabbit Mail
  async function sendReceiptViaRabbitMail(text, img) {
    console.log('[MAIL] Attempting to send receipt via Rabbit Mail...');
    if (window.rabbit && rabbit.llm && typeof rabbit.llm.sendMailToSelf === 'function') {
      try {
        await rabbit.llm.sendMailToSelf({
          subject: `Receipt Scan - ${new Date().toLocaleString('de-DE')}`,
          body: text,
          attachment: img
        });
        if (results) results.innerHTML += '<div style="color:#66ff99;">✓ Receipt sent!</div>';
        console.log('[MAIL] Receipt sent successfully');
      } catch (err) {
        console.error('[MAIL] Error sending:', err);
      }
    } else {
      console.log('[MAIL] Rabbit LLM API not available (browser mode)');
    }
  }
  // === UI / Navigation / Persistence
  function updateUI() {
    if (!scanBtn || !cameraContainer || !processing || !results) return;
    scanBtn.style.display = (currentState === 'idle' || currentState === 'results') ? 'block' : 'none';
    cameraContainer.style.display = (currentState === 'camera') ? 'flex' : 'none';
    processing.style.display = (currentState === 'processing') ? 'block' : 'none';
    results.style.display = (currentState === 'results') ? 'block' : 'none';
    previewImg && (previewImg.style.display = (currentState === 'preview') ? 'block' : 'none');
  }
  async function restorePrevImage() {
    const lastImg = await storage.get('r1.lastImage');
    if (lastImg && previewImg) previewImg.src = lastImg;
  }
  function reset() {
    console.log('[RESET] Resetting to idle state...');
    stopCamera();
    currentState = 'idle';
    isScanning = false;
    previewImg && (previewImg.src = '');
    if (results) results.innerHTML = '';
    updateUI();
  }
  // === DOM READY INIT
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
