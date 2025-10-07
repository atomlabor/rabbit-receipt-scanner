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

  // === CAMERA (PORTRAIT MODE: request tall stream; display letterboxed in 240x282)
  async function startCamera() {
    try {
      currentState = 'camera'; updateUI();
      // Request portrait-oriented stream
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          aspectRatio: { ideal: 9/16 },
          width: { ideal: 1080 },
          height: { ideal: 1920 }
        }
      });
      video.srcObject = stream; await video.play();
      video.style.objectFit = 'contain';
      video.style.background = '#000';
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.transform = 'scale(1)';
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

  // === CAPTURE with full-frame canvas using video dimensions
  function captureImage() {
    if (currentState !== 'camera' || isScanning) return;
    if (!video || !canvas) { alert('Camera not ready'); return; }
    const vw = video.videoWidth || 1080;
    const vh = video.videoHeight || 1920;
    canvas.width = vw; canvas.height = vh;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, vw, vh);
    ctx.drawImage(video, 0, 0, vw, vh);
    const image = canvas.toDataURL('image/jpeg', 0.85);
    storage.set('r1.lastImage', image);
    stopCamera();
    if (previewImg) {
      previewImg.src = image;
      previewImg.style.maxWidth = '240px';
      previewImg.style.maxHeight = '282px';
      previewImg.style.objectFit = 'contain';
      previewImg.style.background = '#000';
    }
    currentState = 'preview'; updateUI();
    processOCR(image);
  }

  // === Advanced OCR: preprocessing with contrast, grayscale, adaptive threshold, morphology
  async function processOCR(imgDataUrl) {
    if (isScanning) return;
    isScanning = true;
    currentState = 'processing'; updateUI();
    if (processText) processText.textContent = 'OCR wird initialisiert ...';

    const preprocessed = await preprocessImage(imgDataUrl);
    const inputImg = preprocessed || imgDataUrl;

    try {
      const langSelect = document.getElementById('langSelect');
      const selectedLang = (langSelect && langSelect.value === 'de') ? 'deu' : 'eng';
      const worker = await Tesseract.createWorker([selectedLang], 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        langPath: 'https://cdn.jsdelivr.net/npm/tessdata-fast@4.1.0',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0',
        logger: m => { if (processText) processText.textContent = m.status + (m.progress ? ` ${Math.round(m.progress*100)}%` : ''); }
      });
      const result = await worker.recognize(inputImg, { tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK });
      await worker.terminate();
      const ocrText = (result && result.data && result.data.text) ? result.data.text : '';
      showResult(ocrText);
      currentState = 'results'; updateUI();
      await storage.set('r1.lastOCR', ocrText);
      await sendReceiptViaRabbitMail(ocrText, imgDataUrl);
    } catch (err) {
      console.error('[OCR] Error:', err);
      showResult('OCR Error: ' + (err && err.message ? err.message : String(err)));
      currentState = 'results'; updateUI();
    } finally {
      isScanning = false;
    }
  }

  // Adaptive thresholding (mean), contrast stretch, light blur, morphological open
  function preprocessImage(imgDataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = function () {
        const w = img.width, h = img.height;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const src = ctx.getImageData(0, 0, w, h);
        const data = src.data;
        const gray = new Uint8ClampedArray(w*h);
        let min = 255, max = 0;
        for (let i=0, p=0; i<data.length; i+=4, p++) {
          const g = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
          gray[p] = g; if (g < min) min = g; if (g > max) max = g;
        }
        const range = Math.max(1, max - min);
        for (let p=0; p<gray.length; p++) gray[p] = ((gray[p] - min) * 255) / range;
        // light 3x3 blur
        const blur = new Uint8ClampedArray(gray.length);
        for (let y=1; y<h-1; y++) for (let x=1; x<w-1; x++) {
          let acc=0; for (let j=-1;j<=1;j++) for (let i=-1;i<=1;i++) acc += gray[(y+j)*w + (x+i)];
          blur[y*w+x] = acc/9;
        }
        // adaptive mean threshold 9x9
        const out = new Uint8ClampedArray(gray.length);
        const rad = 4;
        for (let y=0; y<h; y++) {
          for (let x=0; x<w; x++) {
            let sum=0, cnt=0;
            for (let j=-rad;j<=rad;j++) {
              const yy = Math.min(h-1, Math.max(0, y+j));
              for (let i=-rad;i<=rad;i++) {
                const xx = Math.min(w-1, Math.max(0, x+i));
                sum += blur[yy*w+xx]; cnt++;
              }
            }
            const mean = sum/cnt - 5;
            out[y*w+x] = (gray[y*w+x] > mean) ? 255 : 0;
          }
        }
        // morphological open (3x3)
        const er = new Uint8ClampedArray(out.length);
        for (let y=1; y<h-1; y++) for (let x=1; x<w-1; x++) {
          let mn=255; for (let j=-1;j<=1;j++) for (let i=-1;i<=1;i++) mn = Math.min(mn, out[(y+j)*w+(x+i)]);
          er[y*w+x]=mn;
        }
        const di = new Uint8ClampedArray(out.length);
        for (let y=1; y<h-1; y++) for (let x=1; x<w-1; x++) {
          let mx=0; for (let j=-1;j<=1;j++) for (let i=-1;i<=1;i++) mx = Math.max(mx, er[(y+j)*w+(x+i)]);
          di[y*w+x]=mx;
        }
        const outImg = ctx.createImageData(w, h);
        for (let i=0, p=0; p<di.length; i+=4, p++) {
          const v = di[p]; outImg.data[i]=v; outImg.data[i+1]=v; outImg.data[i+2]=v; outImg.data[i+3]=255;
        }
        ctx.putImageData(outImg, 0, 0);
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

  // === Rabbit internal mail (native first, log fallback)
  async function sendReceiptViaRabbitMail(ocrText, imgDataUrl) {
    if (window.rabbit && rabbit.llm && typeof rabbit.llm.sendMailToSelf === 'function') {
      try {
        await rabbit.llm.sendMailToSelf({ subject: 'Receipt Scan', body: ocrText, attachment: imgDataUrl });
        if (results) results.innerHTML += '<div class="success">✓ Receipt sent!</div>';
        return;
      } catch (err) { console.error('[MAIL] rabbit.llm.sendMailToSelf failed:', err); }
    }
    console.log('[MAIL] Simulated send:', { subject: 'Receipt Scan', body: ocrText.length + ' chars', attachment: (imgDataUrl||'').slice(0,64)+'...' });
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
