package main

import (
	"embed"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

// initialFileFromArgs reads the path Windows passes when this exe is the
// registered handler for .md and the user double-clicks (or "打开方式") a
// file: argv[1] is that file's path.
func initialFileFromArgs(args []string) string {
	if len(args) < 2 {
		return ""
	}
	arg := args[1]
	if !strings.EqualFold(filepath.Ext(arg), ".md") {
		return ""
	}
	if abs, err := filepath.Abs(arg); err == nil {
		return abs
	}
	return arg
}

func main() {
	initialFile := initialFileFromArgs(os.Args)

	// If MDNote is already running, forward the file to it and exit instead
	// of opening a second, blank window.
	ln, isPrimary := acquireSingleInstance(initialFile)
	if !isPrimary {
		return
	}
	defer ln.Close()

	app := NewApp()
	app.initialFile = initialFile

	go serveSingleInstance(ln, app.notifyOpenFile)

	// Reopen maximized if that's how the window was left last time (see
	// app.go's onBeforeClose, which is what keeps this setting current)
	// instead of always starting at the fixed 1280x800 default.
	startState := options.Normal
	if settings, err := loadSettings(); err == nil && settings.WindowMaximized {
		startState = options.Maximised
	}

	err := wails.Run(&options.App{
		Title:  "MDNote",
		Width:  1280,
		Height: 800,
		MinWidth: 900,
		MinHeight: 600,
		WindowStartState: startState,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 1},
		OnStartup:        app.startup,
		OnBeforeClose:    app.onBeforeClose,
		// Wails calls PutAreDefaultContextMenusEnabled(false) on WebView2 for
		// any non-debug production build, which — per WebView2's own
		// behavior, not just its native right-click menu — also stops the
		// page's own DOM "contextmenu" event from firing at all. That
		// silently broke the table's right-click header menu (Editor.svelte,
		// onRowGripContextMenu) in the packaged .exe even though it worked
		// fine under `wails dev`/a plain browser. Newer Wails only shows its
		// *native* menu for text-selection contexts by default, so this
		// doesn't bring back a stray browser-style right-click menu
		// elsewhere in the app.
		EnableDefaultContextMenu: true,
		Bind: []interface{}{
			app,
		},
		// Without this, WebView2's default behavior for a dropped file wins:
		// it navigates the webview to a raw file:// view of the file instead
		// of letting the frontend handle it. EnableFileDrop routes dropped
		// paths to the frontend (see api.ts's onFileDrop) instead.
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			DisableWindowIcon:    false,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
