// Read-only synthetic transfer and trade eligibility using the Go standard library.
// Run: transfer-policy records.json [loopback-port]. Set TRANSFER_POLICY_TOKEN;
// TRANSFER_POLICY_PROVIDER_ID defaults to example.transfer. Records contain actors
// with id, recipientIds and allowListingReservation. Every route requires explicit
// permission. This fixture never allocates copies, changes ownership or pays funds.
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

const maxBody = 262144
const maxInteger int64 = 9007199254740991

var identifierPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$`)
var uuidPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
var digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var decimalPattern = regexp.MustCompile(`^[0-9]+$`)

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
func ids(value any, minimum int) ([]any, bool) {
	items, ok := value.([]any)
	if !ok || len(items) < minimum || len(items) > 2000 {
		return nil, false
	}
	seen := map[string]bool{}
	for _, item := range items {
		if !matches(item, uuidPattern) {
			return nil, false
		}
		s := item.(string)
		if seen[s] {
			return nil, false
		}
		seen[s] = true
	}
	return items, true
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

type actor struct {
	recipients  map[string]bool
	reservation bool
}
type route struct {
	from string
	to   any
}

func loadRecords(filename string) (map[string]actor, error) {
	file, err := os.Open(filename)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, 65537))
	if err != nil || len(raw) > 65536 {
		return nil, fmt.Errorf("fixture records exceed limit")
	}
	value, err := decode(raw)
	if err != nil {
		return nil, err
	}
	_, valid := fields(value, "actors")
	items, ok := value["actors"].([]any)
	if !valid || !ok || len(items) > 100 {
		return nil, fmt.Errorf("invalid fixture records")
	}
	actors := map[string]actor{}
	for _, item := range items {
		record, valid := fields(item, "id recipientIds allowListingReservation")
		if !valid || !identifier(record["id"]) {
			return nil, fmt.Errorf("invalid actor record")
		}
		id := record["id"].(string)
		if _, exists := actors[id]; exists {
			return nil, fmt.Errorf("duplicate actor")
		}
		reservation, ok := record["allowListingReservation"].(bool)
		if !ok {
			return nil, fmt.Errorf("invalid reservation")
		}
		recipients, ok := record["recipientIds"].([]any)
		if !ok || len(recipients) > 100 {
			return nil, fmt.Errorf("invalid recipients")
		}
		set := map[string]bool{}
		for _, recipient := range recipients {
			if !identifier(recipient) {
				return nil, fmt.Errorf("invalid recipient")
			}
			s := recipient.(string)
			if set[s] {
				return nil, fmt.Errorf("duplicate recipient")
			}
			set[s] = true
		}
		actors[id] = actor{set, reservation}
	}
	return actors, nil
}
func offer(value any) (int, bool) {
	m, ok := fields(value, "copyIds currencies")
	if !ok {
		return 0, false
	}
	copies, ok := ids(m["copyIds"], 0)
	if !ok {
		return 0, false
	}
	currencies, ok := m["currencies"].([]any)
	if !ok || len(currencies) > 100 {
		return 0, false
	}
	for _, item := range currencies {
		currency, ok := fields(item, "currencyId amount")
		if !ok || !identifier(currency["currencyId"]) || !integer(currency["amount"], 0, maxInteger) {
			return 0, false
		}
	}
	return len(copies), true
}
func validate(request map[string]any, provider string) ([]route, bool) {
	_, ok := fields(request, "protocol operation scope phase requestId providerId grantId generation commandId inputDigest snapshotDigest deadline context")
	if !ok || request["providerId"] != provider || !matches(request["requestId"], uuidPattern) || !matches(request["grantId"], uuidPattern) || !integer(request["generation"], 1, maxInteger) || !integer(request["deadline"], 1, maxInteger) {
		return nil, false
	}
	for _, key := range []string{"commandId", "inputDigest", "snapshotDigest"} {
		if !matches(request[key], digestPattern) {
			return nil, false
		}
	}
	if request["operation"] == "canTransfer" {
		context, ok := fields(request["context"], "channel legs")
		if !ok || request["protocol"] != "digital-card-transfer-policy@1" || request["scope"] != "transfer" || !oneOf(request["phase"], "review propose counter accept list quote purchase") || !oneOf(context["channel"], "trade sale") {
			return nil, false
		}
		legs, ok := context["legs"].([]any)
		if !ok || len(legs) < 1 || len(legs) > 2 {
			return nil, false
		}
		routes := []route{}
		combined := map[string]bool{}
		total := 0
		for _, item := range legs {
			leg, ok := fields(item, "fromUserId toUserId copyIds versions")
			if !ok || !identifier(leg["fromUserId"]) || (leg["toUserId"] != nil && !identifier(leg["toUserId"])) {
				return nil, false
			}
			copies, ok := ids(leg["copyIds"], 1)
			if !ok {
				return nil, false
			}
			versions, ok := leg["versions"].([]any)
			if !ok || len(versions) != len(copies) {
				return nil, false
			}
			for _, version := range versions {
				if !integer(version, 1, maxInteger) {
					return nil, false
				}
			}
			total += len(copies)
			if total > 2000 {
				return nil, false
			}
			for _, copy := range copies {
				s := copy.(string)
				if combined[s] {
					return nil, false
				}
				combined[s] = true
			}
			routes = append(routes, route{leg["fromUserId"].(string), leg["toUserId"]})
		}
		return routes, true
	}
	if request["operation"] == "canTrade" {
		context, ok := request["context"].(map[string]any)
		if !ok {
			return nil, false
		}
		names := "channel fromUserId toUserId give receive"
		if _, exists := context["expiresInSeconds"]; exists {
			names += " expiresInSeconds"
			if !integer(context["expiresInSeconds"], 1, 604800) {
				return nil, false
			}
		}
		if _, ok := fields(context, names); !ok || request["protocol"] != "digital-card-trade-policy@1" || request["scope"] != "exchange" || !oneOf(request["phase"], "review propose counter accept quote purchase") || !oneOf(context["channel"], "trade sale") || !identifier(context["fromUserId"]) || !identifier(context["toUserId"]) {
			return nil, false
		}
		give, ok := offer(context["give"])
		if !ok {
			return nil, false
		}
		receive, ok := offer(context["receive"])
		if !ok || give+receive > 2000 {
			return nil, false
		}
		return []route{{context["fromUserId"].(string), context["toUserId"]}}, true
	}
	return nil, false
}
func reply(w http.ResponseWriter, status int, value map[string]any) {
	raw, err := json.Marshal(value)
	if err != nil || len(raw) > 8192 {
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
func run() error {
	if len(os.Args) < 2 || len(os.Args) > 3 {
		return fmt.Errorf("usage: transfer-policy records.json [loopback-port]")
	}
	provider, exists := os.LookupEnv("TRANSFER_POLICY_PROVIDER_ID")
	if !exists {
		provider = "example.transfer"
	}
	if !identifier(provider) {
		return fmt.Errorf("invalid provider identity")
	}
	token := os.Getenv("TRANSFER_POLICY_TOKEN")
	if len(token) < 16 || len(token) > 4096 {
		return fmt.Errorf("provider credential required")
	}
	for _, b := range []byte(token) {
		if b < 0x21 || b > 0x7e {
			return fmt.Errorf("invalid provider credential")
		}
	}
	actors, err := loadRecords(os.Args[1])
	if err != nil {
		return err
	}
	port := 0
	if len(os.Args) == 3 {
		port, err = strconv.Atoi(os.Args[2])
		if err != nil || port < 0 || port > 65535 {
			return fmt.Errorf("invalid loopback port")
		}
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		return err
	}
	defer listener.Close()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		authorization := r.Header.Values("Authorization")
		if len(authorization) != 1 || subtle.ConstantTimeCompare([]byte(authorization[0]), []byte("Bearer "+token)) != 1 {
			reply(w, 401, map[string]any{})
			return
		}
		contentTypes := r.Header.Values("Content-Type")
		lengths := r.Header.Values("Content-Length")
		if r.Method != "POST" || r.RequestURI != "/transfer-policy" || len(r.TransferEncoding) != 0 || len(lengths) != 1 || !decimalPattern.MatchString(lengths[0]) || r.ContentLength <= 0 || r.ContentLength > maxBody || len(contentTypes) != 1 || strings.ToLower(strings.TrimSpace(strings.Split(contentTypes[0], ";")[0])) != "application/json" {
			reply(w, 400, map[string]any{})
			return
		}
		raw, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
		if err != nil || int64(len(raw)) != r.ContentLength {
			reply(w, 400, map[string]any{})
			return
		}
		request, err := decode(raw)
		if err != nil {
			reply(w, 400, map[string]any{})
			return
		}
		routes, valid := validate(request, provider)
		if !valid {
			reply(w, 400, map[string]any{})
			return
		}
		allowed := true
		for _, route := range routes {
			actor := actors[route.from]
			if route.to == nil {
				allowed = allowed && actor.reservation
			} else {
				allowed = allowed && actor.recipients[route.to.(string)]
			}
		}
		result := map[string]any{}
		for key, value := range request {
			if key != "context" {
				result[key] = value
			}
		}
		for _, key := range []string{"generation", "deadline"} {
			value, _ := integerValue(request[key], 1, maxInteger)
			result[key] = value
		}
		result["status"] = "allowed"
		if !allowed {
			result["status"] = "denied"
			result["reasonCode"] = "restricted"
		}
		reply(w, 200, result)
	})
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second, MaxHeaderBytes: 8192}
	server.SetKeepAlivesEnabled(false)
	fmt.Println(listener.Addr().(*net.TCPAddr).Port)
	return server.Serve(listener)
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
