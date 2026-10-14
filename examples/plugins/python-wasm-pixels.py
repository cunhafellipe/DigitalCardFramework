"""Author a CPU pixel module as WASM bytecode, using only Python's standard library.

This assembles numeric instructions; it does not compile or run Python in WASM.
Usage: python python-wasm-pixels.py OUTPUT_DIRECTORY [MODULE_URL]
"""
import hashlib
import json
from pathlib import Path
import struct
import sys
import zipfile
import zlib


def uint(value):
    result = bytearray()
    while True:
        part = value & 127
        value >>= 7
        result.append(part | (128 if value else 0))
        if not value:
            return bytes(result)


def sint(value):
    result = bytearray()
    while True:
        part = value & 127
        value >>= 7
        done = (value == 0 and not part & 64) or (value == -1 and part & 64)
        result.append(part | (0 if done else 128))
        if done:
            return bytes(result)


def name(value):
    data = value.encode()
    return uint(len(data)) + data


def section(kind, data):
    return bytes([kind]) + uint(len(data)) + data


def get(index):
    return b'\x20' + uint(index)


def iconst(value):
    return b'\x41' + sint(value)


def fconst(value):
    return b'\x44' + struct.pack('<d', value)


def module():
    # render(width,height,angle,tiltX,tiltY,time,static,paramsPtr,paramsCount)->outputPtr
    args = bytes([0x7f, 0x7f, 0x7c, 0x7c, 0x7c, 0x7c, 0x7f, 0x7f, 0x7f])
    types = section(1, b'\x01\x60' + uint(len(args)) + args + b'\x01\x7f')
    imports = section(2, b'\x01' + name('env') + name('memory') + b'\x02\x01' + uint(256) + uint(256))
    functions = section(3, b'\x01\x00')
    exports = section(7, b'\x01' + name('render') + b'\x00\x00')
    body = bytearray(b'\x01\x02\x7f')  # i32 locals: pixel index and total
    body += iconst(0) + b'\x21\x09' + get(0) + get(1) + b'\x6c\x21\x0a'
    body += b'\x02\x40\x03\x40' + get(9) + get(10) + b'\x4f\x0d\x01'

    def store(offset, value):
        return iconst(64 + offset) + get(9) + iconst(4) + b'\x6c\x6a' + value + b'\x3a\x00\x00'

    # Red follows angle; green is the horizontal gradient; blue follows time and a parameter.
    body += store(0, get(2) + fconst(255) + b'\xa2\xaa')
    body += store(1, get(9) + get(0) + b'\x70' + iconst(255) + b'\x6c' + get(0) + b'\x6e')
    phase = get(5) + fconst(60) + b'\xa2' + get(8) + b'\x04\x7c' + get(7) + b'\x2b\x03\x00\x05' + fconst(0) + b'\x0b\xa0\xaa'
    body += store(2, phase)
    body += store(3, iconst(255))
    body += get(9) + iconst(1) + b'\x6a\x21\x09\x0c\x00\x0b\x0b' + iconst(64) + b'\x0b'
    return b'\x00asm\x01\x00\x00\x00' + types + imports + functions + exports + section(10, b'\x01' + uint(len(body)) + body)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def png():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 2, 2, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00' + bytes([48, 96, 160, 255]) * 2 + b'\x00' + bytes([48, 96, 160, 255]) * 2)) + chunk(b'IEND', b'')


def generate(out, url):
    out.mkdir(parents=True, exist_ok=True)
    code = module()
    registry = [{'id': 'example.python-gradient', 'version': '1.0.0', 'url': url, 'sha256': hashlib.sha256(code).hexdigest()}]
    out.joinpath('program.wasm').write_bytes(code)
    out.joinpath('registry.json').write_bytes(canonical(registry) + b'\n')
    poster = png()
    files = {'assets/front.png': poster, 'assets/back.png': poster}
    manifest = {'format': 'digital-card', 'contractVersion': '0.1.0', 'id': 'example.python-gradient', 'revision': 1, 'title': 'Python-authored WASM gradient', 'summary': 'CPU pixels from standard-library bytecode assembly.', 'profile': 'portable', 'canvas': {'width': 512, 'height': 768}, 'faces': {side: {'scene': 'scenes/' + side + '.json', 'poster': side, 'description': side.title()} for side in ['front', 'back']}, 'assets': [{'id': side, 'path': 'assets/' + side + '.png', 'mediaType': 'image/png', 'sha256': hashlib.sha256(poster).hexdigest(), 'bytes': len(poster), 'width': 2, 'height': 2, 'role': 'poster'} for side in ['front', 'back']], 'capabilities': {'required': ['dc.scene2d@0.1'], 'optional': [{'id': 'dc.wasm-pixels@0.1', 'fallback': 'poster'}]}, 'quality': {'poster': {'maxEdge': 768}, 'lite': {'maxEdge': 768}, 'standard': {'maxEdge': 1024}}}
    scene = {'dialect': 'dc.scene2d@0.1', 'nodes': [{'id': 'compute', 'type': 'adapter', 'adapter': 'dc.wasm-pixels', 'x': 0, 'y': 0, 'width': 512, 'height': 768, 'data': {'program': 'example.python-gradient', 'version': '1.0.0', 'clock': True, 'params': [24]}}]}
    files['card.json'] = canonical(manifest)
    for side in ['front', 'back']:
        files['scenes/' + side + '.json'] = canonical(scene)
    descriptor = {'format': 'digital-card-integrity', 'version': 1, 'files': [{'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for path, data in sorted(files.items())]}
    integrity = {**descriptor, 'digest': 'sha256:' + hashlib.sha256(b'digital-card-package-v1\n' + canonical(descriptor)).hexdigest()}
    files['integrity.json'] = canonical(integrity)
    with zipfile.ZipFile(out / 'example.dcard', 'w', compression=zipfile.ZIP_STORED) as archive:
        for path, data in sorted(files.items()):
            archive.writestr(path, data)


if __name__ == '__main__':
    if len(sys.argv) not in [2, 3]:
        raise SystemExit('Usage: python python-wasm-pixels.py OUTPUT_DIRECTORY [MODULE_URL]')
    generate(Path(sys.argv[1]), sys.argv[2] if len(sys.argv) == 3 else '/compute/python/program.wasm')
