(function() {
  'use strict';
  
  // State management
  let stream = null;
  let isScanning = false;
  let currentState = 'idle'; // idle, camera, preview, results
  let capturedImageData = null; // Store captured image for email attachment
  
  // DOM elements
  let statusText, scanBtn, cameraContainer, video, canvas, preview, previewImg;
  let results, ocrText, hint, processing, processText, retryBtn, captureBtn;
  let emailInput; // NEW: Email input field
  
  // EmailJS Configuration - IMPORTANT: Replace with your EmailJS credentials
  const EMAILJS_CONFIG = {
    serviceId: 'YOUR_SERVICE_ID',
    templateId: 'YOUR_TEMPLATE_ID',
    publicKey: 'YOUR_PUBLIC_KEY'
  };
  
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
    hint = document.getElementById('hint');
    processing = document.getElementById('processing');
    processText = document.getElementById('processText');
    retryBtn = document.getElementById('retryBtn');
    captureBtn = document.getElementById('captureBtn');
    emailInput = document.getElementById('emailInput'); // NEW: Get email input
    
    // Bind events
    scanBtn.addEventListener('click', startCamera);
    captureBtn.addEventListener('click', capturePhoto);
    retryBtn.addEventListener('click', resetApp);
    
    // Removed: PTT keyboard support as per requirements
    
    // Video click to capture
    video.addEventListener('click', capturePhoto);
    
    // Load EmailJS library
    loadEmailJS();
    
    updateUI();
  }
  
  // Update UI based on state
  function updateUI() {
    // Hide all main views
    scanBtn.classList.toggle('hidden', currentState !== 'idle');
    cameraContainer.classList.toggle('active', currentState === 'camera');
    preview.classList.toggle('active', currentState === 'preview');
    results.classList.toggle('active', currentState === 'results');
    
    // Update action buttons
    if (currentState === 'camera') {
      captureBtn.classList.add('active');
      retryBtn.classList.remove('active');
    } else if (currentState === 'results' || currentState === 'preview') {
      captureBtn.classList.remove('active');
      retryBtn.classList.add('active');
    } else {
      captureBtn.classList.remove('active');
      retryBtn.classList.remove('active');
    }
    
    // Update hint - Removed PTT references
    if (currentState === 'idle') {
      hint.textContent = 'Click to scan';
      hint.style.display = 'block';
    } else if (currentState === 'camera') {
      hint.textContent = 'Tap to capture';
      hint.style.display = 'block';
    } else {
      hint.style.display = 'none';
    }
  }
  
  // Set status
  function setStatus(message) {
    if (statusText) {
      statusText.textContent = message;
    }
  }
  
  // Show processing overlay
  function showProcessing(message) {
    processText.textContent = message;
    processing.classList.add('active');
  }
  
  // Hide processing overlay
  function hideProcessing() {
    processing.classList.remove('active');
  }
  
  // Start camera
  async function startCamera() {
    try {
      showProcessing('Starting camera...');
      setStatus('Starting...');
      
      const constraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      };
      
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      
      currentState = 'camera';
      setStatus('Ready to scan');
      updateUI();
      hideProcessing();
      
    } catch (error) {
      console.error('Camera error:', error);
      setStatus('Camera error');
      hideProcessing();
      alert('Camera access denied. Please enable camera permissions.');
      currentState = 'idle';
      updateUI();
    }
  }
  
  // Stop camera
  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
      video.srcObject = null;
    }
  }
  
  // NEW: Image preprocessing function for better OCR results
  // Applies contrast enhancement and converts to black & white
  function preprocessImage(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Convert to grayscale and apply contrast enhancement
    for (let i = 0; i < data.length; i += 4) {
      // Grayscale conversion
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      
      // Contrast enhancement (increase contrast by 1.5x)
      const contrast = 1.5;
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
      let enhanced = factor * (gray - 128) + 128;
      
      // Clamp values
      enhanced = Math.max(0, Math.min(255, enhanced));
      
      // Binary threshold for black & white (threshold at 128)
      const bw = enhanced > 128 ? 255 : 0;
      
      data[i] = bw;     // R
      data[i + 1] = bw; // G
      data[i + 2] = bw; // B
      // Alpha channel (i+3) remains unchanged
    }
    
    ctx.putImageData(imageData, 0, 0);
  }
  
  // Capture photo
  function capturePhoto() {
    if (currentState !== 'camera' || !stream) return;
    
    try {
      showProcessing('Capturing...');
      setStatus('Capturing');
      
      // Set canvas size
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      // Draw video frame
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // NEW: Apply preprocessing for better OCR
      preprocessImage(canvas);
      
      // Convert to image
      capturedImageData = canvas.toDataURL('image/png');
      previewImg.src = capturedImageData;
      
      // Stop camera
      stopCamera();
      
      // Show preview
      currentState = 'preview';
      updateUI();
      hideProcessing();
      setStatus('Processing');
      
      // Start OCR
      setTimeout(() => performOCR(capturedImageData), 500);
      
    } catch (error) {
      console.error('Capture error:', error);
      hideProcessing();
      setStatus('Capture failed');
    }
  }
  
  // Perform OCR with German language support
  async function performOCR(imageData) {
    try {
      showProcessing('Running OCR...');
      setStatus('Scanning text');
      
      // Load Tesseract if needed
      if (typeof Tesseract === 'undefined') {
        await loadTesseract();
      }
      
      // NEW: Extended OCR with German language support
      // Note: 'deu' (German) can be added when available
      // For now using 'eng' as primary, but the system can be extended
      const result = await Tesseract.recognize(
        imageData,
        'eng+deu', // Support for English and German
        {
          logger: info => {
            if (info.status === 'recognizing text') {
              const progress = Math.round(info.progress * 100);
              processText.textContent = `Scanning: ${progress}%`;
            }
          }
        }
      );
      
      // Display results
      const text = result.data.text.trim();
      if (text) {
        ocrText.textContent = text;
        
        // NEW: Auto-send email if email address is provided
        const email = emailInput.value.trim();
        if (email && validateEmail(email)) {
          sendEmail(email, text, capturedImageData);
        }
      } else {
        ocrText.textContent = 'No text detected. Try again with better lighting.';
      }
      
      currentState = 'results';
      setStatus('Complete');
      updateUI();
      hideProcessing();
      
    } catch (error) {
      console.error('OCR error:', error);
      ocrText.textContent = 'OCR failed. Please try again.';
      currentState = 'results';
      setStatus('Error');
      updateUI();
      hideProcessing();
    }
  }
  
  // NEW: Email validation
  function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }
  
  // NEW: Send email with OCR results and scanned image
  async function sendEmail(email, ocrText, imageData) {
    try {
      setStatus('Sending email...');
      showProcessing('Sending email...');
      
      // Check if EmailJS is loaded
      if (typeof emailjs === 'undefined') {
        console.warn('EmailJS not loaded yet');
        hideProcessing();
        return;
      }
      
      // Prepare email parameters
      const templateParams = {
        to_email: email,
        ocr_text: ocrText,
        scan_date: new Date().toLocaleString('de-DE'),
        image_data: imageData // Base64 image data
      };
      
      // Send email via EmailJS
      await emailjs.send(
        EMAILJS_CONFIG.serviceId,
        EMAILJS_CONFIG.templateId,
        templateParams,
        EMAILJS_CONFIG.publicKey
      );
      
      setStatus('Email sent!');
      hideProcessing();
      
      // Show success feedback
      setTimeout(() => {
        setStatus('Complete');
      }, 2000);
      
    } catch (error) {
      console.error('Email sending error:', error);
      setStatus('Email failed');
      hideProcessing();
      alert('Failed to send email. Please check your connection.');
    }
  }
  
  // Load Tesseract.js
  function loadTesseract() {
    return new Promise((resolve, reject) => {
      if (typeof Tesseract !== 'undefined') {
        resolve();
        return;
      }
      
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load OCR library'));
      document.head.appendChild(script);
    });
  }
  
  // NEW: Load EmailJS library
  function loadEmailJS() {
    return new Promise((resolve, reject) => {
      if (typeof emailjs !== 'undefined') {
        resolve();
        return;
      }
      
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
      script.onload = () => {
        // Initialize EmailJS with public key
        if (typeof emailjs !== 'undefined') {
          emailjs.init(EMAILJS_CONFIG.publicKey);
        }
        resolve();
      };
      script.onerror = () => {
        console.warn('Failed to load EmailJS library');
        reject(new Error('Failed to load EmailJS library'));
      };
      document.head.appendChild(script);
    });
  }
  
  // Reset app
  function resetApp() {
    stopCamera();
    capturedImageData = null;
    currentState = 'idle';
    setStatus('Ready');
    updateUI();
  }
  
  // Removed: PTT keyboard handler as per requirements
  
  // Cleanup
  function cleanup() {
    stopCamera();
  }
  
  // Start when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // Cleanup on unload
  window.addEventListener('beforeunload', cleanup);
  
})();
