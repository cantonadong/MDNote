package main

import (
	"bufio"
	"fmt"
	"net"
	"time"
)

// Loopback-only port used to detect an already-running instance and forward
// a file path to it. A plain TCP listener is simpler than a Windows named
// pipe (no extra dependency) and doesn't trigger firewall prompts since it
// never binds anything but 127.0.0.1.
const singleInstanceAddr = "127.0.0.1:57391"

// acquireSingleInstance tries to become the one running instance. If the
// port is already held by an earlier launch, initialFile (if any) is
// forwarded to it instead and ok is false, telling main() to exit
// immediately rather than opening a second, blank window.
func acquireSingleInstance(initialFile string) (ln net.Listener, ok bool) {
	l, err := net.Listen("tcp", singleInstanceAddr)
	if err != nil {
		forwardToRunningInstance(initialFile)
		return nil, false
	}
	return l, true
}

// forwardToRunningInstance always pokes the running instance so a plain
// relaunch (double-clicking the exe again, no file) still brings its window
// forward instead of doing nothing; path may be "" for that case.
func forwardToRunningInstance(path string) {
	conn, err := net.DialTimeout("tcp", singleInstanceAddr, 500*time.Millisecond)
	if err != nil {
		return
	}
	defer conn.Close()
	fmt.Fprintf(conn, "%s\n", path)
}

// serveSingleInstance accepts pokes forwarded from later launches —
// double-clicking another .md file, or just relaunching the exe (empty
// path) — while this instance is already running, and hands each one to
// onFile. Runs until ln is closed at shutdown.
func serveSingleInstance(ln net.Listener, onFile func(string)) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		go func() {
			defer conn.Close()
			scanner := bufio.NewScanner(conn)
			if scanner.Scan() {
				onFile(scanner.Text())
			}
		}()
	}
}
