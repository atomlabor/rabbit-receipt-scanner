/* Rabbit Receipt Scanner - Jens Special Edition */

// Initialize Tesseract
const { createWorker } = Tesseract;

let worker = null;
let stream = null;
let capturedImageData = null;

// DOM elements
const scanButton = document.getElementById('scanButton');
const statusElement = document.getElementById('status');
const outputElement = document.getElementById('output');
const overlay = document.getElementById('overlay');

// Initialize the OCR worker
async function initializeOCR() {
    try {
        worker = await createWorker();
        await worker.loadLanguage('deu');
        await worker.initialize('deu');
        console.log('[OCR] Worker initialized successfully');
    } catch (error) {
        console.error('[OCR] Failed to initialize:', error);
        setStatus('OCR initialization failed');
    }
}

// Set status message
function setStatus(message) {
    if (statusElement) {
        statusElement.textContent = message;
    }
    console.log('[STATUS]', message);
}

// Set OCR output text
function setOutput(text) {
    if (outputElement) {
        outputElement.textContent = text || 'Hier erscheint der gescannte Text...';
    }
}

// Show overlay with thinking rabbit
function showOverlay() {
    if (overlay) {
        overlay.classList.add('active');
    }
}

// Hide overlay
function hideOverlay() {
    if (overlay) {
        overlay.classList.remove('active');
    }
}

// Start camera
async function startCamera() {
    try {
        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: { ideal: 'environment' }
            }
        };
        
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        setStatus('Kamera bereit');
        console.log('[CAMERA] Camera started successfully');
    } catch (error) {
        console.error('[CAMERA] Failed to start camera:', error);
        setStatus('Kamera-Fehler: ' + error.message);
    }
}

// Capture photo and perform OCR
async function captureAndScan() {
    if (!stream) {
        setStatus('Kamera nicht verfügbar');
        return;
    }
    
    try {
        setStatus('Foto wird aufgenommen...');
        
        // Create video element to capture frame
        const video = document.createElement('video');
        video.srcObject = stream;
        video.play();
        
        // Wait for video to be ready
        await new Promise((resolve) => {
            video.onloadedmetadata = () => resolve();
        });
        
        // Create canvas to capture frame
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Draw the current frame
        context.drawImage(video, 0, 0);
        
        // Get image data
        capturedImageData = canvas.toDataURL('image/jpeg', 0.8);
        
        // Stop video
        video.pause();
        video.srcObject = null;
        
        // Show overlay with thinking rabbit
        showOverlay();
        setStatus('OCR wird durchgeführt...');
        
        // Perform OCR
        await performOCR();
        
    } catch (error) {
        console.error('[CAPTURE] Failed to capture image:', error);
        setStatus('Foto-Fehler: ' + error.message);
        hideOverlay();
    }
}

// Perform OCR on captured image
async function performOCR() {
    if (!worker) {
        setStatus('OCR nicht initialisiert');
        hideOverlay();
        return;
    }
    
    if (!capturedImageData) {
        setStatus('Kein Bild vorhanden');
        hideOverlay();
        return;
    }
    
    try {
        // Perform OCR
        const result = await worker.recognize(capturedImageData, {
            logger: (m) => {
                if (m.status === 'recognizing text') {
                    setStatus(`OCR: ${Math.round(m.progress * 100)}%`);
                }
            }
        });
        
        // Hide overlay
        hideOverlay();
        
        // Set results
        const text = result.data.text.trim();
        if (text) {
            setOutput(text);
            setStatus('OCR abgeschlossen');
        } else {
            setOutput('Kein Text erkannt');
            setStatus('Kein Text gefunden');
        }
        
        console.log('[OCR] Text recognized:', text);
        
    } catch (error) {
        console.error('[OCR] Recognition failed:', error);
        setStatus('OCR-Fehler: ' + error.message);
        hideOverlay();
    }
}

// Initialize the application
async function init() {
    console.log('[APP] Initializing Rabbit Receipt Scanner');
    
    // Initialize OCR
    await initializeOCR();
    
    // Start camera
    await startCamera();
    
    // Add click event to scan button
    if (scanButton) {
        scanButton.addEventListener('click', captureAndScan);
    }
    
    setStatus('Bereit zum Scannen');
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
