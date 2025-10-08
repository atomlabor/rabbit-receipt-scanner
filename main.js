(function() {
  'use strict';
  
  let isScanning = false;
  let stream = null;
  let state = 'idle';
  
  // DOM elements
  let scanBtn, video, status;
  
  // Initialize app when DOM is loaded
  function init() {
    scanBtn = document.getElementById('scanBtn');
    video = document.getElementById('cameraPreview');
    status = document.getElementById('status');
    
    if (!scanBtn || !video || !status) {
      console.error('Required DOM elements not found');
      return;
    }
    
    // Event listeners
    scanBtn.addEventListener('click', handleScanClick);
    video.addEventListener('click', handleVideoClick);
    
    updateState('ready');
  }
  
  // Update app state and UI
  function updateState(newState, message = '') {
    state = newState;
    
    switch (state) {
      case 'ready':
        scanBtn.style.display = 'flex';
        video.style.display = 'none';
        status.textContent = 'Bereit zum Scannen';
        status.className = 'status';
        break;
        
      case 'camera':
        scanBtn.style.display = 'none';
        video.style.display = 'block';
        status.textContent = 'Video antippen zum Scannen';
        status.className = 'status';
        break;
        
      case 'processing':
        status.textContent = 'Beleg wird verarbeitet...';
        status.className = 'status processing pulsing';
        break;
        
      case 'success':
        status.textContent = message || 'Erfolgreich gesendet!';
        status.className = 'status success';
        setTimeout(() => resetToReady(), 3000);
        break;
        
      case 'error':
        status.textContent = message || 'Fehler beim Verarbeiten';
        status.className = 'status error';
        setTimeout(() => resetToReady(), 5000);
        break;
    }
  }
  
  // Reset to ready state
  function resetToReady() {
    stopCamera();
    isScanning = false;
    updateState('ready');
  }
  
  // Handle scan button click
  async function handleScanClick() {
    if (isScanning) return;
    
    try {
      isScanning = true;
      await startCamera();
    } catch (error) {
      console.error('Camera error:', error);
      updateState('error', 'Kamera kann nicht geöffnet werden');
    }
  }
  
  // Handle video click to take photo
  async function handleVideoClick() {
    if (!stream || state !== 'camera') return;
    
    try {
      updateState('processing');
      
      // Capture photo from video
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      
      // Convert to blob
      const blob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/jpeg', 0.8);
      });
      
      // Stop camera
      stopCamera();
      
      // Process the image
      await processReceipt(blob);
      
    } catch (error) {
      console.error('Photo capture error:', error);
      updateState('error', 'Foto konnte nicht aufgenommen werden');
    }
  }
  
  // Start camera with constraints
  async function startCamera() {
    if (stream) {
      stopCamera();
    }
    
    const constraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };
    
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      
      // Wait for video to be ready
      await new Promise((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          resolve();
        };
      });
      
      updateState('camera');
      
    } catch (error) {
      throw new Error('Kamera nicht verfügbar: ' + error.message);
    }
  }
  
  // Stop camera stream
  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    if (video) {
      video.srcObject = null;
    }
  }
  
  // Process receipt image
  async function processReceipt(blob) {
    try {
      // Convert blob to base64
      const base64 = await blobToBase64(blob);
      
      // Save image if Rabbit API available
      let imagePath = null;
      if (window.rabbit && rabbit.storage) {
        try {
          imagePath = `/photos/receipt_${Date.now()}.jpg`;
          await rabbit.storage.setItem(imagePath, base64);
        } catch (e) {
          console.warn('Could not save to Rabbit storage:', e);
        }
      }
      
      // Simulate OCR processing
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Mock OCR results
      const mockResults = {
        total: '12.50 EUR',
        merchant: 'Test Store',
        date: new Date().toLocaleDateString('de-DE'),
        items: ['Item 1', 'Item 2']
      };
      
      // Send email with results
      await sendEmail(mockResults, imagePath);
      
      updateState('success', 'Beleg erfolgreich verarbeitet!');
      
    } catch (error) {
      console.error('Processing error:', error);
      updateState('error', 'Verarbeitung fehlgeschlagen');
    }
  }
  
  // Convert blob to base64
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  
  // Send email with receipt data
  async function sendEmail(data, imagePath) {
    const emailData = {
      to: 'receipts@example.com',
      subject: `Beleg vom ${data.date}`,
      body: `
        Händler: ${data.merchant}
        Datum: ${data.date}
        Betrag: ${data.total}
        
        Artikel:
        ${data.items.join('\n')}
      `,
      attachments: imagePath ? [imagePath] : []
    };
    
    // Use Rabbit email API if available
    if (window.rabbit && rabbit.email && typeof rabbit.email.send === 'function') {
      try {
        await rabbit.email.send(emailData);
        return;
      } catch (e) {
        console.warn('Rabbit email failed:', e);
      }
    }
    
    // Fallback: log email data
    console.log('Email would be sent:', emailData);
  }
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // Handle page visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && stream) {
      stopCamera();
      resetToReady();
    }
  });
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    stopCamera();
  });
  
})();
