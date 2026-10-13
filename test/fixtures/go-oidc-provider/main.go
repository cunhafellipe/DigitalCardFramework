// Synthetic loopback OIDC issuer for conformance tests. This auto-login fixture
// is not a production identity provider. Supply temporary configuration and TLS
// files: go run main.go --config fixture.json --cert cert.pem --key key.pem --port 0.
package main

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math/big"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const maximumBytes = 16384

type configuration struct {
	ClientID    string `json:"clientId"`
	Secret      string `json:"clientSecret"`
	Redirect    string `json:"redirectUri"`
	Subject     string `json:"subject"`
	DisplayName string `json:"displayName"`
	Mode        string `json:"mode"`
	RoleClaims  bool   `json:"roleClaims"`
}

type authorization struct {
	Challenge string
	Nonce     string
	Expires   time.Time
}

type issuer struct {
	config configuration
	url    string
	key    *rsa.PrivateKey
	kid    string
	mutex  sync.Mutex
	codes  map[string]authorization
}

var challengePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var verifierPattern = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)

func boundedText(value string, minimum, maximum int) bool {
	if len(value) < minimum || len(value) > maximum || !utf8.ValidString(value) {
		return false
	}
	for _, character := range value {
		if character < 32 || character == 127 {
			return false
		}
	}
	return true
}

func constantEqual(a, b string) bool {
	aHash, bHash := sha256.Sum256([]byte(a)), sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(aHash[:], bHash[:]) == 1
}

// Reject duplicate configuration members rather than selecting a last value.
func configurationJSON(data []byte) (configuration, error) {
	var result configuration
	if !utf8.Valid(data) {
		return result, errors.New("invalid configuration")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return result, errors.New("invalid configuration")
	}
	seen := map[string]bool{}
	for decoder.More() {
		member, err := decoder.Token()
		name, valid := member.(string)
		if err != nil || !valid || seen[name] {
			return result, errors.New("invalid configuration")
		}
		seen[name] = true
		var value json.RawMessage
		if decoder.Decode(&value) != nil {
			return result, errors.New("invalid configuration")
		}
	}
	if _, err = decoder.Token(); err != nil {
		return result, err
	}
	if _, err = decoder.Token(); err != io.EOF {
		return result, errors.New("invalid configuration")
	}
	decoder = json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&result); err != nil {
		return result, err
	}
	if result.Mode == "" {
		result.Mode = "valid"
	}
	modes := map[string]bool{"valid": true, "wrong-issuer": true, "wrong-audience": true, "wrong-nonce": true, "missing-sub": true, "expired": true, "bad-signature": true, "malformed-claims": true}
	callback, err := url.Parse(result.Redirect)
	if err != nil || callback.User != nil || callback.RawQuery != "" || callback.Fragment != "" || callback.Path != "/auth/callback" || (callback.Scheme != "http" && callback.Scheme != "https") {
		return result, errors.New("invalid configuration")
	}
	ip := net.ParseIP(callback.Hostname())
	if ip == nil || !ip.IsLoopback() {
		return result, errors.New("invalid configuration")
	}
	port, err := strconv.Atoi(callback.Port())
	if err != nil || port < 1 || port > 65535 || !modes[result.Mode] || !boundedText(result.ClientID, 1, 100) || !boundedText(result.Secret, 16, 4096) || !boundedText(result.Subject, 1, 100) || !boundedText(result.DisplayName, 1, 100) {
		return result, errors.New("invalid configuration")
	}
	return result, nil
}

func reply(response http.ResponseWriter, status int, value any) {
	data, err := json.Marshal(value)
	if err != nil || len(data) > maximumBytes {
		status = http.StatusInternalServerError
		data = []byte(`{"error":"server_error"}`)
	}
	response.Header().Set("Content-Type", "application/json")
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.WriteHeader(status)
	_, _ = response.Write(data)
}

func failure(response http.ResponseWriter, status int, code string) {
	reply(response, status, map[string]string{"error": code})
}

func fields(values url.Values, allowed ...string) bool {
	if len(values) > len(allowed) {
		return false
	}
	for name, list := range values {
		found := false
		for _, field := range allowed {
			if field == name {
				found = true
			}
		}
		if !found || len(list) != 1 || !boundedText(list[0], 1, 4096) {
			return false
		}
	}
	return true
}

func randomCode() (string, error) {
	var value [32]byte
	_, err := rand.Read(value[:])
	return base64.RawURLEncoding.EncodeToString(value[:]), err
}

func (provider *issuer) authorize(response http.ResponseWriter, request *http.Request) {
	values, err := url.ParseQuery(request.URL.RawQuery)
	if err != nil || !fields(values, "response_type", "client_id", "redirect_uri", "scope", "code_challenge", "code_challenge_method", "state", "nonce") || values.Get("response_type") != "code" || values.Get("client_id") != provider.config.ClientID || values.Get("redirect_uri") != provider.config.Redirect || values.Get("code_challenge_method") != "S256" || !challengePattern.MatchString(values.Get("code_challenge")) || !boundedText(values.Get("state"), 16, 256) || !boundedText(values.Get("nonce"), 16, 256) {
		failure(response, http.StatusBadRequest, "invalid_request")
		return
	}
	scope := strings.Fields(values.Get("scope"))
	hasOpenID := false
	for _, entry := range scope {
		if entry == "openid" {
			hasOpenID = true
		} else if entry != "profile" {
			failure(response, http.StatusBadRequest, "invalid_scope")
			return
		}
	}
	if !hasOpenID {
		failure(response, http.StatusBadRequest, "invalid_scope")
		return
	}
	code, err := randomCode()
	if err != nil {
		failure(response, http.StatusServiceUnavailable, "temporarily_unavailable")
		return
	}
	provider.mutex.Lock()
	for key, value := range provider.codes {
		if time.Now().After(value.Expires) {
			delete(provider.codes, key)
		}
	}
	if len(provider.codes) >= 1024 {
		provider.mutex.Unlock()
		failure(response, http.StatusTooManyRequests, "temporarily_unavailable")
		return
	}
	provider.codes[code] = authorization{Challenge: values.Get("code_challenge"), Nonce: values.Get("nonce"), Expires: time.Now().Add(time.Minute)}
	provider.mutex.Unlock()
	callback, _ := url.Parse(provider.config.Redirect)
	query := callback.Query()
	query.Set("code", code)
	query.Set("state", values.Get("state"))
	callback.RawQuery = query.Encode()
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Location", callback.String())
	response.WriteHeader(http.StatusSeeOther)
}

func (provider *issuer) signedToken(grant authorization) (string, error) {
	now := time.Now().Unix()
	claims := map[string]any{"iss": provider.url, "aud": provider.config.ClientID, "sub": provider.config.Subject, "name": provider.config.DisplayName, "nonce": grant.Nonce, "iat": now, "exp": now + 120}
	if provider.config.RoleClaims {
		claims["role"] = "admin"
		claims["roles"] = []string{"admin"}
		claims["permissions"] = []string{"catalog.publish", "currency.grant"}
	}
	switch provider.config.Mode {
	case "wrong-issuer":
		claims["iss"] = provider.url + "/different"
	case "wrong-audience":
		claims["aud"] = provider.config.ClientID + "-different"
	case "wrong-nonce":
		claims["nonce"] = grant.Nonce + "-different"
	case "missing-sub":
		delete(claims, "sub")
	case "expired":
		claims["iat"] = now - 3600
		claims["exp"] = now - 3600
	case "malformed-claims":
		claims["sub"] = map[string]string{"invalid": "subject"}
	}
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT", "kid": provider.kid})
	body, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(body)
	digest := sha256.Sum256([]byte(unsigned))
	signature, err := rsa.SignPKCS1v15(rand.Reader, provider.key, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	if provider.config.Mode == "bad-signature" {
		signature[0] ^= 1
	}
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func (provider *issuer) token(response http.ResponseWriter, request *http.Request) {
	mediaType, _, contentErr := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if contentErr != nil || mediaType != "application/x-www-form-urlencoded" || request.URL.RawQuery != "" || len(request.Header.Values("Authorization")) > 1 {
		failure(response, http.StatusBadRequest, "invalid_request")
		return
	}
	request.Body = http.MaxBytesReader(response, request.Body, maximumBytes)
	data, err := io.ReadAll(request.Body)
	if err != nil {
		failure(response, http.StatusRequestEntityTooLarge, "invalid_request")
		return
	}
	values, err := url.ParseQuery(string(data))
	if err != nil || !fields(values, "grant_type", "code", "redirect_uri", "client_id", "client_secret", "code_verifier") || values.Get("grant_type") != "authorization_code" {
		failure(response, http.StatusBadRequest, "invalid_request")
		return
	}
	client, secret := values.Get("client_id"), values.Get("client_secret")
	if request.Header.Get("Authorization") != "" {
		var valid bool
		client, secret, valid = request.BasicAuth()
		if !valid || values.Has("client_secret") || (values.Has("client_id") && values.Get("client_id") != client) {
			failure(response, http.StatusUnauthorized, "invalid_client")
			return
		}
		client, err = url.QueryUnescape(client)
		if err != nil {
			failure(response, http.StatusUnauthorized, "invalid_client")
			return
		}
		secret, err = url.QueryUnescape(secret)
		if err != nil {
			failure(response, http.StatusUnauthorized, "invalid_client")
			return
		}
	}
	if !constantEqual(client, provider.config.ClientID) || !constantEqual(secret, provider.config.Secret) {
		failure(response, http.StatusUnauthorized, "invalid_client")
		return
	}
	provider.mutex.Lock()
	grant, found := provider.codes[values.Get("code")]
	delete(provider.codes, values.Get("code"))
	provider.mutex.Unlock()
	verifier := values.Get("code_verifier")
	digest := sha256.Sum256([]byte(verifier))
	if !found || time.Now().After(grant.Expires) || values.Get("redirect_uri") != provider.config.Redirect || !verifierPattern.MatchString(verifier) || !constantEqual(base64.RawURLEncoding.EncodeToString(digest[:]), grant.Challenge) {
		failure(response, http.StatusBadRequest, "invalid_grant")
		return
	}
	token, err := provider.signedToken(grant)
	if err != nil {
		failure(response, http.StatusServiceUnavailable, "temporarily_unavailable")
		return
	}
	access, err := randomCode()
	if err != nil {
		failure(response, http.StatusServiceUnavailable, "temporarily_unavailable")
		return
	}
	reply(response, http.StatusOK, map[string]any{"token_type": "Bearer", "access_token": access, "id_token": token, "expires_in": 120})
}

func (provider *issuer) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.TLS == nil || len(request.RequestURI) > 8192 || request.ContentLength > maximumBytes {
		failure(response, http.StatusBadRequest, "invalid_request")
		return
	}
	if request.URL.Path == "/token" && request.Method == http.MethodPost {
		provider.token(response, request)
		return
	}
	if request.Method != http.MethodGet || request.ContentLength != 0 || len(request.TransferEncoding) != 0 {
		failure(response, http.StatusMethodNotAllowed, "invalid_request")
		return
	}
	switch request.URL.Path {
	case "/.well-known/openid-configuration":
		reply(response, http.StatusOK, map[string]any{"issuer": provider.url, "authorization_endpoint": provider.url + "/authorize", "token_endpoint": provider.url + "/token", "jwks_uri": provider.url + "/jwks", "response_types_supported": []string{"code"}, "subject_types_supported": []string{"public"}, "id_token_signing_alg_values_supported": []string{"RS256"}, "code_challenge_methods_supported": []string{"S256"}, "token_endpoint_auth_methods_supported": []string{"client_secret_post", "client_secret_basic"}, "scopes_supported": []string{"openid", "profile"}})
	case "/jwks":
		reply(response, http.StatusOK, map[string]any{"keys": []any{map[string]string{"kty": "RSA", "use": "sig", "alg": "RS256", "kid": provider.kid, "n": base64.RawURLEncoding.EncodeToString(provider.key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(provider.key.E)).Bytes())}}})
	case "/authorize":
		provider.authorize(response, request)
	default:
		failure(response, http.StatusNotFound, "invalid_request")
	}
}

type limitedListener struct {
	net.Listener
	capacity chan struct{}
}
type limitedConnection struct {
	net.Conn
	once    sync.Once
	release func()
}

func (connection *limitedConnection) Close() error {
	err := connection.Conn.Close()
	connection.once.Do(connection.release)
	return err
}
func (listener *limitedListener) Accept() (net.Conn, error) {
	connection, err := listener.Listener.Accept()
	if err != nil {
		return nil, err
	}
	select {
	case listener.capacity <- struct{}{}:
		return &limitedConnection{Conn: connection, release: func() { <-listener.capacity }}, nil
	default:
		_ = connection.Close()
		return nil, temporaryLimit{}
	}
}

type temporaryLimit struct{}

func (temporaryLimit) Error() string   { return "fixture connection limit" }
func (temporaryLimit) Temporary() bool { return true }
func (temporaryLimit) Timeout() bool   { return false }

func temporaryCertificate(certPath, keyPath string) error {
	_, certErr := os.Stat(certPath)
	_, keyErr := os.Stat(keyPath)
	if certErr == nil && keyErr == nil {
		return nil
	}
	if !os.IsNotExist(certErr) || !os.IsNotExist(keyErr) {
		return errors.New("invalid certificate paths")
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return err
	}
	template := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "Synthetic loopback issuer"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(24 * time.Hour), IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment | x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, BasicConstraintsValid: true, IsCA: true}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return err
	}
	for _, output := range []struct {
		path  string
		block *pem.Block
	}{{certPath, &pem.Block{Type: "CERTIFICATE", Bytes: der}}, {keyPath, &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}}} {
		file, err := os.OpenFile(output.path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		err = pem.Encode(file, output.block)
		closeErr := file.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

func run() error {
	configPath := flag.String("config", "", "temporary synthetic configuration JSON")
	certPath := flag.String("cert", "", "temporary TLS certificate PEM")
	keyPath := flag.String("key", "", "temporary TLS private key PEM")
	port := flag.Int("port", 0, "loopback HTTPS port")
	flag.Parse()
	if *port < 0 || *port > 65535 || flag.NArg() != 0 {
		return errors.New("invalid configuration")
	}
	file, err := os.Open(*configPath)
	if err != nil {
		return err
	}
	data, readErr := io.ReadAll(io.LimitReader(file, maximumBytes+1))
	_ = file.Close()
	if readErr != nil || len(data) > maximumBytes {
		return errors.New("invalid configuration")
	}
	config, err := configurationJSON(data)
	if err != nil {
		return err
	}
	if err := temporaryCertificate(*certPath, *keyPath); err != nil {
		return err
	}
	certificate, err := tls.LoadX509KeyPair(*certPath, *keyPath)
	if err != nil {
		return err
	}
	leaf, err := x509.ParseCertificate(certificate.Certificate[0])
	if err != nil || leaf.VerifyHostname("127.0.0.1") != nil {
		return errors.New("invalid certificate")
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		return err
	}
	defer listener.Close()
	actualPort := listener.Addr().(*net.TCPAddr).Port
	keyDigest := sha256.Sum256(key.N.Bytes())
	provider := &issuer{config: config, url: fmt.Sprintf("https://127.0.0.1:%d", actualPort), key: key, kid: hex.EncodeToString(keyDigest[:8]), codes: map[string]authorization{}}
	server := &http.Server{Handler: provider, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second, MaxHeaderBytes: 8192, ErrorLog: log.New(io.Discard, "", 0)}
	tlsListener := tls.NewListener(&limitedListener{Listener: listener, capacity: make(chan struct{}, 32)}, &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12})
	if err := json.NewEncoder(os.Stdout).Encode(map[string]any{"port": actualPort, "issuer": provider.url}); err != nil {
		return err
	}
	return server.Serve(tlsListener)
}

func main() {
	if run() != nil {
		_, _ = fmt.Fprintln(os.Stderr, "Synthetic issuer failed")
		os.Exit(1)
	}
}
