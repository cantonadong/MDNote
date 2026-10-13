package main

import (
	"fmt"
	"math"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	foregroundMonitorFromRect     = windows.NewLazySystemDLL("user32.dll").NewProc("MonitorFromRect")
	foregroundGetMonitorInfo      = windows.NewLazySystemDLL("user32.dll").NewProc("GetMonitorInfoW")
	foregroundRestoreMaximized    atomic.Bool
	foregroundUser32              = windows.NewLazySystemDLL("user32.dll")
	foregroundGDI32               = windows.NewLazySystemDLL("gdi32.dll")
	foregroundFindWindow          = foregroundUser32.NewProc("FindWindowW")
	foregroundGetWindowRect       = foregroundUser32.NewProc("GetWindowRect")
	foregroundGetClientRect       = foregroundUser32.NewProc("GetClientRect")
	foregroundClientToScreen      = foregroundUser32.NewProc("ClientToScreen")
	foregroundGetDPI              = foregroundUser32.NewProc("GetDpiForWindow")
	foregroundGetWindowLong       = foregroundUser32.NewProc("GetWindowLongPtrW")
	foregroundSetWindowLong       = foregroundUser32.NewProc("SetWindowLongPtrW")
	foregroundCallWindowProc      = foregroundUser32.NewProc("CallWindowProcW")
	foregroundDefWindowProc       = foregroundUser32.NewProc("DefWindowProcW")
	foregroundSendMessage         = foregroundUser32.NewProc("SendMessageW")
	foregroundSetWindowPos        = foregroundUser32.NewProc("SetWindowPos")
	foregroundShowWindow          = foregroundUser32.NewProc("ShowWindow")
	foregroundIsZoomed            = foregroundUser32.NewProc("IsZoomed")
	foregroundGetPlacement        = foregroundUser32.NewProc("GetWindowPlacement")
	foregroundSetPlacement        = foregroundUser32.NewProc("SetWindowPlacement")
	foregroundIsIconic            = foregroundUser32.NewProc("IsIconic")
	foregroundAdjustRect          = foregroundUser32.NewProc("AdjustWindowRectExForDpi")
	foregroundSetWindowRgn        = foregroundUser32.NewProc("SetWindowRgn")
	foregroundRedrawWindow        = foregroundUser32.NewProc("RedrawWindow")
	foregroundCreateRectRgn       = foregroundGDI32.NewProc("CreateRectRgn")
	foregroundDeleteObject        = foregroundGDI32.NewProc("DeleteObject")
	foregroundRegisterClass       = foregroundUser32.NewProc("RegisterClassExW")
	foregroundCreateWindow        = foregroundUser32.NewProc("CreateWindowExW")
	foregroundDestroyWindow       = foregroundUser32.NewProc("DestroyWindow")
	foregroundUpdateLayeredWindow = foregroundUser32.NewProc("UpdateLayeredWindow")
	foregroundGetDC               = foregroundUser32.NewProc("GetDC")
	foregroundReleaseDC           = foregroundUser32.NewProc("ReleaseDC")
	foregroundCreateDC            = foregroundGDI32.NewProc("CreateCompatibleDC")
	foregroundDeleteDC            = foregroundGDI32.NewProc("DeleteDC")
	foregroundCreateDIB           = foregroundGDI32.NewProc("CreateDIBSection")
	foregroundSelectObject        = foregroundGDI32.NewProc("SelectObject")
	foregroundGetModuleHandle     = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetModuleHandleW")
	foregroundHookMu              sync.Mutex
	foregroundPreviousProc        uintptr
	foregroundProc                = syscall.NewCallback(foregroundWindowProc)
	foregroundShadowProc          = syscall.NewCallback(func(hwnd, msg, wparam, lparam uintptr) uintptr {
		if msg == 0x0084 {
			return ^uintptr(0)
		} // HTTRANSPARENT
		result, _, _ := foregroundDefWindowProc.Call(hwnd, msg, wparam, lparam)
		return result
	})
	foregroundState foregroundWindowState // Accessed only on the window's UI thread.
)

const foregroundModeMessage = 0x8000 + 0x451

type foregroundRect struct{ Left, Top, Right, Bottom int32 }
type foregroundPoint struct{ X, Y int32 }
type foregroundSize struct{ Width, Height int32 }
type foregroundPlacement struct {
	Length, Flags, ShowCmd   uint32
	MinPosition, MaxPosition foregroundPoint
	NormalPosition           foregroundRect
}
type foregroundMonitorInfo struct {
	Size          uint32
	Monitor, Work foregroundRect
	Flags         uint32
}
type foregroundRequest struct {
	Left, Right      float64
	Enabled, Topmost bool
	Err              error
}
type foregroundWindowState struct {
	active, wasMaximized      bool
	ordinaryPlacement         foregroundPlacement
	left, right               float64
	regionWidth, regionHeight int32
	regionDPI                 uintptr
	shadow                    uintptr
	shadowClass               *uint16
	shadowWidth, shadowHeight int32
	shadowDPI                 uintptr
}

// Install one native message hook, then marshal every mode change onto the
// owning UI thread. The WebView and the native client area must change together.
func (a *App) ApplyForegroundWindowRegion(leftCSS, rightCSS float64, enabled, topmost bool) error {
	if leftCSS < 0 || rightCSS < 0 || math.IsNaN(leftCSS) || math.IsNaN(rightCSS) || math.IsInf(leftCSS, 0) || math.IsInf(rightCSS, 0) {
		return fmt.Errorf("invalid foreground insets")
	}
	title, _ := windows.UTF16PtrFromString("MDNote")
	hwnd, _, _ := foregroundFindWindow.Call(0, uintptr(unsafe.Pointer(title)))
	if hwnd == 0 {
		return fmt.Errorf("MDNote window not found")
	}
	foregroundHookMu.Lock()
	if foregroundPreviousProc == 0 {
		index := ^uintptr(3) // GWLP_WNDPROC (-4)
		foregroundPreviousProc, _, _ = foregroundGetWindowLong.Call(hwnd, index)
		if foregroundPreviousProc == 0 {
			foregroundHookMu.Unlock()
			return fmt.Errorf("MDNote window procedure not found")
		}
		if previous, _, err := foregroundSetWindowLong.Call(hwnd, index, foregroundProc); previous == 0 {
			foregroundPreviousProc = 0
			foregroundHookMu.Unlock()
			return fmt.Errorf("install foreground window procedure: %v", err)
		}
	}
	foregroundHookMu.Unlock()
	request := foregroundRequest{Left: leftCSS, Right: rightCSS, Enabled: enabled, Topmost: topmost}
	foregroundSendMessage.Call(hwnd, foregroundModeMessage, 0, uintptr(unsafe.Pointer(&request)))
	runtime.KeepAlive(&request)
	return request.Err
}

func foregroundWindowProc(hwnd, msg, wparam, lparam uintptr) uintptr {
	if msg == foregroundModeMessage {
		request := (*foregroundRequest)(unsafe.Pointer(lparam))
		request.Err = foregroundState.apply(hwnd, request)
		return 0
	}
	if foregroundState.active {
		switch msg {
		case 0x0083: // WM_NCCALCSIZE: the whole native window is the client area.
			if zoomed, _, _ := foregroundIsZoomed.Call(hwnd); zoomed != 0 && wparam != 0 {
				bounds := (*foregroundRect)(unsafe.Pointer(lparam))
				monitor, _, _ := foregroundMonitorFromRect.Call(lparam, 2)
				info := foregroundMonitorInfo{Size: uint32(unsafe.Sizeof(foregroundMonitorInfo{}))}
				if ok, _, _ := foregroundGetMonitorInfo.Call(monitor, uintptr(unsafe.Pointer(&info))); ok != 0 {
					*bounds = info.Work
				}
			}
			return 0
		case 0x0084: // WM_NCHITTEST: let the WebView receive the title row's input.
			return 1 // HTCLIENT; Wails starts native moves/resizes explicitly.
		}
	}
	result, _, _ := foregroundCallWindowProc.Call(foregroundPreviousProc, hwnd, msg, wparam, lparam)
	switch msg {
	case 0x0005, 0x0047, 0x02E0: // WM_SIZE, WM_WINDOWPOSCHANGED, WM_DPICHANGED
		if foregroundState.active {
			foregroundState.updateEdges(hwnd)
		}
	case 0x0018: // WM_SHOWWINDOW
		if wparam == 0 && foregroundState.shadow != 0 {
			foregroundShowWindow.Call(foregroundState.shadow, 0)
		}
	case 0x0002: // WM_DESTROY
		if foregroundState.shadow != 0 {
			foregroundDestroyWindow.Call(foregroundState.shadow)
			foregroundState.shadow = 0
		}
	}
	return result
}

func foregroundDPI(hwnd uintptr) (uintptr, float64) {
	dpi, _, _ := foregroundGetDPI.Call(hwnd)
	if dpi == 0 {
		dpi = 96
	}
	return dpi, float64(dpi) / 96
}

func (state *foregroundWindowState) apply(hwnd uintptr, request *foregroundRequest) error {
	if request.Enabled == state.active {
		if state.active {
			state.updateEdges(hwnd)
		}
		return nil
	}
	dpi, scale := foregroundDPI(hwnd)
	var outer, client foregroundRect
	var origin foregroundPoint
	foregroundGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&outer)))
	foregroundGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	foregroundClientToScreen.Call(hwnd, uintptr(unsafe.Pointer(&origin)))
	const flags = 0x0010 | 0x0020 | 0x0200 // NOACTIVATE|FRAMECHANGED|NOOWNERZORDER
	insertAfter := ^uintptr(1)             // HWND_NOTOPMOST
	if request.Topmost {
		insertAfter = ^uintptr(0)
	}
	if request.Enabled {
		left := int32(math.Round(request.Left * scale))
		right := int32(math.Round(request.Right * scale))
		width := client.Right - left - right
		if width <= 0 {
			return fmt.Errorf("invalid foreground width")
		}
		placement := foregroundPlacement{Length: uint32(unsafe.Sizeof(foregroundPlacement{}))}
		if ok, _, err := foregroundGetPlacement.Call(hwnd, uintptr(unsafe.Pointer(&placement))); ok == 0 {
			return fmt.Errorf("save ordinary window placement: %v", err)
		}
		state.ordinaryPlacement = placement
		state.left, state.right = request.Left, request.Right
		maximized, _, _ := foregroundIsZoomed.Call(hwnd)
		state.wasMaximized = maximized != 0
		foregroundRestoreMaximized.Store(state.wasMaximized)
		state.active = true
		if state.wasMaximized {
			foregroundShowWindow.Call(hwnd, 9)
		} // SW_RESTORE
		// Match the old editor's actual screen rectangle. No hidden caption or
		// sidebar strips remain in the native client/input coordinate system.
		ok, _, err := foregroundSetWindowPos.Call(hwnd, insertAfter,
			uintptr(origin.X+left), uintptr(origin.Y), uintptr(width), uintptr(client.Bottom), flags)
		if ok == 0 {
			state.active = false
			foregroundRestoreMaximized.Store(false)
			foregroundSetWindowPos.Call(hwnd, 0, uintptr(outer.Left), uintptr(outer.Top), uintptr(outer.Right-outer.Left), uintptr(outer.Bottom-outer.Top), flags|0x0004)
			return fmt.Errorf("enter foreground mode: %v", err)
		}
		state.updateEdges(hwnd)
	} else {
		restoreMaximized := state.wasMaximized
		if maximized, _, _ := foregroundIsZoomed.Call(hwnd); maximized != 0 {
			restoreMaximized = true
		}
		if restoreMaximized {
			// Mode geometry must never become Windows' ordinary restore rectangle.
			// Restore the saved placement, including its normal position, instead
			// of deriving a new normal rectangle from the maximized editor area.
			placement := state.ordinaryPlacement
			placement.ShowCmd = 3 // SW_SHOWMAXIMIZED
			placement.Flags &^= 4 // Apply synchronously on the owning UI thread.
			state.active = false
			if state.shadow != 0 {
				foregroundShowWindow.Call(state.shadow, 0)
			}
			foregroundSetWindowRgn.Call(hwnd, 0, 1)
			state.regionWidth, state.regionHeight = 0, 0
			foregroundSetWindowPos.Call(hwnd, insertAfter, 0, 0, 0, 0, flags|0x0001|0x0002)
			if ok, _, err := foregroundSetPlacement.Call(hwnd, uintptr(unsafe.Pointer(&placement))); ok == 0 {
				state.active = true
				foregroundSetWindowPos.Call(hwnd, ^uintptr(0), uintptr(outer.Left), uintptr(outer.Top), uintptr(outer.Right-outer.Left), uintptr(outer.Bottom-outer.Top), flags)
				state.updateEdges(hwnd)
				return fmt.Errorf("restore ordinary window placement: %v", err)
			}
			foregroundRestoreMaximized.Store(false)
			foregroundRedrawWindow.Call(hwnd, 0, 0, 0x0001|0x0004|0x0080|0x0100|0x0400)
			return nil
		}
		// Expand around the current editor rectangle and let Windows calculate
		// the real caption/frame once. This also restores WebView's client bounds.
		left := int32(math.Round(state.left * scale))
		right := int32(math.Round(state.right * scale))
		frame := foregroundRect{Right: client.Right + left + right, Bottom: client.Bottom}
		style, _, _ := foregroundGetWindowLong.Call(hwnd, ^uintptr(15)) // GWL_STYLE (-16)
		exStyle, _, _ := foregroundGetWindowLong.Call(hwnd, ^uintptr(19))
		if ok, _, err := foregroundAdjustRect.Call(uintptr(unsafe.Pointer(&frame)), style, 0, exStyle, dpi); ok == 0 {
			return fmt.Errorf("restore window frame: %v", err)
		}
		state.active = false
		if state.shadow != 0 {
			foregroundShowWindow.Call(state.shadow, 0)
		}
		foregroundSetWindowRgn.Call(hwnd, 0, 1)
		state.regionWidth, state.regionHeight = 0, 0
		if ok, _, err := foregroundSetWindowPos.Call(hwnd, insertAfter,
			uintptr(origin.X-left+frame.Left), uintptr(origin.Y+frame.Top),
			uintptr(frame.Right-frame.Left), uintptr(frame.Bottom-frame.Top), flags); ok == 0 {
			state.active = true
			state.updateEdges(hwnd)
			return fmt.Errorf("leave foreground mode: %v", err)
		}
		foregroundRestoreMaximized.Store(false)
	}
	foregroundRedrawWindow.Call(hwnd, 0, 0, 0x0001|0x0004|0x0080|0x0100|0x0400)
	return nil
}

func (state *foregroundWindowState) updateEdges(hwnd uintptr) {
	if minimized, _, _ := foregroundIsIconic.Call(hwnd); minimized != 0 {
		if state.shadow != 0 {
			foregroundShowWindow.Call(state.shadow, 0)
		}
		return
	}
	if maximized, _, _ := foregroundIsZoomed.Call(hwnd); maximized != 0 {
		if state.shadow != 0 {
			foregroundShowWindow.Call(state.shadow, 0)
		}
		foregroundRestoreMaximized.Store(true)
		if state.regionWidth != 0 {
			state.regionWidth, state.regionHeight = 0, 0
			foregroundSetWindowRgn.Call(hwnd, 0, 1)
		}
		return
	}
	var bounds foregroundRect
	foregroundRestoreMaximized.Store(state.wasMaximized)
	if ok, _, _ := foregroundGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&bounds))); ok == 0 {
		return
	}
	width, height := bounds.Right-bounds.Left, bounds.Bottom-bounds.Top
	if width <= 0 || height <= 0 {
		return
	}
	dpi, scale := foregroundDPI(hwnd)
	if width != state.regionWidth || height != state.regionHeight || dpi != state.regionDPI {
		// Cache before setting the region: SetWindowRgn sends WINDOWPOSCHANGED.
		state.regionWidth, state.regionHeight, state.regionDPI = width, height, dpi
		region, _, _ := foregroundCreateRectRgn.Call(0, 0, uintptr(width+1), uintptr(height+1))
		if region != 0 {
			if ok, _, _ := foregroundSetWindowRgn.Call(hwnd, region, 1); ok == 0 {
				foregroundDeleteObject.Call(region)
			}
		}
	}
	state.updateShadow(hwnd, bounds, dpi, scale)
}

type foregroundWindowClass struct {
	Size, Style                        uint32
	Procedure                          uintptr
	ClassExtra, WindowExtra            int32
	Instance, Icon, Cursor, Background uintptr
	MenuName, ClassName                *uint16
	SmallIcon                          uintptr
}
type foregroundBitmapHeader struct {
	Size                         uint32
	Width, Height                int32
	Planes, BitCount             uint16
	Compression, SizeImage       uint32
	XPelsPerMeter, YPelsPerMeter int32
	ClrUsed, ClrImportant        uint32
}
type foregroundBlend struct{ Operation, Flags, Alpha, Format byte }

// A separate non-activating, click-through layered window draws the shadow
// outside the main window. A CSS shadow would be clipped by its HRGN.
func (state *foregroundWindowState) updateShadow(hwnd uintptr, bounds foregroundRect, dpi uintptr, scale float64) {
	if state.shadow == 0 {
		instance, _, _ := foregroundGetModuleHandle.Call(0)
		if state.shadowClass == nil {
			className, _ := windows.UTF16PtrFromString("MDNoteForegroundShadow")
			class := foregroundWindowClass{Procedure: foregroundShadowProc, ClassName: className, Instance: instance}
			class.Size = uint32(unsafe.Sizeof(class))
			if atom, _, _ := foregroundRegisterClass.Call(uintptr(unsafe.Pointer(&class))); atom == 0 {
				return
			}
			state.shadowClass = className
		}
		// LAYERED|TRANSPARENT|TOOLWINDOW|NOACTIVATE; no taskbar/Alt-Tab entry.
		state.shadow, _, _ = foregroundCreateWindow.Call(0x00080000|0x00000020|0x00000080|0x08000000,
			uintptr(unsafe.Pointer(state.shadowClass)), 0, 0x80000000, 0, 0, 0, 0, 0, 0, instance, 0)
		if state.shadow == 0 {
			return
		}
	}
	padding := int32(math.Ceil(20 * scale))
	width, height := bounds.Right-bounds.Left+2*padding, bounds.Bottom-bounds.Top+2*padding
	destination := foregroundPoint{bounds.Left - padding, bounds.Top - padding}
	if width != state.shadowWidth || height != state.shadowHeight || dpi != state.shadowDPI {
		if !state.drawShadow(destination, width, height, padding, scale) {
			return
		}
		state.shadowWidth, state.shadowHeight, state.shadowDPI = width, height, dpi
	}
	// Inserting after the main window keeps the shadow directly underneath it.
	foregroundSetWindowPos.Call(state.shadow, hwnd, uintptr(destination.X), uintptr(destination.Y), uintptr(width), uintptr(height), 0x0010|0x0040)
}

func (state *foregroundWindowState) drawShadow(destination foregroundPoint, width, height, padding int32, scale float64) bool {
	screenDC, _, _ := foregroundGetDC.Call(0)
	if screenDC == 0 {
		return false
	}
	defer foregroundReleaseDC.Call(0, screenDC)
	memoryDC, _, _ := foregroundCreateDC.Call(screenDC)
	if memoryDC == 0 {
		return false
	}
	defer foregroundDeleteDC.Call(memoryDC)
	header := foregroundBitmapHeader{Size: 40, Width: width, Height: -height, Planes: 1, BitCount: 32}
	var bits uintptr
	bitmap, _, _ := foregroundCreateDIB.Call(screenDC, uintptr(unsafe.Pointer(&header)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if bitmap == 0 || bits == 0 {
		return false
	}
	defer foregroundDeleteObject.Call(bitmap)
	previous, _, _ := foregroundSelectObject.Call(memoryDC, bitmap)
	defer foregroundSelectObject.Call(memoryDC, previous)
	pixels := unsafe.Slice((*uint32)(unsafe.Pointer(bits)), int(width)*int(height))
	clear(pixels)
	radius, sigma := 0.0, 6*scale
	halfWidth, halfHeight := float64(width-2*padding)/2, float64(height-2*padding)/2
	centerX, centerY := float64(width)/2, float64(height)/2
	innerEdge := padding + int32(math.Ceil(radius))
	for y := int32(0); y < height; y++ {
		qy := math.Abs(float64(y)+0.5-centerY) - (halfHeight - radius)
		for x := int32(0); x < width; x++ {
			// Only the outer ring can be visible. Avoid expensive distance/alpha
			// calculations across the editor interior during interactive resizing.
			if x == innerEdge && y >= innerEdge && y < height-innerEdge && width > 2*innerEdge {
				x = width - innerEdge - 1
				continue
			}
			qx := math.Abs(float64(x)+0.5-centerX) - (halfWidth - radius)
			distance := math.Hypot(math.Max(qx, 0), math.Max(qy, 0)) + math.Min(math.Max(qx, qy), 0) - radius
			var alpha uint32
			if distance > 0 {
				alpha = uint32(math.Round(100 * math.Exp(-distance*distance/(2*sigma*sigma))))
			}
			pixels[int(y)*int(width)+int(x)] = alpha << 24 // Premultiplied black BGRA.
		}
	}
	size, source := foregroundSize{width, height}, foregroundPoint{}
	blend := foregroundBlend{Alpha: 255, Format: 1} // AC_SRC_ALPHA
	ok, _, _ := foregroundUpdateLayeredWindow.Call(state.shadow, screenDC,
		uintptr(unsafe.Pointer(&destination)), uintptr(unsafe.Pointer(&size)), memoryDC,
		uintptr(unsafe.Pointer(&source)), 0, uintptr(unsafe.Pointer(&blend)), 2)
	return ok != 0
}
