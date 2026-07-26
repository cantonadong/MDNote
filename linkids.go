package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Page/file link chips (frontend/src/lib/editor/nodes/links.ts) store a
// stable id alongside the target's path, resolved through this registry —
// a plain id->relative-path JSON map living inside the note root, not
// embedded in the linking file's own content. A path-only link breaks the
// moment its target is renamed/moved while the linking file happens to be
// closed (nothing was open to patch); resolving by id instead means the
// link keeps working regardless of what was open when the rename happened
// — the id never changes, only the registry's path for it does.
//
// Paths are stored relative to effectiveRoot so the whole registry stays
// valid if the user migrates the root directory elsewhere (MigrateRootDir
// moves the whole tree as a unit, so a relative path inside it is
// unaffected).
const linkRegistryFile = ".mdnote-links.json"

var linkRegistryMu sync.Mutex

func linkRegistryPath(settings Settings) string {
	return filepath.Join(effectiveRoot(settings), linkRegistryFile)
}

func loadLinkRegistry(settings Settings) (map[string]string, error) {
	data, err := os.ReadFile(linkRegistryPath(settings))
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]string{}, nil
		}
		return nil, err
	}
	var m map[string]string
	if err := json.Unmarshal(data, &m); err != nil {
		// Corrupt registry shouldn't hard-fail every link operation — start
		// fresh rather than error out.
		return map[string]string{}, nil
	}
	return m, nil
}

func saveLinkRegistry(settings Settings, m map[string]string) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(linkRegistryPath(settings), data, 0o644)
}

func newLinkID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// EnsureLinkID returns a stable id for path, reusing the existing one if
// this file has already been linked to before rather than minting a new id
// on every call.
func (a *App) EnsureLinkID(path string) (string, error) {
	linkRegistryMu.Lock()
	defer linkRegistryMu.Unlock()
	settings, err := loadSettings()
	if err != nil {
		return "", err
	}
	root := effectiveRoot(settings)
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return "", err
	}
	reg, err := loadLinkRegistry(settings)
	if err != nil {
		return "", err
	}
	for id, p := range reg {
		if p == rel {
			return id, nil
		}
	}
	id, err := newLinkID()
	if err != nil {
		return "", err
	}
	reg[id] = rel
	if err := saveLinkRegistry(settings, reg); err != nil {
		return "", err
	}
	return id, nil
}

// ResolveLinkID returns the current absolute path for a previously-assigned
// link id.
func (a *App) ResolveLinkID(id string) (string, error) {
	linkRegistryMu.Lock()
	defer linkRegistryMu.Unlock()
	settings, err := loadSettings()
	if err != nil {
		return "", err
	}
	reg, err := loadLinkRegistry(settings)
	if err != nil {
		return "", err
	}
	rel, ok := reg[id]
	if !ok {
		return "", fmt.Errorf("unknown link id %q", id)
	}
	return filepath.Join(effectiveRoot(settings), rel), nil
}

// updateLinkRegistryPath rewrites the registry entry (if any) for oldPath to
// newPath after a successful rename/move — called from RenameEntry/
// MoveEntry. Also cascades a folder rename/move to every descendant entry
// registered under it, the same prefix-match approach the tab-path-rewrite
// loops in appState.svelte.ts already use for the same reason.
func updateLinkRegistryPath(settings Settings, oldPath, newPath string) {
	linkRegistryMu.Lock()
	defer linkRegistryMu.Unlock()
	root := effectiveRoot(settings)
	oldRel, err := filepath.Rel(root, oldPath)
	if err != nil {
		return
	}
	newRel, err := filepath.Rel(root, newPath)
	if err != nil {
		return
	}
	reg, err := loadLinkRegistry(settings)
	if err != nil {
		return
	}
	changed := false
	for id, p := range reg {
		if p == oldRel {
			reg[id] = newRel
			changed = true
		} else if strings.HasPrefix(p, oldRel+string(os.PathSeparator)) {
			reg[id] = newRel + p[len(oldRel):]
			changed = true
		}
	}
	if changed {
		_ = saveLinkRegistry(settings, reg)
	}
}
