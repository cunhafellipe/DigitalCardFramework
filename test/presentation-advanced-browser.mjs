import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {serveReference} from '../src/static.js';
import path from "node:path";
import assert from "node:assert/strict";
const advancedOnly=process.argv[2]==='--gltf-rive';
if(advancedOnly&&!process.env.RIVE_FIXTURE)throw new Error('Set RIVE_FIXTURE to an approved local ball.riv animation fixture; no asset is downloaded.');
let server;
const [
    playwrightPath,
    url = "http://127.0.0.1:4173/portable.html",
    out = "../PortableCardQA",
  ] = advancedOnly?[undefined,undefined,process.argv[3]??'test-results/advanced-media']:process.argv.slice(2);
await mkdir(out,{recursive:true});
let target=url;
if(advancedOnly){
  const require=createRequire(new URL('../src/presentation/package.json',import.meta.url));
  const bundle=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/presentation/adapters.js',import.meta.url))],bundle:true,format:'esm',platform:'browser',external:['node:*'],write:false});
  const wasm=await readFile(new URL('../src/presentation/node_modules/@rive-app/canvas/rive.wasm',import.meta.url));
  server=createServer(async(request,response)=>{try{
    if(request.url==='/advanced'){response.setHeader('content-type','text/html');response.end('<!doctype html><html><title>GLTF and Rive probe</title><body></body></html>');return;}
    if(request.url==='/adapters-bundle.js'){response.setHeader('content-type','text/javascript');response.end(bundle.outputFiles[0].contents);return;}
    if(request.url==='/rive.wasm'){response.setHeader('content-type','application/wasm');response.end(wasm);return;}
    if(await serveReference(request,response))return;response.writeHead(404).end();
  }catch{response.writeHead(500).end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));target='http://127.0.0.1:'+server.address().port+'/advanced';
}
const engine=process.env.BROWSER_ENGINE??'chromium',errors=[];
let browser;
try {
  const playwright=await import(playwrightPath?pathToFileURL(path.resolve(playwrightPath)).href:'playwright');
  browser=await playwright[engine].launch({headless:true,...(!advancedOnly&&engine==='chromium'?{channel:'msedge'}:{})});
  const page=await browser.newPage({viewport:{width:1000,height:900}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(target);
  if(!advancedOnly)await page.waitForFunction(() => window.portableCards?.ready);
  const rive = Buffer.from(await readFile(advancedOnly?process.env.RIVE_FIXTURE:path.join(out, "ball.riv"))).toString(
    "base64",
  );
  const result = await page.evaluate(async ({rive,advancedOnly}) => {
    const moduleRoot=advancedOnly?'/src/presentation':'/player';
    const { createPlayerStage } = await import(moduleRoot+"/player.js"),
      { buildPackage, browserResolver, writeZip } =
        await import(moduleRoot+"/package.js"),
      { blankPackage } = await import(moduleRoot+"/project.js"),
      { gltfAdapter, riveAdapter, dotLottieAdapter } =
        await import(advancedOnly?'/adapters-bundle.js':"/player/adapters-bundle.js");
    if(!advancedOnly)window.portableCards.stage.dispose();
    const root = document.createElement("div");
    Object.assign(root.style, {
      position: "relative",
      width: "300px",
      height: "450px",
    });
    document.body.prepend(root);
    const base = await blankPackage();
    base.manifest.quality.lite.maxEdge = 512;
    const encode = (o) => new TextEncoder().encode(JSON.stringify(o));
    const geometry = new Float32Array([-0.8, -0.7, 0, 0.8, -0.7, 0, 0, 0.8, 0]),
      json = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [
          { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
        ],
        materials: [
          {
            doubleSided: true,
            pbrMetallicRoughness: {
              baseColorFactor: [1, 0.2, 0.4, 1],
              metallicFactor: 0,
              roughnessFactor: 0.5,
            },
          },
        ],
        buffers: [{ byteLength: geometry.byteLength }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: geometry.byteLength },
        ],
        accessors: [
          {
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: "VEC3",
            min: [-0.8, -0.7, 0],
            max: [0.8, 0.8, 0],
          },
        ],
      };
    const j = encode(json),
      padded = new Uint8Array(Math.ceil(j.length / 4) * 4);
    padded.fill(32);
    padded.set(j);
    const glb = new Uint8Array(28 + padded.length + geometry.byteLength),
      v = new DataView(glb.buffer);
    v.setUint32(0, 0x46546c67, true);
    v.setUint32(4, 2, true);
    v.setUint32(8, glb.length, true);
    v.setUint32(12, padded.length, true);
    v.setUint32(16, 0x4e4f534a, true);
    glb.set(padded, 20);
    v.setUint32(20 + padded.length, geometry.byteLength, true);
    v.setUint32(24 + padded.length, 0x004e4942, true);
    glb.set(new Uint8Array(geometry.buffer), 28 + padded.length);
    const lottie = {
      v: "5.7.0",
      fr: 30,
      ip: 0,
      op: 60,
      w: 300,
      h: 450,
      nm: "Synthetic circle",
      ddd: 0,
      assets: [],
      layers: [
        {
          ddd: 0,
          ind: 1,
          ty: 4,
          nm: "Circle",
          sr: 1,
          ks: {
            o: { a: 0, k: 100 },
            r: { a: 0, k: 0 },
            p: { a: 0, k: [150, 225, 0] },
            a: { a: 0, k: [0, 0, 0] },
            s: { a: 0, k: [100, 100, 100] },
          },
          shapes: [
            {
              ty: "el",
              p: { a: 0, k: [0, 0] },
              s: { a: 0, k: [160, 160] },
              nm: "Circle",
            },
            {
              ty: "fl",
              c: { a: 0, k: [0.1, 0.8, 0.7, 1] },
              o: { a: 0, k: 100 },
              r: 1,
            },
          ],
          ip: 0,
          op: 60,
          st: 0,
          bm: 0,
        },
      ],
    };
    const dot = writeZip(
      new Map([
        [
          "manifest.json",
          encode({ version: "2", animations: [{ id: "main" }] }),
        ],
        ["a/main.json", encode(lottie)],
      ]),
    );
    const reports = [];
    async function probe(name, bytes, type, adapterFactory, data = {}) {
      const manifest = structuredClone(base.manifest),
        assets = new Map(
          base.manifest.assets.map((a) => [a.path, base.files.get(a.path)]),
        );
      manifest.assets.push({
        id: "extra",
        path: "assets/extra.bin",
        mediaType: type,
        sha256: "0".repeat(64),
        bytes: bytes.length,
        role: "interactive",
      });
      assets.set("assets/extra.bin", bytes);
      const scene = {
          dialect: "dc.scene2d@0.1",
          nodes: [
            {
              id: "effect",
              type: "adapter",
              adapter: name,
              x: 0,
              y: 0,
              width: 1000,
              height: 1500,
              data: { asset: "extra", ...data },
            },
          ],
        },
        pkg = await buildPackage(
          manifest,
          new Map([
            ["scenes/front.json", scene],
            ["scenes/back.json", base.scenes.get("scenes/back.json")],
          ]),
          assets,
        );
      if(advancedOnly){
        root.style.width='640px';root.style.display='flex';
        const slots=[0,1].map(()=>{const slot=document.createElement('div');Object.assign(slot.style,{position:'relative',width:'300px',height:'450px',flex:'none'});root.append(slot);return slot;});
        const resolver=browserResolver(pkg),stage=createPlayerStage({root,adapters:[adapterFactory(pkg.digest)],budget:{estimatedGpuBytes:96*1024*1024}}),
          views=slots.map(slot=>stage.mount(slot,{resolver}));
        for(const view of views)if((await view.ready).mode!=='interactive')throw Error(name+' did not enter interactive mode');
        const capture=async view=>{
          const bitmap=await createImageBitmap(await view.snapshot()),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
          const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
          let painted=0;for(let index=3;index<pixels.length;index+=4)if(pixels[index]>20)painted++;
          const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))].join(',');canvas.width=canvas.height=0;return {painted,hash};
        };
        views[0].setInputs({angle:0.1,tilt:{x:-0.7,y:-0.2}});views[1].setInputs({angle:0.35,tilt:{x:0,y:0}});
        const first=await capture(views[0]),other=await capture(views[1]);views[0].setInputs({angle:0.9,tilt:{x:0.7,y:0.2}});
        const changed=await capture(views[0]),independent=await capture(views[1]);
        if(first.painted<100||changed.painted<100||other.painted<100)throw Error(name+' did not paint');
        if(first.hash===changed.hash)throw Error(name+' inputs did not alter pixels');
        if(other.hash!==independent.hash)throw Error(name+' input leaked across instances');
        const poster=await views[0].setQuality('poster');if(poster?.mode!=='poster')throw Error(name+' quality downgrade did not select poster');
        let posterCaptureRejected=false;try{await views[0].snapshot();}catch{posterCaptureRejected=true;}
        if(!posterCaptureRejected)throw Error(name+' poster unexpectedly captured interactive media');
        if((await capture(views[1])).hash!==other.hash)throw Error(name+' downgrade changed independent instance');
        const restored=await views[0].setQuality('standard');if(restored?.mode!=='interactive')throw Error(name+' quality readmission failed');
        if((await capture(views[0])).painted<100)throw Error(name+' readmission did not paint');
        views[0].dispose();const remount=stage.mount(slots[0],{resolver});if((await remount.ready).mode!=='interactive'||(await capture(remount)).painted<100)throw Error(name+' remount failed');
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const frames=stage.diagnostics().frames;await new Promise(resolve=>setTimeout(resolve,100));const idle=stage.diagnostics().frames===frames;
        remount.dispose();views[1].dispose();const after=stage.diagnostics();stage.dispose();resolver.dispose();slots.forEach(slot=>slot.remove());
        const fallback=async adapters=>{
          const slot=document.createElement('div');Object.assign(slot.style,{width:'300px',height:'450px'});root.append(slot);
          const resolver=browserResolver(pkg),stage=createPlayerStage({root,adapters}),view=stage.mount(slot,{resolver}),ready=await view.ready;
          if(ready.mode!=='poster'||!view.element.querySelector('img')?.src)throw Error(name+' unavailable adapter did not use declared poster');
          view.dispose();const released=stage.diagnostics();if(released.assetReferences||released.textures)throw Error(name+' fallback leaked resources');stage.dispose();resolver.dispose();slot.remove();return ready;
        };
        const missingRuntime=await fallback([]),unapproved=name==='dc.rive'?await fallback([riveAdapter({wasmURL:'/rive.wasm',approvedDigests:[]})]):null;
        if(unapproved&&!unapproved.fallbackReason?.includes('approved'))throw Error('Rive approval denial not observed');
        reports.push({name,painted:first.painted,inputChanged:true,independent:true,posterCaptureRejected,qualityReadmitted:true,remounted:true,missingRuntime,unapproved,idle,after});return;
      }
      const resolver = browserResolver(pkg),
        stage = createPlayerStage({
          root,
          adapters: [adapterFactory(pkg.digest)],
          budget: { estimatedGpuBytes: 96 * 1024 * 1024 },
        }),
        view = stage.mount(root, { resolver });
      const ready = await view.ready;
      if (ready.mode !== "interactive")
        throw new Error(name + ": " + JSON.stringify(ready));
      view.setInputs({ tilt: { x: 0.7, y: 0.2 } });
      await new Promise((r) => setTimeout(r, 150));
      const snapshot = await view.snapshot(),
        image = await createImageBitmap(snapshot),
        canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 20) painted++;
      image.close();
      if (painted < 100) throw new Error(name + " did not paint");
      const frames = stage.diagnostics().frames;
      await new Promise((r) => setTimeout(r, 100));
      const idle = stage.diagnostics().frames === frames;
      view.dispose();
      const after = stage.diagnostics();
      stage.dispose();
      resolver.dispose();
      reports.push({ name, painted, idle, after });
    }
    await probe("dc.gltf", glb, "model/gltf-binary", () => gltfAdapter());
    if(!advancedOnly)await probe("dc.dotlottie", dot, "application/zip", () =>
      dotLottieAdapter({ wasmURL: "/player/wasm/dotlottie.wasm" }),
    );
    await probe(
      "dc.rive",
      Uint8Array.from(atob(rive), (c) => c.charCodeAt(0)),
      "application/x-rive",
      (digest) =>
        riveAdapter({
          wasmURL: advancedOnly?'/rive.wasm':"/player/wasm/rive.wasm",
          approvedDigests: [digest],
        }),
    );
    if(advancedOnly){root.remove();return {reports,video:null};}
    // Generate a real browser-encoded video; no binary test art is stored in Git.
    const videoCanvas = document.createElement("canvas");
    videoCanvas.width = 64;
    videoCanvas.height = 64;
    const stream = videoCanvas.captureStream(12),
      chunks = [],
      recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (recorder.onstop = r));
    recorder.start();
    for (let i = 0; i < 6; i++) {
      const ctx = videoCanvas.getContext("2d");
      ctx.fillStyle = i % 2 ? "#eeaa33" : "#3366cc";
      ctx.fillRect(0, 0, 64, 64);
      await new Promise((r) => setTimeout(r, 90));
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    const bytes = new Uint8Array(
        await new Blob(chunks, { type: "video/webm" }).arrayBuffer(),
      ),
      manifest = structuredClone(base.manifest),
      assets = new Map(
        base.manifest.assets.map((a) => [a.path, base.files.get(a.path)]),
      );
    manifest.assets.push({
      id: "clip",
      path: "assets/clip.webm",
      mediaType: "video/webm",
      sha256: "0".repeat(64),
      bytes: bytes.length,
      role: "back-video",
      width: 64,
      height: 64,
    });
    assets.set("assets/clip.webm", bytes);
    const scenes = structuredClone(base.scenes);
    scenes.get("scenes/back.json").nodes = [
      {
        id: "clip",
        type: "video",
        asset: "clip",
        x: 0,
        y: 0,
        width: 1000,
        height: 1500,
        video: {
          mode: "autoplay-muted",
          muted: true,
          loop: true,
          poster: "back",
        },
      },
    ];
    const pkg = await buildPackage(manifest, scenes, assets),
      resolver = browserResolver(pkg),
      stage = createPlayerStage({ root }),
      view = stage.mount(root, { resolver }, { side: "back" });
    await view.ready;
    await new Promise((r) => setTimeout(r, 400));
    const playing = stage.diagnostics();
    view.setVisibility("hidden");
    await new Promise((r) => setTimeout(r, 100));
    const paused = stage.diagnostics();
    view.dispose();
    const released = stage.diagnostics();
    stage.dispose();
    resolver.dispose();
    root.remove();
    return { reports, video: { playing, paused, released } };
  }, {rive,advancedOnly});
  for (const report of result.reports) {
    assert.equal(report.idle, true);
    assert.equal(report.after.textures, 0);
    assert.equal(report.after.assetReferences, 0);
  }
  if(!advancedOnly){assert.equal(result.video.playing.requestedVideoDecoders, 1);
  assert.equal(result.video.paused.requestedVideoDecoders, 0);
  assert.equal(result.video.released.textures, 0);}
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "advanced-report.json"),
    JSON.stringify({ browser: browser.version(), ...result, errors }, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
