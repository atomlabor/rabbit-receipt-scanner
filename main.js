(function() {
  'use strict';

  // State management
  let stream = null;
  let isScanning = false;
  let videoElement = null;
  let canvasElement = null;
  let captureButton = null;
  let statusElement = null;
  let resultElement = null;
  let previewContainer = null;

  // Initialize UI elements
  function initUI() {
    // Create main container if not exists
    let container = document.getElementById('receipt-scanner-app');
    if (!container) {
      container = document.createElement('div');
      container.id = 'receipt-scanner-app';
      document.body.appendChild(container);
    }

    container.innerHTML = `
      <div class="scanner-container">
        <div class="header">
          <h1>🐰 Rabbit Receipt Scanner</h1>
          <div id="status" class="status">Ready</div>
        </div>
        
        <div class="preview-container" id="preview-container">
          <video id="video" autoplay playsinline></video>
          <canvas id="canvas" style="display: none;"></canvas>
        </div>
        
        <div class="controls">
          <button id="start-camera" class="btn btn-primary">Start Camera</button>
          <button id="capture" class="btn btn-success" disabled>Capture Receipt</button>
          <button id="stop-camera" class="btn btn-danger" disabled>Stop Camera</button>
        </div>
        
        <div id="result-container" class="result-container" style="display: none;">
          <h3>OCR Result:</h3>
          <div id="result" class="result-text"></div>
          <button id="copy-result" class="btn btn-secondary">Copy to Clipboard</button>
        </div>
      </div>
    `;

    // Get element references
    videoElement = document.getElementById('video');
    canvasElement = document.getElementById('canvas');
    captureButton = document.getElementById('capture');
    statusElement = document.getElementById('status');
    resultElement = document.getElementById('result');
    previewContainer = document.getElementById('preview-container');

    // Add styles
    addStyles();
  }

  // Add CSS styles
  function addStyles() {
    const styleId = 'receipt-scanner-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #receipt-scanner-app {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        max-width: 800px;
        margin: 20px auto;
        padding: 20px;
        background: #f5f5f5;
        border-radius: 10px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      }

      .scanner-container {
        background: white;
        padding: 20px;
        border-radius: 8px;
      }

      .header {
        text-align: center;
        margin-bottom: 20px;
      }

      .header h1 {
        margin: 0 0 10px 0;
        color: #333;
        font-size: 28px;
      }

      .status {
        padding: 8px 16px;
        background: #4CAF50;
        color: white;
        border-radius: 20px;
        display: inline-block;
        font-size: 14px;
      }

      .status.processing {
        background: #FF9800;
      }

      .status.error {
        background: #f44336;
      }

      .preview-container {
        position: relative;
        width: 100%;
        max-width: 640px;
        margin: 0 auto 20px;
        background: #000;
        border-radius: 8px;
        overflow: hidden;
      }

      #video {
        width: 100%;
        height: auto;
        display: block;
      }

      #canvas {
        width: 100%;
        height: auto;
      }

      .controls {
        display: flex;
        justify-content: center;
        gap: 10px;
        margin-bottom: 20px;
        flex-wrap: wrap;
      }

      .btn {
        padding: 12px 24px;
        border: none;
        border-radius: 6px;
        font-size: 16px;
        cursor: pointer;
        transition: all 0.3s;
        font-weight: 500;
      }

      .btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-primary {
        background: #2196F3;
        color: white;
      }

      .btn-success {
        background: #4CAF50;
        color: white;
      }

      .btn-danger {
        background: #f44336;
        color: white;
      }

      .btn-secondary {
        background: #9E9E9E;
        color: white;
      }

      .result-container {
        background: #f9f9f9;
        padding: 20px;
        border-radius: 8px;
        border: 1px solid #ddd;
      }

      .result-container h3 {
        margin-top: 0;
        color: #333;
      }

      .result-text {
        background: white;
        padding: 15px;
        border-radius: 4px;
        border: 1px solid #ddd;
        min-height: 100px;
        max-height: 300px;
        overflow-y: auto;
        white-space: pre-wrap;
        font-family: 'Courier New', monospace;
        font-size: 14px;
        line-height: 1.6;
        margin-bottom: 15px;
      }

      @media (max-width: 600px) {
        #receipt-scanner-app {
          margin: 10px;
          padding: 10px;
        }
        
        .controls {
          flex-direction: column;
        }
        
        .btn {
          width: 100%;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Set status message
  function setStatus(message, type = 'ready') {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.className = 'status';
    if (type === 'processing') {
      statusElement.classList.add('processing');
    } else if (type === 'error') {
      statusElement.classList.add('error');
    }
  }

  // Start camera stream
  async function startCamera() {
    try {
      setStatus('Starting camera...', 'processing');
      
      const constraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      };

      stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoElement.srcObject = stream;
      
      document.getElementById('start-camera').disabled = true;
      document.getElementById('stop-camera').disabled = false;
      document.getElementById('capture').disabled = false;
      
      setStatus('Camera active', 'ready');
    } catch (error) {
      console.error('Error accessing camera:', error);
      setStatus('Camera access denied', 'error');
      alert('Unable to access camera. Please grant camera permissions and try again.');
    }
  }

  // Stop camera stream
  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
      videoElement.srcObject = null;
    }
    
    document.getElementById('start-camera').disabled = false;
    document.getElementById('stop-camera').disabled = true;
    document.getElementById('capture').disabled = true;
    
    setStatus('Camera stopped', 'ready');
  }

  // Capture photo from video
  function capturePhoto() {
    if (!stream) {
      alert('Please start the camera first');
      return;
    }

    setStatus('Capturing image...', 'processing');

    // Set canvas dimensions to match video
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;

    // Draw video frame to canvas
    const context = canvasElement.getContext('2d');
    context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

    // Show captured image
    videoElement.style.display = 'none';
    canvasElement.style.display = 'block';

    setStatus('Image captured, processing OCR...', 'processing');

    // Run OCR
    performOCR();
  }

  // Perform OCR using Tesseract.js
  async function performOCR() {
    try {
      // Check if Tesseract is available
      if (typeof Tesseract === 'undefined') {
        // Load Tesseract.js dynamically
        await loadTesseract();
      }

      const imageData = canvasElement.toDataURL('image/png');
      
      setStatus('Running OCR (this may take a moment)...', 'processing');

      const result = await Tesseract.recognize(
        imageData,
        'eng',
        {
          logger: info => {
            if (info.status === 'recognizing text') {
              const progress = Math.round(info.progress * 100);
              setStatus(`OCR Progress: ${progress}%`, 'processing');
            }
          }
        }
      );

      displayResult(result.data.text);
      setStatus('OCR completed', 'ready');

      // Return to video preview
      setTimeout(() => {
        videoElement.style.display = 'block';
        canvasElement.style.display = 'none';
      }, 1000);

    } catch (error) {
      console.error('OCR Error:', error);
      setStatus('OCR failed', 'error');
      alert('OCR processing failed: ' + error.message);
      
      // Return to video preview
      videoElement.style.display = 'block';
      canvasElement.style.display = 'none';
    }
  }

  // Load Tesseract.js library dynamically
  function loadTesseract() {
    return new Promise((resolve, reject) => {
      if (typeof Tesseract !== 'undefined') {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Tesseract.js'));
      document.head.appendChild(script);
    });
  }

  // Display OCR result
  function displayResult(text) {
    const resultContainer = document.getElementById('result-container');
    resultElement.textContent = text || 'No text detected';
    resultContainer.style.display = 'block';
  }

  // Copy result to clipboard
  function copyToClipboard() {
    const text = resultElement.textContent;
    if (!text || text === 'No text detected') {
      alert('No text to copy');
      return;
    }

    navigator.clipboard.writeText(text).then(() => {
      alert('Text copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy:', err);
      // Fallback method
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      alert('Text copied to clipboard!');
    });
  }

  // Handle PTT (Push-to-Talk) button for quick capture
  function handlePTT(event) {
    // Space bar or specific PTT button
    if (event.code === 'Space' && !event.repeat && stream) {
      event.preventDefault();
      capturePhoto();
    }
  }

  // Bind event listeners
  function bindEvents() {
    document.getElementById('start-camera').addEventListener('click', startCamera);
    document.getElementById('stop-camera').addEventListener('click', stopCamera);
    document.getElementById('capture').addEventListener('click', capturePhoto);
    document.getElementById('copy-result').addEventListener('click', copyToClipboard);
    
    // PTT support (spacebar for quick capture)
    document.addEventListener('keydown', handlePTT);
  }

  // Cleanup on page unload
  function cleanup() {
    stopCamera();
  }

  // Initialize app
  function onReady() {
    initUI();
    setStatus('Ready');
    bindEvents();
    window.addEventListener('beforeunload', cleanup);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
