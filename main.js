/* Rabbit Receipt Scanner - Jens Special Edition */

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
    alert('Kamerazugriff fehlgeschlagen. Bitte Berechtigungen prüfen.');
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
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;

      // Grayscale und Kontrast
      const contrast = 1.2;
      const threshold = 170;

      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        let y = 0.299 * r + 0.587 * g + 0.114 * b;
        y = (y - 128) * contrast + 128;
        const val = y > threshold ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = val;
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = inputDataUrl;
  });
}

/* ---------- OCR ---------- */
// Präzise OCR-Initialisierung für Rechnungen in Deutsch und Englisch
async function initializeOCR() {
  try {
    statusText.textContent = 'Initialisiere OCR-Engine...';
    showThinkingOverlay();

    worker = await createWorker();

    statusText.textContent = 'Lade Sprachen...';
    await worker.loadLanguage('deu+eng');
    await worker.initialize('deu+eng');

    // LSTM, Block-Layout, stabile Leerzeichen, sinnvolle Whitelist
    await worker.setParameters({
      tessedit_ocr_engine_mode: '1',
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÄÖÜäöüß€$.,:-/()#% ',
      load_system_dawg: '1',
      load_freq_dawg: '1',
      textord_min_linesize: '2.5'
    });

    hideThinkingOverlay();
    console.log('[OCR] Worker initialized for invoices (deu+eng)');
  } catch (error) {
    console.error('[OCR] Failed to initialize:', error);
    hideThinkingOverlay();
    result.innerHTML = '❌ OCR Initialisierung fehlgeschlagen';
    result.style.display = 'block';
    result.classList.add('has-content');
  }
}

/* ---------- Invoice Extraction + Cleaning ---------- */
const CURRENCY_MAP = { '€': 'EUR', 'EUR': 'EUR', '$': 'USD', 'USD': 'USD', '£': 'GBP', 'GBP': 'GBP', 'CHF': 'CHF' };

function parseAmount(raw) {
  if (!raw) return null;
  let s = raw
    .replace(/\s/g, '')
    .replace(/[,](?=\d{3}\b)/g, '')
    .replace(/[.](?=\d{3}\b)/g, '')
    .replace(/,/, '.')
    .replace(/[^\d.\-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function detectCurrency(str) {
  if (!str) return null;
  for (const k of Object.keys(CURRENCY_MAP)) {
    if (new RegExp(`\\b${k}\\b`).test(str) || str.includes(k)) return CURRENCY_MAP[k];
  }
  return null;
}

function parseDateISO(str) {
  if (!str) return null;
  const m1 = str.match(/\b([0-3]?\d)[./-]([01]?\d)[./-]([12]\d{3})\b/);
  if (m1) return `${m1[3].padStart(4,'0')}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
  const m2 = str.match(/\b([12]\d{3})-([01]?\d)-([0-3]?\d)\b/);
  if (m2) return `${m2[1].padStart(4,'0')}-${m2[2].padStart(2,'0')}-${m2[3].padStart(2,'0')}`;
  const m3 = str.match(/\b([A-Za-z]{3,9})\s+([0-3]?\d),\s*([12]\d{3})\b/);
  if (m3) {
    const months = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
    const mo = months[m3[1].toLowerCase()];
    if (!mo) return null;
    return `${m3[3]}-${String(mo).padStart(2,'0')}-${String(m3[2]).padStart(2,'0')}`;
  }
  return null;
}

function extractInvoiceData(ocrText) {
  const lines = ocrText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const reAmountLoose = /(?:(EUR|USD|GBP|CHF)|[€$£])?\s*([+-]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})(?:\s*(EUR|USD|GBP|CHF)|\s*[€$£])?/i;
  const result = {
    invoiceNumber: null,
    date: null,
    net: null,
    vat: null,
    vatRate: null,
    gross: null,
    currency: null,
    sourceLines: {}
  };

  // Rechnungsnummer
  for (const l of lines) {
    const m = l.match(/\b(Rechnungs(?:nummer|nr\.?)|Beleg(?:nr\.?)?|Invoice(?:\s*(?:No\.|Number|#)?)|Inv\.\s*No\.?)\b[:\s]*([A-Za-z0-9\-_/]+)\b/i);
    if (m) { result.invoiceNumber = m[2]; result.sourceLines.invoiceNumber = l; break; }
  }
  if (!result.invoiceNumber) {
    for (const l of lines.slice(0, 12)) {
      const m = l.match(/\b([A-Z]{2,}\d{3,}[-/_]?\d*)\b/);
      if (m) { result.invoiceNumber = m[1]; result.sourceLines.invoiceNumber = l; break; }
    }
  }

  // Datum
  for (const l of lines) {
    if (/\b(Datum|Rechnungsdatum|Date|Invoice Date)\b/i.test(l)) {
      const iso = parseDateISO(l);
      if (iso) { result.date = iso; result.sourceLines.date = l; break; }
    }
  }
  if (!result.date) {
    for (const l of lines) {
      const iso = parseDateISO(l);
      if (iso) { result.date = iso; result.sourceLines.date = l; break; }
    }
  }

  // Beträge
  const findAmountAfterKeyword = (keywords) => {
    for (const l of lines) {
      if (new RegExp(`\\b(${keywords.join('|')})\\b`, 'i').test(l)) {
        const m = l.match(reAmountLoose);
        if (m) {
          const cur = detectCurrency(l) || CURRENCY_MAP[m[1]] || CURRENCY_MAP[m[3]] || result.currency;
          const val = parseAmount(m[2]);
          return { val, cur, line: l };
        }
      }
    }
    return null;
  };

  const netHit = findAmountAfterKeyword(['Netto', 'Zwischensumme', 'Subtotal', 'Sub total', 'Net total']);
  if (netHit && netHit.val != null) {
    result.net = netHit.val;
    result.currency = result.currency || netHit.cur;
    result.sourceLines.net = netHit.line;
  }

  for (const l of lines) {
    if (/\b(MwSt|MwSt\.|USt|VAT|Tax)\b(?!.*ID)/i.test(l)) {
      const rateMatch = l.match(/(\d{1,2}[.,]?\d?)\s*%/);
      if (rateMatch) result.vatRate = parseFloat(rateMatch[1].replace(',', '.'));
      const m = l.match(reAmountLoose);
      if (m) {
        const cur = detectCurrency(l) || CURRENCY_MAP[m[1]] || CURRENCY_MAP[m[3]] || result.currency;
        const val = parseAmount(m[2]);
        if (val != null) {
          result.vat = val;
          result.currency = result.currency || cur;
          result.sourceLines.vat = l;
        }
      }
    }
  }

  const grossHit = findAmountAfterKeyword(['Gesamtbetrag', 'Gesamt', 'Brutto', 'Total', 'Grand Total', 'Amount Due', 'Balance Due', 'To pay']);
  if (grossHit && grossHit.val != null) {
    result.gross = grossHit.val;
    result.currency = result.currency || grossHit.cur;
    result.sourceLines.gross = grossHit.line;
  }

  if (!result.currency) {
    for (const l of lines) { const cur = detectCurrency(l); if (cur) { result.currency = cur; break; } }
  }
  if (!result.currency) result.currency = 'EUR';

  if (result.net != null && result.gross != null && result.vat == null) {
    const v = +(result.gross - result.net).toFixed(2);
    if (v >= 0) result.vat = v;
  }
  if (result.vatRate == null && result.net != null && result.gross != null && result.net > 0) {
    const r = ((result.gross / result.net) - 1) * 100;
    const rRound = Math.round(r * 10) / 10;
    if (rRound >= 0 && rRound <= 25) result.vatRate = rRound;
  }
  if (result.gross == null && result.net != null && result.vat != null) {
    result.gross = +(result.net + result.vat).toFixed(2);
  }

  return result;
}

function renderInvoiceExtraction(data) {
  const rows = [
    ['Rechnungsnummer', data.invoiceNumber || '—'],
    ['Datum', data.date || '—'],
    ['Netto', data.net != null ? `${data.net.toFixed(2)} ${data.currency}` : '—'],
    ['MwSt', data.vat != null ? `${data.vat.toFixed(2)} ${data.currency}` : '—'],
    ['MwSt-Satz', data.vatRate != null ? `${data.vatRate}%` : '—'],
    ['Brutto', data.gross != null ? `${data.gross.toFixed(2)} ${data.currency}` : '—']
  ];
  return `<div style="font-family: Lexend; border:1px solid #eee; border-radius:12px; padding:12px;">
    <b>Rechnungsdaten</b>
    <div style="margin-top:8px;">
      ${rows.map(r => `<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px dashed #eee;">
        <span>${r[0]}</span><span><b>${r[1]}</b></span></div>`).join('')}
    </div>
  </div>`;
}

// OCR-Text säubern (gegen Artefakte und Kraut)
function cleanOcrText(raw) {
  if (!raw) return '';
  return raw
    .replace(/\u0000/g, '')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/[|]{2,}/g, ' ')
    .replace(/[_`~^]+/g, ' ')
    .replace(/[^\p{L}\p{N}\p{P}\p{Z}\r\n€$£%]/gu, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length >= 2 && /[A-Za-zÄÖÜäöüß0-9]/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------- HTML + Quoted-Printable (UTF-8) ---------- */
function buildBilingualEmailHTML(extracted, cleanedOcr) {
  const fmt = (n, cur) => n != null ? `${n.toFixed(2)} ${cur}` : '—';
  const esc = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  const de = `
  <h3 style="margin:0 0 8px 0;font-size:16px">Rechnungszusammenfassung</h3>
  <table cellspacing="0" cellpadding="0" style="border-collapse:collapse">
    <tr><td style="padding:2px 8px 2px 0">Nummer</td><td><b>${esc(extracted.invoiceNumber ?? '—')}</b></td></tr>
    <tr><td style="padding:2px 8px 2px 0">Datum</td><td><b>${esc(extracted.date ?? '—')}</b></td></tr>
    <tr><td style="padding:2px 8px 2px 0">Netto</td><td><b>${esc(fmt(extracted.net, extracted.currency))}</b></td></tr>
    <tr><td style="padding:2px 8px 2px 0">MwSt</td><td><b>${esc(fmt(extracted.vat, extracted.currency))}</b></td></tr>
    <tr><td style="padding:2px 8px 2px 0">MwSt-Satz</td><td><b>${esc(extracted.vatRate != null ? extracted.vatRate + '%' : '—')}</b></td></tr>
    <tr><td style="padding:2px 8px 2px 0">Brutto</td><td><b>${esc(fmt(extracted.gross, extracted.currency))}</b></td></tr>
  </table>
  <h4 style="margin:12px 0 6px 0;font-size:15px">Volltext (bereinigt)</h4>
  <pre style="white-space:pre-wrap;word-wrap:break-word;background:#fafafa;border:1px solid #eee;padding:8px;border-radius:8px">${esc(cleanedOcr)}</pre>`;

  const en = `
  <h3 style="margin:16px 0 8px 0;font-size:16px">Invoice summary</h3>
  <table cellspacing="0" cellpadding="0" style="border-collapse:collapse">
    <tr><td style="padding:2px 8px 2px 0">Number</td><td><b>${esc(extracted.invoiceNumber ?? '—')}</b></td></tr>
    <tr><td style="padding:2px 8px 2px 0">Date</td><td><b>${esc(extracted.date ?? '—')}</b></td></tr>
    <tr><td style="padding:2px 8px 2px 0">Net</td><td><b>${esc(fmt(extracted.net, extracted.currency))}</b></td></tr>
    <tr><td style="padding:2px 8px 2px 0">VAT</td><td><b>${esc(fmt(extracted.vat, extracted.currency))}</b></td></tr>
    <tr><td style="padding:2px 8px 2px 0">VAT rate</td><td><b>${esc(extracted.vatRate != null ? extracted.vatRate + '%' : '—')}</b></td></tr>
    <tr><td style="padding:2px 8px 2px 0">Gross</td><td><b>${esc(fmt(extracted.gross, extracted.currency))}</b></td></tr>
  </table>
  <h4 style="margin:12px 0 6px 0;font-size:15px">Full text (cleaned)</h4>
  <pre style="white-space:pre-wrap;word-wrap:break-word;background:#fafafa;border:1px solid #eee;padding:8px;border-radius:8px">${esc(cleanedOcr)}</pre>`;

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">${de}<hr style="margin:16px 0;border:none;border-top:1px solid #eee" />${en}</div>`;
}

// RFC 2045 quoted-printable Encoder (UTF-8), 76 Zeichen pro Zeile, Softbreak "="
function encodeQuotedPrintable(str) {
  const encoder = new TextEncoder(); // utf-8
  const bytes = encoder.encode(str);
  const safe = (b) => (b === 9 || b === 32 || (b >= 33 && b <= 60) || (b >= 62 && b <= 126)); // außer '='
  const hex = (b) => b.toString(16).toUpperCase().padStart(2, '0');

  let out = '';
  let lineLen = 0;
  const push = (s) => { out += s; lineLen += s.length; };

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    let token;

    if (b === 61 /* '=' */ || !safe(b)) token = '=' + hex(b);
    else token = String.fromCharCode(b);

    // Zeilenende muss Softbreak, wenn > 76
    if (lineLen + token.length > 75) { // 75, damit wir '=' + CRLF noch passen
      out += '=\r\n';
      lineLen = 0;
    }

    push(token);

    // harte Zeilenumbrüche im Input erhalten
    if (token === '\n') lineLen = 0;
  }

  // Space/Tab am Zeilenende müssen quoted werden
  out = out.replace(/[\t ](?=\r?\n)/g, (m) => '=' + hex(m.charCodeAt(0)));

  // CRLF normalisieren
  out = out.replace(/\r?\n/g, '\r\n');

  return out;
}

function buildRfc5322Body(html, charset = 'utf-8') {
  const qp = encodeQuotedPrintable(html);
  const headers =
    `Content-Transfer-Encoding: quoted-printable\r\n` +
    `Content-Type: text/html; charset=${charset}\r\n` +
    `Mime-Version: 1.0\r\n\r\n`;
  return headers + qp;
}

/* ---------- Mail + strikter Prompt ---------- */
async function sendStructuredEmail(extracted, cleanedOcr) {
  // 1) Sauberes HTML für die Mail
  const html = buildBilingualEmailHTML(extracted, cleanedOcr);
  const htmlMax = html.length > 200000 ? html.slice(0, 200000) : html;


  const envelope = {
    action: 'email',
    subject: 'your rabbit rece1pt scan',
    body: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${htmlMax}</body></html>`
  };


  const prompt =
    'You are an assistant. Please email the receipt text below to the recipient.\n' +
    'Return ONLY valid JSON. No markdown, no code fences, no commentary, no extra fields.\n' +
    'Output MUST be EXACTLY this JSON object (do not modify keys or values):\n' +
    JSON.stringify(envelope);

  const payload = {
    useLLM: true,
    message: prompt,
    imageDataUrl: capturedImageData // optional: Bild als Anhang
  };

  if (typeof PluginMessageHandler !== 'undefined') {
    PluginMessageHandler.postMessage(JSON.stringify(payload));
    console.log('[Email] Sent to AI via PluginMessageHandler');
  } else {
    throw new Error('Plugin API nicht verfügbar');
  }
}


/* ---------- Capture + OCR Pipeline ---------- */
async function captureAndScan() {
  try {
    console.log('[Capture] Taking snapshot...');

    const context = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const rawDataUrl = canvas.toDataURL('image/jpeg', 0.95);
    capturedImageData = rawDataUrl;

    overlay.style.display = 'none';
    stopCamera();

    statusText.textContent = 'Bereite OCR vor...';
    showThinkingOverlay();
    await new Promise(r => setTimeout(r, 150));

    // Preprocess
    statusText.textContent = 'Vorverarbeitung...';
    const preprocessedDataUrl = await preprocessOnCanvas(rawDataUrl);

    statusText.textContent = 'Analysiere Text...';
    await new Promise(r => setTimeout(r, 150));

    // Erstlauf
    const first = await worker.recognize(preprocessedDataUrl);
    const text1 = first.data?.text || '';
    const conf1 = first.data?.confidence ?? 0;

    let finalText = text1;
    let finalConf = conf1;

    // Fallback bei schwacher Confidence
    if (!text1.trim() || conf1 < 85) {
      console.log('[OCR] Low confidence or empty text, retrying with PSM 7 and DAWG on...');
      statusText.textContent = 'Verarbeitung mit optimierten Parametern...';

      await worker.setParameters({
        tessedit_pageseg_mode: '7',
        load_system_dawg: '1',
        load_freq_dawg: '1'
      });

      const harder = await preprocessOnCanvas(preprocessedDataUrl);
      const second = await worker.recognize(harder);
      const text2 = second.data?.text || '';
      const conf2 = second.data?.confidence ?? 0;

      if (text2.trim() && conf2 >= conf1) {
        finalText = text2;
        finalConf = conf2;
      } else {
        await worker.setParameters({
          tessedit_pageseg_mode: '6',
          load_system_dawg: '0',
          load_freq_dawg: '0'
        });
        const third = await worker.recognize(preprocessedDataUrl);
        const text3 = third.data?.text || '';
        const conf3 = third.data?.confidence ?? 0;
        if (text3.trim() && conf3 >= finalConf) {
          finalText = text3;
          finalConf = conf3;
        }
      }

      // Basis wiederherstellen
      await worker.setParameters({
        tessedit_pageseg_mode: '6',
        load_system_dawg: '1',
        load_freq_dawg: '1'
      });
    }

    hideThinkingOverlay();

    if (finalText && finalText.trim().length > 0) {
      // UI: OCR anzeigen
      result.innerHTML = `✓ OCR Ergebnis:<br><br>${finalText.replace(/\n/g, '<br>')}`;

      // Extraktion + Bereinigung
      const extracted = extractInvoiceData(finalText);
      const cleanedOcr = cleanOcrText(finalText);

      // UI: strukturierte Daten
      result.innerHTML += '<br><br>' + renderInvoiceExtraction(extracted);

      // Mail absenden (DE + EN, HTML, quoted-printable, UTF-8)
      await sendStructuredEmail(extracted, cleanedOcr);
    } else {
      result.innerHTML = '⚠️ Kein Text erkannt. Bitte erneut versuchen. Achte auf Licht und Fokus.';
    }

    result.classList.add('has-content');
    result.style.display = 'block';

    scanButton.style.display = 'block';
    scanButton.classList.remove('hidden');
    scanButton.textContent = 'Erneut scannen';

    console.log('[OCR] Confidence:', finalConf);

  } catch (error) {
    console.error('[OCR] Recognition failed:', error);
    hideThinkingOverlay();

    result.innerHTML = '❌ OCR fehlgeschlagen. Bitte erneut versuchen.';
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
  startCamera();
});

captureButton.addEventListener('click', captureAndScan);

/* ---------- Init ---------- */
initializeOCR();
