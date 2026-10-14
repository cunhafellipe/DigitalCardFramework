// Operator-owned synthetic authorization using the Go standard library.
// Run: access-provider records.json [loopback-port]. Set ACCESS_PROVIDER_TOKEN;
// ACCESS_PROVIDER_ID defaults to example.access. POST to /access-provider.
// Records contain identities with issuer, subject, userId, status; allowed records
// also have role and permissions. Exact identities require explicit records.
// The fixture is reread on each request; replace it atomically for live changes.
// This service resolves authenticated identities; it does not perform login.
// Admin requires an explicit record and independent host approval of authority.
package main

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const maxBody = 65536
const maxInteger int64 = 9007199254740991

var identifierPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$`)
var uuidPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)

const names = "protocol operation scope requestId providerId grantId generation deadline issuer subject userId"

var permissions = strings.Fields("admin.read admin.manage admin.cards catalog.read card-policies.read card-policies.manage card-stats.provide catalog.preview catalog.publish accounts.register currency.grant currency.settle audit.read events.read maintenance.run trading.manage actions.manage actions.dispatch commerce.manage raffles.draw codes.manage bindings.manage codes.import codes.confirm art.import art.review art.publish art.moderate")

func identifier(value any) bool {
	s, ok := value.(string)
	return ok && identifierPattern.MatchString(s) && s != "constructor" && s != "prototype" && s != "__proto__"
}
func matches(value any, pattern *regexp.Regexp) bool {
	s, ok := value.(string)
	return ok && pattern.MatchString(s)
}
func integer(value any, minimum, maximum int64) bool {
	_, ok := integerValue(value, minimum, maximum)
	return ok
}
func integerValue(value any, minimum, maximum int64) (int64, bool) {
	n, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	// Normalize decimal digits exactly, without floating-point rounding or large powers.
	text := string(n)
	negative := strings.HasPrefix(text, "-")
	if negative {
		text = text[1:]
	}
	mantissa := text
	if at := strings.IndexAny(mantissa, "eE"); at >= 0 {
		mantissa = mantissa[:at]
	}
	if strings.Trim(strings.ReplaceAll(mantissa, ".", ""), "0") == "" {
		return 0, minimum <= 0 && maximum >= 0
	}
	exponent := int64(0)
	if at := strings.IndexAny(text, "eE"); at >= 0 {
		var err error
		exponent, err = strconv.ParseInt(text[at+1:], 10, 32)
		if err != nil || exponent < -maxBody || exponent > maxBody {
			return 0, false
		}
		text = text[:at]
	}
	if at := strings.IndexByte(text, '.'); at >= 0 {
		exponent -= int64(len(text) - at - 1)
		text = text[:at] + text[at+1:]
	}
	text = strings.TrimLeft(text, "0")
	if text == "" {
		return 0, minimum <= 0 && maximum >= 0
	}
	trimmed := strings.TrimRight(text, "0")
	exponent += int64(len(text) - len(trimmed))
	text = trimmed
	if negative || exponent < 0 || int64(len(text))+exponent > 16 {
		return 0, false
	}
	v, err := strconv.ParseInt(text+strings.Repeat("0", int(exponent)), 10, 64)
	return v, err == nil && v >= minimum && v <= maximum
}
func fields(value any, names string) (map[string]any, bool) {
	m, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	keys := strings.Fields(names)
	if len(m) != len(keys) {
		return nil, false
	}
	for _, key := range keys {
		if _, exists := m[key]; !exists {
			return nil, false
		}
	}
	return m, true
}
func oneOf(value any, names string) bool {
	s, ok := value.(string)
	if !ok {
		return false
	}
	for _, name := range strings.Fields(names) {
		if s == name {
			return true
		}
	}
	return false
}

// encoding/json replaces invalid Unicode; reject it before decoding instead.
func unicodeJSON(raw []byte) bool {
	if !utf8.Valid(raw) {
		return false
	}
	for i := 0; i < len(raw); i++ {
		if raw[i] != '\\' {
			continue
		}
		i++
		if i >= len(raw) {
			return false
		}
		if raw[i] != 'u' {
			continue
		}
		if i+4 >= len(raw) {
			return false
		}
		unit, err := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		if err != nil {
			return false
		}
		i += 4
		if unit >= 0xdc00 && unit <= 0xdfff {
			return false
		}
		if unit >= 0xd800 && unit <= 0xdbff {
			if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
				return false
			}
			low, err := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
			if err != nil || low < 0xdc00 || low > 0xdfff {
				return false
			}
			i += 6
		}
	}
	return true
}
func decode(raw []byte) (map[string]any, error) {
	if !unicodeJSON(raw) {
		return nil, fmt.Errorf("invalid Unicode")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	nodes := 0
	var parse func(int) (any, error)
	parse = func(depth int) (any, error) {
		nodes++
		if depth > 18 || nodes > 20020 {
			return nil, fmt.Errorf("JSON limit")
		}
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		delimiter, container := token.(json.Delim)
		if !container {
			return token, nil
		}
		if delimiter == '{' {
			value := map[string]any{}
			for decoder.More() {
				keyToken, err := decoder.Token()
				if err != nil {
					return nil, err
				}
				key, ok := keyToken.(string)
				if !ok {
					return nil, fmt.Errorf("invalid key")
				}
				if _, exists := value[key]; exists {
					return nil, fmt.Errorf("duplicate property")
				}
				child, err := parse(depth + 1)
				if err != nil {
					return nil, err
				}
				value[key] = child
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim('}') {
				return nil, fmt.Errorf("invalid object")
			}
			return value, nil
		}
		if delimiter == '[' {
			value := []any{}
			for decoder.More() {
				child, err := parse(depth + 1)
				if err != nil {
					return nil, err
				}
				value = append(value, child)
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim(']') {
				return nil, fmt.Errorf("invalid array")
			}
			return value, nil
		}
		return nil, fmt.Errorf("invalid delimiter")
	}
	parsed, err := parse(0)
	if err != nil {
		return nil, err
	}
	value, ok := parsed.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("object required")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, fmt.Errorf("trailing data")
	}
	return value, nil
}

func text(value any, maximum int) bool {
	s, ok := value.(string)
	if !ok || len([]rune(s)) < 1 || len([]rune(s)) > maximum {
		return false
	}
	for _, r := range s {
		if r < 32 || r == 127 {
			return false
		}
	}
	return true
}
func identity(m map[string]any) bool {
	return text(m["issuer"], 2000) && text(m["subject"], 512) && identifier(m["userId"])
}
func validate(m map[string]any, provider string) bool {
	_, ok := fields(m, names)
	return ok && m["protocol"] == "digital-card-access-provider@1" && m["operation"] == "resolveAccess" && m["scope"] == "access" && m["providerId"] == provider && matches(m["requestId"], uuidPattern) && matches(m["grantId"], uuidPattern) && integer(m["generation"], 1, maxInteger) && integer(m["deadline"], 1, maxInteger) && identity(m)
}
func identityKey(m map[string]any) [3]string {
	return [3]string{m["issuer"].(string), m["subject"].(string), m["userId"].(string)}
}
func loadRecords(filename string) (map[[3]string]map[string]any, error) {
	f, err := os.Open(filename)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, maxBody+1))
	if err != nil || len(raw) > maxBody {
		return nil, fmt.Errorf("fixture limit")
	}
	m, err := decode(raw)
	if err != nil {
		return nil, err
	}
	_, ok := fields(m, "identities")
	list, listOK := m["identities"].([]any)
	if !ok || !listOK || len(list) > 100 {
		return nil, fmt.Errorf("invalid records")
	}
	result := map[[3]string]map[string]any{}
	for _, value := range list {
		record, ok := value.(map[string]any)
		if !ok || !oneOf(record["status"], "allowed denied disabled") {
			return nil, fmt.Errorf("invalid record")
		}
		expected := "issuer subject userId status"
		if record["status"] == "allowed" {
			expected += " role permissions"
		}
		if _, ok := fields(record, expected); !ok || !identity(record) {
			return nil, fmt.Errorf("invalid identity")
		}
		key := identityKey(record)
		if _, exists := result[key]; exists {
			return nil, fmt.Errorf("duplicate identity")
		}
		decision := map[string]any{"status": record["status"]}
		if record["status"] == "allowed" {
			list, ok := record["permissions"].([]any)
			if !ok || len(list) > len(permissions) || !oneOf(record["role"], "player admin") {
				return nil, fmt.Errorf("invalid authority")
			}
			seen := map[string]bool{}
			for _, p := range list {
				s, ok := p.(string)
				if !ok || seen[s] || !oneOf(s, strings.Join(permissions, " ")) {
					return nil, fmt.Errorf("invalid permission")
				}
				seen[s] = true
			}
			decision["role"] = record["role"]
			decision["permissions"] = list
		}
		result[key] = decision
	}
	return result, nil
}
func reply(w http.ResponseWriter, status int, value map[string]any) {
	raw, err := json.Marshal(value)
	if err != nil || len(raw) > 32768 {
		status = 500
		raw = []byte("{}")
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", strconv.Itoa(len(raw)))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "close")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}
func main() {
	provider := os.Getenv("ACCESS_PROVIDER_ID")
	if provider == "" {
		provider = "example.access"
	}
	token := os.Getenv("ACCESS_PROVIDER_TOKEN")
	validToken := len(token) >= 16 && len(token) <= 4096
	for _, r := range token {
		if r < 33 || r > 126 {
			validToken = false
		}
	}
	if len(os.Args) < 2 || !identifier(provider) || !validToken {
		fmt.Fprintln(os.Stderr, "Invalid access provider configuration")
		os.Exit(1)
	}
	filename := os.Args[1]
	if _, err := loadRecords(filename); err != nil {
		fmt.Fprintln(os.Stderr, "Invalid access provider configuration")
		os.Exit(1)
	}
	port := "0"
	if len(os.Args) > 2 {
		port = os.Args[2]
	}
	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Access provider startup failed")
		os.Exit(1)
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.RequestURI() != "/access-provider" || len(r.TransferEncoding) > 0 || r.ContentLength <= 0 || r.ContentLength > maxBody || len(r.Header.Values("Content-Type")) != 1 || strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])) != "application/json" {
			reply(w, 400, map[string]any{})
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
		if err != nil {
			reply(w, 400, map[string]any{})
			return
		}
		request, err := decode(raw)
		if err != nil || !validate(request, provider) {
			reply(w, 400, map[string]any{})
			return
		}
		failure := func(status int, code string) {
			request["status"] = "error"
			request["errorCode"] = code
			reply(w, status, request)
		}
		if len(r.Header.Values("Authorization")) != 1 || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			failure(401, "unauthenticated")
			return
		}
		deadline, _ := integerValue(request["deadline"], 1, maxInteger)
		if deadline <= time.Now().UnixMilli() {
			failure(503, "unavailable")
			return
		}
		records, err := loadRecords(filename)
		if err != nil {
			failure(503, "unavailable")
			return
		}
		decision, exists := records[identityKey(request)]
		if !exists {
			decision = map[string]any{"status": "denied"}
		}
		for key, value := range decision {
			request[key] = value
		}
		reply(w, 200, request)
	})
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second, MaxHeaderBytes: 8192}
	fmt.Println(listener.Addr().(*net.TCPAddr).Port)
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, "Access provider stopped")
		os.Exit(1)
	}
}
