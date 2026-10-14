"""Generate a complete shop document with Python's standard library.

Run: python python-shop-view.py OUTPUT_DIR
The reviewed separate origin serves /program-shop-bootstrap.js and its imports.
The program requests native review; it never submits a purchase.
"""
from pathlib import Path
import sys

HTML = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Discovery Shelf</title><link rel="stylesheet" href="shop.css"><script type="module" src="/program-shop-bootstrap.js"></script></head><body>
<main><header><span class="eyebrow">DISCOVERY SHELF</span><h1 data-dc-shop-label="title">Find your next discovery</h1><p data-dc-shop-label="description">Review pack contents before choosing.</p></header>
<section class="toolbar"><label><span data-dc-shop-label="search">Search packs</span><input type="search" data-dc-shop-search maxlength="200" disabled></label><nav><button type="button" data-dc-shop-page="-1" data-dc-shop-label="previous" disabled>Previous packs</button><button type="button" data-dc-shop-page="1" data-dc-shop-label="more" disabled>More packs</button></nav></section>
<section class="shelf" data-dc-shop-items aria-live="polite"></section><p data-dc-shop-empty></p>
<section class="disclosures" aria-labelledby="rates-title"><h2 id="rates-title" data-dc-shop-rates-summary>Pack rates</h2><p data-dc-shop-rates-explanation></p><div data-dc-shop-rates></div><nav><button type="button" data-dc-shop-rates-page="-1" data-dc-shop-label="previous" disabled>Previous rates</button><button type="button" data-dc-shop-rates-page="1" data-dc-shop-label="more" disabled>More rates</button></nav></section>
</main>
<template data-dc-shop-item-template><article class="pack"><img data-dc-product-preview alt="" hidden><p class="eyebrow" data-dc-product-line></p><h2 data-dc-product-name></h2><strong data-dc-product-price></strong><p data-dc-product-availability></p><p data-dc-product-window></p><p data-dc-product-pity></p><p class="explanation" data-dc-product-allocation></p><div class="choices"><button type="button" data-dc-product-select disabled>Pack details</button><label><span data-dc-shop-label="quantity">Quantity</span><input type="number" data-dc-product-quantity min="1" step="1" value="1" disabled></label><button type="button" data-dc-product-review disabled>Review purchase</button></div></article></template>
<template data-dc-shop-rate-template><p class="rate"><span data-dc-rate-label></span><strong data-dc-rate-value></strong></p></template>
</body></html>'''
CSS = '''*{box-sizing:border-box}body{margin:0;color:#183b37;background:#f1f6ef;font:16px system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:24px}header{padding:28px;background:#dbeee3;border-radius:22px}h1{font-size:clamp(26px,5vw,42px)}.eyebrow{font-size:12px;letter-spacing:.16em;color:#396a58}.toolbar,.choices,nav{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.toolbar{justify-content:space-between;margin:24px 0}.shelf{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}.pack{padding:22px;background:white;border:1px solid #c6d9cc;border-radius:18px}.pack[data-dc-selected=true]{border-color:#1d7152;box-shadow:0 0 0 2px #1d7152}.pack img{max-width:100%;max-height:160px;object-fit:contain}.pack p,.disclosures p{line-height:1.55}.choices{align-items:end}.choices label{display:grid;gap:5px}button,input{font:inherit;padding:10px;border:1px solid #81aa94;border-radius:8px}button{background:#e5f3e9;color:#163d2d;cursor:pointer}button:disabled{opacity:.5;cursor:default}input[type=number]{width:90px}.disclosures{margin-top:28px;padding:24px;background:#e4eee3;border-radius:18px}.rate{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #c6d9cc;padding:9px 0}[hidden]{display:none!important}:focus-visible{outline:3px solid #d68420;outline-offset:3px}@media(max-width:500px){main{padding:12px}.pack{padding:16px}}'''

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python python-shop-view.py OUTPUT_DIR')
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    (out / 'index.html').write_text(HTML, encoding='utf-8')
    (out / 'shop.css').write_text(CSS, encoding='utf-8')
