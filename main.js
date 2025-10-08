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
  function hasR1StorageAPI() {
    return window.r1 && r1.storage && typeof r1.storage.save === 'function';
  }
  function updateStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
    console.log('[Status]', msg);
  }

  function dataURLtoBlob(dataUrl) {
    const arr = dataUrl.split(','), mime = arr[0].match(/:(.*?);/)[1],
      bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--) u8arr[n] = bstr.charCodeAt(n);
    return new Blob([u8arr], { type: mime });
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
      const { data: { text } } = await window.Tesseract.recognize(
        dataUrl, 'deu+eng',
        { logger: m => console.log(m) }
      );
      return text || '';
    } catch (e) {
      console.error('[OCR] Error:', e);
      return '';
    }
  }

  async function savePhotoToR1(capturedDataUrl) {
    if (!hasR1StorageAPI()) {
      updateStatus("Fehler: Keine Speicher-API auf diesem Device!");
      return null;
    }
    const now = new Date();
    const p = `/photos/receipt_${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}.jpg`;
    const blob = dataURLtoBlob(capturedDataUrl);
    await r1.storage.save(p, blob);
    updateStatus(`Foto gespeichert als ${p}`);
    return p;
  }

  async function sendToRabbitLLM({ ocrText, imgDataUrl, filePath }) {
    // Mail per Rabbit LLM API senden
    if (window.r1 && r1.llm && typeof r1.llm.sendMailToSelf === 'function') {
      await r1.llm.sendMailToSelf({
        subject: 'Rabbit Receipt Scan',
        body: `${ocrText}\n\n[Gespeichert unter: ${filePath || 'temporär'}]`,
        attachments: [{
          filename: filePath ? filePath.split('/').pop() : 'receipt.jpg',
          dataUrl: imgDataUrl
        }]
      });
      updateStatus('✅ Scan und Versand abgeschlossen!');
      return;
    }
    updateStatus('❌ Fehler: Rabbit LLM API nicht verfügbar!');
  }

  async function startCamera() {
    if (isScanning) return;
    isScanning = true;
    try {
      updateStatus('📷 Kamera wird vorbereitet...');
      // Button verstecken, Container leeren & neu positionieren
      scanBtn && (scanBtn.style.display = 'none');
      cameraContainer.classList.add('active');
      cameraContainer.innerHTML = '';
      if (hasR1CameraAPI()) {
        // Für R1: Overlay-Scan-Fläche
        const overlay = document.createElement('div');
        overlay.id = 'r1TapArea';
        overlay.style.width = '100%';
        overlay.style.height = '160px';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.background = '#111';
        overlay.style.color = 'orange';
        overlay.style.fontSize = '2.5em';
        overlay.style.cursor = 'pointer';
        overlay.innerHTML = 'Tippe zum Fotografieren';
        overlay.onclick = capture;
        cameraContainer.appendChild(overlay);
        updateStatus('Tippe auf das dunkle Feld, um ein Foto aufzunehmen!');
      } else {
        // Browser: Live-Kamerapreview per getUserMedia
        if (!video) {
          video = document.createElement('video');
          video.id = 'videoPreview';
        }
        video.setAttribute('playsinline', '');
        video.setAttribute('autoplay', '');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: 400, height: 240 }
        });
        video.srcObject = stream;
        await video.play();
        video.style.width = '100%';
        video.style.height = '160px';
        video.style.objectFit = 'contain';
        video.style.display = 'block';
        video.style.cursor = 'pointer';
        cameraContainer.appendChild(video);
        video.addEventListener('click', capture);
        updateStatus('Klicke in das Vorschaufenster zum Scannen!');
      }
    } catch (e) {
      updateStatus('❌ Kamera-Fehler: ' + e.message);
      isScanning = false;
    }
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
      updateStatus('📸 Foto wird aufgenommen ...');
      let capturedDataUrl;
      let filePath = null;
      if (hasR1CameraAPI()) {
        const photo = await r1.camera.capturePhoto(400, 240);
        capturedDataUrl = (typeof photo === 'string' && photo.startsWith('data:'))
          ? photo : await normalizeToDataUrl(photo);
        // Direkt speichern im Speicher
        filePath = await savePhotoToR1(capturedDataUrl);
      } else {
        // Browser
        if (!video || !video.videoWidth) throw new Error('Video nicht bereit');
        const c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext('2d').drawImage(video, 0, 0);
        capturedDataUrl = c.toDataURL('image/jpeg', 0.7);
      }
      stopCamera();
      const ocrText = await runOCR(capturedDataUrl);
      updateStatus('📧 Sende Scan an deine Rabbit-Mail ...');
      await sendToRabbitLLM({ ocrText, imgDataUrl: capturedDataUrl, filePath });
      setTimeout(resetUI, 2500);
    } catch (e) {
      updateStatus('❌ Fehler: ' + e.message);
      setTimeout(resetUI, 2500);
    }
    isScanning = false;
  }

  function resetUI() {
    isScanning = false;
    scanBtn && (scanBtn.style.display = 'flex');
    cameraContainer.classList.remove('active');
    cameraContainer.innerHTML = '';
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    updateStatus('Bereit zum Scannen');
  }

  function bindEvents() {
    if (scanBtn) {
      scanBtn.onclick = null;
      scanBtn.addEventListener('click', startCamera);
      scanBtn.addEventListener('touchstart', function(e){
        e.preventDefault(); startCamera();
      }, {passive: false});
    }
    // Seitentaste/Multi-Input für Rabbit R1
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
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else
    init();
})();
