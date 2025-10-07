(function() {
  'use strict';
  // --- DOM References ---
  const scanBtn = document.getElementById('scanBtn');
  const cameraContainer = document.getElementById('cameraContainer');
  const statusEl = document.getElementById('statusInfo');
  let video = document.getElementById('videoPreview');
  let isScanning = false;

  // --- SDK-UTILS
  function hasR1CameraAPI() {
    return window.r1 && r1.camera && typeof r1.camera.capturePhoto === 'function';
  }
  function hasR1FSAPI() {
    return window.r1 && r1.filesystem && typeof r1.filesystem.saveFile === 'function';
  }
  function updateStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
    console.log('[Status]', msg);
  }

  // --- OCR mit Tesseract
  async function runOCR(dataUrl) {
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

  // --- Main scan/dispatch workflow
  async function handleReceiptScan(imgDataUrl) {
    // Speichere Bild lokal im Rabbit R1
    let localFilename = `receipt_${Date.now()}.jpg`;
    if (hasR1FSAPI()) {
      try {
        await r1.filesystem.saveFile(localFilename, imgDataUrl);
        updateStatus('📁 Bild lokal gespeichert: ' + localFilename);
      } catch (e) {
        updateStatus('❌ Konnte Bild nicht lokal sichern!');
        console.error(e);
        localFilename = ''; // Dann nur mit DataURL weiter
      }
    } else {
      updateStatus('⚠️ Filesystem-API nicht verfügbar – Bild bleibt als DataURL');
      localFilename = '';
    }

    // OCR ausführen
    const ocrText = await runOCR(imgDataUrl);

    // Versand an Rabbit-Account (LLM/Plugin/mail)
    const toEmail = 'me@rabbit.tech';
    const subject = 'Automatischer Belegscan';
    const body = 'OCR-Ergebnis:\n' + ocrText + '\n\nHinweis: Originalbild ist angehängt.';

    // Attachment-Objekt (wenn Dateiname gesetzt, sonst nur dataUrl)
    const attachmentObj = localFilename
      ? { filename: localFilename, dataUrl: imgDataUrl }
      : { filename: 'receipt.jpg', dataUrl: imgDataUrl };

    // Rabbit LLM/PluginMessageHandler Versand:
    const payload = {
      useLLM: true,
      message: `You are an assistant. Please email the attached image (scan of a receipt) to the user. The mail body should contain the OCR-analyzed text sorted into 'shop', 'date', 'amount', 'vat_id' fields where possible.\nOCR_TEXT:\n${ocrText}`,
      attachments: [attachmentObj]
    };

    // Senden an Rabbit LLM/Mail
    if (typeof PluginMessageHandler !== "undefined") {
      PluginMessageHandler.postMessage(JSON.stringify(payload));
      updateStatus('✅ Scan und Versand erfolgreich (Rabbit LLM)!');
    } else if (window.r1 && r1.llm && typeof r1.llm.sendMailToSelf === 'function') {
      await r1.llm.sendMailToSelf({
        subject,
        body,
        attachments: [attachmentObj]
      });
      updateStatus('✅ Scan und Versand erfolgreich (Fallback API)!');
    } else {
      updateStatus('⚠️ Nur Simulation – kein Rabbit-Mail-Versand möglich.');
    }
  }

  // --- Camera
  async function startCamera() {
    if (isScanning) return;
    isScanning = true;

    try {
      updateStatus('📷 Kamera wird gestartet...');
      if (!video) {
        video = document.getElementById('videoPreview') || document.createElement('video');
        video.id = 'videoPreview';
        video.setAttribute('playsinline', '');
        video.setAttribute('autoplay', '');
      }
      if (!hasR1CameraAPI()) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: 400, height: 240 }
        });
        video.srcObject = stream;
        await video.play();
      }
      if (scanBtn) scanBtn.style.display = 'none';
      if (cameraContainer) cameraContainer.classList.add('active');
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'contain';
      video.style.display = 'block';
      video.style.cursor = 'pointer';
      video.addEventListener('click', async () => {
        updateStatus('📸 Foto aufgenommen, wird verarbeitet...');
        let capturedDataUrl;
        if (hasR1CameraAPI()) {
          const photo = await r1.camera.capturePhoto(400, 240);
          capturedDataUrl = typeof photo === 'string' && photo.startsWith('data:') ? photo : await normalizeToDataUrl(photo);
        } else {
          if (!video || !video.videoWidth) throw new Error('Video nicht bereit');
          const c = document.createElement('canvas');
          c.width = video.videoWidth; c.height = video.videoHeight;
          const cx = c.getContext('2d');
          cx.drawImage(video, 0, 0);
          capturedDataUrl = c.toDataURL('image/jpeg', 0.7);
        }
        video.removeEventListener('click', this);
        video.style.display = 'none';
        cameraContainer.classList.remove('active');
        if (scanBtn) scanBtn.style.display = 'flex';
        // Weiter mit Workflow:
        await handleReceiptScan(capturedDataUrl);
        setTimeout(resetUI, 2500);
      });
      updateStatus('✋ Tippe auf die Preview zum Aufnehmen');
      isScanning = false;
    } catch (e) {
      console.error('[Camera] Failed:', e);
      updateStatus('❌ Kamera-Fehler: ' + e.message);
      isScanning = false;
    }
  }

  function resetUI() {
    isScanning = false;
    if (scanBtn) scanBtn.style.display = 'flex';
    if (cameraContainer) cameraContainer.classList.remove('active');
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    updateStatus('Bereit zum Scannen');
  }

  // --- Event wiring & init
  function bindEvents() {
    if (scanBtn) scanBtn.addEventListener('click', startCamera);
    // Hardware side button
    try {
      if (window.r1 && r1.hardware && typeof r1.hardware.on === 'function') {
        r1.hardware.on('sideClick', () => {
          if (cameraContainer && cameraContainer.classList.contains('active')) startCamera();
        });
      }
    } catch {}
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (cameraContainer && cameraContainer.classList.contains('active')) startCamera();
      }
    });
  }
  function init() {
    bindEvents();
    updateStatus('Bereit zum Scannen');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
