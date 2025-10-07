// Rabbit Receipt Scanner for Rabbit R1 & modern browsers
// UX: Camera replaces scan button at same position, PTT & click trigger, auto OCR-Mail via LLM
(function() {
  'use strict';
  
  // === STATE & DOM
  let stream = null, isScanning = false;
  let scanBtn, cameraContainer, video, statusInfo;
  let lastOCRText = '', lastImageDataUrl = '';
  
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
      
      // Convert to base64 (JPEG with quality 0.7 to reduce size)
      lastImageDataUrl = canvas.toDataURL('image/jpeg', 0.7);
      
      // Run OCR
      updateStatus('🔍 OCR läuft...');
      lastOCRText = await runOCR(lastImageDataUrl);
      
      // Display OCR results
      updateStatus('📄 OCR: ' + (lastOCRText.substring(0, 50) || 'Kein Text erkannt') + '...');
      
      // Send mail via Rabbit LLM with PluginMessageHandler
      updateStatus('📧 Mail wird versendet...');
      await sendReceiptMailViaLLM(lastOCRText, lastImageDataUrl);
      
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
  
  // === SEND MAIL VIA RABBIT LLM WITH PLUGINMESSAGEHANDLER
  async function sendReceiptMailViaLLM(ocrText, imageDataUrl) {
    try {
      // Get user email (if available)
      const userEmail = (window.rabbit && rabbit.user && rabbit.user.email) ? rabbit.user.email : 'your@email.com';
      
      // Create prompt for LLM
      const timestamp = new Date().toLocaleString('de-DE');
      const subject = '🧾 Receipt Scan ' + timestamp;
      const body = `Receipt gescannt am ${timestamp}\n\n=== OCR-Ergebnis ===\n${ocrText}\n\n---\nAutomatisch gescannt mit Rabbit Receipt Scanner`;
      
      const prompt = `You are an assistant. Please email the receipt scan to the user. Return ONLY valid JSON in this exact format: {"action":"email","to":"${userEmail}","subject":"${subject}","body":"${body.replace(/"/g, '\\"')}","attachments":[{"dataUrl":"<receipt_image>"}]}`;
      
      const payload = {
        useLLM: true,
        message: prompt,
        imageDataUrl: imageDataUrl // included for server/tooling
      };
      
      if (typeof PluginMessageHandler !== 'undefined') {
        PluginMessageHandler.postMessage(JSON.stringify(payload));
        console.log('[MAIL] Sent via PluginMessageHandler/LLM');
        console.log('[MAIL] OCR Text:', ocrText);
      } else {
        // Fallback for non-Rabbit environments
        console.warn('[MAIL] PluginMessageHandler not available - mail simulation');
        console.log('[MAIL SIMULATION]');
        console.log('Subject:', subject);
        console.log('Body:', body);
        console.log('OCR Text:', ocrText);
        console.log('Image DataURL length:', imageDataUrl.length);
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
