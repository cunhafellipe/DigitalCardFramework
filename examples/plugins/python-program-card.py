"""Write reviewed custom card HTML/CSS with the Python standard library.

Run: python python-program-card.py OUTPUT_DIR
Pack artwork: python python-program-card.py --pack OUTPUT_DIR
Album display: python python-program-card.py --album OUTPUT_DIR
Opening region: python python-program-card.py --opener OUTPUT_DIR
The host supplies /program-bootstrap.js and its framework imports on the
approved separate origin. This generator emits no JavaScript.
"""

from pathlib import Path
import sys


HTML = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Celestial Archive</title>
  <link rel="stylesheet" href="card.css">
  <script type="module" src="/program-bootstrap.js"></script>
</head>
<body>
  <main class="archive-card" aria-label="Celestial Archive presentation">
    <button class="card-select" type="button" data-dc-intent="select" aria-label="Select Celestial Archive card">
      <span class="face face-front">
        <span class="eyebrow">THE CELESTIAL ARCHIVE</span>
        <span class="orbit-field" aria-hidden="true">
          <span class="orbit orbit-one"></span>
          <span class="orbit orbit-two"></span>
          <span class="star star-one"></span>
          <span class="star star-two"></span>
          <span class="star star-three"></span>
          <span class="planet"></span>
        </span>
        <span class="caption"><strong>Orbit No. 17</strong><small>A study in light and motion</small></span>
        <span class="selection-hint">Select to inspect</span>
      </span>
      <span class="face face-back">
        <span class="eyebrow">OBSERVATORY NOTES</span>
        <span class="back-symbol" aria-hidden="true">+</span>
        <span class="caption"><strong>Beyond the horizon</strong><small>One sky, another perspective</small></span>
        <span class="selection-hint">Select to inspect</span>
      </span>
    </button>
  </main>
</body>
</html>
'''

CSS = ''':root { color-scheme: dark; font-family: Georgia, serif; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
body { background: #101526; }
.archive-card { width: 100%; height: 100%; padding: 8px; perspective: 900px; }
.card-select { position: relative; display: block; width: 100%; height: 100%; border: 1px solid #cab579; border-radius: 18px; padding: 0; overflow: hidden; background: #101526; color: #f5ebcb; font: inherit; text-align: center; cursor: pointer; transform: rotateX(calc(var(--dc-tilt-y, 0) * -6deg)) rotateY(calc(var(--dc-tilt-x, 0) * 8deg)); }
.card-select:focus-visible { outline: 3px solid #8de8e6; outline-offset: -5px; }
.face { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 9% 7% 6%; }
.face-front { background: radial-gradient(ellipse at calc(50% + var(--dc-tilt-x, 0) * 18%) 42%, #55728b 0, #233958 30%, #11192e 72%); }
.face-back { visibility: hidden; background: repeating-linear-gradient(45deg, #143838 0 12px, #183f3f 12px 24px); }
:root[data-dc-side="back"] .face-front { visibility: hidden; }
:root[data-dc-side="back"] .face-back { visibility: visible; }
.eyebrow { font: 10px system-ui, sans-serif; letter-spacing: .22em; line-height: 1.8; }
.orbit-field { position: absolute; inset: 21% 13% 31%; opacity: calc(.65 + var(--dc-reveal-progress, 0) * .35); transform: translateX(calc(var(--dc-tilt-x, 0) * 5px)); }
.orbit { position: absolute; inset: 14% 0; border: 2px solid #ddca8e; border-radius: 50%; }
.orbit-one { transform: rotate(-28deg) scaleY(.5); }
.orbit-two { transform: rotate(37deg) scaleY(.65); border-color: #96d9d3; }
.planet { position: absolute; inset: 22%; border-radius: 50%; background: radial-gradient(circle at 32% 25%, #a8e7df, #529891 48%, #223f56 83%); box-shadow: 0 0 34px #6ba9aa55; }
.star { position: absolute; width: 5px; height: 5px; background: #fff0b7; transform: rotate(45deg); box-shadow: 0 0 12px #ffecc6; }
.star-one { left: 8%; top: 20%; } .star-two { right: 4%; top: 51%; } .star-three { left: 27%; bottom: 6%; }
.caption { margin-top: auto; display: flex; flex-direction: column; gap: 8px; padding-bottom: 24px; }
.caption strong { font-size: clamp(18px, 5vw, 30px); font-weight: normal; }
.caption small { font: 10px system-ui, sans-serif; letter-spacing: .08em; }
.selection-hint { font: 9px system-ui, sans-serif; opacity: .7; }
.back-symbol { position: absolute; top: 28%; font-size: 96px; font-weight: normal; transform: rotate(calc(45deg + var(--dc-flip-progress, 0) * 90deg)); color: #cebd89; }
@media (prefers-reduced-motion: reduce) { .card-select, .orbit-field, .back-symbol { transform: none; } }
'''


PACK_HTML = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Celestial Archive Pack</title>
  <link rel="stylesheet" href="card.css">
  <script type="module" src="/program-bootstrap.js"></script>
</head>
<body>
  <main class="pack-display" aria-label="Celestial Archive pack presentation">
    <button class="sealed-sleeve" type="button" data-dc-intent="select" aria-label="Select Celestial Archive pack">
      <span class="crimp crimp-top" aria-hidden="true"></span>
      <span class="pack-face pack-front">
        <span class="pack-brand">THE CELESTIAL ARCHIVE</span>
        <span class="pack-seal" aria-hidden="true"><span class="seal-orbit"></span><span class="seal-star">+</span></span>
        <span class="pack-caption"><strong>Nightfall Series</strong><small>Collectible card pack</small></span>
        <span class="pack-hint">Select pack</span>
      </span>
      <span class="pack-face pack-back">
        <span class="pack-brand">SEALED COLLECTION</span>
        <span class="pack-spine" aria-hidden="true"></span>
        <span class="pack-caption"><strong>A new discovery awaits</strong><small>Review contents and price in the host before buying.</small></span>
        <span class="pack-hint">Select pack</span>
      </span>
      <span class="crimp crimp-bottom" aria-hidden="true"></span>
    </button>
  </main>
</body>
</html>
'''

PACK_CSS = ''':root { color-scheme: dark; font-family: Georgia, serif; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
body { background: #131424; }
.pack-display { width: 100%; height: 100%; padding: 5px; perspective: 900px; }
.sealed-sleeve { position: relative; display: block; width: 100%; height: 100%; padding: 0; border: 1px solid #bca86c; border-radius: 3px; overflow: hidden; background: #191b36; color: #fff0c5; font: inherit; text-align: center; cursor: pointer; transform: rotateX(calc(var(--dc-tilt-y, 0) * -4deg)) rotateY(calc(var(--dc-tilt-x, 0) * 6deg)); }
.sealed-sleeve:focus-visible { outline: 3px solid #b0e8e2; outline-offset: -5px; }
.pack-face { position: absolute; inset: 7% 0; display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 8% 8% 5%; }
.pack-front { background: radial-gradient(ellipse at calc(50% + var(--dc-tilt-x, 0) * 15%) 40%, #765582 0, #393556 44%, #191b36 85%); }
.pack-back { visibility: hidden; background: linear-gradient(90deg, #1b3339, #2e4a4d 48%, #1b3339); }
:root[data-dc-side="back"] .pack-front { visibility: hidden; }
:root[data-dc-side="back"] .pack-back { visibility: visible; }
.crimp { position: absolute; z-index: 2; left: 0; right: 0; height: 7%; background: repeating-linear-gradient(90deg, #c6b073 0 2px, #71614b 2px 4px, #a58d60 4px 6px); border-bottom: 1px solid #dec990; }
.crimp-top { top: 0; } .crimp-bottom { bottom: 0; border-top: 1px solid #dec990; border-bottom: 0; }
.pack-brand { font: 9px system-ui, sans-serif; letter-spacing: .15em; line-height: 1.8; }
.pack-seal { position: absolute; inset: 27% 19% 34%; display: grid; place-items: center; opacity: calc(.7 + var(--dc-reveal-progress, 0) * .3); }
.seal-orbit { position: absolute; inset: 8%; border: 2px solid #dec690; border-radius: 50%; transform: rotate(-30deg) scaleY(.55); }
.seal-star { color: #b9e1df; font-size: clamp(40px, 12vw, 90px); transform: rotate(calc(45deg + var(--dc-flip-progress, 0) * 20deg)); }
.pack-caption { margin-top: auto; display: flex; flex-direction: column; gap: 8px; padding-bottom: 18px; }
.pack-caption strong { font-size: clamp(14px, 4vw, 24px); font-weight: normal; }
.pack-caption small { font: 10px system-ui, sans-serif; line-height: 1.6; }
.pack-hint { font: 9px system-ui, sans-serif; opacity: .7; }
.pack-spine { position: absolute; top: 0; bottom: 0; width: 12px; border-inline: 1px solid #8eb3aa; opacity: .25; }
@media (prefers-reduced-motion: reduce) { .sealed-sleeve, .seal-star { transform: none; } }
'''


ALBUM_HTML = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Celestial Archive Album</title>
  <link rel="stylesheet" href="card.css">
  <script type="module" src="/program-album-bootstrap.js"></script>
</head>
<body>
  <main class="archive-album" aria-label="Celestial Archive album display">
    <header class="album-heading">
      <p class="album-eyebrow">THE CELESTIAL ARCHIVE</p>
      <h1 data-dc-album-name>Your collection</h1>
      <p class="album-intro">A gallery of discoveries. Select a card to inspect it in the host.</p>
    </header>
    <div class="album-pages" data-dc-album-pages></div>
    <template data-dc-album-page>
      <section class="album-page">
        <header class="page-heading"><span class="page-mark" aria-hidden="true">+</span><h2 data-dc-page-name>Collection page</h2></header>
        <div class="page-items" data-dc-album-items></div>
      </section>
    </template>
    <template data-dc-album-item>
      <article class="album-item">
        <button class="item-select" type="button" data-dc-item-select>
          <span class="item-art"><span class="item-emblem" aria-hidden="true">+</span><img data-dc-item-preview alt=""></span>
          <span class="item-caption"><strong data-dc-item-name>Card name</strong><small data-dc-item-rarity>Rarity</small></span>
          <span class="item-hint">Inspect card</span>
        </button>
      </article>
    </template>
  </main>
</body>
</html>
'''

ALBUM_CSS = ''':root { color-scheme: dark; font-family: Georgia, serif; }
* { box-sizing: border-box; }
html, body { width: 100%; min-height: 100%; margin: 0; }
body { background: #111d27; color: #f4e6c4; }
.archive-album { padding: 24px; }
.album-heading { max-width: 760px; margin: 0 auto 28px; padding-bottom: 18px; border-bottom: 1px solid #a48c59; }
.album-eyebrow { font: 10px system-ui, sans-serif; letter-spacing: .2em; }
.album-heading h1 { font-size: clamp(24px, 5vw, 44px); font-weight: normal; margin: 12px 0; overflow-wrap: anywhere; }
.album-intro { color: #c6c6b5; font: 13px system-ui, sans-serif; line-height: 1.6; }
.album-pages { display: grid; gap: 28px; }
.album-page { min-width: 0; padding: 20px; border: 1px solid #817653; border-radius: 8px; background: linear-gradient(110deg, #1e3038, #162831); box-shadow: 0 8px 28px #050b1555; }
.page-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.page-heading h2 { font-size: 22px; font-weight: normal; margin: 0; overflow-wrap: anywhere; }
.page-mark { color: #c6b277; font-size: 30px; transform: rotate(45deg); }
.page-items { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr)); gap: 18px; }
.album-item { min-width: 0; }
.item-select { display: flex; flex-direction: column; align-items: stretch; width: 100%; height: 100%; padding: 10px; border: 1px solid #9a9066; border-radius: 8px; background: #16232f; color: inherit; font: inherit; text-align: center; cursor: pointer; }
.item-select:hover { background: #243846; }
.item-select:focus-visible { outline: 3px solid #a5e5df; outline-offset: 2px; }
.item-art { position: relative; display: grid; place-items: center; aspect-ratio: 2 / 3; overflow: hidden; border: 1px solid #526978; border-radius: 4px; background: radial-gradient(circle, #3d6869, #1c3248 65%); }
.item-emblem { font-size: 56px; color: #c6b77e; transform: rotate(45deg); }
.item-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.item-art img:not([src]) { display: none; }
.item-caption { display: flex; flex-direction: column; gap: 7px; padding-top: 12px; overflow-wrap: anywhere; }
.item-caption strong { font-size: 17px; font-weight: normal; }
.item-caption small, .item-hint { font: 11px system-ui, sans-serif; color: #cbcbb9; }
.item-hint { margin-top: auto; padding-top: 16px; }
@media (max-width: 440px) { .archive-album { padding: 12px; } .album-page { padding: 12px; } }
@media (prefers-reduced-motion: reduce) { .page-mark, .item-emblem { transform: none; } }
'''


OPENER_HTML = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Celestial Archive Opening Theater</title>
  <link rel="stylesheet" href="card.css">
  <script type="module" src="/program-opener-bootstrap.js"></script>
</head>
<body>
  <main class="opening-theater" aria-label="Celestial Archive opening region">
    <header class="opening-heading">
      <p class="opening-eyebrow">THE CELESTIAL ARCHIVE</p>
      <h1 data-dc-opener-label="title">Reveal your cards</h1>
      <p class="opening-status" role="status" aria-live="polite" data-dc-opener-label="status">Choose a pack in the host.</p>
      <p class="opening-progress" data-dc-opener-label="progress">No cards revealed yet.</p>
    </header>
    <nav class="opening-controls" aria-label="Reveal controls">
      <button class="reveal-next" type="button" data-dc-opener-intent="reveal" disabled><span data-dc-opener-label="reveal">Reveal next</span></button>
      <button class="reveal-all" type="button" data-dc-opener-intent="skip" disabled><span data-dc-opener-label="skip">Reveal all</span></button>
      <button class="replay-reveal" type="button" data-dc-opener-intent="replay" disabled><span data-dc-opener-label="replay">Replay reveal</span></button>
    </nav>
    <div class="opening-items" data-dc-opener-items></div>
    <template data-dc-opener-item-template>
      <article class="opening-card">
        <p class="opening-slot" data-dc-item-label>Card</p>
        <div class="opening-art"><span class="opening-symbol" aria-hidden="true">+</span><img data-dc-item-preview alt=""></div>
        <div class="opening-details"><h2 data-dc-item-name>Card name</h2><p data-dc-item-rarity>Rarity</p><p class="opening-discovery" data-dc-item-new>Collection discovery</p></div>
        <button class="inspect-reveal" type="button" data-dc-opener-inspect><span data-dc-opener-label="inspect">Inspect card</span></button>
      </article>
    </template>
  </main>
</body>
</html>
'''

OPENER_CSS = ''':root { color-scheme: dark; font-family: Georgia, serif; }
* { box-sizing: border-box; }
html, body { width: 100%; min-height: 100%; margin: 0; }
body { background: #151a2b; color: #f6e7c3; }
.opening-theater { padding: 24px; }
.opening-heading { padding: 18px 20px; border: 1px solid #8f815d; border-radius: 12px; background: linear-gradient(110deg, #2a3146, #1a2538); }
.opening-eyebrow { font: 10px system-ui, sans-serif; letter-spacing: .2em; }
.opening-heading h1 { margin: 12px 0; font-size: clamp(24px, 5vw, 42px); font-weight: normal; overflow-wrap: anywhere; }
.opening-status, .opening-progress { font: 13px system-ui, sans-serif; line-height: 1.6; overflow-wrap: anywhere; }
.opening-status { color: #d4ceb7; }
:root[data-dc-opener-phase="loading"] .opening-status { color: #aedfe0; }
:root[data-dc-opener-phase="error"] .opening-status { color: #ffb7ad; }
:root[data-dc-opener-phase="complete"] .opening-status { color: #bae4bd; }
.opening-controls { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0 24px; }
.opening-controls button, .inspect-reveal { padding: 10px 16px; border: 1px solid #b9a779; border-radius: 6px; background: #304355; color: #fff0cb; font: 13px system-ui, sans-serif; cursor: pointer; }
.opening-controls button:disabled { opacity: .45; cursor: default; }
.opening-controls button:focus-visible, .inspect-reveal:focus-visible { outline: 3px solid #a7e4df; outline-offset: 3px; }
.opening-items { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr)); gap: 20px; }
.opening-card { display: flex; flex-direction: column; min-width: 0; padding: 12px; border: 1px solid #8c8265; border-radius: 10px; background: #212d40; box-shadow: 0 8px 24px #07101d66; }
.opening-slot { margin: 0 0 12px; font: 12px system-ui, sans-serif; color: #d5caa9; }
.opening-art { position: relative; display: grid; place-items: center; aspect-ratio: 2 / 3; overflow: hidden; border: 1px solid #647489; border-radius: 6px; background: repeating-linear-gradient(45deg, #273b53 0 14px, #2c425b 14px 28px); }
.opening-symbol { font-size: 64px; color: #c8b780; transform: rotate(45deg); }
.opening-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.opening-art img:not([src]) { display: none; }
.opening-details { overflow-wrap: anywhere; }
.opening-details h2 { font-size: 19px; font-weight: normal; margin: 14px 0 8px; }
.opening-details p { font: 12px system-ui, sans-serif; color: #c8d0d0; }
.opening-discovery { border-block-start: 1px solid #617186; padding-block-start: 10px; }
.inspect-reveal { margin-top: auto; }
[hidden] { display: none !important; }
@media (max-width: 440px) { .opening-theater { padding: 12px; } .opening-heading { padding: 12px; } }
@media (prefers-reduced-motion: reduce) { .opening-symbol { transform: none; } }
'''


def main(directory, mode="card"):
    output = Path(directory)
    output.mkdir(parents=True, exist_ok=True)
    markup, stylesheet = {"card": (HTML, CSS), "pack": (PACK_HTML, PACK_CSS), "album": (ALBUM_HTML, ALBUM_CSS), "opener": (OPENER_HTML, OPENER_CSS)}[mode]
    (output / "index.html").write_text(markup, encoding="utf-8", newline="\n")
    (output / "card.css").write_text(stylesheet, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] in ("--pack", "--album", "--opener"):
        main(sys.argv[2], mode=sys.argv[1][2:])
    elif len(sys.argv) == 2 and sys.argv[1] not in ("--pack", "--album", "--opener"):
        main(sys.argv[1])
    else:
        raise SystemExit("Usage: python-program-card.py [--pack|--album|--opener] OUTPUT_DIR")
