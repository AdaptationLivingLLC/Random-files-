import { wordCount, decrypt, readPayload, decodeEmoji } from './codec.js';
import { prepareVeil, openVeil, validateVeil, encode64, decode64 } from './veil.js';
import { $, standalone, ui, notify, api, imageFrom, loadKey, initTheme } from './common.js';
let authenticated = false, epoch = 0, decoderDescriptor = null, prepared = null, openingPassphrase = '', decryptedFileURL = null;
let sourceDirectory = null, sourceName = null, sourceDigest = null, pendingDirectory = null, fileEraseTimer = null;
let payload = null, readable = null, held = false, opening = false, opened = false;
let pointer = {x:0,y:0}, deadline = 0, animation = null, lastActivity = performance.now();
const watermark = [...crypto.getRandomValues(new Uint8Array(3))].map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase();
function show(section) {
  if (section !== 'collection') clearReader();
  for (const id of ['home','collection']) $(id).hidden = id !== section;
  if (!standalone) history.replaceState(null,'',section === 'collection' ? '/collection' : '/');
  window.scrollTo(0,0); lastActivity = performance.now();
}
function blank() {
  const canvas = $('reveal-canvas'), ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
}
function clearReader() {
  $('emoji-input').value = ''; $('emoji-input-panel').hidden = false;
  clearTimeout(fileEraseTimer); fileEraseTimer = null; sourceDirectory = null; sourceName = null; sourceDigest = null; pendingDirectory = null; $('delete-folder-files').hidden = true; $('delete-source-name').replaceChildren();
  epoch++; prepared?.stretched?.fill(0); prepared = null; decoderDescriptor?.fill(0); decoderDescriptor = null; openingPassphrase = '';
  $('open-passphrase').value = ''; $('decoder-key-upload').value = ''; $('decoder-key-status').textContent = 'Key file required';
  $('unlock-panel').hidden = true; $('file-result').hidden = true; $('save-file').removeAttribute('href'); if (decryptedFileURL) URL.revokeObjectURL(decryptedFileURL); decryptedFileURL = null;
  readable = null; payload = null; held = false; opened = false; opening = false; deadline = 0;
  cancelAnimationFrame(animation); animation = null; blank();
  $('card-upload').value = ''; $('dropzone').hidden = false; $('reveal-panel').hidden = true; $('reader-instruction').hidden = false;
  $('progress').style.width = '100%'; $('remaining').textContent = '—'; $('reader-state').textContent = 'READY / HOLD TO REVEAL';
}
function endReading(label = 'THIS MOMENT HAS PASSED') {
  readable = null; payload = null; openingPassphrase = ''; prepared?.stretched?.fill(0); prepared = null; decoderDescriptor?.fill(0); decoderDescriptor = null; held = false; blank(); cancelAnimationFrame(animation); animation = null;
  $('reader-state').textContent = label; $('remaining').textContent = '0.0s'; $('progress').style.width = '0%';
  $('reader-instruction').hidden = false; $('reader-instruction').querySelector('strong').textContent = 'This moment has passed.';
  $('reader-instruction').querySelector('small').textContent = 'This viewing session has ended.';
}
function logout() {
  const wasAuthenticated = authenticated;
  clearReader(); authenticated = false; $('password').value = ''; $('login').hidden = standalone; show('home');
  if (wasAuthenticated && !standalone) api('logout',{},true).catch(() => {});
}
$('collection-link').onclick = $('start').onclick = () => show('collection');
$('login').onsubmit = async event => {
  event.preventDefault(); const version = epoch; const button = $('login').querySelector('button'); button.disabled = true;
  try { await api('login', { password: $('password').value }); $('password').value = ''; if (version !== epoch) { if (!standalone) api('logout', {}, true).catch(() => {}); return; }
    authenticated = true; lastActivity = performance.now(); $('login').hidden = true; $('reader').hidden = false;
  } catch (error) { $('password').value = ''; notify(error.message); } finally { button.disabled = false; }
};
async function loadCard(file, deleteSource = null, emojiEnvelope = null) {
  clearReader(); const version = epoch;
  if (deleteSource) { sourceDirectory = deleteSource.directory; sourceName = deleteSource.name; }
  try {
    if (!emojiEnvelope && (!file || file.size > 25000000)) throw new Error('Choose a PNG or .veil package smaller than 25 MB.');
    if (deleteSource) sourceDigest = encode64(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())));
    let extracted;
    if (emojiEnvelope) extracted = validateVeil(emojiEnvelope);
    else if (file.name.toLowerCase().endsWith('.veil') || file.type === 'application/json' || file.type === 'application/vnd.veildrop+json') extracted = validateVeil(JSON.parse(await file.text()));
    else { const bitmap = await imageFrom(file, true), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close(); extracted = readPayload(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)); canvas.width = canvas.height = 1; if (extracted.version === 2) validateVeil(extracted); }
    if (version !== epoch) return;
    if (deleteSource && extracted.mode !== 'offline') throw new Error('Source auto-delete is only available for offline vault packages.');
    if (standalone && extracted.mode !== 'offline') throw new Error('Expiring cards must be opened on the online decoder.');
    payload = extracted; $('dropzone').hidden = true; $('emoji-input-panel').hidden = true;
    if (payload.version === 2) {
      $('unlock-panel').hidden = false; $('package-mode').textContent = payload.mode === 'offline' ? 'VAULT / OFFLINE ACCESS' : 'FLEETING / ONE-TIME ACCESS';
      $('unlock-help').textContent = payload.mode === 'offline' ? 'No server is contacted. Text clears when its timer expires. Retained copies can still be reopened with their key file and passphrase.' : 'Enter the daily access code above, then provide the key file and original passphrase. The timer starts only when you hold to reveal.';
      $('reader-retention').textContent = payload.mode === 'offline' ? 'OFFLINE / RETAINED PACKAGES CAN BE REOPENED' : 'ONE MOMENT. ONE OPENING.';
    } else { if (!authenticated) throw new Error('Enter the daily access code before opening this legacy card.'); $('reveal-panel').hidden = false; }
    $('reader-instruction').querySelector('strong').textContent = 'Hold to find the words.';
    $('reader-instruction').querySelector('small').textContent = 'Move your finger. Release to cover. The timer begins on your first hold.';
  } catch (error) { payload = null; sourceDirectory = null; sourceName = null; $('dropzone').hidden = false; notify(error.message); }
}
$('load-emoji').onclick = async () => { try { const envelope = decodeEmoji($('emoji-input').value); await loadCard(null, null, envelope); } catch (error) { notify(error.message); } };
$('card-upload').onchange = event => loadCard(event.target.files[0]);
$('choose-delete-folder').onclick = async () => {
  if (!window.showDirectoryPicker) return notify('This browser cannot delete source files. Use a supported desktop browser, or delete the original manually.');
  try {
    const directory = await window.showDirectoryPicker({ id: 'veildrop-source', mode: 'readwrite' });
    const names = []; for await (const [name, handle] of directory.entries()) { if (handle.kind === 'file' && /\.(veil|png)$/i.test(name)) names.push(name); if (names.length >= 100) break; }
    if (!names.length) return notify('No PNG or .veil files were found in that folder.');
    clearReader(); pendingDirectory = directory; names.sort(); for (const name of names) { const option = document.createElement('option'); option.value = name; option.textContent = name; $('delete-source-name').append(option); }
    $('delete-folder-files').hidden = false;
  } catch (error) { if (error.name !== 'AbortError') notify('Folder access was not granted.'); }
};
$('load-delete-source').onclick = async () => {
  if (!pendingDirectory) return; const directory = pendingDirectory, name = $('delete-source-name').value;
  try { const handle = await directory.getFileHandle(name); await loadCard(await handle.getFile(), { directory, name }); } catch { notify('Unable to open the selected file.'); }
};
$('decoder-key-upload').onchange = async event => { const version = epoch; try { const key = await loadKey(event.target.files[0]); if (version !== epoch) { key.fill(0); return; } decoderDescriptor?.fill(0); decoderDescriptor = key; $('decoder-key-status').textContent = 'Key file ready'; } catch (error) { notify(error.message); } finally { event.target.value = ''; } };
$('unlock').onclick = async () => {
  if (!payload || !decoderDescriptor) return notify('Choose the matching conversation key file.');
  if (payload.mode === 'timed' && !authenticated) return notify('Enter the daily access code above first.');
  const version = epoch; $('unlock').disabled = true;
  try {
    prepared?.stretched?.fill(0); prepared = await prepareVeil(payload, decoderDescriptor, $('open-passphrase').value);
    if (version !== epoch) { prepared.stretched.fill(0); prepared = null; return; }
    openingPassphrase = $('open-passphrase').value; $('open-passphrase').value = '';
    if (payload.mode === 'offline') {
      const content = await openVeil(payload, decoderDescriptor, openingPassphrase, null, prepared); prepared = null; openingPassphrase = ''; decoderDescriptor?.fill(0); decoderDescriptor = null;
      if (version !== epoch) return;
      if (sourceDirectory && sourceName) {
        try {
          const current = await (await sourceDirectory.getFileHandle(sourceName)).getFile();
          const digest = encode64(new Uint8Array(await crypto.subtle.digest('SHA-256', await current.arrayBuffer())));
          if (digest !== sourceDigest) throw new Error('File changed');
          await sourceDirectory.removeEntry(sourceName);
        } catch { throw new Error('The original could not be deleted. Viewing was stopped; check folder permissions.'); }
        sourceDirectory = null; sourceName = null; sourceDigest = null; notify('Original encrypted file deleted from the selected folder.');
      }
      if (version !== epoch) return;
      if (content.kind === 'file') {
        const bytes = decode64(content.data); const blob = new Blob([bytes], { type: 'application/octet-stream' }); bytes.fill(0);
        if (decryptedFileURL) URL.revokeObjectURL(decryptedFileURL); decryptedFileURL = URL.createObjectURL(blob);
        $('save-file').href = decryptedFileURL; $('save-file').download = content.name.replace(/[\/\u0000-\u001f]/g, '_').slice(0, 200) || 'decrypted-file';
        $('decrypted-name').textContent = content.name; $('file-result').hidden = false; $('unlock-panel').hidden = true; payload = null; fileEraseTimer = setTimeout(() => { clearReader(); notify('Decrypted file cleared from this session after 30 seconds.'); }, 30000); return;
      }
      if (content.duration !== Math.ceil(wordCount(content.text) / 5) * 2000 || !content.duration) throw new Error('Invalid message lifetime.');
      readable = content;
    }
    $('unlock-panel').hidden = true; $('reveal-panel').hidden = false; $('reader-state').textContent = 'READY / HOLD TO REVEAL';
  } catch (error) { prepared?.stretched?.fill(0); prepared = null; openingPassphrase = ''; notify(error.message); }
  finally { $('unlock').disabled = false; }
};
function linesFor(ctx, text, width) {
  const words = text.split(/\s+/u), lines = []; let line = '';
  for (const word of words) { const next = line ? line + ' ' + word : word;
    if (ctx.measureText(next).width <= width) { line = next; continue; }
    if (line) lines.push(line); line = '';
    // Break unusually long words to keep them reachable on small screens.
    for (const letter of word) { if (ctx.measureText(line + letter).width > width && line) { lines.push(line); line = ''; } line += letter; }
  }
  if (line) lines.push(line); return lines;
}
function drawReveal() {
  if (!readable) return;
  const surface = $('reveal-surface'), canvas = $('reveal-canvas');
  const w = surface.clientWidth, scale = Math.min(devicePixelRatio || 1, 2), font = ui.theme === 'terminal' ? '18px monospace' : '20px Georgia';
  let c = canvas.getContext('2d'); c.font = font; const lines = linesFor(c, readable.text, w - 56);
  const h = Math.max(420, lines.length * 30 + 80); surface.style.height = h + 'px';
  const pixelW = Math.round(w * scale), pixelH = Math.round(h * scale);
  if (canvas.width !== pixelW || canvas.height !== pixelH) { canvas.width = pixelW; canvas.height = pixelH; }
  c = canvas.getContext('2d'); c.setTransform(scale, 0, 0, scale, 0, 0); c.clearRect(0, 0, w, h);
  if (!held) return;
  c.save(); c.beginPath(); c.arc(pointer.x, pointer.y, 62, 0, 2 * Math.PI); c.clip();
  c.fillStyle = ui.theme === 'terminal' ? '#071016' : '#f3f0e8'; c.fillRect(0, 0, w, h);
  c.fillStyle = ui.theme === 'terminal' ? '#dcf5ed' : '#242520'; c.font = font; c.textBaseline = 'top';
  lines.forEach((line, i) => c.fillText(line, 28, 40 + i * 30));
  c.save(); c.globalAlpha = .15; c.fillStyle = ui.theme === 'terminal' ? '#36d8ff' : '#242520'; c.translate(pointer.x, pointer.y); c.rotate(-Math.PI / 7); c.font = '10px monospace'; c.fillText('VEILDROP / ' + watermark, -50, 22); c.restore(); c.restore();
  c.strokeStyle = ui.theme === 'terminal' ? '#36d8ff' : '#77776b'; c.lineWidth = 1; c.beginPath(); c.arc(pointer.x, pointer.y, 62, 0, 2 * Math.PI); c.stroke();
}
function tick() {
  if (!readable) return;
  const remaining = deadline - performance.now(); if (remaining <= 0) return endReading();
  $('remaining').textContent = (remaining / 1000).toFixed(1) + 's'; $('progress').style.width = Math.max(0, remaining / readable.duration * 100) + '%';
  drawReveal(); animation = requestAnimationFrame(tick);
}
async function beginOpen() {
  if (!payload || opening || opened) return;
  if (payload.mode === 'timed' && !authenticated) return;
  opening = true; opened = true; const version = epoch, start = performance.now();
  $('reader-state').textContent = 'OPENING / PREPARED ACCESS';
  let secret;
  try {
    let duration;
    if (payload.mode === 'offline') { duration = readable.duration; payload = null; }
    else {
      const access = await api('open', { id: payload.id });
      if (version !== epoch) return;
      let decoded;
      if (payload.version === 2) { secret = decode64(access.key); decoded = await openVeil(payload, decoderDescriptor, openingPassphrase, secret, prepared); prepared = null; }
      else decoded = await decrypt(payload, access.key);
      access.key = ''; secret?.fill(0); openingPassphrase = ''; decoderDescriptor?.fill(0); decoderDescriptor = null;
      if (version !== epoch) return;
      if (typeof decoded.text !== 'string' || decoded.duration !== access.duration || decoded.duration !== Math.ceil(wordCount(decoded.text) / 5) * 2000) throw new Error('The card failed its integrity check.');
      readable = decoded; duration = access.duration; payload = null;
    }
    deadline = start + duration; $('reader-instruction').hidden = true; $('reader-state').textContent = 'OPEN / THE CLOCK IS RUNNING'; tick();
  } catch (error) { if (version === epoch) { endReading('UNAVAILABLE'); notify(error.message); } }
  finally { secret?.fill(0); if (version === epoch) opening = false; }
}
const surface = $('reveal-surface');
function locate(event) { const r = surface.getBoundingClientRect(); pointer = { x: event.clientX - r.left, y: event.clientY - r.top }; }
surface.onpointerdown = event => { if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return; event.preventDefault(); held = true; locate(event); surface.setPointerCapture(event.pointerId); beginOpen(); drawReveal(); };
surface.onpointermove = event => { if (held && event.isPrimary) { locate(event); drawReveal(); } };
function release() { held = false; blank(); }
surface.onpointerup = surface.onpointercancel = surface.onlostpointercapture = release;
surface.oncontextmenu = event => event.preventDefault();
surface.onkeydown = event => { if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); held = true; if (!pointer.x) pointer = { x: surface.clientWidth / 2, y: 70 }; beginOpen(); drawReveal(); }
  else if (held && event.code.startsWith('Arrow')) { event.preventDefault(); pointer.x += event.code === 'ArrowRight' ? 25 : event.code === 'ArrowLeft' ? -25 : 0; pointer.y += event.code === 'ArrowDown' ? 25 : event.code === 'ArrowUp' ? -25 : 0; drawReveal(); } };
surface.onkeyup = event => { if (event.code === 'Space' || event.code === 'Enter') release(); };
surface.onblur = release;
document.querySelectorAll('.exit').forEach(button => button.onclick = logout);
for (const event of ['pointerdown','keydown','input']) document.addEventListener(event, () => { lastActivity = performance.now(); }, {passive:true});
setInterval(() => { if ((!$('collection').hidden || authenticated) && performance.now()-lastActivity >= 120000) { logout(); notify('Session cleared after inactivity.'); } },1000);
setInterval(() => { if (authenticated && !standalone && performance.now()-lastActivity < 120000) api('heartbeat',{}).catch(logout); },45000);
document.addEventListener('session-ended', () => { authenticated = false; $('login').hidden = standalone; clearReader(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) logout(); });
window.addEventListener('pagehide', () => { const active = authenticated; clearReader(); $('password').value = ''; if (active && !standalone) navigator.sendBeacon('/api/logout',new Blob(['{}'],{type:'application/json'})); });
window.addEventListener('pageshow', event => { if (event.persisted) logout(); });
window.addEventListener('blur',release);
window.addEventListener('beforeprint', () => { if (readable) endReading('CLEARED'); });
document.addEventListener('copy', event => { if (!$('reveal-panel').hidden) { event.preventDefault(); event.clipboardData?.setData('text/plain',''); } });
document.addEventListener('keydown', event => { if (event.key === 'PrintScreen' && readable) endReading('CLEARED'); });
window.addEventListener('resize', () => { if (readable) drawReveal(); });
document.querySelector('.wordmark').onclick = event => { event.preventDefault(); show('home'); };
initTheme(); $('login').hidden = standalone; show('collection');
