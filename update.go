package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows"
)

const (
	appVersion       = "1.7.4"
	latestReleaseURL = "https://api.github.com/repos/cantonadong/MDNote/releases/latest"
	updateAssetName  = "MDNote.exe"
)

type UpdateStatus struct {
	Ready   bool   `json:"ready"`
	Version string `json:"version"`
}

type updateCleanup struct {
	staged string
	old    string
}

type githubRelease struct {
	TagName    string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
	Assets     []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
		Digest             string `json:"digest"`
		Size               int64  `json:"size"`
	} `json:"assets"`
}

func versionParts(version string) ([]int, bool) {
	version = strings.TrimSpace(strings.TrimPrefix(strings.ToLower(version), "v"))
	if version == "" {
		return nil, false
	}
	parts := strings.Split(version, ".")
	result := make([]int, len(parts))
	for i, part := range parts {
		// Release tags may have a harmless suffix such as 1.6.0-beta. The
		// updater ignores prereleases, but accepting the numeric prefix keeps
		// comparison robust if a final release tag includes build metadata.
		n := 0
		seen := false
		for _, r := range part {
			if r < '0' || r > '9' {
				break
			}
			seen = true
			n = n*10 + int(r-'0')
		}
		if !seen {
			return nil, false
		}
		result[i] = n
	}
	return result, true
}

func newerVersion(remote, current string) bool {
	r, rok := versionParts(remote)
	c, cok := versionParts(current)
	if !rok || !cok {
		return false
	}
	length := len(r)
	if len(c) > length {
		length = len(c)
	}
	for i := 0; i < length; i++ {
		rv, cv := 0, 0
		if i < len(r) {
			rv = r[i]
		}
		if i < len(c) {
			cv = c[i]
		}
		if rv != cv {
			return rv > cv
		}
	}
	return false
}

func (a *App) getUpdateStatus() UpdateStatus {
	a.updateMu.Lock()
	defer a.updateMu.Unlock()
	return a.updateStatus
}

func (a *App) setUpdateReady(version string) {
	a.updateMu.Lock()
	a.updateStatus = UpdateStatus{Ready: true, Version: version}
	status := a.updateStatus
	a.updateMu.Unlock()
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "update-status", status)
	}
}

func (a *App) checkForUpdatesDaily(ctx context.Context) {
	today := time.Now().Format("2006-01-02")
	s, err := loadSettings()
	if err != nil || s.LastUpdateCheckDate == today {
		return
	}

	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, latestReleaseURL, nil)
	if err != nil {
		return
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "MDNote/"+appVersion)
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return
	}
	var release githubRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&release); err != nil {
		return
	}

	// The daily check itself completed successfully. Record it even if no
	// update exists or this release has no suitable Windows asset.
	s.LastUpdateCheckDate = today
	_ = saveSettings(s)
	if release.Draft || release.Prerelease || !newerVersion(release.TagName, appVersion) {
		return
	}

	for _, asset := range release.Assets {
		if !strings.EqualFold(asset.Name, updateAssetName) || asset.BrowserDownloadURL == "" {
			continue
		}
		downloadClient := &http.Client{Timeout: 30 * time.Minute}
		staged, err := downloadUpdate(ctx, downloadClient, release.TagName, asset.BrowserDownloadURL, asset.Digest, asset.Size)
		if err == nil {
			a.updateMu.Lock()
			a.updateStatus = UpdateStatus{Ready: true, Version: strings.TrimPrefix(release.TagName, "v")}
			a.updateStagedPath = staged
			status := a.updateStatus
			a.updateMu.Unlock()
			if a.ctx != nil {
				runtime.EventsEmit(a.ctx, "update-status", status)
			}
		}
		return
	}
}

func downloadUpdate(ctx context.Context, client *http.Client, version, url, digest string, expectedSize int64) (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(exe)
	part := filepath.Join(dir, ".MDNote-update-"+strings.TrimPrefix(version, "v")+".part")
	staged := filepath.Join(dir, "MDNote.update.exe")
	return downloadUpdateTo(ctx, client, url, digest, expectedSize, part, staged)
}

func downloadUpdateTo(ctx context.Context, client *http.Client, url, digest string, expectedSize int64, part, staged string) (string, error) {
	_ = os.Remove(part)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "MDNote/"+appVersion)
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download returned HTTP %d", resp.StatusCode)
	}
	f, err := os.OpenFile(part, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o755)
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(f, hash), resp.Body)
	closeErr := f.Close()
	if copyErr != nil || closeErr != nil || (expectedSize > 0 && written != expectedSize) {
		_ = os.Remove(part)
		if copyErr != nil {
			return "", copyErr
		}
		if closeErr != nil {
			return "", closeErr
		}
		return "", fmt.Errorf("download size mismatch: got %d, want %d", written, expectedSize)
	}
	if strings.HasPrefix(strings.ToLower(digest), "sha256:") {
		want := strings.TrimSpace(digest[len("sha256:"):])
		got := hex.EncodeToString(hash.Sum(nil))
		if !strings.EqualFold(got, want) {
			_ = os.Remove(part)
			return "", errors.New("download SHA-256 mismatch")
		}
	}
	_ = os.Remove(staged)
	if err := os.Rename(part, staged); err != nil {
		_ = os.Remove(part)
		return "", err
	}
	return staged, nil
}

func (a *App) applyUpdate() error {
	a.updateMu.Lock()
	staged := a.updateStagedPath
	ready := a.updateStatus.Ready
	a.updateMu.Unlock()
	if !ready || staged == "" {
		return errors.New("update is not ready")
	}
	current, err := os.Executable()
	if err != nil {
		return err
	}
	if _, err := os.Stat(staged); err != nil {
		return err
	}
	cmd := exec.Command(staged, "--apply-update", strconv.Itoa(os.Getpid()), current, staged)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x00000008}
	if err := cmd.Start(); err != nil {
		return err
	}
	runtime.Quit(a.ctx)
	return nil
}

func runUpdateHelper(args []string) bool {
	if len(args) != 5 || args[1] != "--apply-update" {
		return false
	}
	pid, err := strconv.Atoi(args[2])
	if err != nil || pid <= 0 {
		return true
	}
	current, staged := args[3], args[4]
	if handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid)); err == nil {
		_, _ = windows.WaitForSingleObject(handle, windows.INFINITE)
		windows.CloseHandle(handle)
	}
	old := current + ".old"
	_ = os.Remove(old)
	if err := os.Rename(current, old); err != nil {
		return true
	}
	if err := copyExecutable(staged, current); err != nil {
		_ = os.Rename(old, current)
		return true
	}
	cmd := exec.Command(current, "--cleanup-update", staged, old)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x00000008}
	_ = cmd.Start()
	return true
}

func copyExecutable(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(dst)
		return copyErr
	}
	return closeErr
}

func updateCleanupArgs(args []string) *updateCleanup {
	if len(args) == 4 && args[1] == "--cleanup-update" {
		return &updateCleanup{staged: args[2], old: args[3]}
	}
	return nil
}

func cleanupUpdateFiles(paths *updateCleanup) {
	if paths == nil {
		return
	}
	// The staged helper may still be finishing process teardown when the new
	// app starts. Retry briefly; failure is harmless and retried next update.
	for i := 0; i < 20; i++ {
		stagedErr := os.Remove(paths.staged)
		oldErr := os.Remove(paths.old)
		if (stagedErr == nil || os.IsNotExist(stagedErr)) && (oldErr == nil || os.IsNotExist(oldErr)) {
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
}
