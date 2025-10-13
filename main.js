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
      await video.play();
      console.log('[Camera] Video.play() succeeded');
    } catch (playError) {
      console.warn('[Camera] Video.play() failed, trying without await:', playError);
      video.play();
    }
    
    video.style.display = 'block';
    captureButton.style.display = 'block';
    
    console.log('[Camera] Camera started successfully, preview visible');
    console.log('[Camera] Video element state:', {
      srcObject: !!video.srcObject,
      display: video.style.display,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      paused: video.paused
    });
  } catch (error) {
    console.error('[Camera] Failed to start]:', error);
    alert('Camera access failed. Please check permissions.');
    scanButton.style.display = 'block';
    // Ensure we clear any partial state
    video.srcObject = null;
  }
}
function stopCamera() {
  try {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  } catch (_) { /* no-op */ }
  
  // Defensive: clear video element regardless of stream existence
  if (video) {
    video.srcObject = null;
    video.style.display = 'none';
    video.pause();
  }
  captureButton.style.display = 'none';
  overlay.style.display = 'none';
  console.log('[Camera] Camera stopped');
}
/* ---------- OCR ---------- */
async function initializeOCR() {
  try {
    console.log('[OCR] Initializing Tesseract worker...');
    worker = await createWorker('eng');
    console.log('[OCR] Worker ready');
  } catch (error) {
    console.error('[OCR] Failed to initialize:', error);
    alert('OCR initialization failed. Please reload.');
  }
}
function cleanOcrText(raw) {
  return raw
    .replace(/[^a-zA-Z0-9\s.,€$£¥:-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function extractInvoiceData(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let total = null;
  let date = null;
  let vendor = lines[0] || 'Unknown';
  const items = [];
  const totalRegex = /(?:total|sum|amount|gesamt)[:\s]*([€$£¥]?\s*[\d.,]+)/i;
  const dateRegex = /\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b/;
  const itemRegex = /([a-z\s]+)\s+([€$£¥]?\s*[\d.,]+)/i;
  for (const line of lines) {
    const tm = line.match(totalRegex);
    if (tm) total = tm[1].trim();
    const dm = line.match(dateRegex);
    if (dm) date = dm[1];
    const im = line.match(itemRegex);
    if (im && !tm) {
      items.push({ name: im[1].trim(), price: im[2].trim() });
    }
  }
  return { vendor, date, total, items };
}
function renderInvoiceExtraction(data) {
  let html = '<div style="margin-top:12px; padding:12px; background:#f9f9f9; border-radius:8px;">';
  html += 'Extracted Invoice Data:<br/>';
  html += `Vendor: ${data.vendor || 'N/A'}<br/>`;
  html += `Date: ${data.date || 'N/A'}<br/>`;
  html += `Total: ${data.total || 'N/A'}<br/>`;
  if (data.items && data.items.length > 0) {
    html += 'Items:<ul style="margin:4px 0; padding-left:20px;">';
    data.items.forEach(it => {
      html += `<li>${it.name}: ${it.price}</li>`;
    });
    html += '</ul>';
  }
  html += '</div>';
  return html;
}
function sendOCRTextViaLLM(invoiceData, ocrText) {
  console.log('[LLM] sendOCRTextViaLLM called with:', { invoiceData, ocrText });
  
  try {
    // Validate inputs
    if (!invoiceData) {
      console.error('[LLM] Missing invoiceData parameter');
      throw new Error('Invoice data is required');
    }
    if (!ocrText || typeof ocrText !== 'string') {
      console.error('[LLM] Invalid or missing ocrText parameter');
      throw new Error('Valid OCR text is required');
    }
    
    console.log('[LLM] Building prompt for Rabbit R1 assistant...');
    
    // Construct the comprehensive prompt with embedded OCR and invoice data
    const prompt = `You are the assistant. Send me the result of the OCR and analysis of the image content via email.

OCR Text:
${ocrText}

Extracted Invoice Data (JSON):
${JSON.stringify(invoiceData, null, 2)}`;
    
    console.log('[LLM] Prompt constructed:', prompt);
    console.log('[LLM] Checking window.rabbithole availability...');
    
    // Check if rabbithole API is available
    if (!window.rabbithole) {
      const errorMsg = '[LLM] window.rabbithole is not available - Rabbit R1 API not found';
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    if (typeof window.rabbithole.sendMessageToR1 !== 'function') {
      const errorMsg = '[LLM] window.rabbithole.sendMessageToR1 is not a function';
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    console.log('[LLM] Sending prompt to Rabbit R1 via window.rabbithole.sendMessageToR1...');
    
    // Send the prompt-based task to Rabbit R1 assistant
    window.rabbithole.sendMessageToR1(prompt);
    
    console.log('[LLM] ✓ Message successfully sent to Rabbit R1 assistant');
    console.log('[LLM] ✓ LLM task dispatched - assistant will process OCR and send email');
    
  } catch (error) {
    // Comprehensive error handling with detailed logging
    console.error('[LLM] ❌ Failed to send message to Rabbit R1:', error);
    console.error('[LLM] Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    console.error('[LLM] Context at time of error:', {
      hasRabbithole: !!window.rabbithole,
      hasFunction: !!(window.rabbithole && window.rabbithole.sendMessageToR1),
      invoiceDataPresent: !!invoiceData,
      ocrTextPresent: !!ocrText,
      ocrTextLength: ocrText ? ocrText.length : 0
    });
    
    // Re-throw to allow caller to handle if needed
    throw error;
  }
}
/* ---------- Capture + Scan ---------- */
async function captureAndScan() {
  try {
    if (!stream) {
      console.warn('[Capture] No active stream');
      return;
    }
    overlay.style.display = 'block';
    await new Promise(r => setTimeout(r, 100));
    const context = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    stopCamera();
    overlay.style.display = 'none';
    capturedImageData = canvas.toDataURL('image/png');
    console.log('[Capture] Image captured');
    showThinkingOverlay();
    const { data: { text, confidence } } = await worker.recognize(canvas);
    let finalText = text;
    let finalConf = confidence;
    if (confidence < 60) {
      console.log('[OCR] Low confidence, adjusting parameters...');
      await worker.setParameters({
        tessedit_pageseg_mode: '3',
        preserve_interword_spaces: '0',
        load_system_dawg: '1',
        load_freq_dawg: '1'
      });
    }
    hideThinkingOverlay();
    if (finalText && finalText.trim().length > 0) {
      // UI: OCR result
      result.innerHTML = `✓ OCR result:<br/><br/>${finalText.replace(/\n/g, '<br/>')}`;
      // Extract + clean
      const extracted = extractInvoiceData(finalText);
      const cleanedOcr = cleanOcrText(finalText);
      // UI: structured data
      result.innerHTML += '<br/>' + renderInvoiceExtraction(extracted);
      // LLM trigger: Immediately after successful OCR & extraction
      // Sends prompt-based LLM task to Rabbit R1 assistant with embedded OCR and invoice data
      console.log('[Capture] Triggering LLM assistant with OCR results...');
      try {
        sendOCRTextViaLLM(extracted, cleanedOcr);
        console.log('[Capture] ✓ LLM assistant task dispatched successfully');
      } catch (llmError) {
        console.error('[Capture] ⚠️ LLM assistant task failed:', llmError);
        // Continue execution - don't fail the entire scan if LLM send fails
      }
    } else {
      result.innerHTML = '⚠️ No text recognised. Please try again. Pay attention to lighting and focus.';
    }
    result.classList.add('has-content');
    result.style.display = 'block';
    scanButton.style.display = 'block';
    scanButton.classList.remove('hidden');
    scanButton.textContent = 'Scan again';
    console.log('[OCR] Confidence:', finalConf);
  } catch (error) {
    console.error('[OCR] Recognition failed:', error);
    hideThinkingOverlay();
    result.innerHTML = '❌ OCR failed. Please try again.';
    result.style.display = 'block';
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
