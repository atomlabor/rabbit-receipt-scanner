/* Rabbit Receipt Scanner */
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
    
    // Explicitly play the video - critical for preview to appear
    try {
      video.style.display = 'block';
      await video.play();
      video.style.display = 'block';
      console.log('[Camera] Video playback started');
    } catch (playErr) {
      console.warn('[Camera] video.play() threw:', playErr);
      // Some browsers might require user gesture; just log and proceed
    }
    
    overlay.style.display = 'flex';
    captureButton.style.display = 'block';
    console.log('[Camera] Camera started and preview visible');
  } catch (error) {
    console.error('[Camera] Failed to start camera:', error);
    alert('Camera access denied or unavailable. Please check your permissions.');
    scanButton.style.display = 'block';
  }
}
function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => {
      try {
        track.stop();
        console.log('[Camera] Track stopped:', track.label);
      } catch (e) {
        console.warn('[Camera] Error stopping track:', e);
      }
    });
    stream = null;
  }
  if (video) {
    video.srcObject = null;
  }
  overlay.style.display = 'none';
  console.log('[Camera] Camera stopped and overlay hidden');
}
/* ---------- OCR ---------- */
async function initializeOCR() {
  try {
    setStatus('Preparing OCR engine...');
    console.log('[OCR] Creating worker...');
    worker = await createWorker('deu+eng');
    console.log('[OCR] Worker ready');
    setStatus('Ready to scan receipts');
  } catch (error) {
    console.error('[OCR] Initialization failed:', error);
    setStatus('OCR initialization failed');
  }
}
/* ---------- Rabbit R1 API helper (JSON over Bluetooth) ---------- */
// Modified function to send email via LLM with embedded data URL
function sendToAIWithEmbeddedDataUrl(toEmail, dataUrl) {
  const prompt = `You are my assistant. Please analyse the image for me and then send the result, the text in the image, by email to the recipient. Send the OCR. Return valid JSON in this exact format: {"action":"email","to":"${toEmail}","subject":"your scan","body":"Here is your receipt info:","attachments":[{"dataUrl":"${dataUrl}"}]}`;
  
  const payload = {
    useLLM: true,
    message: prompt,
    imageDataUrl: dataUrl
  };
  
  console.log('[AI] Sending payload to PluginMessageHandler:', payload);
  
  try {
    PluginMessageHandler.postMessage(JSON.stringify(payload));
    console.log('[AI] Message posted successfully');
    return true;
  } catch (error) {
    console.error('[AI] Failed to post message:', error);
    return false;
  }
}
function buildEnvelope(toEmail, subject, bodyObj, dataUrl) {
  return {
    to: toEmail || 'self',
    subject,
    body: bodyObj,
    attachments: dataUrl ? [{ filename: '', contentType: 'image/jpeg', dataUrl }] : []
  };
}
/* ---------- Capture & OCR ---------- */
async function captureAndScan() {
  try {
    if (!stream || !video.srcObject) {
      console.warn('[Capture] No active camera stream');
      alert('No camera active. Please start scanning first.');
      return;
    }
    
    console.log('[Capture] Capturing frame...');
    const context = canvas.getContext('2d');
    canvas.width = video.videoWidth || 240;
    canvas.height = video.videoHeight || 282;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    capturedImageData = canvas.toDataURL('image/jpeg', 0.9);
    console.log('[Capture] Image captured, data URL length:', capturedImageData.length);
    
    stopCamera();
    
    // Show thinking overlay
    showThinkingOverlay();
    setStatus('Recognising text...');
    
    console.log('[OCR] Starting recognition...');
    const { data: { text, confidence } } = await worker.recognize(canvas);
    const finalConf = (confidence || 0).toFixed(1);
    console.log('[OCR] Recognition complete:', { textLength: text.length, confidence: finalConf });
    
    hideThinkingOverlay();
    
    const cleanedText = (text || '').trim();
    
    if (cleanedText.length > 0) {
      // Build structured body (plaintext + HTML)
      const subject = 'Receipt scanned via Rabbit App';
      const bodyObj = {
        text: `Receipt Data:\n\n${cleanedText}\n\n(OCR confidence: ${finalConf}%)`,
        html: `<pre style="white-space: pre-wrap; word-break: break-word;">Receipt Data:\n\n${cleanedText}\n\n(OCR confidence: ${finalConf}%)</pre>`
      };
      
      result.innerHTML = `
        <div style="padding: 20px; background: white; border-radius: 8px;">
          <h3>Receipt recognised:</h3>
          <pre style="white-space: pre-wrap; word-break: break-word;">${cleanedText}</pre>
          <small style="color: #999;">(OCR confidence: ${finalConf}%)</small>
        </div>
      `;
      
      console.log('[Capture] Preparing email to user...');
      
      // Get recipient email and send via LLM
      const toEmailInput = document.getElementById('emailInput');
      const toRaw = (toEmailInput?.value || '').trim();
      const toEmail = toRaw || 'self';
      
      console.log('[AI] Dispatching email via LLM with embedded data URL');
      const sent = sendToAIWithEmbeddedDataUrl(toEmail, capturedImageData);
      
      if (!sent) {
        console.log('[AI] Failed to send message');
      }
      
      console.log('[Capture] ✓ AI email task dispatched');
      
      // NEW: Also trigger LLM-based receipt analysis
      console.log('[LLM-Analysis] Triggering structured receipt analysis...');
      const analysisTriggered = analyseReceiptImageWithLLM(capturedImageData);
      
      if (analysisTriggered) {
        console.log('[LLM-Analysis] ✓ Receipt analysis task dispatched to LLM');
      } else {
        console.log('[LLM-Analysis] Failed to trigger analysis');
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
