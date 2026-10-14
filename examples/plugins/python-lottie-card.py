"""Write a passive vector-animation card with the Python standard library.

Run: python python-lottie-card.py [--clock] OUTPUT.dcard
The host installs dotLottieAdapter with its self-hosted runtime. Default mode
scrubs vector keyframes from tilt-derived angle; --clock uses active time.
"""
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import zipfile
import zlib


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def archive(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as writer:
        for path, data in sorted(files.items()):
            entry = zipfile.ZipInfo(path, (1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_STORED
            entry.external_attr = 0o600 << 16
            writer.writestr(entry, data)
    return output.getvalue()


def keyframes(start, middle, end):
    def frame(time, first, last):
        return {"t": time, "s": first, "e": last, "o": {"x": [0.33], "y": [0]}, "i": {"x": [0.67], "y": [1]}}
    return {"a": 1, "k": [frame(0, start, middle), frame(30, middle, end), {"t": 60, "s": end}]}


def animation():
    layers = []
    for index, (start, middle, end, color) in enumerate([
        ([75, 100, 0], [115, 75, 0], [130, 135, 0], [1, 0.82, 0.45, 1]),
        ([165, 230, 0], [210, 260, 0], [145, 285, 0], [0.4, 0.9, 0.9, 1]),
        ([235, 355, 0], [190, 330, 0], [200, 395, 0], [0.9, 0.6, 1, 1]),
    ], 1):
        vertices = [[0, -9], [3, -3], [9, 0], [3, 3], [0, 9], [-3, 3], [-9, 0], [-3, -3]]
        layers.append({"ddd": 0, "ind": index, "ty": 4, "nm": "Star " + str(index), "sr": 1, "ks": {"o": keyframes([100], [35], [100]), "r": keyframes([0], [90], [180]), "p": keyframes(start, middle, end), "a": {"a": 0, "k": [0, 0, 0]}, "s": {"a": 0, "k": [100, 100, 100]}}, "shapes": [{"ty": "sh", "nm": "Vector star", "ks": {"a": 0, "k": {"i": [[0, 0]] * 8, "o": [[0, 0]] * 8, "v": vertices, "c": True}}}, {"ty": "fl", "c": {"a": 0, "k": color}, "o": {"a": 0, "k": 100}, "r": 1}], "ip": 0, "op": 60, "st": 0, "bm": 0})
    return {"v": "5.7.0", "fr": 30, "ip": 0, "op": 60, "w": 300, "h": 450, "nm": "Passive starfield", "ddd": 0, "assets": [], "layers": layers}


def poster(kind):
    width, height = 128, 192
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            color = (12 + y * 14 // height, 22 + y * 12 // height, 46 + y * 30 // height, 255)
            if kind == "back":
                color = (12 + y * 10 // height, 36 + y * 18 // height, 43 + y * 20 // height, 255)
            if kind == "front" and any(abs(x - cx) + abs(y - cy) <= 4 for cx, cy in [(32, 42), (70, 98), (100, 151)]):
                color = (240, 211, 143, 255)
            if kind == "back" and 24 <= abs(x - 64) + abs(y - 96) <= 27:
                color = (203, 183, 122, 255)
            rows.extend(color)
    def chunk(name, data):
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def main(path, clock=False):
    dot = archive({"manifest.json": canonical({"version": "2", "animations": [{"id": "stars"}]}), "a/stars.json": canonical(animation())})
    files, assets = {}, []
    for name, data, media, role in [("front", poster("front"), "image/png", "poster"), ("back", poster("back"), "image/png", "poster"), ("background", poster("background"), "image/png", "color"), ("star-animation", dot, "application/zip", "interactive")]:
        asset_path = "assets/" + name + (".lottie" if media == "application/zip" else ".png")
        files[asset_path] = data
        asset = {"id": name, "path": asset_path, "mediaType": media, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "role": role}
        if media == "image/png":
            asset.update({"width": 128, "height": 192})
        assets.append(asset)
    manifest = {"format": "digital-card", "contractVersion": "0.1.0", "id": "example.starfield", "revision": 1, "title": "Passive Starfield", "summary": "Live vector star keyframes with explicit angle or clock control.", "profile": "portable", "canvas": {"width": 300, "height": 450}, "faces": {"front": {"scene": "scenes/front.json", "poster": "front", "description": "Animated starfield"}, "back": {"scene": "scenes/back.json", "poster": "back", "description": "Observatory emblem"}}, "assets": assets, "capabilities": {"required": ["dc.scene2d@0.1"], "optional": [{"id": "dc.dotlottie@0.1", "fallback": "poster"}]}, "quality": {"poster": {"maxEdge": 192}, "lite": {"maxEdge": 300}, "standard": {"maxEdge": 450}}}
    files["card.json"] = canonical(manifest)
    files["scenes/front.json"] = canonical({"dialect": "dc.scene2d@0.1", "nodes": [{"id": "background", "type": "image", "asset": "background", "x": 0, "y": 0, "width": 300, "height": 450}, {"id": "starfield", "type": "adapter", "adapter": "dc.dotlottie", "x": 0, "y": 0, "width": 300, "height": 450, "data": {"asset": "star-animation", "animation": "stars", "clock": clock, "duration": 2}}]})
    files["scenes/back.json"] = canonical({"dialect": "dc.scene2d@0.1", "nodes": [{"id": "back", "type": "image", "asset": "back", "x": 0, "y": 0, "width": 300, "height": 450}]})
    descriptor = {"format": "digital-card-integrity", "version": 1, "files": [{"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in sorted(files.items())]}
    files["integrity.json"] = canonical({**descriptor, "digest": "sha256:" + hashlib.sha256(b"digital-card-package-v1\n" + canonical(descriptor)).hexdigest()})
    Path(path).write_bytes(archive(files))


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--clock":
        main(sys.argv[2], clock=True)
    elif len(sys.argv) == 2 and sys.argv[1] != "--clock":
        main(sys.argv[1])
    else:
        raise SystemExit("Usage: python-lottie-card.py [--clock] OUTPUT.dcard")
