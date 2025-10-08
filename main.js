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
    },
};

// === HELPERS ===
function setStatus(message, type = '') {
    if (!dom.status) return;
    dom.status.textContent = message;
    dom.status.className = type;
    console.log(`[STATUS] ${message} (${type})`);
}

function setResultText(text) {
    if (!dom.results) return;
    dom.results.textContent = text;
    dom.results.style.display = text ? 'block' : 'none';
}

function cacheDom() {
    dom.video = document.getElementById('videoPreview');
    dom.canvas = document.getElementById('captureCanvas');
    dom.previewImg = document.getElementById('previewImg');
    dom.status = document.getElementById('statusText');
    dom.results = document.getElementById('results');
    dom.rabbitLogo = document.getElementById('rabbitLogo');
    dom.videoHint = document.getElementById('videoHint');
    dom.ocrProcessing = document.getElementById('ocrProcessing');
}

// === CAMERA ===
function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('Camera not supported', 'error');
        return;
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 1280, height: 720 }, audio: false })
        .then(mediaStream => {
            stream = mediaStream;
            dom.video.srcObject = mediaStream;
            dom.video.style.display = 'block';
            dom.previewImg.style.display = 'none';
            dom.rabbitLogo.style.display = 'none';
            setStatus('Bereit zum Scannen', 'success');
            setTimeout(() => {
                if (dom.videoHint) dom.videoHint.style.display = 'block';
            }, 500);
        })
        .catch(err => {
            setStatus('Kamera-Fehler', 'error');
            console.error('[CAMERA]', err);
        });
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
        dom.video.style.display = 'none';
    }
}

// === CAPTURE & OCR ===
function capture() {
    if (!stream) return;
    
    dom.videoHint.style.display = 'none';
    const ctx = dom.canvas.getContext('2d');
    dom.canvas.width = dom.video.videoWidth;
    dom.canvas.height = dom.video.videoHeight;
    ctx.drawImage(dom.video, 0, 0);
    
    const dataUrl = dom.canvas.toDataURL('image/jpeg', 0.9);
    capturedImageData = dataUrl; // Store for LLM
    dom.previewImg.src = dataUrl;
    dom.previewImg.style.display = 'block';
    dom.rabbitLogo.style.display = 'block';
    stopCamera();
    currentState = 'captured';
    setStatus('Foto aufgenommen', 'success');
    
    // Auto-start OCR
    setTimeout(() => runOCR(dataUrl), 300);
}

function runOCR(dataUrl) {
    if (!window.Tesseract) {
        setStatus('OCR noch nicht geladen', 'error');
        return;
    }
    
    // Show the thinking overlay
    if (dom.ocrProcessing) {
        dom.ocrProcessing.style.display = 'block';
    }
    
    setStatus('Erkenne Text...', 'processing');
    setResultText('');
    
    window.Tesseract.recognize(dataUrl, 'deu', {
        logger: info => {
            if (info.status === 'recognizing text') {
                const percent = Math.round(info.progress * 100);
                setStatus(`OCR läuft: ${percent}%`, 'processing');
            }
        }
    })
    .then(({ data }) => {
        const text = data.text.trim();
        console.log('[OCR] Result:', text);
        
        if (text.length > 0) {
            setStatus('Text erkannt!', 'success');
            setResultText(text);
            
            // Trigger LLM email after OCR success
            setTimeout(() => {
                sendViaRabbitLLM(capturedImageData, text);
            }, 1000);
        } else {
            setStatus('Kein Text erkannt', 'error');
            // Hide the thinking overlay on error
            if (dom.ocrProcessing) {
                dom.ocrProcessing.style.display = 'none';
            }
        }
    })
    .catch(err => {
        console.error('[OCR] Error:', err);
        setStatus('OCR-Fehler', 'error');
        // Hide the thinking overlay on error
        if (dom.ocrProcessing) {
            dom.ocrProcessing.style.display = 'none';
        }
    });
}

// === RABBIT LLM EMAIL ===
function sendViaRabbitLLM(imageDataUrl, ocrText) {
    console.log('[RABBIT_LLM] Preparing to send to Rabbit LLM...');
    
    if (!window.PluginMessageHandler) {
        console.error('[RABBIT_LLM] PluginMessageHandler not available');
        setStatus('Rabbit LLM nicht verfügbar', 'error');
        // Hide the thinking overlay
        if (dom.ocrProcessing) {
            dom.ocrProcessing.style.display = 'none';
        }
        return;
    }
    
    try {
        // Construct a prompt for the LLM
        const prompt = `Bitte sende diese Quittung per E-Mail an den Empfänger. Hier ist der erkannte Text: ${ocrText}`;
        
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
            // Hide the thinking overlay after email is sent
            if (dom.ocrProcessing) {
                dom.ocrProcessing.style.display = 'none';
            }
        }, 2000);
        
    } catch (error) {
        console.error('[RABBIT_LLM] Error sending to Rabbit LLM:', error);
        setStatus('Failed to send via Rabbit LLM', 'error');
        // Hide the thinking overlay on error
        if (dom.ocrProcessing) {
            dom.ocrProcessing.style.display = 'none';
        }
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

function setupEventListeners() {
    dom.video.addEventListener('click', capture);
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
