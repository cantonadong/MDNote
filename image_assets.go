package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var imageExts = map[string]bool{
	".apng": true,
	".avif": true,
	".bmp":  true,
	".gif":  true,
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".svg":  true,
	".webp": true,
}

func imageMimeFromExt(ext string) string {
	if m := mime.TypeByExtension(strings.ToLower(ext)); m != "" {
		return strings.Split(m, ";")[0]
	}
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".svg":
		return "image/svg+xml"
	default:
		return "image/png"
	}
}

const imageAssetsDirName = "Images"
const legacyPicDirName = "Pic"

func legacyPicDir() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(exePath), legacyPicDirName), nil
}

func imageAssetsDirForSettings(settings Settings, create bool) (string, error) {
	if settings.RootDir == "" {
		return "", fmt.Errorf(localized("尚未设置根目录", "root folder is not set"))
	}
	dir := filepath.Join(effectiveRoot(settings), imageAssetsDirName)
	if create {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", err
		}
	}
	return dir, nil
}

func imageAssetsDir(create bool) (string, error) {
	settings, err := loadSettings()
	if err != nil {
		return "", err
	}
	return imageAssetsDirForSettings(settings, create)
}

func fileURLForPath(path string) string {
	slash := filepath.ToSlash(path)
	return "file:///" + strings.ReplaceAll(url.PathEscape(slash), "%2F", "/")
}

func replaceImagePathVariants(content, oldPath, newPath string) string {
	oldAbs, err := filepath.Abs(oldPath)
	if err != nil {
		oldAbs = oldPath
	}
	newAbs, err := filepath.Abs(newPath)
	if err != nil {
		newAbs = newPath
	}
	replacements := [][2]string{
		{oldAbs, newAbs},
		{filepath.ToSlash(oldAbs), filepath.ToSlash(newAbs)},
		{fileURLForPath(oldAbs), fileURLForPath(newAbs)},
	}
	for _, r := range replacements {
		content = strings.ReplaceAll(content, r[0], r[1])
	}
	return content
}

func migrateLegacyPicToImages(settings Settings) error {
	dstDir, err := imageAssetsDirForSettings(settings, true)
	if err != nil {
		return err
	}
	srcDir, err := legacyPicDir()
	if err != nil {
		return err
	}
	srcAbs, _ := filepath.Abs(srcDir)
	dstAbs, _ := filepath.Abs(dstDir)
	if strings.EqualFold(srcAbs, dstAbs) {
		return nil
	}
	info, err := os.Stat(srcDir)
	if err != nil || !info.IsDir() {
		return nil
	}
	moved := map[string]string{}
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if !imageExts[ext] {
			continue
		}
		src := filepath.Join(srcDir, entry.Name())
		dst := filepath.Join(dstDir, entry.Name())
		if _, err := os.Stat(dst); err == nil {
			newDst, allocErr := newImageAssetPath(ext)
			if allocErr != nil {
				return allocErr
			}
			dst = newDst
		}
		if err := os.Rename(src, dst); err != nil {
			if copyErr := copyFile(src, dst); copyErr != nil {
				return copyErr
			}
			if removeErr := os.Remove(src); removeErr != nil {
				return removeErr
			}
		}
		moved[src] = dst
	}
	if len(moved) == 0 {
		_ = os.Remove(srcDir)
		return nil
	}
	root := effectiveRoot(settings)
	if err := filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil || d.IsDir() || !strings.EqualFold(filepath.Ext(path), ".md") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		updated := string(data)
		for oldPath, newPath := range moved {
			updated = replaceImagePathVariants(updated, oldPath, newPath)
		}
		if updated == string(data) {
			return nil
		}
		return os.WriteFile(path, []byte(updated), 0o644)
	}); err != nil {
		return err
	}
	_ = os.Remove(srcDir)
	return nil
}

func randomImageID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", b[:]), nil
}

func imageExtFromMime(mime string) string {
	switch strings.ToLower(strings.TrimSpace(strings.Split(mime, ";")[0])) {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/bmp":
		return ".bmp"
	case "image/svg+xml":
		return ".svg"
	case "image/avif":
		return ".avif"
	default:
		return ".png"
	}
}

func newImageAssetPath(ext string) (string, error) {
	if ext == "" {
		ext = ".png"
	}
	ext = strings.ToLower(ext)
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	if !imageExts[ext] {
		ext = ".png"
	}
	dir, err := imageAssetsDir(true)
	if err != nil {
		return "", err
	}
	for i := 0; i < 16; i++ {
		id, err := randomImageID()
		if err != nil {
			return "", err
		}
		path := filepath.Join(dir, id+ext)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			return path, nil
		}
	}
	return "", fmt.Errorf("could not allocate image filename")
}

// Asset references are relative to the content root, independent of the
// computer's drive letter and chosen notes folder.
func imageAssetReference(path string) string {
	return imageAssetsDirName + "/" + filepath.Base(path)
}

func resolveImageSource(src string) (string, error) {
	trimmed := strings.TrimSpace(src)
	if strings.HasPrefix(strings.ToLower(trimmed), "file://") {
		u, err := url.Parse(trimmed)
		if err != nil {
			return "", err
		}
		trimmed = u.Path
		if len(trimmed) >= 3 && trimmed[0] == '/' && trimmed[2] == ':' {
			trimmed = trimmed[1:]
		}
	}
	// Older notes contain absolute paths from the originating computer.
	// Only remap managed Images/Pic assets, leaving external images alone.
	normalized := strings.ReplaceAll(trimmed, "\\", "/")
	parts := strings.Split(normalized, "/")
	if len(parts) >= 2 {
		parent, name := parts[len(parts)-2], parts[len(parts)-1]
		if (strings.EqualFold(parent, imageAssetsDirName) || strings.EqualFold(parent, legacyPicDirName)) && name != "" && name != "." && name != ".." {
			dir, err := imageAssetsDir(false)
			if err != nil {
				return "", err
			}
			local := filepath.Join(dir, name)
			if info, err := os.Stat(local); err == nil && !info.IsDir() {
				return local, nil
			}
			if !filepath.IsAbs(trimmed) {
				return local, nil
			}
		}
	}
	return filepath.Abs(trimmed)
}

// SaveImageAssetFromPath copies a local image, or downloads an http(s) image,
// into the Images folder inside the current MDNote content root.
func (a *App) SaveDocumentImage(src, mimeType, documentPath string) (string, error) {
	if mimeType != "" {
		return a.SaveImageAssetFromData(src, mimeType)
	}
	return a.SaveImageAssetFromPath(src)
}
func (a *App) SaveImageAssetFromPath(src string) (string, error) {
	trimmed := strings.TrimSpace(src)
	if trimmed == "" {
		return "", fmt.Errorf("empty image path")
	}
	if u, err := url.Parse(trimmed); err == nil && (u.Scheme == "http" || u.Scheme == "https") {
		resp, err := http.Get(trimmed)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return "", fmt.Errorf("download image: %s", resp.Status)
		}
		ext := strings.ToLower(filepath.Ext(u.Path))
		if !imageExts[ext] {
			ext = imageExtFromMime(resp.Header.Get("Content-Type"))
		}
		dst, err := newImageAssetPath(ext)
		if err != nil {
			return "", err
		}
		f, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err != nil {
			return "", err
		}
		defer f.Close()
		if _, err := io.Copy(f, resp.Body); err != nil {
			return "", err
		}
		return imageAssetReference(dst), nil
	}

	srcAbs, err := resolveImageSource(trimmed)
	if err != nil {
		return "", err
	}
	ext := strings.ToLower(filepath.Ext(srcAbs))
	if !imageExts[ext] {
		return "", fmt.Errorf("unsupported image type: %s", ext)
	}
	in, err := os.Open(srcAbs)
	if err != nil {
		return "", err
	}
	defer in.Close()
	dst, err := newImageAssetPath(ext)
	if err != nil {
		return "", err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return "", err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return "", err
	}
	return imageAssetReference(dst), nil
}

// SaveImageAssetFromData stores a pasted bitmap/file payload in the Images
// folder inside the current MDNote content root. data may be raw base64 or a
// data:image/... URL.
func (a *App) SaveImageAssetFromData(data string, mime string) (string, error) {
	payload := strings.TrimSpace(data)
	if payload == "" {
		return "", fmt.Errorf("empty image data")
	}
	if strings.HasPrefix(payload, "data:") {
		head, body, ok := strings.Cut(payload, ",")
		if !ok {
			return "", fmt.Errorf("invalid data URL")
		}
		payload = body
		if strings.HasPrefix(head, "data:") {
			mime = strings.TrimPrefix(strings.Split(head, ";")[0], "data:")
		}
	}
	bytes, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", err
	}
	dst, err := newImageAssetPath(imageExtFromMime(mime))
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(dst, bytes, 0o644); err != nil {
		return "", err
	}
	return imageAssetReference(dst), nil
}

// RevealImageInExplorer uses the same local asset resolution as image display,
// including portable references and absolute paths from another computer.
func (a *App) RevealImageInExplorer(src string) error {
	path, err := resolveImageSource(src)
	if err != nil {
		return err
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("image source is a directory: %s", path)
	}
	return a.RevealInExplorer(path)
}

func (a *App) ImageDataURL(path string) (string, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", fmt.Errorf("empty image path")
	}
	abs, err := resolveImageSource(trimmed)
	if err != nil {
		return "", err
	}
	ext := strings.ToLower(filepath.Ext(abs))
	if !imageExts[ext] {
		return "", fmt.Errorf("unsupported image type: %s", ext)
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return "data:" + imageMimeFromExt(ext) + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func imageFilename(src string) string {
	name := filepath.Base(src)
	if u, err := url.Parse(src); err == nil && u.Path != "" {
		name = filepath.Base(u.Path)
	}
	if name == "." || name == string(filepath.Separator) || name == "" {
		return "image.png"
	}
	if !imageExts[strings.ToLower(filepath.Ext(name))] {
		return name + ".png"
	}
	return name
}

func copyImageSourceTo(src string, dst string) error {
	if u, err := url.Parse(src); err == nil && (u.Scheme == "http" || u.Scheme == "https") {
		resp, err := http.Get(src)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("download image: %s", resp.Status)
		}
		out, err := os.Create(dst)
		if err != nil {
			return err
		}
		defer out.Close()
		_, err = io.Copy(out, resp.Body)
		return err
	}
	local, err := resolveImageSource(src)
	if err != nil {
		return err
	}
	in, err := os.Open(local)
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

func (a *App) SaveImageAs(src string) (string, error) {
	trimmed := strings.TrimSpace(src)
	if trimmed == "" {
		return "", fmt.Errorf("empty image path")
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           localized("图片另存为", "Save image as"),
		DefaultFilename: imageFilename(trimmed),
		Filters: []runtime.FileFilter{
			{DisplayName: localized("图片文件 (*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.svg;*.avif)", "Image files (*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.svg;*.avif)"), Pattern: "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.svg;*.avif"},
			{DisplayName: localized("所有文件 (*.*)", "All files (*.*)"), Pattern: "*.*"},
		},
	})
	if err != nil || path == "" {
		return "", err
	}
	if err := copyImageSourceTo(trimmed, path); err != nil {
		return "", err
	}
	return path, nil
}

func imageReferenceVariants(path string) []string {
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	slash := filepath.ToSlash(abs)
	fileURL := "file:///" + strings.ReplaceAll(url.PathEscape(slash), "%2F", "/")
	return []string{abs, slash, fileURL, filepath.Base(abs)}
}

func contentReferencesImage(contents []string, path string) bool {
	for _, variant := range imageReferenceVariants(path) {
		for _, content := range contents {
			if strings.Contains(content, variant) {
				return true
			}
		}
	}
	return false
}

func externalImageDocuments() (string, []string, error) {
	config, err := settingsPath()
	if err != nil {
		return "", nil, err
	}
	path := filepath.Join(filepath.Dir(config), "external-image-documents.json")
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return path, nil, nil
	}
	if err != nil {
		return path, nil, err
	}
	var paths []string
	err = json.Unmarshal(data, &paths)
	return path, paths, err
}

// Called under noteFilesMu. Remember external notes even after their tabs close.
func trackExternalImageDocument(path string) error {
	settings, err := loadSettings()
	if err != nil {
		return err
	}
	if settings.RootDir == "" || withinRoot(effectiveRoot(settings), path) == nil {
		return nil
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	registry, paths, err := externalImageDocuments()
	if err != nil {
		return err
	}
	for _, existing := range paths {
		if strings.EqualFold(existing, abs) {
			return nil
		}
	}
	data, err := json.Marshal(append(paths, abs))
	if err != nil {
		return err
	}
	return os.WriteFile(registry, data, 0o644)
}

func (a *App) CleanupUnusedImages(openContents []string) error {
	noteFilesMu.Lock()
	defer noteFilesMu.Unlock()
	dir, err := imageAssetsDir(false)
	if err != nil {
		return err
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return nil
	}
	contents := append([]string{}, openContents...)
	_, externalPaths, err := externalImageDocuments()
	if err != nil {
		return err
	}
	for _, path := range externalPaths {
		data, err := os.ReadFile(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		contents = append(contents, string(data))
	}
	settings, err := loadSettings()
	if err != nil {
		return err
	}
	if settings.RootDir != "" {
		root := effectiveRoot(settings)
		err := filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if d.IsDir() || !strings.EqualFold(filepath.Ext(path), ".md") {
				return nil
			}
			data, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			contents = append(contents, string(data))
			return nil
		})
		if err != nil {
			return err
		}
	}
	return filepath.WalkDir(dir, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil || d.IsDir() {
			return nil
		}
		if !imageExts[strings.ToLower(filepath.Ext(path))] {
			return nil
		}
		if contentReferencesImage(contents, path) {
			return nil
		}
		_ = os.Remove(path)
		return nil
	})
}
