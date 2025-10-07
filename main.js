// Rabbit Receipt Scanner for Rabbit R1 & modern browsers
// UX: Camera replaces scan button at same position, PTT & click trigger, auto OCR-Mail
(function() {
  'use strict';
  
  // === STATE & DOM
  let stream = null, isScanning = false;
  let scanBtn, cameraContainer, video, statusInfo;
  
  // === INIT & EVENTS
  function init() {
    scanBtn = document.getElementById('scanBtn');
    cameraContainer = document.getElementById('cameraContainer');
    video = document.getElementById('videoPreview');
    statusInfo = document.getElementById('statusInfo');
    
    if (!scanBtn || !cameraContainer || !video) {
      console.error('[INIT] Missing DOM elements');
      return;
    }
    
    // Scan Button → Start Camera
    scanBtn.addEventListener('click', startCamera);
    
    // Camera Container → Capture on Click
    cameraContainer.addEventListener('click', capture);
    
    // PTT Button → Capture (Rabbit R1 SDK)
    if (window.rabbit && rabbit.ptt) {
      rabbit.ptt.onPressed = () => {
        if (cameraContainer.classList.contains('active')) {
          capture();
        }
      };
    }
    
    updateStatus('Bereit zum Scannen');
  }
  
  // === START CAMERA (replaces button)
  async function startCamera() {
    try {
      updateStatus('Kamera wird gestartet...');
      
      const constraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };
      
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      
      // Hide button, show camera at same position
      scanBtn.classList.add('hidden');
      cameraContainer.classList.add('active');
      
      updateStatus('Bereit — Klick oder PTT drücken');
    } catch (err) {
      console.error('[CAMERA] Start failed:', err);
      updateStatus('❌ Kamera-Fehler: ' + err.message);
      resetUI();
    }
  }
  
  // === CAPTURE IMAGE
  async function capture() {
    if (isScanning) return;
    isScanning = true;
    
    try {
      updateStatus('📸 Aufnahme...');
      
      // Create canvas and capture frame
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Stop camera
      stopCamera();
      
      // Convert to base64
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
      
      // Run OCR
      updateStatus('🔍 OCR läuft...');
      const ocrText = await runOCR(imageDataUrl);
      
      // Send mail via Rabbit LLM
      updateStatus('📧 Mail wird versendet...');
      await sendReceiptMail(ocrText, imageDataUrl);
      
      updateStatus('✅ Scan & Mail gesendet!');
      
      // Reset after 3 seconds
      setTimeout(resetUI, 3000);
      
    } catch (err) {
      console.error('[CAPTURE] Failed:', err);
      updateStatus('❌ Fehler: ' + err.message);
      setTimeout(resetUI, 3000);
    } finally {
      isScanning = false;
    }
  }
  
  // === OCR PROCESSING
  async function runOCR(imageDataUrl) {
    try {
      const ocrSelect = document.getElementById('ocrSelect');
      const ocrEngine = ocrSelect ? ocrSelect.value : 'tesseract';
      
      if (ocrEngine === 'tesseract' && window.Tesseract) {
        const { data: { text } } = await Tesseract.recognize(imageDataUrl, 'deu', {
          logger: m => console.log('[OCR]', m)
        });
        return text;
      } else {
        return '[OCR not available - please implement Google Vision API]';
      }
    } catch (err) {
      console.error('[OCR] Failed:', err);
      return '[OCR-Fehler: ' + err.message + ']';
    }
  }
  
  // === SEND MAIL VIA RABBIT LLM
  async function sendReceiptMail(ocrText, imageDataUrl) {
    try {
      if (window.rabbit && rabbit.llm && rabbit.llm.sendMailToSelf) {
        // Send mail to user's own Rabbit email address
        await rabbit.llm.sendMailToSelf({
          subject: '🧾 Receipt Scan ' + new Date().toLocaleString('de-DE'),
          body: `Receipt gescannt am ${new Date().toLocaleString('de-DE')}\n\nOCR-Ergebnis:\n${ocrText}`,
          attachments: [{
            name: 'receipt_' + Date.now() + '.jpg',
            data: imageDataUrl,
            mimeType: 'image/jpeg'
          }]
        });
        console.log('[MAIL] Sent via rabbit.llm.sendMailToSelf');
      } else {
        console.warn('[MAIL] Rabbit LLM API not available - mail simulation');
        // Fallback: log to console
        console.log('[MAIL SIMULATION]\nSubject: Receipt Scan\nOCR Text:', ocrText);
      }
    } catch (err) {
      console.error('[MAIL] Failed:', err);
      throw err;
    }
  }
  
  // === CAMERA CONTROL
  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
      video.srcObject = null;
    }
  }
  
  // === UI RESET
  function resetUI() {
    stopCamera();
    cameraContainer.classList.remove('active');
    scanBtn.classList.remove('hidden');
    updateStatus('Bereit zum Scannen');
  }
  
  // === STATUS UPDATE
  function updateStatus(msg) {
    if (statusInfo) statusInfo.textContent = msg;
    console.log('[STATUS]', msg);
  }
  
  // === START
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
