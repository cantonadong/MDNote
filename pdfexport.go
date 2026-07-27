package main

import (
	"fmt"
	"os"
	"path/filepath"
	goruntime "runtime"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"github.com/wailsapp/go-webview2/webviewloader"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows"
)

// This file drives a throwaway, invisible WebView2 instance purely to call
// the native ICoreWebView2_7.PrintToPdf COM method, which writes a PDF
// straight to disk with no print preview/print dialog UI at all — the only
// silent path WebView2 exposes.
//
// It does NOT use go-webview2's pkg/edge.Chromium convenience wrapper (the
// same one Wails' own main window uses): that wrapper's internal
// errorCallback calls os.Exit(1) on *any* WebView2/COM failure, which would
// take the whole app down over a failed PDF export.
//
// It also does NOT use go-webview2's pkg/webview2 package (which does have
// safe, non-fatal bindings including PrintToPdf): merely importing it
// currently panics at package-init time on this Go toolchain — one of its
// ~150 generated files declares a Go `string` as a raw native callback
// parameter, which syscall.NewCallback rejects ("argument size is larger
// than uintptr") regardless of which part of the package is actually used.
// Wails itself never hits this because its own pkg/edge has an entirely
// separate, hand-written set of bindings that never imports pkg/webview2 —
// this bug has evidently never been exercised in practice.
//
// So: only webviewloader (the actual environment bootstrapper Wails' own
// build already relies on) is reused for creating the environment.
// Everything past that — controller, webview, navigation, PrintToPdf — is
// this file's own minimal COM vtable calls, built directly against the
// documented WebView2 win32 ABI.

var (
	user32               = windows.NewLazySystemDLL("user32.dll")
	procRegisterClassExW = user32.NewProc("RegisterClassExW")
	procCreateWindowExW  = user32.NewProc("CreateWindowExW")
	procDestroyWindowW   = user32.NewProc("DestroyWindow")
	procDefWindowProcW   = user32.NewProc("DefWindowProcW")
	procPeekMessageW     = user32.NewProc("PeekMessageW")
	procTranslateMessage = user32.NewProc("TranslateMessage")
	procDispatchMessageW = user32.NewProc("DispatchMessageW")

	pdfHiddenClassOnce int32
)

const pdfHiddenClassName = "MDNotePdfExportHiddenWindow"

// Matches the real Win32 WNDCLASSEXW layout.
type wndClassExW struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     windows.Handle
	hIcon         windows.Handle
	hCursor       windows.Handle
	hbrBackground windows.Handle
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       windows.Handle
}

// Matches the real Win32 MSG layout.
type win32Msg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      struct{ x, y int32 }
}

const (
	wsPopup               = 0x80000000
	pmRemove              = 0x0001
	errClassAlreadyExists = 1410
)

func ensurePdfHiddenClassRegistered(hInstance windows.Handle) error {
	if atomic.LoadInt32(&pdfHiddenClassOnce) == 1 {
		return nil
	}
	name, err := windows.UTF16PtrFromString(pdfHiddenClassName)
	if err != nil {
		return err
	}
	wc := wndClassExW{
		lpfnWndProc:   procDefWindowProcW.Addr(),
		hInstance:     hInstance,
		lpszClassName: name,
	}
	wc.cbSize = uint32(unsafe.Sizeof(wc))
	r, _, callErr := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
	if r == 0 {
		if errno, ok := callErr.(syscall.Errno); !ok || int(errno) != errClassAlreadyExists {
			return fmt.Errorf("RegisterClassExW: %w", callErr)
		}
	}
	atomic.StoreInt32(&pdfHiddenClassOnce, 1)
	return nil
}

// createHiddenWindow makes a zero-size, never-shown top-level window purely
// to serve as the parent HWND CreateCoreWebView2Controller requires.
func createHiddenWindow() (uintptr, error) {
	var hInstance windows.Handle
	if err := windows.GetModuleHandleEx(0, nil, &hInstance); err != nil {
		return 0, fmt.Errorf("GetModuleHandleEx: %w", err)
	}
	if err := ensurePdfHiddenClassRegistered(hInstance); err != nil {
		return 0, err
	}
	className, err := windows.UTF16PtrFromString(pdfHiddenClassName)
	if err != nil {
		return 0, err
	}
	hwnd, _, callErr := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		0,
		uintptr(wsPopup),
		0, 0, 0, 0,
		0, 0,
		uintptr(hInstance),
		0,
	)
	if hwnd == 0 {
		return 0, fmt.Errorf("CreateWindowExW: %w", callErr)
	}
	return hwnd, nil
}

func destroyHiddenWindow(hwnd uintptr) {
	procDestroyWindowW.Call(hwnd)
}

// pumpMessagesUntil dispatches this thread's window/COM messages — required
// for the async WebView2 completion callbacks below to ever fire — until
// done is non-zero or timeout elapses.
func pumpMessagesUntil(done *int32, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var m win32Msg
	for {
		if atomic.LoadInt32(done) != 0 {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("等待 WebView2 响应超时")
		}
		r, _, _ := procPeekMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0, pmRemove)
		if r != 0 {
			procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
			procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
		} else {
			time.Sleep(2 * time.Millisecond)
		}
	}
}

func hresultErr(r uintptr) error {
	if windows.Handle(r) != windows.S_OK {
		return syscall.Errno(r)
	}
	return nil
}

// -- Minimal base IUnknown wrapper, for Release()ing any COM pointer below --

type comUnknownVtbl struct {
	queryInterface uintptr
	addRef         uintptr
	release        uintptr
}

type comUnknown struct {
	vtbl *comUnknownVtbl
}

func (c *comUnknown) Release() uintptr {
	r, _, _ := syscall.SyscallN(c.vtbl.release, uintptr(unsafe.Pointer(c)))
	return r
}

func (c *comUnknown) queryInterfaceRaw(iid *windows.GUID) unsafe.Pointer {
	var out unsafe.Pointer
	syscall.SyscallN(c.vtbl.queryInterface, uintptr(unsafe.Pointer(c)), uintptr(unsafe.Pointer(iid)), uintptr(unsafe.Pointer(&out)))
	return out
}

// -- ICoreWebView2Environment: only CreateCoreWebView2Controller is needed --

type environmentVtbl struct {
	comUnknownVtbl
	createCoreWebView2Controller uintptr
}

type environment struct {
	vtbl *environmentVtbl
}

func (e *environment) createController(hwnd uintptr, handler *controllerCompletedHandler) error {
	r, _, _ := syscall.SyscallN(e.vtbl.createCoreWebView2Controller,
		uintptr(unsafe.Pointer(e)),
		hwnd,
		uintptr(unsafe.Pointer(handler)),
	)
	return hresultErr(r)
}

// -- ICoreWebView2Controller: only GetCoreWebView2 is needed, which is the
// 22nd method after IUnknown in the real interface — the rest are declared
// purely to keep GetCoreWebView2 at the right memory offset. --

type controllerVtbl struct {
	comUnknownVtbl
	getIsVisible                      uintptr
	putIsVisible                      uintptr
	getBounds                         uintptr
	putBounds                         uintptr
	getZoomFactor                     uintptr
	putZoomFactor                     uintptr
	addZoomFactorChanged              uintptr
	removeZoomFactorChanged           uintptr
	setBoundsAndZoomFactor            uintptr
	moveFocus                         uintptr
	addMoveFocusRequested             uintptr
	removeMoveFocusRequested          uintptr
	addGotFocus                       uintptr
	removeGotFocus                    uintptr
	addLostFocus                      uintptr
	removeLostFocus                   uintptr
	addAcceleratorKeyPressed          uintptr
	removeAcceleratorKeyPressed       uintptr
	getParentWindow                   uintptr
	putParentWindow                   uintptr
	notifyParentWindowPositionChanged uintptr
	close                             uintptr
	getCoreWebView2                   uintptr
}

type controller struct {
	vtbl *controllerVtbl
}

func (c *controller) Close() {
	syscall.SyscallN(c.vtbl.close, uintptr(unsafe.Pointer(c)))
}

func (c *controller) getWebview() (*webview, error) {
	var wv *webview
	r, _, _ := syscall.SyscallN(c.vtbl.getCoreWebView2,
		uintptr(unsafe.Pointer(c)),
		uintptr(unsafe.Pointer(&wv)),
	)
	if err := hresultErr(r); err != nil {
		return nil, err
	}
	return wv, nil
}

// -- ICoreWebView2: NavigateToString + AddNavigationCompleted, matching the
// real interface's order up through AddNavigationCompleted (13th method
// after IUnknown). Everything before it that we don't call is still
// declared, purely to preserve the offset. --

type webviewVtbl struct {
	comUnknownVtbl
	getSettings              uintptr
	getSource                uintptr
	navigate                 uintptr
	navigateToString         uintptr
	addNavigationStarting    uintptr
	removeNavigationStarting uintptr
	addContentLoading        uintptr
	removeContentLoading     uintptr
	addSourceChanged         uintptr
	removeSourceChanged      uintptr
	addHistoryChanged        uintptr
	removeHistoryChanged     uintptr
	addNavigationCompleted   uintptr
}

type webview struct {
	vtbl *webviewVtbl
}

func (w *webview) navigateToString(html string) error {
	ptr, err := windows.UTF16PtrFromString(html)
	if err != nil {
		return err
	}
	r, _, _ := syscall.SyscallN(w.vtbl.navigateToString, uintptr(unsafe.Pointer(w)), uintptr(unsafe.Pointer(ptr)))
	return hresultErr(r)
}

type eventRegistrationToken struct {
	value int64
}

func (w *webview) addNavigationCompleted(handler *navigationCompletedHandler) error {
	var token eventRegistrationToken
	r, _, _ := syscall.SyscallN(w.vtbl.addNavigationCompleted,
		uintptr(unsafe.Pointer(w)),
		uintptr(unsafe.Pointer(handler)),
		uintptr(unsafe.Pointer(&token)),
	)
	return hresultErr(r)
}

// IID_ICoreWebView2_7, per the WebView2 SDK — the version that introduces
// PrintToPdf.
var iidICoreWebView2_7 = windows.GUID{
	Data1: 0x79c24d83,
	Data2: 0x09a3,
	Data3: 0x45ae,
	Data4: [8]byte{0x94, 0x18, 0x48, 0x7f, 0x32, 0xa5, 0x87, 0x40},
}

type webview7Vtbl struct {
	comUnknownVtbl
	printToPdf uintptr
}

type webview7 struct {
	vtbl *webview7Vtbl
}

func (w *webview) queryWebview7() *webview7 {
	ptr := (*comUnknown)(unsafe.Pointer(w)).queryInterfaceRaw(&iidICoreWebView2_7)
	if ptr == nil {
		return nil
	}
	return (*webview7)(ptr)
}

func (w *webview7) Release() uintptr {
	return (*comUnknown)(unsafe.Pointer(w)).Release()
}

func (w *webview7) printToPdfToFile(path string, handler *printToPdfCompletedHandler) error {
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	r, _, _ := syscall.SyscallN(w.vtbl.printToPdf,
		uintptr(unsafe.Pointer(w)),
		uintptr(unsafe.Pointer(ptr)),
		0, // printSettings: nil = defaults
		uintptr(unsafe.Pointer(handler)),
	)
	return hresultErr(r)
}

// -- ICoreWebView2NavigationCompletedEventArgs: only GetIsSuccess is needed --

type navArgsVtbl struct {
	comUnknownVtbl
	getIsSuccess uintptr
}

type navArgs struct {
	vtbl *navArgsVtbl
}

func (a *navArgs) getIsSuccess() bool {
	var isSuccess int32
	syscall.SyscallN(a.vtbl.getIsSuccess, uintptr(unsafe.Pointer(a)), uintptr(unsafe.Pointer(&isSuccess)))
	return isSuccess != 0
}

// -- Shared trivial IUnknown implementation for the completion handlers
// below: this process is never asked for any interface but the one it was
// constructed for, so QueryInterface always fails, and lifetime is tied to
// a local Go variable for the whole export rather than real refcounting. --

func comQueryInterfaceStub(_ uintptr, _ uintptr, _ uintptr) uintptr {
	return uintptr(windows.E_NOINTERFACE)
}
func comAddRefStub(_ uintptr) uintptr  { return 1 }
func comReleaseStub(_ uintptr) uintptr { return 1 }

var (
	comQueryInterfaceCb = syscall.NewCallback(comQueryInterfaceStub)
	comAddRefCb         = syscall.NewCallback(comAddRefStub)
	comReleaseCb        = syscall.NewCallback(comReleaseStub)
)

// -- CreateCoreWebView2Controller completion handler --

type controllerCompletedHandlerVtbl struct {
	comUnknownVtbl
	invoke uintptr
}

type controllerCompletedHandler struct {
	vtbl       *controllerCompletedHandlerVtbl
	controller *controller
	errCode    uintptr
	done       int32
}

func controllerCompletedInvoke(this uintptr, errorCode uintptr, result uintptr) uintptr {
	h := (*controllerCompletedHandler)(unsafe.Pointer(this))
	if result != 0 {
		h.controller = (*controller)(unsafe.Pointer(result))
	} else {
		h.errCode = errorCode
	}
	atomic.StoreInt32(&h.done, 1)
	return 0
}

var controllerCompletedHandlerFn = controllerCompletedHandlerVtbl{
	comUnknownVtbl: comUnknownVtbl{comQueryInterfaceCb, comAddRefCb, comReleaseCb},
	invoke:         syscall.NewCallback(controllerCompletedInvoke),
}

func newControllerCompletedHandler() *controllerCompletedHandler {
	return &controllerCompletedHandler{vtbl: &controllerCompletedHandlerFn}
}

// -- NavigationCompleted event handler --

type navigationCompletedHandlerVtbl struct {
	comUnknownVtbl
	invoke uintptr
}

type navigationCompletedHandler struct {
	vtbl   *navigationCompletedHandlerVtbl
	failed bool
	done   int32
}

func navigationCompletedInvoke(this uintptr, _ uintptr, args uintptr) uintptr {
	h := (*navigationCompletedHandler)(unsafe.Pointer(this))
	a := (*navArgs)(unsafe.Pointer(args))
	if !a.getIsSuccess() {
		h.failed = true
	}
	atomic.StoreInt32(&h.done, 1)
	return 0
}

var navigationCompletedHandlerFn = navigationCompletedHandlerVtbl{
	comUnknownVtbl: comUnknownVtbl{comQueryInterfaceCb, comAddRefCb, comReleaseCb},
	invoke:         syscall.NewCallback(navigationCompletedInvoke),
}

func newNavigationCompletedHandler() *navigationCompletedHandler {
	return &navigationCompletedHandler{vtbl: &navigationCompletedHandlerFn}
}

// -- PrintToPdf completion handler --

type printToPdfCompletedHandlerVtbl struct {
	comUnknownVtbl
	invoke uintptr
}

type printToPdfCompletedHandler struct {
	vtbl    *printToPdfCompletedHandlerVtbl
	failed  bool
	errCode uintptr
	done    int32
}

func printToPdfCompletedInvoke(this uintptr, errorCode uintptr, isSuccessful uintptr) uintptr {
	h := (*printToPdfCompletedHandler)(unsafe.Pointer(this))
	if isSuccessful == 0 {
		h.failed = true
		h.errCode = errorCode
	}
	atomic.StoreInt32(&h.done, 1)
	return 0
}

var printToPdfCompletedHandlerFn = printToPdfCompletedHandlerVtbl{
	comUnknownVtbl: comUnknownVtbl{comQueryInterfaceCb, comAddRefCb, comReleaseCb},
	invoke:         syscall.NewCallback(printToPdfCompletedInvoke),
}

func newPrintToPdfCompletedHandler() *printToPdfCompletedHandler {
	return &printToPdfCompletedHandler{vtbl: &printToPdfCompletedHandlerFn}
}

// -- Environment creation completion (still via webviewloader, which is
// unaffected by the pkg/webview2 bug above and is what Wails' own build
// already exercises successfully) --

type pdfEnvHandler struct {
	envPtr  unsafe.Pointer
	errCode int32
	done    int32
}

func (h *pdfEnvHandler) EnvironmentCompleted(errorCode webviewloader.HRESULT, env *webviewloader.ICoreWebView2Environment) webviewloader.HRESULT {
	if env != nil {
		// The webviewloader wrapper releases its own reference to env right
		// after this call returns — AddRef to keep it alive for the rest of
		// the export.
		env.AddRef()
		h.envPtr = unsafe.Pointer(env)
	} else {
		h.errCode = int32(errorCode)
	}
	atomic.StoreInt32(&h.done, 1)
	return 0
}

// SavePdfDialog opens a native save-path picker for the "另存为PDF" toolbar
// action. defaultDir, if it names an existing directory, opens the dialog
// there; otherwise it falls back to the OS default.
func (a *App) SavePdfDialog(defaultName string, defaultDir string) (string, error) {
	if defaultName == "" {
		defaultName = "未命名"
	}
	opts := runtime.SaveDialogOptions{
		Title:           "另存为 PDF",
		DefaultFilename: defaultName,
		Filters: []runtime.FileFilter{
			{DisplayName: "PDF (*.pdf)", Pattern: "*.pdf"},
		},
	}
	if info, err := os.Stat(defaultDir); err == nil && info.IsDir() {
		opts.DefaultDirectory = defaultDir
	}
	return runtime.SaveFileDialog(a.ctx, opts)
}

// ExportPdf silently renders html (a full, self-contained HTML document
// snapshot of the current note, built on the frontend) to a PDF at path,
// with no print preview or print-dialog UI ever appearing.
func (a *App) ExportPdf(html string, path string) error {
	return exportHTMLToPDF(html, path)
}

const pdfStageTimeout = 25 * time.Second

// exportHTMLToPDF renders html in a throwaway, invisible WebView2 instance
// and writes the result straight to outputPath. Runs on its own dedicated,
// locked OS thread since every Win32 window and COM STA object involved is
// thread-affine — none of it may be touched from whatever goroutine Wails
// happened to invoke this on.
func exportHTMLToPDF(html string, outputPath string) error {
	resultCh := make(chan error, 1)
	go func() {
		goruntime.LockOSThread()
		// Deliberately not unlocked afterward: this thread ends up carrying
		// COM apartment state (CoInitializeEx) tied to the hidden window and
		// WebView2 objects created on it, so it shouldn't be handed back to
		// Go's scheduler for unrelated goroutines once this is done.
		resultCh <- doExportHTMLToPDF(html, outputPath)
	}()
	return <-resultCh
}

func doExportHTMLToPDF(html string, outputPath string) error {
	if initErr := windows.CoInitializeEx(0, windows.COINIT_APARTMENTTHREADED); initErr != nil {
		return fmt.Errorf("CoInitializeEx: %w", initErr)
	}
	defer windows.CoUninitialize()

	hwnd, err := createHiddenWindow()
	if err != nil {
		return err
	}
	defer destroyHiddenWindow(hwnd)

	userDataDir, err := os.MkdirTemp("", "mdnote-pdf-export-*")
	if err != nil {
		return fmt.Errorf("创建临时目录失败: %w", err)
	}
	defer os.RemoveAll(userDataDir)

	envHandler := &pdfEnvHandler{}
	if createErr := webviewloader.CreateCoreWebView2EnvironmentWithOptions(
		envHandler,
		webviewloader.WithUserDataFolder(userDataDir),
	); createErr != nil {
		return fmt.Errorf("创建 WebView2 环境失败: %w", createErr)
	}
	if pumpErr := pumpMessagesUntil(&envHandler.done, pdfStageTimeout); pumpErr != nil {
		return pumpErr
	}
	if envHandler.envPtr == nil {
		return fmt.Errorf("创建 WebView2 环境失败 (0x%x)", envHandler.errCode)
	}
	env := (*environment)(envHandler.envPtr)
	defer (*comUnknown)(envHandler.envPtr).Release()

	controllerHandler := newControllerCompletedHandler()
	if createErr := env.createController(hwnd, controllerHandler); createErr != nil {
		return fmt.Errorf("创建 WebView2 控制器失败: %w", createErr)
	}
	if pumpErr := pumpMessagesUntil(&controllerHandler.done, pdfStageTimeout); pumpErr != nil {
		return pumpErr
	}
	if controllerHandler.controller == nil {
		return fmt.Errorf("创建 WebView2 控制器失败 (0x%x)", controllerHandler.errCode)
	}
	ctrl := controllerHandler.controller
	defer ctrl.Close()

	wv, err := ctrl.getWebview()
	if err != nil {
		return fmt.Errorf("GetCoreWebView2: %w", err)
	}

	navHandler := newNavigationCompletedHandler()
	if navRegErr := wv.addNavigationCompleted(navHandler); navRegErr != nil {
		return fmt.Errorf("AddNavigationCompleted: %w", navRegErr)
	}
	if navErr := wv.navigateToString(html); navErr != nil {
		return fmt.Errorf("NavigateToString: %w", navErr)
	}
	if pumpErr := pumpMessagesUntil(&navHandler.done, pdfStageTimeout); pumpErr != nil {
		return pumpErr
	}
	if navHandler.failed {
		return fmt.Errorf("加载待导出内容失败")
	}

	wv7 := wv.queryWebview7()
	if wv7 == nil {
		return fmt.Errorf("当前 WebView2 运行时版本过旧，不支持导出 PDF，请更新 WebView2 运行时")
	}
	defer wv7.Release()

	absPath, err := filepath.Abs(outputPath)
	if err != nil {
		return err
	}

	printHandler := newPrintToPdfCompletedHandler()
	if printErr := wv7.printToPdfToFile(absPath, printHandler); printErr != nil {
		return fmt.Errorf("PrintToPdf: %w", printErr)
	}
	if pumpErr := pumpMessagesUntil(&printHandler.done, pdfStageTimeout); pumpErr != nil {
		return pumpErr
	}
	if printHandler.failed {
		return fmt.Errorf("导出 PDF 失败 (0x%x)", printHandler.errCode)
	}
	return nil
}
