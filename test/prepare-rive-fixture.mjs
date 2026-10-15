import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const directory=process.argv[2];
if(!directory)throw new Error('Usage: node test/prepare-rive-fixture.mjs OUTPUT_DIRECTORY');
const revision='6fe233bf3e81d0d147b4e18a68abde72124765f4';
const source='https://raw.githubusercontent.com/rive-app/rive-wasm/'+revision+'/';
const assetURL=source+'js/examples/_frameworks/parcel_example_canvas/ball.riv';
const licenseURL=source+'LICENSE';
const expectedSHA256='fc528ee6da313fc8dedf3ea72ac00a5a31e12b942e7e522cba32556a50e629db';
const expectedLicenseBlob='92a1c4bf6fe93178fba99689f4002fd37909c940';
async function download(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('Fixture download failed: HTTP '+response.status+' '+url);
  return Buffer.from(await response.arrayBuffer());
}
const [asset,license]=await Promise.all([download(assetURL),download(licenseURL)]);
const sha256=createHash('sha256').update(asset).digest('hex');
assert.equal(sha256,expectedSHA256,'Rive fixture SHA256 mismatch');
const licenseBlob=createHash('sha1').update('blob '+license.length+'\0').update(license).digest('hex');
assert.equal(licenseBlob,expectedLicenseBlob,'Pinned upstream license content mismatch');
const output=resolve(directory),fixturePath=resolve(output,'ball.riv'),licensePath=resolve(output,'LICENSE.rive-wasm');
await mkdir(output,{recursive:true});
await writeFile(fixturePath,asset);await writeFile(licensePath,license);
const provenance={revision,assetURL,licenseURL,sha256,bytes:asset.length,fixturePath,licensePath};
await writeFile(resolve(output,'rive-fixture.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify(provenance,null,2));
