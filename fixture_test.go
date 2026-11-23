package memora_test

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

var memoraBin string

func TestMain(m *testing.M) {
	tmpDir, err := os.MkdirTemp("", "memora-bin-*")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create temp bin dir: %v\n", err)
		os.Exit(1)
	}
	memoraBin = filepath.Join(tmpDir, "memora")
	build := exec.Command("go", "build", "-o", memoraBin, "./cmd/memora")
	if out, err := build.CombinedOutput(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to build memora binary: %v\n%s\n", err, string(out))
		_ = os.RemoveAll(tmpDir)
		os.Exit(1)
	}
	code := m.Run()
	_ = os.RemoveAll(tmpDir)
	os.Exit(code)
}

type testFixture struct {
	t    *testing.T
	home string
	cwd  string
	root string
}

func newFixture(t *testing.T) testFixture {
	t.Helper()
	rawDir := t.TempDir()
	dir, err := filepath.EvalSymlinks(rawDir)
	if err != nil {
		t.Fatalf("EvalSymlinks: %v", err)
	}
	home := filepath.Join(dir, "home")
	cwd := filepath.Join(home, "work")
	root := filepath.Join(dir, "memory")
	if err := os.MkdirAll(cwd, 0o755); err != nil {
		t.Fatalf("MkdirAll cwd: %v", err)
	}
	return testFixture{t: t, home: home, cwd: cwd, root: root}
}

func put(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll %s: %v", path, err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("WriteFile %s: %v", path, err)
	}
}

func putStr(t *testing.T, path string, text string) {
	t.Helper()
	put(t, path, []byte(text))
}

type cliResult struct {
	code int
	out  string
	err  string
}

func runCLI(f testFixture, args []string, memoryDir *string) cliResult {
	f.t.Helper()
	cmd := exec.Command(memoraBin, args...)
	cmd.Dir = f.cwd
	env := []string{
		"PATH=" + os.Getenv("PATH"),
		"HOME=" + f.home,
		"USERPROFILE=" + f.home,
		"TZ=UTC",
	}
	if memoryDir != nil {
		env = append(env, "MEMORA_DIR="+*memoryDir)
	}
	cmd.Env = env
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	code := 0
	if err != nil {
		if cmd.ProcessState != nil {
			code = cmd.ProcessState.ExitCode()
		} else {
			code = 1
		}
	}
	return cliResult{code: code, out: stdout.String(), err: stderr.String()}
}

func strPtr(s string) *string {
	return &s
}
