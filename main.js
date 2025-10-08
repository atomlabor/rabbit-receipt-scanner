/* Rabbit Receipt Scanner - Best-of State Machine (idle, camera, preview, processing, results)
   Requirements fulfilled:
   - Static <video id="videoPreview"> used always
   - All UI elements must exist in DOM; JS only toggles visibility/classes/content
   - Classic workflow UI: big centered scan button with rabbit graphic, stateful screens
   - States: idle -> camera -> preview -> processing -> results, with retry/reset
   - OCR via Tesseract.js with deu+eng
   - Zoom, mousewheel, hardware events (volume keys for PTT style capture), Rabbit-PTT trigger
   - Optional mail trigger with Rabbit LLM summary prompt if available
   - Harmonious error handling
*/
(function () {
  'use strict';

  // App State
  const States = Object.freeze({
    idle: 'idle',
    camera: 'camera',
    preview: 'preview',
    processing: 'processing',
    results: 'results'
  });
  let state = States.idle;

  // Media and processing
  let stream = null;
  let currentBlob = null;
  let zoomLevel = 1;
  let track = null;
  let imageCapture = null;
  let processingAbort = null;

  // DOM (must exist in HTML)
  const dom = {};

  function qs(id) { return document.getElementById(id); }

  function cacheDom() {
    dom.btnScan = qs('scanBtn');           // big centered scan button with rabbit graphic
    dom.btnCapture = qs('captureBtn');     // visible in camera state
    dom.btnRetry = qs('retryBtn');
    dom.btnConfirm = qs('confirmBtn');     // optional send/mail
    dom.status = qs('status');
    dom.video = qs('videoPreview');        // static video element
    dom.canvas = qs('captureCanvas');      // static canvas in DOM
    dom.previewImg = qs('previewImage');   // img element for preview
    dom.resultsBox = qs('resultsBox');     // results container
    dom.resultsText = qs('resultsText');   // pre/code element for OCR text
    dom.summaryText = qs('summaryText');   // LLM summary area (optional)
    dom.zoomLabel = qs('zoomLabel');       // zoom indicator
    dom.uiIdle = qs('uiIdle');             // section for idle
    dom.uiCamera = qs('uiCamera');         // section for camera preview UI
    dom.uiPreview = qs('uiPreview');       // section for still preview
    dom.uiProcessing = qs('uiProcessing'); // section for processing spinner
    dom.uiResults = qs('uiResults');       // section for results
    dom.brandGraphic = qs('rabbitGraphic');
  }

  function ensureDom() {
    cacheDom();
    const required = [
      'btnScan','status','video','canvas','previewImg','resultsBox','resultsText',
      'uiIdle','uiCamera','uiPreview','uiProcessing','uiResults'
    ];
    for (const key of required) {
      if (!dom[key]) {
        console.error('Missing DOM element:', key);
      }
    }
  }

  // Visibility helpers (no DOM creation/removal)
  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }
  function setStatus(text, type = '') {
    if (!dom.status) return;
    dom.status.textContent = text || '';
    dom.status.className = 'status' + (type ? ' ' + type : '');
  }

  function setState(next) {
    state = next;
    // Reset UI visibility to hidden
    hide(dom.uiIdle); hide(dom.uiCamera); hide(dom.uiPreview); hide(dom.uiProcessing); hide(dom.uiResults);

    switch (state) {
      case States.idle:
        show(dom.uiIdle);
        setStatus('Bereit zum Scannen');
        focusScanButtonSoon();
        break;
      case States.camera:
        show(dom.uiCamera);
        setStatus('Richte den Beleg aus und tippe zum Auslösen');
        break;
      case States.preview:
        show(dom.uiPreview);
        setStatus('Vorschau – erneut versuchen oder verarbeiten');
        break;
      case States.processing:
        show(dom.uiProcessing);
        setStatus('Verarbeite Beleg (OCR)…', 'processing pulsing');
        break;
      case States.results:
        show(dom.uiResults);
        setStatus('Ergebnis');
        break;
    }
  }

  function focusScanButtonSoon() {
    if (dom.btnScan) setTimeout(() => dom.btnScan.focus(), 100);
  }

  // Camera controls
  async function openCamera() {
    await closeCamera();
    try {
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          zoom: true
        },
        audio: false
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      dom.video.srcObject = stream;
      await dom.video.play();

      track = stream.getVideoTracks()[0];
      imageCapture = ('ImageCapture' in window) ? new ImageCapture(track) : null;

      // Setup zoom if supported
      setupZoom(track);

      setState(States.camera);
    } catch (e) {
      console.error('Camera open error', e);
      setStatus('Kamera konnte nicht geöffnet werden', 'error');
      setState(States.idle);
    }
  }

  async function closeCamera() {
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
      stream = null; track = null; imageCapture = null;
    }
  }

  function setupZoom(vTrack) {
    try {
      const caps = vTrack?.getCapabilities?.();
      if (caps && 'zoom' in caps) {
        zoomLevel = vTrack.getSettings().zoom || caps.zoom.min || 1;
        updateZoomLabel();
      }
    } catch {}
  }
  function updateZoomLabel() {
    if (dom.zoomLabel) dom.zoomLabel.textContent = `Zoom: ${Number(zoomLevel).toFixed(1)}x`;
  }
  async function applyZoom(delta) {
    if (!track?.applyConstraints) return;
    try {
      const caps = track.getCapabilities?.();
      if (!caps || !('zoom' in caps)) return;
      const settings = track.getSettings();
      const min = caps.zoom.min ?? 1;
      const max = caps.zoom.max ?? 5;
      const step = caps.zoom.step ?? 0.1;
      zoomLevel = Math.min(max, Math.max(min, (settings.zoom ?? min) + delta * step));
      await track.applyConstraints({ advanced: [{ zoom: zoomLevel }] });
      updateZoomLabel();
    } catch (e) {
      // Ignore zoom errors silently for UX
    }
  }

  // Capture frame into canvas and blob
  async function captureFrame() {
    const canvas = dom.canvas;
    const ctx = canvas.getContext('2d');
    const vw = dom.video.videoWidth || 1280;
    const vh = dom.video.videoHeight || 720;
    canvas.width = vw; canvas.height = vh;
    ctx.drawImage(dom.video, 0, 0, vw, vh);

    currentBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    // Show preview image
    if (dom.previewImg) {
      dom.previewImg.src = URL.createObjectURL(currentBlob);
    }
    setState(States.preview);
  }

  // OCR with Tesseract.js (deu+eng)
  async function doOCR(blob) {
    const { createWorker } = window.Tesseract || {};
    if (!createWorker) throw new Error('Tesseract.js nicht geladen');

    // Abort handling
    if (processingAbort) { processingAbort.abort(); }
    processingAbort = new AbortController();

    const worker = await createWorker({
      logger: m => { if (m.status) setStatus(`OCR: ${m.status} ${Math.round((m.progress||0)*100)}%`, 'processing'); }
    });
    try {
      await worker.loadLanguage('deu+eng');
      await worker.initialize('deu+eng');
      const img = await blobToImage(blob);
      const { data } = await worker.recognize(img, { imageColor: true });
      await worker.terminate();
      return data?.text || '';
    } catch (e) {
      try { await worker.terminate(); } catch {}
      throw e;
    }
  }

  function blobToImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
  }

  // Parse receipt like classic version
  function parseReceipt(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let merchant = '', date = '', total = '';
    const items = [];
    for (const line of lines) {
      if (!merchant && line.length > 2 && !/\d/.test(line)) merchant = line;
      const dm = line.match(/(\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{2,4}|\d{2,4}[.\/\-]\d{1,2}[.\/\-]\d{1,2})/);
      if (dm && !date) date = dm[0];
      if (/total|summe|gesamt|betrag|total/i.test(line) || /€|eur|usd|\$/.test(line)) {
        const am = line.match(/([\d\.\s]*\d+[\.,]\d{2})/g);
        if (am) total = am[am.length - 1];
      }
      if (/\d+[\.,]\d{2}/.test(line) && line.length > 5) items.push(line);
    }
    return {
      merchant: merchant || 'Unbekannt',
      date: date || new Date().toLocaleDateString('de-DE'),
      total: total || 'Nicht erkannt',
      items: items.slice(0, 12),
      rawText: text
    };
  }

  // Optional Rabbit LLM summary (if window.rabbitLLM is available)
  async function makeSummary(receipt) {
    try {
      if (!window.rabbitLLM?.summarize) return '';
      const prompt = `Erstelle eine kurze, strukturierte Zusammenfassung des Kassenbons in Deutsch.
      Felder: Händler, Datum, Gesamtsumme, Stichpunkte der Positionen (max 6).
      Daten: ${JSON.stringify(receipt)}`;
      return await window.rabbitLLM.summarize(prompt);
    } catch {
      return '';
    }
  }

  // Optional email trigger (configure externally)
  async function triggerMail(receipt, blob, summary) {
    try {
      if (!window.rabbitMail?.send) return;
      const base64 = await blobToBase64(blob);
      await window.rabbitMail.send({
        to: 'receipts@atomlabor.de',
        subject: `Beleg ${receipt.merchant} – ${receipt.date}`,
        html: `🧾 Neuer Beleg<br/>Händler: ${receipt.merchant}<br/>Datum: ${receipt.date}<br/>Betrag: ${receipt.total}<br/><br/><pre>${escapeHtml(receipt.rawText)}</pre><br/>${summary ? `<hr/><strong>Zusammenfassung:</strong><br/><pre>${escapeHtml(summary)}</pre>` : ''}`,
        attachments: [{ name: `receipt_${Date.now()}.jpg`, type: 'image/jpeg', dataUrl: base64 }]
      });
    } catch (e) {
      console.warn('Mail trigger failed', e);
    }
  }

  function escapeHtml(s='') { return s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function blobToBase64(blob) { return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); }); }

  // UI actions
  async function onScan() {
    await openCamera();
  }

  async function onCapture() {
    if (state !== States.camera) return;
    await captureFrame();
  }

  async function onProcess() {
    if (!currentBlob) return;
    setState(States.processing);
    try {
      const text = await doOCR(currentBlob);
      dom.resultsText.textContent = text || '';
      const parsed = parseReceipt(text || '');
      const summary = await makeSummary(parsed);
      if (dom.summaryText) dom.summaryText.textContent = summary || '';
      await triggerMail(parsed, currentBlob, summary);
      setState(States.results);
    } catch (e) {
      console.error('Processing failed', e);
      setStatus('Fehler bei der Verarbeitung', 'error');
      setState(States.preview);
    }
  }

  async function onRetry() {
    currentBlob = null;
    dom.previewImg && (dom.previewImg.src = '');
    await openCamera();
  }

  async function onReset() {
    await closeCamera();
    currentBlob = null;
    dom.previewImg && (dom.previewImg.src = '');
    dom.resultsText && (dom.resultsText.textContent = '');
    if (dom.summaryText) dom.summaryText.textContent = '';
    setState(States.idle);
  }

  // Mouse wheel zoom over video
  function onWheel(e) {
    if (state !== States.camera) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? +1 : -1;
    applyZoom(delta);
  }

  // Hardware events: volume keys as PTT capture (best-effort on Android Chrome when focused)
  function onKeyDown(e) {
    if (state === States.camera && (e.key === 'v' || e.code === 'VolumeDown' || e.code === 'VolumeUp')) {
      e.preventDefault();
      onCapture();
    }
    // Space/Enter capture too
    if (state === States.camera && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      onCapture();
    }
    // Escape resets
    if (e.key === 'Escape') {
      e.preventDefault();
      onReset();
    }
  }

  // Bind events
  function bindEvents() {
    dom.btnScan?.addEventListener('click', onScan);
    dom.btnCapture?.addEventListener('click', onCapture);
    dom.video?.addEventListener('click', () => { if (state === States.camera) onCapture(); });
    dom.btnRetry?.addEventListener('click', onRetry);
    dom.btnConfirm?.addEventListener('click', onProcess);
    dom.video?.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', () => { if (document.hidden) onReset(); });
  }

  function init() {
    ensureDom();
    bindEvents();
    // Classic: big centered scan UI visible, others hidden
    setState(States.idle);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
