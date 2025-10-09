/* Rabbit Receipt Scanner - Jens Special Edition */

// Initialize Tesseract
const { createWorker } = Tesseract;
let worker = null;
let stream = null;
let capturedImageData = null;

// DOM elements
const scanButton = document.getElementById('scanButton');
const captureButton = document.getElementById('captureButton');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const overlay = document.getElementById('overlay');
const thinkingOverlay = document.getElementById('thinking-overlay');
const result = document.getElementById('result');

// Initialize the OCR worker
async function initializeOCR() {
    try {
        worker = await createWorker();
        await worker.loadLanguage('deu');
        await worker.initialize('deu');
        // Set parameters for better receipt recognition
        await worker.setParameters({
            tessedit_pageseg_mode: '6', // Assume a single uniform block of text
            tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzäöüÄÖÜß€.,:-/() '
        });
        console.log('[OCR] Worker initialized successfully');
    } catch (error) {
        console.error('[OCR] Failed to initialize:', error);
        setOverlay('OCR initialization failed');
    }
}

// Set overlay message
function setOverlay(message) {
    if (overlay) {
        overlay.innerHTML = `<div class="loading">${message}</div>`;
    }
    console.log('[STATUS]', message);
}

// Show thinking overlay
function showThinkingOverlay() {
    if (thinkingOverlay) {
        thinkingOverlay.classList.add('active');
    }
}

// Hide thinking overlay
function hideThinkingOverlay() {
    if (thinkingOverlay) {
        thinkingOverlay.classList.remove('active');
    }
}

// Start camera
async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });
        video.srcObject = stream;
        video.style.display = 'block';
        video.classList.add('active');
        scanButton.style.display = 'none';
        scanButton.classList.add('hidden');
        captureButton.classList.add('active');
        overlay.innerHTML = '';
        console.log('[CAMERA] Started successfully');
    } catch (error) {
        console.error('[CAMERA] Failed to start:', error);
        setOverlay('Kamera-Zugriff fehlgeschlagen');
    }
}

// Stop camera
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    video.srcObject = null;
    video.style.display = 'none';
    video.classList.remove('active');
    captureButton.classList.remove('active');
}

// Preprocess image for better OCR
function preprocessImage(sourceCanvas) {
    const ctx = sourceCanvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const data = imageData.data;
    
    // Convert to grayscale and enhance contrast
    for (let i = 0; i < data.length; i += 4) {
        // Convert to grayscale
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        
        // Enhance contrast and brightness for better text recognition
        // Increase contrast by 40% and brightness by 20%
        const contrast = 1.4;
        const brightness = 20;
        const enhanced = ((gray - 128) * contrast + 128) + brightness;
        
        // Clamp values
        const final = Math.max(0, Math.min(255, enhanced));
        
        // Apply to all channels
        data[i] = final;     // R
        data[i + 1] = final; // G
        data[i + 2] = final; // B
        // Alpha remains unchanged at data[i + 3]
    }
    
    ctx.putImageData(imageData, 0, 0);
    return sourceCanvas;
}

// Capture and scan
async function captureAndScan() {
    if (!worker) {
        setOverlay('OCR nicht bereit');
        return;
    }
    
    try {
        // Show thinking overlay immediately
        showThinkingOverlay();
        
        // Capture image from video
        const context = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Preprocess image for better OCR
        preprocessImage(canvas);
        
        capturedImageData = canvas.toDataURL('image/png');
        
        // Stop camera
        stopCamera();
        
        // Show processing message (though overlay is visible)
        setOverlay('Verarbeite Bild...');
        
        // Perform OCR
        const { data: { text } } = await worker.recognize(capturedImageData);
        
        // Hide thinking overlay after OCR completes
        hideThinkingOverlay();
        
        // Display result
        overlay.innerHTML = '';
        result.innerHTML = `OCR Ergebnis:<br>${text.replace(/\n/g, '<br>')}`;
        result.style.display = 'block';
        
        // Show scan button again
        scanButton.style.display = 'block';
        scanButton.textContent = 'Erneut scannen';
        
        console.log('[OCR] Result:', text);
    } catch (error) {
        console.error('[OCR] Recognition failed:', error);
        hideThinkingOverlay();
        setOverlay('OCR fehlgeschlagen');
        stopCamera();
        scanButton.style.display = 'block';
    }
}

// Event listeners
scanButton.addEventListener('click', () => {
    result.innerHTML = '';
    result.style.display = 'none';
    startCamera();
});

captureButton.addEventListener('click', captureAndScan);

// Initialize OCR on page load
initializeOCR();
