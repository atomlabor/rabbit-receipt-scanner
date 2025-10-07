// Rabbit Receipt Scanner for Rabbit R1 & modern browsers
// UX: Camera replaces scan button at same position, PTT & click trigger, auto OCR-Mail via LLM
// Device Controls via r1-create
// eslint-disable-next-line no-undef
import { deviceControls } from 'r1-create';

(function() {
  'use strict';

  // === STATE & DOM
  let stream = null, isScanning = false;
  let scanBtn, cameraContainer, video, statusInfo;
  let lastOCRText = '', lastImageDataUrl = '';

  // === INIT & EVENTS
  async function init() {
    scanBtn = document.getElementById('scanBtn');
    cameraContainer = document.getElementById('cameraContainer');
    video = document.getElementById('videoPreview');
    statusInfo = document.getElementById('statusInfo');

    if (!scanBtn || !cameraContainer || !video) {
      console.error('[INIT] Missing DOM elements');
      return;
    }

    // Initialize Rabbit R1 Device Controls
    try {
      if (deviceControls && typeof deviceControls.init === 'function') {
        await deviceControls.init({
          sideButtonEnabled: true,
          scrollWheelEnabled: true,
          keyboardFallback: true
        });
        // Side button triggers capture or start
        deviceControls.on('sideButton', () => {
          console.log('[DeviceControls] sideButton');
          if (cameraContainer.classList.contains('active')) capture();
          else startCamera();
        });
        // Scroll wheel: up -> start camera if not active; down -> capture if active
        deviceControls.on('scrollWheel', (dir) => {
          console.log('[DeviceControls] scrollWheel', dir);
          if (!cameraContainer.classList.contains('active') && dir === 'up') startCamera();
          if (cameraContainer.classList.contains('active') && dir === 'down') capture();
        });
        console.log('[INIT] deviceControls initialized');
      }
    } catch (e) {
      console.warn('[INIT] deviceControls not available:', e);
    }

    // Scan Button → Start Camera
    scanBtn.addEventListener('click', startCamera);

    // Camera Container → Capture on Click
    cameraContainer.addEventListener('click', capture);

    // Redundant HW listeners for broader SDK variants
    try {
      const rabbitHw = (typeof window !== 'undefined' && window.rabbit && rabbit.hardware);
      if (rabbitHw && typeof rabbitHw.on === 'function') {
        rabbitHw.on('sideClick', () => {
          console.log('[PTT] sideClick via rabbit.hardware.on');
          if (cameraContainer.classList.contains('active')) capture(); else startCamera();
        });
      }
    } catch (e) { console.error('[INIT] rabbit.hardware PTT init failed:', e); }
    try {
      const r1Hw = (typeof window !== 'undefined' && window.r1 && r1.hardware);
      if (r1Hw && typeof r1Hw.on === 'function') {
        r1Hw.on('sideClick', () => {
          console.log('[PTT] sideClick via r1.hardware.on');
          if (cameraContainer.classList.contains('active')) capture(); else startCamera();
        });
      }
    } catch (e) { console.error('[INIT] r1.hardware PTT init failed:', e); }

    updateStatus('Bereit zum Scannen');
  }

  // === START CAMERA (replaces button)
  async function startCamera() {
    try {
      updateStatus('Kamera wird gestartet...');

      const constraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };

      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;

      // Hide button, show camera at same position
      scanBtn.classList.add('hidden');
      cameraContainer.classList.add('active');

      updateStatus('Bereit — Klick/SideButton zum Auslösen');
    } catch (err) {
      console.error('[CAMERA] Start failed:', err);
      updateStatus('❌ Kamera-Fehler: ' + err.message);
      resetUI();
    }
  }

  // === CAPTURE IMAGE
  async function capture() {
    if (isScanning) return;
    isScanning = true;

    try {
      updateStatus('📸 Aufnahme...');

      // Create canvas and capture frame
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Stop camera
      stopCamera();

      // Convert to base64 (JPEG high quality for attachment visibility)
      lastImageDataUrl = canvas.toDataURL('image/jpeg', 0.95);

      // Run OCR with Tesseract.js
      updateStatus('🔍 OCR läuft (Tesseract)...');
      lastOCRText = await runOCR(lastImageDataUrl);

      // Display OCR results
      const preview = lastOCRText.substring(0, 50) || 'Kein Text erkannt';
      updateStatus('📄 OCR: ' + preview + '...');

      // Send mail and image message via Rabbit R1
      updateStatus('📧 Mail/Message wird versendet...');
      await Promise.all([
        sendReceiptMailViaLLM(lastOCRText, lastImageDataUrl),
        sendImageMessageToPlugin(lastOCRText, lastImageDataUrl)
      ]);

      updateStatus('✅ Scan & Versand abgeschlossen!');

      // Reset after 3 seconds
      setTimeout(resetUI, 3000);

    } catch (err) {
      console.error('[CAPTURE] Failed:', err);
      updateStatus('❌ Fehler: ' + err.message);
      setTimeout(resetUI, 3000);
    } finally {
      isScanning = false;
    }
  }

  // === OCR PROCESSING (Tesseract.js only)
  async function runOCR(imageDataUrl) {
    try {
      if (window.Tesseract) {
        const { data: { text } } = await Tesseract.recognize(imageDataUrl, 'deu', {
          logger: m => console.log('[OCR]', m),
          tessedit_pageseg_mode: 6,
          tessedit_ocr_engine_mode: 1,
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÄÖÜäöüß0123456789€,.:-',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300'
        });
        return text;
      } else {
        throw new Error('Tesseract.js not loaded');
      }
    } catch (err) {
      console.error('[OCR] Failed:', err);
      return '[OCR-Fehler: ' + err.message + ']';
    }
  }

  // === ANALYSIS & FORMATTING FOR EMAIL
  function analyzeAndFormatHTML(ocrText) {
    const text = (ocrText || '').replace(/\r/g, '').trim();

    // Extract numbers and amounts
    const numberRegex = /(?:(?<=\b)|^)\d{1,3}(?:[\.,]\d{3})*(?:[\.,]\d{2})?(?=\b)/g;
    const euroRegex = /(?:EUR|€)\s*\d{1,3}(?:[\.,]\d{3})*(?:[\.,]\d{2})/gi;
    const totalKeywords = /(summe|gesamt|total|betrag|zu zahlen|zu\s*zahlen)/i;
    const dateRegex = /\b(\d{1,2}[\.\/\-]\d{1,2}[\.\/\-]\d{2,4}|\d{4}[\-\/]\d{1,2}[\-\/]\d{1,2})\b/g;

    const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);

    // Find candidate totals: look for lines with keywords and currency/amounts
    let totals = [];
    for (const line of lines) {
      if (totalKeywords.test(line) || /EUR|€/i.test(line)) {
        const amounts = line.match(numberRegex) || [];
        const euros = line.match(euroRegex) || [];
        const candidates = euros.length ? euros : amounts;
        for (const c of candidates) {
          const n = parseAmount(c);
          if (!isNaN(n)) totals.push({ line, raw: c, value: n });
        }
      }
    }
    // Fallback: search whole text for EUR amounts
    if (!totals.length) {
      const euros = text.match(euroRegex) || [];
      for (const c of euros) {
        const n = parseAmount(c);
        if (!isNaN(n)) totals.push({ line: c, raw: c, value: n });
      }
    }

    // Choose max as probable total
    const totalBest = totals.sort((a,b) => b.value - a.value)[0] || null;

    // Collect all numeric amounts (unique by normalized string)
    const allNumbersRaw = Array.from(new Set((text.match(numberRegex) || []).map(s => s)));
    const allNumbers = allNumbersRaw
      .map(s => ({ raw: s, value: parseAmount(s) }))
      .filter(x => !isNaN(x.value))
      .sort((a,b) => b.value - a.value);

    // Dates
    const dates = Array.from(new Set(text.match(dateRegex) || []));

    // Keywords (simple nouns/words likely as concepts)
    const keywords = Array.from(new Set(
      text
        .replace(/[0-9€.,:\-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3)
        .slice(0, 30)
    ));

    // Build compact HTML body
    const emphasize = (s) => `<strong style="background:#fff3cd;padding:1px 3px;border-radius:2px">${escapeHtml(s)}</strong>`;

    const totalHTML = totalBest
      ? `${emphasize('Summe / Total (EUR)')}: ${emphasize(formatEUR(totalBest.value))}`
      : '<em>Keine Summe erkannt</em>';

    const numbersHTML = allNumbers.slice(0, 20).map(n => {
      const str = formatPossiblyEUR(n.value, text.includes('€') || /EUR/i.test(text));
      return `<li>${emphasize(str)}</li>`;
    }).join('');

    const datesHTML = dates.slice(0, 5).map(d => `<li>${emphasize(d)}</li>`).join('');

    const keywordsHTML = keywords.slice(0, 15).map(k => `<li>${escapeHtml(k)}</li>`).join('');

    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#111;">
        <h2 style="margin:0 0 8px;">Beleg-Scan – Auswertung</h2>
        <section style="margin:6px 0;">
          <div style="font-size:16px;margin:6px 0;">${totalHTML}</div>
        </section>
        <section style="margin:6px 0;">
          <h3 style="margin:6px 0;">Zahlen (erkannt)</h3>
          <ul style="margin:4px 0 0 16px;">${numbersHTML || '<li><em>Keine Zahlen erkannt</em></li>'}</ul>
        </section>
        <section style="margin:6px 0;">
          <h3 style="margin:6px 0;">Datum</h3>
          <ul style="margin:4px 0 0 16px;">${datesHTML || '<li><em>Kein Datum erkannt</em></li>'}</ul>
        </section>
        <section style="margin:6px 0;">
          <h3 style="margin:6px 0;">Sachworte</h3>
          <ul style="margin:4px 0 0 16px;">${keywordsHTML || '<li><em>Keine Sachworte erkannt</em></li>'}</ul>
        </section>
        <section style="margin:8px 0;">
          <h3 style="margin:6px 0;">Scan (JPEG)</h3>
          <p style="margin:4px 0;font-size:12px;color:#444;">Der Anhang enthält das sichtbare JPEG des gescannten Belegs.</p>
        </section>
      </div>`;

    return { html, total: totalBest ? totalBest.value : null };
  }

  function parseAmount(s) {
    if (!s) return NaN;
    const str = ('' + s).replace(/[^0-9,.-€EUR]/gi, '').replace(/EUR|€/gi, '').trim();
    const hasDot = str.includes('.');
    const hasComma = str.includes(',');
    let normalized = str;
    if (hasDot && hasComma) {
      normalized = str.replace(/\./g, '').replace(/,/g, '.');
    } else if (hasComma && !hasDot) {
      normalized = str.replace(/,/g, '.');
    }
    const num = parseFloat(normalized);
    return num;
  }

  function formatEUR(n) {
    try {
      return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
    } catch {
      return `${n.toFixed(2)} €`;
    }
  }

  function formatPossiblyEUR(n, likelyEUR) {
    return likelyEUR ? formatEUR(n) : n.toFixed(2);
  }

  function escapeHtml(s) {
    return (s + '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function dataUrlToBase64(dataUrl) {
    return (dataUrl || '').split(',')[1] || '';
  }

  // === SEND MAIL VIA RABBIT LLM WITH PLUGINMESSAGEHANDLER
  async function sendReceiptMailViaLLM(ocrText, imageDataUrl) {
    try {
      // Ensure JPEG data URL and file name .jpg
      let dataUrl = imageDataUrl || '';
      if (!dataUrl.startsWith('data:image/jpeg')) {
        try {
          const img = new Image();
          img.src = dataUrl;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          const cx = c.getContext('2d');
          cx.drawImage(img, 0, 0);
          dataUrl = c.toDataURL('image/jpeg', 0.95);
        } catch (e) {
          console.warn('[MAIL] Could not convert to JPEG, using original');
        }
      }

      const timestamp = new Date().toLocaleString('de-DE');
      const subject = '🧾 Receipt Scan ' + timestamp;

      // Build HTML body with analysis
      const analysis = analyzeAndFormatHTML(ocrText);
      const bodyHtml = `
        <div>
          <p style="margin:0 0 8px; color:#333;">Receipt gescannt am ${escapeHtml(timestamp)}</p>
          ${analysis.html}
          <hr style="border:none; border-top:1px solid #eee; margin:12px 0;"/>
          <details style="font-size:12px; color:#555;">
            <summary>Original OCR-Text</summary>
            <pre style="white-space:pre-wrap;">${escapeHtml(ocrText || '')}</pre>
          </details>
        </div>`;

      const attachmentName = `receipt-scan-${Date.now()}.jpg`;

      // Prefer rabbit.llm.sendMailToSelf if available
      if (window.rabbit && rabbit.llm && typeof rabbit.llm.sendMailToSelf === 'function') {
        await rabbit.llm
