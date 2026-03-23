/* ==========================================
   barcode.js — Scanner barcode html5-qrcode
   Espone solo start(callback)/stop() — il click sul pulsante
   viene gestito dal contesto chiamante (diary.js ecc.)
   ========================================== */

window.BarcodeScanner = (() => {
  let scanner = null;
  let running = false;
  let _onResult = null;

  const fileInput = document.getElementById('barcode-file-input');
  const fileBtn   = document.getElementById('btn-scan-barcode-file');
  const mainBtn   = document.getElementById('btn-scan-barcode');

  // ── Fallback file input ──────────────────────────────────────────────────
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';
    // Pulisce il div prima di creare la nuova istanza (evita conflitti su iOS)
    const readerEl = document.getElementById('barcode-reader');
    if (readerEl) readerEl.innerHTML = '';
    try {
      const qr = new Html5Qrcode('barcode-reader', {
        formatsToSupport: window.ScannerConfig.SCAN_CONFIG.formatsToSupport,
        verbose: false,
      });
      const result = await qr.scanFile(file, false);
      if (typeof _onResult === 'function') _onResult(result);
    } catch (e) {
      alert('Barcode non riconosciuto nell\'immagine. Riprova con una foto più nitida.');
    }
  });

  fileBtn.addEventListener('click', () => fileInput.click());

  // ── Scanner webcam ───────────────────────────────────────────────────────
  function start(onResult) {
    if (running) return;
    _onResult = onResult || null;

    const wrap     = document.getElementById('barcode-scanner-wrap');
    const readerEl = document.getElementById('barcode-reader');

    window.ScannerConfig.removeTorch(wrap);
    readerEl.innerHTML = '';
    wrap.classList.remove('hidden');

    scanner = new Html5Qrcode('barcode-reader');
    running = true;

    scanner.start(
      window.ScannerConfig.CAMERA_CONSTRAINTS,
      window.ScannerConfig.SCAN_CONFIG,
      (decodedText) => {
        // Dispatch immediato PRIMA di stop() per evitare problemi di timing su iOS
        const cb = _onResult;
        running = false;
        _onResult = null;
        wrap.classList.add('hidden');
        scanner.stop().catch(() => {}).finally(() => {
          scanner = null;
          window.ScannerConfig.removeTorch(wrap);
        });
        if (typeof cb === 'function') cb(decodedText);
      },
      () => {}
    ).then(() => {
      window.ScannerConfig.initTorch(scanner, wrap);
    }).catch(err => {
      running = false;
      scanner = null;
      wrap.classList.add('hidden');
      console.warn('Webcam non disponibile, uso fallback file:', err);
      mainBtn.classList.add('hidden');
      fileBtn.classList.remove('hidden');
    });
  }

  function stop() {
    if (scanner && running) {
      running = false;
      scanner.stop().catch(() => {}).finally(() => {
        scanner = null;
        const wrap = document.getElementById('barcode-scanner-wrap');
        if (wrap) { window.ScannerConfig.removeTorch(wrap); wrap.classList.add('hidden'); }
      });
    }
  }

  document.getElementById('btn-stop-scan').addEventListener('click', () => stop());

  return { start, stop, get running() { return running; } };
})();
