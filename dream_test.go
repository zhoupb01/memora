package memora_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/zhoupb01/memora"
)

const dreamTestTime = "2026-11-17T12:00:00Z"

func dreamLine(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw) + "\n"
}

func dreamUserMsg(t *testing.T, txt string) string {
	t.Helper()
	return dreamLine(t, map[string]any{
		"type":      "message",
		"timestamp": dreamTestTime,
		"message": map[string]any{
			"role":    "user",
			"content": []any{map[string]any{"type": "text", "text": txt}},
		},
	})
}

func dreamNote(name string) string {
	return fmt.Sprintf("---\nname: %s\ndescription: hook\ntype: user\nsection: Work\n---\nBody\n", name)
}

type dreamSetup struct {
	testFixture
	path   string
	cursor string
}

func newDreamSetup(t *testing.T) dreamSetup {
	t.Helper()
	f := newFixture(t)
	p := filepath.Join(f.home, ".pi", "agent", "sessions", "project", "session.jsonl")
	header := dreamLine(t, map[string]any{"type": "session", "timestamp": dreamTestTime, "cwd": "/example/work"})
	putStr(t, p, header+dreamUserMsg(t, "Already there"))
	cursor := filepath.Join(f.root, ".dream", "cursor.json")
	return dreamSetup{testFixture: f, path: p, cursor: cursor}
}

func (s dreamSetup) invoke(runner memora.Runner, opts memora.DreamOptions) (string, string, error) {
	opts.Root = s.root
	var out, errBuf bytes.Buffer
	err := memora.Dream(opts, runner, s.home, &out, &errBuf)
	return out.String(), errBuf.String(), err
}

func appendStr(t *testing.T, path, text string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.WriteString(text); err != nil {
		t.Fatal(err)
	}
}

func readPromptChunk(t *testing.T, prompt string) string {
	t.Helper()
	m := regexp.MustCompile(`(?m)^Chunk: (.+)$`).FindStringSubmatch(prompt)
	if m == nil {
		t.Fatalf("missing Chunk path in prompt")
	}
	raw, err := os.ReadFile(m[1])
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func noCallRunner(_ memora.ModelRequest) (string, error) {
	return "", errors.New("Unexpected model call")
}

func readCursorMap(t *testing.T, path string) memora.Cursor {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var c memora.Cursor
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func TestDreamFirstRunBaselineAndIncrementalSync(t *testing.T) {
	s := newDreamSetup(t)
	first := runCLI(s.testFixture, []string{"dream", "--root", s.root}, nil)
	if first.code != 0 || !strings.Contains(first.out, "Cursor initialized: 1 transcripts") {
		t.Fatalf("unexpected first dream: %+v", first)
	}
	if got := readCursorMap(t, s.cursor)[s.path].Records; got != 2 {
		t.Fatalf("expected 2 records, got %d", got)
	}

	appendStr(t, s.path, dreamUserMsg(t, "Appended"))
	_, _, err := s.invoke(func(req memora.ModelRequest) (string, error) {
		if req.Model != "sub2api/gpt-6.2-sol" {
			t.Fatalf("unexpected default model %q", req.Model)
		}
		ch := readPromptChunk(t, req.Prompt)
		if !strings.Contains(ch, "Appended") || strings.Contains(ch, "Already there") {
			t.Fatalf("unexpected chunk content: %s", ch)
		}
		putStr(t, filepath.Join(s.root, "global", "new.md"), dreamNote("New"))
		return "Saved note\nAdded new.md: supported by the user.", nil
	}, memora.DreamOptions{})
	if err != nil {
		t.Fatal(err)
	}
	idx, err := os.ReadFile(filepath.Join(s.root, "global", "MEMORY.md"))
	if err != nil || !strings.Contains(string(idx), "[New](new.md)") {
		t.Fatalf("expected [New](new.md) in global MEMORY.md, got %q (%v)", string(idx), err)
	}
	if got := readCursorMap(t, s.cursor)[s.path].Records; got != 3 {
		t.Fatalf("expected 3 records, got %d", got)
	}
	before, _ := os.ReadFile(s.cursor)
	if _, _, err := s.invoke(noCallRunner, memora.DreamOptions{}); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(s.cursor)
	if string(after) != string(before) {
		t.Fatalf("cursor changed unexpectedly")
	}
}

func TestDreamEmptyDigestSavesNewToolRecordsAndSkipsUnchangedStat(t *testing.T) {
	s := newDreamSetup(t)
	if _, _, err := s.invoke(noCallRunner, memora.DreamOptions{}); err != nil {
		t.Fatal(err)
	}
	appendStr(t, s.path, dreamLine(t, map[string]any{"type": "message", "timestamp": dreamTestTime, "message": map[string]any{"role": "toolResult"}}))
	fixedTime, _ := time.Parse(time.RFC3339, dreamTestTime)
	if err := os.Chtimes(s.path, fixedTime, fixedTime); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(s.path)
	size := info.Size()
	mtime := float64(info.ModTime().UnixNano()) / 1e6

	res := runCLI(s.testFixture, []string{"dream", "--root", s.root}, nil)
	if res.code != 0 || !strings.Contains(res.out, "nothing new") {
		t.Fatalf("unexpected dream result: %+v", res)
	}
	gotState := readCursorMap(t, s.cursor)[s.path]
	if gotState != (memora.FileState{Size: size, Mtime: mtime, Records: 3}) {
		t.Fatalf("unexpected cursor state: %+v", gotState)
	}

	// Same stat, invalid JSONL: the next run fails if it reads the file again.
	putStr(t, s.path, strings.Repeat("x", int(size)-1)+"\n")
	if err := os.Chtimes(s.path, fixedTime, fixedTime); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.invoke(noCallRunner, memora.DreamOptions{}); err != nil {
		t.Fatalf("expected unchanged file to be skipped, got error: %v", err)
	}
	if readCursorMap(t, s.cursor)[s.path].Records != 3 {
		t.Fatalf("expected cursor records still 3")
	}
}

func TestDreamUnchangedStatSkipsReadingAndSinceBypassesCursor(t *testing.T) {
	s := newDreamSetup(t)
	bad := filepath.Join(filepath.Dir(s.path), "unreadable.jsonl")
	putStr(t, bad, "invalid JSONL\n")
	info, _ := os.Stat(bad)
	rawCursor, _ := json.Marshal(memora.Cursor{
		bad: {Size: info.Size(), Mtime: float64(info.ModTime().UnixNano()) / 1e6, Records: 1},
	})
	put(t, s.cursor, rawCursor)

	_, _, err := s.invoke(func(req memora.ModelRequest) (string, error) {
		if !strings.Contains(readPromptChunk(t, req.Prompt), "Already there") {
			t.Fatalf("expected Already there in chunk")
		}
		return "Read session", nil
	}, memora.DreamOptions{})
	if err != nil {
		t.Fatal(err)
	}

	_, _, err = s.invoke(noCallRunner, memora.DreamOptions{Since: strPtr("2026-11-17"), DryRun: true})
	if err == nil || !strings.Contains(err.Error(), "invalid JSONL") {
		t.Fatalf("expected invalid JSONL error, got %v", err)
	}
	_ = os.Remove(bad)

	before, _ := os.ReadFile(s.cursor)
	dry := runCLI(s.testFixture, []string{"dream", "--root", s.root, "--dry-run", "--since", "2026-11-17"}, nil)
	if dry.code != 0 || !strings.Contains(dry.out, "Sessions: pi 1") {
		t.Fatalf("unexpected dry run: %+v", dry)
	}
	afterDry, _ := os.ReadFile(s.cursor)
	if string(afterDry) != string(before) {
		t.Fatalf("dry-run modified cursor")
	}

	_, _, err = s.invoke(func(req memora.ModelRequest) (string, error) {
		if req.Model != "test/model" {
			t.Fatalf("expected test/model, got %q", req.Model)
		}
		if !strings.Contains(readPromptChunk(t, req.Prompt), "Already there") {
			t.Fatalf("expected Already there")
		}
		return "Replayed session", nil
	}, memora.DreamOptions{Since: strPtr("2026-11-17"), Model: strPtr("test/model")})
	if err != nil {
		t.Fatal(err)
	}
	cur := readCursorMap(t, s.cursor)
	if len(cur) != 1 {
		t.Fatalf("expected 1 cursor key, got %v", cur)
	}
	if _, ok := cur[s.path]; !ok {
		t.Fatalf("expected %s in cursor", s.path)
	}
}

func TestDreamFailedChunkKeepsDigestAndCursorAndRetriesInOrder(t *testing.T) {
	s := newDreamSetup(t)
	if _, _, err := s.invoke(noCallRunner, memora.DreamOptions{}); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(s.cursor)
	for i := 0; i < 153; i++ {
		appendStr(t, s.path, dreamUserMsg(t, fmt.Sprintf("%d: %s", i, strings.Repeat("x", 2000))))
	}
	calls := 0
	_, _, err := s.invoke(func(req memora.ModelRequest) (string, error) {
		calls++
		ch := readPromptChunk(t, req.Prompt)
		if calls == 1 {
			if !strings.Contains(ch, "0: xxx") {
				t.Fatalf("chunk 1 missing 0: xxx")
			}
			return "First chunk done", nil
		}
		if !strings.Contains(ch, "152: xxx") {
			t.Fatalf("chunk 2 missing 152: xxx")
		}
		return "", errors.New("test failure")
	}, memora.DreamOptions{})
	if err == nil || !regexp.MustCompile(`(?s)Dream chunk 2/2 failed: test failure.*Digest: .*\.dream/digest-`).MatchString(err.Error()) {
		t.Fatalf("unexpected error: %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected 2 calls, got %d", calls)
	}
	afterFail, _ := os.ReadFile(s.cursor)
	if string(afterFail) != string(before) {
		t.Fatalf("cursor changed on failure")
	}

	dreamDir := filepath.Dir(s.cursor)
	chunks, _ := filepath.Glob(filepath.Join(dreamDir, "digest-*", "chunk-*.md"))
	if len(chunks) != 2 {
		t.Fatalf("expected 2 chunk files, got %v", chunks)
	}
	reports, _ := filepath.Glob(filepath.Join(dreamDir, "digest-*", "report-*.md"))
	if len(reports) != 1 || !strings.HasSuffix(reports[0], "/report-000001.md") {
		t.Fatalf("unexpected reports: %v", reports)
	}
	rep1, _ := os.ReadFile(reports[0])
	if string(rep1) != "First chunk done\n" {
		t.Fatalf("unexpected report content: %q", string(rep1))
	}

	calls = 0
	_, _, err = s.invoke(func(req memora.ModelRequest) (string, error) {
		ch := readPromptChunk(t, req.Prompt)
		want := "0: xxx"
		if calls > 0 {
			want = "152: xxx"
		}
		calls++
		if !strings.Contains(ch, want) {
			t.Fatalf("missing %q in retry chunk", want)
		}
		return "Processed chunk", nil
	}, memora.DreamOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || readCursorMap(t, s.cursor)[s.path].Records != 155 {
		t.Fatalf("unexpected retry state: calls=%d, records=%d", calls, readCursorMap(t, s.cursor)[s.path].Records)
	}
}

func TestDreamSyncFailureNamesDigestAndKeepsAllModelReports(t *testing.T) {
	s := newDreamSetup(t)
	if _, _, err := s.invoke(noCallRunner, memora.DreamOptions{}); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(s.cursor)
	for i := 0; i < 153; i++ {
		appendStr(t, s.path, dreamUserMsg(t, fmt.Sprintf("%d: %s", i, strings.Repeat("x", 2000))))
	}
	var digestDir string
	calls := 0
	_, _, err := s.invoke(func(req memora.ModelRequest) (string, error) {
		m := regexp.MustCompile(`(?m)^Chunk: (.+)$`).FindStringSubmatch(req.Prompt)
		digestDir = filepath.Dir(m[1])
		calls++
		if calls == 2 {
			rep1, err := os.ReadFile(filepath.Join(digestDir, "report-000001.md"))
			if err != nil || string(rep1) != "Report 1\n" {
				t.Fatalf("expected Report 1 saved before chunk 2, got %q (%v)", string(rep1), err)
			}
			index := filepath.Join(s.root, "global", "MEMORY.md")
			_ = os.Remove(index)
			putStr(t, filepath.Join(index, "blocker"), "")
		}
		return fmt.Sprintf("Report %d", calls), nil
	}, memora.DreamOptions{})
	if err == nil || !regexp.MustCompile(`(?s)is a directory.*Digest: .*\.dream/digest-`).MatchString(err.Error()) {
		t.Fatalf("unexpected error: %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected 2 calls, got %d", calls)
	}
	rep2, err := os.ReadFile(filepath.Join(digestDir, "report-000002.md"))
	if err != nil || string(rep2) != "Report 2\n" {
		t.Fatalf("expected Report 2 saved, got %q (%v)", string(rep2), err)
	}
	afterFail, _ := os.ReadFile(s.cursor)
	if string(afterFail) != string(before) {
		t.Fatalf("cursor changed on sync failure")
	}
}

func TestDreamLockRefusesLiveAndTakesOverDeadPID(t *testing.T) {
	s := newDreamSetup(t)
	lock := filepath.Join(s.root, ".dream", "lock")
	myPID := fmt.Sprintf("%d\n", os.Getpid())
	putStr(t, lock, myPID)
	args := []string{"dream", "--root", s.root, "--dry-run"}

	live := runCLI(s.testFixture, args, nil)
	if live.code == 0 || !strings.Contains(live.err, fmt.Sprintf("Dream lock is held by PID %d", os.Getpid())) {
		t.Fatalf("expected live lock error, got %+v", live)
	}
	lockBytes, _ := os.ReadFile(lock)
	if string(lockBytes) != myPID {
		t.Fatalf("lock file mutated: %q", string(lockBytes))
	}
	entries, _ := os.ReadDir(filepath.Dir(lock))
	if len(entries) != 1 || entries[0].Name() != "lock" {
		t.Fatalf("unexpected files in .dream: %v", entries)
	}

	child := exec.Command("sh", "-c", "echo $$")
	out, err := child.Output()
	if err != nil {
		t.Fatal(err)
	}
	put(t, lock, out)
	dead := runCLI(s.testFixture, args, nil)
	if dead.code != 0 {
		t.Fatalf("expected dead PID lock takeover, got %+v", dead)
	}
	afterBytes, _ := os.ReadFile(lock)
	if string(afterBytes) != "" {
		t.Fatalf("expected empty lock file after release, got %q", string(afterBytes))
	}
	if _, err := os.Stat(s.cursor); !os.IsNotExist(err) {
		t.Fatalf("expected cursor not to exist after dry-run")
	}
}

func TestDreamCommitsOnlyNotesAndIndexes(t *testing.T) {
	for _, ignore := range []string{".dream/", "no ignore rules"} {
		t.Run(ignore, func(t *testing.T) {
			s := newDreamSetup(t)
			repo := filepath.Dir(s.root)
			git := func(args ...string) string {
				return runGitFixture(t, s.testFixture, repo, nil, append([]string{"-c", "user.name=Test", "-c", "user.email=test@example.test"}, args...)...)
			}
			global := filepath.Join(s.root, "global")
			putStr(t, filepath.Join(global, "delete.md"), dreamNote("Delete"))
			putStr(t, filepath.Join(global, "archive.md"), dreamNote("Archive"))
			putStr(t, filepath.Join(global, "edit.md"), dreamNote("Edit"))
			putStr(t, filepath.Join(repo, "outside.txt"), "Before")
			if ignore == ".dream/" {
				putStr(t, filepath.Join(repo, ".gitignore"), ".dream/\n")
			}
			git("init", "--quiet")
			git("config", "user.name", "Test")
			git("config", "user.email", "test@example.test")
			empty := ""
			tree := runGitFixture(t, s.testFixture, repo, &empty, "mktree")
			base := git("commit-tree", tree, "-m", "Initialize fixture")
			git("update-ref", "HEAD", base)

			if _, _, err := s.invoke(noCallRunner, memora.DreamOptions{}); err != nil {
				t.Fatal(err)
			}
			appendStr(t, s.path, dreamUserMsg(t, "Commit initial notes"))
			if _, _, err := s.invoke(func(_ memora.ModelRequest) (string, error) { return "Initial memory", nil }, memora.DreamOptions{}); err != nil {
				t.Fatal(err)
			}
			initial := git("rev-parse", "HEAD")
			gi, _ := os.ReadFile(filepath.Join(s.root, ".dream", ".gitignore"))
			if string(gi) != "*\n" {
				t.Fatalf("unexpected .dream/.gitignore: %q", string(gi))
			}
			initialFiles := strings.Split(git("ls-tree", "-r", "--name-only", initial), "\n")
			slices.Sort(initialFiles)
			wantInitial := []string{
				"memory/global/MEMORY.md",
				"memory/global/archive.md",
				"memory/global/delete.md",
				"memory/global/edit.md",
			}
			if !slices.Equal(initialFiles, wantInitial) {
				t.Fatalf("initial committed files mismatch: got %v, want %v", initialFiles, wantInitial)
			}

			putStr(t, filepath.Join(repo, "outside.txt"), "Must not commit")
			blob := git("hash-object", "-w", "outside.txt")
			git("update-index", "--add", "--cacheinfo", fmt.Sprintf("100644,%s,outside.txt", blob))

			appendStr(t, s.path, dreamUserMsg(t, "Change notes"))
			out, _, err := s.invoke(func(req memora.ModelRequest) (string, error) {
				if req.Root != s.root ||
					!strings.Contains(req.Prompt, "Memory root: "+s.root) ||
					!strings.Contains(req.Prompt, "# Shared memory") ||
					!strings.Contains(req.Prompt, "Project folders:") {
					t.Fatalf("unexpected prompt fields")
				}
				archiveDest := filepath.Join(global, "archive", "archive.md")
				if err := os.MkdirAll(filepath.Dir(archiveDest), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.Rename(filepath.Join(global, "archive.md"), archiveDest); err != nil {
					t.Fatal(err)
				}
				if err := os.Remove(filepath.Join(global, "delete.md")); err != nil {
					t.Fatal(err)
				}
				putStr(t, filepath.Join(global, "edit.md"), dreamNote("Changed"))
				putStr(t, filepath.Join(global, "add.md"), dreamNote("Added"))
				return "Curated notes\nMoved archive.md.", nil
			}, memora.DreamOptions{})
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(out, "Notes: 1 added, 1 changed, 1 moved, 1 deleted") {
				t.Fatalf("unexpected dream output:\n%s", out)
			}
			subject := git("log", "-1", "--format=%s")
			if !regexp.MustCompile(`^dream \d{4}-\d{2}-\d{2}: Curated notes$`).MatchString(subject) {
				t.Fatalf("unexpected commit subject: %q", subject)
			}
			diffLines := strings.Split(git("diff", "--name-status", "-M100%", initial, "HEAD"), "\n")
			slices.Sort(diffLines)
			wantDiff := []string{
				"A\tmemory/global/add.md",
				"D\tmemory/global/delete.md",
				"M\tmemory/global/MEMORY.md",
				"M\tmemory/global/edit.md",
				"R100\tmemory/global/archive.md\tmemory/global/archive/archive.md",
			}
			if !slices.Equal(diffLines, wantDiff) {
				t.Fatalf("diff mismatch:\ngot:  %v\nwant: %v", diffLines, wantDiff)
			}
			if cached := git("diff", "--cached", "--name-only"); cached != "outside.txt" {
				t.Fatalf("expected outside.txt still staged, got %q", cached)
			}

			commit := git("rev-parse", "HEAD")
			appendStr(t, s.path, dreamUserMsg(t, "No edits this time"))
			if _, _, err := s.invoke(func(_ memora.ModelRequest) (string, error) { return "No change", nil }, memora.DreamOptions{}); err != nil {
				t.Fatal(err)
			}
			if got := git("rev-parse", "HEAD"); got != commit {
				t.Fatalf("expected HEAD unchanged when no files changed")
			}
		})
	}
}
