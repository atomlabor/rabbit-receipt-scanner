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
