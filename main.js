(function() {
  'use strict';
  // --- DOM References ---
  const scanBtn = document.getElementById('scanBtn');
  const cameraContainer = document.getElementById('cameraContainer');
  const statusEl = document.getElementById('statusInfo');
  let video = document.getElementById('videoPreview');
  let isScanning = false;

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

  async function runOCR(dataUrl) {
    updateStatus('🔍 OCR läuft...');
    try {
      const { data: { text } } = await window.Tesseract.recognize(dataUrl, 'deu+eng', {
        logger: m => console.log(m)
      });
      return text || '';
    } catch (e) {
      console.error('[OCR] Error:', e);
      return '';
    }
  }

  // --- Send mail via Rabbit LLM
  async function sendToRabbitLLM({ ocrText, imgDataUrl }) {
    const base64 = imgDataUrl.split(',')[1] || '';
    const EMAIL = 'me@rabbit.tech';

    // Prompt an die LLM für Rabbit
    const prompt = `
      You are an assistant. 
      Please extract all logical fields (shop, date, amount, VAT ID, etc.) from the attached receipt image OCR. 
      Attach the original image to your email and send both the readable OCR text and a JSON with structured fields as the message body, to ${EMAIL}.
    `;

    // Stelle sicher, dass IMMER Rabbit-API verwendet wird
    if(window.r1 && r1.messaging && typeof r1.messaging.sendMessage === 'function') {
      await r1.messaging.sendMessage(
        prompt + "
OCR_TEXT:
" + ocrText,
        {
          useLLM: true,
          pluginId: 'image-analyzer',
          imageBase64: base64 // echtes Bild
        }
      );
      updateStatus('✅ Scan und Versand läuft mit Rabbit LLM!');
      return;
    }
    // Fallback: r1.llm.sendMailToSelf (nur falls messaging nicht geht)
    if(window.r1 && r1.llm && typeof r1.llm.sendMailToSelf === 'function') {
      await r1.llm.sendMailToSelf({
        subject: 'Receipt Scan',
        body: ocrText,
        attachments: [{
          filename: 'receipt.jpg',
          dataUrl: imgDataUrl
        }]
      });
      updateStatus('✅ Scan und Versand erfolgreich! (Fallback)');
      return;
    }
    // Wenn kein Rabbit R1 vorhanden:
    updateStatus('❌ Fehler: Rabbit R1 API nicht verfügbar!');
  }

  // --- Camera handling
  async function startCamera() {
    if (isScanning) return;
    isScanning = true;
    try {
      updateStatus('📷 Kamera startet...');
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
      updateStatus('✋ Click preview to scan');
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

  async function capture() {
    if (isScanning) return;
    isScanning = true;
    try {
      updateStatus('📸 Foto aufgenommen, OCR läuft...');
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
      stopCamera();

      // OCR und Versand
      const ocrText = await runOCR(capturedDataUrl);
      updateStatus('📧 Versand startet...');
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
    updateStatus('Start the scan');
  }

  function bindEvents() {
    if (scanBtn) scanBtn.addEventListener('click', startCamera);
    try {
      if (window.r1 && r1.hardware && typeof r1.hardware.on === 'function') {
        r1.hardware.on('sideClick', () => {
          if (cameraContainer && cameraContainer.classList.contains('active')) capture();
          else startCamera();
        });
      }
    } catch {}
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
