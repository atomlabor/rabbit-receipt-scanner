import { deviceControls } from 'r1-create';

/* Rabbit Receipt Scanner
Key fixes:
- Scan button completely replaced by video preview when camera starts
- Video immediately visible in camera state (button hidden)
- Click on live video captures photo immediately
- Clean state transitions: idle ↔ camera → processing → results → idle
- Rabbit R1 hardware events: PTT (volume keys, 'v', space, enter), Escape for reset
- Tesseract OCR with deu+eng
- Rabbit PluginMessageHandler integration with embedded dataUrl and email action
- deviceControls API: sideButton, scrollWheel with full feature set
- r1.camera.capturePhoto() hardware camera API support
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
let zoomLevel = 0;
let track = null;
let imageCapture = null;

// DOM (must exist in HTML)
const dom = {};
const qs = (id) => document.getElementById(id);

function cacheDom() {
    dom.btnScan = qs('scanBtn');
    dom.status = qs('status');
    dom.video = qs('videoPreview');
    dom.canvas = qs('captureCanvas');
    dom.resultContainer = qs('resultContainer');
    dom.ocrText = qs('ocrText');
    dom.llmInterpretation = qs('llmInterpretation');
    dom.emailSentMsg = qs('emailSentMsg');
    dom.nextScanBtn = qs('nextScanBtn');
    dom.thinkingGif = qs('thinkingGif');
    dom.previewImg = qs('previewImg');
}

function ensureDom(){ if(Object.keys(dom).length===0) cacheDom(); }
function setStatus(txt) { if (dom.status) dom.status.textContent = txt; }
function showThinking(show){ if(dom.thinkingGif) dom.thinkingGif.style.display = show ? 'block' : 'none'; }
function showNextScan(show){ if(dom.nextScanBtn) dom.nextScanBtn.style.display = show ? 'block' : 'none'; }

// State machine
function setState(newState) { state = newState; renderState(); }

function renderState() {
    if(!dom.btnScan || !dom.video || !dom.resultContainer) return;
    switch(state){
      case States.idle:     dom.btnScan.style.display='block'; dom.video.style.display='none'; dom.resultContainer.style.display='none'; setStatus(''); break;
      case States.camera:   dom.btnScan.style.display='none'; dom.video.style.display='block'; dom.resultContainer.style.display='none'; setStatus('Tap video to capture'); break;
      case States.processing: dom.btnScan.style.display='none'; dom.video.style.display='none'; dom.resultContainer.style.display='none'; setStatus('Processing...'); break;
      case States.results: dom.btnScan.style.display='none'; dom.video.style.display='none'; dom.resultContainer.style.display='block'; setStatus('Results'); break;
    }
}

// Camera
async function startCamera(){
    if (stream) return true;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities();
        if (caps.zoom) { zoomLevel = caps.zoom.min; }
        imageCapture = new ImageCapture(track);
        dom.video.srcObject = stream;
        await dom.video.play();
        return true;
    } catch (err) {
        console.error('Camera error:', err);
        setStatus('Camera access denied or unavailable.');
        return false;
    }
}

function stopCamera(){ 
    if(!stream) return; 
    stream.getTracks().forEach(t=>t.stop()); 
    if (dom.video) dom.video.srcObject = null;
    stream = null; 
    track = null; 
    imageCapture = null; 
}

function applyZoom(delta){ 
    if (!track || !imageCapture) return;
    const caps = track.getCapabilities(); 
    if (!caps.zoom) return;
    zoomLevel = Math.max(caps.zoom.min, Math.min(caps.zoom.max, zoomLevel + delta));
    track.applyConstraints({ advanced: [{ zoom: zoomLevel }] });
}

// OCR
async function runOCR(blob){
    if (!window.Tesseract) throw new Error('Tesseract not loaded');
    const { data: { text } } = await window.Tesseract.recognize(blob, 'deu+eng', { logger: m => console.log(m) });
    return text.trim();
}

// AI
async function sendToAIWithEmbeddedDataUrl(prompt, dataUrl, ocrText) {
    if (!window.PluginMessageHandler || !window.PluginMessageHandler.postMessage) {
        throw new Error('Rabbit PluginMessageHandler not available');
    }
    window.PluginMessageHandler.postMessage(JSON.stringify({
        useLLM: true,
        message: prompt,
        imageDataUrl: dataUrl,
        ocrText: ocrText
    }));
    console.log('Sent to LLM with embedded image & OCR text');
}

// Email (via PluginMessageHandler)
async function sendEmailViaHandler(subject, body) {
    if (!window.PluginMessageHandler || !window.PluginMessageHandler.postMessage) {
        throw new Error('Rabbit PluginMessageHandler not available');
    }
    window.PluginMessageHandler.postMessage(JSON.stringify({
        sendEmail: true,
        subject: subject,
        body: body
    }));
    console.log('Email request sent via PluginMessageHandler');
}

// Photo capture: use hardware API if available, otherwise fallback to ImageCapture
async function takePhoto() {
    // Try hardware camera API first
    if (window.r1 && window.r1.camera && typeof window.r1.camera.capturePhoto === 'function') {
        console.log('Using r1.camera.capturePhoto hardware API');
        return window.r1.camera.capturePhoto(240, 282);
    }
    // Fallback to standard ImageCapture
    if (imageCapture) {
        console.log('Using standard ImageCapture API');
        return await imageCapture.takePhoto();
    }
    throw new Error('No camera capture method available');
}

// Main processing
async function captureAndProcess() {
  if (state !== States.camera) return;
  setState(States.processing);
  stopCamera();
  showThinking(true);
  
  try {
    const blob = await takePhoto();
    currentBlob = blob;
    const url = URL.createObjectURL(blob);
    if (dom.previewImg) dom.previewImg.src = url;
    
    // Tesseract OCR starten
    const ocrText = await runOCR(blob);
    if (dom.ocrText) dom.ocrText.textContent = ocrText || '(no text found)';
    
    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = reader.result;
      const prompt = "Analyse the photo you just took and extract all the data from it. Then send it to me by email (neatly formatted). ";
      await sendToAIWithEmbeddedDataUrl(prompt, dataUrl, ocrText);
      if (dom.llmInterpretation) {
        dom.llmInterpretation.textContent = 'Sent to LLM. Check Rabbit hub for response.';
      }
    };
    reader.readAsDataURL(blob);
    
    showThinking(false);
    showNextScan(true);
    setState(States.results);
  } catch (err) {
    console.error('Processing error:', err);
    setStatus('Error: ' + err.message);
    showThinking(false);
    setState(States.idle);
  }
}

// User actions
async function onScan() {
    if (state !== States.idle) return;
    const ok = await startCamera();
    if (ok) setState(States.camera);
}

function onReset(){
    stopCamera();
    if (dom.previewImg) dom.previewImg.src = '';
    if (dom.ocrText) dom.ocrText.textContent = '';
    if (dom.llmInterpretation) dom.llmInterpretation.textContent = '';
    if (dom.emailSentMsg) dom.emailSentMsg.style.display = 'none';
    currentBlob = null;
    showThinking(false);
    showNextScan(false);
    setState(States.idle);
}

function onWheel(e){
    if(state!==States.camera) return;
    e.preventDefault();
    const d = e.deltaY<0 ? +1 : -1;
    applyZoom(d);
}

// Hardware/keyboard
function onKeyDown(e){
    if(state===States.camera && (e.key==='v'||e.key===' '||e.key==='Enter'||e.code==='VolumeDown'||e.code==='VolumeUp')){
        e.preventDefault();
        captureAndProcess();
    }
    if(e.key==='Escape'){
        e.preventDefault();
        onReset();
    }
    if(state===States.results && e.key.toLowerCase()==='r'){
        e.preventDefault();
        onReset();
    }
}

// Device controls setup with full feature set
function setupDeviceControls() {
    try {
        // Initialize with options
        deviceControls.init({
            sideButtonEnabled: true,
            scrollWheelEnabled: true,
            keyboardFallback: true
        });
        
        // Register event handlers
        deviceControls.on('sideButton', (event) => {
            console.log('Side button pressed');
            // Optional: trigger capture if in camera state
            // if (state === States.camera) captureAndProcess();
        });
        
        deviceControls.on('scrollWheel', (data) => {
            console.log('Scrolled', data.direction); // 'up' oder 'down'
            // Optional: use for zoom control
            if (state === States.camera) {
                const delta = data.direction === 'up' ? +1 : -1;
                applyZoom(delta);
            }
        });
        
        // Set control states as examples
        deviceControls.setSideButtonEnabled(false);
        deviceControls.setScrollWheelEnabled(true);
        
        console.log('deviceControls initialized successfully with full feature set');
    } catch (err) {
        console.warn('deviceControls init failed:', err);
    }
}

// Bind events
function bindEvents(){
    dom.btnScan?.addEventListener('click', onScan);
    dom.nextScanBtn?.addEventListener('click', onReset);
    // Click on video triggers capture
    dom.video?.addEventListener('click', () => { if(state===States.camera) captureAndProcess(); });
    dom.video?.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', () => { if(document.hidden) onReset(); });
}

function init(){ 
    ensureDom(); 
    bindEvents(); 
    setupDeviceControls();
    setState(States.idle); 
}

if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', init); } else { init(); }

})();
