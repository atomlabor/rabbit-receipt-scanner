(function() {
  'use strict';
  // --- DOM References ---
  const scanBtn = document.getElementById('scanBtn');
  const cameraContainer = document.getElementById('cameraContainer');
  const statusEl = document.getElementById('statusInfo');
  let video = document.getElementById('videoPreview');
  let isScanning = false;
  let lastImageDataUrl = '';
  let lastOCRText = '';
  
  // --- Utils
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
  
  function resetUI() {
    isScanning = false;
    // Show button again, hide camera
    if (scanBtn) scanBtn.style.display = 'flex';
    if (cameraContainer) cameraContainer.classList.remove('active');
    if (video) {
      video.removeEventListener('click', capture);
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
      }
    }
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
  
  // --- Mail via LLM (Rabbit PluginMessageHandler format)
  async function sendReceiptMail(ocrText, imgDataUrl) {
    updateStatus('📧 E-Mail wird versendet...');
    
    // Try Rabbit LLM API with PluginMessageHandler (new format as per example)
    if (typeof PluginMessageHandler !== 'undefined') {
      try {
        const toEmail = 'me@rabbit.tech'; // Default Rabbit internal mail
        const prompt = `You are an assistant. Please email the attached receipt image with OCR text to the recipient. Return ONLY valid JSON in this exact format: {"action":"email","to":"${toEmail}","subject":"Receipt Scan","body":"${(ocrText || 'No text recognized').replace(/"/g, '\\"').replace(/\n/g, ' ')}","attachments":[{"dataUrl":"${imgDataUrl}"}]}`;
        
        const payload = {
          useLLM: true,
          message: prompt,
          imageDataUrl: imgDataUrl
        };
        
        PluginMessageHandler.postMessage(JSON.stringify(payload));
        updateStatus('✅ Scan und Versand erfolgreich!');
        console.log('[Mail] Sent via PluginMessageHandler:', payload);
        return;
      } catch (e) {
        console.error('[Mail] PluginMessageHandler failed:', e);
      }
    }
    
    // Fallback: Try legacy r1.llm.sendMailToSelf
    if (window.r1 && r1.llm && typeof r1.llm.sendMailToSelf === 'function') {
      try {
        await r1.llm.sendMailToSelf({
          subject: 'Beleg gescannt',
          body: ocrText || 'Kein Text erkannt',
          attachments: [{ data: imgDataUrl, filename: 'receipt.jpg' }]
        });
        updateStatus('✅ Scan und Versand erfolgreich!');
        console.log('[Mail] Sent via r1.llm.sendMailToSelf');
      } catch (e) {
        console.error('[Mail] Legacy API failed:', e);
        throw e;
      }
    } else {
      console.warn('[Mail] Simulated (Rabbit LLM API not available)');
      console.log('[Mail] Would send:', { ocrText, imgDataUrl: imgDataUrl.substring(0, 50) + '...' });
      updateStatus('✅ Scan und Versand erfolgreich! (simuliert)');
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
        res(c.toDataURL('image/jpeg', 0.7));
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
      
      // Ensure video element exists
      if (!video) {
        video = document.getElementById('videoPreview');
        if (!video) {
          video = document.createElement('video');
          video.id = 'videoPreview';
          video.setAttribute('playsinline', '');
          video.setAttribute('autoplay', '');
        }
      }
      
      if (!hasR1CameraAPI()) {
        // Request camera stream
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: 400, height: 240 }
        });
        video.srcObject = stream;
        await video.play();
      }
      
      // 1. Hide scanBtn
      if (scanBtn) scanBtn.style.display = 'none';
      
      // 2. Show cameraContainer with active class (triggers display:flex from CSS)
      if (cameraContainer) {
        cameraContainer.classList.add('active');
      }
      
      // 3. Video styling - CONTAIN to fit fully in frame (CSS already handles this)
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'contain';
      video.style.display = 'block';
      video.style.cursor = 'pointer';
      
      // 4. Add click event listener to video for capture - THIS STARTS OCR
      video.addEventListener('click', capture);
      console.log('[Camera] Click listener added to video - clicking starts OCR');
      
      updateStatus('✋ Tippe auf die Preview zum Aufnehmen');
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
  
  // --- Capture (R1 preferred) - STARTS OCR CHAIN
  async function capture() {
    if (isScanning) return;
    isScanning = true;
    
    try {
      updateStatus('📸 Foto aufgenommen, OCR läuft...');
      let capturedDataUrl = '';
      
      if (hasR1CameraAPI()) {
        const photo = await r1.camera.capturePhoto(400, 240);
        capturedDataUrl = await normalizeToDataUrl(photo);
      } else {
        if (!video || !video.videoWidth) throw new Error('Video nicht bereit');
        const c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        const cx = c.getContext('2d');
        cx.drawImage(video, 0, 0);
        capturedDataUrl = c.toDataURL('image/jpeg', 0.7);
      }
      
      stopCamera();
      
      updateStatus('🖼️ Bild wird vorverarbeitet...');
      const preprocessed = await preprocessDataUrl(capturedDataUrl);
      lastImageDataUrl = preprocessed;
      
      updateStatus('🔍 OCR läuft...');
      lastOCRText = await runOCR(preprocessed);
      
      updateStatus('📧 Ergebnis erkannt, E-Mail wird versendet...');
      await sendReceiptMail(lastOCRText, preprocessed);
      
      // Status is set within sendReceiptMail
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
    bindEvents();
    updateStatus('Bereit zum Scannen');
  }
  
  // Start when DOM ready
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
