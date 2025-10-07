(function() {
  'use strict';

  // --- DOM References ---
  const scanBtn = document.getElementById('scanBtn');
  const cameraContainer = document.getElementById('cameraContainer');
  const statusEl = document.getElementById('status');
  const video = document.getElementById('video');

  let isScanning = false;
  let lastImageDataUrl = '';
  let lastOCRText = '';

  // --- Utils
  function hasR1CameraAPI() {
    return window.r1 && r1.camera && typeof r1.camera.capturePhoto === 'function';
  }
  function updateStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }
  async function normalizeToDataUrl(input) {
    if (typeof input === 'string' && input.startsWith('data:')) return input;
    if (input instanceof Blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(input);
      });
    }
    throw new Error('Unsupported photo format');
  }
  function resetUI() {
    isScanning = false;
    updateStatus('Bereit zum Scannen');
  }

  // --- OCR
  async function runOCR(dataUrl) {
    if (!dataUrl) throw new Error('Kein Bild vorhanden');
    updateStatus('🔍 OCR läuft...');
    try {
      const { data: { text } } = await Tesseract.recognize(dataUrl, 'deu+eng', {
        logger: m => console.log(m)
      });
      return text || '';
    } catch (e) {
      console.error('[OCR] Error:', e);
      return '';
    }
  }

  // --- Mail
  async function sendReceiptMail(ocrText, imgDataUrl) {
    if (window.r1 && r1.llm && typeof r1.llm.sendMailToSelf === 'function') {
      try {
        await r1.llm.sendMailToSelf({
          subject: 'Beleg gescannt',
          body: ocrText || 'Kein Text erkannt',
          attachments: [{ data: imgDataUrl, filename: 'receipt.jpg' }]
        });
      } catch (e) {
        console.error('[Mail] Failed:', e);
        throw e;
      }
    } else {
      console.warn('[Mail] Simulated (Rabbit LLM API not available)');
    }
  }

  // --- Preprocess
  async function preprocessDataUrl(dataUrl) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.filter = 'contrast(1.2) brightness(1.1)';
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, c.width, c.height);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
          const bw = gray > 128 ? 255 : 0;
          d[i] = d[i+1] = d[i+2] = bw;
        }
        ctx.putImageData(imageData, 0, 0);
        res(c.toDataURL('image/jpeg', 0.95));
      };
      img.onerror = rej;
      img.src = dataUrl;
    });
  }

  // --- Camera
  async function startCamera() {
    if (isScanning) return;
    isScanning = true;
    try {
      updateStatus('📷 Kamera wird gestartet...');
      if (!hasR1CameraAPI()) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: 240, height: 282 }
        });
        video.srcObject = stream;
        await video.play();
      }
      if (cameraContainer) cameraContainer.classList.add('active');
      updateStatus('✋ Tap to capture');
    } catch (e) {
      console.error('[Camera] Failed:', e);
      updateStatus('❌ Kamera-Fehler: ' + e.message);
      isScanning = false;
    }
  }
  function stopCamera() {
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    if (cameraContainer) cameraContainer.classList.remove('active');
  }

  // --- Capture (R1 preferred)
  async function capture() {
    if (isScanning) return;
    isScanning = true;
    try {
      updateStatus('📸 Aufnahme...');
      let capturedDataUrl = '';
      if (hasR1CameraAPI()) {
        const photo = await r1.camera.capturePhoto(240, 282);
        capturedDataUrl = await normalizeToDataUrl(photo);
      } else {
        if (!video || !video.videoWidth) throw new Error('Video nicht bereit');
        const c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        const cx = c.getContext('2d');
        cx.drawImage(video, 0, 0);
        capturedDataUrl = c.toDataURL('image/jpeg', 0.95);
      }
      stopCamera();
      const preprocessed = await preprocessDataUrl(capturedDataUrl);
      lastImageDataUrl = preprocessed;
      updateStatus('🔍 OCR läuft...');
      lastOCRText = await runOCR(preprocessed);
      updateStatus('📧 E-Mail wird versendet...');
      await sendReceiptMail(lastOCRText, preprocessed);
      updateStatus('✅ Fertig! Ergebnis wurde per Mail gesendet.');
      setTimeout(resetUI, 2500);
    } catch (e) {
      console.error('[Capture] Failed:', e);
      updateStatus('❌ Fehler: ' + e.message);
      setTimeout(resetUI, 2500);
    } finally {
      isScanning = false;
    }
  }

  // --- Event wiring
  function bindEvents() {
    if (scanBtn) scanBtn.addEventListener('click', startCamera);
    if (cameraContainer) cameraContainer.addEventListener('click', capture);

    // Optional: Rabbit hardware side button if available
    try {
      if (window.r1 && r1.hardware && typeof r1.hardware.on === 'function') {
        r1.hardware.on('sideClick', () => {
          if (cameraContainer && cameraContainer.classList.contains('active')) capture();
          else startCamera();
        });
      }
    } catch {}

    // Keyboard fallback for desktop testing
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (cameraContainer && cameraContainer.classList.contains('active')) capture();
        else startCamera();
      }
    });
  }

  // --- Init
  function init() {
    // Patch: Ensure scan button event binding is reliable
    if (scanBtn) {
      scanBtn.onclick = null;
      scanBtn.addEventListener('click', function() {
        console.log('[ScanBtn] Clicked!');
        startCamera();
      });
    }
    
    bindEvents();
    updateStatus('Bereit zum Scannen');
  }

  // Start when DOM ready
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
