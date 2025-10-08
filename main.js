/* Rabbit Receipt Scanner */

// === GLOBALS ===
let currentState = 'camera';
let stream = null;
let zoom = 1.0;
let dom = {};
let recognition = null;

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
    dom.captureButton = qs('captureButton');
    dom.output = qs('output');
    dom.loading = qs('loading');
    dom.results = qs('results');
}

// === EVENT LISTENERS ===
function setupEventListeners() {
    if (dom.captureButton) {
        dom.captureButton.addEventListener('click', captureImage);
    }
}

// === CAMERA FUNCTIONS ===
function startCamera() {
    console.log('[CAMERA] Starting camera...');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(mediaStream => {
            stream = mediaStream;
            if (dom.video) {
                dom.video.srcObject = stream;
            }
            console.log('[CAMERA] Camera started successfully');
        })
        .catch(err => {
            console.error('[CAMERA] Error accessing camera:', err);
        });
}

function captureImage() {
    console.log('captureImage dom.video:', dom.video, 'dom.canvas:', dom.canvas);
    
    if (!dom.video || !dom.canvas) {
        console.warn('[CAPTURE] Missing DOM elements, creating canvas dynamically');
        
        // Create canvas dynamically if it doesn't exist
        if (!dom.canvas) {
            dom.canvas = document.createElement('canvas');
            dom.canvas.id = 'captureCanvas';
            dom.canvas.style.display = 'none';
            document.body.appendChild(dom.canvas);
        }
    }
    
    if (!dom.video || !stream) {
        console.error('[CAPTURE] Video element or stream not available');
        return;
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
    
    // Process with OCR
    processImage(imageData);
}

function processImage(imageData) {
    if (!dom.loading) return;
    
    dom.loading.style.display = 'block';
    
    if (window.Tesseract) {
        Tesseract.recognize(imageData, 'eng', {
            logger: m => console.log('[OCR]', m)
        }).then(({ data: { text } }) => {
            displayResults(text);
            dom.loading.style.display = 'none';
        }).catch(err => {
            console.error('[OCR] Error:', err);
            dom.loading.style.display = 'none';
        });
    } else {
        console.warn('[OCR] Tesseract not loaded');
        dom.loading.style.display = 'none';
    }
}

function displayResults(text) {
    if (!dom.results) return;
    
    dom.results.textContent = text;
    dom.results.style.display = 'block';
    
    // Store result
    window.storage.set('lastScan', text);
}

// === INITIALIZATION ===
function init() {
    cacheDom();
    setupEventListeners();
    reset();
    
    // Load Tesseract.js
    if (!window.Tesseract && typeof importScripts !== 'function') {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/tesseract.js@v4/dist/tesseract.min.js';
        document.head.appendChild(script);
    }
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
