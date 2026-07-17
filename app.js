(function(){
  'use strict';

  var STORAGE_KEY = 'garageLogCollection';

  /* ---------------- State ---------------- */
  var collection = loadCollection();
  var tesseractWorker = null;
  var workerReady = false;
  var streamRef = null;
  var videoTrack = null;

  var zoom = {
    hardwareSupported: false,
    min: 1,
    max: 1,
    step: 0.1,
    current: 1,
    softwareLevel: 1 /* used when hardware zoom is unavailable: 1x / 2x / 3x crop-and-scale */
  };

  /* ---------------- DOM refs ---------------- */
  var video = document.getElementById('video');
  var captureCanvas = document.getElementById('captureCanvas');
  var cropCanvas = document.getElementById('cropCanvas');
  var reticle = document.getElementById('reticle');
  var scanBtn = document.getElementById('scanBtn');
  var statusLine = document.getElementById('statusLine');
  var camError = document.getElementById('camError');
  var camErrorMsg = document.getElementById('camErrorMsg');
  var itemList = document.getElementById('itemList');
  var emptyState = document.getElementById('emptyState');
  var itemCount = document.getElementById('itemCount');
  var exportBtn = document.getElementById('exportBtn');
  var zoomPanel = document.getElementById('zoomPanel');
  var zoomButtons = document.getElementById('zoomButtons');
  var zoomSlider = document.getElementById('zoomSlider');
  var zoomValueLabel = document.getElementById('zoomValueLabel');

  /* ---------------- Storage ---------------- */
  function loadCollection(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    }catch(e){
      console.warn('Could not read saved collection', e);
      return [];
    }
  }

  function saveCollection(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
    }catch(e){
      console.warn('Could not save collection', e);
    }
  }

  /* ---------------- Camera setup ---------------- */
  async function initCamera(){
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      showCamError('This browser does not support camera access.');
      return;
    }
    try{
      var constraints = {
        audio:false,
        video:{
          facingMode:{ ideal:'environment' },
          width:{ ideal:1280 },
          height:{ ideal:960 },
          advanced:[{ focusMode:'continuous' }]
        }
      };
      var stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef = stream;
      videoTrack = stream.getVideoTracks()[0];
      video.srcObject = stream;
      await video.play();

      setupZoomControls();

      setStatus('Camera ready. Loading OCR engine…');
      await initTesseract();
    }catch(err){
      console.error(err);
      showCamError(err && err.message ? err.message : 'Unable to access the camera.');
    }
  }

  function showCamError(msg){
    camError.style.display = 'block';
    camErrorMsg.textContent = msg;
    setStatus('Camera unavailable', 'err');
  }

  /* ---------------- Zoom controls ---------------- */
  function setupZoomControls(){
    var capabilities = null;
    try{
      capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : null;
    }catch(e){
      capabilities = null;
    }

    if(capabilities && capabilities.zoom && typeof capabilities.zoom.max === 'number'){
      /* Hardware zoom is available on this device/browser — drive it with a slider
         plus 1x/2x quick-set buttons via applyConstraints(). */
      zoom.hardwareSupported = true;
      zoom.min = capabilities.zoom.min || 1;
      zoom.max = capabilities.zoom.max;
      zoom.step = capabilities.zoom.step || 0.1;
      zoom.current = clamp(1, zoom.min, zoom.max);

      zoomSlider.min = zoom.min;
      zoomSlider.max = zoom.max;
      zoomSlider.step = zoom.step;
      zoomSlider.value = zoom.current;
      zoomSlider.classList.remove('hidden');

      renderZoomButtons([1, Math.min(2, zoom.max), Math.min(3, zoom.max)].filter(function(v, i, arr){
        return arr.indexOf(v) === i && v <= zoom.max;
      }), applyHardwareZoom);

      zoomSlider.addEventListener('input', function(){
        applyHardwareZoom(parseFloat(zoomSlider.value));
      });

      applyHardwareZoom(zoom.current);
    }else{
      /* No hardware zoom support — fall back to a digital crop-and-scale
         applied to the captured frame at scan time. */
      zoom.hardwareSupported = false;
      zoom.softwareLevel = 1;
      zoomSlider.classList.add('hidden');
      renderZoomButtons([1, 2, 3], applySoftwareZoom);
      applySoftwareZoom(1);
    }

    zoomPanel.classList.remove('hidden');
  }

  function renderZoomButtons(levels, onSelect){
    zoomButtons.innerHTML = '';
    levels.forEach(function(level){
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = (Math.round(level * 10) / 10) + 'x';
      btn.dataset.level = level;
      btn.addEventListener('click', function(){ onSelect(level); });
      zoomButtons.appendChild(btn);
    });
    updateActiveZoomButton(levels[0]);
  }

  function updateActiveZoomButton(activeLevel){
    var buttons = zoomButtons.querySelectorAll('button');
    buttons.forEach(function(btn){
      var lvl = parseFloat(btn.dataset.level);
      btn.classList.toggle('active', Math.abs(lvl - activeLevel) < 0.05);
    });
  }

  async function applyHardwareZoom(value){
    value = clamp(value, zoom.min, zoom.max);
    zoom.current = value;
    zoomSlider.value = value;
    zoomValueLabel.textContent = (Math.round(value * 10) / 10) + 'x';
    updateActiveZoomButton(value);
    try{
      await videoTrack.applyConstraints({ advanced:[{ zoom: value }] });
    }catch(err){
      console.warn('Hardware zoom failed, falling back to software zoom', err);
      zoom.hardwareSupported = false;
      zoomSlider.classList.add('hidden');
      renderZoomButtons([1, 2, 3], applySoftwareZoom);
      applySoftwareZoom(1);
    }
  }

  function applySoftwareZoom(level){
    zoom.softwareLevel = level;
    zoomValueLabel.textContent = level.toFixed(1) + 'x';
    updateActiveZoomButton(level);
  }

  function clamp(v, min, max){
    return Math.min(max, Math.max(min, v));
  }

  /* ---------------- Tesseract setup ---------------- */
  async function initTesseract(){
    try{
      tesseractWorker = await Tesseract.createWorker('eng');
      await tesseractWorker.setParameters({
        tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        tessedit_pageseg_mode:'7' /* treat crop as a single line of text */
      });
      workerReady = true;
      scanBtn.disabled = false;
      setStatus('Ready — aim at a Toy Number and tap SCAN.');
    }catch(err){
      console.error(err);
      setStatus('OCR engine failed to load. Reload the page to retry.', 'err');
    }
  }

  function setStatus(msg, kind){
    statusLine.textContent = msg;
    statusLine.className = 'status-line' + (kind ? ' ' + kind : '');
  }

  /* ---------------- Capture + crop + preprocess ---------------- */
  function captureReticleCrop(){
    var vw = video.videoWidth;
    var vh = video.videoHeight;
    if(!vw || !vh) return null;

    captureCanvas.width = vw;
    captureCanvas.height = vh;
    var ctx = captureCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, vw, vh);

    /* Reticle is 55% width x 24% height, centered — matches CSS. */
    var boxW = vw * 0.55;
    var boxH = vh * 0.24;
    var boxX = (vw - boxW) / 2;
    var boxY = (vh - boxH) / 2;

    /* Small margin so we don't clip character edges. */
    var pad = 0.06;
    boxX -= boxW * pad; boxY -= boxH * pad;
    boxW += boxW * pad * 2; boxH += boxH * pad * 2;

    /* Software zoom fallback: when hardware zoom isn't available, digitally
       crop the center of the bounding box and scale it up — e.g. at 2x we
       keep only the center 50% of the box before upscaling. */
    if(!zoom.hardwareSupported && zoom.softwareLevel > 1){
      var shrink = 1 / zoom.softwareLevel;
      var newW = boxW * shrink;
      var newH = boxH * shrink;
      boxX += (boxW - newW) / 2;
      boxY += (boxH - newH) / 2;
      boxW = newW;
      boxH = newH;
    }

    boxX = Math.max(0, boxX); boxY = Math.max(0, boxY);
    boxW = Math.min(vw - boxX, boxW); boxH = Math.min(vh - boxY, boxH);

    /* Upscale small crops for better OCR accuracy — target a wide crop
       regardless of how tight the software zoom made the source region. */
    var targetWidth = 700;
    var scale = boxW < targetWidth ? (targetWidth / boxW) : 1;
    var outW = Math.round(boxW * scale);
    var outH = Math.round(boxH * scale);

    cropCanvas.width = outW;
    cropCanvas.height = outH;
    var cctx = cropCanvas.getContext('2d');
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(captureCanvas, boxX, boxY, boxW, boxH, 0, 0, outW, outH);

    grayscaleAndBinarize(cctx, outW, outH);

    return cropCanvas;
  }

  /* Convert to grayscale, then binarize with an Otsu-derived threshold so
     colored (e.g. red) or low-contrast text on cardboard becomes solid
     black text on a clean white background for Tesseract. */
  function grayscaleAndBinarize(ctx, w, h){
    var imgData = ctx.getImageData(0, 0, w, h);
    var data = imgData.data;
    var n = w * h;

    var gray = new Uint8ClampedArray(n);
    var histogram = new Array(256).fill(0);

    var i, p, g;
    for(i = 0, p = 0; i < data.length; i += 4, p++){
      g = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
      gray[p] = g;
      histogram[Math.round(g)]++;
    }

    var threshold = otsuThreshold(histogram, n);

    var blackCount = 0;
    for(p = 0; p < n; p++){
      if(gray[p] <= threshold) blackCount++;
    }
    /* If more than half the crop ended up black, the box likely framed a
       dark background — invert so the final image is black text on white. */
    var invert = blackCount > n / 2;

    for(i = 0, p = 0; i < data.length; i += 4, p++){
      var isDark = gray[p] <= threshold;
      if(invert) isDark = !isDark;
      var v = isDark ? 0 : 255;
      data[i] = data[i+1] = data[i+2] = v;
    }

    ctx.putImageData(imgData, 0, 0);
  }

  function otsuThreshold(histogram, total){
    var sum = 0, t;
    for(t = 0; t < 256; t++) sum += t * histogram[t];

    var sumB = 0, wB = 0, wF = 0, maxVariance = 0, threshold = 0;
    for(t = 0; t < 256; t++){
      wB += histogram[t];
      if(wB === 0) continue;
      wF = total - wB;
      if(wF === 0) break;
      sumB += t * histogram[t];
      var meanB = sumB / wB;
      var meanF = (sum - sumB) / wF;
      var between = wB * wF * (meanB - meanF) * (meanB - meanF);
      if(between > maxVariance){
        maxVariance = between;
        threshold = t;
      }
    }
    return threshold;
  }

  /* ---------------- Scan flow ---------------- */
  async function handleScan(){
    if(!workerReady || scanBtn.disabled) return;

    var crop = captureReticleCrop();
    if(!crop){
      setStatus('Camera not ready yet — try again in a moment.', 'err');
      return;
    }

    scanBtn.disabled = true;
    scanBtn.classList.add('busy');
    reticle.classList.add('scanning');
    setStatus('Reading code…');

    try{
      var result = await tesseractWorker.recognize(crop);
      var raw = (result && result.data && result.data.text) ? result.data.text : '';
      var code = extractCode(raw);

      if(code){
        addOrIncrement(code);
        setStatus('Scanned ' + code + '.', 'ok');
      }else{
        setStatus('No valid code found — steady the shot and try again.', 'err');
      }
    }catch(err){
      console.error(err);
      setStatus('Scan failed. Try again.', 'err');
    }finally{
      scanBtn.disabled = false;
      scanBtn.classList.remove('busy');
      reticle.classList.remove('scanning');
    }
  }

  /* Pull a plausible Hot Wheels Toy Number out of raw OCR text, discarding
     whitespace and any short noise tokens (stamps like "21A", stray single
     characters, etc). Toy Numbers are typically 5-7 alphanumeric characters,
     most often 2-3 letters followed by 2-3 digits (e.g. HYW53, HKG34). */
  function extractCode(rawText){
    var strictPattern = /^[A-Z]{2,3}[0-9]{2,3}$/;
    var genericPattern = /^[A-Z0-9]{5,7}$/;

    /* Pass 1: check whitespace-delimited tokens individually first, so a
       separate stamp (e.g. "21A") sitting next to the real code on the same
       line can't get glued onto it. */
    var tokens = rawText
      .toUpperCase()
      .split(/\s+/)
      .map(function(t){ return t.replace(/[^A-Z0-9]/g, ''); })
      .filter(Boolean);

    var strictToken = tokens.find(function(t){
      return strictPattern.test(t) && t.length >= 5 && t.length <= 7;
    });
    if(strictToken) return strictToken;

    var genericToken = tokens.find(function(t){
      return genericPattern.test(t) && /[A-Z]/.test(t) && /[0-9]/.test(t);
    });
    if(genericToken) return genericToken;

    /* Pass 2 (fallback): OCR sometimes drops the space between the code and
       nearby noise, so also scan the fully concatenated string for a
       plausible run — this still filters out pure single-character noise
       like "2", "4", or "A". */
    var cleaned = rawText.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if(!cleaned) return null;

    var strictMatches = cleaned.match(/[A-Z]{2,3}[0-9]{2,3}/g) || [];
    var strictHit = strictMatches.find(function(m){ return m.length >= 5 && m.length <= 7; });
    if(strictHit) return strictHit;

    var genericMatches = cleaned.match(/[A-Z0-9]{5,7}/g) || [];
    var genericHit = genericMatches.find(function(m){
      return /[A-Z]/.test(m) && /[0-9]/.test(m);
    });
    return genericHit || null;
  }

  /* ---------------- Collection logic ---------------- */
  function addOrIncrement(code){
    var existing = collection.find(function(item){ return item.code === code; });
    if(existing){
      existing.quantity += 1;
    }else{
      collection.push({
        code: code,
        scanned_at: new Date().toISOString(),
        quantity: 1
      });
    }
    saveCollection();
    renderCollection();
  }

  function adjustQuantity(code, delta){
    var item = collection.find(function(i){ return i.code === code; });
    if(!item) return;
    item.quantity += delta;
    if(item.quantity <= 0){
      collection = collection.filter(function(i){ return i.code !== code; });
    }
    saveCollection();
    renderCollection();
  }

  function removeItem(code){
    collection = collection.filter(function(i){ return i.code !== code; });
    saveCollection();
    renderCollection();
  }

  function renameItem(oldCode, newCodeRaw){
    var newCode = newCodeRaw.toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
    if(!newCode){ renderCollection(); return; }
    if(newCode === oldCode){ renderCollection(); return; }

    var target = collection.find(function(i){ return i.code === oldCode; });
    if(!target) return;

    var duplicate = collection.find(function(i){ return i.code === newCode; });
    if(duplicate){
      duplicate.quantity += target.quantity;
      collection = collection.filter(function(i){ return i.code !== oldCode; });
    }else{
      target.code = newCode;
    }
    saveCollection();
    renderCollection();
  }

  function formatTimestamp(iso){
    try{
      var d = new Date(iso);
      return d.toLocaleDateString(undefined, { month:'short', day:'numeric' }) + ' ' +
             d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
    }catch(e){
      return '';
    }
  }

  function renderCollection(){
    itemList.innerHTML = '';

    if(collection.length === 0){
      emptyState.style.display = 'block';
      itemList.style.display = 'none';
      exportBtn.disabled = true;
      itemCount.textContent = '0 cars';
      return;
    }

    emptyState.style.display = 'none';
    itemList.style.display = 'block';
    exportBtn.disabled = false;

    var totalUnits = collection.reduce(function(sum, i){ return sum + i.quantity; }, 0);
    itemCount.textContent = totalUnits + (totalUnits === 1 ? ' car' : ' cars') +
      ' · ' + collection.length + (collection.length === 1 ? ' code' : ' codes');

    var sorted = collection.slice().sort(function(a,b){ return a.code.localeCompare(b.code); });

    sorted.forEach(function(item){
      var li = document.createElement('li');
      li.dataset.code = item.code;

      var rowTop = document.createElement('div');
      rowTop.className = 'row-top';

      var codeCell = document.createElement('div');
      codeCell.className = 'row-code';
      var codeText = document.createElement('span');
      codeText.className = 'code-text';
      codeText.textContent = item.code;
      var codeInput = document.createElement('input');
      codeInput.type = 'text';
      codeInput.value = item.code;
      codeInput.maxLength = 20;
      codeCell.appendChild(codeText);
      codeCell.appendChild(codeInput);

      var metaCell = document.createElement('div');
      metaCell.className = 'row-meta';
      metaCell.textContent = 'FIRST SCAN ' + formatTimestamp(item.scanned_at);

      rowTop.appendChild(codeCell);
      rowTop.appendChild(metaCell);

      var rowActions = document.createElement('div');
      rowActions.className = 'row-actions';

      var qtyGroup = document.createElement('div');
      qtyGroup.className = 'qty-group';
      var minusBtn = document.createElement('button');
      minusBtn.className = 'minus';
      minusBtn.textContent = '−';
      minusBtn.setAttribute('aria-label', 'Decrease quantity of ' + item.code);
      var qtyValue = document.createElement('span');
      qtyValue.className = 'qty-value';
      qtyValue.textContent = item.quantity;
      var plusBtn = document.createElement('button');
      plusBtn.className = 'plus';
      plusBtn.textContent = '+';
      plusBtn.setAttribute('aria-label', 'Increase quantity of ' + item.code);
      qtyGroup.appendChild(minusBtn);
      qtyGroup.appendChild(qtyValue);
      qtyGroup.appendChild(plusBtn);

      var rowButtons = document.createElement('div');
      rowButtons.className = 'row-buttons';
      var editBtn = document.createElement('button');
      editBtn.className = 'edit-btn';
      editBtn.textContent = 'Edit';
      var saveBtn = document.createElement('button');
      saveBtn.className = 'save-btn';
      saveBtn.textContent = 'Save';
      var delBtn = document.createElement('button');
      delBtn.className = 'del-btn';
      delBtn.textContent = 'Remove';
      rowButtons.appendChild(editBtn);
      rowButtons.appendChild(saveBtn);
      rowButtons.appendChild(delBtn);

      rowActions.appendChild(qtyGroup);
      rowActions.appendChild(rowButtons);

      li.appendChild(rowTop);
      li.appendChild(rowActions);

      minusBtn.addEventListener('click', function(){ adjustQuantity(item.code, -1); });
      plusBtn.addEventListener('click', function(){ adjustQuantity(item.code, 1); });
      delBtn.addEventListener('click', function(){ removeItem(item.code); });
      editBtn.addEventListener('click', function(){
        li.classList.add('editing');
        codeInput.focus();
        codeInput.select();
      });
      saveBtn.addEventListener('click', function(){
        li.classList.remove('editing');
        renameItem(item.code, codeInput.value);
      });
      codeInput.addEventListener('keydown', function(e){
        if(e.key === 'Enter'){ saveBtn.click(); }
        if(e.key === 'Escape'){ li.classList.remove('editing'); codeInput.value = item.code; }
      });

      itemList.appendChild(li);
    });
  }

  /* ---------------- CSV export ---------------- */
  function escapeCsvField(field){
    var str = String(field).trim();
    if(/[",\n]/.test(str)){
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function exportCsv(){
    if(collection.length === 0) return;

    var rows = [['Model Code', 'Quantity', 'First Scanned']];
    var sorted = collection.slice().sort(function(a,b){ return a.code.localeCompare(b.code); });

    sorted.forEach(function(item){
      rows.push([
        escapeCsvField(item.code),
        escapeCsvField(item.quantity),
        escapeCsvField(formatTimestamp(item.scanned_at))
      ]);
    });

    var csvContent = rows.map(function(r){ return r.join(','); }).join('\n');
    var uri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);

    var link = document.createElement('a');
    link.setAttribute('href', uri);
    link.setAttribute('download', 'garage-log-' + new Date().toISOString().slice(0,10) + '.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /* ---------------- Wire up ---------------- */
  scanBtn.addEventListener('click', handleScan);
  exportBtn.addEventListener('click', exportCsv);

  window.addEventListener('beforeunload', function(){
    if(streamRef){
      streamRef.getTracks().forEach(function(t){ t.stop(); });
    }
    if(tesseractWorker){
      tesseractWorker.terminate();
    }
  });

  /* ---------------- Service worker ---------------- */
  if('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('sw.js').catch(function(err){
        console.warn('Service worker registration failed', err);
      });
    });
  }

  /* ---------------- Boot ---------------- */
  renderCollection();
  initCamera();

})();
