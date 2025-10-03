      case 'results':
        if (results) results.classList.add('active');
        if (actions) actions.classList.add('active');
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
