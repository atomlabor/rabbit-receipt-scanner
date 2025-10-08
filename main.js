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

function setStatus(msg) {
    if (dom.status) dom.status.textContent = msg;
    console.log('[STATUS]', msg);
}

function showState(state) {
    currentState = state;
    document.body.className = 'state-' + state;
    console.log('[STATE]', state);
}

function setOCRText(text) {
    if (dom.ocrText) {
        dom.ocrText.value = text || '';
    }
}

// === UTILITY: Send to AI with embedded data URL ===
function sendToAIWithEmbeddedDataUrl(toEmail, dataUrl, ocrText) {
    const escapedOcrText = (ocrText || 'No OCR text available').replace(/"/g, '\\"');
    const prompt = `You are an assistant. Please email the attached image (a scanned receipt) to the recipient. Add the OCR text as body content. Return ONLY valid JSON in this exact format: {"action":"email","to":"${toEmail}","subject":"Scanned Receipt","body":"${escapedOcrText}","attachments":[{"dataUrl":"<dataurl>"}]}`;
    const payload = {
        useLLM: true,
        message: prompt,
        imageDataUrl: dataUrl // included explicitly for server/tooling, no link
    };
    if (typeof PluginMessageHandler !== 'undefined') {
        PluginMessageHandler.postMessage(JSON.stringify(payload));
        setStatus('Sent to AI for email...');
    } else {
        setStatus('Plugin API not available');
        console.log('Payload:', payload);
    }
}

async function startCamera() {
    try {
        setStatus('Starting camera...');
        const constraints = {
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        dom.video.srcObject = stream;
        showState('camera');
        setStatus('Camera ready');
    } catch (err) {
        setStatus('Camera error: ' + err.message);
        console.error('[CAMERA]', err);
    }
}

function captureSnapshot() {
    if (!stream) {
        setStatus('No camera stream');
        return;
    }
    setStatus('Capturing snapshot...');
    const canvas = document.createElement('canvas');
    canvas.width = dom.video.videoWidth;
    canvas.height = dom.video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(dom.video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    dom.preview.src = dataUrl;
    capturedImageData = dataUrl;
    showState('preview');
    setStatus('Snapshot captured. Tap OCR to extract text.');
}

function retakePhoto() {
    showState('camera');
    setStatus('Ready to capture');
}

function performOCR() {
    if (!capturedImageData) {
        setStatus('No image captured');
        return;
    }
    setStatus('Performing OCR...');
    // Use Tesseract.js or similar library
    if (typeof Tesseract === 'undefined') {
        setStatus('OCR library not loaded');
        setOCRText('OCR library (Tesseract.js) not available.');
        return;
    }
    Tesseract.recognize(
        capturedImageData,
        'eng',
        {
            logger: m => {
                if (m.status === 'recognizing text') {
                    setStatus(`OCR: ${Math.round(m.progress * 100)}%`);
                }
            }
        }
    ).then(({ data: { text } }) => {
        setStatus('OCR complete');
        setOCRText(text);
    }).catch(err => {
        setStatus('OCR error: ' + err.message);
        console.error('[OCR]', err);
    });
}

function sendViaEmail() {
    const emailInput = dom.emailInput;
    const toEmail = (emailInput && emailInput.value || '').trim();
    if (!toEmail) {
        setStatus('Enter a valid email address');
        return;
    }
    if (!capturedImageData) {
        setStatus('No image captured');
        return;
    }
    const ocrText = dom.ocrText ? dom.ocrText.value : 'No OCR text available';
    setStatus('Preparing email...');
    sendToAIWithEmbeddedDataUrl(toEmail, capturedImageData, ocrText);
}

function init() {
    dom = {
        video: document.getElementById('video'),
        preview: document.getElementById('preview'),
        captureBtn: document.getElementById('captureBtn'),
        retakeBtn: document.getElementById('retakeBtn'),
        ocrBtn: document.getElementById('ocrBtn'),
        sendBtn: document.getElementById('sendBtn'),
        ocrText: document.getElementById('ocrText'),
        status: document.getElementById('status'),
        emailInput: document.getElementById('emailInput')
    };
    if (dom.captureBtn) dom.captureBtn.addEventListener('click', captureSnapshot);
    if (dom.retakeBtn) dom.retakeBtn.addEventListener('click', retakePhoto);
    if (dom.ocrBtn) dom.ocrBtn.addEventListener('click', performOCR);
    if (dom.sendBtn) dom.sendBtn.addEventListener('click', sendViaEmail);
    startCamera();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
})();
