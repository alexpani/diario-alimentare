/* ==========================================
   scanner-config.js — Configurazione condivisa scanner barcode
   Caricato dopo html5-qrcode CDN, prima di barcode.js e foods.js
   ========================================== */

window.ScannerConfig = (() => {

  // Formati rilevanti per prodotti alimentari — esclude QR, Aztec, DataMatrix ecc.
  // Riduce il lavoro per frame e i falsi negativi
  const FOOD_FORMATS = [
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.ITF,
  ].filter(f => f !== undefined); // safety: ignora valori undefined se l'enum cambia versione

  const SCAN_CONFIG = {
    fps: 20,                              // era 10 — più tentativi al secondo
    qrbox: { width: 300, height: 180 },   // era 250x120 — area più grande per EAN-13
    aspectRatio: 1.5,
    formatsToSupport: FOOD_FORMATS,
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: true, // usa BarcodeDetector API nativa (Chrome/Android)
    },
  };

  const CAMERA_CONSTRAINTS = { facingMode: 'environment' };

  /**
   * Dopo scanner.start(), chiama questa funzione per iniettare il pulsante torcia
   * solo se il dispositivo lo supporta (Android Chrome).
   * Su iOS il controllo torch è ignorato silenziosamente — nessun pulsante viene mostrato.
   *
   * @param {Html5Qrcode} scannerInstance  — istanza Html5Qrcode già avviata
   * @param {HTMLElement} containerEl      — il div wrapper dello scanner (barcode-scanner-wrap o catalog-barcode-wrap)
   */
  function initTorch(scannerInstance, containerEl) {
    try {
      const capabilities = scannerInstance.getRunningTrackCapabilities();
      if (!capabilities || !capabilities.torch) return; // dispositivo non supporta la torcia

      let torchOn = false;

      const btn = document.createElement('button');
      btn.className = 'btn btn-outline btn-full torch-btn';
      btn.style.marginTop = '8px';
      btn.innerHTML = _torchIcon() + ' Attiva torcia';

      btn.addEventListener('click', async () => {
        torchOn = !torchOn;
        try {
          // html5-qrcode v2.3.8: applyVideoConstraints prende MediaTrackConstraints direttamente
          await scannerInstance.applyVideoConstraints({ torch: torchOn });
          btn.innerHTML = _torchIcon() + (torchOn ? ' Disattiva torcia' : ' Attiva torcia');
        } catch (e) {
          torchOn = !torchOn; // ripristina stato
          console.warn('Torch toggle fallito:', e);
        }
      });

      // Inserisce il pulsante subito dopo il video, prima del pulsante "Ferma scanner"
      const stopBtn = containerEl.querySelector('button');
      if (stopBtn) containerEl.insertBefore(btn, stopBtn);
      else containerEl.appendChild(btn);

    } catch (e) {
      // getRunningTrackCapabilities non disponibile o ha lanciato eccezione — ignora
    }
  }

  /**
   * Rimuove il pulsante torcia dal container.
   * Chiamare prima di ogni riavvio dello scanner per evitare duplicati.
   *
   * @param {HTMLElement} containerEl
   */
  function removeTorch(containerEl) {
    const btn = containerEl && containerEl.querySelector('.torch-btn');
    if (btn) btn.remove();
  }

  function _torchIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'style="width:16px;height:16px;vertical-align:middle;margin-right:5px">' +
      '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
  }

  return { SCAN_CONFIG, CAMERA_CONSTRAINTS, initTorch, removeTorch };
})();
