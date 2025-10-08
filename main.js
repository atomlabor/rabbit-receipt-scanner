(function() {
  'use strict';
  
  let isScanning = false;
  let stream = null;
  let state = 'idle';
  
  // DOM elements - use consistent IDs
  let scanBtn, video, status;
  
  // Initialize app when DOM is loaded
  function init() {
    scanBtn = document.getElementById('scanBtn');
    video = document.getElementById('videoPreview'); // Correct ID from HTML
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
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    isScanning = false;
    updateState('ready');
  }
  
  // Handle scan button click
  async function handleScanClick() {
    if (isScanning) return;
    
    try {
      isScanning = true;
      
      // Get camera stream
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Back camera preferred
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      
      // Attach stream to existing video element
      video.srcObject = stream;
      video.play();
      
      updateState('camera');
      
    } catch (error) {
      console.error('Camera access error:', error);
      updateState('error', 'Kamera konnte nicht geöffnet werden');
      isScanning = false;
    }
  }
  
  // Handle video click (capture photo)
  async function handleVideoClick() {
    if (state !== 'camera' || !stream) return;
    
    try {
      updateState('processing');
      
      // Create canvas to capture frame
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      // Set canvas size to video dimensions
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      // Draw current video frame to canvas
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Convert to blob
      const blob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/jpeg', 0.8);
      });
      
      // Stop camera stream
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }
      
      // Process the image
      await processReceiptImage(blob);
      
    } catch (error) {
      console.error('Capture error:', error);
      updateState('error', 'Fehler beim Aufnehmen des Bildes');
    }
  }
  
  // Process receipt image with OCR and send email
  async function processReceiptImage(imageBlob) {
    try {
      // Create FormData for OCR API
      const formData = new FormData();
      formData.append('file', imageBlob, 'receipt.jpg');
      formData.append('apikey', 'K83678596988957'); // OCR Space API Key
      formData.append('language', 'ger');
      formData.append('isOverlayRequired', 'false');
      formData.append('detectOrientation', 'true');
      formData.append('scale', 'true');
      
      // Call OCR API
      const ocrResponse = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        body: formData
      });
      
      const ocrResult = await ocrResponse.json();
      
      if (!ocrResult.IsErroredOnProcessing && ocrResult.ParsedResults?.length > 0) {
        const extractedText = ocrResult.ParsedResults[0].ParsedText;
        
        // Parse receipt data in Rabbit R1 style
        const receiptData = parseReceiptText(extractedText);
        
        // Send email with receipt data
        await sendReceiptEmail(receiptData, imageBlob);
        
        updateState('success', 'Beleg erfolgreich verarbeitet und versendet!');
        
      } else {
        throw new Error('OCR processing failed');
      }
      
    } catch (error) {
      console.error('Processing error:', error);
      updateState('error', 'Fehler beim Verarbeiten des Belegs');
    }
  }
  
  // Parse receipt text (Rabbit R1 intelligent parsing)
  function parseReceiptText(text) {
    const lines = text.split('\n').filter(line => line.trim());
    
    let merchant = '';
    let date = '';
    let total = '';
    let items = [];
    
    // Smart parsing patterns
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Detect merchant (usually first meaningful line)
      if (!merchant && trimmed.length > 2 && !/\d/.test(trimmed)) {
        merchant = trimmed;
      }
      
      // Detect date patterns
      const dateMatch = trimmed.match(/(\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{2,4}|\d{2,4}[.\/\-]\d{1,2}[.\/\-]\d{1,2})/);
      if (dateMatch && !date) {
        date = dateMatch[0];
      }
      
      // Detect total amount (look for keywords and currency)
      if (/total|summe|gesamt|betrag/i.test(trimmed) || /€|eur|\$/.test(trimmed)) {
        const amountMatch = trimmed.match(/([\d,]+[.,]\d{2})/g);
        if (amountMatch) {
          total = amountMatch[amountMatch.length - 1]; // Last amount is usually total
        }
      }
      
      // Collect potential items
      if (/\d+[.,]\d{2}/.test(trimmed) && trimmed.length > 5) {
        items.push(trimmed);
      }
    }
    
    return {
      merchant: merchant || 'Unbekannt',
      date: date || new Date().toLocaleDateString('de-DE'),
      total: total || 'Nicht erkannt',
      items: items.slice(0, 10), // Limit items
      rawText: text
    };
  }
  
  // Send receipt data via email (Rabbit R1 integration)
  async function sendReceiptEmail(receiptData, imageBlob) {
    try {
      // Convert image to base64
      const base64Image = await blobToBase64(imageBlob);
      
      // Prepare email data in Rabbit R1 format
      const emailData = {
        to: 'receipts@atomlabor.de',
        subject: `Neuer Beleg von ${receiptData.merchant} - ${receiptData.date}`,
        html: `
          <h2>🧾 Neuer Beleg gescannt</h2>
          <p><strong>Händler:</strong> ${receiptData.merchant}</p>
          <p><strong>Datum:</strong> ${receiptData.date}</p>
          <p><strong>Betrag:</strong> ${receiptData.total}</p>
          
          <h3>Erkannte Positionen:</h3>
          <ul>
            ${receiptData.items.map(item => `<li>${item}</li>`).join('')}
          </ul>
          
          <h3>Volltext:</h3>
          <pre>${receiptData.rawText}</pre>
          
          <p><em>Automatisch gescannt mit Rabbit Receipt Scanner</em></p>
        `,
        attachments: [{
          name: `receipt_${Date.now()}.jpg`,
          data: base64Image.split(',')[1], // Remove data:image/jpeg;base64, prefix
          type: 'image/jpeg'
        }]
      };
      
      // Send via EmailJS or similar service
      const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          service_id: 'service_rabbit',
          template_id: 'template_receipt',
          user_id: 'user_rabbit_r1',
          template_params: emailData
        })
      });
      
      if (!response.ok) {
        throw new Error('Email sending failed');
      }
      
    } catch (error) {
      console.error('Email error:', error);
      throw error;
    }
  }
  
  // Helper: Convert blob to base64
  function blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }
  
  // Handle page visibility change (pause camera when hidden)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && stream) {
      resetToReady();
    }
  });
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
})();
