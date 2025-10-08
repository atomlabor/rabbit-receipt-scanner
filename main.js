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
const result = document.getElementById('result');

// Initialize the OCR worker
async function initializeOCR() {
    try {
        worker = await createWorker();
        await worker.loadLanguage('deu');
        await worker.initialize('deu');
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

// Start camera
async function startCamera() {
    try {
        setOverlay('Kamera wird gestartet...');
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' } 
        });
        video.srcObject = stream;
        video.style.display = 'block';
        video.classList.add('active');
        captureButton.classList.add('active');
        scanButton.style.display = 'none';
        overlay.innerHTML = '';
        console.log('[Camera] Started successfully');
    } catch (error) {
        console.error('[Camera] Failed to start:', error);
        setOverlay('Kamera konnte nicht gestartet werden');
    }
}

// Stop camera
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    video.srcObject = null;
    video.style.display = 'none';
    video.classList.remove('active');
    captureButton.classList.remove('active');
}

// Capture and scan
async function captureAndScan() {
    if (!worker) {
        setOverlay('OCR nicht bereit');
        return;
    }
    try {
        // Capture image from video
        const context = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        capturedImageData = canvas.toDataURL('image/png');
        
        // Stop camera
        stopCamera();
        
        // Show processing message
        setOverlay('Verarbeite Bild...');
        
        // Perform OCR
        const { data: { text } } = await worker.recognize(capturedImageData);
        
        // Display result
        overlay.innerHTML = '';
        result.innerHTML = `OCR Ergebnis:<br/>${text.replace(/\n/g, '<br/>')}`;
        result.style.display = 'block';
        
        // Show scan button again
        scanButton.style.display = 'block';
        scanButton.textContent = 'Erneut scannen';
        
        console.log('[OCR] Result:', text);
    } catch (error) {
        console.error('[OCR] Recognition failed:', error);
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
