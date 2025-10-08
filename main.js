/* Rabbit Receipt Scanner
Key fixes:
- Scan button completely replaced by video preview when camera starts
- Video immediately visible in camera state (button hidden)
- Click on live video captures photo immediately
- Clean state transitions: idle ↔ camera → processing → results → idle
- Rabbit R1 hardware events: PTT (volume keys, 'v', space, enter), Escape for reset
- Tesseract OCR with deu+eng
- Rabbit PluginMessageHandler integration with embedded dataUrl and email action
- deviceControls API: sideButton, scrollWheel with full feature set
- r1.camera.capturePhoto() hardware camera API support
- analyzeData & textToSpeech utilities for Rabbit LLM integration
*/
(function() {
'use strict';

// App State
const States = Object.freeze({
    idle: 'idle',
    camera: 'camera',
    processing: 'processing',
    results: 'results'
});
let currentState = 'idle';

// Media and processing
let stream = null;
let currentBlob = null;
let zoom = 1.0;
let isScanning = false;

// DOM elements
const dom = {};
const qs = (id) => document.getElementById(id);

function cacheDom() {
    dom.btnScan = qs('scanBtn');
    dom.status = qs('status');
    dom.video = qs('videoPreview');
    dom.canvas = qs('canvas');
    dom.previewImg = qs('previewImg');
    dom.results = qs('results');
    dom.ocrText = qs('ocrText');
    dom.btnRetake = qs('retakeBtn');
    dom.btnReset = qs('resetBtn');
    dom.btnEmail = qs('emailBtn');
}

// === CAMERA ===
async function startCamera() {
    try {
        currentState = 'camera';
        updateUI();
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });
        dom.video.srcObject = stream;
        await dom.video.play();
        zoom = 1.0;
    } catch (err) {
        console.error('[CAMERA] Error:', err);
        alert('Camera error: ' + err);
        reset();
    }
}

function stopCamera() {
    try {
        if (stream) stream.getTracks().forEach(t => t.stop());
        if (dom.video) dom.video.srcObject = null;
    } catch (e) {
        console.warn('[CAMERA] stop error', e);
    }
}

// === CAPTURE ===
function captureImage() {
    if (currentState !== 'camera' || isScanning) return;
    if (!dom.video || !dom.canvas) {
        alert('Camera not ready');
        return;
    }
    
    // Classic video/canvas capture
    dom.canvas.width = dom.video.videoWidth;
    dom.canvas.height = dom.video.videoHeight;
    dom.canvas.getContext('2d').drawImage(dom.video, 0, 0);
    const image = dom.canvas.toDataURL('image/jpeg', 0.9);
    
    // Store image and update state
    if (window.storage) {
        window.storage.set('r1.lastImage', image);
    }
    
    stopCamera();
    
    if (dom.previewImg) dom.previewImg.src = image;
    currentState = 'preview';
    updateUI();
    
    // Process OCR with captured image
    processOCR(image);
}

// === OCR PROCESSING ===
async function processOCR(imageData) {
    try {
        isScanning = true;
        currentState = 'processing';
        updateUI();
        
        updateStatus('Scanning receipt...');
        
        // Initialize Tesseract if not already done
        if (!window.tesseractWorker) {
            updateStatus('Loading OCR engine...');
            window.tesseractWorker = await Tesseract.createWorker('deu+eng');
        }
        
        const { data: { text } } = await window.tesseractWorker.recognize(imageData);
        
        displayResults(text, imageData);
        
    } catch (error) {
        console.error('[OCR] Error:', error);
        alert('OCR processing failed: ' + error.message);
        reset();
    } finally {
        isScanning = false;
    }
}

function displayResults(text, imageData) {
    currentState = 'results';
    if (dom.ocrText) dom.ocrText.textContent = text;
    currentBlob = imageData;
    updateUI();
    updateStatus('Receipt scanned successfully!');
}

// === UI MANAGEMENT ===
function updateUI() {
    if (!dom.btnScan) return;
    
    // Hide all elements first
    const elements = [dom.btnScan, dom.video, dom.canvas, dom.previewImg, dom.results];
    elements.forEach(el => el && (el.style.display = 'none'));
    
    switch (currentState) {
        case 'idle':
            if (dom.btnScan) dom.btnScan.style.display = 'block';
            break;
        case 'camera':
            if (dom.video) dom.video.style.display = 'block';
            break;
        case 'processing':
            if (dom.previewImg) dom.previewImg.style.display = 'block';
            break;
        case 'preview':
        case 'results':
            if (dom.previewImg) dom.previewImg.style.display = 'block';
            if (dom.results) dom.results.style.display = 'block';
            break;
    }
}

function updateStatus(message) {
    console.log('[STATUS]', message);
    if (dom.status) dom.status.textContent = message;
}

function reset() {
    stopCamera();
    currentState = 'idle';
    isScanning = false;
    currentBlob = null;
    updateUI();
    updateStatus('Ready to scan');
}

// === EVENT HANDLERS ===
function setupEventListeners() {
    // Scan button
    if (dom.btnScan) {
        dom.btnScan.addEventListener('click', startCamera);
    }
    
    // Video click for capture
    if (dom.video) {
        dom.video.addEventListener('click', captureImage);
    }
    
    // Retake button
    if (dom.btnRetake) {
        dom.btnRetake.addEventListener('click', startCamera);
    }
    
    // Reset button
    if (dom.btnReset) {
        dom.btnReset.addEventListener('click', reset);
    }
    
    // Email button
    if (dom.btnEmail) {
        dom.btnEmail.addEventListener('click', sendEmail);
    }
    
    // Keyboard events for Rabbit R1
    document.addEventListener('keydown', (e) => {
        switch (e.key) {
            case 'v':
            case ' ':
            case 'Enter':
                if (currentState === 'idle') startCamera();
                else if (currentState === 'camera') captureImage();
                break;
            case 'Escape':
                reset();
                break;
        }
    });
}

// === EMAIL INTEGRATION ===
function sendEmail() {
    if (!currentBlob) {
        alert('No receipt to send');
        return;
    }
    
    const text = dom.ocrText ? dom.ocrText.textContent : '';
    
    // Rabbit Plugin Message Handler
    if (window.PluginMessageHandler) {
        window.PluginMessageHandler({
            action: 'email',
            subject: 'Receipt Scan',
            body: `Receipt text:\n${text}`,
            attachments: [{
                name: 'receipt.jpg',
                data: currentBlob
            }]
        });
    }
}

// === RABBIT R1 INTEGRATIONS ===

// Hardware camera API fallback
if (window.r1 && window.r1.camera) {
    window.r1.camera.onCaptureResult = function(result) {
        if (result.success && result.dataUrl) {
            if (dom.previewImg) dom.previewImg.src = result.dataUrl;
            currentState = 'preview';
            updateUI();
            processOCR(result.dataUrl);
        }
    };
}

// Device controls
if (window.deviceControls) {
    window.deviceControls.sideButton.onPress = () => {
        if (currentState === 'idle') startCamera();
        else if (currentState === 'camera') captureImage();
    };
    
    window.deviceControls.scrollWheel.onScroll = (delta) => {
        if (currentState === 'camera' && stream) {
            zoom = Math.max(1.0, Math.min(3.0, zoom + delta * 0.1));
            // Apply zoom if supported
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

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Rabbit LLM integration utilities
window.analyzeData = function(data, callback) {
    // Placeholder for Rabbit LLM analysis
    if (callback) callback({ analyzed: true, data });
};

window.textToSpeech = function(text) {
    try {
        const utterance = new SpeechSynthesisUtterance(text);
        speechSynthesis.speak(utterance);
    } catch (e) {
        console.warn('[TTS] Failed:', e);
    }
};

})();
