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

function showThinkingOverlay() {
    thinkingOverlay.style.display = 'flex';
}

function hideThinkingOverlay() {
    thinkingOverlay.style.display = 'none';
}

async function startCamera() {
    try {
        console.log('[Camera] Starting camera...');
        scanButton.style.display = 'none';
        
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });
        
        video.srcObject = stream;
        video.style.display = 'block';
        captureButton.style.display = 'block';
        
        console.log('[Camera] Camera started successfully');
    } catch (error) {
        console.error('[Camera] Failed to start:', error);
        alert('Kamerazugriff fehlgeschlagen. Bitte überprüfen Sie die Berechtigungen.');
        scanButton.style.display = 'block';
    }
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        video.style.display = 'none';
        captureButton.style.display = 'none';
        console.log('[Camera] Camera stopped');
    }
}

// Function to send OCR text via Rabbit LLM with prompt-based approach
async function sendOCRTextViaLLM(ocrText) {
    try {
        console.log('[Email] Attempting to send OCR text via Rabbit LLM...');
        statusText.textContent = 'Versand OCR-Text per LLM...';
        showThinkingOverlay();
        
        // Create prompt with embedded OCR text
        const prompt = `You are an assistant. Please email the receipt text below to the recipient. Return ONLY valid JSON in this exact format: {"action":"email","subject":"Rabbit Receipt Scan","body":"${ocrText.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"}`;
        
        const payload = {
            useLLM: true,
            message: prompt,
            imageDataUrl: capturedImageData // Optional: include image attachment
        };
        
        // Send via PluginMessageHandler
        if (typeof PluginMessageHandler !== 'undefined') {
            PluginMessageHandler.postMessage(JSON.stringify(payload));
            console.log('[Email] Sent to AI via PluginMessageHandler');
            hideThinkingOverlay();
            statusText.textContent = 'Sent to AI...';
            await new Promise(resolve => setTimeout(resolve, 2000));
            statusText.textContent = '';
        } else {
            console.warn('[Email] PluginMessageHandler not available, payload:', payload);
            throw new Error('Plugin API not available');
        }
        
    } catch (error) {
        console.error('[Email] Failed to send OCR text:', error);
        hideThinkingOverlay();
        statusText.textContent = 'Versand fehlgeschlagen: ' + error.message;
        await new Promise(resolve => setTimeout(resolve, 3000));
        statusText.textContent = '';
    }
}

async function captureAndScan() {
    try {
        console.log('[Capture] Taking snapshot...');
        
        const context = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        capturedImageData = canvas.toDataURL('image/jpeg', 0.95);
        
        // No image display in overlay - just hide it
        overlay.style.display = 'none';
        
        stopCamera();
        
        console.log('[Capture] Snapshot taken, starting OCR...');
        
        statusText.textContent = 'Bereite OCR vor...';
        showThinkingOverlay();
        await new Promise(resolve => setTimeout(resolve, 200));
        
        statusText.textContent = 'Analysiere Text... bitte warten';
        await new Promise(resolve => setTimeout(resolve, 300));
        
        statusText.textContent = 'OCR läuft... dies kann einen Moment dauern';
        
        const { data: { text, confidence } } = await worker.recognize(capturedImageData);
        
        // Give time for processing to feel thorough
        statusText.textContent = 'Optimiere Ergebnis...';
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Hide thinking overlay after OCR completes
        hideThinkingOverlay();
        
        // Display ONLY plain text result in the result div (no image preview)
        if (text && text.trim().length > 0) {
            result.innerHTML = `✓ OCR Ergebnis (nur Text):<br><br>${text.replace(/\n/g, '<br>')}`;
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
