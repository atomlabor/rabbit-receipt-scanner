// Rabbit Receipt Scanner - Universell (Rabbit R1 & Browser), OCR & Rabbit LLM
(function () {
  'use strict';
  // === STATE
  let stream = null, isScanning = false, state = 'idle', zoom = 1.0;
  const ZOOM_MIN = 0.75, ZOOM_MAX = 2.0, ZOOM_STEP = 0.1;

  // === DOM-REFERENZEN
  let scanBtn, cameraContainer, video, canvas, previewImg, resultsBox, processingBox, processText, retryBtn;

  // === UNIVERSALE STORAGE-API
  const storage = {
    async set(key, value) {
      try {
        if (window.rabbit && rabbit.storage && typeof rabbit.storage.setItem === 'function')
          await rabbit.storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        else if (window.localStorage)
          localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      } catch (e) { }
    },
    async get(key) {
      try {
        if (window.rabbit && rabbit.storage && typeof rabbit.storage.getItem === 'function')
          return await rabbit.storage.getItem(key);
        else if (window.localStorage)
          return localStorage.getItem(key);
      } catch (e) { }
      return null;
    }
  };

  // === INIT
  function init() {
    scanBtn = document.getElementById('scanBtn');
    cameraContainer = document.getElementById('cameraContainer');
    video = document.getElementById('videoPreview');
    canvas = document.getElementById('canvas');
    previewImg = document.getElementById('previewImg');
    resultsBox = document.getElementById('results');
    processingBox = document.getElementById('processing');
    processText = document.getElementById('processText');
    retryBtn = document.getElementById('retryBtn');

    scanBtn && scanBtn.addEventListener('click', startCamera);
    if (video) video.addEventListener('click', captureImage);
    if (cameraContainer) cameraContainer.addEventListener('click', (ev) => {
      if (state === 'camera') captureImage();
    });
    retryBtn && retryBtn.addEventListener('click', reset);

    // Hardware: Scroller/PTT
    if (window.rabbit && rabbit.hardware) {
      if (typeof rabbit.hardware.onScroll === 'function') {
        rabbit.hardware.onScroll(({ direction }) => applyZoom(direction === 'up' ? 1 : -1));
      }
      if (typeof rabbit.hardware.onPTT === 'function') {
        rabbit.hardware.onPTT(() => { if (state === 'camera') captureImage(); else if (state === 'idle') startCamera(); });
      }
    } else {
      document.addEventListener('keydown', e => {
        if (e.code === 'Space') { e.preventDefault();
          if (state === 'camera') captureImage();
          else if (state === 'idle') startCamera();
        }
      });
    }

    restorePrevImage();
    updateUI();
  }

  function applyZoom(delta) {
    const before = zoom;
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta * ZOOM_STEP));
    if (video && state === 'camera') video.style.transform = `scale(${zoom})`;
    if (previewImg && (state === 'preview' || state === 'results')) previewImg.style.transform = `scale(${zoom})`;
  }

  // === KAMERA-START (universal mit Portrait):
  async function startCamera() {
    try {
      state = 'camera'; updateUI();
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          aspectRatio: { ideal: 9/16 }, width: { ideal: 1080 }, height: { ideal: 1920 }
        }
      });
      video.srcObject = stream; await video.play();
      Object.assign(video.style, {
        objectFit: 'contain', background: '#000', width: '100%', height: '100%', transform: 'scale(1)'
      });
      zoom = 1.0;
    } catch (err) {
      updateStatus('Kamera-Fehler: ' + err);
      reset();
    }
  }

  function stopCamera() {
    try { if (stream) stream.getTracks().forEach(t => t.stop()); if (video) video.srcObject = null; } catch (e) { }
  }

  // === BILDAUFNAHME & OCR
  function captureImage() {
    if (state !== 'camera' || isScanning) return;
    if (!video || !canvas) { updateStatus('Kamera fehlt!'); return; }
    const vw = video.videoWidth || 1080, vh = video.videoHeight || 1920;
    canvas.width = vw; canvas.height = vh;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, vw, vh);
    ctx.drawImage(video, 0, 0, vw, vh);
    const imgDataUrl = canvas.toDataURL('image/jpeg', 0.90);

    stopCamera(); // Ressourcen frei
    storage.set('r1.lastImage', imgDataUrl);

    if (previewImg) {
      previewImg.src = imgDataUrl;
      previewImg.style.maxWidth = '240px'; previewImg.style.maxHeight = '282px';
      previewImg.style.objectFit = 'contain'; previewImg.style.background = '#000';
    }
    state = 'preview'; updateUI();
    processOCR(imgDataUrl);
  }

  async function processOCR(imgDataUrl) {
    if (isScanning) return;
    isScanning = true;
    state = 'processing'; updateUI();
    if (processText) processText.textContent = 'OCR läuft ...';

    const preprocessed = await preprocessImage(imgDataUrl);
    const inputImg = preprocessed || imgDataUrl;

    try {
      const worker = await Tesseract.createWorker(['deu','eng'], 1, {
        logger: m => { if (processText) processText.textContent = m.status + (m.progress ? ` ${Math.round(m.progress*100)}%` : ''); }
      });
      const result = await worker.recognize(inputImg, { tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK });
      await worker.terminate();
      const ocrText = (result && result.data && result.data.text) ? result.data.text : '';
      showResult(ocrText);
      state = 'results'; updateUI();
      await storage.set('r1.lastOCR', ocrText);
      await sendReceiptViaRabbitMail(ocrText, imgDataUrl);
    } catch (err) {
      showResult('OCR Error: ' + (err && err.message ? err.message : String(err)));
      state = 'results'; updateUI();
    } finally {
      isScanning = false;
    }
  }

  // OPTISCHES VORPROCESSING, adaptiv & schärfer
  function preprocessImage(imgDataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = function () {
        const w = img.width, h = img.height;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const src = ctx.getImageData(0, 0, w, h);
        const data = src.data;
        // Grauwert & Kontraststretch
        const gray = new Uint8ClampedArray(w*h); let min=255, max=0;
        for(let i=0,p=0;i<data.length;i+=4,p++){const g=0.299*data[i]+0.587*data[i+1]+0.114*data[i+2];
          gray[p]=g;if(g<min)min=g;if(g>max)max=g;}
        const range=Math.max(1,max-min);for(let p=0;p<gray.length;p++)gray[p]=((gray[p]-min)*255)/range;
        // Binarisieren (adaptiv)
        const out = new Uint8ClampedArray(gray.length);
        for (let y=0;y<h;y++)for(let x=0;x<w;x++){
          const p=y*w+x,win=[];for(let j=-4;j<=4;j++){for(let i=-4;i<=4;i++){
            const nx=Math.max(0,Math.min(w-1,x+i)),ny=Math.max(0,Math.min(h-1,y+j));win.push(gray[ny*w+nx]);
          }}const mean=win.reduce((a,b)=>a+b,0)/win.length-5;
          out[p]=(gray[p]>mean)?255:0;
        }
        const outImg=ctx.createImageData(w,h);for(let i=0,p=0;p<out.length;i+=4,p++){const v=out[p];outImg.data[i]=v;outImg.data[i+1]=v;outImg.data[i+2]=v;outImg.data[i+3]=255;}
        ctx.putImageData(outImg,0,0);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = imgDataUrl;
    });
  }

  //=== RENDERING & MAIL
  function showResult(text) {
    if (!resultsBox) return;
    let html='<div style="font-size:13px;">';
    const lines=(text||'').split('\n');
    const total=lines.map(l=>l.match(/(?:total|summe|betrag|gesamt).*?(\\d+[.,]\\d{2})/i)).find(Boolean);
    const date=lines.map(l=>l.match(/\\d{1,2}[\\.\\/-]\\d{1,2}[\\.\\/-]\\d{2,4}/)).find(Boolean);
    if(total)html+=`<div style="color: #ffb84c; font-weight:bold;">Betrag: ${total[1]||total[0]}</div>`;
    if(date)html+=`<div style="color: #4cf7ff;">Datum: ${date[0]}</div>`;
    html+=`<pre style="color:#eee;white-space:pre-wrap;">${text}</pre></div>`;
    resultsBox.innerHTML=html;
  }

  async function sendReceiptViaRabbitMail(ocrText, imgDataUrl) {
    if (window.rabbit && rabbit.llm && typeof rabbit.llm.sendMailToSelf === 'function') {
      try {
        await rabbit.llm.sendMailToSelf({ subject: 'Receipt Scan', body: ocrText, attachment: imgDataUrl });
        if (resultsBox) resultsBox.innerHTML += '<div style="color:#6f6;">✓ Receipt sent!</div>';
      } catch (err) { console.error('[LLM-MAIL]',err);}
    }
  }

  function updateStatus(msg) {
    if (processText) processText.textContent = msg;
    else if (resultsBox) resultsBox.innerHTML = `<div style="color:#ff4;">${msg}</div>`;
  }

  async function restorePrevImage() {
    const lastImg = await storage.get('r1.lastImage');
    if (lastImg && previewImg) previewImg.src = lastImg;
  }

  function reset() {
    stopCamera(); state='idle'; isScanning=false;
    if (previewImg) previewImg.src='', previewImg.style.display='none';
    if (resultsBox) resultsBox.innerHTML='';
    updateUI();
  }

  // UI-State
  function updateUI() {
    if (!scanBtn||!cameraContainer||!processingBox||!resultsBox) return;
    scanBtn.style.display=(state==='idle'||state==='results')?'block':'none';
    cameraContainer.style.display=(state==='camera')?'flex':'none';
    processingBox.style.display=(state==='processing')?'block':'none';
    resultsBox.style.display=(state==='results')?'block':'none';
    if (previewImg) previewImg.style.display=((state==='preview'||state==='results')&&previewImg.src)?'block':'none';
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
