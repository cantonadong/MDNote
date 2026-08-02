package main

import (
	"encoding/base64"
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

// SyncPassword is the only secret persisted to config.ini — everything else
// in that file is deliberately plain, hand-editable text (see settings.go),
// which would otherwise leave a real InfiniCloud app password one "notepad
// config.ini" away from leaking. DPAPI (CryptProtectData/CryptUnprotectData)
// ties the ciphertext to the current Windows user account: only that same
// user, on the same machine, can ever decrypt it again, with no key of our
// own to generate, store, or lose. This isn't meant to defend against an
// attacker who already controls the user's own Windows session — same
// threat model as, say, a browser's saved passwords.

// protectSecret encrypts plain via DPAPI and returns it base64-encoded, safe
// to write as a single INI line.
func protectSecret(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	in := []byte(plain)
	inBlob := windows.DataBlob{Size: uint32(len(in)), Data: &in[0]}
	var outBlob windows.DataBlob
	if err := windows.CryptProtectData(&inBlob, nil, nil, 0, nil, 0, &outBlob); err != nil {
		return "", fmt.Errorf("CryptProtectData: %w", err)
	}
	defer windows.LocalFree(windows.Handle(uintptr(unsafe.Pointer(outBlob.Data))))
	out := unsafe.Slice(outBlob.Data, outBlob.Size)
	return base64.StdEncoding.EncodeToString(out), nil
}

// unprotectSecret reverses protectSecret. Returns an error (rather than
// panicking/guessing) on malformed input — loadSettings falls back to
// treating the raw stored value as legacy plaintext when this fails, so a
// config.ini written before this encryption existed keeps working.
func unprotectSecret(encoded string) (string, error) {
	if encoded == "" {
		return "", nil
	}
	in, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(in) == 0 {
		return "", fmt.Errorf("not a valid encoded secret")
	}
	inBlob := windows.DataBlob{Size: uint32(len(in)), Data: &in[0]}
	var outBlob windows.DataBlob
	if err := windows.CryptUnprotectData(&inBlob, nil, nil, 0, nil, 0, &outBlob); err != nil {
		return "", fmt.Errorf("CryptUnprotectData: %w", err)
	}
	defer windows.LocalFree(windows.Handle(uintptr(unsafe.Pointer(outBlob.Data))))
	out := unsafe.Slice(outBlob.Data, outBlob.Size)
	return string(out), nil
}
