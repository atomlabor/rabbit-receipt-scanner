// Rabbit Receipt Scanner for Rabbit R1 & modern browsers
// Features: Landscape camera, Tesseract OCR (dynamic single-language), Rabbit LLM Mail with PluginMessageHandler, direct UI output
// Hardware: PTT camera trigger + Scrollwheel zoom support
(function() {
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

    if (!scanBtn || !video || !canvas || !results) {
      console.error('[INIT] Missing critical DOM elements.');
      return;
    }

    // Scan button event
    scanBtn.addEventListener('click', handleScan);
    if (retryBtn) retryBtn.addEventListener('click', resetUI);

    // PTT Hardware Button Support (Camera Trigger)
    document.addEventListener('keydown', (e) => {
      // R1 camera trigger is typically mapped to a specific key
      // Commonly: Space, Enter, or custom key code
      if (e.key === ' ' || e.key === 'Enter' || e.code === 'CameraShutter') {
        e.preventDefault();
        if (currentState === 'camera' && !isScanning) {
          handleScan();
        }
      }
    });

    // Scrollwheel Zoom Support
    document.addEventListener('wheel', (e) => {
      if (currentState === 'camera' && stream) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
        zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta));
        applyZoom();
      }
    }, { passive: false });

    console.log('[INIT] App ready.');
    setState('idle');
  }

  // === STATE MANAGEMENT
  function setState(newState) {
    currentState = newState;
    console.log('[STATE]', newState);

    // Update scan button icon based on state
    const iconPath = 'r1-cam.png'; // Default icon
    if (scanBtn) {
      const img = scanBtn.querySelector('img');
      if (img) {
        img.src = iconPath;
        // Add visual feedback for active/success states
        if (newState === 'camera') {
          scanBtn.style.borderColor = '#ff6600';
          scanBtn.style.boxShadow = '0 0 10px rgba(255,102,0,0.5)';
        } else if (newState === 'success') {
          scanBtn.style.borderColor = '#00ff00';
          scanBtn.style.boxShadow = '0 0 10px rgba(0,255,0,0.5)';
        } else {
          scanBtn.style.borderColor = '';
          scanBtn.style.boxShadow = '';
        }
      }
    }

    // Toggle UI visibility
    if (cameraContainer) cameraContainer.style.display = (newState === 'camera') ? 'block' : 'none';
    if (processing) processing.style.display = (newState === 'processing') ? 'flex' : 'none';
    if (results) results.style.display = (newState === 'success' || newState === 'error') ? 'block' : 'none';
  }

  // === CAMERA
  async function startCamera() {
    try {
      const constraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          aspectRatio: { ideal: 16 / 9 }
        }
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      video.play();
      setState('camera');
      zoom = 1.0;
      applyZoom();
    } catch (err) {
      console.error('[CAMERA] Error:', err);
      alert('Kamera-Zugriff fehlgeschlagen: ' + err.message);
    }
  }

  function applyZoom() {
    if (video) {
      video.style.transform = `scale(${zoom})`;
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
  }

  // === SCAN HANDLER
  async function handleScan() {
    if (isScanning) return;

    if (currentState === 'idle') {
      await startCamera();
    } else if (currentState === 'camera') {
      isScanning = true;
      captureAndProcess();
    }
  }

  async function captureAndProcess() {
    try {
      // Capture frame
      const ctx = canvas.getContext('2d');
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataURL = canvas.toDataURL('image/jpeg', 0.9);

      // Show preview
      if (previewImg) previewImg.src = dataURL;

      stopCamera();
      setState('processing');
      if (processText) processText.textContent = 'OCR läuft...';

      // OCR with Tesseract (default: deu)
      const text = await runOCR(dataURL);

      if (text && text.trim()) {
        // Highlight German OCR keywords
        const highlighted = highlightGermanKeywords(text);
        
        // Display results
        if (results) {
          results.innerHTML = `
            <h3>✅ Beleg gescannt</h3>
            <div class="ocr-output">${highlighted}</div>
          `;
        }

        // Auto-send email to rabbit.llm
        await sendRabbitMail(text);

        setState('success');
        await storage.set('lastScan', { text, timestamp: Date.now() });
      } else {
        throw new Error('Kein Text erkannt.');
      }
    } catch (err) {
      console.error('[SCAN] Error:', err);
      if (results) {
        results.innerHTML = `<h3>❌ Fehler</h3><p>${err.message}</p>`;
      }
      setState('error');
    } finally {
      isScanning = false;
    }
  }

  // === OCR (Tesseract, default: deu)
  async function runOCR(imageData) {
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract.js nicht geladen.');
    }

    try {
      const { data: { text } } = await Tesseract.recognize(
        imageData,
        'deu', // Default language: German
        {
          logger: m => {
            if (m.status === 'recognizing text' && processText) {
              processText.textContent = `OCR: ${Math.round(m.progress * 100)}%`;
            }
          }
        }
      );
      return text;
    } catch (err) {
      throw new Error('OCR fehlgeschlagen: ' + err.message);
    }
  }

  // === HIGHLIGHT GERMAN KEYWORDS
  function highlightGermanKeywords(text) {
    // German OCR core keywords to highlight
    const keywords = [
      'Rechnung', 'Quittung', 'Beleg', 'Summe', 'Total', 'Gesamt',
      'MwSt', 'USt', 'Steuer', 'Netto', 'Brutto',
      'Datum', 'Betrag', 'EUR', '€',
      'Kasse', 'Bon', 'Zahlung', 'Bar', 'EC', 'Kreditkarte'
    ];

    let highlighted = text;
    keywords.forEach(keyword => {
      const regex = new RegExp(`\\b(${keyword})\\b`, 'gi');
      highlighted = highlighted.replace(regex, '<mark>$1</mark>');
    });

    // Preserve line breaks
    highlighted = highlighted.replace(/\n/g, '<br>');

    return highlighted;
  }

  // === RABBIT MAIL (Auto-send to rabbit.llm)
  async function sendRabbitMail(ocrText) {
    try {
      const recipient = 'rabbit.llm';
      const subject = 'Neuer Beleg gescannt';
      const body = `Ein neuer Beleg wurde gescannt:\n\n${ocrText}`;

      // Try Rabbit PluginMessageHandler first
      if (window.rabbit && rabbit.sendMessage) {
        await rabbit.sendMessage({
          type: 'email',
          to: recipient,
          subject: subject,
          body: body
        });
        console.log('[MAIL] Sent via Rabbit PluginMessageHandler');
        return;
      }

      // Try mailto fallback (may not auto-send)
      const mailtoLink = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = mailtoLink;
      console.log('[MAIL] Attempted via mailto fallback');

    } catch (err) {
      console.warn('[MAIL] Failed to send:', err);
      // Non-critical error, continue
    }
  }

  // === RESET
  function resetUI() {
    stopCamera();
    setState('idle');
    if (results) results.innerHTML = '';
    if (previewImg) previewImg.src = '';
  }

  // === START
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
