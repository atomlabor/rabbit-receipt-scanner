/* Rabbit Receipt Scanner - Fixed Camera Preview Implementation
   Key fixes:
   - Scan button completely replaced by video preview when camera starts
   - Video immediately visible in camera state (button hidden)
   - Click on live video captures photo immediately
   - Clean state transitions: idle ↔ camera → processing → results → idle
   - Rabbit R1 hardware events: PTT (volume keys, 'v', space, enter), Escape for reset
   - Tesseract OCR with deu+eng
   - Rabbit PluginMessageHandler integration with embedded dataUrl and email action
   - NEW: r1.messaging + r1.llm support with image-analyzer plugin and fallback to PluginMessageHandler
*/
(function(){
  'use strict';
  const States = Object.freeze({ idle: 'idle', camera: 'camera', processing: 'processing', results: 'results' });
  let state = States.idle;
  let stream = null, currentBlob = null, zoomLevel = 0, track = null, imageCapture = null;
  const dom = {};
  const qs = (id) => document.getElementById(id);
  function cacheDom(){
    dom.btnScan = qs('scanBtn'); dom.status = qs('status'); dom.video = qs('videoPreview'); dom.canvas = qs('captureCanvas');
    dom.resultContainer = qs('resultContainer'); dom.ocrText = qs('ocrText'); dom.llmInterpretation = qs('llmInterpretation');
    dom.emailSentMsg = qs('emailSentMsg'); dom.nextScanBtn = qs('nextScanBtn'); dom.thinkingGif = qs('thinkingGif'); dom.previewImg = qs('previewImg');
  }
  function ensureDom(){ if(Object.keys(dom).length===0) cacheDom(); }
  function setStatus(t){ if(dom.status) dom.status.textContent = t; }
  function showThinking(s){ if(dom.thinkingGif) dom.thinkingGif.style.display = s?'block':'none'; }
  function showNextScan(s){ if(dom.nextScanBtn) dom.nextScanBtn.style.display = s?'block':'none'; }
  function setState(ns){ state = ns; renderState(); }
  function renderState(){
    if(!dom.btnScan||!dom.video||!dom.resultContainer) return;
    switch(state){
      case States.idle: dom.btnScan.style.display='block'; dom.video.style.display='none'; dom.resultContainer.style.display='none'; setStatus(''); break;
      case States.camera: dom.btnScan.style.display='none'; dom.video.style.display='block'; dom.resultContainer.style.display='none'; setStatus('Tap video to capture'); break;
      case States.processing: dom.btnScan.style.display='none'; dom.video.style.display='none'; dom.resultContainer.style.display='none'; setStatus('Processing...'); break;
      case States.results: dom.btnScan.style.display='none'; dom.video.style.display='none'; dom.resultContainer.style.display='block'; setStatus('Results'); break;
    }
  }
  async function startCamera(){
    try{
      const constraints = { video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } };
      stream = await navigator.mediaDevices.getUserMedia(constraints); if(dom.video) dom.video.srcObject = stream;
      track = stream.getVideoTracks()[0]; imageCapture = new ImageCapture(track);
      const capabilities = track.getCapabilities(); if(capabilities.zoom){ zoomLevel = capabilities.zoom.min; }
      setStatus('Camera ready. Tap video to capture.'); return true;
    }catch(err){ console.error('Camera error:', err); setStatus('Camera error: '+err.message); return false; }
  }
  function stopCamera(){ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; track=null; imageCapture=null; } if(dom.video) dom.video.srcObject=null; }
  function applyZoom(dir){
    if(!track) return; const cap = track.getCapabilities(); if(!cap.zoom) return;
    const min = cap.zoom.min, max = cap.zoom.max, step = cap.zoom.step || ((max-min)/10);
    zoomLevel = Math.max(min, Math.min(max, zoomLevel + dir*step)); track.applyConstraints({ advanced: [{ zoom: zoomLevel }] }).catch(e=>console.warn('Zoom error:', e));
  }
  async function runOCR(blob){
    try{
      const { data: { text } } = await Tesseract.recognize(blob, 'deu+eng', { logger: m => console.log('Tesseract:', m.status, m.progress) });
      return text.trim();
    }catch(err){ console.error('OCR error:', err); return ''; }
  }
  function hasPluginHandler(){ return typeof window.PluginMessageHandler !== 'undefined' && typeof window.PluginMessageHandler.postMessage === 'function'; }
  function hasRabbitMessaging(){ return typeof r1 !== 'undefined' && typeof r1.messaging !== 'undefined' && typeof r1.messaging.send === 'function'; }
  async function sendViaRabbitMessaging(base64Image, ocrText){
    if(!hasRabbitMessaging()) throw new Error('r1.messaging not available');
    const request = { plugin: 'image-analyzer', action: 'analyze-receipt', parameters: { image: base64Image, ocrText } };
    const response = await r1.messaging.send(request); console.log('r1.messaging response:', response);
    if(response && response.data) return response.data; else throw new Error('Invalid r1.messaging response');
  }
  async function sendToAIWithEmbeddedDataUrl(prompt, dataUrl, ocrText){
    if(!hasPluginHandler()) throw new Error('Rabbit PluginMessageHandler not available');
    window.PluginMessageHandler.postMessage(JSON.stringify({ useLLM:true, message:prompt, imageDataUrl:dataUrl, ocrText }));
    console.log('Sent to LLM with embedded image & OCR text (PluginMessageHandler)');
  }
  async function sendEmailViaHandler(subject, body, attachmentBase64){
    if(!hasPluginHandler()) { console.warn('PluginMessageHandler not available for email'); return; }
    const msg = { sendEmail:true, subject, body }; if(attachmentBase64) msg.attachmentBase64 = attachmentBase64;
    window.PluginMessageHandler.postMessage(JSON.stringify(msg));
    console.log('Email request sent via PluginMessageHandler');
  }
  async function captureAndProcess(){
    if(state!==States.camera) return;
    if(!imageCapture) {
      setStatus('Camera not ready. Please try again!');
      return;
    }
    setState(States.processing); stopCamera(); showThinking(true);
    try{
      const blob = await imageCapture.takePhoto(); currentBlob = blob; const url = URL.createObjectURL(blob); if(dom.previewImg) dom.previewImg.src = url;
      const ocrText = await runOCR(blob); if(dom.ocrText) dom.ocrText.textContent = ocrText || '(no text found)';
      const reader = new FileReader();
      reader.onloadend = async ()=>{
        const dataUrl = reader.result; const base64 = String(dataUrl).split(',')[1];
        if(hasRabbitMessaging()){
          try{
            const result = await sendViaRabbitMessaging(base64, ocrText);
            if(dom.llmInterpretation) dom.llmInterpretation.textContent = result.emailBody || JSON.stringify(result.parsedData, null, 2);
            const subject = 'Receipt Analysis from Rabbit'; const body = result.emailBody || JSON.stringify(result.parsedData, null, 2); const attachmentB64 = result.attachment || null;
            await sendEmailViaHandler(subject, body, attachmentB64);
          }catch(err){
            console.error('r1.messaging error, fallback to PluginMessageHandler:', err);
            const prompt = 'This is a receipt image. Extract: merchant, date, items, total. Return as JSON.';
            await sendToAIWithEmbeddedDataUrl(prompt, dataUrl, ocrText);
            if(dom.llmInterpretation) dom.llmInterpretation.textContent = 'Sent to LLM via PluginMessageHandler. Check Rabbit hub for response.';
          }
        } else {
          const prompt = 'This is a receipt image. Extract: merchant, date, items, total. Return as JSON.';
          await sendToAIWithEmbeddedDataUrl(prompt, dataUrl, ocrText);
          if(dom.llmInterpretation) dom.llmInterpretation.textContent = 'Sent to LLM via PluginMessageHandler. Check Rabbit hub for response.';
        }
      }; reader.readAsDataURL(blob);
      showThinking(false); showNextScan(true); setState(States.results);
    }catch(err){ console.error('Processing error:', err); setStatus('Error: '+err.message); showThinking(false); setState(States.idle); }
  }
  async function onScan(){ if(state!==States.idle) return; const ok = await startCamera(); if(ok) setState(States.camera); }
  function onReset(){ stopCamera(); if(dom.previewImg) dom.previewImg.src=''; if(dom.ocrText) dom.ocrText.textContent=''; if(dom.llmInterpretation) dom.llmInterpretation.textContent=''; if(dom.emailSentMsg) dom.emailSentMsg.style.display='none'; currentBlob=null; showThinking(false); showNextScan(false); setState(States.idle); }
  function onWheel(e){ if(state!==States.camera) return; e.preventDefault(); const d = e.deltaY<0 ? +1 : -1; applyZoom(d); }
  function onKeyDown(e){
 if(state===States.camera && (e.key==='v'||e.key===' '||e.key==='Enter'||e.code==='VolumeDown'||e.code==='VolumeUp')){ e.preventDefault(); captureAndProcess(); }
    if(e.key==='Escape'){ e.preventDefault(); onReset(); }
 if(state===States.results && e.key.toLowerCase()==='r'){ e.preventDefault(); onReset(); }
 }
  function bindEvents(){ dom.btnScan?.addEventListener('click', onScan); dom.nextScanBtn?.addEventListener('click', onReset);
    dom.video?.addEventListener('click', ()=>{ if(state===States.camera) captureAndProcess(); }); dom.video?.addEventListener('wheel', onWheel, {passive:false});
    document.addEventListener('keydown', onKeyDown); document.addEventListener('visibilitychange', ()=>{ if(document.hidden) onReset(); }); }
  function init(){ ensureDom(); bindEvents(); setState(States.idle); }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
