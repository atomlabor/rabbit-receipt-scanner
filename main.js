(function() {
  'use strict';
  
  // State management
  let stream = null;
  let isScanning = false;
  let currentState = 'idle'; // idle, camera, preview, results
  
  // DOM elements
  let statusText, scanBtn, cameraContainer, video, canvas, preview, previewImg;
  let results, ocrText, hint, processing, processText, retryBtn, captureBtn;
  
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
    
    // Bind events
    scanBtn.addEventListener('click', startCamera);
    captureBtn.addEventListener('click', capturePhoto);
    retryBtn.addEventListener('click', resetApp);
    
    // PTT support (space key or R1 button)
    document.addEventListener('keydown', handleKeyPress);
    
    // Video click to capture
    video.addEventListener('click', capturePhoto);
    
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
    
    // Update hint
    if (currentState === 'idle') {
      hint.textContent = 'Press PTT to scan';
      hint.style.display = 'block';
    } else if (currentState === 'camera') {
      hint.textContent = 'Tap or press PTT to capture';
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
      
      // Convert to image
      const imageData = canvas.toDataURL('image/png');
      previewImg.src = imageData;
      
      // Stop camera
      stopCamera();
      
      // Show preview
      currentState = 'preview';
      updateUI();
      hideProcessing();
      setStatus('Processing');
      
      // Start OCR
      setTimeout(() => performOCR(imageData), 500);
      
    } catch (error) {
      console.error('Capture error:', error);
      hideProcessing();
      setStatus('Capture failed');
    }
  }
  
  // Perform OCR
  async function performOCR(imageData) {
    try {
      showProcessing('Running OCR...');
      setStatus('Scanning text');
      
      // Load Tesseract if needed
      if (typeof Tesseract === 'undefined') {
        await loadTesseract();
      }
      
      // Run OCR
      const result = await Tesseract.recognize(
        imageData,
        'eng',
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
  
  // Reset app
  function resetApp() {
    stopCamera();
    currentState = 'idle';
    setStatus('Ready');
    updateUI();
  }
  
  // Handle keyboard
  function handleKeyPress(event) {
    // Space key or PTT button
    if (event.code === 'Space' && !event.repeat) {
      event.preventDefault();
      
      if (currentState === 'idle') {
        startCamera();
      } else if (currentState === 'camera') {
        capturePhoto();
      } else if (currentState === 'results' || currentState === 'preview') {
        resetApp();
      }
    }
  }
  
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
