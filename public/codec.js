const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const b64 = bytes => btoa(String.fromCharCode(...bytes));
export const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
export const wordCount = text => text.trim().split(/\s+/u).filter(Boolean).length;
const MAGIC = [83, 84, 73, 76, 76, 1];
export function writePayload(image, object) {
  const bytes = encoder.encode(JSON.stringify(object));
  const header = new Uint8Array(10); header.set(MAGIC); new DataView(header.buffer).setUint32(6, bytes.length);
  const payload = new Uint8Array(header.length + bytes.length); payload.set(header); payload.set(bytes, header.length);
  if (payload.length * 8 > image.data.length / 4 * 3) throw new Error('Choose a larger cover image.');
  let bit = 0;
  for (let i = 0; i < image.data.length && bit < payload.length * 8; i++) {
    if (i % 4 === 3) continue;
    image.data[i] = (image.data[i] & 254) | ((payload[bit >> 3] >> (7 - (bit & 7))) & 1); bit++;
  }
  return image;
}
export function readPayload(image) {
  const capacity = Math.floor(image.data.length / 4 * 3 / 8);
  if (capacity < 10) throw new Error('This image does not contain a Still card.');
  function read(n) { const out = new Uint8Array(n); let bit = 0; for (let i = 0; bit < n * 8; i++) { if (i % 4 === 3) continue; out[bit >> 3] |= (image.data[i] & 1) << (7 - (bit & 7)); bit++; } return out; }
  const header = read(10); if (MAGIC.some((v, i) => v !== header[i])) throw new Error('This image does not contain a Still card. Send the original PNG file without resizing.');
  const size = new DataView(header.buffer).getUint32(6); if (!size || size > capacity - 10 || size > 17000000) throw new Error('The card is damaged.');
  const value = JSON.parse(decoder.decode(read(size + 10).subarray(10)));
  if (value.format === 'VeilDrop' && value.version === 2) return value;
  if (value.v !== 1 || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(value.id) || typeof value.iv !== 'string' || typeof value.ciphertext !== 'string') throw new Error('The card is damaged.');
  if (unb64(value.iv).length !== 12 || unb64(value.ciphertext).length < 16) throw new Error('The card is damaged.');
  return value;
}
export async function encrypt(text, duration) {
  const bytes = encoder.encode(JSON.stringify({ text, duration }));
  const key = crypto.getRandomValues(new Uint8Array(32)); const iv = crypto.getRandomValues(new Uint8Array(12));
  try { const imported = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, imported, bytes));
    return { key, iv: b64(iv), ciphertext: b64(ciphertext) };
  } finally { bytes.fill(0); }
}
export async function decrypt(payload, encodedKey) {
  const bytes = unb64(encodedKey);
  try { const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(payload.iv) }, key, unb64(payload.ciphertext)));
    try { return JSON.parse(decoder.decode(plain)); } finally { plain.fill(0); }
  } finally { bytes.fill(0); }
}

// Encrypted bytes are carried by Unicode variation selectors after the visible emoji.
const emojiMagic = [86,69,73,76,69,77,79,74,73,2];
const emojiSelector = n => String.fromCodePoint(n < 16 ? 0xfe00 + n : 0xe0100 + n - 16);
const emojiMarker = emojiMagic.map(emojiSelector).join('');
export function encodeEmoji(envelope, carrier = '🙂') {
  if (typeof carrier !== 'string' || !carrier.trim() || [...carrier].length > 32 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(carrier)) throw new Error('Choose an emoji from the bank or your emoji keyboard.');
  const bytes = new TextEncoder().encode(JSON.stringify(envelope));
  if (!bytes.length || bytes.length > 65536) throw new Error('This message is too large for an emoji. Choose a .veil package.');
  const framed = new Uint8Array(bytes.length + 4);
  new DataView(framed.buffer).setUint32(0, bytes.length); framed.set(bytes, 4);
  return carrier.trim() + emojiMarker + Array.from(framed, emojiSelector).join('');
}
export function decodeEmoji(text) {
  if (typeof text !== 'string' || text.length > 200000) throw new Error('Paste one encrypted emoji.');
  const start = text.indexOf(emojiMarker);
  if (start < 0) throw new Error('No hidden message found. Paste the copied emoji text, not a screenshot or a retyped emoji.');
  if (text.indexOf(emojiMarker, start + emojiMarker.length) >= 0) throw new Error('Paste only one encrypted emoji at a time.');
  const bytes = [];
  for (const ch of text.slice(start + emojiMarker.length)) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xfe00 && cp <= 0xfe0f) bytes.push(cp - 0xfe00);
    else if (cp >= 0xe0100 && cp <= 0xe01ef) bytes.push(cp - 0xe0100 + 16);
    else break;
    if (bytes.length > 65540) throw new Error('The emoji message is too large.');
  }
  if (bytes.length < 4) throw new Error('The hidden message is incomplete. Copy the original emoji again.');
  const data = Uint8Array.from(bytes), size = new DataView(data.buffer).getUint32(0);
  if (!size || size > 65536 || data.length < size + 4) throw new Error('The hidden message is incomplete. This app may have removed hidden characters.');
  try {
    const envelope = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(4, size + 4)));
    if (envelope.format !== 'VeilDrop' || envelope.version !== 2) throw new Error();
    return envelope;
  } catch { throw new Error('The hidden message is damaged or unsupported.'); }
}
