// Rabbit Receipt Scanner for Rabbit R1 & modern browsers
// feat: bilingual UI (de/en), dynamic OCR language (single worker), auto Rabbit mail after scan
(function () {
  'use strict';

  // === I18N ===
  const I18N = {
    de: {
      scan: 'Scannen',
      tapToCapture: 'Antippen zum Erfassen',
      processing: 'Verarbeitung...',
      ocrInit: 'OCR wird initialisiert ...',
      amount: 'Betrag',
      date: 'Datum',
      sent: '✓ Beleg gesendet!',
      retry: 'Neuer Scan' // HINZUGEFÜGT
    },
    en: {
      scan: 'Scan',
      tapToCapture: 'Tap to capture',
      processing: 'Processing...',
      ocrInit: 'Initializing OCR ...',
      amount: 'Amount',
      date: 'Date',
      sent: '✓ Receipt sent!',
      retry: 'New Scan' // HINZUGEFÜGT
    }
  };

  let lang = 'de'; // default UI + OCR language

  // === STATE & DOM
  let stream = null, isScanning = false, currentState = 'idle', zoom = 1.0;
  const ZOOM_MIN = 0.75, ZOOM_MAX = 2.0, ZOOM_STEP = 0.1;
  let scanBtn, cameraContainer, video, canvas, previewImg, results, processing, processText, retryBtn,
      langSelect, uiLangToggle, labelScan, hintTap, headerTitle;

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
    // Base DOM
    scanBtn = document.getElementById('scanBtn');
    cameraContainer = document.getElementById('cameraContainer');
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    previewImg = document.getElementById('previewImg');
    results = document.getElementById('results');
    processing = document.getElementById('processing');
    processText = document.getElementById('processText');
    retryBtn = document.getElementById('retryBtn');
    langSelect = document.getElementById('langSelect'); // OCR language (de/en)
    uiLangToggle = document.getElementById('uiLangToggle'); // UI language
    labelScan = document.getElementById('labelScan');
    hintTap = document.getElementById('hintTap');
    headerTitle = document.getElementById('headerTitle');

    // Restore persisted language prefs
    storage.get('r1.lang').then(v => { if (v) { try { lang = JSON.parse(v); } catch { lang = v; } setTexts(); }});

    // Listeners
    scanBtn && scanBtn.addEventListener('click', startCamera);
    video && video.addEventListener('click', captureImage);
    cameraContainer && cameraContainer.addEventListener('click', captureImage);
    retryBtn && retryBtn.addEventListener('click', reset);

    if (langSelect) {
      langSelect.value = lang;
      langSelect.addEventListener('change', () => {
        lang = langSelect.value || 'de';
        storage.set('r1.lang', lang);
        setTexts();
      });
    }
    if (uiLangToggle) {
      uiLangToggle.value = lang;
      uiLangToggle.addEventListener('change', () => {
        // UI language mirrors OCR selection for simplicity; keep in sync
        const val = uiLangToggle.value || 'de';
        lang = val;
        if (langSelect) langSelect.value = val;
        storage.set('r1.lang', lang);
        setTexts();
      });
    }

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
    setTexts();
    updateUI();
  }

  function setTexts() {
    const t = I18N[lang] || I18N.de;
    if (labelScan) labelScan.textContent = t.scan;
    if (hintTap) hintTap.textContent = t.tapToCapture;
    if (processing) processing.querySelector?.('#processTitle')?.textContent = t.processing;
    if (headerTitle) headerTitle.textContent = 'Rabbit Receipt Scanner';
    if (retryBtn) retryBtn.textContent = t.retry; // HINZUGEFÜGT
  }

  function applyZoom(delta) {
    const before = zoom;
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta * ZOOM_STEP));
    if (video && currentState === 'camera') video.style.transform = `scale(${zoom})`;
    if (previewImg && currentState === 'preview') previewImg.style.transform = `scale(${zoom})`;
    if (before !== zoom) console.log('[ZOOM]', zoom.toFixed(2));
  }

  // === CAMERA
  async function startCamera() {
    try {
      currentState = 'camera'; updateUI();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
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
    const image = canvas.toDataURL('image/jpeg', 0.9);
    storage.set('r1.lastImage', image);
    stopCamera();
    if (previewImg) previewImg.src = image;
    currentState = 'preview'; updateUI();
    processOCR(image);
  }

  // === OCR (single language worker)
  async function processOCR(imgDataUrl) {
    if (isScanning) return;
    isScanning = true;
    currentState = 'processing'; updateUI();
    if (processText) processText.textContent = (I18N[lang]||I18N.de).ocrInit;
    // Preprocess to improve OCR quality
    const preprocessed = await preprocessImage(imgDataUrl);
    const inputImg = preprocessed || imgDataUrl;
    try {
      // IMPORTANT: only load the selected language
      const worker = await Tesseract.createWorker(lang, 1, {
        cacheMethod: 'none',
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
      // ALWAYS send via Rabbit internal API after successful scan
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
    const t = I18N[lang] || I18N.de;
    const lines = (text || '').split('\n').filter(l => l.trim());
    const total = lines.map(l => l.match(/(?:total|summe|betrag|gesamt).*?(\d+[.,]\d{2})/i)).find(Boolean);
    const date = lines.map(l => l.match(/\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}/)).find(Boolean);
    let html = '<div style="font-size:14px;">';
    if (total) html += `<div class="result-highlight">${t.amount}: ${total[1] || total[0]}</div>`;
    if (date) html += `<div class="result-date">${t.date}: ${date[0]}</div>`;
    html += `<pre style="white-space:pre-wrap;color:#eee;">${text}</pre>`;
    html += '</div>';
    if (results) results.innerHTML = html;
    if (previewImg && previewImg.src) previewImg.style.display = 'block';
  }

  // === Rabbit internal mail (always after scan)
  async function sendReceiptViaRabbitMail(text, img) {
    const subject = `${lang === 'de' ? 'Beleg-Scan' : 'Receipt Scan'} - ${new Date().toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')}`;
    if (window.rabbit && rabbit.llm && typeof rabbit.llm.sendMailToSelf === 'function') {
      try {
        await rabbit.llm.sendMailToSelf({ subject, body: text, attachment: img });
        if (results) results.innerHTML += `<div class="success">${(I18N[lang]||I18N.de).sent}</div>`;
      } catch (err) {
        console.error('[MAIL] Error sending:', err);
      }
    } else {
      console.log('[MAIL] Rabbit LLM API not available (browser mode)');
    }
  }

  // === UI
  function updateUI() {
    if (!scanBtn || !cameraContainer || !processing || !results || !retryBtn) return;
    // Korrigiert: scanBtn nur im 'idle' Zustand anzeigen
    scanBtn.style.display = (currentState === 'idle') ? 'block' : 'none'; 
    cameraContainer.style.display = (currentState === 'camera') ? 'flex' : 'none';
    processing.style.display = (currentState === 'processing') ? 'block' : 'none';
    results.style.display = (currentState === 'results') ? 'block' : 'none';
    if (previewImg) previewImg.style.display = (currentState === 'preview' || currentState === 'results') && previewImg.src ? 'block' : 'none';
    // HINZUGEFÜGT: retryBtn nur im 'results' Zustand anzeigen
    retryBtn.style.display = (currentState === 'results') ? 'block' : 'none';
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
