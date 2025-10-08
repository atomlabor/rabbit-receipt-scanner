/* Rabbit Receipt Scanner - Fixed Camera Preview Implementation
   Key fixes:
   - Scan button completely replaced by video preview when camera starts
   - Video immediately visible in camera state (button hidden)
   - Click on live video captures photo immediately
   - Clean state transitions: idle ↔ camera → processing → results → idle
   - Rabbit R1 hardware events: PTT (volume keys, 'v', space, enter), Escape for reset
   - Tesseract OCR with deu+eng
   - Rabbit PluginMessageHandler integration with embedded dataUrl and email action
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
    dom.resultContainer = qs('resultContainer');
    dom.ocrText = qs('ocrText');
    dom.capturedImage = qs('capturedImage');
    dom.thinkingGif = qs('thinkingGif');
    dom.nextScanBtn = qs('nextScanBtn');
  }
  function ensureDom() {
    cacheDom();
    const missing = Object.entries(dom).filter(([k, v]) => !v).map(([k]) => k);
    if (missing.length > 0) {
      console.error('Missing DOM elements:', missing.join(', '));
    }
  }
  function updateStatus(text) {
    if (dom.status) dom.status.textContent = text;
    console.log('Status:', text);
  }
  function showThinking(show) {
    if (!dom.thinkingGif) return;
    dom.thinkingGif.style.display = show ? 'block' : 'none';
  }
  function showNextScan(show) {
    if (!dom.nextScanBtn) return;
    dom.nextScanBtn.style.display = show ? 'inline-block' : 'none';
  }
  // State machine
  function setState(newState) {
    console.log('State transition:', state, '→', newState);
    state = newState;
    // Button vs video visibility
    if (dom.btnScan) dom.btnScan.style.display = (state === States.idle) ? 'block' : 'none';
    if (dom.video) {
      dom.video.style.display = (state === States.camera) ? 'block' : 'none';
      dom.video.style.pointerEvents = (state === States.camera) ? 'auto' : 'none';
    }
    if (dom.resultContainer) {
      dom.resultContainer.style.display = (state === States.results) ? 'block' : 'none';
    }
    // Thinking GIF visibility by state
    if (state === States.processing) showThinking(true); else showThinking(false);
    // Next Scan button visibility by state
    showNextScan(state === States.results);
    // Status updates
    if (state === States.idle) updateStatus('Ready to scan');
    else if (state === States.camera) updateStatus('Camera active - Click video or press PTT to capture');
    else if (state === States.processing) updateStatus('Processing image...');
  }
  // Camera start
  async function startCamera() {
    try {
      setState(States.camera);
      const constraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!dom.video) throw new Error('Video element missing');
      dom.video.srcObject = stream;
      await dom.video.play();
      track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};
      if (capabilities.zoom) {
        imageCapture = new ImageCapture(track);
        console.log('Zoom range:', capabilities.zoom);
      } else {
        console.log('Zoom not supported by camera');
      }
      updateStatus('Camera ready - Click video to capture');
    } catch (err) {
      console.error('Camera error:', err);
      updateStatus('Camera error: ' + err.message);
      onReset();
    }
  }
  function applyZoom(direction) {
    if (!track || !imageCapture) return;
    const capabilities = track.getCapabilities();
    if (!capabilities.zoom) return;
    const settings = track.getSettings();
    const currentZoom = settings.zoom || 1;
    const step = (capabilities.zoom.max - capabilities.zoom.min) / 10;
    let newZoom = currentZoom + (direction * step);
    newZoom = Math.max(capabilities.zoom.min, Math.min(capabilities.zoom.max, newZoom));
    track.applyConstraints({ advanced: [{ zoom: newZoom }] })
      .then(() => {
        zoomLevel = newZoom;
        console.log('Zoom set to:', newZoom);
      })
      .catch(err => console.error('Zoom error:', err));
  }
  async function captureAndProcess() {
    if (state !== States.camera) return;
    setState(States.processing); // will show thinking GIF
    try {
      if (!dom.canvas || !dom.video) throw new Error('Canvas or video missing');
      const ctx = dom.canvas.getContext('2d');
      dom.canvas.width = dom.video.videoWidth;
      dom.canvas.height = dom.video.videoHeight;
      ctx.drawImage(dom.video, 0, 0);
      currentBlob = await new Promise(resolve => dom.canvas.toBlob(resolve, 'image/jpeg', 0.95));
      if (!currentBlob) throw new Error('Capture failed');
      const dataUrl = await blobToDataURL(currentBlob);
      if (dom.capturedImage) {
        dom.capturedImage.src = dataUrl;
        dom.capturedImage.style.display = 'block';
      }
      updateStatus('Running OCR...');
      await runOCR(dataUrl);
    } catch (err) {
      console.error('Capture/process error:', err);
      updateStatus('Error: ' + err.message);
      onReset();
    }
  }
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  async function runOCR(dataUrl) {
    try {
      updateStatus('OCR in progress...');
      // Ensure GIF is visible while OCR runs
      showThinking(true);
      const result = await Tesseract.recognize(dataUrl, 'deu+eng', {
        logger: m => {
          if (m.status === 'recognizing text') {
            updateStatus(`OCR: ${Math.round(m.progress * 100)}%`);
          }
        }
      });
      const text = result.data.text.trim();
      console.log('OCR result:', text);
      if (dom.ocrText) {
        dom.ocrText.textContent = text || '(No text detected)';
      }
      updateStatus('OCR complete - Sending to AI...');
      await sendToAIWithEmbeddedDataUrl(dataUrl, text);
      setState(States.results); // will hide GIF and show Next Scan
    } catch (err) {
      console.error('OCR error:', err);
      updateStatus('OCR failed: ' + err.message);
      setState(States.results); // hide GIF, allow next scan
    }
  }
  // Modified function to send email action with embedded dataUrl via LLM only
  async function sendToAIWithEmbeddedDataUrl(dataUrl, ocrText) {
    // Construct the prompt for the LLM
const prompt = `Please email me the attached receipt image. The email body must include a human-readable summary of all important extracted details (such as total, merchant, date, VAT) AND the full raw OCR text extracted from the image. Return ONLY valid JSON in this exact format: {"action":"email","subject":"Receipt Scan","body":"Summary: ...\\nOCR Text: ...","attachments":[{"dataUrl":"<dataUrl>"}]}`;


     
    // Construct the complete payload with embedded dataUrl
    const payload = {
      useLLM: true,
      message: prompt,
      imageDataUrl: dataUrl
    };
    
    console.log('Sending to Rabbit LLM:', payload);
    updateStatus('Sending to Rabbit AI...');
    
    // Check if PluginMessageHandler is available (Rabbit R1 environment)
    if (typeof PluginMessageHandler !== 'undefined' && PluginMessageHandler.postMessage) {
      try {
        // Send the complete payload to Rabbit LLM
        PluginMessageHandler.postMessage(JSON.stringify(payload));
        console.log('Successfully sent to PluginMessageHandler');
        updateStatus('Sent to Rabbit AI!');
        return true;
      } catch (err) {
        console.error('PluginMessageHandler error:', err);
        updateStatus('Failed to send to Rabbit AI');
        return false;
      }
    } else {
      console.warn('PluginMessageHandler not available (running outside Rabbit environment)');
      updateStatus('Rabbit AI not available (browser mode)');
      return false;
    }
  }
  function onScan() {
    if (state !== States.idle) return;
    startCamera();
  }
  function onReset() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (dom.video) dom.video.srcObject = null;
    track = null;
    imageCapture = null;
    zoomLevel = 1;
    currentBlob = null;
    // hide thinking GIF and next button on reset
    showThinking(false);
    showNextScan(false);
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
    dom.nextScanBtn?.addEventListener('click', onReset);
    
    // Click on video triggers capture
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
