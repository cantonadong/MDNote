package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/net/webdav"
)

// startTestWebDAV spins up a local, in-process WebDAV server backed by a
// temp directory, standing in for InfiniCloud so performSync's actual
// upload/download/delete/conflict logic can be exercised end-to-end without
// real cloud credentials.
func startTestWebDAV(t *testing.T) (url string, remoteDir string) {
	t.Helper()
	remoteDir = t.TempDir()
	handler := &webdav.Handler{
		FileSystem: webdav.Dir(remoteDir),
		LockSystem: webdav.NewMemLS(),
	}
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return srv.URL, remoteDir
}

func testSettings(t *testing.T, url string) Settings {
	t.Helper()
	root := t.TempDir()
	return Settings{
		RootDir:      root,
		SyncURL:      url,
		SyncUsername: "test",
		SyncPassword: "test",
	}
}

func writeLocal(t *testing.T, s Settings, relPath, content string) {
	t.Helper()
	p := filepath.Join(effectiveRoot(s), relPath)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readLocal(t *testing.T, s Settings, relPath string) (string, bool) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(effectiveRoot(s), relPath))
	if os.IsNotExist(err) {
		return "", false
	}
	if err != nil {
		t.Fatal(err)
	}
	return string(data), true
}

func readRemote(t *testing.T, remoteDir, relPath string) (string, bool) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(remoteDir, "MDNote", relPath))
	if os.IsNotExist(err) {
		return "", false
	}
	if err != nil {
		t.Fatal(err)
	}
	return string(data), true
}

func TestSync_NewLocalFileUploads(t *testing.T) {
	url, remoteDir := startTestWebDAV(t)
	s := testSettings(t, url)
	writeLocal(t, s, "a.md", "hello from local")

	result := performSync(s)
	if !result.Success {
		t.Fatalf("expected success, got: %+v", result)
	}
	content, ok := readRemote(t, remoteDir, "a.md")
	if !ok || content != "hello from local" {
		t.Fatalf("expected a.md uploaded to remote, got ok=%v content=%q", ok, content)
	}
}

func TestSync_NewRemoteFileDownloads(t *testing.T) {
	url, remoteDir := startTestWebDAV(t)
	s := testSettings(t, url)
	if err := os.MkdirAll(filepath.Join(remoteDir, "MDNote"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(remoteDir, "MDNote", "b.md"), []byte("hello from cloud"), 0o644); err != nil {
		t.Fatal(err)
	}

	result := performSync(s)
	if !result.Success {
		t.Fatalf("expected success, got: %+v", result)
	}
	content, ok := readLocal(t, s, "b.md")
	if !ok || content != "hello from cloud" {
		t.Fatalf("expected b.md downloaded locally, got ok=%v content=%q", ok, content)
	}
}

func TestSync_RoundTripThenNoOp(t *testing.T) {
	url, _ := startTestWebDAV(t)
	s := testSettings(t, url)
	writeLocal(t, s, "c.md", "v1")

	first := performSync(s)
	if !first.Success || first.FilesSynced != 1 {
		t.Fatalf("expected first sync to upload 1 file, got: %+v", first)
	}

	// Nothing changed on either side — a second sync should be a no-op.
	second := performSync(s)
	if !second.Success || second.FilesSynced != 0 {
		t.Fatalf("expected second sync to be a no-op, got: %+v", second)
	}
}

func TestSync_NewerLocalEditWinsAndPropagates(t *testing.T) {
	url, remoteDir := startTestWebDAV(t)
	s := testSettings(t, url)
	writeLocal(t, s, "d.md", "v1")
	if r := performSync(s); !r.Success {
		t.Fatalf("initial sync failed: %+v", r)
	}

	time.Sleep(2500 * time.Millisecond) // clear performSync's 2s mtime tolerance
	writeLocal(t, s, "d.md", "v2-local-edit")

	result := performSync(s)
	if !result.Success {
		t.Fatalf("expected success, got: %+v", result)
	}
	content, _ := readRemote(t, remoteDir, "d.md")
	if content != "v2-local-edit" {
		t.Fatalf("expected local edit to overwrite remote, got %q", content)
	}
}

func TestSync_NewerRemoteEditWinsAndPropagates(t *testing.T) {
	url, remoteDir := startTestWebDAV(t)
	s := testSettings(t, url)
	writeLocal(t, s, "g.md", "v1")
	if r := performSync(s); !r.Success {
		t.Fatalf("initial sync failed: %+v", r)
	}

	time.Sleep(2500 * time.Millisecond) // clear performSync's 2s mtime tolerance
	remotePath := filepath.Join(remoteDir, "MDNote", "g.md")
	if err := os.WriteFile(remotePath, []byte("v2-remote-edit"), 0o644); err != nil {
		t.Fatal(err)
	}

	result := performSync(s)
	if !result.Success {
		t.Fatalf("expected success, got: %+v", result)
	}
	content, _ := readLocal(t, s, "g.md")
	if content != "v2-remote-edit" {
		t.Fatalf("expected remote edit to overwrite local, got %q", content)
	}
}

func TestSync_DeletionMirroredRemoteToLocal(t *testing.T) {
	url, remoteDir := startTestWebDAV(t)
	s := testSettings(t, url)
	writeLocal(t, s, "e.md", "will be deleted remotely")
	if r := performSync(s); !r.Success {
		t.Fatalf("initial sync failed: %+v", r)
	}
	if _, ok := readRemote(t, remoteDir, "e.md"); !ok {
		t.Fatal("expected e.md to exist remotely after initial sync")
	}

	if err := os.Remove(filepath.Join(remoteDir, "MDNote", "e.md")); err != nil {
		t.Fatal(err)
	}

	result := performSync(s)
	if !result.Success {
		t.Fatalf("expected success, got: %+v", result)
	}
	if _, ok := readLocal(t, s, "e.md"); ok {
		t.Fatal("expected e.md to be deleted locally after being deleted remotely")
	}
}

func TestSync_DeletionMirroredLocalToRemote(t *testing.T) {
	url, remoteDir := startTestWebDAV(t)
	s := testSettings(t, url)
	writeLocal(t, s, "f.md", "will be deleted locally")
	if r := performSync(s); !r.Success {
		t.Fatalf("initial sync failed: %+v", r)
	}

	if err := os.Remove(filepath.Join(effectiveRoot(s), "f.md")); err != nil {
		t.Fatal(err)
	}

	result := performSync(s)
	if !result.Success {
		t.Fatalf("expected success, got: %+v", result)
	}
	if _, ok := readRemote(t, remoteDir, "f.md"); ok {
		t.Fatal("expected f.md to be deleted remotely after being deleted locally")
	}
}

func TestSync_NestedDirectories(t *testing.T) {
	url, remoteDir := startTestWebDAV(t)
	s := testSettings(t, url)
	writeLocal(t, s, filepath.Join("sub", "nested.md"), "nested content")

	result := performSync(s)
	if !result.Success {
		t.Fatalf("expected success, got: %+v", result)
	}
	content, ok := readRemote(t, remoteDir, filepath.Join("sub", "nested.md"))
	if !ok || content != "nested content" {
		t.Fatalf("expected nested file uploaded, got ok=%v content=%q", ok, content)
	}
}
