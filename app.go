package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows"
)

// App struct holds the Wails runtime context that fs/dialog calls need.
type App struct {
	ctx context.Context
	// initialFile is the .md path (if any) this process was launched with
	// (double-click / "打开方式" file association). GetInitialFile hands it
	// to the frontend once, on first load.
	initialFile string
	// syncCancel stops the background cloud-sync loop (sync.go's
	// runSyncLoop) — cancelled from onBeforeClose so it isn't left running
	// mid-cycle past the point the rest of the app has torn down.
	syncCancel       context.CancelFunc
	updateMu         sync.Mutex
	updateStatus     UpdateStatus
	updateStagedPath string
	updateCleanup    *updateCleanup
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	syncCtx, cancel := context.WithCancel(ctx)
	a.syncCancel = cancel
	go a.runSyncLoop(syncCtx)
	go a.checkForUpdatesDaily(ctx)
	go cleanupUpdateFiles(a.updateCleanup)
}

// GetInitialFile returns (and clears) the file this process launched with,
// so the frontend can open it as a tab on first load instead of the usual
// blank untitled tab.
func (a *App) GetInitialFile() string {
	f := a.initialFile
	a.initialFile = ""
	return f
}

// notifyOpenFile is called (from singleinstance.go, on a background
// goroutine) when a later launch of MDNote pokes this already-running
// instance — either forwarding a file to open as a new tab, or (path=="")
// just a plain relaunch that should bring the window forward.
func (a *App) notifyOpenFile(path string) {
	if a.ctx == nil {
		// Arrived before OnStartup finished wiring the context; GetInitialFile
		// will still pick it up once the frontend calls it.
		if path != "" {
			a.initialFile = path
		}
		return
	}
	// Whatever WindowShow/WindowUnminimise end up doing internally to bring
	// the window forward, it must never leave a maximized window looking
	// un-maximized — re-assert it explicitly rather than trust that those
	// calls are no-ops for an already-visible, already-maximized window.
	wasMaximised := runtime.WindowIsMaximised(a.ctx)
	runtime.WindowShow(a.ctx)
	runtime.WindowUnminimise(a.ctx)
	if wasMaximised && !runtime.WindowIsMaximised(a.ctx) {
		runtime.WindowMaximise(a.ctx)
	}
	if path != "" {
		runtime.EventsEmit(a.ctx, "open-file", path)
	}
}

// GetSettings returns the persisted portable settings (root dir etc.).
func (a *App) GetSettings() (Settings, error) {
	s, err := loadSettings()
	if err != nil {
		return Settings{}, err
	}
	if s.RootDir != "" {
		if err := migrateLegacyPicToImages(s); err != nil {
			return Settings{}, err
		}
	}
	return s, nil
}

// GetUpdateStatus lets the frontend recover a ready notification even if
// the background download finished before its Wails event listener mounted.
func (a *App) GetUpdateStatus() UpdateStatus {
	return a.getUpdateStatus()
}

// ApplyUpdate starts the already-downloaded executable in updater mode and
// quits this process. The helper replaces us only after our PID has exited.
func (a *App) ApplyUpdate() error {
	return a.applyUpdate()
}

// SaveAppSettings persists the settings page's toggles (language, outline
// auto-numbering, grammar check) without disturbing the rest of Settings
// (root dir, open tabs, ...), which is why it loads-then-overwrites just
// these fields rather than taking a whole Settings struct from the frontend.
func (a *App) SaveAppSettings(language string, outlineAutoNumber bool, grammarCheckEnabled bool) (Settings, error) {
	s, err := loadSettings()
	if err != nil {
		return Settings{}, err
	}
	s.Language = language
	s.OutlineAutoNumber = outlineAutoNumber
	s.GrammarCheckEnabled = grammarCheckEnabled
	if err := saveSettings(s); err != nil {
		return Settings{}, err
	}
	return s, nil
}

// AddDictionaryWord persists one more word to the grammar checker's custom
// dictionary (see Settings.CustomDictionary) — a no-op if it's already
// there, since the frontend re-sends the whole current word on every
// "add to dictionary" click regardless of prior state.
func (a *App) AddDictionaryWord(word string) (Settings, error) {
	s, err := loadSettings()
	if err != nil {
		return Settings{}, err
	}
	for _, w := range s.CustomDictionary {
		if w == word {
			return s, nil
		}
	}
	s.CustomDictionary = append(s.CustomDictionary, word)
	if err := saveSettings(s); err != nil {
		return Settings{}, err
	}
	return s, nil
}

// SaveOpenTabs records which files are currently open (and which is
// focused) so the next launch can restore them — called by the frontend on
// every tab open/close, not just at shutdown, so a crash doesn't lose the
// last-known state.
func (a *App) SaveOpenTabs(paths []string, activePath string) error {
	s, err := loadSettings()
	if err != nil {
		return err
	}
	s.OpenTabPaths = paths
	s.ActiveTabPath = activePath
	return saveSettings(s)
}

// SelectRootDir opens a native folder picker, persists the choice, and
// returns the resulting settings. The picked directory itself is only ever
// shown/remembered — actual notes live in a "MDNote" subfolder created (if
// missing) inside it, so this never lists/touches whatever else the user's
// chosen folder might already contain (see effectiveRoot in fsops.go).
func (a *App) SelectRootDir() (Settings, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: localized("选择笔记根目录", "Select notes root folder"),
	})
	if err != nil || dir == "" {
		return loadSettings()
	}
	s, err := loadSettings()
	if err != nil {
		return Settings{}, err
	}
	s.RootDir = dir
	if err := os.MkdirAll(effectiveRoot(s), 0o755); err != nil {
		return Settings{}, err
	}
	if err := saveSettings(s); err != nil {
		return Settings{}, err
	}
	if err := migrateLegacyPicToImages(s); err != nil {
		return Settings{}, err
	}
	return s, nil
}

// MigrateRootDir opens a native folder picker for a new parent location,
// then moves the entire MDNote subfolder (and everything in it) there —
// unlike SelectRootDir, which just points at a (possibly already-existing,
// possibly empty) MDNote folder without touching the previous one, this
// physically relocates the current note collection.
func (a *App) MigrateRootDir() (Settings, error) {
	newParent, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: localized("选择迁移到的位置", "Select migration destination"),
	})
	if err != nil || newParent == "" {
		return loadSettings()
	}
	s, err := loadSettings()
	if err != nil {
		return Settings{}, err
	}
	if s.RootDir == "" {
		return Settings{}, fmt.Errorf(localized("尚未设置根目录", "root folder is not set"))
	}
	oldParentAbs, err := filepath.Abs(s.RootDir)
	if err != nil {
		return Settings{}, err
	}
	newParentAbs, err := filepath.Abs(newParent)
	if err != nil {
		return Settings{}, err
	}
	if oldParentAbs == newParentAbs {
		return s, nil
	}
	oldRoot := effectiveRoot(s)
	newRoot := filepath.Join(newParentAbs, mdnoteSubdir)
	if rel, err := filepath.Rel(oldRoot, newParentAbs); err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return Settings{}, fmt.Errorf(localized("不能迁移到自身内部", "cannot migrate into itself"))
	}
	if _, err := os.Stat(newRoot); err == nil {
		return Settings{}, fmt.Errorf(localized("目标位置已存在 MDNote 文件夹", "the destination already contains an MDNote folder"))
	}
	if _, err := os.Stat(oldRoot); err == nil {
		if err := moveDirAcrossVolumes(oldRoot, newRoot); err != nil {
			return Settings{}, err
		}
	} else {
		if err := os.MkdirAll(newRoot, 0o755); err != nil {
			return Settings{}, err
		}
	}
	s.RootDir = newParentAbs
	if err := saveSettings(s); err != nil {
		return Settings{}, err
	}
	if err := migrateLegacyPicToImages(s); err != nil {
		return Settings{}, err
	}
	return s, nil
}

// onBeforeClose persists the window's maximized state right before the app
// closes, so the next launch can restore it (see main.go's WindowStartState
// wiring) instead of always reopening at the default size. Never prevents
// the close.
func (a *App) onBeforeClose(ctx context.Context) bool {
	if a.syncCancel != nil {
		a.syncCancel()
	}
	s, err := loadSettings()
	if err == nil {
		s.WindowMaximized = runtime.WindowIsMaximised(ctx)
		saveSettings(s)
	}
	return false
}

// OpenFileDialog lets the user pick an arbitrary markdown file (not limited
// to the root tree), for the toolbar "打开" action. defaultDir, if it names
// an existing directory, opens the dialog there (typically the left
// sidebar's currently selected directory, or the root when nothing is
// selected); otherwise it falls back to the OS default.
func (a *App) OpenFileDialog(defaultDir string) (string, error) {
	opts := runtime.OpenDialogOptions{
		Title: localized("打开 Markdown 文件", "Open Markdown file"),
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown (*.md)", Pattern: "*.md"},
		},
	}
	if info, err := os.Stat(defaultDir); err == nil && info.IsDir() {
		opts.DefaultDirectory = defaultDir
	}
	return runtime.OpenFileDialog(a.ctx, opts)
}

// SaveFileDialog is used for the "另存" flow of untitled tabs. defaultDir, if
// it names an existing directory, opens the dialog there (typically the
// left sidebar's currently selected directory); otherwise it falls back to
// the OS default.
func (a *App) SaveFileDialog(defaultName string, defaultDir string) (string, error) {
	if defaultName == "" {
		defaultName = localized("未命名", "Untitled")
	}
	opts := runtime.SaveDialogOptions{
		Title:           localized("另存为", "Save As"),
		DefaultFilename: defaultName,
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown (*.md)", Pattern: "*.md"},
		},
	}
	if info, err := os.Stat(defaultDir); err == nil && info.IsDir() {
		opts.DefaultDirectory = defaultDir
	}
	return runtime.SaveFileDialog(a.ctx, opts)
}

// OpenAnyFileDialog lets the user pick an arbitrary file of any type, for
// inserting a "file link" block that isn't restricted to markdown.
func (a *App) OpenAnyFileDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: localized("选择文件", "Select file"),
	})
}

// Basename exposes filepath.Base to the frontend for tab-title rendering.
func (a *App) Basename(path string) string {
	return filepath.Base(path)
}

// FileExists reports whether path currently exists on disk, used to detect
// tabs whose backing file was deleted/moved outside the app.
func (a *App) FileExists(path string) bool {
	if path == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

// OpenWithDefaultApp launches path with whatever program Windows has
// associated with its file type, for "file link" blocks pointing at
// non-markdown files (e.g. .xlsx opens in Excel). Uses ShellExecuteW
// directly rather than `cmd /c start`: the latter briefly flashes a visible
// console window (cmd.exe is a console-subsystem process) before the real
// target app appears, and also re-parses the whole command line for shell
// metacharacters (&, |, ^, ...) that can appear in ordinary file paths —
// same class of problem OpenURL below already avoids for web links.
// ShellExecuteW talks to the shell directly, no intermediate process at all.
func (a *App) OpenWithDefaultApp(path string) error {
	verb, err := syscall.UTF16PtrFromString("open")
	if err != nil {
		return err
	}
	file, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	return windows.ShellExecute(0, verb, file, nil, nil, windows.SW_SHOWNORMAL)
}

// OpenURL opens a web URL in the user's system default browser (typed/
// pasted hyperlinks in the editor). Deliberately not routed through
// OpenWithDefaultApp's `cmd /c start` — cmd.exe re-parses its entire
// command line for shell metacharacters (&, |, ^, ...), which are common in
// URL query strings and can silently mis-launch or error out ("找不到文件");
// runtime.BrowserOpenURL uses a proper OS-level browser launch instead.
func (a *App) OpenURL(url string) {
	runtime.BrowserOpenURL(a.ctx, url)
}

// RevealInExplorer opens Windows Explorer with path pre-selected — the tab
// bar's "在文件管理器中打开" context menu item. explorer.exe has its own
// nonstandard command-line parser for "/select,<path>": it needs the path
// portion quoted (/select,"<path>") whenever the path contains a space, but
// Go's os/exec always re-escapes each argument itself when building the
// process's actual command line — for an argument that already has an
// embedded '"' plus spaces, that adds a second, different layer of
// quoting/escaping than explorer's parser expects, so a path with a space
// anywhere in it (a folder name, say) silently makes explorer fall back to
// opening Documents instead of selecting the file, even though the same
// "/select,\"<path>\"" text typed directly works fine. Confirmed by
// reproducing both the failure and the fix directly against a real path.
// Bypassing Go's own escaping via SysProcAttr.CmdLine and building the raw
// command line ourselves is what actually gets explorer to select the
// right file. Windows paths can never contain a literal '"', so path
// itself needs no escaping here. explorer.exe also always exits nonzero
// even on success, so the exit status is never checked — only whether it
// could be started at all.
func (a *App) RevealInExplorer(path string) error {
	cmd := exec.Command("explorer.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CmdLine: `explorer.exe /select,"` + path + `"`,
	}
	return cmd.Start()
}
