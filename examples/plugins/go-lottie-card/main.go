// Write passive vector star keyframes in a portable card package.
// Run: go run main.go [--clock] OUTPUT.dcard
// The host installs dotLottieAdapter with its self-hosted runtime.
package main

import (
	"archive/zip"
	"bytes"
	"compress/zlib"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"os"
	"sort"
	"time"
)

type object = map[string]any

const starJSON = `{"assets":[],"ddd":0,"fr":30,"h":450,"ip":0,"layers":[{"bm":0,"ddd":0,"ind":1,"ip":0,"ks":{"a":{"a":0,"k":[0,0,0]},"o":{"a":1,"k":[{"e":[35],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[100],"t":0},{"e":[100],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[35],"t":30},{"s":[100],"t":60}]},"p":{"a":1,"k":[{"e":[115,75,0],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[75,100,0],"t":0},{"e":[130,135,0],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[115,75,0],"t":30},{"s":[130,135,0],"t":60}]},"r":{"a":1,"k":[{"e":[90],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[0],"t":0},{"e":[180],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[90],"t":30},{"s":[180],"t":60}]},"s":{"a":0,"k":[100,100,100]}},"nm":"Star 1","op":60,"shapes":[{"ks":{"a":0,"k":{"c":true,"i":[[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0]],"o":[[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0]],"v":[[0,-9],[3,-3],[9,0],[3,3],[0,9],[-3,3],[-9,0],[-3,-3]]}},"nm":"Vector star","ty":"sh"},{"c":{"a":0,"k":[1,0.82,0.45,1]},"o":{"a":0,"k":100},"r":1,"ty":"fl"}],"sr":1,"st":0,"ty":4},{"bm":0,"ddd":0,"ind":2,"ip":0,"ks":{"a":{"a":0,"k":[0,0,0]},"o":{"a":1,"k":[{"e":[35],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[100],"t":0},{"e":[100],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[35],"t":30},{"s":[100],"t":60}]},"p":{"a":1,"k":[{"e":[210,260,0],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[165,230,0],"t":0},{"e":[145,285,0],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[210,260,0],"t":30},{"s":[145,285,0],"t":60}]},"r":{"a":1,"k":[{"e":[90],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[0],"t":0},{"e":[180],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[90],"t":30},{"s":[180],"t":60}]},"s":{"a":0,"k":[100,100,100]}},"nm":"Star 2","op":60,"shapes":[{"ks":{"a":0,"k":{"c":true,"i":[[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0]],"o":[[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0]],"v":[[0,-9],[3,-3],[9,0],[3,3],[0,9],[-3,3],[-9,0],[-3,-3]]}},"nm":"Vector star","ty":"sh"},{"c":{"a":0,"k":[0.4,0.9,0.9,1]},"o":{"a":0,"k":100},"r":1,"ty":"fl"}],"sr":1,"st":0,"ty":4},{"bm":0,"ddd":0,"ind":3,"ip":0,"ks":{"a":{"a":0,"k":[0,0,0]},"o":{"a":1,"k":[{"e":[35],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[100],"t":0},{"e":[100],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[35],"t":30},{"s":[100],"t":60}]},"p":{"a":1,"k":[{"e":[190,330,0],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[235,355,0],"t":0},{"e":[200,395,0],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[190,330,0],"t":30},{"s":[200,395,0],"t":60}]},"r":{"a":1,"k":[{"e":[90],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[0],"t":0},{"e":[180],"i":{"x":[0.67],"y":[1]},"o":{"x":[0.33],"y":[0]},"s":[90],"t":30},{"s":[180],"t":60}]},"s":{"a":0,"k":[100,100,100]}},"nm":"Star 3","op":60,"shapes":[{"ks":{"a":0,"k":{"c":true,"i":[[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0]],"o":[[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0]],"v":[[0,-9],[3,-3],[9,0],[3,3],[0,9],[-3,3],[-9,0],[-3,-3]]}},"nm":"Vector star","ty":"sh"},{"c":{"a":0,"k":[0.9,0.6,1,1]},"o":{"a":0,"k":100},"r":1,"ty":"fl"}],"sr":1,"st":0,"ty":4}],"nm":"Passive starfield","op":60,"v":"5.7.0","w":300}`

func digest(data []byte) string { hash := sha256.Sum256(data); return hex.EncodeToString(hash[:]) }
func canonical(value any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return data
}
func absolute(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
func archive(files map[string][]byte) ([]byte, error) {
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	paths := []string{}
	for path := range files {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		data := files[path]
		header := &zip.FileHeader{Name: path, Method: zip.Store, Flags: 0x800, CRC32: crc32.ChecksumIEEE(data), CompressedSize64: uint64(len(data)), UncompressedSize64: uint64(len(data))}
		header.SetModTime(time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC))
		entry, err := writer.CreateRaw(header)
		if err != nil {
			return nil, err
		}
		if _, err = entry.Write(data); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
func poster(kind string) []byte {
	const width, height = 128, 192
	var rows bytes.Buffer
	for y := 0; y < height; y++ {
		rows.WriteByte(0)
		for x := 0; x < width; x++ {
			color := [4]byte{byte(12 + y*14/height), byte(22 + y*12/height), byte(46 + y*30/height), 255}
			if kind == "back" {
				color = [4]byte{byte(12 + y*10/height), byte(36 + y*18/height), byte(43 + y*20/height), 255}
			}
			if kind == "front" {
				for _, point := range [][2]int{{32, 42}, {70, 98}, {100, 151}} {
					if absolute(x-point[0])+absolute(y-point[1]) <= 4 {
						color = [4]byte{240, 211, 143, 255}
					}
				}
			}
			if kind == "back" {
				distance := absolute(x-64) + absolute(y-96)
				if distance >= 24 && distance <= 27 {
					color = [4]byte{203, 183, 122, 255}
				}
			}
			rows.Write(color[:])
		}
	}
	var output bytes.Buffer
	output.Write([]byte{137, 80, 78, 71, 13, 10, 26, 10})
	chunk := func(name string, data []byte) {
		_ = binary.Write(&output, binary.BigEndian, uint32(len(data)))
		output.WriteString(name)
		output.Write(data)
		_ = binary.Write(&output, binary.BigEndian, crc32.ChecksumIEEE(append([]byte(name), data...)))
	}
	header := make([]byte, 13)
	binary.BigEndian.PutUint32(header, width)
	binary.BigEndian.PutUint32(header[4:], height)
	header[8] = 8
	header[9] = 6
	chunk("IHDR", header)
	var compressed bytes.Buffer
	writer, _ := zlib.NewWriterLevel(&compressed, 9)
	_, _ = writer.Write(rows.Bytes())
	_ = writer.Close()
	chunk("IDAT", compressed.Bytes())
	chunk("IEND", nil)
	return output.Bytes()
}
func build(path string, clock bool) error {
	var stars object
	if err := json.Unmarshal([]byte(starJSON), &stars); err != nil {
		return err
	}
	dot, err := archive(map[string][]byte{"manifest.json": canonical(object{"version": "2", "animations": []object{{"id": "stars"}}}), "a/stars.json": canonical(stars)})
	if err != nil {
		return err
	}
	files := map[string][]byte{}
	assets := []object{}
	for _, entry := range []struct {
		name, media, role string
		data              []byte
	}{{"front", "image/png", "poster", poster("front")}, {"back", "image/png", "poster", poster("back")}, {"background", "image/png", "color", poster("background")}, {"star-animation", "application/zip", "interactive", dot}} {
		extension := ".png"
		if entry.media == "application/zip" {
			extension = ".lottie"
		}
		assetPath := "assets/" + entry.name + extension
		files[assetPath] = entry.data
		asset := object{"id": entry.name, "path": assetPath, "mediaType": entry.media, "sha256": digest(entry.data), "bytes": len(entry.data), "role": entry.role}
		if entry.media == "image/png" {
			asset["width"] = 128
			asset["height"] = 192
		}
		assets = append(assets, asset)
	}
	manifest := object{"format": "digital-card", "contractVersion": "0.1.0", "id": "example.starfield", "revision": 1, "title": "Passive Starfield", "summary": "Live vector star keyframes with explicit angle or clock control.", "profile": "portable", "canvas": object{"width": 300, "height": 450}, "faces": object{"front": object{"scene": "scenes/front.json", "poster": "front", "description": "Animated starfield"}, "back": object{"scene": "scenes/back.json", "poster": "back", "description": "Observatory emblem"}}, "assets": assets, "capabilities": object{"required": []string{"dc.scene2d@0.1"}, "optional": []object{{"id": "dc.dotlottie@0.1", "fallback": "poster"}}}, "quality": object{"poster": object{"maxEdge": 192}, "lite": object{"maxEdge": 300}, "standard": object{"maxEdge": 450}}}
	files["card.json"] = canonical(manifest)
	files["scenes/front.json"] = canonical(object{"dialect": "dc.scene2d@0.1", "nodes": []object{{"id": "background", "type": "image", "asset": "background", "x": 0, "y": 0, "width": 300, "height": 450}, {"id": "starfield", "type": "adapter", "adapter": "dc.dotlottie", "x": 0, "y": 0, "width": 300, "height": 450, "data": object{"asset": "star-animation", "animation": "stars", "clock": clock, "duration": 2}}}})
	files["scenes/back.json"] = canonical(object{"dialect": "dc.scene2d@0.1", "nodes": []object{{"id": "back", "type": "image", "asset": "back", "x": 0, "y": 0, "width": 300, "height": 450}}})
	paths := []string{}
	for name := range files {
		paths = append(paths, name)
	}
	sort.Strings(paths)
	entries := []object{}
	for _, name := range paths {
		entries = append(entries, object{"path": name, "bytes": len(files[name]), "sha256": digest(files[name])})
	}
	descriptor := object{"format": "digital-card-integrity", "version": 1, "files": entries}
	hash := digest(append([]byte("digital-card-package-v1\n"), canonical(descriptor)...))
	descriptor["digest"] = "sha256:" + hash
	files["integrity.json"] = canonical(descriptor)
	output, err := archive(files)
	if err != nil {
		return err
	}
	return os.WriteFile(path, output, 0644)
}
func run() error {
	if len(os.Args) == 3 && os.Args[1] == "--clock" {
		return build(os.Args[2], true)
	}
	if len(os.Args) == 2 && os.Args[1] != "--clock" {
		return build(os.Args[1], false)
	}
	return fmt.Errorf("Usage: lottie-card [--clock] OUTPUT.dcard")
}
func main() {
	if run() != nil {
		fmt.Fprintln(os.Stderr, "Vector card export failed")
		os.Exit(1)
	}
}
