import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeEmoji,decodeEmoji} from '../public/codec.js';
import {newDescriptor,sealVeil,openVeil} from '../public/veil.js';
test('emoji text preserves authenticated ciphertext across carrier types',async()=>{
 const key=await newDescriptor(), pass='a test passphrase only';
 const original={kind:'text',text:'one two three four five six seven eight nine ten',duration:4000};
 const {envelope}=await sealVeil(original,key.key,pass,'offline');
 for(const carrier of ['🙂','❤️','👨‍👩‍👧‍👦','🇨🇭','👍🏽','1️⃣','🦋']) {
  const encoded=encodeEmoji(envelope,carrier);
  assert(encoded.startsWith(carrier)); assert(!encoded.includes(original.text));
  assert.deepEqual(await openVeil(decodeEmoji('hello '+encoded+' bye'),key.key,pass),original);
  assert.deepEqual(decodeEmoji(encoded.normalize('NFC')),envelope);
  assert.throws(()=>decodeEmoji(encoded.slice(0,-8)));
 }
 await assert.rejects(()=>openVeil(decodeEmoji(encodeEmoji(envelope)),key.key,'wrong test password'));
 assert.throws(()=>decodeEmoji('🙂')); assert.throws(()=>decodeEmoji(encodeEmoji(envelope)+encodeEmoji(envelope)));
 assert.throws(()=>encodeEmoji(envelope,'plain text'));
});
