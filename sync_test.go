package memora_test

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func makeSyncNote(name, description, section string) string {
	secLine := ""
	if section != "" {
		secLine = "section: " + section + "\n"
	}
	return fmt.Sprintf("---\nname: %s\ndescription: %s\ntype: project\n%s---\nbody stays out of the index\n", name, description, secLine)
}

func TestSyncKeepsOrderAppendsNewNotesAndKeepsNowFirst(t *testing.T) {
	f := newFixture(t)
	global := filepath.Join(f.root, "global")
	project := filepath.Join(f.root, "projects", "alpha")
	empty := filepath.Join(f.root, "projects", "empty")
	globalIndex := filepath.Join(global, "MEMORY.md")
	projectIndex := filepath.Join(project, "MEMORY.md")

	putStr(t, globalIndex, "## 待删\n- [Deleted](deleted.md) — gone\n\n## 工作\n- [Old title](z.md) — old hook\n- [Old title](b.md) — old hook\n\n## 用户\n- [User](user.md) — current\n")
	putStr(t, filepath.Join(global, "z.md"), makeSyncNote("Z", "keep first", "工作"))
	putStr(t, filepath.Join(global, "b.md"), makeSyncNote("B", "keep second", "工作"))
	putStr(t, filepath.Join(global, "a.md"), makeSyncNote("A", "new note", "工作"))
	putStr(t, filepath.Join(global, "user.md"), makeSyncNote("User", "current", "用户"))
	putStr(t, filepath.Join(global, "0.md"), makeSyncNote("Other", "new section", "工具"))
	putStr(t, filepath.Join(global, "1.md"), makeSyncNote("Next", "next section", "生活"))
	putStr(t, filepath.Join(global, "2.md"), makeSyncNote("Loose", "no section", ""))

	putStr(t, projectIndex, "- [Z](z.md) — keep first\n- [B](b.md) — keep second\n")
	putStr(t, filepath.Join(project, "NOW.md"), makeSyncNote("Now", "next step", ""))
	putStr(t, filepath.Join(project, "a.md"), makeSyncNote("A", "new note", ""))
	putStr(t, filepath.Join(project, "b.md"), makeSyncNote("B", "keep second", ""))
	putStr(t, filepath.Join(project, "z.md"), makeSyncNote("Z", "keep first", ""))

	putStr(t, filepath.Join(global, "archive", "past.md"), "ignored archive body")
	putStr(t, filepath.Join(project, "archive", "past.md"), "ignored archive body")
	putStr(t, filepath.Join(project, "ignored.txt"), "ignored non-note body")
	putStr(t, filepath.Join(project, "ignored.MD"), "ignored uppercase extension")
	putStr(t, filepath.Join(empty, "archive", "past.md"), "ignored archive body")

	sync := func() cliResult { return runCLI(f, []string{"sync", "--root", f.root}, nil) }
	if got := sync(); got != (cliResult{code: 0, out: "Indexes: 2 written, 0 unchanged; 0 warnings\n", err: ""}) {
		t.Fatalf("unexpected first sync: %+v", got)
	}

	wantGlobal := "## 工作\n- [Z](z.md) — keep first\n- [B](b.md) — keep second\n- [A](a.md) — new note\n\n" +
		"## 用户\n- [User](user.md) — current\n\n" +
		"## 工具\n- [Other](0.md) — new section\n\n" +
		"## 生活\n- [Next](1.md) — next section\n\n" +
		"## 未分类\n- [Loose](2.md) — no section\n"
	gotGlobal, err := os.ReadFile(globalIndex)
	if err != nil || string(gotGlobal) != wantGlobal {
		t.Fatalf("global index mismatch:\ngot:\n%s\nwant:\n%s", string(gotGlobal), wantGlobal)
	}

	wantProject := "- [Now](NOW.md) — next step\n- [Z](z.md) — keep first\n- [B](b.md) — keep second\n- [A](a.md) — new note\n"
	gotProject, err := os.ReadFile(projectIndex)
	if err != nil || string(gotProject) != wantProject {
		t.Fatalf("project index mismatch:\ngot:\n%s\nwant:\n%s", string(gotProject), wantProject)
	}

	if _, err := os.Stat(filepath.Join(empty, "MEMORY.md")); !os.IsNotExist(err) {
		t.Fatalf("expected empty project MEMORY.md not to exist")
	}

	fixed := time.Unix(100, 0)
	for _, idx := range []string{globalIndex, projectIndex} {
		if err := os.Chtimes(idx, fixed, fixed); err != nil {
			t.Fatalf("Chtimes: %v", err)
		}
	}
	if got := sync(); got != (cliResult{code: 0, out: "Indexes: 0 written, 2 unchanged; 0 warnings\n", err: ""}) {
		t.Fatalf("unexpected unchanged sync: %+v", got)
	}
	for _, idx := range []string{globalIndex, projectIndex} {
		info, err := os.Stat(idx)
		if err != nil || info.ModTime().UnixMilli() != 100_000 {
			t.Fatalf("expected mtime 100s on %s, got %v", idx, info.ModTime())
		}
	}

	putStr(t, filepath.Join(project, "z.md"), makeSyncNote("Z", "updated", ""))
	if got := sync(); got != (cliResult{code: 0, out: "Indexes: 1 written, 1 unchanged; 0 warnings\n", err: ""}) {
		t.Fatalf("unexpected partial sync: %+v", got)
	}
	updatedProj, _ := os.ReadFile(projectIndex)
	if !strings.Contains(string(updatedProj), "- [Z](z.md) — updated\n") {
		t.Fatalf("expected updated z.md in project index: %s", string(updatedProj))
	}
	info, _ := os.Stat(globalIndex)
	if info.ModTime().UnixMilli() != 100_000 {
		t.Fatalf("expected global mtime unchanged, got %v", info.ModTime())
	}
}

func TestSyncFrontmatterFallbacksAndWarnings(t *testing.T) {
	f := newFixture(t)
	project := filepath.Join(f.root, "projects", "alpha")
	longHook := strings.Repeat("字", 151)
	putStr(t, filepath.Join(project, "missing.md"), "\n  "+longHook+"  \nignored\n")
	putStr(t, filepath.Join(project, "broken.md"), "---\nname: [bad\n---\n\nReadable body\n")
	putStr(t, filepath.Join(project, "long.md"), makeSyncNote("Long", longHook, ""))

	res := runCLI(f, []string{"sync", "--root", f.root}, nil)
	if res.code != 0 {
		t.Fatalf("expected exit 0, got %+v", res)
	}
	if !strings.Contains(res.out, "3 warnings") {
		t.Fatalf("expected 3 warnings in stdout: %s", res.out)
	}
	errLines := strings.Split(strings.TrimRight(res.err, "\n"), "\n")
	if len(errLines) != 3 ||
		!strings.Contains(errLines[0], "broken.md: invalid YAML") ||
		!strings.Contains(errLines[1], "long.md: description exceeds 150 characters") ||
		!strings.Contains(errLines[2], "missing.md: missing frontmatter") {
		t.Fatalf("unexpected warning lines: %#v", errLines)
	}
	want := fmt.Sprintf("- [broken](broken.md) — Readable body\n- [Long](long.md) — %s\n- [missing](missing.md) — %s\n",
		longHook, strings.Repeat("字", 150))
	got, _ := os.ReadFile(filepath.Join(project, "MEMORY.md"))
	if string(got) != want {
		t.Fatalf("index mismatch:\ngot:\n%s\nwant:\n%s", string(got), want)
	}
}

func TestSyncIndexSizeWarnings(t *testing.T) {
	for _, pair := range [][2]int{{199, 201}, {200, 200}, {200, 201}} {
		globalCount, projectCount := pair[0], pair[1]
		t.Run(fmt.Sprintf("%d_global_%d_project", globalCount+1, projectCount), func(t *testing.T) {
			f := newFixture(t)
			global := filepath.Join(f.root, "global")
			project := filepath.Join(f.root, "projects", "alpha")
			for i := 1; i <= globalCount; i++ {
				putStr(t, filepath.Join(global, fmt.Sprintf("%d.md", i)), makeSyncNote(fmt.Sprintf("Note %d", i), "hook", "工具"))
			}
			for i := 1; i <= projectCount; i++ {
				putStr(t, filepath.Join(project, fmt.Sprintf("%d.md", i)), makeSyncNote(fmt.Sprintf("Note %d", i), "hook", "工具"))
			}
			res := runCLI(f, []string{"sync", "--root", f.root}, nil)
			if res.code != 0 {
				t.Fatalf("expected exit 0, got %+v", res)
			}
			for _, check := range []struct {
				folder string
				count  int
			}{
				{global, globalCount + 1},
				{project, projectCount},
			} {
				idxPath := filepath.Join(check.folder, "MEMORY.md")
				raw, err := os.ReadFile(idxPath)
				if err != nil {
					t.Fatalf("ReadFile %s: %v", idxPath, err)
				}
				lines := strings.Split(strings.TrimRight(string(raw), "\n"), "\n")
				if len(lines) != check.count {
					t.Fatalf("expected %d lines in %s, got %d", check.count, idxPath, len(lines))
				}
				hasWarn := strings.Contains(res.err, idxPath+": index exceeds 200 lines")
				if hasWarn != (check.count > 200) {
					t.Fatalf("warning mismatch for %s (count=%d): stderr=%q", idxPath, check.count, res.err)
				}
			}
		})
	}
}

func TestSyncReportsUnreadableIndex(t *testing.T) {
	for _, scope := range []string{"global", "projects/alpha"} {
		t.Run(scope, func(t *testing.T) {
			f := newFixture(t)
			putStr(t, filepath.Join(f.root, scope, "note.md"), makeSyncNote("Note", "hook", ""))
			putStr(t, filepath.Join(f.root, scope, "MEMORY.md", "not-an-index"), "")
			res := runCLI(f, []string{"sync", "--root", f.root}, nil)
			if res.code == 0 {
				t.Fatalf("expected non-zero exit code")
			}
			if !strings.Contains(res.err, "is a directory") {
				t.Fatalf("expected directory read error, got %q", res.err)
			}
		})
	}
}
