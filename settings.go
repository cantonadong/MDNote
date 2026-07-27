package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Settings is persisted portably next to the exe (<exe目录>\config.ini), in
// plain INI format so it's easy for a user to inspect or hand-edit which
// real filesystem location the left sidebar's root directory points at.
// No registry / AppData usage, so the app stays fully removable ("绿色软件").
// The json tag still matters even though this file is no longer JSON: Wails
// uses it to name the field (rootDir) in the generated TS bindings.
type Settings struct {
	RootDir string `json:"rootDir"`
	// WindowMaximized remembers the main window's maximized state across
	// launches, so opening/forwarding a file into an already-configured
	// install doesn't appear to "reset" a maximized window back to its
	// default size — see main.go's WindowStartState wiring and app.go's
	// onBeforeClose, which is what actually keeps this field up to date.
	WindowMaximized bool `json:"windowMaximized"`
	// OpenTabPaths/ActiveTabPath remember which files were open (and which
	// one was focused) so the next launch can restore them — kept up to
	// date by the frontend calling SaveOpenTabs on every tab open/close,
	// not just at shutdown, so a crash doesn't lose the last-known state.
	// Untitled/never-saved tabs have no path and aren't persisted here —
	// there's nothing on disk to reopen them from.
	OpenTabPaths  []string `json:"openTabPaths"`
	ActiveTabPath string   `json:"activeTabPath"`
	// Language is "zh" / "en" / "system" (follow the OS locale, resolved on
	// the frontend since that's where the OS locale is actually readable via
	// navigator.language — this field just remembers the user's choice).
	// Empty/unset defaults to "system".
	Language string `json:"language"`
	// OutlineAutoNumber toggles sibling sequence numbers (1./2./3.) on
	// same-level headings in the right-hand outline panel. Default off.
	OutlineAutoNumber bool `json:"outlineAutoNumber"`
}

func settingsPath() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(exePath), "config.ini"), nil
}

func loadSettings() (Settings, error) {
	path, err := settingsPath()
	if err != nil {
		return Settings{}, err
	}
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return Settings{}, nil
		}
		return Settings{}, err
	}
	defer f.Close()

	var s Settings
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ";") || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "[") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "RootDir":
			s.RootDir = strings.TrimSpace(value)
		case "Maximized":
			s.WindowMaximized = strings.TrimSpace(value) == "true"
		case "ActiveTab":
			s.ActiveTabPath = strings.TrimSpace(value)
		case "Tab":
			if v := strings.TrimSpace(value); v != "" {
				s.OpenTabPaths = append(s.OpenTabPaths, v)
			}
		case "Language":
			s.Language = strings.TrimSpace(value)
		case "OutlineAutoNumber":
			s.OutlineAutoNumber = strings.TrimSpace(value) == "true"
		}
	}
	if err := scanner.Err(); err != nil {
		return Settings{}, err
	}
	return s, nil
}

func saveSettings(s Settings) error {
	path, err := settingsPath()
	if err != nil {
		return err
	}
	var b strings.Builder
	fmt.Fprintf(&b, "; MDNote 配置文件——RootDir 记录左侧目录树当前展示的笔记根目录在系统中的绝对路径。\n[General]\nRootDir=%s\nMaximized=%t\n", s.RootDir, s.WindowMaximized)
	if s.ActiveTabPath != "" {
		fmt.Fprintf(&b, "ActiveTab=%s\n", s.ActiveTabPath)
	}
	for _, p := range s.OpenTabPaths {
		fmt.Fprintf(&b, "Tab=%s\n", p)
	}
	if s.Language != "" {
		fmt.Fprintf(&b, "Language=%s\n", s.Language)
	}
	fmt.Fprintf(&b, "OutlineAutoNumber=%t\n", s.OutlineAutoNumber)
	return os.WriteFile(path, []byte(b.String()), 0o644)
}
