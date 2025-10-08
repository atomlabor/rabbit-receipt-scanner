(function () {
  'use strict';
  let isScanning = false, stream = null, state = 'idle';
  let scanBtn, cameraContainer, video, canvas, previewImg, resultsBox, processingBox, processText, retryBtn;

  // Helper für Storage (Rabbit/native + Fallback)
  async function saveImage(imgData) {
    if (window.rabbit && rabbit.storage && typeof rabbit.storage.setItem === 'function') {
      const file = `/photos/receipt_${Date.now()}.jpg`;
      await rabbit.storage.setItem(file, imgData);
      return file;
    }
    return null;
  }

  function updateStatus(msg) {
    if (processText) processText.textContent = msg;
    if (resultsBox) resultsBox.innerHTML = `<div style="color:#ffb84c;">${msg}</div>`;
  }

  // Kamera initialisieren und Preview zeigen
  async function startCamera() {
    if (isScanning) return;
    isScanning = true;
    stopCamera();
    cameraContainer.innerHTML = '';
    video = document.createElement('video');
    video.id = "videoPreview";
    Object.assign(video.style, {
      width: "100%", height: "100%", objectFit: "contain", background: "#000",
      display: "block", cursor: "pointer"
    });
    cameraContainer.appendChild(video);
    scanBtn.style.display = 'none';
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          aspectRatio: { ideal: 9 / 16 },
          width: { ideal: 1080 },
          height: { ideal: 1920 }
        }
      });
      video.srcObject = stream;
      await video.play();
      updateStatus('Klicke ins Bild für Scan…');
      video.onclick = captureImage;

      // Hardware-Erweiterung
      if (window.rabbit && rabbit.hardware && typeof rabbit.hardware.onPTT === 'function') {
        rabbit.hardware.onPTT(() => captureImage());
      }
      // Space/Enter: barrierefrei auch im Browser
      window.onkeydown = (ev) => {
        if (state === 'camera' && (ev.code === 'Space' || ev.code === 'Enter')) {
          captureImage();
        }
      };
      state = 'camera';
    } catch (e) {
      isScanning = false;
      scanBtn.style.display = 'block';
      updateStatus('Kamerafehler: ' + e.message);
    }
    isScanning = false;
  }

  function stopCamera() {
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    if (cameraContainer) cameraContainer.innerHTML = "";
  }

  function showPreview(imgDataUrl) {
    previewImg.src = imgDataUrl;
    previewImg.style.display = 'block';
  }

  // Bild vom Videoframe aufnehmen, OCR-Workflow starten
  async function captureImage() {
    if (isScanning) return;
    isScanning = true;
    if (!video) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) { updateStatus('Kein Videobild erkannt'); isScanning = false; return; }

    canvas.width = vw; canvas.height = vh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, vw, vh);
    const imgDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    stopCamera();
    showPreview(imgDataUrl);

    // Save to Rabbit Storage, falls vorhanden
    let imgFile = null;
    if (window.rabbit && rabbit.storage && typeof rabbit.storage.setItem === 'function') {
      imgFile = await saveImage(imgDataUrl);
    }

    resultsBox.innerHTML = "";
    processOCR(imgDataUrl, imgFile);
    isScanning = false;
  }

  // OCR mit Tesseract.js
  async function processOCR(imgDataUrl, imgFile) {
    state = 'processing';
    processingBox.style.display = 'block';
    processText.textContent = 'OCR läuft…';
    try {
      const { data: { text } } = await window.Tesseract.recognize(imgDataUrl, 'deu+eng', {
        logger: m => { processText.textContent = 'OCR: ' + m.status + (m.progress ? ` ${(m.progress*100)|0}%` : ''); }
      });
      if (!text.trim()) {
        resultsBox.innerHTML = '<b>Kein Text erkannt!</b>';
        state = 'results'; processingBox.style.display = 'none'; return;
      }
      showResult(text);
      await sendReceiptViaRabbitMail(text, imgDataUrl, imgFile);
    } catch (err) {
      resultsBox.innerHTML = '<b>OCR Fehler:</b> ' + err;
    }
    state = 'results'; processingBox.style.display = 'none';
  }

  // Zusammengefasste Ergebnisse + Mailversand (inkl. LLM-Prompt-Optimierung)
  async function sendReceiptViaRabbitMail(ocrText, imgDataUrl, imgFile) {
    let mailBody = `Scan vom ${new Date().toLocaleString('de-DE')}:\n\n`;
    if (window.rabbit && rabbit.llm && typeof rabbit.llm.generateText === 'function') {
      const prompt = `Extrahiere aus folgendem Kassenbon den Händler, Betrag und das Datum, gib dies als Markdown-Liste an:\n\n${ocrText}`;
      try {
        const summary = await rabbit.llm.generateText(prompt);
        if (summary) mailBody += `**Kurzfassung:**\n${summary}\n\n`;
      } catch (err) { }
    }
    mailBody += `---\nOCR-Originaltext:\n${ocrText}`;

    if (window.rabbit && rabbit.llm && typeof rabbit.llm.sendMailToSelf === 'function') {
      await rabbit.llm.sendMailToSelf({
        subject: 'Kassenbon-Scan & OCR',
        body: mailBody,
        attachment: imgDataUrl
      });
      resultsBox.innerHTML += '<div style="color:#6f6;">✓ Mail gesendet!</div>';
    }
  }

  function showResult(text) {
    const lines = text.split('\n');
    const total = lines.map(l => l.match(/(?:total|summe|betrag|gesamt).*?(\d+[.,]\d{2})/i)).find(Boolean);
    const date = lines.map(l => l.match(/\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}/)).find(Boolean);
    let html = '<div>';
    if (total) html += `<div style="color:orange;font-weight:bold;">Betrag: ${total[1] || total[0]}</div>`;
    if (date) html += `<div style="color:#4cf7ff">Datum: ${date[0]}</div>`;
    html += `<pre style="color:#eee;white-space:pre-wrap;">${text}</pre></div>`;
    resultsBox.innerHTML = html;
  }

  // UI-States verwalten
  function updateUI() {
    scanBtn.style.display = (state === 'idle' || state === 'results') ? 'block' : 'none';
    cameraContainer.style.display = (state === 'camera') ? 'block' : 'none';
    processingBox.style.display = (state === 'processing') ? 'block' : 'none';
    resultsBox.style.display = (state === 'results') ? 'block' : 'none';
    previewImg.style.display = (state === 'processing' || state === 'results') && previewImg.src ? 'block' : 'none';
    retryBtn.style.display = (state === 'results') ? 'block' : 'none';
  }

  function resetUiVars() {
    isScanning = false; stream = null; state = 'idle';
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    if (previewImg) { previewImg.src = ''; previewImg.style.display = 'none'; }
    stopCamera();
    resultsBox.innerHTML = '';
    updateUI();
  }

  // Initialisierung
  function init() {
    scanBtn = document.getElementById('scanBtn');
    cameraContainer = document.getElementById('cameraContainer');
    previewImg = document.getElementById('previewImg');
    resultsBox = document.getElementById('results');
    canvas = document.getElementById('canvas');
    processingBox = document.getElementById('processing');
    processText = document.getElementById('processText');
    retryBtn = document.getElementById('retryBtn');
    scanBtn.onclick = startCamera;
    retryBtn.onclick = resetUiVars;
    updateUI();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
