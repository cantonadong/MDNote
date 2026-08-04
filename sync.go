package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/studio-b12/gowebdav"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Cloud sync mirrors the local notes root (fsops.go's effectiveRoot) against
// a fixed "/MDNote" folder on an InfiniCloud WebDAV account. It's a classic
// three-way sync (compare local vs. remote vs. "what we saw last time"),
// with "newer file wins" for genuine conflicts and deletions mirrored in
// both directions — see performSync below for the full decision table.

const remoteSyncRoot = "/MDNote"

// ManifestEntry records the file mtime (RFC3339 UTC) both sides were known
// to match as of the last successful sync of that path. Local mtimes are
// forced to match the remote's reported Last-Modified via os.Chtimes right
// after every upload/download (see uploadFile/downloadFile), so a single
// timestamp per path is enough to represent "both sides agree" — no need to
// track local and remote mtimes separately.
type ManifestEntry struct {
	SyncedModTime string `json:"syncedModTime"`
}

type syncManifest map[string]ManifestEntry

// manifestPath lives next to config.ini (portable, no registry/AppData) but
// is never itself synced — it's outside effectiveRoot entirely.
func manifestPath() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(exePath), "syncstate.json"), nil
}

func loadManifest() (syncManifest, error) {
	p, err := manifestPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return syncManifest{}, nil
		}
		return nil, err
	}
	var m syncManifest
	if err := json.Unmarshal(data, &m); err != nil || m == nil {
		return syncManifest{}, nil // corrupt/empty manifest: start fresh rather than fail the sync
	}
	return m, nil
}

func saveManifest(m syncManifest) error {
	p, err := manifestPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o644)
}

// walkLocal returns every regular file under root, keyed by its slash-
// separated path relative to root.
func walkLocal(root string) (map[string]time.Time, error) {
	out := map[string]time.Time{}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		out[filepath.ToSlash(rel)] = info.ModTime().UTC()
		return nil
	})
	if os.IsNotExist(err) {
		return out, nil
	}
	return out, err
}

// walkRemote recursively lists every file under a WebDAV path, keyed by its
// path relative to that root.
func walkRemote(client *gowebdav.Client, root string) (map[string]time.Time, error) {
	out := map[string]time.Time{}
	var walk func(p string) error
	walk = func(p string) error {
		entries, err := client.ReadDir(p)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			full := p + "/" + entry.Name()
			if entry.IsDir() {
				if err := walk(full); err != nil {
					return err
				}
				continue
			}
			rel := strings.TrimPrefix(full, root+"/")
			out[rel] = entry.ModTime().UTC()
		}
		return nil
	}
	if err := walk(root); err != nil {
		return nil, err
	}
	return out, nil
}

func uploadFile(client *gowebdav.Client, localPath, remotePath string, manifest syncManifest, relPath string) error {
	data, err := os.ReadFile(localPath)
	if err != nil {
		return err
	}
	if dir := path.Dir(remotePath); dir != "." && dir != "/" {
		if err := client.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	if err := client.Write(remotePath, data, 0o644); err != nil {
		return err
	}
	// Re-Stat rather than trusting our own clock: the server (not the
	// client) is the source of truth for what mtime this upload landed at.
	info, err := client.Stat(remotePath)
	if err != nil {
		return err
	}
	mt := info.ModTime().UTC()
	if err := os.Chtimes(localPath, mt, mt); err != nil {
		return err
	}
	manifest[relPath] = ManifestEntry{SyncedModTime: mt.Format(time.RFC3339)}
	return nil
}

func downloadFile(client *gowebdav.Client, localPath, remotePath string, remoteMod time.Time, manifest syncManifest, relPath string) error {
	data, err := client.Read(remotePath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(localPath, data, 0o644); err != nil {
		return err
	}
	if err := os.Chtimes(localPath, remoteMod, remoteMod); err != nil {
		return err
	}
	manifest[relPath] = ManifestEntry{SyncedModTime: remoteMod.Format(time.RFC3339)}
	return nil
}

type SyncResult struct {
	Success     bool     `json:"success"`
	Message     string   `json:"message"`
	FilesSynced int      `json:"filesSynced"`
	Errors      []string `json:"errors"`
}

// performSync runs one full three-way comparison and reconciliation pass.
// For each relative path seen on either side (or recorded in the manifest
// from a previous run), exactly one of these applies:
//
//   - Present both sides, manifest agrees with both → already in sync.
//   - Present both sides, only one side changed → push that side's version
//     to the other.
//   - Present both sides, both changed (or neither side was ever in the
//     manifest, i.e. two independent copies met for the first time) →
//     newer file wins.
//   - Present on one side only, and the manifest remembers it existed
//     before → it was deleted on the other side; mirror the deletion.
//   - Present on one side only, never in the manifest → brand new file;
//     push it to the side missing it.
//   - Present on neither side, but still in the manifest → stale entry,
//     drop it.
func performSync(s Settings) SyncResult {
	root := effectiveRoot(s)
	if err := os.MkdirAll(root, 0o755); err != nil {
		return SyncResult{Success: false, Message: err.Error()}
	}

	client := gowebdav.NewClient(s.SyncURL, s.SyncUsername, s.SyncPassword)
	client.SetTimeout(30 * time.Second)
	if err := client.MkdirAll(remoteSyncRoot, 0o755); err != nil {
		return SyncResult{Success: false, Message: fmt.Sprintf(localized("无法访问云端目录：%v", "Cannot access cloud folder: %v"), err)}
	}

	manifest, err := loadManifest()
	if err != nil {
		manifest = syncManifest{}
	}

	localFiles, err := walkLocal(root)
	if err != nil {
		return SyncResult{Success: false, Message: fmt.Sprintf(localized("读取本地文件列表失败：%v", "Failed to read local file list: %v"), err)}
	}
	remoteFiles, err := walkRemote(client, remoteSyncRoot)
	if err != nil {
		return SyncResult{Success: false, Message: fmt.Sprintf(localized("读取云端文件列表失败：%v", "Failed to read cloud file list: %v"), err)}
	}

	paths := map[string]bool{}
	for p := range localFiles {
		paths[p] = true
	}
	for p := range remoteFiles {
		paths[p] = true
	}
	for p := range manifest {
		paths[p] = true
	}

	var errs []string
	synced := 0

	for relPath := range paths {
		localMod, hasLocal := localFiles[relPath]
		remoteMod, hasRemote := remoteFiles[relPath]
		manifestEntry, hasManifest := manifest[relPath]
		var manifestMod time.Time
		if hasManifest {
			manifestMod, _ = time.Parse(time.RFC3339, manifestEntry.SyncedModTime)
		}

		localPath := filepath.Join(root, filepath.FromSlash(relPath))
		remotePath := remoteSyncRoot + "/" + relPath

		switch {
		case hasLocal && hasRemote:
			// No rounding tolerance needed here: downloadFile/uploadFile
			// always os.Chtimes the local file to exactly the mtime
			// recorded in the manifest, so "unchanged since last sync"
			// compares as true equality, not a near-miss.
			localChanged := !hasManifest || localMod.After(manifestMod)
			remoteChanged := !hasManifest || remoteMod.After(manifestMod)
			var opErr error
			switch {
			case !localChanged && !remoteChanged:
				// already in sync, nothing to do
			case localChanged && !remoteChanged:
				opErr = uploadFile(client, localPath, remotePath, manifest, relPath)
			case !localChanged && remoteChanged:
				opErr = downloadFile(client, localPath, remotePath, remoteMod, manifest, relPath)
			default: // both changed since last sync — newer file wins
				if localMod.After(remoteMod) {
					opErr = uploadFile(client, localPath, remotePath, manifest, relPath)
				} else {
					opErr = downloadFile(client, localPath, remotePath, remoteMod, manifest, relPath)
				}
			}
			if opErr != nil {
				errs = append(errs, fmt.Sprintf("%s：%v", relPath, opErr))
			} else if localChanged || remoteChanged {
				synced++
			}

		case hasLocal && !hasRemote:
			if hasManifest {
				if err := os.Remove(localPath); err != nil && !os.IsNotExist(err) {
					errs = append(errs, fmt.Sprintf(localized("删除本地 %s 失败：%v", "Failed to delete local %s: %v"), relPath, err))
				} else {
					delete(manifest, relPath)
					synced++
				}
			} else if err := uploadFile(client, localPath, remotePath, manifest, relPath); err != nil {
				errs = append(errs, fmt.Sprintf(localized("上传 %s 失败：%v", "Failed to upload %s: %v"), relPath, err))
			} else {
				synced++
			}

		case !hasLocal && hasRemote:
			if hasManifest {
				if err := client.Remove(remotePath); err != nil {
					errs = append(errs, fmt.Sprintf(localized("删除云端 %s 失败：%v", "Failed to delete cloud %s: %v"), relPath, err))
				} else {
					delete(manifest, relPath)
					synced++
				}
			} else if err := downloadFile(client, localPath, remotePath, remoteMod, manifest, relPath); err != nil {
				errs = append(errs, fmt.Sprintf(localized("下载 %s 失败：%v", "Failed to download %s: %v"), relPath, err))
			} else {
				synced++
			}

		default: // gone from both sides — stale manifest entry
			delete(manifest, relPath)
		}
	}

	if err := saveManifest(manifest); err != nil {
		errs = append(errs, fmt.Sprintf(localized("保存同步记录失败：%v", "Failed to save sync record: %v"), err))
	}

	if len(errs) > 0 {
		return SyncResult{Success: false, Message: strings.Join(errs, "; "), FilesSynced: synced, Errors: errs}
	}
	return SyncResult{Success: true, Message: localized("同步完成", "Sync complete"), FilesSynced: synced}
}

func syncConfigured(s Settings) bool {
	return s.SyncURL != "" && s.SyncUsername != "" && s.SyncPassword != ""
}

// syncMu guards against the background ticker (runSyncLoop) and a manual
// "sync now" click racing each other into overlapping runs.
var syncMu sync.Mutex

type SyncStatus struct {
	Enabled      bool   `json:"enabled"`
	Configured   bool   `json:"configured"`
	Syncing      bool   `json:"syncing"`
	LastSyncTime string `json:"lastSyncTime"`
	LastError    string `json:"lastError"`
	FilesSynced  int    `json:"filesSynced"`
}

func (a *App) emitSyncStatus(st SyncStatus) {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "sync-status", st)
	}
}

// GetSyncStatus reports the last known sync outcome, for the status bar to
// read once at startup — live updates after that arrive via the
// "sync-status" event emitted from runSync below, not polling.
func (a *App) GetSyncStatus() (SyncStatus, error) {
	s, err := loadSettings()
	if err != nil {
		return SyncStatus{}, err
	}
	return SyncStatus{
		Enabled:      s.SyncEnabled,
		Configured:   syncConfigured(s),
		LastSyncTime: s.LastSyncTime,
		LastError:    s.LastSyncError,
	}, nil
}

// SaveSyncSettings persists the cloud-sync connection fields, following the
// same load-then-patch-just-these-fields convention as SaveAppSettings.
func (a *App) SaveSyncSettings(enabled bool, url, username, password string, intervalMinutes int) (Settings, error) {
	s, err := loadSettings()
	if err != nil {
		return Settings{}, err
	}
	if intervalMinutes < 1 {
		intervalMinutes = 30
	}
	s.SyncEnabled = enabled
	s.SyncURL = strings.TrimRight(strings.TrimSpace(url), "/")
	s.SyncUsername = username
	s.SyncPassword = password
	s.SyncIntervalMinutes = intervalMinutes
	if err := saveSettings(s); err != nil {
		return Settings{}, err
	}
	return s, nil
}

// TestSyncConnection validates WebDAV credentials without persisting them —
// "" means success, anything else is a user-facing error message — so the
// settings panel can confirm they work before Save is pressed.
func (a *App) TestSyncConnection(url, username, password string) string {
	url = strings.TrimRight(strings.TrimSpace(url), "/")
	if url == "" || username == "" || password == "" {
		return localized("请填写地址、用户名和密码", "Enter the URL, username, and password")
	}
	client := gowebdav.NewClient(url, username, password)
	client.SetTimeout(15 * time.Second)
	if err := client.Connect(); err != nil {
		return fmt.Sprintf(localized("连接失败：%v", "Connection failed: %v"), err)
	}
	return ""
}

// SyncNow runs one sync cycle immediately (the settings panel's "立即同步"
// button) and returns its outcome directly, in addition to the
// "sync-status" event every sync run emits — so a foreground click gets an
// instant result while the status bar stays live either way.
func (a *App) SyncNow() SyncResult {
	return a.runSync()
}

func (a *App) runSync() SyncResult {
	if !syncMu.TryLock() {
		return SyncResult{Success: false, Message: localized("已有同步任务正在进行", "A sync task is already running")}
	}
	defer syncMu.Unlock()

	s, err := loadSettings()
	if err != nil {
		return SyncResult{Success: false, Message: err.Error()}
	}
	if !syncConfigured(s) {
		return SyncResult{Success: false, Message: localized("尚未配置云同步", "Cloud sync is not configured")}
	}
	if s.RootDir == "" {
		return SyncResult{Success: false, Message: localized("尚未设置笔记根目录", "Notes root folder is not set")}
	}

	a.emitSyncStatus(SyncStatus{Enabled: s.SyncEnabled, Configured: true, Syncing: true, LastSyncTime: s.LastSyncTime})

	result := performSync(s)

	s.LastSyncTime = time.Now().UTC().Format(time.RFC3339)
	s.LastSyncError = result.Message
	if result.Success {
		s.LastSyncError = ""
	}
	saveSettings(s)

	a.emitSyncStatus(SyncStatus{
		Enabled:      s.SyncEnabled,
		Configured:   true,
		Syncing:      false,
		LastSyncTime: s.LastSyncTime,
		LastError:    s.LastSyncError,
		FilesSynced:  result.FilesSynced,
	})
	return result
}

// runSyncLoop checks once a minute whether a sync is due — enabled,
// configured, and at least SyncIntervalMinutes since the last attempt.
// Checking this often (rather than setting a ticker for the configured
// interval once at startup) means a live interval change in Settings and a
// startup catch-up sync (the app was closed longer than the interval) both
// take effect without restarting the app.
func (a *App) runSyncLoop(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	// Give the UI a moment to settle before the first check, rather than
	// racing app startup.
	initial := time.NewTimer(10 * time.Second)
	defer initial.Stop()

	check := func() {
		s, err := loadSettings()
		if err != nil || !s.SyncEnabled || !syncConfigured(s) {
			return
		}
		interval := time.Duration(s.SyncIntervalMinutes) * time.Minute
		if interval <= 0 {
			interval = 30 * time.Minute
		}
		if s.LastSyncTime != "" {
			if last, err := time.Parse(time.RFC3339, s.LastSyncTime); err == nil && time.Since(last) < interval {
				return
			}
		}
		a.runSync()
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-initial.C:
			check()
		case <-ticker.C:
			check()
		}
	}
}
