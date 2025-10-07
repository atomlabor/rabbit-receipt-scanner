// Rabbit Receipt Scanner for Rabbit R1 & modern browsers
// Features: Portrait camera, Tesseract OCR (dynamic single-language), Rabbit LLM Mail with PluginMessageHandler, direct UI output
(function () {
  'use strict';
  // === STATE & DOM
  let stream = null, isScanning = false, currentState = 'idle', zoom = 1.0;
  const ZOOM_MIN = 0.75, ZOOM_MAX = 2.0, ZOOM_STEP = 0.1;
  let scanBtn, cameraContainer, video, canvas, previewImg, results, processing, processText, retryBtn;
  // Storage (Rabbit R1 preferred, fallback localStorage)
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
  // === INIT & EVENTS
  function init() {
    scanBtn = document.getElementById('scanBtn');
    cameraContainer = document.getElementById('cameraContainer');
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    previewImg = document.getElementById('previewImg');
    results = document.getElementById('results');
    processing = document.getElementById('processing');
    processText = document.getElementById('processText');
    retryBtn = document.getElementById('retryBtn');
    scanBtn && scanBtn.addEventListener('click', startCamera);
    video && video.addEventListener('click', captureImage);
    cameraContainer && cameraContainer.addEventListener('click', captureImage);
    retryBtn && retryBtn.addEventListener('click', reset);
    document.addEventListener('wheel', ev => {
      if (currentState === 'camera' || currentState === 'preview') applyZoom(ev.deltaY < 0 ? 1 : -1);
      else if (currentState === 'results' && results) results.scrollTop += ev.deltaY;
    }, { passive: true });
    if (window.rabbit && rabbit.hardware && typeof rabbit.hardware.onScroll === 'function') {
      rabbit.hardware.onScroll(({ direction }) => applyZoom(direction === 'up' ? 1 : -1));
    }
    if (window.rabbit && rabbit.hardware && typeof rabbit.hardware.onPTT === 'function') {
      rabbit.hardware.onPTT(() => { if (currentState === 'camera') captureImage(); else if (currentState === 'idle') startCamera(); });
    } else {
      document.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); if (currentState === 'camera') captureImage(); else if (currentState === 'idle') startCamera(); } });
    }
    restorePrevImage();
    updateUI();
  }
  function applyZoom(delta) {
    const before = zoom;
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta * ZOOM_STEP));
    if (video && currentState === 'camera') video.style.transform = `scale(${zoom})`;
    if (previewImg && currentState === 'preview') previewImg.style.transform = `scale(${zoom})`;
    if (before !== zoom) console.log('[ZOOM]', zoom.toFixed(2));
  }
  // === CAMERA (PORTRAIT MODE: 240x282)
  async function startCamera() {
    try {
      currentState = 'camera'; updateUI();
      // Portrait orientation for Rabbit R1: request higher resolution, then constrain display to 240x282
      stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment', 
          width: { ideal: 720 }, 
          height: { ideal: 1280 } 
        } 
      });
      video.srcObject = stream; await video.play();
      zoom = 1.0;
    } catch (err) {
      console.error('[CAMERA] Error:', err);
      alert('Camera error: ' + err);
      reset();
    }
  }
  function stopCamera() {
    try { if (stream) stream.getTracks().forEach(t => t.stop()); if (video) video.srcObject = null; } catch (e) { console.warn('[CAMERA] stop error', e); }
  }
  // === CAPTURE
  function captureImage() {
    if (currentState !== 'camera' || isScanning) return;
    if (!video || !canvas) { alert('Camera not ready'); return; }
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const image = canvas.toDataURL('image/jpeg', 0.7);
    storage.set('r1.lastImage', image);
    stopCamera();
    if (previewImg) previewImg.src = image;
    currentState = 'preview'; updateUI();
    processOCR(image);
  }
  // === OCR with dynamic single-language selection
  async function processOCR(imgDataUrl) {
    if (isScanning) return;
    isScanning = true;
    currentState = 'processing'; updateUI();
    if (processText) processText.textContent = 'OCR wird initialisiert ...';
    // Preprocess to improve OCR quality
    const preprocessed = await preprocessImage(imgDataUrl);
    const inputImg = preprocessed || imgDataUrl;
    try {
      // DYNAMIC SINGLE-LANGUAGE SELECTION: Get language from UI dropdown
      const langSelect = document.getElementById('langSelect');
      const selectedLang = (langSelect && langSelect.value === 'de') ? 'deu' : 'eng';
      console.log('[OCR] Selected language:', selectedLang);
      
      // Create worker with ONLY the selected language (not both)
      const worker = await Tesseract.createWorker([selectedLang], 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        langPath: 'https://cdn.jsdelivr.net/npm/tessdata-fast@4.1.0',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0',
        logger: m => { if (processText) processText.textContent = m.status + (m.progress ? ` ${Math.round(m.progress*100)}%` : ''); }
      });
      const result = await worker.recognize(inputImg);
      await worker.terminate();
      const ocrText = (result && result.data && result.data.text) ? result.data.text : '';
      // Show exact OCR text immediately with highlights
      showResult(ocrText);
      currentState = 'results'; updateUI();
      // Persist last OCR text
      await storage.set('r1.lastOCR', ocrText);
      // Immediately send via Rabbit internal API
      await sendReceiptViaRabbitMail(ocrText, imgDataUrl);
    } catch (err) {
      console.error('[OCR] Error:', err);
      showResult('OCR Error: ' + (err && err.message ? err.message : String(err)));
      currentState = 'results'; updateUI();
    } finally {
      isScanning = false;
    }
  }
  // === Preprocessing (simple grayscale + threshold)
  function preprocessImage(imgDataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = function () {
        const w = img.width, h = img.height;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h);
        const d = data.data;
        for (let i = 0; i < d.length; i += 4) {
          let gray = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
          gray = Math.min(255, Math.max(0, gray + 15));
          const bin = gray >= 170 ? 255 : 0;
          d[i] = d[i+1] = d[i+2] = bin; // B/W
        }
        ctx.putImageData(data, 0, 0);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = imgDataUrl;
    });
  }
  // === Result rendering (exact text + highlights)
  function showResult(text) {
    const lines = (text || '').split('\n').filter(l => l.trim());
    const total = lines.map(l => l.match(/(?:total|summe|betrag|gesamt).*?(\d+[.,]\d{2})/i)).find(Boolean);
    const date = lines.map(l => l.match(/\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}/)).find(Boolean);
    let html = '<div style="font-size:14px;">';
    if (total) html += `<div class="result-highlight">Betrag: ${total[1] || total[0]}</div>`;
    if (date) html += `<div class="result-date">Datum: ${date[0]}</div>`;
    html += `<pre style="white-space:pre-wrap;color:#eee;">${text}</pre>`;
    html += '</div>';
    if (results) results.innerHTML = html;
    if (previewImg && previewImg.src) previewImg.style.display = 'block';
  }
  // === Rabbit internal mail (using PluginMessageHandler for LLM email)
  async function sendReceiptViaRabbitMail(ocrText, imgDataUrl) {
    // Try rabbit.llm.sendMailToSelf first (native API)
    if (window.rabbit && rabbit.llm && typeof rabbit.llm.sendMailToSelf === 'function') {
      try {
        await rabbit.llm.sendMailToSelf({
          subject: 'Beleg-Scan',
          body: ocrText,
          attachment: imgDataUrl
        });
        if (results) results.innerHTML += '<div class="success">✓ Beleg per Rabbit-Mail gesendet!</div>';
        console.log('[MAIL] Sent via rabbit.llm.sendMailToSelf');
        return;
      } catch (err) {
        console.error('[MAIL] rabbit.llm.sendMailToSelf failed:', err);
      }
    }
    // Fallback: Use PluginMessageHandler with LLM email prompt
    if (typeof PluginMessageHandler !== 'undefined') {
      try {
        const prompt = `You are an assistant. Please email the OCR scan result to the device email address. Return ONLY valid JSON in this exact format: {"action":"email","to":"device","subject":"Beleg-Scan","body":"${ocrText.replace(/"/g, '\\"').replace(/\n/g, '\\n')}","attachments":[{"dataUrl":"<dataurl>"}]}`;
        const payload = {
          useLLM: true,
          message: prompt,
          imageDataUrl: imgDataUrl
        };
        PluginMessageHandler.postMessage(JSON.stringify(payload));
        if (results) results.innerHTML += '<div class="success">✓ Beleg per LLM-Mail gesendet!</div>';
        console.log('[MAIL] Sent via PluginMessageHandler + LLM');
      } catch (err) {
        console.error('[MAIL] PluginMessageHandler failed:', err);
      }
    } else {
      console.log('[MAIL] Rabbit API not available (browser mode)');
    }
  }
  // === UI
  function updateUI() {
    if (!scanBtn || !cameraContainer || !processing || !results) return;
    scanBtn.style.display = (currentState === 'idle' || currentState === 'results') ? 'block' : 'none';
    cameraContainer.style.display = (currentState === 'camera') ? 'flex' : 'none';
    processing.style.display = (currentState === 'processing') ? 'block' : 'none';
    results.style.display = (currentState === 'results') ? 'block' : 'none';
    if (previewImg) previewImg.style.display = (currentState === 'preview' || currentState === 'results') && previewImg.src ? 'block' : 'none';
  }
  async function restorePrevImage() {
    const lastImg = await storage.get('r1.lastImage');
    if (lastImg && previewImg) previewImg.src = lastImg;
  }
  function reset() {
    stopCamera();
    currentState = 'idle';
    isScanning = false;
    if (previewImg) { previewImg.src = ''; previewImg.style.display = 'none'; }
    if (results) results.innerHTML = '';
    updateUI();
  }
  // === Boot
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
