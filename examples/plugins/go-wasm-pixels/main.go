// This standard-library example assembles numeric WASM instructions; it does not compile Go to WASM.
// Usage: go run main.go OUTPUT_DIRECTORY [MODULE_URL]
package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"sort"
)

func u(n uint32) []byte {
	var out []byte
	for {
		b := byte(n & 127)
		n >>= 7
		if n != 0 {
			b |= 128
		}
		out = append(out, b)
		if n == 0 {
			return out
		}
	}
}
func s(n int32) []byte {
	var out []byte
	for {
		b := byte(n & 127)
		n >>= 7
		done := (n == 0 && b&64 == 0) || (n == -1 && b&64 != 0)
		if !done {
			b |= 128
		}
		out = append(out, b)
		if done {
			return out
		}
	}
}
func cat(parts ...[]byte) []byte       { return bytes.Join(parts, nil) }
func name(v string) []byte             { return cat(u(uint32(len(v))), []byte(v)) }
func section(id byte, v []byte) []byte { return cat([]byte{id}, u(uint32(len(v))), v) }
func get(n byte) []byte                { return []byte{0x20, n} }
func iconst(n int32) []byte            { return cat([]byte{0x41}, s(n)) }
func fconst(n float64) []byte {
	out := make([]byte, 9)
	out[0] = 0x44
	binary.LittleEndian.PutUint64(out[1:], math.Float64bits(n))
	return out
}
func module() []byte {
	args := []byte{0x7f, 0x7f, 0x7c, 0x7c, 0x7c, 0x7c, 0x7f, 0x7f, 0x7f}
	types := section(1, cat([]byte{1, 0x60, 9}, args, []byte{1, 0x7f}))
	imports := section(2, cat([]byte{1}, name("env"), name("memory"), []byte{2, 1}, u(256), u(256)))
	exports := section(7, cat([]byte{1}, name("render"), []byte{0, 0}))
	body := cat([]byte{1, 2, 0x7f}, iconst(0), []byte{0x21, 9}, get(0), get(1), []byte{0x6c, 0x21, 10, 0x02, 0x40, 0x03, 0x40}, get(9), get(10), []byte{0x4f, 0x0d, 1})
	store := func(offset int32, value []byte) {
		body = cat(body, iconst(64+offset), get(9), iconst(4), []byte{0x6c, 0x6a}, value, []byte{0x3a, 0, 0})
	}
	// Red alternates checker squares over time; green follows angle; blue follows vertical tilt.
	checker := cat(get(9), get(0), []byte{0x70}, iconst(16), []byte{0x6e}, get(9), get(0), []byte{0x6e}, iconst(16), []byte{0x6e, 0x6a}, get(5), fconst(4), []byte{0xa2, 0xaa, 0x6a}, iconst(2), []byte{0x70}, iconst(255), []byte{0x6c})
	store(0, checker)
	store(1, cat(get(2), fconst(255), []byte{0xa2, 0xaa}))
	store(2, cat(get(4), fconst(1), []byte{0xa0}, fconst(127), []byte{0xa2, 0xaa}))
	store(3, iconst(255))
	body = cat(body, get(9), iconst(1), []byte{0x6a, 0x21, 9, 0x0c, 0, 0x0b, 0x0b}, iconst(64), []byte{0x0b})
	return cat([]byte{0, 97, 115, 109, 1, 0, 0, 0}, types, imports, section(3, []byte{1, 0}), exports, section(10, cat([]byte{1}, u(uint32(len(body))), body)))
}
func hash(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func canonical(v any) []byte {
	data, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return data
}
func write(out, name string, data []byte) {
	if err := os.WriteFile(filepath.Join(out, name), data, 0600); err != nil {
		panic(err)
	}
}
func generate(out, url string) {
	if err := os.MkdirAll(out, 0700); err != nil {
		panic(err)
	}
	code := module()
	write(out, "program.wasm", code)
	write(out, "registry.json", canonical([]any{map[string]any{"id": "example.go-checker", "version": "1.0.0", "url": url, "sha256": hash(code)}}))
	img := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			img.SetNRGBA(x, y, color.NRGBA{128, 64, 192, 255})
		}
	}
	var poster bytes.Buffer
	if err := png.Encode(&poster, img); err != nil {
		panic(err)
	}
	files := map[string][]byte{"assets/front.png": poster.Bytes(), "assets/back.png": poster.Bytes()}
	faces := map[string]any{}
	var assets []any
	for _, side := range []string{"front", "back"} {
		faces[side] = map[string]any{"scene": "scenes/" + side + ".json", "poster": side, "description": side}
		assets = append(assets, map[string]any{"id": side, "path": "assets/" + side + ".png", "mediaType": "image/png", "sha256": hash(poster.Bytes()), "bytes": poster.Len(), "width": 2, "height": 2, "role": "poster"})
	}
	manifest := map[string]any{"format": "digital-card", "contractVersion": "0.1.0", "id": "example.go-checker", "revision": 1, "title": "Go-authored WASM checker", "summary": "CPU pixels from standard-library bytecode assembly.", "profile": "portable", "canvas": map[string]any{"width": 512, "height": 768}, "faces": faces, "assets": assets, "capabilities": map[string]any{"required": []string{"dc.scene2d@0.1"}, "optional": []any{map[string]any{"id": "dc.wasm-pixels@0.1", "fallback": "poster"}}}, "quality": map[string]any{"poster": map[string]any{"maxEdge": 768}, "lite": map[string]any{"maxEdge": 768}, "standard": map[string]any{"maxEdge": 1024}}}
	scene := map[string]any{"dialect": "dc.scene2d@0.1", "nodes": []any{map[string]any{"id": "compute", "type": "adapter", "adapter": "dc.wasm-pixels", "x": 0, "y": 0, "width": 512, "height": 768, "data": map[string]any{"program": "example.go-checker", "version": "1.0.0", "clock": true, "params": []any{}}}}}
	files["card.json"] = canonical(manifest)
	for _, side := range []string{"front", "back"} {
		files["scenes/"+side+".json"] = canonical(scene)
	}
	var names []string
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	var entries []any
	for _, name := range names {
		entries = append(entries, map[string]any{"path": name, "bytes": len(files[name]), "sha256": hash(files[name])})
	}
	descriptor := map[string]any{"format": "digital-card-integrity", "version": 1, "files": entries}
	descriptor["digest"] = "sha256:" + hash(cat([]byte("digital-card-package-v1\n"), canonical(descriptor)))
	files["integrity.json"] = canonical(descriptor)
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	names = append(names, "integrity.json")
	sort.Strings(names)
	for _, name := range names {
		member, err := writer.CreateRaw(&zip.FileHeader{Name: name, Method: zip.Store, CRC32: crc32.ChecksumIEEE(files[name]), CompressedSize64: uint64(len(files[name])), UncompressedSize64: uint64(len(files[name]))})
		if err != nil {
			panic(err)
		}
		if _, err = member.Write(files[name]); err != nil {
			panic(err)
		}
	}
	if err := writer.Close(); err != nil {
		panic(err)
	}
	write(out, "example.dcard", archive.Bytes())
}
func main() {
	if len(os.Args) < 2 || len(os.Args) > 3 {
		fmt.Fprintln(os.Stderr, "Usage: go run main.go OUTPUT_DIRECTORY [MODULE_URL]")
		os.Exit(1)
	}
	url := "/compute/go/program.wasm"
	if len(os.Args) == 3 {
		url = os.Args[2]
	}
	generate(os.Args[1], url)
}
