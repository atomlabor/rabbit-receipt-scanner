(function() {
  'use strict';
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

  async function sendToRabbitLLM({ ocrText, imgDataUrl }) {
    const base64 = imgDataUrl.split(',')[1] || '';
    const EMAIL = 'me@rabbit.tech';
    const prompt = `
      You are an assistant. 
      Please extract all logical fields (shop, date, amount, VAT ID, etc.) from the attached receipt image OCR. 
      Attach the original image to your email and send both the readable OCR text and a JSON with structured fields as the message body, to ${EMAIL}.
    `;

    if(window.r1 && r1.messaging && typeof r1.messaging.sendMessage === 'function') {
      await r1.messaging.sendMessage(
        prompt + "
OCR_TEXT:
" + ocrText,
        {
          useLLM: true,
          pluginId: 'image-analyzer',
          imageBase64: base64
        }
      );
      updateStatus('✅ Scan und Versand läuft mit Rabbit LLM!');
      return;
    }
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
    updateStatus('❌ Fehler: Rabbit R1 API nicht verfügbar!');
  }

  // --- CAMERA logic: Rabbit = direct Photo, Browser = getUserMedia Preview ---
  async function startCamera() {
    if (isScanning) return;
    isScanning = true;
    try {
      updateStatus('📷 Kamera startet...');
      if (hasR1CameraAPI()) {
        // Kein Video! Zeige Button/Overlay und triggere direkt Scan
        cameraContainer.classList.add('active');
        updateStatus('✋ Tippe auf "Scan starten"! (oder Side-Taste)');
        // Ersetze Camera-UI ggf. durch eigenen Scan-Button
        scanBtn.style.display = 'none';
        cameraContainer.innerHTML = '<button id="r1ScanNow" style="width:90%;height:128px;font-size:2em;margin:24px auto;display:block;">Scan starten</button>';
        document.getElementById('r1ScanNow').onclick = async function() {
          await capture();
        };
        // Side-Taste geht automatisch über bindEvents
        isScanning = false;
        return;
      }
      // Nur BROSWER-FALL: getUserMedia Preview
      if (!video) {
        video = document.getElementById('videoPreview') || document.createElement('video');
        video.id = 'videoPreview';
        video.setAttribute('playsinline', '');
        video.setAttribute('autoplay', '');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 400, height: 240 }
      });
      video.srcObject = stream;
      await video.play();
      if (scanBtn) scanBtn.style.display = 'none';
      cameraContainer.classList.add('active');
      cameraContainer.innerHTML = '';
      cameraContainer.appendChild(video);
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'contain';
      video.style.display = 'block';
      video.style.cursor = 'pointer';
      video.addEventListener('click', capture);
      updateStatus('✋ Click preview to scan');
    } catch (e) {
      updateStatus('❌ Kamera-Fehler: ' + e.message);
      isScanning = false;
    }
    isScanning = false;
  }

  function stopCamera() {
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    cameraContainer.classList.remove('active');
    cameraContainer.innerHTML = '';
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
      const ocrText = await runOCR(capturedDataUrl);
      updateStatus('📧 Versand startet...');
      await sendToRabbitLLM({ ocrText, imgDataUrl: capturedDataUrl });
      setTimeout(resetUI, 2500);
    } catch (e) {
      updateStatus('❌ Fehler: ' + e.message);
      setTimeout(resetUI, 2500);
    }
    isScanning = false;
  }

  function resetUI() {
    isScanning = false;
    if (scanBtn) scanBtn.style.display = 'flex';
    cameraContainer.classList.remove('active');
    cameraContainer.innerHTML = '';
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    updateStatus('Start the scan');
  }

  function bindEvents() {
    // Scan-Button für Browser und Rabbit
    if (scanBtn) {
      scanBtn.onclick = null;
      scanBtn.addEventListener('click', startCamera);
      scanBtn.addEventListener('touchstart', function(e){
        e.preventDefault(); startCamera();
      }, {passive: false});
    }
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
