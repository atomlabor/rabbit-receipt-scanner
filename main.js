/* Rabbit Receipt Scanner - Fixed Camera Preview Implementation
   Key fixes:
   - Scan button completely replaced by video preview when camera starts
   - Video immediately visible in camera state (button hidden)
   - Click on live video captures photo immediately
   - Clean state transitions: idle ↔ camera → processing → results → idle
   - Rabbit R1 hardware events: PTT (volume keys, 'v', space, enter), Escape for reset
   - Tesseract OCR with deu+eng
   - Rabbit PluginMessageHandler integration with embedded dataUrl
*/
(function() {
  'use strict';

  // App State
  const States = Object.freeze({
    idle: 'idle',
    camera: 'camera',
    processing: 'processing',
    results: 'results'
  });
  let state = States.idle;

  // Media and processing
  let stream = null;
  let currentBlob = null;
  let zoomLevel = 1;
  let track = null;
  let imageCapture = null;

  // DOM (must exist in HTML)
  const dom = {};
  function qs(id) { return document.getElementById(id); }

  function cacheDom() {
    dom.btnScan = qs('scanBtn');
    dom.status = qs('status');
    dom.video = qs('videoPreview');
    dom.canvas = qs('captureCanvas');
    dom.resultsBox = qs('resultsBox');
    dom.resultsText = qs('resultsText');
    dom.summaryText = qs('summaryText');
    dom.zoomLabel = qs('zoomLabel');
  }

  function ensureDom() {
    cacheDom();
    if (!dom.video || !dom.canvas) {
      console.error('Critical DOM elements missing!');
    }
  }

  // Set status message
  function setStatus(msg) {
    if (dom.status) dom.status.textContent = msg;
  }

  // State management with proper UI updates
  function setState(newState) {
    state = newState;
    updateUI();
  }

  function updateUI() {
    // Reset all visibility
    const hide = (el) => { if (el) el.style.display = 'none'; };
    const show = (el, type = 'block') => { if (el) el.style.display = type; };

    hide(dom.btnScan);
    hide(dom.video);
    hide(dom.resultsBox);
    if (dom.zoomLabel) hide(dom.zoomLabel);

    switch (state) {
      case States.idle:
        show(dom.btnScan);
        setStatus('Bereit zum Scannen');
        break;

      case States.camera:
        // KEY FIX: Hide button, show video fullscreen in container
        show(dom.video);
        if (dom.video) {
          dom.video.style.width = '100%';
          dom.video.style.height = '100%';
          dom.video.style.objectFit = 'cover';
          dom.video.style.maxWidth = '100%';
          dom.video.style.maxHeight = '100%';
        }
        if (dom.zoomLabel) show(dom.zoomLabel);
        setStatus('Kamera bereit - Klicken zum Aufnehmen');
        break;

      case States.processing:
        setStatus('Verarbeite Bild mit Tesseract OCR...');
        break;

      case States.results:
        show(dom.resultsBox);
        setStatus('Fertig!');
        break;
    }
  }

  // Camera functions
  async function startCamera() {
    try {
      setStatus('Starte Kamera...');
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      dom.video.srcObject = stream;
      await dom.video.play();

      track = stream.getVideoTracks()[0];
      if ('ImageCapture' in window) {
        imageCapture = new ImageCapture(track);
      }

      // Reset zoom
      zoomLevel = 1;
      updateZoomDisplay();

      setState(States.camera);
    } catch (err) {
      console.error('Camera error:', err);
      setStatus('Kamera-Fehler: ' + err.message);
      await closeCamera();
      setState(States.idle);
    }
  }

  async function closeCamera() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (dom.video) {
      dom.video.srcObject = null;
    }
    track = null;
    imageCapture = null;
    zoomLevel = 1;
  }

  // Zoom functions
  function updateZoomDisplay() {
    if (dom.zoomLabel) {
      dom.zoomLabel.textContent = `Zoom: ${zoomLevel.toFixed(1)}x`;
    }
  }

  function applyZoom(delta) {
    if (!track) return;
    const capabilities = track.getCapabilities();
    if (!capabilities.zoom) return;

    const step = 0.1;
    zoomLevel = Math.max(
      capabilities.zoom.min,
      Math.min(capabilities.zoom.max, zoomLevel + delta * step)
    );

    track.applyConstraints({ advanced: [{ zoom: zoomLevel }] })
      .then(() => updateZoomDisplay())
      .catch(err => console.warn('Zoom failed:', err));
  }

  // Capture and process
  async function captureAndProcess() {
    if (state !== States.camera) return;
    setState(States.processing);
    setStatus('Nehme Foto auf...');

    try {
      // Capture from video
      const canvas = dom.canvas;
      const ctx = canvas.getContext('2d');
      canvas.width = dom.video.videoWidth;
      canvas.height = dom.video.videoHeight;
      ctx.drawImage(dom.video, 0, 0, canvas.width, canvas.height);

      // Stop camera immediately after capture
      await closeCamera();

      // Convert to blob
      currentBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));

      // OCR processing
      setStatus('OCR-Analyse läuft (deu+eng)...');
      const result = await Tesseract.recognize(currentBlob, 'deu+eng', {
        logger: m => {
          if (m.status === 'recognizing text') {
            setStatus(`OCR: ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      const ocrText = result.data.text.trim();

      // Display results
      if (dom.resultsText) {
        dom.resultsText.textContent = ocrText || '(Kein Text erkannt)';
      }

      setState(States.results);

      // Try to send via Rabbit PluginMessageHandler with embedded dataUrl
      await sendToAIWithEmbeddedDataUrl(ocrText, currentBlob);

    } catch (err) {
      console.error('Processing error:', err);
      setStatus('Fehler bei der Verarbeitung: ' + err.message);
      await closeCamera();
      // Return to idle after error
      setTimeout(() => setState(States.idle), 3000);
    }
  }

  // Send to AI with embedded dataUrl (Rabbit PluginMessageHandler integration)
  async function sendToAIWithEmbeddedDataUrl(ocrText, imageBlob) {
    if (!imageBlob) return;

    try {
      setStatus('Sende an Rabbit AI...');
      
      // Convert blob to base64 data URL
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(imageBlob);
      });
      
      // Prompt that instructs LLM to extract info and send email with dynamic recipient
      const prompt = 'Summarise all the important information from this image and then send me all the data by email. Return ONLY valid JSON in this exact format: {"action":"email","to":"user@example.com","subject":"Receipt Scan","body":"<summary>","dataUrl":"<attached_image>"}';
      
      // Check if PluginMessageHandler is available (Rabbit R1 device)
      if (typeof PluginMessageHandler !== 'undefined' && PluginMessageHandler.postMessage) {
        // Rabbit device: Use PluginMessageHandler with payload containing prompt and dataUrl
        const payload = {
          prompt: prompt,
          dataUrl: dataUrl,
          ocrText: ocrText || '' // Optional fallback body content
        };
        
        console.log('Sending to PluginMessageHandler:', payload);
        PluginMessageHandler.postMessage(JSON.stringify(payload));
        
        if (dom.summaryText) {
          dom.summaryText.textContent = 'Gesendet an Rabbit AI (via PluginMessageHandler)';
        }
        setStatus('Erfolgreich an Rabbit AI gesendet!');
      } else {
        // Browser/test fallback: Log to console
        console.log('PluginMessageHandler not available. Fallback mode.');
        console.log('Prompt:', prompt);
        console.log('DataUrl length:', dataUrl.length);
        console.log('OCR Text:', ocrText);
        
        if (dom.summaryText) {
          dom.summaryText.textContent = '(Test-Modus: PluginMessageHandler nicht verfügbar)';
        }
        setStatus('Status: Nur Konsole (kein Rabbit-Gerät)');
      }
    } catch (err) {
      console.warn('AI send error:', err);
      if (dom.summaryText) {
        dom.summaryText.textContent = '(Versand fehlgeschlagen)';
      }
    }
  }

  // Event handlers
  async function onScan() {
    if (state !== States.idle) return;
    await startCamera();
  }

  async function onReset() {
    await closeCamera();
    currentBlob = null;
    if (dom.resultsText) dom.resultsText.textContent = '';
    if (dom.summaryText) dom.summaryText.textContent = '';
    setState(States.idle);
  }

  // Mouse wheel zoom over video
  function onWheel(e) {
    if (state !== States.camera) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? +1 : -1;
    applyZoom(delta);
  }

  // Hardware events: PTT capture (Rabbit R1 compatible)
  function onKeyDown(e) {
    // PTT triggers in camera state
    if (state === States.camera && 
        (e.key === 'v' || e.key === ' ' || e.key === 'Enter' ||
         e.code === 'VolumeDown' || e.code === 'VolumeUp')) {
      e.preventDefault();
      captureAndProcess();
    }
    // Escape resets from any state
    if (e.key === 'Escape') {
      e.preventDefault();
      onReset();
    }
    // 'R' key for reset from results
    if (state === States.results && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      onReset();
    }
  }

  // Bind events
  function bindEvents() {
    dom.btnScan?.addEventListener('click', onScan);
    
    // KEY FIX: Click on video triggers capture
    dom.video?.addEventListener('click', () => {
      if (state === States.camera) captureAndProcess();
    });

    dom.video?.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKeyDown);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) onReset();
    });
  }

  function init() {
    ensureDom();
    bindEvents();
    setState(States.idle);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
