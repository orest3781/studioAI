'use strict';
// Read-only comparison of the two release payloads; never executes either binary.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const base = path.resolve(__dirname, '..');
const roots = ['0.1.0','0.1.1'].map(v => path.join(base, 'dist-manual', v, 'win-unpacked'));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function inventory(root, rel='') {
  return Object.fromEntries(fs.readdirSync(path.join(root,rel), {withFileTypes:true}).flatMap(entry => {
    const file = path.join(rel,entry.name);
    return entry.isDirectory() ? Object.entries(inventory(root,file)) : [[file, hash(fs.readFileSync(path.join(root,file)))]];
  }));
}
function pe(file) {
  const b = fs.readFileSync(file), offset=b.readUInt32LE(0x3c);
  if (b.toString('ascii',offset,offset+4)!=='PE\0\0') throw new Error('Not a PE executable');
  const count=b.readUInt16LE(offset+6), optional=offset+24, size=b.readUInt16LE(offset+20);
  const directory=optional+(b.readUInt16LE(optional)===0x20b?112:96);
  const sections=[];
  for (let i=0;i<count;i++) {
    const s=optional+size+i*40, start=b.readUInt32LE(s+20), length=b.readUInt32LE(s+16);
    sections.push({name:b.toString('ascii',s,s+8).replace(/\0/g,''),size:length,sha256:hash(b.subarray(start,start+length))});
  }
  return {sha256:hash(b),machine:b.readUInt16LE(offset+4),dllCharacteristics:b.readUInt16LE(optional+70),
    certificateTableSize:b.readUInt32LE(directory+4*8+4), sections};
}
const inventories=roots.map(root=>inventory(root));
const files=[...new Set(inventories.flatMap(Object.keys))].sort();
const differences=files.filter(f=>inventories[0][f]!==inventories[1][f]);
const archives=roots.map(root=>path.join(root,'resources/app.asar'));
const names=[...new Set(archives.flatMap(file=>asar.listPackage(file)))];
const archiveDifferences=[];
for(const name of names) {
  const relative=name.replace(/^[/\\]/,'');
  const contents=archives.map(file=>{try {return asar.extractFile(file,relative);} catch {return null;}});
  if(contents.every(value=>value===null)) continue;
  if(contents.some(value=>value===null)||hash(contents[0])!==hash(contents[1])) archiveDifferences.push(relative);
}
const packages=archives.map(file=>JSON.parse(asar.extractFile(file,'package.json').toString()));
const packageFields=[...new Set(packages.flatMap(Object.keys))].filter(key=>JSON.stringify(packages[0][key])!==JSON.stringify(packages[1][key]));
const binaries=roots.map(root=>pe(path.join(root,'StudioAI.exe')));
const report={comparedFiles:files.length,differingFiles:differences,archiveDifferences,changedPackageFields:packageFields,
  binaries,changedSections:binaries[0].sections.filter((section,i)=>section.sha256!==binaries[1].sections[i]?.sha256).map(s=>s.name)};
const output=path.join(base,'upgrade-validation/security-diagnosis'); fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'release-comparison.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({comparedFiles:report.comparedFiles,differingFiles:differences,archiveDifferences,changedPackageFields:packageFields,changedSections:report.changedSections,binaryHashes:binaries.map(b=>b.sha256),certificateTableSizes:binaries.map(b=>b.certificateTableSize)},null,2));
