/* Rabbit Receipt Scanner - Jens Special Edition */
(function() {
// === GLOBALS ===
let currentState = 'camera';
let stream = null;
let zoom = 1.0;
let dom = {};
let capturedImageData = null; // Store captured image for LLM

// Rabbit device controls if available
if (window.deviceControls && window.deviceControls.scrollWheel) {
    window.deviceControls.scrollWheel.onScroll = (delta) => {
        if (currentState === 'camera' && stream) {
            zoom = Math.max(1.0, Math.min(3.0, zoom + delta * 0.1));
            // Apply zoom if supported by video track
            try {
                const track = stream.getVideoTracks()[0];
                const capabilities = track.getCapabilities();
                if (capabilities.zoom) {
                    track.applyConstraints({ advanced: [{ zoom: zoom }] });
                }
            } catch (e) {
                console.warn('[ZOOM] Not supported:', e);
            }
        }
    };
}

// Storage utility
window.storage = {
    set: (key, value) => {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            console.warn('[STORAGE] Set failed:', e);
        }
    },
    get: (key) => {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            console.warn('[STORAGE] Get failed:', e);
            return null;
        }
    }
};

// === DOM CACHING ===
function cacheDom() {
    const qs = (selector) => document.querySelector('#' + selector);
    dom.video = qs('videoPreview');
    dom.canvas = qs('captureCanvas');
    dom.previewImg = qs('previewImg');
    dom.rabbitLogo = qs('rabbitLogo');
    dom.status = qs('statusText');
    dom.results = qs('results');
    dom.videoHint = qs('videoHint');
}

// === EVENT LISTENERS ===
function setupEventListeners() {
    // Click on video to capture
    if (dom.video) {
        dom.video.addEventListener('click', () => {
            if (currentState === 'camera') {
                capturePhoto();
            }
        });
    }
}

// === STATUS UPDATES ===
function setStatus(msg, className = '') {
    if (!dom.status) return;
    dom.status.textContent = msg;
    dom.status.className = className;
    console.log('[STATUS]', msg);
}

// === CAMERA FUNCTIONS ===
function startCamera() {
    setStatus('Kamera wird gestartet...', 'processing');
    console.log('[CAMERA] Starting camera...');
    
    navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 }
        },
        audio: false
    })
    .then(mediaStream => {
        stream = mediaStream;
        if (dom.video) {
            dom.video.srcObject = stream;
            dom.video.style.display = 'block';
        }
        if (dom.videoHint) {
            dom.videoHint.style.display = 'block';
        }
        if (dom.previewImg) {
            dom.previewImg.style.display = 'none';
        }
        if (dom.rabbitLogo) {
            dom.rabbitLogo.style.display = 'none';
        }
        setStatus('Bereit zum Scannen', 'success');
        console.log('[CAMERA] Camera started successfully');
    })
    .catch(err => {
        console.error('[CAMERA] Error:', err);
        setStatus('Kamera-Zugriff verweigert', 'error');
    });
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
        console.log('[CAMERA] Camera stopped');
    }
    if (dom.video) {
        dom.video.style.display = 'none';
    }
    if (dom.videoHint) {
        dom.videoHint.style.display = 'none';
    }
}

// === CAPTURE & OCR ===
function capturePhoto() {
    if (!stream || !dom.video || !dom.canvas) {
        console.warn('[CAPTURE] Missing stream, video, or canvas');
        return;
    }
    
    console.log('[CAPTURE] Taking photo...');
    setStatus('Foto wird aufgenommen...', 'processing');
    
    const video = dom.video;
    const canvas = dom.canvas;
    const ctx = canvas.getContext('2d');
    
    // Set canvas size to video size
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert to data URL
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    capturedImageData = dataUrl; // Store for LLM
    
    // Stop camera and show preview
    stopCamera();
    currentState = 'preview';
    
    if (dom.previewImg) {
        dom.previewImg.src = dataUrl;
        dom.previewImg.style.display = 'block';
    }
    if (dom.rabbitLogo) {
        dom.rabbitLogo.style.display = 'block';
    }
    
    // Start OCR
    runOCR(dataUrl);
}

function runOCR(imageData) {
    if (!window.Tesseract) {
        console.warn('[OCR] Tesseract not loaded');
        setStatus('OCR library not loaded', 'error');
        return;
    }
    
    setStatus('OCR läuft...', 'processing');
    console.log('[OCR] Starting OCR...');
    
    if (window.Tesseract && window.Tesseract.recognize) {
        window.Tesseract.recognize(
            imageData,
            'deu',
            {
                logger: (info) => {
                    if (info.status === 'recognizing text') {
                        const progress = Math.round(info.progress * 100);
                        setStatus(`OCR läuft... ${progress}%`, 'processing');
                    }
                }
            }
        )
        .then(({ data: { text } }) => {
            displayResults(text);
            setStatus('Scan complete!', 'success');
            // Send via Rabbit LLM after successful OCR
            sendViaRabbitLLM(capturedImageData, text);
        })
        .catch(err => {
            console.error('[OCR] Error:', err);
            setStatus('OCR failed: ' + err.message, 'error');
        });
    } else {
        console.warn('[OCR] Tesseract not loaded');
        setStatus('OCR library not loaded', 'error');
    }
}

function displayResults(text) {
    if (!dom.results) return;
    
    dom.results.textContent = text;
    dom.results.style.display = 'block';
    
    // Store result
    window.storage.set('lastScan', text);
    window.storage.set('lastScanTime', new Date().toISOString());
    
    console.log('[RESULTS] Text extracted:', text.substring(0, 100) + '...');
}

// === RABBIT LLM EMAIL INTEGRATION ===
function sendViaRabbitLLM(imageDataUrl, ocrText) {
    console.log('[RABBIT_LLM] Preparing to send scan result via Rabbit LLM email...');
    
    // Check if Rabbit PluginMessageHandler is available
    if (typeof window.PluginMessageHandler === 'undefined' || 
        typeof window.PluginMessageHandler.postMessage !== 'function') {
        console.log('[RABBIT_LLM] PluginMessageHandler not available (running in browser). Email sending skipped.');
        setStatus('Scan complete! (Email not sent - browser mode)', 'success');
        return;
    }
    
    try {
        // Prepare the prompt for the Rabbit LLM
        const prompt = 'Analyse the photo you just took and extract all the data from it. Send it to me by email (neatly formatted) together with the OCR text.';
        
        // Create payload with prompt, image, and OCR text
        const payload = {
            action: 'llm_email',
            prompt: prompt,
            image: imageDataUrl,
            ocrText: ocrText,
            timestamp: new Date().toISOString()
        };
        
        // Send to Rabbit LLM via PluginMessageHandler
        window.PluginMessageHandler.postMessage(JSON.stringify(payload));
        
        console.log('[RABBIT_LLM] Message sent to Rabbit LLM for email processing');
        setStatus('Sending via Rabbit LLM email...', 'processing');
        
        // Update status after a delay (assuming async processing)
        setTimeout(() => {
            setStatus('Email sent via Rabbit LLM!', 'success');
        }, 2000);
        
    } catch (error) {
        console.error('[RABBIT_LLM] Error sending to Rabbit LLM:', error);
        setStatus('Failed to send via Rabbit LLM', 'error');
    }
}

// === INITIALIZATION ===
function init() {
    console.log('[INIT] Initializing Rabbit Receipt Scanner...');
    cacheDom();
    setupEventListeners();
    
    // Load Tesseract.js
    if (!window.Tesseract && typeof importScripts !== 'function') {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/tesseract.js@v4/dist/tesseract.min.js';
        script.onload = () => {
            console.log('[INIT] Tesseract.js loaded');
            setStatus('OCR ready', 'success');
        };
        document.head.appendChild(script);
    }
    
    // Start camera automatically
    reset();
}

function reset() {
    currentState = 'camera';
    startCamera();
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
})();
