"""Write a portable layered card package with the Python standard library.

Run: python python-card-art.py OUTPUT.dcard
Open the archive in Studio to edit its layers and capture updated posters.
"""

import hashlib
import json
import struct
import sys
import zipfile
import zlib


WIDTH, HEIGHT = 192, 288


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def pixels(kind, back=False):
    output = bytearray()
    for y in range(HEIGHT):
        for x in range(WIDTH):
            dx, dy = x - WIDTH // 2, y - 130
            radius, diamond = dx * dx + dy * dy, abs(dx) + abs(dy)
            background = (10 + y * 12 // HEIGHT, 35 + y * 25 // HEIGHT, 44 + y * 32 // HEIGHT, 255) if back else (18 + y * 22 // HEIGHT, 26 + y * 15 // HEIGHT, 60 + y * 40 // HEIGHT, 255)
            if x in (7, WIDTH - 8) or y in (7, HEIGHT - 8):
                background = (153, 129, 77, 255)
            elif y < 180 and (x * 19 + y * 23) % 997 < 3:
                background = (220, 211, 166, 255)
            emblem = (0, 0, 0, 0)
            if back:
                if 58 <= diamond <= 62 or (abs(dx) < 3 and abs(dy) < 20):
                    emblem = (197, 176, 109, 255)
            elif 48 * 48 <= radius <= 58 * 58:
                emblem = (223, 178, 88, 255)
            elif diamond < 28:
                emblem = (80, 190, 191, 255)
            if kind == "mask":
                color = (255, 255, 255, 255 if radius <= 58 * 58 else 0)
            elif kind == "background":
                color = background
            elif kind == "emblem":
                color = emblem
            else:
                color = emblem if emblem[3] else background
            output.extend(color)
    return bytes(output)


def png(data):
    def chunk(name, payload):
        body = name + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))
    rows = b"".join(b"\0" + data[y * WIDTH * 4:(y + 1) * WIDTH * 4] for y in range(HEIGHT))
    header = struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def main(path):
    files, assets = {}, []
    for side in ("front", "back"):
        for kind in ("poster", "background", "emblem"):
            name = side + "-" + kind
            data = png(pixels(kind, side == "back"))
            asset_path = "assets/" + name + ".png"
            files[asset_path] = data
            assets.append({"id": name, "path": asset_path, "mediaType": "image/png", "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "width": WIDTH, "height": HEIGHT, "role": "poster" if kind == "poster" else "color"})
    data = png(pixels("mask"))
    files["assets/foil-mask.png"] = data
    assets.append({"id": "foil-mask", "path": "assets/foil-mask.png", "mediaType": "image/png", "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "width": WIDTH, "height": HEIGHT, "role": "mask"})
    manifest = {"format": "digital-card", "contractVersion": "0.1.0", "id": "example.celestial-card", "revision": 1, "title": "Celestial Study", "summary": "Layered celestial artwork with a masked foil surface and bounded tilt motion.", "profile": "portable", "canvas": {"width": 600, "height": 900}, "faces": {side: {"scene": "scenes/" + side + ".json", "poster": side + "-poster", "description": "Celestial " + side} for side in ("front", "back")}, "assets": assets, "capabilities": {"required": ["dc.scene2d@0.1", "dc.motion@0.1", "dc.materials@0.1"], "optional": []}, "quality": {"poster": {"maxEdge": 288}, "lite": {"maxEdge": 600}, "standard": {"maxEdge": 900}}}
    files["card.json"] = canonical(manifest)
    for side in ("front", "back"):
        nodes = [{"id": side + "-" + kind, "name": side.title() + " " + kind, "type": "image", "asset": side + "-" + kind, "x": 0, "y": 0, "width": 600, "height": 900} for kind in ("background", "emblem")]
        if side == "front":
            nodes[1]["material"] = {"kind": "foil", "seed": 17, "intensity": 0.45, "roughness": 0.25, "variation": 0.3, "maskAsset": "foil-mask"}
            nodes[1]["bindings"] = {"rotation": ["mul", ["clamp", ["input", "tilt.x"], -1, 1], 6], "material.angle": ["mul", ["clamp", ["input", "tilt.x"], -1, 1], 35]}
        files["scenes/" + side + ".json"] = canonical({"dialect": "dc.scene2d@0.1", "nodes": nodes})
    descriptor = {"format": "digital-card-integrity", "version": 1, "files": [{"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in sorted(files.items())]}
    integrity = {**descriptor, "digest": "sha256:" + hashlib.sha256(b"digital-card-package-v1\n" + canonical(descriptor)).hexdigest()}
    files["integrity.json"] = canonical(integrity)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, data in sorted(files.items()):
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_STORED
            entry.external_attr = 0o600 << 16
            archive.writestr(entry, data)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python-card-art.py OUTPUT.dcard")
    main(sys.argv[1])
