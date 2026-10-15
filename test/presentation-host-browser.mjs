import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { serveReference } from "../src/static.js";
const recipeOnly = process.argv[2] === "--recipe";
let server;
const [
  playwrightPath,
  base = "http://127.0.0.1:4173",
  out = "../PortableCardQA",
] = recipeOnly ? [undefined, undefined, process.argv[3] ?? "test-results/presentation-host-recipe"] : process.argv.slice(2);
const engine = process.env.BROWSER_ENGINE ?? "chromium";
await mkdir(out, {recursive:true});
let origin = base;
if (recipeOnly) {
  server = createServer(async (request,response) => {
    try {
      if (request.url === "/recipe") {response.setHeader("content-type","text/html");response.end('<!doctype html><html lang="en"><title>Custom material recipe</title><body></body></html>');return;}
      if(await serveReference(request,response))return;response.writeHead(404);response.end();
    } catch {response.writeHead(500);response.end();}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  origin = "http://127.0.0.1:" + server.address().port;
}
let browser;
const errors = [];
try {
  const playwright = await import(playwrightPath ? pathToFileURL(path.resolve(playwrightPath)).href : "playwright");
  browser = await playwright[engine].launch({ headless: process.env.HEADED !== "1", ...(!recipeOnly && engine === "chromium" ? {channel:"msedge"} : {}) });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(20000);
  await page.goto(origin + (recipeOnly ? "/recipe" : "/library.html"));
  if (!recipeOnly) {
  await page.waitForFunction(
    () => document.querySelectorAll("dc-portable-card img").length === 2,
  );
  await page.locator("dc-portable-card").first().click();
  await page.waitForFunction(() => document.querySelector("#viewer canvas"));
  await page.getByRole("button", { name: "Flip card", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(await page.locator("#viewer canvas").count(), 0);
  }
  const moduleRoot = recipeOnly ? "/src/presentation" : "/player";
  const flat = await page.evaluate(async moduleRoot => {
    const { createAuthoring } = await import(moduleRoot + "/authoring.js"),
      { browserResolver } = await import(moduleRoot + "/package.js"),
      { createPlayerStage } = await import(moduleRoot + "/player.js");
    const image = document.createElement("canvas");
    image.width = 300;
    image.height = 450;
    const ctx = image.getContext("2d");
    ctx.fillStyle = "#543b68";
    ctx.fillRect(0, 0, 300, 450);
    ctx.fillStyle = "#c39483";
    ctx.fillRect(75, 100, 150, 250);
    const blob = await new Promise((r) => image.toBlob(r, "image/jpeg"));
    const pkg = await createAuthoring().build({
      id: "one.jpg",
      source: {
        format: "image",
        mediaType: "image/jpeg",
        bytes: new Uint8Array(await blob.arrayBuffer()),
      },
      effects: [
        {
          id: "preset",
          node: "art",
          parameters: { name: "Chunky holo", size: 18, intensity: 3 },
        },
      ],
    });
    const root = document.createElement("div");
    Object.assign(root.style, { width: "300px", height: "450px" });
    document.body.prepend(root);
    const resolver = browserResolver(pkg),
      stage = createPlayerStage({ root }),
      view = stage.mount(root, { resolver }, { quality: "lite" });
    const ready = await view.ready;
    view.setInputs({ tilt: { x: -0.8, y: 0.2 } });
    const left = new Uint8Array(await (await view.snapshot()).arrayBuffer());
    view.setInputs({ tilt: { x: 0.8, y: -0.2 } });
    const right = new Uint8Array(await (await view.snapshot()).arrayBuffer());
    const different =
      left.length !== right.length || left.some((v, i) => v !== right[i]);
    view.dispose();
    const resources = stage.diagnostics();
    stage.dispose();
    resolver.dispose();
    root.remove();
    return { ready, different, resources };
  }, moduleRoot);
  assert.equal(flat.ready.mode, "interactive");
  assert(flat.different);
  assert.equal(flat.resources.textures, 0);
  const custom = await page.evaluate(async moduleRoot => {
    const [{createAuthoring},{browserResolver},{createPlayerStage}] = await Promise.all([
      import(moduleRoot + "/authoring.js"),import(moduleRoot + "/package.js"),import(moduleRoot + "/player.js")
    ]);
    const source = document.createElement("canvas");source.width=128;source.height=192;
    const paint=source.getContext("2d");paint.fillStyle="#543b68";paint.fillRect(0,0,128,192);
    const blob=await new Promise(resolve=>source.toBlob(resolve,"image/png")),calls=[];
    const creator=createAuthoring({effects:{"mod.sparkle":(node,parameters,context)=>{
      calls.push({parameters:structuredClone(parameters),side:context.side,node:node.id});
      return {...node,material:{kind:"glitter",...parameters},bindings:{"material.angle":["input","angle"]}};
    }}}),parameters={size:18,density:0.5,shape:"star",seed:51,intensity:3};
    const pkg=await creator.build({id:"custom-sparkle",source:{format:"image",mediaType:"image/png",bytes:new Uint8Array(await blob.arrayBuffer())},effects:[{id:"mod.sparkle",node:"art",parameters}]});
    const node=pkg.scenes.get(pkg.manifest.faces.front.scene).nodes[0],root=document.createElement("div");Object.assign(root.style,{display:"flex",width:"520px",height:"384px",position:"relative"});document.body.prepend(root);
    const resolver=browserResolver(pkg),stage=createPlayerStage({root}),targets=[0,1].map(()=>{const target=document.createElement("div");Object.assign(target.style,{width:"256px",height:"384px",position:"relative"});root.append(target);return target;}),views=targets.map(target=>stage.mount(target,{resolver},{quality:"lite"}));
    const ready=await Promise.all(views.map(view=>view.ready));
    const capture=async view=>{const blob=await view.snapshot(),bitmap=await createImageBitmap(blob),canvas=document.createElement("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext("2d");context.drawImage(bitmap,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;let painted=0;for(let index=3;index<pixels.length;index+=4)if(pixels[index])painted++;bitmap.close();canvas.width=canvas.height=0;return {painted,hash:[...new Uint8Array(await crypto.subtle.digest("SHA-256",pixels))].join(",")};};
    views[0].setInputs({angle:0.1});views[1].setInputs({angle:0.35});
    const before=await capture(views[0]),other=await capture(views[1]);views[0].setInputs({angle:0.9});const after=await capture(views[0]),unchanged=await capture(views[1]);
    await Promise.all(views.map(view=>view.setQuality("poster")));const poster={visible:views.every(view=>!view.element.querySelector("img").hidden),resources:stage.diagnostics()};
    let posterCaptureRejected=false;try{await views[0].snapshot();}catch{posterCaptureRejected=true;}
    const restored=await Promise.all(views.map(view=>view.setQuality("lite"))),remounted=await capture(views[0]);
    views.forEach(view=>view.dispose());const released=stage.diagnostics();stage.dispose();resolver.dispose();source.width=source.height=0;root.remove();
    return {calls,parameters,material:node.material,binding:node.bindings["material.angle"],ready,before,after,other,unchanged,poster,posterCaptureRejected,restored,remounted,released};
  }, moduleRoot);
  assert.deepEqual(custom.calls,[{parameters:custom.parameters,side:"front",node:"art"}]);
  assert.deepEqual(custom.material,{kind:"glitter",...custom.parameters});assert.deepEqual(custom.binding,["input","angle"]);
  assert(custom.ready.every(value=>value.mode==="interactive"));assert(custom.before.painted>100&&custom.after.painted>100);assert.notEqual(custom.before.hash,custom.after.hash);assert.equal(custom.other.hash,custom.unchanged.hash);
  assert(custom.poster.visible);assert.equal(custom.poster.resources.textures,0);assert.equal(custom.poster.resources.assetReferences,0);assert(custom.posterCaptureRejected);
  assert(custom.restored.every(value=>value.mode==="interactive"));assert(custom.remounted.painted>100);assert.equal(custom.released.views,0);assert.equal(custom.released.textures,0);assert.equal(custom.released.assetReferences,0);
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "host-report.json"),
    JSON.stringify({ engine, library: recipeOnly ? "not-run" : "passed", flatJpg: flat, customRecipe: custom, errors }, null, 2),
  );
  console.log(
    JSON.stringify({ engine, library: recipeOnly ? "not-run" : "passed", flatJpg: flat, customRecipe: custom, errors }, null, 2),
  );
} finally {
  await browser?.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
