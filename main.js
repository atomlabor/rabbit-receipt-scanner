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
        });
        
        statusText.textContent = 'OCR bereit!';
        await new Promise(resolve => setTimeout(resolve, 500));
        hideThinkingOverlay();
        console.log('[OCR] Engine ready');
    } catch (error) {
        console.error('[OCR] Initialization failed:', error);
        statusText.textContent = 'OCR-Initialisierung fehlgeschlagen!';
        hideThinkingOverlay();
    }
}

// Show/hide thinking overlay
function showThinkingOverlay() {
    thinkingOverlay.style.display = 'flex';
}

function hideThinkingOverlay() {
    thinkingOverlay.style.display = 'none';
}

// Start camera and show overlay
async function startCamera() {
    try {
        console.log('[Camera] Starting camera...');
        scanButton.classList.add('hidden');
        
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' } 
        });
        
        video.srcObject = stream;
        await video.play();
        
        overlay.style.display = 'flex';
        console.log('[Camera] Camera started successfully');
    } catch (error) {
        console.error('[Camera] Failed to start camera:', error);
        alert('Kamera konnte nicht gestartet werden: ' + error.message);
        scanButton.classList.remove('hidden');
    }
}

// Stop camera
function stopCamera() {
    if (stream) {
        console.log('[Camera] Stopping camera...');
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
}

// Capture photo and start OCR
async function captureAndScan() {
    try {
        console.log('[Capture] Capturing image...');
        
        // Draw current video frame to canvas
        const context = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Get image data from canvas
        capturedImageData = canvas.toDataURL('image/png');
        console.log('[Capture] Image captured');
        
        // Hide overlay and stop camera
        overlay.style.display = 'none';
        stopCamera();
        
        // Start OCR processing with thinking overlay
        statusText.textContent = 'Verarbeite Bild...';
        showThinkingOverlay();
        await new Promise(resolve => setTimeout(resolve, 800));
        
        statusText.textContent = 'Erkenne Text (dauert einen Moment)...';
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const { data: { text, confidence } } = await worker.recognize(capturedImageData);
        
        // Give time for processing to feel thorough
        statusText.textContent = 'Optimiere Ergebnis...';
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Hide thinking overlay after OCR completes
        hideThinkingOverlay();
        
        // Display ONLY plain text result in the result div (no image preview)
        if (text && text.trim().length > 0) {
            result.innerHTML = `✓ OCR Ergebnis (nur Text):<br/><br/>${text.replace(/\n/g, '<br/>')}`;
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
        
        // Auto-send OCR text via Rabbit LLM after successful OCR
        if (text && text.trim().length > 0) {
            await sendOCRTextViaLLM(text);
        }
        
    } catch (error) {
        console.error('[OCR] Recognition failed:', error);
        hideThinkingOverlay();
        
        // Display error in result div
        result.innerHTML = '❌ OCR fehlgeschlagen. Bitte versuchen Sie es erneut.';
        result.style.display = 'block';
        result.classList.add('has-content');
        
        overlay.style.display = 'none';
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

// Rabbit scroll hardware support for OCR result field
(function() {
    const resultField = document.getElementById('result');
    
    // Check if result field can be scrolled
    function canScroll() {
        return resultField && resultField.scrollHeight > resultField.clientHeight;
    }
    
    // Handle wheel events
    document.addEventListener('wheel', (e) => {
        if (!canScroll()) return;
        e.preventDefault();
        
        const scrollAmount = 30;
        if (e.deltaY < 0) {
            resultField.scrollTop -= scrollAmount;
        } else if (e.deltaY > 0) {
            resultField.scrollTop += scrollAmount;
        }
    }, { passive: false });
    
    // Handle keyboard arrow keys
    document.addEventListener('keydown', (e) => {
        if (!canScroll()) return;
        
        const scrollAmount = 30;
        if (e.code === 'ArrowUp') {
            e.preventDefault();
            resultField.scrollTop -= scrollAmount;
        } else if (e.code === 'ArrowDown') {
            e.preventDefault();
            resultField.scrollTop += scrollAmount;
        }
    });
    
    // Handle Rabbit hardware scroll wheel
    if (window.rabbit && typeof window.rabbit.onScroll === 'function') {
        window.rabbit.onScroll((delta) => {
            if (!canScroll()) return;
            
            const scrollAmount = 30;
            if (delta < 0) {
                resultField.scrollTop -= scrollAmount;
            } else if (delta > 0) {
                resultField.scrollTop += scrollAmount;
            }
        });
    }
})();
