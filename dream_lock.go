//go:build !windows

package memora

import (
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"syscall"
)

func isProcessAlive(pid int) (bool, error) {
	if pid <= 0 {
		return false, nil
	}
	err := syscall.Kill(pid, 0)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, syscall.ESRCH) {
		return false, nil
	}
	if errors.Is(err, syscall.EPERM) {
		return true, nil
	}
	return false, err
}

func WithDreamLock(path string, run func() error) error {
	// Keep the inode so stale takeovers and new opens contend on the same lock.
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return err
	}
	defer func() {
		_ = f.Close()
	}()

	locked := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) == nil
	raw, err := io.ReadAll(f)
	if err != nil {
		return err
	}
	holder, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
	alive, err := isProcessAlive(holder)
	if err != nil {
		return err
	}
	if !locked || alive {
		if holder > 0 {
			return fmt.Errorf("Dream lock is held by PID %d", holder)
		}
		return errors.New("Dream lock is held")
	}

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
