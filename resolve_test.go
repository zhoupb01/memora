package memora_test

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zhoupb01/memora"
)

func runGitFixture(t *testing.T, f testFixture, dir string, stdin *string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = []string{
		"PATH=" + os.Getenv("PATH"),
		"HOME=" + f.home,
		"XDG_CONFIG_HOME=" + f.home,
		"GIT_CONFIG_NOSYSTEM=1",
	}
	if stdin != nil {
		cmd.Stdin = strings.NewReader(*stdin)
	}
	var out, stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("git %v failed: %v\n%s", args, err, stderr.String())
	}
	return strings.TrimRight(out.String(), "\r\n")
}

func TestResolveRootPrecedenceAndHomeExpansion(t *testing.T) {
	f := newFixture(t)
	runGitFixture(t, f, f.cwd, nil, "init", "--quiet")
	folder := func(root string) string { return filepath.Join(root, "projects", "work") + "\n" }

	if got := runCLI(f, []string{"resolve", "--root", f.root}, strPtr("~/override")).out; got != folder(f.root) {
		t.Fatalf("got %q, want %q", got, folder(f.root))
	}
	if got := runCLI(f, []string{"resolve", "--root", "~/explicit"}, strPtr("~/override")).out; got != folder(filepath.Join(f.home, "explicit")) {
		t.Fatalf("got %q, want %q", got, folder(filepath.Join(f.home, "explicit")))
	}
	if got := runCLI(f, []string{"resolve", "--root", ""}, strPtr("~/override")).out; got != folder(f.cwd) {
		t.Fatalf("got %q, want %q", got, folder(f.cwd))
	}
	for _, override := range []*string{strPtr(""), strPtr(" \t\n"), nil} {
		if got := runCLI(f, []string{"resolve"}, override).out; got != folder(filepath.Join(f.home, ".agents", "memory")) {
			t.Fatalf("override %v: got %q", override, got)
		}
	}
	for _, override := range []string{"~", "~/", `~\`} {
		if got := runCLI(f, []string{"resolve"}, strPtr(override)).out; got != folder(f.home) {
			t.Fatalf("override %q: got %q, want %q", override, got, folder(f.home))
		}
	}
	for _, override := range []string{"~/memory", `~\memory`} {
		if got := runCLI(f, []string{"resolve"}, strPtr(override)).out; got != folder(filepath.Join(f.home, "memory")) {
			t.Fatalf("override %q: got %q", override, got)
		}
	}
}

func TestResolveNestedRepoAndLinkedWorktree(t *testing.T) {
	f := newFixture(t)
	mainRepo := filepath.Join(f.cwd, "MainRepo")
	nested := filepath.Join(mainRepo, "src")
	worktree := filepath.Join(f.home, "linked-worktree")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	runGitFixture(t, f, f.cwd, nil, "init", "--quiet")
	runGitFixture(t, f, mainRepo, nil, "init", "--quiet")
	empty := ""
	tree := runGitFixture(t, f, mainRepo, &empty, "mktree")
	commit := runGitFixture(t, f, mainRepo, nil, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit-tree", tree, "-m", "initial")
	runGitFixture(t, f, mainRepo, nil, "worktree", "add", "--quiet", "--detach", worktree, commit)

	folder := filepath.Join(f.root, "projects", "MainRepo")
	if got := runCLI(f, []string{"resolve", nested, "--root", f.root}, nil); got != (cliResult{code: 0, out: folder + "\n", err: ""}) {
		t.Fatalf("unexpected resolve nested: %+v", got)
	}

	var before memora.ProjectResolution
	if err := json.Unmarshal([]byte(runCLI(f, []string{"resolve", worktree, "--json", "--root", f.root}, nil).out), &before); err != nil {
		t.Fatal(err)
	}
	if before.Slug == nil || *before.Slug != "MainRepo" || before.Folder == nil || *before.Folder != folder || before.Exists {
		t.Fatalf("unexpected worktree json before mkdir: %+v", before)
	}

	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	var after memora.ProjectResolution
	if err := json.Unmarshal([]byte(runCLI(f, []string{"resolve", worktree, "--json", "--root", f.root}, nil).out), &after); err != nil {
		t.Fatal(err)
	}
	if after.Slug == nil || *after.Slug != "MainRepo" || after.Folder == nil || *after.Folder != folder || !after.Exists {
		t.Fatalf("unexpected worktree json after mkdir: %+v", after)
	}
}

func TestResolveOutsideGitClosestFolderWinsAndHomeDoesNotCount(t *testing.T) {
	f := newFixture(t)
	nested := filepath.Join(f.cwd, "src", "nested")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	resolve := func(args ...string) cliResult {
		return runCLI(f, append([]string{"resolve", "--root", f.root}, args...), nil)
	}
	if err := os.MkdirAll(filepath.Join(f.root, "projects", "home"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolve(nested); got != (cliResult{code: 0, out: "", err: ""}) {
		t.Fatalf("expected empty resolve when only home matches, got %+v", got)
	}
	var none memora.ProjectResolution
	if err := json.Unmarshal([]byte(resolve(nested, "--json").out), &none); err != nil {
		t.Fatal(err)
	}
	if none.Slug != nil || none.Folder != nil || none.Exists {
		t.Fatalf("expected null resolution, got %+v", none)
	}

	project := filepath.Join(f.root, "projects", "work")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolve().out; got != project+"\n" {
		t.Fatalf("got %q, want %q", got, project+"\n")
	}
	if got := resolve(nested).out; got != project+"\n" {
		t.Fatalf("got %q, want %q", got, project+"\n")
	}
	closer := filepath.Join(f.root, "projects", "src")
	if err := os.MkdirAll(closer, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolve(nested).out; got != closer+"\n" {
		t.Fatalf("got %q, want %q", got, closer+"\n")
	}
}
