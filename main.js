(function() {
  'use strict';
  // --- DOM References ---
  const scanBtn = document.getElementById('scanBtn');
  const cameraContainer = document.getElementById('cameraContainer');
  const statusEl = document.getElementById('statusInfo');
  let video = document.getElementById('videoPreview');
  let isScanning = false;
  let lastImageDataUrl = '';
  let lastOCRText = '';

  // --- Utils
  function hasR1CameraAPI() {
    return window.r1 && r1.camera && typeof r1.camera.capturePhoto === 'function';
  }

  function updateStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
    console.log('[Status]', msg);
  }

  async function normalizeToDataUrl(input) {
    if (typeof input === 'string' && input.startsWith('data:')) return input;
    if (input instanceof Blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(input);
      });
    }
    throw new Error('Unsupported photo format');
  }

  function resetUI() {
    isScanning = false;
    if (scanBtn) scanBtn.style.display = 'flex';
    if (cameraContainer) cameraContainer.classList.remove('active');
    if (video) {
      video.removeEventListener('click', capture);
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
      }
    }
    updateStatus('Bereit zum Scannen');
  }

  // --- OCR postprocessing helpers
  function extractStructuredFields(ocrText) {
    const text = (ocrText || '').replace(/\t/g, ' ').replace(/\r/g, '');
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let amountLine = '', amount = '', date = '', shop = '';
    // Amount
    const amountRegexes = [
      /(?:(gesamt|summe|betrag|total|zu zahlen|endbetrag)\s*[:\-]?)\s*([+-]?[0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?\s*(?:€|eur)?)/i,
      /([+-]?[0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?)\s*(€|eur)/i
    ];
    for (const line of lines) {
      for (const rx of amountRegexes) {
        const m = line.match(rx);
        if (m) {
          amountLine = line;
          amount = (m[2] || m[1] || '').toString().trim();
          if (!/[€]/.test(amount) && /€|eur/i.test(line)) amount += ' €';
          break;
        }
      }
      if (amount) break;
    }
    // Date
    const dateRegexes = [
      /(\b\d{1,2}[\.\-/]\d{1,2}[\.\-/]\d{2,4}\b)/,
      /(\b\d{4}[\-\/.]\d{2}[\-\/.]\d{2}\b)/
    ];
    for (const line of lines) {
      for (const rx of dateRegexes) {
        const m = line.match(rx);
        if (m) { date = m[1]; break; }
      }
      if (date) break;
    }
    // Shop name
    for (const line of lines.slice(0, 6)) {
      const letters = line.replace(/[^A-Za-zÄÖÜäöüß\s\-\.&]/g, '');
      const digitRatio = (line.replace(/\D/g, '').length) / Math.max(1, line.length);
      if (letters.trim().length >= 2 && digitRatio < 0.3 && !/kassenbon|receipt|beleg/i.test(line)) {
        shop = line.trim();
        break;
      }
    }
    // VAT
    const vatId = (text.match(/(USt\-Id|USt\.?Id\.?|VAT|MwSt\.?\s*Nr\.?)[^\n]*([A-Z]{2}[0-9A-Z]{8,12})/i) || [,'',''])[2] || '';
    return {
      amount: amount || '',
      amount_line: amountLine || '',
      date: date || '',
      shop: shop || '',
      vat_id: vatId || '',
      raw_preview: lines.slice(0, 12).join(' \n ')
    };
  }

  function buildCompactJSON(ocrText) {
    const fields = extractStructuredFields(ocrText);
    return JSON.stringify(fields);
  }

  // --- Plugin call for pre-analysis
  async function triggerImageAnalysisPlugin(imageBase64) {
    try {
      if (window.r1 && r1.messaging && typeof r1.messaging.sendMessage === 'function') {
        await r1.messaging.sendMessage('Analyze this image', {
          useLLM: true,
          pluginId: 'image-analyzer',
          imageBase64
        });
      } else if (typeof PluginMessageHandler !== 'undefined') {
        const payload = {
          useLLM: true,
          message: 'Analyze this image',
          pluginId: 'image-analyzer',
          imageBase64
        };
        PluginMessageHandler.postMessage(JSON.stringify(payload));
      }
    } catch (e) {
      console.warn('[Plugin] image-analyzer trigger failed:', e);
    }
  }

  // --- OCR
  async function runOCR(dataUrl) {
    if (!dataUrl) throw new Error('Kein Bild vorhanden');
    updateStatus('🔍 OCR läuft...');
    try {
      const { data: { text } } = await Tesseract.recognize(dataUrl, 'deu+eng', {
        logger: m => console.log(m)
      });
      return text || '';
    } catch (e) {
      console.error('[OCR] Error:', e);
      return '';
    }
  }

  // --- Mail via Rabbit LLM
  async function sendReceiptMail(ocrText, imgDataUrl) {
    updateStatus('📧 E-Mail wird versendet...');

    // ---- Attachment
    const attachmentObj = { dataUrl: imgDataUrl, filename: 'receipt.jpg' };

    // Prepare structured prompt
    const toEmail = 'me@rabbit.tech';
    const prompt = `You are an assistant. Please analyze the attached OCR scan of a receipt. Sort and extract the data into the fields 'shop', 'date', 'amount', 'VAT-ID' (if present). Return only valid JSON in this format: {"shop":"...", "date":"...", "amount":"...", "vat_id":"..."}.
Attach the original scan image to the mail.`;

    // Füge OCR als Klartext mit an und Attachment als 'dataUrl'
    const fullMailBody = `OCR_TEXT:\n${ocrText}`;

    // Plugin-Analyse triggert vor dem Versand (nur base64 für Plugin, nicht für Mail)
    let imageBase64 = '';
    try {
      const m = imgDataUrl.match(/^data:image\/jpeg;base64,(.*)$/i) || imgDataUrl.match(/^data:image\/[^;]+;base64,(.*)$/i);
      imageBase64 = m ? m[1] : '';
      if (imageBase64) await triggerImageAnalysisPlugin(imageBase64);
    } catch {}

    // --- LLM PluginMessageHandler (empfohlen)
    if (typeof PluginMessageHandler !== 'undefined') {
      try {
        const payload = {
          useLLM: true,
          message: prompt + "\n\n" + fullMailBody,
          attachments: [attachmentObj]
        };
        PluginMessageHandler.postMessage(JSON.stringify(payload));
        updateStatus('✅ Scan und Versand erfolgreich!');
        return;
      } catch (e) {
        console.error('[Mail] PluginMessageHandler failed:', e);
      }
    }

    // --- Fallback für Rabbit R1 Oldstyle
    if (window.r1 && r1.llm && typeof r1.llm.sendMailToSelf === 'function') {
      try {
        await r1.llm.sendMailToSelf({
          subject: 'Beleg gescannt',
          body: prompt + "\n\n" + fullMailBody,
          attachments: [attachmentObj]
        });
        updateStatus('✅ Scan und Versand erfolgreich!');
      } catch (e) {
        console.error('[Mail] Legacy API failed:', e);
        throw e;
      }
    } else {
      updateStatus('✅ Scan und Versand erfolgreich! (simuliert)');
    }
  }

  // --- Preprocessing
  async function preprocessDataUrl(dataUrl) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.filter = 'contrast(1.2) brightness(1.1)';
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, c.width, c.height);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
          const bw = gray > 128 ? 255 : 0;
          d[i] = d[i+1] = d[i+2] = bw;
        }
        ctx.putImageData(imageData, 0, 0);
        res(c.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = rej;
      img.src = dataUrl;
    });
  }

  // --- Camera
  async function startCamera() {
    if (isScanning) return;
    isScanning = true;

    try {
      updateStatus('📷 Kamera wird gestartet...');
      if (!video) {
        video = document.getElementById('videoPreview') || document.createElement('video');
        video.id = 'videoPreview';
        video.setAttribute('playsinline', '');
        video.setAttribute('autoplay', '');
      }
      if (!hasR1CameraAPI()) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: 400, height: 240 }
        });
        video.srcObject = stream;
        await video.play();
      }
      if (scanBtn) scanBtn.style.display = 'none';
      if (cameraContainer) cameraContainer.classList.add('active');
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'contain';
      video.style.display = 'block';
      video.style.cursor = 'pointer';
      video.addEventListener('click', capture);
      updateStatus('✋ Tippe auf die Preview zum Aufnehmen');
      isScanning = false;
    } catch (e) {
      console.error('[Camera] Failed:', e);
      updateStatus('❌ Kamera-Fehler: ' + e.message);
      isScanning = false;
    }
  }

  function stopCamera() {
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    if (cameraContainer) cameraContainer.classList.remove('active');
  }

  // --- Capture (Start OCR Chain)
  async function capture() {
    if (isScanning) return;
    isScanning = true;
    try {
      updateStatus('📸 Foto aufgenommen, OCR läuft...');
      let capturedDataUrl = '';
      if (hasR1CameraAPI()) {
        const photo = await r1.camera.capturePhoto(400, 240);
        capturedDataUrl = await normalizeToDataUrl(photo);
      } else {
        if (!video || !video.videoWidth) throw new Error('Video nicht bereit');
        const c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        const cx = c.getContext('2d');
        cx.drawImage(video, 0, 0);
        capturedDataUrl = c.toDataURL('image/jpeg', 0.7);
      }
      stopCamera();
      updateStatus('🖼️ Bild wird vorverarbeitet...');
      const preprocessed = await preprocessDataUrl(capturedDataUrl);
      lastImageDataUrl = preprocessed;
      updateStatus('🔍 OCR läuft...');
      lastOCRText = await runOCR(preprocessed);
      updateStatus('📧 Ergebnis erkannt, E-Mail wird versendet...');
      await sendReceiptMail(lastOCRText, preprocessed);
      setTimeout(resetUI, 2500);
    } catch (e) {
      console.error('[Capture] Failed:', e);
      updateStatus('❌ Fehler: ' + e.message);
      setTimeout(resetUI, 2500);
    } finally {
      isScanning = false;
    }
  }

  function bindEvents() {
    if (scanBtn) scanBtn.addEventListener('click', startCamera);
    try {
      if (window.r1 && r1.hardware && typeof r1.hardware.on === 'function') {
        r1.hardware.on('sideClick', () => {
          if (cameraContainer && cameraContainer.classList.contains('active')) capture();
          else startCamera();
        });
      }
    } catch {}
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (cameraContainer && cameraContainer.classList.contains('active')) capture();
        else startCamera();
      }
    });
  }

  function init() {
    bindEvents();
    updateStatus('Bereit zum Scannen');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
