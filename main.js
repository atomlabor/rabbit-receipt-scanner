/* Rabbit Receipt Scanner */
// Initialize Tesseract
const { createWorker } = Tesseract;
let worker = null;
let stream = null;
let capturedImageData = null;

// LLMHelpers class implementation (from SDK)
class LLMHelpers {
  constructor(messaging) {
    if (!messaging || typeof messaging !== 'object') {
      throw new Error('[LLMHelpers] Invalid messaging object');
    }
    this.messaging = messaging;
  }

  async performTask(prompt, waitForCompletion = true) {
    try {
      console.log('[LLMHelpers] Sending prompt to r1.messaging...');
      await this.messaging.sendPrompt(prompt);
      console.log('[LLMHelpers] ✓ Prompt sent successfully');
      
      if (waitForCompletion) {
        console.log('[LLMHelpers] Waiting for task completion...');
        await this.messaging.waitForCompletion();
        console.log('[LLMHelpers] ✓ Task completed');
      }
    } catch (error) {
      console.error('[LLMHelpers] Error performing task:', error);
      throw error;
    }
  }
}

// DOM elements
const scanButton = document.getElementById('scanButton');
const captureButton = document.getElementById('captureButton');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const overlay = document.getElementById('overlay');
const thinkingOverlay = document.getElementById('thinking-overlay');
const statusText = document.getElementById('status-text');
const result = document.getElementById('result');

/* ---------- UI helpers ---------- */
function showThinkingOverlay() {
  thinkingOverlay.style.display = 'flex';
}

function hideThinkingOverlay() {
  thinkingOverlay.style.display = 'none';
}

/* ---------- Status helper ---------- */
function setStatus(msg) {
  try {
    if (statusText) statusText.textContent = msg;
    console.log('[Status]', msg);
  } catch (e) {
    console.log('[Status:fallback]', msg);
  }
}

/* ---------- Camera ---------- */
async function startCamera() {
  try {
    console.log('[Camera] Starting camera...');
    // Verify critical elements exist
    if (!video) {
      console.error('[Camera] Video element not found!');
      alert('Video element missing. Please reload the page.');
      return;
    }
    
    // Defensive clean-up before requesting a new stream
    try {
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
      }
    } catch (_) { /* no-op */ }
    
    video.srcObject = null;
    scanButton.style.display = 'none';
    
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    
    // Defensive camera initialization
    video.srcObject = stream;
    await video.play();
    
    video.style.display = 'block';
    overlay.style.display = 'block';
    captureButton.style.display = 'block';
    setStatus('Camera ready – frame the receipt');
    console.log('[Camera] Started successfully');
  } catch (error) {
    console.error('[Camera] Error:', error);
    alert('Camera access denied or unavailable.');
  }
}

function stopCamera() {
  try {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    }
    console.log('[Camera] Stopped');
  } catch (error) {
    console.error('[Camera] Error stopping camera:', error);
  }
}

/* ---------- OCR ---------- */
async function initializeOCR() {
  try {
    setStatus('Loading OCR engine...');
    worker = await createWorker('eng');
    console.log('[OCR] Tesseract worker ready');
  } catch (error) {
    console.error('[OCR] Initialization failed:', error);
    alert('OCR engine failed to load. Please reload the page.');
  }
}

async function captureAndScan() {
  if (!worker) {
    alert('OCR engine not ready yet. Please wait.');
    return;
  }

  try {
    console.log('[Capture] Taking snapshot...');
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    capturedImageData = canvas.toDataURL('image/png');

    stopCamera();
    overlay.style.display = 'none';
    captureButton.style.display = 'none';
    showThinkingOverlay();
    setStatus('Recognising text...');

    console.log('[OCR] Starting recognition...');
    const { data: { text, confidence } } = await worker.recognize(capturedImageData);
    hideThinkingOverlay();

    const finalText = text ? text.trim() : '';
    const finalConf = confidence ? confidence.toFixed(2) : 'N/A';

    if (finalText) {
      result.innerHTML = `Scanned text:<br>${finalText}`;
      
      // Send OCR result via Rabbit LLMHelpers
      console.log('[LLMHelpers] Attempting to send receipt via LLMHelpers...');
      const prompt = `You are an assistant. Please email the attached image to the recipient. Return valid JSON in this exact format: 

{"action":"email","to":"self","subject":"Scanned Receipt","body":"${finalText.replace(/"/g, '\\"').replace(/\n/g, '\\n')}","attachments":[{"dataUrl":"${capturedImageData}"}]}`;
      
      // Check for r1.messaging availability and initialize LLMHelpers
      if (typeof r1 !== 'undefined' && r1.messaging && typeof r1.messaging.sendPrompt === 'function') {
        try {
          const llmHelpers = new LLMHelpers(r1.messaging);
          await llmHelpers.performTask(prompt, false);
          console.log('[LLMHelpers] ✓ Receipt prompt sent successfully via LLMHelpers');
        } catch (err) {
          console.error('[LLMHelpers] Error sending prompt:', err);
        }
      } else {
        console.log('[LLMHelpers] r1.messaging not available – skipping email send');
      }
      
    } else {
      result.innerHTML = '⚠️ No text recognised. Please try again. Pay attention to lighting and focus.';
    }
    
    result.classList.add('has-content');
    result.style.display = 'block';
    video.style.display = 'none';
    captureButton.style.display = 'none';
    scanButton.style.display = 'block';
    scanButton.classList.remove('hidden');
    scanButton.textContent = 'Scan again';
    
    console.log('[OCR] Confidence:', finalConf);
  } catch (error) {
    console.error('[OCR] Recognition failed:', error);
    hideThinkingOverlay();
    result.innerHTML = '❌ OCR failed. Please try again.';
    result.style.display = 'block';
    video.style.display = 'none';
    captureButton.style.display = 'none';
    result.classList.add('has-content');
    overlay.style.display = 'none';
    stopCamera();
    scanButton.style.display = 'block';
    scanButton.classList.remove('hidden');
  }
}

/* ---------- Events ---------- */
scanButton.addEventListener('click', () => {
  result.innerHTML = '';
  result.style.display = 'none';
  result.classList.remove('has-content');
  console.log('[Event] Scan button clicked - restarting camera');
  // Ensure any previous stream is fully torn down before starting
  stopCamera(); // Stop existing camera stream first
  startCamera(); // Then start fresh camera preview
});

document.addEventListener('visibilitychange', () => {
  // If the tab becomes hidden, release camera to avoid OS-level locking
  if (document.hidden) {
    stopCamera();
  }
});

captureButton.addEventListener('click', captureAndScan);

/* ---------- Init ---------- */
initializeOCR();
