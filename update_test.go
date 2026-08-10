package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestNewerVersion(t *testing.T) {
	tests := []struct {
		remote, current string
		want            bool
	}{
		{"v1.5", "1.5", false},
		{"v1.6", "1.5", true},
		{"1.10", "1.9", true},
		{"2.0", "1.99.99", true},
		{"1.5.0", "1.5", false},
		{"1.4.9", "1.5", false},
		{"invalid", "1.5", false},
	}
	for _, tt := range tests {
		if got := newerVersion(tt.remote, tt.current); got != tt.want {
			t.Errorf("newerVersion(%q, %q) = %v, want %v", tt.remote, tt.current, got, tt.want)
		}
	}
}

func TestDownloadUpdateToVerifiesDigest(t *testing.T) {
	payload := []byte("replacement executable bytes")
	sum := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	dir := t.TempDir()
	part := filepath.Join(dir, "update.part")
	staged := filepath.Join(dir, "update.exe")
	got, err := downloadUpdateTo(context.Background(), server.Client(), server.URL, "sha256:"+hex.EncodeToString(sum[:]), int64(len(payload)), part, staged)
	if err != nil {
		t.Fatal(err)
	}
	if got != staged {
		t.Fatalf("staged path = %q, want %q", got, staged)
	}
	content, err := os.ReadFile(staged)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != string(payload) {
		t.Fatalf("downloaded content = %q", content)
	}

	badStaged := filepath.Join(dir, "bad.exe")
	if _, err := downloadUpdateTo(context.Background(), server.Client(), server.URL, "sha256:deadbeef", int64(len(payload)), part, badStaged); err == nil {
		t.Fatal("digest mismatch unexpectedly succeeded")
	}
	if _, err := os.Stat(badStaged); !os.IsNotExist(err) {
		t.Fatalf("bad staged file was left behind: %v", err)
	}
}
