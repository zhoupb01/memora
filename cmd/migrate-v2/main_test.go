package main

import (
	"bytes"
	"encoding/base64"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"
)

const (
	testPrefix    = "-Users-zhoupb-Documents-"
	testMemora    = testPrefix + "projects-memora"
	testWorkspace = testPrefix + "deepseek-harness-default-workspace"
	testProjects  = testPrefix + "projects"
	testNote      = "---\nname: Original\ndescription: Original hook\ntype: project\nextra: gone\n---\n\nBody\n"
)

var testRawBody = []byte{0x0d, 0x0a, 0x00, 0xff, 0x0a}

func writeTestFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

type migrateFixture struct {
	root string
}

func (f migrateFixture) project(slug, file string) string {
	return filepath.Join(f.root, "projects", slug, file)
}

func setupLegacyFixture(t *testing.T) migrateFixture {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	f := migrateFixture{root: filepath.Join(dir, "memory")}
	writeTestFile(t, filepath.Join(f.root, "global", "MEMORY.md"), []byte("## 工作\n- [用户偏好](legacy.md) — 从索引来\n"))
	legacyHeader := []byte("---\r\nname: 原名\r\ndescription: 旧说明\r\nmetadata:\r\n  type: feedback\r\n  node_type: memory\r\n  originSessionId: sample\r\n  modified: 2026-11-18\r\n---\r\n")
	writeTestFile(t, filepath.Join(f.root, "global", "legacy.md"), append(legacyHeader, testRawBody...))
	writeTestFile(t, filepath.Join(f.root, "global", "broken.md"), []byte("---\nname: [broken\n---\n\nKeep unchanged\n"))

	writeTestFile(t, f.project(testMemora, "MEMORY.md"), []byte("- [Keep](keep.md) — from the index\n- [Open](open-threads.md) — next step\n"))
	writeTestFile(t, f.project(testMemora, "keep.md"), []byte(testNote))
	writeTestFile(t, f.project(testMemora, "open-threads.md"), []byte(testNote))
	writeTestFile(t, f.project(testMemora, "archive/old.md"), []byte(testNote))
	writeTestFile(t, f.project(testMemora, "archive/indexed.md"), []byte(testNote))
	writeTestFile(t, f.project(testMemora, "archive/MEMORY.md"), []byte("- [Archived](indexed.md) — archive hook\n"))

	writeTestFile(t, f.project(testWorkspace, "MEMORY.md"), []byte("- [Chat](chrome-mcp-native-config.md) — catch-all index hook\n"))
	for _, file := range []string{"memora-release-expectations.md", "gpt-search-release-expectations.md", "chrome-mcp-native-config.md", "electric-bicycle-shopping.md"} {
		writeTestFile(t, f.project(testWorkspace, file), []byte(testNote))
	}
	writeTestFile(t, f.project(testProjects, "MEMORY.md"), []byte("- [Parity](memory-adapter-parity.md) — old adapter note\n"))
	writeTestFile(t, f.project(testProjects, "memory-adapter-parity.md"), []byte(testNote))
	return f
}

func readMigratedNote(t *testing.T, path string) (map[string]any, []byte) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	idx := bytes.Index(raw[4:], []byte("\n---\n"))
	if idx == -1 {
		t.Fatalf("missing closing delimiter in %s", path)
	}
	end := 4 + idx
	var fields map[string]any
	if err := yaml.Unmarshal(raw[4:end], &fields); err != nil {
		t.Fatal(err)
	}
	return fields, raw[end+5:]
}

func snapshotTree(t *testing.T, root string) []string {
	t.Helper()
	var items []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		if d.IsDir() {
			items = append(items, path+"=DIR")
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		items = append(items, path+"="+base64.StdEncoding.EncodeToString(raw))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(items)
	return items
}

func TestMigrationPlansRewritesAndMovesPreservesBytesAndRebuildsIndexes(t *testing.T) {
	f := setupLegacyFixture(t)
	var out, errBuf bytes.Buffer
	if err := runMigrate([]string{f.root}, &out, &errBuf); err != nil {
		t.Fatalf("migrate failed: %v\nstderr: %s", err, errBuf.String())
	}
	stdout := out.String()
	if !strings.Contains(stdout, "Notes normalized: 10\nFolders renamed: 1\nNotes rehomed: 5\nFiles left untouched: 1\n") {
		t.Fatalf("unexpected summary:\n%s", stdout)
	}
	if !strings.Contains(stdout, "global/broken.md: invalid YAML") {
		t.Fatalf("missing broken.md untouched report:\n%s", stdout)
	}

	legacyFields, legacyBody := readMigratedNote(t, filepath.Join(f.root, "global", "legacy.md"))
	wantLegacy := map[string]any{"name": "用户偏好", "description": "从索引来", "type": "feedback", "section": "工作"}
	if !reflect.DeepEqual(legacyFields, wantLegacy) || !bytes.Equal(legacyBody, testRawBody) {
		t.Fatalf("legacy.md mismatch: fields=%v body=%x", legacyFields, legacyBody)
	}

	brokenRaw, _ := os.ReadFile(filepath.Join(f.root, "global", "broken.md"))
	if string(brokenRaw) != "---\nname: [broken\n---\n\nKeep unchanged\n" {
		t.Fatalf("broken.md modified: %q", string(brokenRaw))
	}

	oldFields, oldBody := readMigratedNote(t, f.project("memora", "archive/old.md"))
	if !reflect.DeepEqual(oldFields, map[string]any{"name": "Original", "description": "Original hook", "type": "project"}) || string(oldBody) != "\nBody\n" {
		t.Fatalf("archive/old.md mismatch: %v %q", oldFields, string(oldBody))
	}
	idxFields, _ := readMigratedNote(t, f.project("memora", "archive/indexed.md"))
	if !reflect.DeepEqual(idxFields, map[string]any{"name": "Archived", "description": "archive hook", "type": "project"}) {
		t.Fatalf("archive/indexed.md mismatch: %v", idxFields)
	}
	parityFields, _ := readMigratedNote(t, f.project("memora", "archive/memory-adapter-parity.md"))
	if !reflect.DeepEqual(parityFields, map[string]any{"name": "Parity", "description": "old adapter note", "type": "project"}) {
		t.Fatalf("parity mismatch: %v", parityFields)
	}
	nowFields, _ := readMigratedNote(t, f.project("memora", "NOW.md"))
	if !reflect.DeepEqual(nowFields, map[string]any{"name": "现在做到哪", "description": "next step", "type": "project"}) {
		t.Fatalf("NOW.md mismatch: %v", nowFields)
	}

	projIndex, _ := os.ReadFile(f.project("memora", "MEMORY.md"))
	wantProjIndex := "- [现在做到哪](NOW.md) — next step\n- [Keep](keep.md) — from the index\n- [Original](memora-release-expectations.md) — Original hook\n"
	if string(projIndex) != wantProjIndex {
		t.Fatalf("memora MEMORY.md mismatch:\ngot:\n%s\nwant:\n%s", string(projIndex), wantProjIndex)
	}

	globalIndex, _ := os.ReadFile(filepath.Join(f.root, "global", "MEMORY.md"))
	wantGlobalIndex := "## 工作\n- [用户偏好](legacy.md) — 从索引来\n\n" +
		"## 工具\n- [Chat](chrome-mcp-native-config.md) — catch-all index hook\n- [Original](gpt-search-release-expectations.md) — Original hook\n\n" +
		"## 生活\n- [Original](electric-bicycle-shopping.md) — Original hook\n\n" +
		"## 未分类\n- [broken](broken.md) — Keep unchanged\n"
	if string(globalIndex) != wantGlobalIndex {
		t.Fatalf("global MEMORY.md mismatch:\ngot:\n%s\nwant:\n%s", string(globalIndex), wantGlobalIndex)
	}

	for _, old := range []string{testMemora, testWorkspace, testProjects} {
		if _, err := os.Stat(filepath.Join(f.root, "projects", old)); !os.IsNotExist(err) {
			t.Fatalf("expected old folder %s removed", old)
		}
	}
	if _, err := os.Stat(f.project("memora", "open-threads.md")); !os.IsNotExist(err) {
		t.Fatalf("expected open-threads.md removed")
	}
}

func TestMigrationPreflightFailuresLeaveFixtureUnchanged(t *testing.T) {
	cases := []struct {
		name    string
		path    string
		isDir   bool
		wantErr string
	}{
		{"unknown project", "projects/unexpected/note.md", false, "Unknown project folder"},
		{"rehoming clash", "global/chrome-mcp-native-config.md", false, "Destination already exists"},
		{"NOW.md clash", "projects/" + testMemora + "/NOW.md", false, "Destination already exists"},
		{"slug clash", "projects/memora", true, "Destination already exists"},
		{"unexpected catch-all file", "projects/" + testWorkspace + "/extra.md", false, "Unexpected catch-all entry"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := setupLegacyFixture(t)
			target := filepath.Join(f.root, tc.path)
			if tc.isDir {
				if err := os.MkdirAll(target, 0o755); err != nil {
					t.Fatal(err)
				}
			} else {
				writeTestFile(t, target, []byte(testNote))
			}
			before := snapshotTree(t, f.root)
			var out, errBuf bytes.Buffer
			err := runMigrate([]string{f.root}, &out, &errBuf)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tc.wantErr, err)
			}
			after := snapshotTree(t, f.root)
			if !slices.Equal(before, after) {
				t.Fatalf("fixture modified on preflight failure %s", tc.name)
			}
		})
	}
}
