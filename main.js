      img.src = dataUrl;
    });
  }

  // --- Capture (R1 preferred)
  async function capture() {
    if (isScanning) return;
    isScanning = true;
    try {
      updateStatus('📸 Aufnahme...');
      let capturedDataUrl = '';
      if (hasR1CameraAPI()) {
        const photo = await r1.camera.capturePhoto(240, 282);
        capturedDataUrl = await normalizeToDataUrl(photo);
      } else {
        if (!video || !video.videoWidth) throw new Error('Video nicht bereit');
        const c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        const cx = c.getContext('2d');
        cx.drawImage(video, 0, 0);
        capturedDataUrl = c.toDataURL('image/jpeg', 0.95);
      }
      stopCamera();
      const preprocessed = await preprocessDataUrl(capturedDataUrl);
      lastImageDataUrl = preprocessed;
      updateStatus('🔍 OCR läuft...');
      lastOCRText = await runOCR(preprocessed);
      updateStatus('📧 E-Mail wird versendet...');
      await sendReceiptMail(lastOCRText, preprocessed);
      updateStatus('✅ Fertig! Ergebnis wurde per Mail gesendet.');
      setTimeout(resetUI, 2500);
    } catch (e) {
      console.error('[Capture] Failed:', e);
      updateStatus('❌ Fehler: ' + e.message);
      setTimeout(resetUI, 2500);
    } finally {
      isScanning = false;
    }
  }

  // --- Event wiring
  function bindEvents() {
    if (scanBtn) scanBtn.addEventListener('click', startCamera);
    if (cameraContainer) cameraContainer.addEventListener('click', capture);

    // Optional: Rabbit hardware side button if available
    try {
      if (window.r1 && r1.hardware && typeof r1.hardware.on === 'function') {
        r1.hardware.on('sideClick', () => {
          if (cameraContainer && cameraContainer.classList.contains('active')) capture();
          else startCamera();
        });
      }
    } catch {}

    // Keyboard fallback for desktop testing
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (cameraContainer && cameraContainer.classList.contains('active')) capture();
        else startCamera();
      }
    });
  }

  // --- Init
  function init() {
    bindEvents();
    updateStatus('Bereit zum Scannen');
  }

  // Start when DOM ready
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
