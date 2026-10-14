// Generate a complete separate-origin shop document with the Go standard library.
// Run: go run main.go OUTPUT_DIR
// The host serves /program-shop-bootstrap.js; all payment and recovery controls stay native.
package main

import (
	"fmt"
	"os"
	"path/filepath"
)

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pack Dispatch</title><link rel="stylesheet" href="shop.css"><script type="module" src="/program-shop-bootstrap.js"></script></head><body>
<main><header><p class="kicker">PACK DISPATCH</p><h1 data-dc-shop-label="title">Find your next discovery</h1><p data-dc-shop-label="description">Choose a pack for native review.</p></header>
<aside class="finder"><label><span data-dc-shop-label="search">Search packs</span><input type="search" data-dc-shop-search maxlength="200" disabled></label><nav><button type="button" data-dc-shop-page="-1" data-dc-shop-label="previous" disabled>Previous packs</button><button type="button" data-dc-shop-page="1" data-dc-shop-label="more" disabled>More packs</button></nav></aside>
<section class="dispatch" data-dc-shop-items aria-live="polite"></section><p data-dc-shop-empty></p>
<section class="ledger"><h2 data-dc-shop-rates-summary>Pack rates</h2><p data-dc-shop-rates-explanation></p><dl data-dc-shop-rates></dl><nav><button type="button" data-dc-shop-rates-page="-1" data-dc-shop-label="previous" disabled>Previous rates</button><button type="button" data-dc-shop-rates-page="1" data-dc-shop-label="more" disabled>More rates</button></nav></section>
</main>
<template data-dc-shop-item-template><article class="dispatch-row"><div class="identity"><img data-dc-product-preview alt="" hidden><p class="kicker" data-dc-product-line></p><h2 data-dc-product-name></h2><p data-dc-product-availability></p><p data-dc-product-window></p></div><div class="terms"><strong data-dc-product-price></strong><p data-dc-product-pity></p><p data-dc-product-allocation></p></div><div class="actions"><button type="button" data-dc-product-select disabled>Pack details</button><label><span data-dc-shop-label="quantity">Quantity</span><input type="number" data-dc-product-quantity value="1" min="1" step="1" disabled></label><button type="button" data-dc-product-review disabled>Review purchase</button></div></article></template>
<template data-dc-shop-rate-template><div class="rate"><dt data-dc-rate-label></dt><dd data-dc-rate-value></dd></div></template>
</body></html>`
const css = `*{box-sizing:border-box}body{margin:0;background:#f8f5ee;color:#242b38;font:16px system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:32px}header{border-top:6px solid #334564;border-bottom:1px solid #a5abb7;padding:20px 0}.kicker{font:12px ui-monospace,monospace;letter-spacing:.14em;color:#5d6170}h1{font-family:Georgia,serif;font-size:clamp(28px,5vw,48px)}.finder,nav{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.finder{margin:24px 0}.finder label{display:flex;gap:10px;align-items:center}.dispatch-row{display:grid;grid-template-columns:1.1fr 1.4fr 200px;gap:24px;padding:26px 0;border-bottom:1px solid #a5abb7}.dispatch-row[data-dc-selected=true]{background:#e9edf4;padding:26px 16px}.dispatch-row p{line-height:1.6}.identity img{max-width:110px;max-height:160px;object-fit:contain}.actions{display:grid;gap:10px;align-content:start}.actions label{display:flex;justify-content:space-between;align-items:center}.actions input{width:70px}button,input{font:inherit;padding:10px;border:1px solid #6c7690;border-radius:3px}button{background:#334564;color:white;cursor:pointer}button:disabled{opacity:.45;cursor:default}.ledger{margin:28px 0;padding:24px;border:1px solid #a5abb7}.rate{display:flex;gap:16px;justify-content:space-between;padding:10px 0;border-bottom:1px dotted #a5abb7}dd{margin:0;font-weight:700}[hidden]{display:none!important}:focus-visible{outline:3px solid #b37618;outline-offset:3px}@media(max-width:650px){main{padding:16px}.dispatch-row{grid-template-columns:1fr;gap:10px}.actions{grid-template-columns:1fr 1fr}.actions label{grid-column:1/-1}}`

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "Usage: go run main.go OUTPUT_DIR")
		os.Exit(1)
	}
	if err := os.MkdirAll(os.Args[1], 0700); err != nil {
		panic(err)
	}
	for name, content := range map[string]string{"index.html": html, "shop.css": css} {
		if err := os.WriteFile(filepath.Join(os.Args[1], name), []byte(content), 0600); err != nil {
			panic(err)
		}
	}
}
