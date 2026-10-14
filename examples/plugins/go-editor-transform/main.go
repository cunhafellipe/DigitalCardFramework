// Offline aspect-ratio grid layout and generated raster decoration.
// Run: go run main.go INPUT.job OUTPUT.result
// Export and review jobs through the framework editor transform controller.
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
	"io"
	"math"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

type object = map[string]any

var identities = []string{"protocol", "requestId", "toolId", "toolVersion", "sourceDigest"}
var pathPattern = regexp.MustCompile(`^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$`)
var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func invalid() error            { return fmt.Errorf("invalid transform") }
func digest(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func canonical(value any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return data
}
func parsed(data []byte) (object, error) {
	if !utf8.Valid(data) {
		return nil, invalid()
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	nodes := 0
	var visit func(int) error
	visit = func(depth int) error {
		nodes++
		if nodes > 100000 || depth > 64 {
			return invalid()
		}
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		if delimiter, ok := token.(json.Delim); ok {
			switch delimiter {
			case '{':
				seen := map[string]bool{}
				for decoder.More() {
					key, err := decoder.Token()
					if err != nil {
						return err
					}
					name, ok := key.(string)
					if !ok || seen[name] {
						return invalid()
					}
					seen[name] = true
					if err = visit(depth + 1); err != nil {
						return err
					}
				}
				closing, err := decoder.Token()
				if err != nil || closing != json.Delim('}') {
					return invalid()
				}
			case '[':
				for decoder.More() {
					if err := visit(depth + 1); err != nil {
						return err
					}
				}
				closing, err := decoder.Token()
				if err != nil || closing != json.Delim(']') {
					return invalid()
				}
			default:
				return invalid()
			}
		}
		return nil
	}
	if err := visit(0); err != nil {
		return nil, err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, invalid()
	}
	var value object
	if err := json.Unmarshal(data, &value); err != nil || value == nil {
		return nil, invalid()
	}
	return value, nil
}
func unzip(data []byte) (map[string][]byte, error) {
	if len(data) > 80*1024*1024 {
		return nil, invalid()
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	if len(reader.File) > 2000 {
		return nil, invalid()
	}
	files := map[string][]byte{}
	names := map[string]bool{}
	var total uint64
	for _, entry := range reader.File {
		key := strings.ToLower(entry.Name)
		if !pathPattern.MatchString(entry.Name) || names[key] || entry.Flags&1 != 0 || entry.UncompressedSize64 > 64*1024*1024 {
			return nil, invalid()
		}
		for _, part := range strings.Split(entry.Name, "/") {
			if part == "." || part == ".." {
				return nil, invalid()
			}
		}
		names[key] = true
		total += entry.UncompressedSize64
		if total > 128*1024*1024 {
			return nil, invalid()
		}
		stream, err := entry.Open()
		if err != nil {
			return nil, err
		}
		payload, err := io.ReadAll(io.LimitReader(stream, 64*1024*1024+1))
		_ = stream.Close()
		if err != nil || len(payload) > 64*1024*1024 {
			return nil, invalid()
		}
		files[entry.Name] = payload
	}
	return files, nil
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
func index(files map[string][]byte) object {
	paths := []string{}
	for path := range files {
		if path != "integrity.json" {
			paths = append(paths, path)
		}
	}
	sort.Strings(paths)
	entries := []object{}
	for _, path := range paths {
		entries = append(entries, object{"path": path, "bytes": len(files[path]), "sha256": digest(files[path])})
	}
	descriptor := object{"format": "digital-card-integrity", "version": 1, "files": entries}
	hash := digest(append([]byte("digital-card-package-v1\n"), canonical(descriptor)...))
	descriptor["digest"] = "sha256:" + hash
	return descriptor
}
func number(value any) (float64, bool) {
	result, ok := value.(float64)
	return result, ok && !math.IsNaN(result) && !math.IsInf(result, 0)
}
func objectValue(value any) (object, bool) { result, ok := value.(map[string]any); return result, ok }
func list(value any) ([]any, bool)         { result, ok := value.([]any); return result, ok }
func text(value any) string                { result, _ := value.(string); return result }
func decoration(columns, gap, padding int) []byte {
	const width, height = 192, 288
	var rows bytes.Buffer
	for y := 0; y < height; y++ {
		rows.WriteByte(0)
		for x := 0; x < width; x++ {
			marked := x < 3 || x >= width-3 || y < 3 || y >= height-3
			if y >= 8 && y <= 11 {
				for i := 0; i < columns; i++ {
					delta := x - (i+1)*width/(columns+1)
					if delta >= -2 && delta <= 2 {
						marked = true
					}
				}
			}
			alpha := byte(0)
			if marked {
				alpha = 255
			}
			rows.Write([]byte{byte(120 + columns*12), byte(100 + gap), byte(100 + padding%100), alpha})
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
func unique(base string, names map[string]bool) string {
	name := base
	for suffix := 2; names[name]; suffix++ {
		name = fmt.Sprintf("%s-%d", base, suffix)
	}
	return name
}
func transform(request object, source []byte) ([]byte, error) {
	if len(request) != 8 || request["protocol"] != "digital-card-editor-transform@1" || request["kind"] != "request" || request["toolId"] != "example.grid-decoration" || request["toolVersion"] != "1.0.0" || !uuidPattern.MatchString(text(request["requestId"])) {
		return nil, invalid()
	}
	allowed := map[string]bool{"kind": true, "parameters": true, "grants": true}
	for _, key := range identities {
		allowed[key] = true
	}
	for key := range request {
		if !allowed[key] {
			return nil, invalid()
		}
	}
	if string(canonical(request["grants"])) != `{"capabilities":[],"faces":["front"],"newRasterAssets":true}` {
		return nil, invalid()
	}
	parameters, ok := objectValue(request["parameters"])
	if !ok || len(parameters) != 3 {
		return nil, invalid()
	}
	values := map[string]int{}
	for _, bound := range []struct {
		name     string
		min, max float64
	}{{"columns", 1, 8}, {"gap", 0, 100}, {"padding", 0, 200}} {
		value, ok := number(parameters[bound.name])
		if !ok || math.Trunc(value) != value || value < bound.min || value > bound.max {
			return nil, invalid()
		}
		values[bound.name] = int(value)
	}
	columns, gap, padding := values["columns"], float64(values["gap"]), float64(values["padding"])
	files, err := unzip(source)
	if err != nil {
		return nil, err
	}
	for name := range files {
		if strings.HasPrefix(name, "signatures/") {
			return nil, invalid()
		}
	}
	integrity, err := parsed(files["integrity.json"])
	if err != nil || string(canonical(integrity)) != string(canonical(index(files))) || request["sourceDigest"] != index(files)["digest"] {
		return nil, invalid()
	}
	manifest, err := parsed(files["card.json"])
	if err != nil || manifest["format"] != "digital-card" || manifest["contractVersion"] != "0.1.0" {
		return nil, invalid()
	}
	canvas, ok := objectValue(manifest["canvas"])
	if !ok {
		return nil, invalid()
	}
	width, ok := number(canvas["width"])
	if !ok {
		return nil, invalid()
	}
	height, ok := number(canvas["height"])
	if !ok {
		return nil, invalid()
	}
	faces, ok := objectValue(manifest["faces"])
	if !ok {
		return nil, invalid()
	}
	front, ok := objectValue(faces["front"])
	if !ok {
		return nil, invalid()
	}
	facePath := text(front["scene"])
	scene, err := parsed(files[facePath])
	if err != nil {
		return nil, err
	}
	nodes, ok := list(scene["nodes"])
	if !ok {
		return nil, invalid()
	}
	candidates := []object{}
	for _, item := range nodes {
		node, ok := objectValue(item)
		if !ok {
			return nil, invalid()
		}
		nodeWidth, widthOK := number(node["width"])
		nodeHeight, heightOK := number(node["height"])
		if node["type"] == "image" && node["locked"] != true && widthOK && heightOK && nodeWidth > 0 && nodeHeight > 0 {
			candidates = append(candidates, node)
		}
	}
	if len(candidates) == 0 {
		return nil, invalid()
	}
	columnWidth := (width - 2*padding - gap*float64(columns-1)) / float64(columns)
	availableHeight := height - 2*padding
	if columnWidth <= 0 || availableHeight <= 0 {
		return nil, invalid()
	}
	rowHeights := []float64{}
	sum := float64(0)
	for i := 0; i < len(candidates); i += columns {
		maximum := float64(0)
		for j := i; j < i+columns && j < len(candidates); j++ {
			h := candidates[j]["height"].(float64) * columnWidth / candidates[j]["width"].(float64)
			maximum = math.Max(maximum, h)
		}
		rowHeights = append(rowHeights, maximum)
		sum += maximum
	}
	scale := math.Min(1, (availableHeight-gap*float64(len(rowHeights)-1))/sum)
	if scale <= 0 {
		return nil, invalid()
	}
	cursor := padding
	for row, rowHeight := range rowHeights {
		for col := 0; col < columns; col++ {
			position := row*columns + col
			if position >= len(candidates) {
				break
			}
			node := candidates[position]
			newHeight := node["height"].(float64) * columnWidth / node["width"].(float64) * scale
			node["x"] = padding + float64(col)*(columnWidth+gap) + (columnWidth-columnWidth*scale)/2
			node["y"] = cursor + (rowHeight*scale-newHeight)/2
			node["width"] = columnWidth * scale
			node["height"] = newHeight
		}
		cursor += rowHeight*scale + gap
	}
	assets, ok := list(manifest["assets"])
	if !ok {
		return nil, invalid()
	}
	assetNames := map[string]bool{}
	for _, value := range assets {
		asset, ok := objectValue(value)
		if !ok {
			return nil, invalid()
		}
		assetNames[text(asset["id"])] = true
	}
	assetID := unique("grid-decoration-art", assetNames)
	path := "assets/" + assetID + ".png"
	for files[path] != nil {
		assetID = unique(assetID+"-2", assetNames)
		path = "assets/" + assetID + ".png"
	}
	nodeNames := map[string]bool{}
	var collect func([]any)
	collect = func(items []any) {
		for _, item := range items {
			node, ok := objectValue(item)
			if !ok {
				continue
			}
			nodeNames[text(node["id"])] = true
			if children, ok := list(node["children"]); ok {
				collect(children)
			}
		}
	}
	collect(nodes)
	nodeID := unique("grid-decoration", nodeNames)
	data := decoration(columns, values["gap"], values["padding"])
	manifest["assets"] = append(assets, object{"id": assetID, "path": path, "mediaType": "image/png", "sha256": digest(data), "bytes": len(data), "width": 192, "height": 288, "role": "color"})
	scene["nodes"] = append(nodes, object{"id": nodeID, "name": "Grid decoration", "type": "image", "asset": assetID, "x": 0, "y": 0, "width": width, "height": height})
	files[path] = data
	files["card.json"] = canonical(manifest)
	files[facePath] = canonical(scene)
	files["integrity.json"] = canonical(index(files))
	return archive(files)
}
func run() error {
	if len(os.Args) != 3 {
		return invalid()
	}
	info, err := os.Stat(os.Args[1])
	if err != nil || info.Size() > 80*1024*1024 {
		return invalid()
	}
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		return err
	}
	files, err := unzip(data)
	if err != nil || len(files) != 2 || files["request.json"] == nil || files["source.dcard"] == nil {
		return invalid()
	}
	request, err := parsed(files["request.json"])
	if err != nil {
		return err
	}
	result, err := transform(request, files["source.dcard"])
	if err != nil {
		return err
	}
	header := object{"kind": "result"}
	for _, key := range identities {
		header[key] = request[key]
	}
	output, err := archive(map[string][]byte{"result.json": canonical(header), "result.dcard": result})
	if err != nil {
		return err
	}
	return os.WriteFile(os.Args[2], output, 0644)
}
func main() {
	if run() != nil {
		fmt.Fprintln(os.Stderr, "Editor transform failed")
		os.Exit(1)
	}
}
