// Write a portable layered card package using the Go standard library.
// Run: go run main.go OUTPUT.dcard
// Open the archive in Studio to edit layers and capture updated posters.
package main

import (
	"archive/zip"
	"bytes"
	"compress/zlib"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"os"
	"sort"
	"strings"
	"time"
)

const width, height = 192, 288

type object = map[string]any

func absolute(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
func digest(data []byte) string { hash := sha256.Sum256(data); return hex.EncodeToString(hash[:]) }
func canonical(value any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return data
}

func pixels(kind string, back bool) []byte {
	output := make([]byte, 0, width*height*4)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			dx, dy := x-width/2, y-130
			radius, diamond := dx*dx+dy*dy, absolute(dx)+absolute(dy)
			background := [4]byte{byte(18 + y*22/height), byte(26 + y*15/height), byte(60 + y*40/height), 255}
			if back {
				background = [4]byte{byte(10 + y*12/height), byte(35 + y*25/height), byte(44 + y*32/height), 255}
			}
			if x == 7 || x == width-8 || y == 7 || y == height-8 {
				background = [4]byte{153, 129, 77, 255}
			} else if y < 180 && (x*19+y*23)%997 < 3 {
				background = [4]byte{220, 211, 166, 255}
			}
			emblem := [4]byte{}
			if back {
				if (diamond >= 58 && diamond <= 62) || (absolute(dx) < 3 && absolute(dy) < 20) {
					emblem = [4]byte{197, 176, 109, 255}
				}
			} else if radius >= 48*48 && radius <= 58*58 {
				emblem = [4]byte{223, 178, 88, 255}
			} else if diamond < 28 {
				emblem = [4]byte{80, 190, 191, 255}
			}
			color := background
			switch kind {
			case "mask":
				color = [4]byte{255, 255, 255, 0}
				if radius <= 58*58 {
					color[3] = 255
				}
			case "emblem":
				color = emblem
			case "background":
			default:
				if emblem[3] != 0 {
					color = emblem
				}
			}
			output = append(output, color[:]...)
		}
	}
	return output
}

func png(data []byte) []byte {
	var result bytes.Buffer
	result.Write([]byte{137, 80, 78, 71, 13, 10, 26, 10})
	chunk := func(name string, payload []byte) {
		_ = binary.Write(&result, binary.BigEndian, uint32(len(payload)))
		result.WriteString(name)
		result.Write(payload)
		_ = binary.Write(&result, binary.BigEndian, crc32.ChecksumIEEE(append([]byte(name), payload...)))
	}
	header := make([]byte, 13)
	binary.BigEndian.PutUint32(header, width)
	binary.BigEndian.PutUint32(header[4:], height)
	header[8] = 8
	header[9] = 6
	chunk("IHDR", header)
	var compressed bytes.Buffer
	writer, _ := zlib.NewWriterLevel(&compressed, 9)
	for y := 0; y < height; y++ {
		_, _ = writer.Write([]byte{0})
		_, _ = writer.Write(data[y*width*4 : (y+1)*width*4])
	}
	_ = writer.Close()
	chunk("IDAT", compressed.Bytes())
	chunk("IEND", nil)
	return result.Bytes()
}

func build(path string) error {
	files := map[string][]byte{}
	assets := []object{}
	asset := func(name, kind string, data []byte) {
		entry := "assets/" + name + ".png"
		files[entry] = data
		assets = append(assets, object{"id": name, "path": entry, "mediaType": "image/png", "sha256": digest(data), "bytes": len(data), "width": width, "height": height, "role": kind})
	}
	for _, side := range []string{"front", "back"} {
		for _, kind := range []string{"poster", "background", "emblem"} {
			role := "color"
			if kind == "poster" {
				role = "poster"
			}
			asset(side+"-"+kind, role, png(pixels(kind, side == "back")))
		}
	}
	asset("foil-mask", "mask", png(pixels("mask", false)))
	faces := object{}
	for _, side := range []string{"front", "back"} {
		faces[side] = object{"scene": "scenes/" + side + ".json", "poster": side + "-poster", "description": "Celestial " + side}
	}
	manifest := object{"format": "digital-card", "contractVersion": "0.1.0", "id": "example.celestial-card", "revision": 1, "title": "Celestial Study", "summary": "Layered celestial artwork with a masked foil surface and bounded tilt motion.", "profile": "portable", "canvas": object{"width": 600, "height": 900}, "faces": faces, "assets": assets, "capabilities": object{"required": []string{"dc.scene2d@0.1", "dc.motion@0.1", "dc.materials@0.1"}, "optional": []string{}}, "quality": object{"poster": object{"maxEdge": 288}, "lite": object{"maxEdge": 600}, "standard": object{"maxEdge": 900}}}
	files["card.json"] = canonical(manifest)
	for _, side := range []string{"front", "back"} {
		nodes := []object{}
		for _, kind := range []string{"background", "emblem"} {
			nodes = append(nodes, object{"id": side + "-" + kind, "name": strings.ToUpper(side[:1]) + side[1:] + " " + kind, "type": "image", "asset": side + "-" + kind, "x": 0, "y": 0, "width": 600, "height": 900})
		}
		if side == "front" {
			nodes[1]["material"] = object{"kind": "foil", "seed": 17, "intensity": 0.45, "roughness": 0.25, "variation": 0.3, "maskAsset": "foil-mask"}
			nodes[1]["bindings"] = object{"rotation": []any{"mul", []any{"clamp", []any{"input", "tilt.x"}, -1, 1}, 6}, "material.angle": []any{"mul", []any{"clamp", []any{"input", "tilt.x"}, -1, 1}, 35}}
		}
		files["scenes/"+side+".json"] = canonical(object{"dialect": "dc.scene2d@0.1", "nodes": nodes})
	}
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
	paths = append(paths, "integrity.json")
	sort.Strings(paths)
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	writer := zip.NewWriter(file)
	for _, name := range paths {
		data := files[name]
		header := &zip.FileHeader{Name: name, Method: zip.Store, Flags: 0x800, CRC32: crc32.ChecksumIEEE(data), CompressedSize64: uint64(len(data)), UncompressedSize64: uint64(len(data))}
		header.SetModTime(time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC))
		entry, err := writer.CreateRaw(header)
		if err != nil {
			_ = writer.Close()
			_ = file.Close()
			return err
		}
		if _, err = entry.Write(data); err != nil {
			_ = writer.Close()
			_ = file.Close()
			return err
		}
	}
	if err = writer.Close(); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func run() error {
	if len(os.Args) != 2 {
		return errors.New("Usage: card-art OUTPUT.dcard")
	}
	return build(os.Args[1])
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Card artwork export failed")
		os.Exit(1)
	}
}
