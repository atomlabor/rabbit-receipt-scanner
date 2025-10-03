// Rabbit Receipt Scanner - Stable version with robust Tesseract debug and errors
// OCR supports both German and English
// TRIGGER: After successful OCR scan, automatically sends receipt via Rabbit LLM to user's email
(function() {
  'use strict';

  // Helper: safe error string
  function errToString(err) {
    try {
      return (err && (err.message || err.toString && err.toString())) || JSON.stringify(err) || 'Unknown error';
    } catch (e) {
      return 'Unknown error';
    }
  }

  // State management
  let stream = null;
  let isScanning = false;
  let currentState = 'idle'; // idle, camera, preview, results
  let capturedImageData = null;
  let ocrResultText = '';

  // DOM elements
  let statusText, scanBtn, cameraContainer, video, canvas, preview, previewImg;
  let results, ocrText, processing, processText, retryBtn, captureBtn, actions;

  // Initialize when DOM is ready
  function init() {
    console.log('[INIT] Initializing Receipt Scanner...');

    // Get DOM elements
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

    if (!scanBtn) {
      console.error('[INIT] Scan button not found!');
      return;
    }

    console.log('[INIT] Attaching event listeners...');

    scanBtn.addEventListener('click', function(e) {
      console.log('[UI] Scan button clicked');
      e.preventDefault();
      startCamera();
    });

    video && video.addEventListener('click', captureImage);
    cameraContainer && cameraContainer.addEventListener('click', captureImage);
    captureBtn && captureBtn.addEventListener('click', captureImage);
    retryBtn && retryBtn.addEventListener('click', reset);

    console.log('[INIT] Receipt Scanner initialized successfully');
  }

  // Start camera
  async function startCamera() {
    console.log('[CAMERA] Starting camera...');
    try {
      currentState = 'camera';
      updateUI();

      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      video.srcObject = stream;
      await video.play();

      console.log('[CAMERA] Camera started successfully');
    } catch (err) {
      const msg = errToString(err);
      console.error('[CAMERA] Error accessing camera:', msg, err);
      alert('Could not access camera: ' + msg);
      reset();
    }
  }

  // Capture image from video
  function captureImage() {
    if (currentState !== 'camera' || isScanning) return;

    console.log('[CAPTURE] Capturing image...');
    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);

      capturedImageData = canvas.toDataURL('image/jpeg', 0.92);
      console.log('[CAPTURE] Captured image size:', capturedImageData ? capturedImageData.length : 0);

      stopCamera();

      previewImg.src = capturedImageData;
      currentState = 'preview';
      updateUI();

      processOCR(capturedImageData);
    } catch (err) {
      const msg = errToString(err);
      console.error('[CAPTURE] Error capturing image:', msg, err);
      alert('Error capturing image: ' + msg);
    }
  }

  // Process OCR with Tesseract.js (supports German and English)
  async function processOCR(imageData) {
    if (isScanning) return;
    isScanning = true;

    console.log('[OCR] Starting OCR processing...');
    try {
      currentState = 'processing';
      updateUI();
      if (processText) processText.textContent = 'Initializing OCR...';

      // Create worker with detailed logger
      console.log('[OCR] Creating Tesseract worker...');
      const worker = await Tesseract.createWorker(['deu', 'eng'], 1, {
        logger: m => {
          try {
            if (m && m.status) {
              // Before recognize
              if (m.status !== 'recognizing text') {
                console.log('[OCR][worker]', m.status, typeof m.progress === 'number' ? Math.round(m.progress * 100) + '%' : '');
                if (processText) processText.textContent = m.status;
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
      console.log('[OCR] Worker created');

      // Optional explicit load/initialize to ensure proper init
      try {
        console.log('[OCR] Loading languages deu+eng...');
        await worker.loadLanguage && worker.loadLanguage('deu+eng');
        console.log('[OCR] Initializing languages...');
        await worker.initialize && worker.initialize('deu+eng');
      } catch (initErr) {
        console.warn('[OCR] Optional load/initialize step failed (will proceed):', errToString(initErr));
      }

      console.log('[OCR] Calling worker.recognize...');
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

      currentState = 'results';
      updateUI();
      isScanning = false;

      console.log('[OCR] Completed, sending via Rabbit Mail...');
      await sendReceiptViaRabbitMail(ocrResultText);

    } catch (err) {
      const msg = errToString(err);
      console.error('[OCR] Error during OCR:', msg, err);
      if (ocrText) ocrText.textContent = 'Error: Could not process receipt. ' + msg;
      currentState = 'results';
      updateUI();
      isScanning = false;
    }
  }

  // Interpret receipt text (German and English support)
  function interpretReceipt(text) {
    try {
      if (!text || text.trim().length === 0) {
        return '<span style="color: #ff6b00;">No text detected. Please try again.</span>';
      }

      let formatted = '<div style="font-size: 10px; line-height: 1.5;">';

      const lines = text.split('\n').filter(line => line.trim().length > 0);

      // Look for total amount (in German and English)
      const totalPatterns = [
        /(?:total|gesamt|summe|betrag).*?(\d+[.,]\d{2})/i,
        /(\d+[.,]\d{2}).*?(?:€|EUR|eur)/i,
        /(?:€|EUR)\s*(\d+[.,]\d{2})/i
      ];

      let foundTotal = null;
      for (const pattern of totalPatterns) {
        for (const line of lines) {
          const match = line.match(pattern);
          if (match) { foundTotal = match[1] || match[0]; break; }
        }
        if (foundTotal) break;
      }

      // Look for date (multiple formats)
      const datePatterns = [
        /\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}/,
        /\d{2,4}[\.\/-]\d{1,2}[\.\/-]\d{1,2}/
      ];

      let foundDate = null;
      for (const pattern of datePatterns) {
        for (const line of lines) {
          const match = line.match(pattern);
          if (match) { foundDate = match[0]; break; }
        }
        if (foundDate) break;
      }

      // Highlight important information
      formatted += '<div style="margin-bottom: 12px; padding: 8px; background: #222; border-radius: 4px;">';
      if (foundTotal) {
        formatted += `<div style="color: #ff6b00; font-weight: bold; font-size: 11px;">Total: ${foundTotal}</div>`;
      }
      if (foundDate) {
        formatted += `<div style="color: #999; font-size: 9px; margin-top: 4px;">Date: ${foundDate}</div>`;
      }
      formatted += '</div>';

      // Add full text with HTML escaping
      formatted += '<div style="color: #ccc; white-space: pre-wrap; font-size: 9px;">';
      formatted += text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      formatted += '</div>';

      formatted += '</div>';

      return formatted;
    } catch (err) {
      const msg = errToString(err);
      console.error('[INTERPRET] Error interpreting text:', msg, err);
      return 'Error interpreting OCR result: ' + msg;
    }
  }

  /**
   * TRIGGER: Sends receipt via Rabbit LLM mail after successful OCR scan.
   * Automatically called when OCR processing completes.
   *
   * Uses rabbit.llm.sendMailToSelf() API:
   * - Subject: Receipt scan with date/time
   * - Body: Formatted OCR text with extracted information
   * - Attachment: Original scanned receipt image as JPEG
   */
  async function sendReceiptViaRabbitMail(ocrTextValue) {
    try {
      if (processText) processText.textContent = 'Sending via Rabbit Mail...';
      processing && processing.classList.add('active');

      // Check if Rabbit LLM API is available
      if (typeof rabbit === 'undefined' || !rabbit.llm || !rabbit.llm.sendMailToSelf) {
        console.warn('[MAIL] Rabbit LLM API not available. Running in browser mode.');
        console.log('[MAIL] Would send receipt with OCR text:', ocrTextValue);
        processing && processing.classList.remove('active');
        return;
      }

      const timestamp = new Date().toLocaleString('de-DE');
      const subject = `Receipt Scan - ${timestamp}`;
      const body = `Receipt scanned on ${timestamp}\n\n` +
        `--- OCR TEXT ---\n${ocrTextValue}\n\n` +
        `This receipt was automatically scanned and sent by Rabbit Receipt Scanner.`;

      console.log('[MAIL] Calling rabbit.llm.sendMailToSelf');
      await rabbit.llm.sendMailToSelf({
        subject: subject,
        body: body,
        attachment: capturedImageData
      });
      console.log('[MAIL] Receipt sent successfully via Rabbit LLM');

      if (statusText) statusText.textContent = '✓ Receipt sent!';
      setTimeout(() => { if (statusText) statusText.textContent = 'rabbit receipt scanner'; }, 3000);

      processing && processing.classList.remove('active');
    } catch (err) {
      const msg = errToString(err);
      console.error('[MAIL] Rabbit Mail error:', msg, err);
      alert('Could not send via Rabbit Mail: ' + msg);
      processing && processing.classList.remove('active');
    }
  }

  // Stop camera stream
  function stopCamera() {
    try {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
        if (video) video.srcObject = null;
      }
    } catch (err) {
      console.warn('[CAMERA] stopCamera error:', errToString(err));
    }
  }

  // Reset to initial state
  function reset() {
    stopCamera();
    isScanning = false;
    currentState = 'idle';
    capturedImageData = null;
    ocrResultText = '';
    if (ocrText) ocrText.textContent = 'Scanning...';
    updateUI();
  }

  // Update UI based on current state
  function updateUI() {
    try {
      // Reset all states
      if (scanBtn) scanBtn.style.display = 'none';
      cameraContainer && cameraContainer.classList.remove('active');
      preview && preview.classList.remove('active');
      results && results.classList.remove('active');
      processing && processing.classList.remove('active');
      actions && actions.classList.remove('active');

      // Apply current state
      switch (currentState) {
        case 'idle':
          if (scanBtn) scanBtn.style.display = 'flex';
          break;

        case 'camera':
          cameraContainer && cameraContainer.classList.add('active');
          actions && actions.classList.add('active');
          break;

        case 'preview':
          preview && preview.classList.add('active');
          actions && actions.classList.add('active');
          break;

        case 'processing':
          preview && preview.classList.add('active');
          processing && processing.classList.add('active');
          actions && actions.classList.remove('active');
          break;

        case 'results':
          if (results) results.classList.add('active');
          if (actions) actions.classList.add('active');
          break;
      }
    } catch (err) {
      console.warn('[UI] updateUI error:', errToString(err));
    }
  }

  // Initialize when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
