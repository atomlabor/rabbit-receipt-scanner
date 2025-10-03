// Rabbit Receipt Scanner - Enhanced version with SMTP email support
// OCR supports both German and English
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
  let emailInput; // NEW: Email input field
  
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
    emailInput = document.getElementById('emailInput'); // NEW
    
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
      console.log('[OCR] Starting Tesseract worker...');
      const worker = await Tesseract.createWorker({
        logger: m => {
          console.log('[Tesseract]', m);
          if (m.status === 'recognizing text') {
            const progress = Math.round(m.progress * 100);
            processText.textContent = `Processing: ${progress}%`;
          }
        }
      });
      
      console.log('[OCR] Loading languages: deu+eng...');
      await worker.loadLanguage('deu+eng');
      console.log('[OCR] Initializing worker...');
      await worker.initialize('deu+eng');
      
      console.log('[OCR] Recognizing text...');
      // Perform OCR
      const { data } = await worker.recognize(imageData);
      ocrResultText = data.text;
      console.log('[OCR] Text recognized:', data.text.substring(0, 100));
      
      // Clean up worker
      await worker.terminate();
      
      // Interpret and format the results
      const interpretedText = interpretReceipt(ocrResultText);
      ocrText.innerHTML = interpretedText;
      
      currentState = 'results';
      updateUI();
      isScanning = false;
      
      // Send email if email address is provided
      const email = emailInput.value.trim();
      if (email && validateEmail(email)) {
        await sendEmail(email, interpretedText);
      }
      
    } catch (err) {
      console.error('[OCR] Error:', err);
      console.error('[OCR] Failed at:', err.stack);
      const errorMessage = err?.message || err?.toString() || 'Unknown error';
      ocrText.textContent = `Error: Could not process receipt. ${errorMessage}`;
      console.error('Full error object:', JSON.stringify(err, null, 2));
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
  
  // Validate email address
  function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }
  
  // Send email using SMTP.js
  // NOTE: For production, you need to configure SMTP settings
  // See README.md for setup instructions
  async function sendEmail(toEmail, content) {
    try {
      processText.textContent = 'Sending email...';
      processing.classList.add('active');
      
      // SMTP.js configuration
      // IMPORTANT: Configure these settings in your deployment
      // For security, use environment variables or a backend service
      const smtpConfig = {
        SecureToken: 'YOUR_SECURE_TOKEN', // Get from https://smtpjs.com
        To: toEmail,
        From: 'receipts@yourdomain.com', // Configure your sending email
        Subject: 'Receipt Scan - ' + new Date().toLocaleDateString(),
        Body: `
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px; }
                .container { background: white; padding: 20px; border-radius: 8px; max-width: 600px; margin: 0 auto; }
                .header { color: #ff6b00; font-size: 20px; font-weight: bold; margin-bottom: 20px; }
                .content { white-space: pre-wrap; font-size: 14px; line-height: 1.6; }
                .footer { margin-top: 20px; color: #999; font-size: 12px; border-top: 1px solid #eee; padding-top: 10px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">🧾 Receipt Scan Results</div>
                <div class="content">${content}</div>
                <div class="footer">Scanned with Rabbit Receipt Scanner on ${new Date().toLocaleString()}</div>
              </div>
            </body>
          </html>
        `,
        Attachments: [
          {
            name: 'receipt_' + Date.now() + '.jpg',
            data: capturedImageData
          }
        ]
      };
      
      // Check if SMTP is configured
      if (smtpConfig.SecureToken === 'YOUR_SECURE_TOKEN') {
        console.warn('SMTP not configured. Email not sent.');
        console.log('Email would be sent to:', toEmail);
        console.log('Content:', content);
        processing.classList.remove('active');
        return;
      }
      
      // Send email
      const response = await Email.send(smtpConfig);
      
      if (response === 'OK') {
        console.log('Email sent successfully to:', toEmail);
        alert('✓ Results sent to ' + toEmail);
      } else {
        console.error('Email send error:', response);
        alert('Email sending failed: ' + response);
      }
      
      processing.classList.remove('active');
      
    } catch (err) {
      console.error('Email error:', err);
      const errorMessage = err?.message || err?.toString() || 'Unknown error';
      alert('Could not send email: ' + errorMessage);
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
