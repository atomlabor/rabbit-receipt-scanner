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
const statusText = document.getElementById('status-text');
const result = document.getElementById('result');

// Initialize the OCR worker with slow, precise settings
async function initializeOCR() {
    try {
        statusText.textContent = 'Initialisiere OCR-Engine...';
        showThinkingOverlay();
        
        worker = await createWorker();
        
        statusText.textContent = 'Lade deutsche Sprache...';
        await worker.loadLanguage('deu');
        
        statusText.textContent = 'Konfiguriere OCR...';
        await worker.initialize('deu');
        
        // Set parameters for slow, precise OCR with better accuracy
        await worker.setParameters({
            tessedit_ocr_engine_mode: '1', // Use LSTM engine (best accuracy)
            tessedit_pageseg_mode: '6', // Assume a single uniform block of text
            tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzäöüÄÖÜß€.,:-/()* ',
            // Quality/speed settings - prioritize accuracy over speed
            tessedit_do_invert: '0',
            edges_use_new_outline_complexity: '1',
            textord_heavy_nr: '1',
            // Additional precision settings
            tessedit_enable_dict_correction: '1',
            classify_enable_adaptive_matcher: '1',
            classify_enable_learning: '1'
        });
        
        hideThinkingOverlay();
        console.log('[OCR] Worker initialized successfully with slow precise mode');
    } catch (error) {
        console.error('[OCR] Failed to initialize:', error);
        hideThinkingOverlay();
        result.innerHTML = '❌ OCR Initialisierung fehlgeschlagen';
        result.style.display = 'block';
        result.classList.add('has-content');
    }
}

// Set overlay message
function setOverlay(message) {
    overlay.innerHTML = `<div class="loading">${message}</div>`;
}

// Show thinking overlay with status
function showThinkingOverlay() {
    thinkingOverlay.classList.add('active');
}

// Hide thinking overlay
function hideThinkingOverlay() {
    thinkingOverlay.classList.remove('active');
}

// Start camera
async function startCamera() {
    try {
        setOverlay('Kamera wird gestartet...');
        
        // Request camera with higher resolution for better OCR
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            } 
        });
        
        video.srcObject = stream;
        video.classList.add('active');
        captureButton.classList.add('active');
        scanButton.classList.add('hidden');
        overlay.innerHTML = '';
        
        console.log('[Camera] Started successfully');
    } catch (error) {
        console.error('[Camera] Failed to start:', error);
        setOverlay('Kamera-Zugriff fehlgeschlagen');
        result.innerHTML = '❌ Kamera-Zugriff fehlgeschlagen. Bitte Berechtigungen prüfen.';
        result.style.display = 'block';
        result.classList.add('has-content');
    }
}

// Stop camera
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    video.classList.remove('active');
    captureButton.classList.remove('hidden');
    captureButton.classList.remove('active');
    console.log('[Camera] Stopped');
}

// Advanced image preprocessing for better OCR accuracy
function preprocessImage(canvas) {
    const context = canvas.getContext('2d');
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Step 1: Convert to grayscale
    for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
    }
    
    // Step 2: Calculate adaptive threshold (slower but more accurate)
    const blockSize = 25;
    const C = 10;
    const tempData = new Uint8ClampedArray(data.length);
    
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            const idx = (y * canvas.width + x) * 4;
            
            // Calculate local mean
            let sum = 0;
            let count = 0;
            for (let by = Math.max(0, y - blockSize); by < Math.min(canvas.height, y + blockSize); by++) {
                for (let bx = Math.max(0, x - blockSize); bx < Math.min(canvas.width, x + blockSize); bx++) {
                    sum += data[(by * canvas.width + bx) * 4];
                    count++;
                }
            }
            const localMean = sum / count;
            
            // Apply threshold
            const threshold = localMean - C;
            const value = data[idx] > threshold ? 255 : 0;
            tempData[idx] = value;
            tempData[idx + 1] = value;
            tempData[idx + 2] = value;
            tempData[idx + 3] = 255;
        }
    }
    
    // Copy processed data back
    for (let i = 0; i < data.length; i++) {
        data[i] = tempData[i];
    }
    
    context.putImageData(imageData, 0, 0);
}

// Capture and scan with slow, precise OCR
async function captureAndScan() {
    if (!worker) {
        result.innerHTML = '❌ OCR nicht bereit. Bitte warten Sie, bis die Initialisierung abgeschlossen ist.';
        result.style.display = 'block';
        result.classList.add('has-content');
        return;
    }
    
    try {
        // Show thinking overlay immediately
        statusText.textContent = 'Erfasse Bild...';
        showThinkingOverlay();
        
        // Small delay to show status
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Capture image from video
        const context = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Preprocess image for better OCR
        statusText.textContent = 'Bereite Bild vor...';
        await new Promise(resolve => setTimeout(resolve, 300));
        preprocessImage(canvas);
        
        capturedImageData = canvas.toDataURL('image/png');
        
        // Stop camera
        stopCamera();
        
        // Perform OCR with progress updates
        statusText.textContent = 'Analysiere Text... bitte warten';
        await new Promise(resolve => setTimeout(resolve, 300));
        
        statusText.textContent = 'OCR läuft... dies kann einen Moment dauern';
        
        const { data: { text, confidence } } = await worker.recognize(capturedImageData);
        
        // Give time for processing to feel thorough
        statusText.textContent = 'Optimiere Ergebnis...';
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Hide thinking overlay after OCR completes
        hideThinkingOverlay();
        
        // Display result in the result div
        overlay.innerHTML = '';
        if (text && text.trim().length > 0) {
            result.innerHTML = `<strong>✓ OCR Ergebnis:</strong><br><br>${text.replace(/\n/g, '<br>')}`;
        } else {
            result.innerHTML = '⚠️ Kein Text erkannt. Bitte versuchen Sie es erneut mit besserem Licht und Fokus.';
        }
        result.classList.add('has-content');
        result.style.display = 'block';
        
        // Show scan button again
        scanButton.style.display = 'block';
        scanButton.classList.remove('hidden');
        scanButton.textContent = 'Erneut scannen';
        
        console.log('[OCR] Result:', text);
        console.log('[OCR] Confidence:', confidence);
    } catch (error) {
        console.error('[OCR] Recognition failed:', error);
        hideThinkingOverlay();
        
        // Display error in result div
        result.innerHTML = '❌ OCR fehlgeschlagen. Bitte versuchen Sie es erneut.';
        result.style.display = 'block';
        result.classList.add('has-content');
        
        overlay.innerHTML = '';
        stopCamera();
        scanButton.style.display = 'block';
        scanButton.classList.remove('hidden');
    }
}

// Event listeners
scanButton.addEventListener('click', () => {
    result.innerHTML = '';
    result.style.display = 'none';
    result.classList.remove('has-content');
    startCamera();
});

captureButton.addEventListener('click', captureAndScan);

// Initialize OCR on page load
initializeOCR();
