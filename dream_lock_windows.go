//go:build windows

package memora

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil || proc == nil {
		return false
	}
	_ = proc.Release()
	return true
}

func WithDreamLock(path string, run func() error) error {
	if raw, err := os.ReadFile(path); err == nil {
		holder, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
		if isProcessAlive(holder) {
			return fmt.Errorf("Dream lock is held by PID %d", holder)
		}
	}
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return errors.New("Dream lock is held")
	}
	defer func() {
		_ = f.Close()
	}()
	if err := f.Truncate(0); err != nil {
		return err
	}
	if _, err := f.WriteAt([]byte(fmt.Sprintf("%d\n", os.Getpid())), 0); err != nil {
		return err
	}
	defer func() {
		_ = f.Truncate(0)
	}()
	return run()
}
