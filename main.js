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
        
        // Tesseract.js v5+: createWorker accepts language and options
        // No need for loadLanguage() or initialize() - they're deprecated
        worker = await createWorker('deu', 1, {
            // OEM 1 = LSTM engine (best accuracy)
        });
        
        // Set parameters for slow, precise OCR with better accuracy
        await worker.setParameters({
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

// Function to send OCR text via Rabbit LLM AI prompt
async function sendOCRTextViaRabbitAI(ocrText) {
    try {
        console.log('[Rabbit AI] Sending OCR text via Rabbit LLM prompt...');
        statusText.textContent = 'An Rabbit KI übergeben...';
        showThinkingOverlay();
        
        const prompt = `Du bist ein Assistent. Sende bitte den erkannten OCR-Beleginhalt als Mail an mich selbst. Rückgabe ausschließlich als gültiges JSON: {"action":"email","subject":"Rabbit Receipt Scan","body":"${ocrText.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"}`;
        
        const payload = {
            useLLM: true,
            message: prompt
        };
        
        // Send via PluginMessageHandler
        if (typeof PluginMessageHandler !== 'undefined') {
            PluginMessageHandler.postMessage(JSON.stringify(payload));
            console.log('[Rabbit AI] Prompt sent successfully via PluginMessageHandler');
        } else {
            console.warn('[Rabbit AI] PluginMessageHandler not available, payload:', payload);
            throw new Error('PluginMessageHandler nicht verfügbar');
        }
        
        hideThinkingOverlay();
        statusText.textContent = 'KI-Auftrag erteilt';
        await new Promise(resolve => setTimeout(resolve, 2000));
        statusText.textContent = '';
        
    } catch (error) {
        console.error('[Rabbit AI] Failed to send prompt:', error);
        hideThinkingOverlay();
        statusText.textContent = 'KI-Auftrag fehlgeschlagen: ' + error.message;
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
        
        // Auto-send OCR text via Rabbit AI prompt after successful OCR
        if (text && text.trim().length > 0) {
            await sendOCRTextViaRabbitAI(text);
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
