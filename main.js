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
  const dateRegex = /\b(\d{1,2}[\/. -]\d{1,2}[\/. -]\d{2,4})\b/;
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
  html += 'Extracted Invoice Data:<br />';
  html += `Vendor: ${data.vendor || 'N/A'}<br />`;
  html += `Date: ${data.date || 'N/A'}<br />`;
  html += `Total: ${data.total || 'N/A'}<br />`;
  if (data.items && data.items.length > 0) {
    html += 'Items:<ul style="margin:4px 0; padding-left:20px;">';
    data.items.forEach(it => {
      html += `${it.name}: ${it.price}`;
    });
    html += '</ul>';
  }
  html += '</div>';
  return html;
}

/* ---------- AI email routine (replaces Rabbit R1 rabbithole call) ---------- */
function sendToAIWithEmbeddedDataUrl(toEmail, subject, body, dataUrl) {
  console.log('[AI] Preparing payload for PluginMessageHandler...', { toEmail, subjectLength: subject?.length, bodyLength: body?.length, hasImage: !!dataUrl });

  
const prompt = `
You are an assistant. Please email the attached receipt image and OCR scan to the recipient. 
Return ONLY valid JSON in this exact format: 
{"action":"email","to":"${toEmail}","subject":"Receipt Scan","body":"OCR Text:\\n${ocrText}\\n\\nExtracted Data:\\nVendor: ${invoiceData.vendor || 'N/A'}\\nDate: ${invoiceData.date || 'N/A'}\\nTotal: ${invoiceData.total || 'N/A'}\\nItems: ${invoiceData.items && invoiceData.items.length ? invoiceData.items.map(it => it.name + ' - ' + it.price).join('; ') : 'N/A'}","attachments":[{"dataUrl":"${dataUrl}"}]}
`;

 
  
  const payload = {
    useLLM: true,
    message: prompt,
    imageDataUrl: dataUrl
  };

  if (typeof PluginMessageHandler !== 'undefined') {
    console.log('[AI] PluginMessageHandler available. Sending message...');
    try {
      PluginMessageHandler.postMessage(JSON.stringify(payload));
      setStatus('Sent to AI...');
      console.log('[AI] ✓ Payload sent to AI via PluginMessageHandler');
    } catch (err) {
      console.error('[AI] ❌ Failed to post message to PluginMessageHandler:', err);
      console.log('[AI] Payload (for debugging):', payload);
      setStatus('Plugin postMessage failed');
    }
  } else {
    setStatus('Plugin API not available');
    console.warn('[AI] PluginMessageHandler not available. Logging payload for debugging.');
    console.log('Payload:', payload);
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
    capturedImageData = canvas.toDataURL('image/jpeg', 0.7);
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
      result.innerHTML = `✓ OCR result:<br /><br />${finalText.replace(/\n/g, '<br />')}`;

      // Extract + clean
      const extracted = extractInvoiceData(finalText);
      const cleanedOcr = cleanOcrText(finalText);

      // UI: structured data
      result.innerHTML += '<br />' + renderInvoiceExtraction(extracted);

      // Build email subject/body with OCR text and extracted data
      const subject = 'Receipt scan and analysis';
      const bodyObj = {
        note: 'Attached is the receipt image. Below are OCR text and extracted data.',
        ocrText: cleanedOcr,
        extracted
      };
      const body = JSON.stringify(bodyObj).replace(/"/g, '\\"');

      console.log('[AI] Dispatching email task with attachment via PluginMessageHandler');
      try {
        // If you have an input for recipient, fetch it; otherwise leave a placeholder/to be filled later
        const toEmailInput = document.getElementById('emailInput');
        const to = (toEmailInput?.value || '').trim();
        const toEmail = to || 'recipient@example.com'; // fallback to placeholder
        setStatus('Preparing email...');
        sendToAIWithEmbeddedDataUrl(toEmail, subject, body, capturedImageData);
        console.log('[Capture] ✓ AI email task dispatched successfully');
      } catch (llmError) {
        console.error('[Capture] ⚠️ AI email task failed:', llmError);
        // Continue execution - don't fail the entire scan if AI send fails
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
