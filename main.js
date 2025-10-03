// Rabbit Receipt Scanner - Enhanced version with Rabbit LLM mail support
// OCR supports both German and English
// TRIGGER: After successful OCR scan, automatically sends receipt via Rabbit LLM to user's email
(function() {
  'use strict';
  
  // State management
  let stream = null;
  let isScanning = false;
  let currentState = 'idle'; // idle, camera, preview, results
  let capturedImageData = null; // Store captured image for email attachment
  let ocrResultText = ''; // Store OCR text for email
  
  // DOM elements
  let statusText, scanBtn, cameraContainer, video, canvas, preview, previewImg;
  let results, ocrText, processing, processText, retryBtn, captureBtn, actions;
  
  // Initialize
  function init() {
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
    
    // Event listeners
    scanBtn.addEventListener('click', startCamera);
    video.addEventListener('click', captureImage);
    cameraContainer.addEventListener('click', captureImage);
    captureBtn.addEventListener('click', captureImage);
    retryBtn.addEventListener('click', reset);
    
    console.log('Receipt Scanner initialized');
  }
  
  // Start camera
  async function startCamera() {
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
      
      console.log('Camera started');
    } catch (err) {
      console.error('Error accessing camera:', err);
      alert('Could not access camera: ' + err.message);
      reset();
    }
  }
  
  // Capture image from video
  function captureImage() {
    if (currentState !== 'camera' || isScanning) return;
    
    try {
      // Set canvas dimensions to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      // Draw video frame to canvas
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      
      // Get image data
      capturedImageData = canvas.toDataURL('image/jpeg', 0.92);
      
      // Stop camera
      stopCamera();
      
      // Show preview
      previewImg.src = capturedImageData;
      currentState = 'preview';
      updateUI();
      
      // Process OCR
      processOCR(capturedImageData);
    } catch (err) {
      console.error('Error capturing image:', err);
      alert('Error capturing image: ' + err.message);
    }
  }
  
  // Process OCR with Tesseract.js (supports German and English)
  async function processOCR(imageData) {
    if (isScanning) return;
    isScanning = true;
    
    try {
      currentState = 'processing';
      updateUI();
      processText.textContent = 'Scanning receipt...';
      
      // Initialize Tesseract with German and English language support
      const worker = await Tesseract.createWorker(['deu', 'eng'], 1, {
        logger: m => {
          if (m.status === 'recognizing text') {
            const progress = Math.round(m.progress * 100);
            processText.textContent = `Processing: ${progress}%`;
          }
        }
      });
      
      // Perform OCR
      const { data } = await worker.recognize(imageData);
      ocrResultText = data.text;
      
      // Clean up worker
      await worker.terminate();
      
      // Interpret and format the results
      const interpretedText = interpretReceipt(ocrResultText);
      ocrText.innerHTML = interpretedText;
      
      currentState = 'results';
      updateUI();
      isScanning = false;
      
      // TRIGGER: Automatically send receipt via Rabbit LLM after successful scan
      await sendReceiptViaRabbitMail(ocrResultText);
      
    } catch (err) {
      console.error('OCR Error:', err);
      ocrText.textContent = 'Error: Could not process receipt. ' + err.message;
      currentState = 'results';
      updateUI();
      isScanning = false;
    }
  }
  
  // Interpret receipt text (German and English support)
  function interpretReceipt(text) {
    if (!text || text.trim().length === 0) {
      return '<span style="color: #ff6b00;">No text detected. Please try again.</span>';
    }
    
    let formatted = '<div style="font-size: 10px; line-height: 1.5;">';
    
    // Extract key information
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
        if (match) {
          foundTotal = match[1] || match[0];
          break;
        }
      }
      if (foundTotal) break;
    }
    
    // Look for date (multiple formats)
    const datePatterns = [
      /\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{2,4}/,
      /\d{2,4}[.\/\-]\d{1,2}[.\/\-]\d{1,2}/
    ];
    
    let foundDate = null;
    for (const pattern of datePatterns) {
      for (const line of lines) {
        const match = line.match(pattern);
        if (match) {
          foundDate = match[0];
          break;
        }
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
    
    // Add full text
    formatted += '<div style="color: #ccc; white-space: pre-wrap; font-size: 9px;">';
    formatted += text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    formatted += '</div>';
    
    formatted += '</div>';
    
    return formatted;
  }
  
  /**
   * TRIGGER DOCUMENTATION:
   * Sends receipt via Rabbit LLM mail after successful OCR scan.
   * This function is automatically called when OCR processing completes.
   * 
   * Uses rabbit.llm.sendMailToSelf() API to send:
   * - Subject: Receipt scan with date/time
   * - Body: Formatted OCR text with extracted information (total, date, etc.)
   * - Attachment: Original scanned receipt image as JPEG
   * 
   * @param {string} ocrText - The recognized text from the receipt
   */
  async function sendReceiptViaRabbitMail(ocrText) {
    try {
      processText.textContent = 'Sending via Rabbit Mail...';
      processing.classList.add('active');
      
      // Check if Rabbit LLM API is available
      if (typeof rabbit === 'undefined' || !rabbit.llm || !rabbit.llm.sendMailToSelf) {
        console.warn('Rabbit LLM API not available. Running in browser mode.');
        console.log('Would send receipt with OCR text:', ocrText);
        processing.classList.remove('active');
        return;
      }
      
      // Prepare email content
      const timestamp = new Date().toLocaleString('de-DE');
      const subject = `Receipt Scan - ${timestamp}`;
      
      // Create plain text body with formatted OCR results
      const body = `Receipt scanned on ${timestamp}\n\n` +
        `--- OCR TEXT ---\n${ocrText}\n\n` +
        `This receipt was automatically scanned and sent by Rabbit Receipt Scanner.`;
      
      // Send via Rabbit LLM
      await rabbit.llm.sendMailToSelf({
        subject: subject,
        body: body,
        attachment: capturedImageData  // Base64 JPEG image
      });
      
      console.log('Receipt sent successfully via Rabbit LLM');
      
      // Show success indicator
      statusText.textContent = '✓ Receipt sent!';
      setTimeout(() => {
        statusText.textContent = 'rabbit receipt scanner';
      }, 3000);
      
      processing.classList.remove('active');
      
    } catch (err) {
      console.error('Rabbit Mail error:', err);
      alert('Could not send via Rabbit Mail: ' + err.message);
      processing.classList.remove('active');
    }
  }
  
  // Stop camera stream
  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
      video.srcObject = null;
    }
  }
  
  // Reset to initial state
  function reset() {
    stopCamera();
    isScanning = false;
    currentState = 'idle';
    capturedImageData = null;
    ocrResultText = '';
    ocrText.textContent = 'Scanning...';
    updateUI();
  }
  
  // Update UI based on current state
  function updateUI() {
    // Reset all states
    scanBtn.style.display = 'none';
    cameraContainer.classList.remove('active');
    preview.classList.remove('active');
    results.classList.remove('active');
    processing.classList.remove('active');
    actions.classList.remove('active');
    
    // Apply current state
    switch (currentState) {
      case 'idle':
        scanBtn.style.display = 'flex';
        break;
        
      case 'camera':
        cameraContainer.classList.add('active');
        actions.classList.add('active');
        break;
        
      case 'preview':
        preview.classList.add('active');
        actions.classList.add('active');
        break;
        
      case 'processing':
        preview.classList.add('active');
        processing.classList.add('active');
        actions.classList.remove('active');
        break;
        
      case 'results':
        results.classList.add('active');
        actions.classList.add('active');
        break;
    }
  }
  
  // Initialize when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
