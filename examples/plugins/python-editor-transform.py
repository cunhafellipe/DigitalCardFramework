"""Offline grid layout and raster decoration using only the standard library.

Run: python python-editor-transform.py INPUT.job OUTPUT.result
Export and review jobs through the framework's editor transform controller.
"""
import hashlib
import io
import json
import math
from pathlib import Path
import re
import struct
import sys
import zipfile
import zlib


PROTOCOL = "digital-card-editor-transform@1"
IDENTITY = ("protocol", "requestId", "toolId", "toolVersion", "sourceDigest")


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def pairs(entries):
    result = {}
    for name, value in entries:
        if name in result:
            raise ValueError("Duplicate JSON member")
        result[name] = value
    return result


def parsed(data):
    return json.loads(data.decode("utf-8"), object_pairs_hook=pairs, parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Invalid number")))


def unzip(data):
    if len(data) > 80 * 1024 * 1024:
        raise ValueError("Archive limit")
    result, total = {}, 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for entry in archive.infolist():
            if len(result) >= 2000 or entry.filename.lower() in {name.lower() for name in result} or not re.fullmatch(r"(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*", entry.filename) or any(part in (".", "..") for part in entry.filename.split("/")) or entry.flag_bits & 1 or entry.file_size > 64 * 1024 * 1024:
                raise ValueError("Invalid archive")
            total += entry.file_size
            if total > 128 * 1024 * 1024:
                raise ValueError("Archive limit")
            result[entry.filename] = archive.read(entry)
    return result


def archive(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as writer:
        for name, data in sorted(files.items()):
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.external_attr = 0o600 << 16
            writer.writestr(entry, data)
    return output.getvalue()


def index(files):
    descriptor = {"format": "digital-card-integrity", "version": 1, "files": [{"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in sorted(files.items()) if name != "integrity.json"]}
    return {**descriptor, "digest": "sha256:" + hashlib.sha256(b"digital-card-package-v1\n" + canonical(descriptor)).hexdigest()}


def decoration(columns, gap, padding):
    width, height = 192, 288
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            edge = x < 3 or x >= width - 3 or y < 3 or y >= height - 3
            marker = 8 <= y <= 11 and any(abs(x - (i + 1) * width // (columns + 1)) <= 2 for i in range(columns))
            rows.extend((120 + columns * 12, 100 + gap, 100 + padding % 100, 255 if edge or marker else 0))
    def chunk(name, data):
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def unique(base, names):
    name, suffix = base, 2
    while name in names:
        name, suffix = base + "-" + str(suffix), suffix + 1
    return name


def transform(request, source):
    if set(request) != set(IDENTITY) | {"kind", "parameters", "grants"} or request["protocol"] != PROTOCOL or request["kind"] != "request" or request["toolId"] != "example.grid-decoration" or request["toolVersion"] != "1.0.0" or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", request["requestId"]):
        raise ValueError("Invalid request")
    if request["grants"] != {"faces": ["front"], "newRasterAssets": True, "capabilities": []} or request["grants"]["newRasterAssets"] is not True:
        raise ValueError("Invalid grant")
    parameters = request["parameters"]
    if set(parameters) != {"columns", "gap", "padding"}:
        raise ValueError("Invalid parameters")
    for name, minimum, maximum in [("columns", 1, 8), ("gap", 0, 100), ("padding", 0, 200)]:
        if type(parameters[name]) not in (int, float) or not math.isfinite(parameters[name]) or int(parameters[name]) != parameters[name] or not minimum <= parameters[name] <= maximum:
            raise ValueError("Invalid parameter")
    columns, gap, padding = (int(parameters[name]) for name in ("columns", "gap", "padding"))
    files = unzip(source)
    if any(name.startswith("signatures/") for name in files) or parsed(files["integrity.json"]) != index(files) or request["sourceDigest"] != index(files)["digest"]:
        raise ValueError("Source integrity mismatch")
    manifest = parsed(files["card.json"])
    if manifest["format"] != "digital-card" or manifest["contractVersion"] != "0.1.0":
        raise ValueError("Invalid source")
    face_path = manifest["faces"]["front"]["scene"]
    scene = parsed(files[face_path])
    candidates = [node for node in scene["nodes"] if node.get("type") == "image" and not node.get("locked", False) and node.get("width", 0) > 0 and node.get("height", 0) > 0]
    if not candidates:
        raise ValueError("No eligible images")
    column_width = (manifest["canvas"]["width"] - 2 * padding - gap * (columns - 1)) / columns
    available_height = manifest["canvas"]["height"] - 2 * padding
    if column_width <= 0 or available_height <= 0:
        raise ValueError("Layout does not fit")
    rows = [candidates[i:i + columns] for i in range(0, len(candidates), columns)]
    heights = [max(node["height"] * column_width / node["width"] for node in row) for row in rows]
    scale = min(1, (available_height - gap * (len(rows) - 1)) / sum(heights))
    if column_width <= 0 or scale <= 0:
        raise ValueError("Layout does not fit")
    cursor = padding
    for row, height in zip(rows, heights):
        for col, node in enumerate(row):
            new_height = node["height"] * column_width / node["width"] * scale
            node.update({"x": padding + col * (column_width + gap) + (column_width - column_width * scale) / 2, "y": cursor + (height * scale - new_height) / 2, "width": column_width * scale, "height": new_height})
        cursor += height * scale + gap
    data = decoration(columns, gap, padding)
    asset_id = unique("grid-decoration-art", {asset["id"] for asset in manifest["assets"]})
    path = "assets/" + asset_id + ".png"
    while path in files:
        asset_id = unique(asset_id + "-2", {asset["id"] for asset in manifest["assets"]})
        path = "assets/" + asset_id + ".png"
    def ids(nodes):
        return {node["id"] for node in nodes} | set().union(*(ids(node.get("children", [])) for node in nodes))
    node_id = unique("grid-decoration", ids(scene["nodes"]))
    manifest["assets"].append({"id": asset_id, "path": path, "mediaType": "image/png", "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "width": 192, "height": 288, "role": "color"})
    scene["nodes"].append({"id": node_id, "name": "Grid decoration", "type": "image", "asset": asset_id, "x": 0, "y": 0, "width": manifest["canvas"]["width"], "height": manifest["canvas"]["height"]})
    files[path], files["card.json"], files[face_path] = data, canonical(manifest), canonical(scene)
    files["integrity.json"] = canonical(index(files))
    return archive(files)


def main(input_path, output_path):
    if Path(input_path).stat().st_size > 80 * 1024 * 1024:
        raise ValueError("Archive limit")
    files = unzip(Path(input_path).read_bytes())
    if set(files) != {"request.json", "source.dcard"}:
        raise ValueError("Invalid job files")
    request = parsed(files["request.json"])
    result = transform(request, files["source.dcard"])
    header = {**{name: request[name] for name in IDENTITY}, "kind": "result"}
    Path(output_path).write_bytes(archive({"result.json": canonical(header), "result.dcard": result}))


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("Usage: python-editor-transform.py INPUT.job OUTPUT.result")
        main(sys.argv[1], sys.argv[2])
    except (ValueError, KeyError, TypeError, OSError, zipfile.BadZipFile):
        raise SystemExit("Editor transform failed")
