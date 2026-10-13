"""Write reviewed custom card HTML/CSS with the Python standard library.

Run: python python-program-card.py OUTPUT_DIR
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


def main(directory):
    output = Path(directory)
    output.mkdir(parents=True, exist_ok=True)
    (output / "index.html").write_text(HTML, encoding="utf-8", newline="\n")
    (output / "card.css").write_text(CSS, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python-program-card.py OUTPUT_DIR")
    main(sys.argv[1])
