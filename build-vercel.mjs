import './build-standalone.mjs';
import {cp,mkdir,copyFile,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await cp('public','dist',{recursive:true});
await mkdir('dist/collection',{recursive:true});
await copyFile('public/index.html','dist/collection/index.html');
await copyFile('public/VeilDrop-Decoder-Offline.html','dist/offline.html');
