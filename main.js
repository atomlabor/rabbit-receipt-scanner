/* Rabbit Receipt Scanner - Jens Special Edition */
(function() {
// === GLOBALS ===
let currentState = 'camera';
let stream = null;
let zoom = 1.0;
let dom = {};

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
    dom.videoTip = qs('videoTip');
}

// === UI STATE MANAGEMENT ===
function showCamera() {
    if (dom.video) dom.video.style.display = 'block';
    if (dom.videoTip) dom.videoTip.style.display = 'block';
    if (dom.previewImg) dom.previewImg.style.display = 'none';
    if (dom.rabbitLogo) dom.rabbitLogo.style.display = 'none';
    if (dom.results) dom.results.style.display = 'none';
}

function showResults(imageDataUrl) {
    if (dom.video) dom.video.style.display = 'none';
    if (dom.videoTip) dom.videoTip.style.display = 'none';
    if (dom.previewImg) {
        dom.previewImg.src = imageDataUrl;
        dom.previewImg.style.display = 'block';
    }
    if (dom.rabbitLogo) dom.rabbitLogo.style.display = 'block';
}

function setStatus(message) {
    console.log('[STATUS]', message);
    if (dom.status) {
        dom.status.textContent = message;
    }
}

// === EVENT LISTENERS ===
function setupEventListeners() {
    if (dom.video) {
        dom.video.addEventListener('click', captureImage);
    }
}

// === CAMERA FUNCTIONS ===
function startCamera() {
    console.log('[CAMERA] Starting camera...');
    setStatus('Starting camera...');
    
    navigator.mediaDevices.getUserMedia({ 
        video: { 
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 }
        } 
    })
    .then(mediaStream => {
        stream = mediaStream;
        if (dom.video) {
            dom.video.srcObject = stream;
        }
        console.log('[CAMERA] Camera started successfully');
        setStatus('Ready to scan');
        showCamera();
    })
    .catch(err => {
        console.error('[CAMERA] Error accessing camera:', err);
        setStatus('Camera error: ' + err.message);
    });
}

function captureImage() {
    console.log('[CAPTURE] Capturing image...');
    setStatus('Capturing image...');
    
    if (!dom.video || !stream) {
        console.error('[CAPTURE] Video element or stream not available');
        setStatus('Camera not ready');
        return;
    }
    
    // Create canvas if it doesn't exist
    if (!dom.canvas) {
        dom.canvas = document.createElement('canvas');
        dom.canvas.id = 'captureCanvas';
        dom.canvas.style.display = 'none';
        document.body.appendChild(dom.canvas);
    }
    
    const ctx = dom.canvas.getContext('2d');
    const video = dom.video;
    
    // Set canvas size to match video
    dom.canvas.width = video.videoWidth;
    dom.canvas.height = video.videoHeight;
    
    // Draw current video frame to canvas
    ctx.drawImage(video, 0, 0, dom.canvas.width, dom.canvas.height);
    
    // Convert to image data
    const imageData = dom.canvas.toDataURL('image/jpeg', 0.9);
    
    // Show preview immediately
    showResults(imageData);
    
    // Process with OCR directly
    runOCR(imageData);
}

function runOCR(imageData) {
    setStatus('Processing receipt...');
    
    if (window.Tesseract) {
        Tesseract.recognize(imageData, 'eng', {
            logger: m => {
                if (m.status === 'recognizing text') {
                    const progress = Math.round(m.progress * 100);
                    setStatus(`Scanning: ${progress}%`);
                }
                console.log('[OCR]', m);
            }
        }).then(({ data: { text } }) => {
            displayResults(text);
            setStatus('Scan complete!');
        }).catch(err => {
            console.error('[OCR] Error:', err);
            setStatus('OCR failed: ' + err.message);
        });
    } else {
        console.warn('[OCR] Tesseract not loaded');
        setStatus('OCR library not loaded');
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
            setStatus('OCR ready');
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
