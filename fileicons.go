package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode/utf8"
)

const fileIconsName = ".mdnote-icons.json"

var fileIconsMu sync.Mutex

// Relative paths keep icons portable when the note root is migrated.
type FileIcons struct {
	Icons  map[string]string `json:"icons"`
	Recent []string          `json:"recent"`
}

func iconKey(path string) string {
	return strings.ToLower(filepath.ToSlash(filepath.Clean(path)))
}

func loadFileIcons(settings Settings) (FileIcons, error) {
	state := FileIcons{Icons: map[string]string{}, Recent: []string{}}
	data, err := os.ReadFile(filepath.Join(effectiveRoot(settings), fileIconsName))
	if os.IsNotExist(err) {
		return state, nil
	}
	if err != nil {
		return state, err
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return state, err
	}
	if state.Icons == nil {
		state.Icons = map[string]string{}
	}
	if state.Recent == nil {
		state.Recent = []string{}
	}
	return state, nil
}

func saveFileIcons(settings Settings, state FileIcons) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	root := effectiveRoot(settings)
	f, err := os.CreateTemp(root, ".mdnote-icons-*.tmp")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(name, filepath.Join(root, fileIconsName))
}

func (a *App) GetRecentFileEmojis() ([]string, error) {
	fileIconsMu.Lock()
	defer fileIconsMu.Unlock()
	s, err := loadSettings()
	if err != nil {
		return nil, err
	}
	state, err := loadFileIcons(s)
	return state.Recent, err
}

func (a *App) SetFileEmoji(path, emoji string) error {
	fileIconsMu.Lock()
	defer fileIconsMu.Unlock()
	s, err := loadSettings()
	if err != nil {
		return err
	}
	root := effectiveRoot(s)
	if err := withinRoot(root, path); err != nil {
		return err
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.IsDir() || !strings.EqualFold(filepath.Ext(path), ".md") {
		return fmt.Errorf("only Markdown files can have emoji icons")
	}
	if !utf8.ValidString(emoji) || len(emoji) > 128 || strings.ContainsAny(emoji, "\r\n\t") {
		return fmt.Errorf("invalid emoji")
	}
	state, err := loadFileIcons(s)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return err
	}
	key := iconKey(rel)
	if emoji == "" {
		delete(state.Icons, key)
	} else {
		state.Icons[key] = emoji
		recent := []string{emoji}
		seen := map[string]bool{emoji: true}
		for _, value := range state.Recent {
			if value != "" && !seen[value] && len(recent) < 6 {
				recent = append(recent, value)
				seen[value] = true
			}
		}
		state.Recent = recent
	}
	return saveFileIcons(s, state)
}

func attachFileIcons(entries []FileEntry) {
	fileIconsMu.Lock()
	defer fileIconsMu.Unlock()
	s, err := loadSettings()
	if err != nil {
		return
	}
	state, err := loadFileIcons(s)
	if err != nil {
		return
	} // A damaged icon file must not hide the note tree.
	for i := range entries {
		if entries[i].IsDir {
			continue
		}
		rel, err := filepath.Rel(effectiveRoot(s), entries[i].Path)
		if err == nil {
			entries[i].Emoji = state.Icons[iconKey(rel)]
		}
	}
}

// Run the filesystem change and metadata update together. If persisting a
// rename fails, restore the original path so the caller can safely retry.
func renameWithFileIcons(s Settings, oldPath, newPath string) error {
	fileIconsMu.Lock()
	defer fileIconsMu.Unlock()
	state, err := loadFileIcons(s)
	if err != nil {
		return err
	}
	oldRel, err := filepath.Rel(effectiveRoot(s), oldPath)
	if err != nil {
		return err
	}
	newRel, err := filepath.Rel(effectiveRoot(s), newPath)
	if err != nil {
		return err
	}
	oldKey, newKey := iconKey(oldRel), iconKey(newRel)
	updates := map[string]string{}
	for key, emoji := range state.Icons {
		if key == oldKey || strings.HasPrefix(key, oldKey+"/") {
			updates[newKey+strings.TrimPrefix(key, oldKey)] = emoji
			delete(state.Icons, key)
		}
	}
	for key, emoji := range updates {
		state.Icons[key] = emoji
	}
	if err := os.Rename(oldPath, newPath); err != nil {
		return err
	}
	if len(updates) > 0 {
		if err := saveFileIcons(s, state); err != nil {
			if rollbackErr := os.Rename(newPath, oldPath); rollbackErr != nil {
				return fmt.Errorf("save file icons: %v; restore path: %w", err, rollbackErr)
			}
			return err
		}
	}
	return nil
}

func deleteWithFileIcons(s Settings, path string) error {
	fileIconsMu.Lock()
	defer fileIconsMu.Unlock()
	state, err := loadFileIcons(s)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(effectiveRoot(s), path)
	if err != nil {
		return err
	}
	key := iconKey(rel)
	changed := false
	for candidate := range state.Icons {
		if candidate == key || strings.HasPrefix(candidate, key+"/") {
			delete(state.Icons, candidate)
			changed = true
		}
	}
	if err := os.RemoveAll(path); err != nil {
		return err
	}
	if changed {
		return saveFileIcons(s, state)
	}
	return nil
}
