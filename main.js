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
    video.srcObject = stream;
    video.style.display = 'block';
    captureButton.style.display = 'block';
    console.log('[Camera] Camera started successfully');
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
  video.srcObject = null;
  video.style.display = 'none';
  captureButton.style.display = 'none';
  console.log('[Camera] Camera stopped');
}
/* ---------- Lightweight image preprocessing on canvas ----------
   Goal: more stable OCR on mobile receipt photos
   Steps: Crop to frame, Grayscale, gentle contrast boost, soft threshold
*/
function preprocessOnCanvas(inputDataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // 1) Canvas size & crop
      const frameRect = {
        x: Math.round(overlay.offsetLeft),
        y: Math.round(overlay.offsetTop),
        w: Math.round(overlay.offsetWidth),
        h: Math.round(overlay.offsetHeight)
      };
      canvas.width = frameRect.w;
      canvas.height = frameRect.h;
      const ctx = canvas.getContext('2d');
      // 2) Crop to frame
      ctx.drawImage(
        img,
        frameRect.x,
        frameRect.y,
        frameRect.w,
        frameRect.h,
        0,
        0,
        frameRect.w,
        frameRect.h
      );
      // 3) Get pixel data
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      // 4) Grayscale (Luma)
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        d[i] = d[i + 1] = d[i + 2] = gray;
      }
      // 5) Contrast stretch
      let min = 255;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) {
        const val = d[i];
        if (val < min) min = val;
        if (val > max) max = val;
      }
      const range = max - min || 1;
      for (let i = 0; i < d.length; i += 4) {
        const oldVal = d[i];
        const newVal = Math.round(((oldVal - min) / range) * 255);
        d[i] = d[i + 1] = d[i + 2] = newVal;
      }
      // 6) Soft threshold
      const grays = [];
      for (let i = 0; i < d.length; i += 4) grays.push(d[i]);
      grays.sort((a, b) => a - b);
      const medianGray = grays[Math.floor(grays.length / 2)];
      const thresholdValue = Math.max(100, medianGray - 10);
      for (let i = 0; i < d.length; i += 4) {
        const val = d[i];
        const bw = val > thresholdValue ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = bw;
      }
      ctx.putImageData(imageData, 0, 0);
      // 7) Final data URL
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = inputDataUrl;
  });
}
function captureImage() {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = video.videoWidth;
  tempCanvas.height = video.videoHeight;
  const ctx = tempCanvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  return tempCanvas.toDataURL('image/png');
}
async function captureAndScan() {
  try {
    overlay.style.display = 'block';
    capturedImageData = captureImage();
    stopCamera();
    scanButton.style.display = 'none';
    showThinkingOverlay();
    await performOCR(capturedImageData);
  } catch (error) {
    console.error('[Capture] Failed:', error);
    hideThinkingOverlay();
    alert('Capture failed. Please try again.');
    scanButton.style.display = 'block';
  }
}
async function initializeOCR() {
  try {
    console.log('[OCR] Initializing...');
    worker = await createWorker('deu+eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const pct = Math.round(m.progress * 100);
          statusText.textContent = `Analysing receipt... ${pct}%`;
        }
      }
    });
    console.log('[OCR] Worker ready');
  } catch (error) {
    console.error('[OCR] Initialization failed:', error);
    alert('OCR initialization failed.');
  }
}
function cleanOcrText(text) {
  return text
    .replace([^\x20-\x7E\xC0-\xFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function extractInvoiceData(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let total = '';
  let date = '';
  let merchant = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/total|summe|gesamt|betrag/i.test(line)) {
      const match = line.match(/([0-9]+[.,][0-9]{2})/);
      if (match) total = match[1];
    }
    const dateMatch = line.match(/(\d{1,2}[\.|\/-]\d{1,2}[\.|\/-]\d{2,4})/);
    if (dateMatch && !date) date = dateMatch[1];
    if (i === 0 || i === 1) {
      if (!merchant && line.length < 50 && line.length > 2) {
        merchant = line;
      }
    }
  }
  return { total, date, merchant };
}
function renderInvoiceExtraction(data) {
  let html = '<div node="_210" style="margin-top:1em; padding:0.5em; background:#f9f9f9; border-radius:4px;">';
  html += 'Extracted data:<br />';
  if (data.merchant) html += `Merchant: ${data.merchant}<br />`;
  if (data.date) html += `Date: ${data.date}<br />`;
  if (data.total) html += `Total: ${data.total}<br />`;
  html += '</div>';
  return html;
}
/* ---------- Rabbit R1-first: PluginMessageHandler LLM trigger ---------- */
// Replace previous desktop mailto with a single Rabbit R1 LLM message.
// Uses PluginMessageHandler only. Sends both OCR text and extracted analysis in one prompt.
function sendOCRTextViaLLM(extracted, cleanedOcr) {
  try {
    // Build a clear, single LLM task prompt for Rabbit R1
    const prompt = [
      'You are the assistant. Send me the result of the OCR and the analysis of the image content via email.',
      '',
      '--- OCR Text ---',
      cleanedOcr,
      '',
      '--- Extracted Invoice Data (JSON) ---',
      JSON.stringify(extracted, null, 2)
    ].join('\n');
    // Rabbit R1 PluginMessageHandler payload
    const message = {
      type: 'rabbit.llm.task',
      payload: {
        prompt,
        meta: {
          source: 'rabbit-receipt-scanner',
          version: 'R1-first-llm-mail-trigger-1',
          timestamp: new Date().toISOString()
        }
      }
    };
    // Send to Rabbit R1 via PluginMessageHandler (no desktop mailto fallback)
    if (window.PluginMessageHandler && typeof window.PluginMessageHandler.postMessage === 'function') {
      window.PluginMessageHandler.postMessage(JSON.stringify(message));
      console.log('[Rabbit R1] LLM task dispatched via PluginMessageHandler');
    } else {
      // Intentionally no desktop fallback per requirements
      console.warn('[Rabbit R1] PluginMessageHandler not available; no desktop mailto fallback.');
    }
  } catch (err) {
    console.error('[Rabbit R1] Failed to build/send LLM task:', err);
  }
}
async function performOCR(imageDataUrl) {
  try {
    console.log('[OCR] Starting recognition...');
    statusText.textContent = 'Analysing receipt...';
    const preprocessedDataUrl = await preprocessOnCanvas(imageDataUrl);
    console.log('[OCR] Preprocessing done');
    overlay.style.display = 'none';
    const { data } = await worker.recognize(preprocessedDataUrl);
    let finalText = data.text;
    let finalConf = data.confidence;
    if (finalConf < 65) {
      console.log('[OCR] Low confidence, retrying with different settings...');
      statusText.textContent = 'Low quality, trying harder...';
      await worker.setParameters({
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1',
        load_system_dawg: '1',
        load_freq_dawg: '1'
      });
      const retry = await worker.recognize(preprocessedDataUrl);
      if (retry.data.confidence > finalConf) {
        finalText = retry.data.text;
        finalConf = retry.data.confidence;
      }
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
      // LLM trigger: Immediately after successful OCR & extraction
      // Sends both OCR text and extracted invoice object in one prompt to Rabbit R1
      sendOCRTextViaLLM(extracted, cleanedOcr);
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
