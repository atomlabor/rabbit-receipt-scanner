// Rabbit Receipt Scanner - Fixed Tesseract.js CDN/Worker issue
// OCR supports both German and English
// TRIGGER: After successful OCR scan, automatically sends receipt via Rabbit LLM to user's email
(function() {
  'use strict';
  function errToString(err) { try { return (err && (err.message || (err.toString && err.toString()))) || JSON.stringify(err) || 'Unknown error'; } catch { return 'Unknown error'; } }
  
  let stream = null, isScanning = false, currentState = 'idle';
  let capturedImageData = null, ocrResultText = '';
  let statusText, scanBtn, cameraContainer, video, canvas, preview, previewImg;
  let results, ocrText, processing, processText, retryBtn, captureBtn, actions;
  
  function init() {
    console.log('[INIT] Initializing Receipt Scanner...');
    statusText = document.getElementById('statusText');
    scanBtn = document.getElementById('scanBtn');
    cameraContainer = document.getElementById('cameraContainer');
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    preview = document.getElementById('preview');
    previewImg = document.getElementById('previewImg');
    results = document.getElementById('results');
    ocrText = document.getElementById('ocrText');
    processing = document.getElementById('processing');
    processText = document.getElementById('processText');
    retryBtn = document.getElementById('retryBtn');
    captureBtn = document.getElementById('captureBtn');
    actions = document.getElementById('actions');
    if (!scanBtn) { console.error('[INIT] Scan button not found!'); return; }
    scanBtn.addEventListener('click', function(e) { console.log('[UI] Scan button clicked'); e.preventDefault(); startCamera(); });
    video && video.addEventListener('click', captureImage);
    cameraContainer && cameraContainer.addEventListener('click', captureImage);
    captureBtn && captureBtn.addEventListener('click', captureImage);
    retryBtn && retryBtn.addEventListener('click', reset);
    console.log('[INIT] Receipt Scanner initialized successfully');
  }
  
  async function startCamera() {
    console.log('[CAMERA] Starting camera...');
    try {
      currentState = 'camera'; updateUI();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
      video.srcObject = stream; await video.play(); console.log('[CAMERA] Camera started successfully');
    } catch (err) { const msg = errToString(err); console.error('[CAMERA] Error accessing camera:', msg, err); alert('Could not access camera: ' + msg); reset(); }
  }
  
  function captureImage() {
    if (currentState !== 'camera' || isScanning) return;
    console.log('[CAPTURE] Capturing image...');
    try {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
      capturedImageData = canvas.toDataURL('image/jpeg', 0.92);
      console.log('[CAPTURE] Captured image size:', capturedImageData ? capturedImageData.length : 0);
      stopCamera(); previewImg.src = capturedImageData; currentState = 'preview'; updateUI(); processOCR(capturedImageData);
    } catch (err) { const msg = errToString(err); console.error('[CAPTURE] Error capturing image:', msg, err); alert('Error capturing image: ' + msg); }
  }
  
  async function processOCR(imageData) {
    if (isScanning) return; isScanning = true; console.log('[OCR] Starting OCR processing...');
    try {
      currentState = 'processing'; updateUI(); if (processText) processText.textContent = 'Initializing OCR...';
      console.log('[OCR] Creating Tesseract worker with version 5.1.1...');
      
      // Use Tesseract.js v5 simplified API - supports both German and English
      const worker = await Tesseract.createWorker('deu+eng', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        langPath: 'https://cdn.jsdelivr.net/npm/tessdata-fast@4.1.0',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0',
        logger: m => { 
          try { 
            if (m && m.status) { 
              if (m.status !== 'recognizing text') { 
                const pct = typeof m.progress === 'number' ? Math.round(m.progress * 100) + '%' : ''; 
                console.log('[OCR][worker]', m.status, pct); 
                if (processText) processText.textContent = m.status + (pct ? ' ' + pct : ''); 
              } else { 
                const progress = Math.round((m.progress || 0) * 100); 
                if (processText) processText.textContent = `Processing: ${progress}%`; 
              } 
            } else { 
              console.log('[OCR][worker]', m); 
            } 
          } catch (e) { 
            console.warn('[OCR][logger] Failed to log progress:', errToString(e)); 
          } 
        }
      });
      
      console.log('[OCR] Worker created, calling worker.recognize...');
      const { data } = await worker.recognize(imageData); 
      ocrResultText = (data && data.text) || ''; 
      console.log('[OCR] Recognize finished. Text length:', ocrResultText.length);
      
      try { 
        console.log('[OCR] Terminating worker...'); 
        await worker.terminate(); 
        console.log('[OCR] Worker terminated'); 
      } catch (termErr) { 
        console.warn('[OCR] Worker termination failed:', errToString(termErr)); 
      }
      
      const interpretedText = interpretReceipt(ocrResultText); 
      if (ocrText) ocrText.innerHTML = interpretedText; 
      currentState = 'results'; updateUI(); isScanning = false; 
      console.log('[OCR] Completed, sending via Rabbit Mail...'); 
      await sendReceiptViaRabbitMail(ocrResultText);
    } catch (err) { 
      const msg = errToString(err); 
      console.error('[OCR] Error during OCR:', msg, err); 
      if (ocrText) ocrText.textContent = 'Error: Could not process receipt. ' + msg; 
      currentState = 'results'; updateUI(); isScanning = false; 
    }
  }
  
  function interpretReceipt(text) {
    try {
      if (!text || text.trim().length === 0) { return '<span style="color: #ff6b00;">No text detected. Please try again.</span>'; }
      let formatted = '<div style="font-size: 10px; line-height: 1.5;">';
      const lines = text.split('\n').filter(line => line.trim().length > 0);
      const totalPatterns = [/(?:total|gesamt|summe|betrag).*?(\d+[.,]\d{2})/i, /(\d+[.,]\d{2}).*?(?:€|EUR|eur)/i, /(?:€|EUR)\s*(\d+[.,]\d{2})/i];
      let foundTotal = null; for (const pattern of totalPatterns) { for (const line of lines) { const match = line.match(pattern); if (match) { foundTotal = match[1] || match[0]; break; } } if (foundTotal) break; }
      const datePatterns = [/\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}/, /\d{2,4}[\.\/-]\d{1,2}[\.\/-]\d{1,2}/];
      let foundDate = null; for (const pattern of datePatterns) { for (const line of lines) { const match = line.match(pattern); if (match) { foundDate = match[0]; break; } } if (foundDate) break; }
      formatted += '<div style="margin-bottom: 12px; padding: 8px; background: #222; border-radius: 4px;">';
      if (foundTotal) { formatted += `<div style="color: #ff6b00; font-weight: bold; font-size: 11px;">Total: ${foundTotal}</div>`; }
      if (foundDate) { formatted += `<div style="color: #aaa; font-size: 9px; margin-top: 4px;">Date: ${foundDate}</div>`; }
      formatted += '</div>';
      formatted += '<div style="color: #ccc; white-space: pre-wrap; font-size: 9px;">';
      formatted += text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      formatted += '</div></div>';
      return formatted;
    } catch (err) { const msg = errToString(err); console.error('[INTERPRET] Error interpreting text:', msg, err); return 'Error interpreting OCR result: ' + msg; }
  }
  
  async function sendReceiptViaRabbitMail(ocrTextValue) {
    try {
      if (processText) processText.textContent = 'Sending via Rabbit Mail...'; processing && processing.classList.add('active');
      if (typeof rabbit === 'undefined' || !rabbit.llm || !rabbit.llm.sendMailToSelf) { console.warn('[MAIL] Rabbit LLM API not available. Running in browser mode.'); console.log('[MAIL] Would send receipt with OCR text:', ocrTextValue); processing && processing.classList.remove('active'); return; }
      const timestamp = new Date().toLocaleString('de-DE'); const subject = `Receipt Scan - ${timestamp}`; const body = `Receipt scanned on ${timestamp}\n\n` + `--- OCR TEXT ---\n${ocrTextValue}\n\n` + `This receipt was automatically scanned and sent by Rabbit Receipt Scanner.`;
      console.log('[MAIL] Calling rabbit.llm.sendMailToSelf'); await rabbit.llm.sendMailToSelf({ subject, body, attachment: capturedImageData }); console.log('[MAIL] Receipt sent successfully via Rabbit LLM'); if (statusText) statusText.textContent = '✓ Receipt sent!'; setTimeout(() => { if (statusText) statusText.textContent = 'rabbit receipt scanner'; }, 3000); processing && processing.classList.remove('active');
    } catch (err) { const msg = errToString(err); console.error('[MAIL] Rabbit Mail error:', msg, err); alert('Could not send via Rabbit Mail: ' + msg); processing && processing.classList.remove('active'); }
  }
  
  function stopCamera() { try { if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; if (video) video.srcObject = null; } } catch (err) { console.warn('[CAMERA] stopCamera error:', errToString(err)); } }
  
  function reset() { stopCamera(); isScanning = false; currentState = 'idle'; capturedImageData = null; ocrResultText = ''; if (ocrText) ocrText.textContent = 'Scanning...'; updateUI(); }
  
  function updateUI() {
    try {
      if (scanBtn) scanBtn.style.display = 'none';
      cameraContainer && cameraContainer.classList.remove('active');
      preview && preview.classList.remove('active');
      results && results.classList.remove('active');
      processing && processing.classList.remove('active');
      actions && actions.classList.remove('active');
      switch (currentState) {
        case 'idle': if (scanBtn) scanBtn.style.display = 'flex'; break;
        case 'camera': cameraContainer && cameraContainer.classList.add('active'); actions && actions.classList.add('active'); break;
        case 'preview': preview && preview.classList.add('active'); actions && actions.classList.add('active'); break;
        case 'processing': preview && preview.classList.add('active'); processing && processing.classList.add('active'); actions && actions.classList.remove('active'); break;
        case 'results': if (results) results.classList.add('active'); if (actions) actions.classList.add('active'); break;
      }
    } catch (err) { console.warn('[UI] updateUI error:', errToString(err)); }
  }
  
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
