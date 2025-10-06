// Rabbit Receipt Scanner
let video, scanBtn, cameraContainer, tapOverlay, canvas, processing, results;

window.addEventListener('DOMContentLoaded', () => {
  scanBtn = document.getElementById('scanBtn');
  cameraContainer = document.getElementById('cameraContainer');
  video = document.getElementById('video');
  tapOverlay = document.getElementById('tapOverlay');
  canvas = document.getElementById('canvas');
  results = document.getElementById('results');
  processing = document.getElementById('processing');

  scanBtn.onclick = () => startCamera();
  tapOverlay.onclick = () => captureAndProcess();
  video.onclick = () => captureAndProcess();
});

async function startCamera() {
  scanBtn.style.display = "none";
  cameraContainer.style.display = "flex";
  results.innerHTML = "";
  processing.style.display = "none";
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
}

async function captureAndProcess() {
  processing.style.display = "block";
  tapOverlay.textContent = "";
  // Capture
  canvas.width=video.videoWidth; canvas.height=video.videoHeight;
  canvas.getContext('2d').drawImage(video,0,0);
  let imgData = canvas.toDataURL('image/png');

  // Stop camera
  let tracks = video.srcObject.getTracks();
  tracks.forEach(track => track.stop());
  cameraContainer.style.display = "none";
  scanBtn.style.display = "block";

  // OCR
  let worker = await Tesseract.createWorker('deu+eng',1,{ logger: m=>{ if(processing)processing.textContent = m.status; } });
  await worker.load(); await worker.loadLanguage('deu+eng'); await worker.initialize('deu+eng');
  let { data } = await worker.recognize(imgData);
  await worker.terminate();

  processing.style.display = "none";
  results.innerHTML = interpretReceipt(data.text);
  try { await sendReceiptViaRabbitMail(data.text, imgData); results.innerHTML += "<div class='success'>✓ Receipt sent!</div>"; } catch {}
}

function interpretReceipt(text) {
  const lines = (text||"").split('\n').filter(l=>l.trim());
  const total = lines.map(l=>l.match(/(?:total|gesamt|summe|betrag).*?(\d+[.,]\d{2})/i)).find(Boolean);
  const date = lines.map(l=>l.match(/\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}/)).find(Boolean);
  let html = "";
  if(total) html += `<div class='result-highlight'>Betrag: ${total[1]||total[0]}</div>`;
  if(date) html += `<div class='result-date'>Datum: ${date[0]}</div>`;
  html += "<pre style='color:#eee;'>"+text+"</pre>";
  return html;
}

async function sendReceiptViaRabbitMail(text,imgData) {
  if(window.rabbit && rabbit.llm && typeof rabbit.llm.sendMailToSelf==="function") {
    await rabbit.llm.sendMailToSelf({
      subject: `Receipt Scan - ${new Date().toLocaleString("de-DE")}`,
      body: text,
      attachment: imgData
    });
  }
}

