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
    scanButton.style.display = 'none';
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    video.srcObject = stream;
    video.style.display = 'block';
    captureButton.style.display = 'block';
    console.log('[Camera] Camera started successfully');
  } catch (error) {
    console.error('[Camera] Failed to start:', error);
    alert('Camera access failed. Please check permissions.');
    scanButton.style.display = 'block';
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    video.style.display = 'none';
    captureButton.style.display = 'none';
    console.log('[Camera] Camera stopped');
  }
}

/* ---------- Lightweight image preprocessing on canvas ----------
   Ziel: stabilere OCR bei Handyfotos von Rechnungen
   Schritte: Crop auf Frame, Grayscale, leichte Kontrastanhebung, sanfter Threshold
*/
function preprocessOnCanvas(inputDataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // 1) Canvas Dimensionen & Crop
      const frameRect = {
        x: Math.round(overlay.offsetLeft),
        y: Math.round(overlay.offsetTop),
        w: Math.round(overlay.offsetWidth),
        h: Math.round(overlay.offsetHeight)
      };
      canvas.width = frameRect.w;
      canvas.height = frameRect.h;
      const ctx = canvas.getContext('2d');
      // 2) Crop auf Frame
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
      // 3) Pixel Data holen
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      // 4) Grayscale conversion (standard Luma)
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        d[i] = d[i + 1] = d[i + 2] = gray;
      }
      // 5) Leichte Kontrastanhebung (Stretch auf [0..255])
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
      // 6) Sanfter Threshold (Median-inspiriert)
      const grays = [];
      for (let i = 0; i < d.length; i += 4) {
        grays.push(d[i]);
      }
      grays.sort((a, b) => a - b);
      const medianGray = grays[Math.floor(grays.length / 2)];
      const thresholdValue = Math.max(100, medianGray - 10);
      for (let i = 0; i < d.length; i += 4) {
        const val = d[i];
        const bw = val > thresholdValue ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = bw;
      }
      ctx.putImageData(imageData, 0, 0);
      // 7) finale DataURL
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
    .replace(/[^\x20-\x7E\xC0-\xFF]/g, '')
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
    const dateMatch = line.match(/(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/);
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
  let html = '<div style="margin-top:1em; padding:0.5em; background:#f9f9f9; border-radius:4px;">';
  html += '<strong>Extracted data:</strong><br/>';
  if (data.merchant) html += `Merchant: ${data.merchant}<br/>`;
  if (data.date) html += `Date: ${data.date}<br/>`;
  if (data.total) html += `Total: ${data.total}<br/>`;
  html += '</div>';
  return html;
}

async function sendStructuredEmail(extracted, cleanedOcr) {
  const subject = 'Receipt Scan';
  const bodyLines = [];
  bodyLines.push('Receipt Data:');
  bodyLines.push('');
  if (extracted.merchant) bodyLines.push(`Merchant: ${extracted.merchant}`);
  if (extracted.date) bodyLines.push(`Date: ${extracted.date}`);
  if (extracted.total) bodyLines.push(`Total: ${extracted.total}`);
  bodyLines.push('');
  bodyLines.push('Full OCR Text:');
  bodyLines.push(cleanedOcr);
  const body = bodyLines.join('\n');
  const mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailtoLink;
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
      // UI: OCR anzeigen
      result.innerHTML = `✓ OCR result:<br/><br/>${finalText.replace(/\n/g, '<br/>')}`;
      // Extraktion + Bereinigung
      const extracted = extractInvoiceData(finalText);
      const cleanedOcr = cleanOcrText(finalText);
      // UI: strukturierte Daten
      result.innerHTML += '<br/>' + renderInvoiceExtraction(extracted);
      // Mail absenden (DE + EN, HTML, quoted-printable, UTF-8)
      await sendStructuredEmail(extracted, cleanedOcr);
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
  stopCamera(); // Stop existing camera stream first
  startCamera(); // Then start fresh camera preview
});

captureButton.addEventListener('click', captureAndScan);

/* ---------- Init ---------- */
initializeOCR();
