// Rabbit Receipt Scanner for Rabbit R1 & modern browsers
// feat: bilingual UI (de/en), dynamic OCR language (single worker), auto Rabbit mail after scan
(function(){
  'use strict';

  const I18N = {
    de: {
      scan: 'Scannen',
      tapToCapture: 'Antippen zum Erfassen',
      processing: 'Verarbeitung...',
      ocrInit: 'OCR wird initialisiert ...',
      amount: 'Betrag',
      date: 'Datum',
      sent: '✓ Beleg gesendet!',
      retry: 'Neuer Scan',
      askSend: 'Per E-Mail/LLM versenden?'
    },
    en: {
      scan: 'Scan',
      tapToCapture: 'Tap to capture',
      processing: 'Processing...',
      ocrInit: 'Initializing OCR ...',
      amount: 'Amount',
      date: 'Date',
      sent: '✓ Receipt sent!',
      retry: 'New Scan',
      askSend: 'Send via Email/LLM?'
    }
  };

  let lang = 'de';
  let stream = null, isScanning = false, currentState = 'idle', zoom = 1.0;
  const ZOOM_MIN = 0.75, ZOOM_MAX = 2.0, ZOOM_STEP = 0.1;

  let scanBtn, cameraContainer, video, canvas, previewImg, results, processing, processText,
      retryBtn, langSelect, uiLangToggle, labelScan, hintTap, headerTitle;

  const storage = {
    async set(k, v){
      try{
        if (window.rabbit && rabbit.storage && typeof rabbit.storage.setItem === 'function')
          await rabbit.storage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        else if (window.localStorage)
          localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
      }catch(e){ console.warn('[STORAGE] Set Failed:', e) }
    },
    async get(k){
      try{
        if (window.rabbit && rabbit.storage && typeof rabbit.storage.getItem === 'function')
          return await rabbit.storage.getItem(k);
        else if (window.localStorage)
          return localStorage.getItem(k);
      }catch(e){ console.warn('[STORAGE] Get Failed:', e) }
      return null;
    }
  };

  function getBilingual(key){
    const de = I18N.de[key] || '';
    const en = I18N.en[key] || '';
    return `${de} / ${en}`.trim();
  }

  function init(){
    scanBtn = document.getElementById('scanBtn');
    cameraContainer = document.getElementById('cameraContainer');
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    previewImg = document.getElementById('previewImg');
    results = document.getElementById('results');
    processing = document.getElementById('processing');
    processText = document.getElementById('processText');
    retryBtn = document.getElementById('retryBtn');
    langSelect = document.getElementById('langSelect');
    uiLangToggle = document.getElementById('uiLangToggle');
    labelScan = document.getElementById('labelScan');
    hintTap = document.getElementById('hintTap');
    headerTitle = document.getElementById('headerTitle');

    storage.get('r1.lang').then(v=>{
      if(v){
        try{ lang = JSON.parse(v) }catch{ lang = v }
        setTexts();
      }
    });

    // Ensure BOTH scanBtn and labelScan always trigger startCamera()
    const ensureStartCam = (ev)=>{ ev?.stopPropagation?.(); startCamera(); };
    if (scanBtn) scanBtn.addEventListener('click', ensureStartCam);
    if (labelScan) labelScan.addEventListener('click', ensureStartCam);

    if (video) video.addEventListener('click', captureImage);
    if (cameraContainer) cameraContainer.addEventListener('click', captureImage);
    if (retryBtn) retryBtn.addEventListener('click', reset);

    if (langSelect){
      langSelect.value = lang;
      langSelect.addEventListener('change', ()=>{
        lang = langSelect.value || 'de';
        storage.set('r1.lang', lang);
        setTexts();
      });
    }
    if (uiLangToggle){
      uiLangToggle.value = lang;
      uiLangToggle.addEventListener('change', ()=>{
        const val = uiLangToggle.value || 'de';
        lang = val;
        if (langSelect) langSelect.value = val;
        storage.set('r1.lang', lang);
        setTexts();
      });
    }

    document.addEventListener('wheel', ev=>{
      if (currentState==='camera' || currentState==='preview') applyZoom(ev.deltaY<0?1:-1);
      else if (currentState==='results' && results) results.scrollTop += ev.deltaY;
    }, {passive:true});

    if (window.rabbit && rabbit.hardware && typeof rabbit.hardware.onScroll === 'function'){
      rabbit.hardware.onScroll(({direction})=>applyZoom(direction==='up'?1:-1));
    }
    if (window.rabbit && rabbit.hardware && typeof rabbit.hardware.onPTT === 'function'){
      rabbit.hardware.onPTT(()=>{
        if (currentState==='camera') captureImage();
        else if (currentState==='idle') startCamera();
      });
    }else{
      document.addEventListener('keydown', e=>{
        if (e.code==='Space'){
          e.preventDefault();
          if (currentState==='camera') captureImage();
          else if (currentState==='idle') startCamera();
        }
      });
    }

    restorePrevImage();
    setTexts();
    updateUI();
  }

  function setTexts(){
    // Always show both languages for ALL UI labels
    const sScan = getBilingual('scan');
    const sTap = getBilingual('tapToCapture');
    const sProcessing = getBilingual('processing');
    const sOcrInit = getBilingual('ocrInit');
    const sRetry = getBilingual('retry');

    if (labelScan) labelScan.textContent = sScan; // id=labelScan always bilingual and clickable
    if (scanBtn) scanBtn.textContent = sScan;     // fallback if scanBtn exists separately
    if (hintTap) hintTap.textContent = sTap;
    if (processing) processing.querySelector?.('#processTitle')?.textContent = sProcessing;
    if (processText) processText.textContent = sOcrInit;
    if (headerTitle) headerTitle.textContent = 'Rabbit Receipt Scanner';
    if (retryBtn) retryBtn.textContent = sRetry;

    // Additionally, annotate results headers if present
    const amountNodes = document.querySelectorAll('.label-amount');
    amountNodes.forEach(n=>n.textContent = getBilingual('amount'));
    const dateNodes = document.querySelectorAll('.label-date');
    dateNodes.forEach(n=>n.textContent = getBilingual('date'));
  }

  function applyZoom(d){
    const before = zoom;
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + d*ZOOM_STEP));
    if (video && currentState==='camera') video.style.transform = `scale(${zoom})`;
    if (previewImg && currentState==='preview') previewImg.style.transform = `scale(${zoom})`;
    if (before!==zoom) console.log('[ZOOM]', zoom.toFixed(2));
  }

  async function startCamera(){
    try{
      currentState = 'camera';
      // Ensure camera UI visible immediately
      if (cameraContainer) cameraContainer.style.display = 'flex';
      if (video) video.style.display = 'block';
      updateUI();

      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: {ideal:1920}, height: {ideal:1080} }
      });
      if (video){
        video.srcObject = stream;
        await video.play();
      }
      zoom = 1.0;
    }catch(err){
      console.error('[CAMERA] Error:', err);
      alert('Camera error: ' + err);
      reset();
    }
  }

  function stopCamera(){
    try{
      if (stream) stream.getTracks().forEach(t=>t.stop());
      if (video) video.srcObject = null;
    }catch(e){ console.warn('[CAMERA] stop error', e) }
  }

  function captureImage(){
    if (currentState!=='camera' || isScanning) return;
    if (!video || !canvas){ alert('Camera not ready'); return }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const image = canvas.toDataURL('image/jpeg', 0.9);
    storage.set('r1.lastImage', image);
    stopCamera();
    if (previewImg) previewImg.src = image;
    currentState = 'preview';
    updateUI();
    if (confirm(getBilingual('askSend')))
      sendToAIWithEmbeddedDataUrl({
        subject: `${lang==='de'?'Beleg-Scan':'Receipt Scan'} - ${new Date().toLocaleString(lang==='de'?'de-DE':'en-US')}`,
        text: '',
        imageDataUrl: image
      });
    processOCR(image);
  }

  async function sendToAIWithEmbeddedDataUrl({subject, text, imageDataUrl}){
    const body = `${text||''}`.trim();
    const attachment = imageDataUrl;
    if (window.rabbit && rabbit.llm && typeof rabbit.llm.sendMailToSelf === 'function'){
      try{
        await rabbit.llm.sendMailToSelf({subject, body, attachment});
        if (results) results.innerHTML += `<div class="success">${(I18N[lang]||I18N.de).sent}</div>`
      }catch(err){
        console.error('[LLM] sendMailToSelf failed:', err)
      }
    }else if (window.navigator && navigator.share){
      try{ await navigator.share({title: subject, text: body, url: attachment}) }
      catch(e){ console.warn('[SHARE] cancelled/not available', e) }
    }else{
      try{
        const a = document.createElement('a');
        a.href = attachment;
        a.download = `receipt-${Date.now()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }catch(e){ console.warn('[FALLBACK] download failed', e) }
    }
  }

  async function processOCR(imgDataUrl){
    if (isScanning) return;
    isScanning = true;
    currentState = 'processing';
    updateUI();
    if (processText) processText.textContent = getBilingual('ocrInit');
    const pre = await preprocessImage(imgDataUrl);
    const inputImg = pre || imgDataUrl;
    try{
      const worker = await Tesseract.createWorker(lang, 1, {
        cacheMethod: 'none',
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        langPath: 'https://cdn.jsdelivr.net/npm/tessdata-fast@4.1.0',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0',
        logger: m=>{ if (processText) processText.textContent = (m.status || '') + (m.progress?` ${Math.round(m.progress*100)}%`:'' ) }
      });
      const result = await worker.recognize(inputImg);
      await worker.terminate();
      const ocrText = (result && result.data && result.data.text) ? result.data.text : '';
      showResult(ocrText);
      currentState = 'results';
      updateUI();
      await storage.set('r1.lastOCR', ocrText);
      await sendReceiptViaRabbitMail(ocrText, imgDataUrl);
    }catch(err){
      console.error('[OCR] Error:', err);
      showResult('OCR Error: ' + (err && err.message ? err.message : String(err)));
      currentState = 'results';
      updateUI();
    }finally{
      isScanning = false;
    }
  }

  function preprocessImage(imgDataUrl){
    return new Promise(resolve=>{
      const img = new Image();
      img.onload = function(){
        const w = img.width, h = img.height;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0,0,w,h);
        const d = data.data;
        for (let i=0;i<d.length;i+=4){
          let gray = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
          gray = Math.min(255, Math.max(0, gray + 15));
          const bin = gray >= 170 ? 255 : 0;
          d[i]=d[i+1]=d[i+2]=bin;
        }
        ctx.putImageData(data,0,0);
        resolve(c.toDataURL('image/png'))
      };
      img.onerror = ()=> resolve(null);
      img.src = imgDataUrl;
    })
  }

  function showResult(text){
    const lines = (text||'').split('\n').filter(l=>l.trim());
    const total = lines.map(l=>l.match(/(?:total|summe|betrag|gesamt).*?(\d+[.,]\d{2})/i)).find(Boolean);
    const date = lines.map(l=>l.match(/\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}/)).find(Boolean);
    let html = '<div style="font-size:14px;">';
    if (total) html += `<div class=\"result-highlight\">${getBilingual('amount')}: ${total[1]||total[0]}</div>`;
    if (date) html += `<div class=\"result-date\">${getBilingual('date')}: ${date[0]}</div>`;
    html += `<pre style=\"white-space:pre-wrap;color:#eee;\">${text}</pre>`;
    html += '</div>';
    if (results) results.innerHTML = html;
    if (previewImg && previewImg.src) previewImg.style.display = 'block';
  }

  async function sendReceiptViaRabbitMail(text, img){
    const subject = `${lang==='de'?'Beleg-Scan':'Receipt Scan'} - ${new Date().toLocaleString(lang==='de'?'de-DE':'en-US')}`;
    if (window.rabbit && rabbit.llm && typeof rabbit.llm.sendMailToSelf === 'function'){
      try{
        await rabbit.llm.sendMailToSelf({ subject, body: text, attachment: img });
        if (results) results.innerHTML += `<div class=\"success\">${(I18N[lang]||I18N.de).sent}</div>`
      }catch(err){ console.error('[MAIL] Error sending:', err) }
    }else{
      console.log('[MAIL] Rabbit LLM API not available (browser mode)')
    }
  }

  function updateUI(){
    if (!cameraContainer || !processing || !results) return;

    // Make labelScan button always visible and clickable
    if (labelScan) { labelScan.style.pointerEvents = 'auto'; labelScan.style.cursor = 'pointer'; }

    // Keep scan button visible so it is always clickable
    if (scanBtn) { scanBtn.style.display = 'block'; scanBtn.style.pointerEvents = 'auto'; }

    cameraContainer.style.display = (currentState==='camera') ? 'flex' : 'none';
    processing.style.display = (currentState==='processing') ? 'block' : '
