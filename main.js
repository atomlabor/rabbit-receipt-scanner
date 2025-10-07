(function() {
  'use strict';
  // --- DOM References ---
  const scanBtn = document.getElementById('scanBtn');
  const cameraContainer = document.getElementById('cameraContainer');
  const statusEl = document.getElementById('statusInfo');
  let video = document.getElementById('videoPreview');
  let isScanning = false;

  // --- UTILS & SDK CHECKS
  function hasR1CameraAPI() {
    return window.r1 && r1.camera && typeof r1.camera.capturePhoto === 'function';
  }
  
  function updateStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
    console.log('[Status]', msg);
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

  async function saveScanToStorage({ image, ocr }) {
    try {
      if(window.r1 && r1.storage && r1.storage.plain && typeof r1.storage.plain.setItem === 'function') {
        await r1.storage.plain.setItem('last_receipt', {
          time: Date.now(),
          image,
          ocr
        });
        console.log('[Storage] Saved last_receipt');
      }
    } catch (e) {
      console.warn('[Storage] Save failed', e);
    }
  }

  // --- OCR via Tesseract
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

  // --- LLM/Mail Versand nach Rabbit-SDK
  async function sendToRabbitLLM({ ocrText, imgDataUrl }) {
    const base64 = imgDataUrl.split(',')[1] || '';
    const EMAIL = 'me@rabbit.tech';

    // Prompt für LLM/Plugin: Das Bild und OCR-Text sollen als Mail an Rabbit-Account gehen.
    const prompt = `
      You are an assistant. 
      Please extract (and sort) shop, date, amount, VAT ID and all other logical receipt fields from the attached receipt/OCR image. 
      Attach the original receipt image to your mail result.
      Create a single email with (1) the OCR result as JSON (2) the readable OCR text (3) the receipt image as attachment. 
      Send this as an email to ${EMAIL}.`;

    // Reale Rabbit Integration: Immer SDK first!
    if(window.r1 && r1.messaging && typeof r1.messaging.sendMessage === 'function') {
      await r1.messaging.sendMessage(
        prompt,
        {
          useLLM: true,
          pluginId: 'image-analyzer',
          imageBase64: base64,
          ocrText // Wird als custom Field mit der Message übertragen
        }
      );
      updateStatus('✅ Scan und Versand läuft (Rabbit LLM)!');
      return;
    }

    // Fallback: Legacy Direct Mail-Rabbit
    if(window.r1 && r1.llm && typeof r1.llm.sendMailToSelf === 'function') {
      await r1.llm.sendMailToSelf({
        subject: 'Receipt Scan',
        body: `[Receipt OCR]

${ocrText}`,
        attachments: [{
          filename: 'receipt.jpg',
          dataUrl: imgDataUrl
        }]
      });
      updateStatus('✅ Scan und Versand erfolgreich! (API Fallback)');
      return;
    }

    // Nur wenn KEIN SDK vorhanden - Test/Browser
    updateStatus('⚠️ Demo/Simulation - kein echter Rabbit Versand!');
  }

  // --- CAMERA
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
      video.addEventListener('click', capture);
      updateStatus('✋ click preview to scan');
      isScanning = false;
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

  // --- CAPTURE & WORKFLOW
  async function capture() {
    if (isScanning) return;
    isScanning = true;
    try {
      updateStatus('📸 Foto aufgenommen, OCR läuft...');
      let capturedDataUrl = '';
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
      stopCamera();

      // OCR und Storage
      const ocrText = await runOCR(capturedDataUrl);
      await saveScanToStorage({ image: capturedDataUrl, ocr: ocrText });
      updateStatus('📧 Versand wird vorbereitet...');
      await sendToRabbitLLM({ ocrText, imgDataUrl: capturedDataUrl });

      setTimeout(resetUI, 2500);
    } catch (e) {
      console.error('[Capture] Failed:', e);
      updateStatus('❌ Fehler: ' + e.message);
      setTimeout(resetUI, 2500);
    } finally {
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
    updateStatus('start the scan');
  }

  // --- Events & INIT
  function bindEvents() {
    if (scanBtn) scanBtn.addEventListener('click', startCamera);
    // Hardware button (Rabbit)
    try {
      if (window.r1 && r1.hardware && typeof r1.hardware.on === 'function') {
        r1.hardware.on('sideClick', () => {
          if (cameraContainer && cameraContainer.classList.contains('active')) capture();
          else startCamera();
        });
      }
    } catch {}
    // Desktop shortcut
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (cameraContainer && cameraContainer.classList.contains('active')) capture();
        else startCamera();
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
