// main.js - Rabbit Receipt Scanner core logic
// Handles camera, capture, OCR request, AI parsing, and UI updates

(function(){
  const ui = {};
  const get = id => document.getElementById(id);

  function initUIRefs(){
    [
      'statusText','statusIcon','scanBtn','cameraContainer','video','canvas',
      'preview','previewImg','results','resultTotal','resultMerchant',
      'resultItems','scrollIndicator','processing','processText','retryBtn',
      'sendBtn','hint','content'
    ].forEach(id => ui[id] = get(id));
  }

  const state = {
    isProcessing: false,
    isCameraActive: false,
    currentPhoto: null,      // base64 jpeg
    currentData: null,       // parsed receipt
    rawText: null,
    stream: null
  };

  function setStatus(text, iconUrl){
    if (ui.statusText) ui.statusText.textContent = text;
    if (ui.statusIcon){
      const img = ui.statusIcon.querySelector('img');
      if (img && iconUrl) img.src = iconUrl;
    }
  }

  function showProcessing(text){
    if (ui.processText) ui.processText.textContent = text || 'Processing...';
    if (ui.processing) ui.processing.classList.add('active');
  }
  function updateProcessing(text){ if (ui.processText) ui.processText.textContent = text; }
  function hideProcessing(){ if (ui.processing) ui.processing.classList.remove('active'); }

  function showError(message, duration=4000){
    const existing = ui.content.querySelectorAll('.error');
    existing.forEach(e=>e.remove());
    const div = document.createElement('div');
    div.className = 'error';
    div.textContent = message;
    ui.content.appendChild(div);
    if (duration>0) setTimeout(()=>div.remove(), duration);
  }

  async function startCamera(){
    // If Rabbit SDK is available, prefer it; else fallback to browser mediaDevices
    if (typeof rabbit !== 'undefined' && rabbit.camera && rabbit.camera.startStream) {
      state.stream = await rabbit.camera.startStream({ facingMode: 'environment' });
      // Assume rabbit returns a MediaStream-like object
    } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
      state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } else {
      throw new Error('No camera API available');
    }

    if (ui.video) {
      ui.video.srcObject = state.stream;
      await ui.video.play().catch(()=>{});
    }
    ui.cameraContainer.classList.add('active');
    state.isCameraActive = true;
  }

  async function stopCamera(){
    try{
      if (typeof rabbit !== 'undefined' && rabbit.camera && rabbit.camera.stop) {
        await rabbit.camera.stop();
      }
      if (state.stream) {
        state.stream.getTracks().forEach(t=>t.stop());
        state.stream = null;
      }
    }catch(e){ /* noop */ }
    state.isCameraActive = false;
    ui.cameraContainer.classList.remove('active');
  }

  function captureFrameToBase64(){
    const video = ui.video;
    const canvas = ui.canvas;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]; // base64 data
  }

  function showPhoto(base64){
    if (ui.previewImg && ui.preview){
      ui.previewImg.src = 'data:image/jpeg;base64,'+base64;
      ui.preview.classList.add('active');
    }
  }

  function resetUI(){
    ui.preview.classList.remove('active');
    ui.results.classList.remove('active');
    ui.scrollIndicator.classList.remove('active');
    ui.scanBtn.disabled = false;
    ui.scanBtn.style.display = 'flex';
    ui.hint.style.display = 'block';
    ui.retryBtn.classList.remove('active');
    ui.sendBtn.classList.remove('active');
    const existing = ui.content.querySelectorAll('.error'); existing.forEach(e=>e.remove());
  }

  function showResults(data){
    ui.scanBtn.style.display = 'none';
    ui.hint.style.display = 'none';
    ui.resultTotal.textContent = `${data.total || '--'} ${data.currency || 'EUR'}`;
    ui.resultMerchant.textContent = `${data.merchant || 'Unknown'} • ${data.date || 'no date'}`;
    ui.resultItems.innerHTML = '';
    if (Array.isArray(data.items) && data.items.length){
      const max = 12;
      data.items.slice(0,max).forEach(item=>{
        const li = document.createElement('li');
        li.textContent = item;
        ui.resultItems.appendChild(li);
      });
      if (data.items.length>max){
        const li = document.createElement('li');
        li.textContent = `... and ${data.items.length-max} more`;
        li.style.fontStyle = 'italic';
        li.style.color = '#888';
        ui.resultItems.appendChild(li);
      }
      if (ui.results.scrollHeight > ui.results.clientHeight){
        ui.scrollIndicator.classList.add('active');
      }
    } else {
      ui.resultItems.innerHTML = '<li>No individual items recognized.</li>';
    }
    ui.results.classList.add('active');
    ui.retryBtn.classList.add('active');
    ui.sendBtn.classList.add('active');
  }

  function parseAIResponse(response){
    try { return JSON.parse(response); } catch(e1){}
    try {
      const m = response.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
    } catch(e2){}
    return {
      total: 'Unknown', currency: 'EUR', merchant: 'Not recognized',
      date: new Date().toISOString().split('T')[0], items: []
    };
  }

  async function ocrAndAnalyze(base64){
    // Prefer Rabbit SDK if present; otherwise, skip with dummy
    let rawText = '';
    if (typeof rabbit !== 'undefined' && rabbit.ai && rabbit.ai.ocr){
      rawText = await rabbit.ai.ocr(base64, {
        language: ['deu','eng'], enhance: true, dpi: 300, detectRotation: true
      });
    } else {
      rawText = 'TOTAL 12.34 EUR\nMerchant Demo Markt\n2025-10-03\nItem A 5.00\nItem B 7.34';
    }
    state.rawText = rawText;

    let aiResp = '';
    if (typeof rabbit !== 'undefined' && rabbit.ai && rabbit.ai.chat){
      const prompt = `You are a receipt extraction expert. Analyze this receipt and ONLY return valid JSON (no extra text):\n{
  "total":"XX.XX","currency":"EUR","merchant":"Store Name","date":"YYYY-MM-DD",
  "items":["Item 1 - X.XX€"]
}\nRECEIPT TEXT:\n${rawText}\nReply ONLY with the JSON.`;
      aiResp = await rabbit.ai.chat(prompt, { temperature: 0.0, max_tokens: 800, model: 'gpt-4' });
    } else {
      aiResp = JSON.stringify({ total:'12.34', currency:'EUR', merchant:'Demo Markt', date:'2025-10-03', items:['Item A - 5.00€','Item B - 7.34€'] });
    }
    return parseAIResponse(aiResp);
  }

  async function handleScan(){
    if (state.isProcessing) return;
    state.isProcessing = true;
    ui.scanBtn.disabled = true;
    showProcessing('Starting camera...');
    setStatus('Camera', 'https://raw.githubusercontent.com/atomlabor/rabbit-receipt-scanner/main/r1-cam.png');
    try{
      await startCamera();
      updateProcessing('Position your receipt...');
      await new Promise(r=>setTimeout(r, 1200));
      updateProcessing('Taking photo...');
      await new Promise(r=>setTimeout(r, 200));
      const base64 = captureFrameToBase64();
      await stopCamera();
      state.currentPhoto = base64;
      showPhoto(base64);

      showProcessing('Recognizing text...');
      const data = await ocrAndAnalyze(base64);
      state.currentData = data;
      hideProcessing();
      showResults(data);
      setStatus('Done', null);
    } catch(err){
      await stopCamera();
      hideProcessing();
      showError('Scan failed: '+(err && err.message ? err.message : err));
      setStatus('Error', null);
      ui.scanBtn.disabled = false;
    } finally {
      state.isProcessing = false;
    }
  }

  function bindEvents(){
    ui.scanBtn.addEventListener('click', handleScan);
    ui.retryBtn.addEventListener('click', ()=>{
      state.currentPhoto = null; state.currentData = null; state.rawText = null;
      resetUI(); setStatus('Ready', 'https://raw.githubusercontent.com/atomlabor/rabbit-receipt-scanner/main/rabbit.png');
    });
    ui.sendBtn.addEventListener('click', ()=>{
      if (typeof rabbit !== 'undefined' && rabbit.delegate){
        rabbit.delegate('email', state.currentData || {});
      } else {
        alert('Send not available in browser preview.');
      }
    });

    if (typeof rabbit !== 'undefined' && rabbit.onPTTPress){
      rabbit.onPTTPress(()=>{ if (!state.isProcessing && !state.currentPhoto) handleScan(); });
    }
    if (typeof rabbit !== 'undefined' && rabbit.onAppQuit){
      rabbit.onAppQuit(()=>{ stopCamera(); });
    }
  }

  function onReady(){
    initUIRefs();
    resetUI();
    setStatus('Ready', 'https://raw.githubusercontent.com/atomlabor/rabbit-receipt-scanner/main/rabbit.png');
    bindEvents();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
