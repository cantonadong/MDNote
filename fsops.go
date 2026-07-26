package main

import (
	"bytes"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// FileEntry describes one child of a directory listing for the left-hand file tree.
type FileEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"isDir"`
}

// mdnoteSubdir is the fixed folder name created inside whatever directory
// the user picks as "root" — Settings.RootDir stores that picked directory
// (shown as-is in the sidebar), but every actual file operation happens
// inside <RootDir>\MDNote, never RootDir itself. This keeps the app from
// ever listing/touching arbitrary sibling files the user's chosen folder
// might already contain for unrelated reasons.
const mdnoteSubdir = "MDNote"

// effectiveRoot is the real, on-disk directory the note tree/file ops
// operate on — see mdnoteSubdir.
func effectiveRoot(s Settings) string {
	return filepath.Join(s.RootDir, mdnoteSubdir)
}

// withinRoot guards file-tree mutations (create/rename/delete/move) so they can
// never escape the user-selected root directory, even via a crafted "..".
func withinRoot(root, target string) error {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(rootAbs, targetAbs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return fmt.Errorf("path %q is outside root directory", target)
	}
	return nil
}

// ListDir lists the immediate children of dirPath (non-recursive, for lazy
// tree expansion): every subdirectory is shown regardless of what it
// contains (so the tree mirrors the real folder layout on disk, including
// folders not created by or not yet containing anything relevant to this
// app), while files are filtered down to `.md` only. Directories sort
// before files, both alphabetically.
func (a *App) ListDir(dirPath string) ([]FileEntry, error) {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, err
	}
	result := make([]FileEntry, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		full := filepath.Join(dirPath, name)
		if e.IsDir() {
			result = append(result, FileEntry{Name: name, Path: full, IsDir: true})
		} else if strings.EqualFold(filepath.Ext(name), ".md") {
			result = append(result, FileEntry{Name: name, Path: full, IsDir: false})
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].IsDir != result[j].IsDir {
			return result[i].IsDir
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})
	return result, nil
}

// ReadFile reads any file the user picked, whether inside the root tree or
// via the "打开" toolbar dialog (which allows arbitrary .md files).
func (a *App) ReadFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	// Strip a leading UTF-8 BOM (common in files saved by Notepad's "UTF-8"
	// option and some other Windows editors): left in place, it silently
	// breaks the markdown parser's "#" heading match on the file's very
	// first line, since the BOM — not "#" — is then the true first
	// character.
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	return string(data), nil
}

// WriteFile writes back to whatever path the tab is bound to.
func (a *App) WriteFile(path string, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
}

// CreateEntry creates a new file or directory under parentDir, validated to
// stay inside the current root.
func (a *App) CreateEntry(parentDir string, name string, isDir bool) (FileEntry, error) {
	settings, err := loadSettings()
	if err != nil {
		return FileEntry{}, err
	}
	target := filepath.Join(parentDir, name)
	if err := withinRoot(effectiveRoot(settings), target); err != nil {
		return FileEntry{}, err
	}
	if _, err := os.Stat(target); err == nil {
		return FileEntry{}, fmt.Errorf("%q already exists", name)
	}
	if isDir {
		if err := os.Mkdir(target, 0o755); err != nil {
			return FileEntry{}, err
		}
	} else {
		f, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err != nil {
			return FileEntry{}, err
		}
		f.Close()
	}
	return FileEntry{Name: name, Path: target, IsDir: isDir}, nil
}

// RenameEntry renames a file/dir in place (same parent dir, new name).
func (a *App) RenameEntry(path string, newName string) (string, error) {
	settings, err := loadSettings()
	if err != nil {
		return "", err
	}
	newPath := filepath.Join(filepath.Dir(path), newName)
	root := effectiveRoot(settings)
	if err := withinRoot(root, path); err != nil {
		return "", err
	}
	if err := withinRoot(root, newPath); err != nil {
		return "", err
	}
	if err := os.Rename(path, newPath); err != nil {
		return "", err
	}
	updateLinkRegistryPath(settings, path, newPath)
	return newPath, nil
}

// DeleteEntry removes a file or directory (recursively for directories).
func (a *App) DeleteEntry(path string) error {
	settings, err := loadSettings()
	if err != nil {
		return err
	}
	if err := withinRoot(effectiveRoot(settings), path); err != nil {
		return err
	}
	return os.RemoveAll(path)
}

// MoveEntry moves srcPath to be a child of destDir (drag & drop in the tree).
func (a *App) MoveEntry(srcPath string, destDir string) (string, error) {
	settings, err := loadSettings()
	if err != nil {
		return "", err
	}
	root := effectiveRoot(settings)
	if err := withinRoot(root, srcPath); err != nil {
		return "", err
	}
	if err := withinRoot(root, destDir); err != nil {
		return "", err
	}
	newPath := filepath.Join(destDir, filepath.Base(srcPath))
	srcAbs, _ := filepath.Abs(srcPath)
	destAbs, _ := filepath.Abs(destDir)
	if destAbs == filepath.Dir(srcAbs) {
		return "", fmt.Errorf("already in target directory")
	}
	if strings.HasPrefix(destAbs+string(os.PathSeparator), srcAbs+string(os.PathSeparator)) || destAbs == srcAbs {
		return "", fmt.Errorf("cannot move a directory into itself")
	}
	if _, err := os.Stat(newPath); err == nil {
		return "", fmt.Errorf("%q already exists in target directory", filepath.Base(srcPath))
	}
	if err := os.Rename(srcPath, newPath); err != nil {
		return "", err
	}
	updateLinkRegistryPath(settings, srcPath, newPath)
	return newPath, nil
}

// moveDirAcrossVolumes relocates src to dst, working even when they're on
// different drives — os.Rename (used everywhere else in this file, where
// src/dst always share the same root) fails outright in that case on
// Windows, but that's exactly the common case for MigrateRootDir in app.go:
// moving the whole note collection to a different disk is a large part of
// why someone would migrate at all.
func moveDirAcrossVolumes(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	if err := copyDirRecursive(src, dst); err != nil {
		os.RemoveAll(dst)
		return err
	}
	return os.RemoveAll(src)
}

func copyDirRecursive(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return copyFile(path, target)
	})
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
