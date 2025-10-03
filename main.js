    capturedImageData = null;
    ocrResultText = '';
    ocrText.textContent = 'Scanning...';
    updateUI();
  }

  // Update UI based on current state
  function updateUI() {
    // Reset all states
    scanBtn.style.display = 'none';
    cameraContainer.classList.remove('active');
    preview.classList.remove('active');
    results.classList.remove('active');
    processing.classList.remove('active');
    actions.classList.remove('active');

    // Apply current state
    switch (currentState) {
      case 'idle':
        scanBtn.style.display = 'flex';
        break;

      case 'camera':
        cameraContainer.classList.add('active');
        actions.classList.add('active');
        break;

      case 'preview':
        preview.classList.add('active');
        actions.classList.add('active');
        break;

      case 'processing':
        preview.classList.add('active');
        processing.classList.add('active');
        actions.classList.remove('active');
        break;

      case 'results':
        results.classList.add('active');
        actions.classList.add('active');
        break;
    }
  }

  // Initialize when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
