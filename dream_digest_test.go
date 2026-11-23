package memora_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/klauspost/compress/zstd"
)

const (
	digestStamp = "2026-11-17T12:00:00"
	digestCwd   = "/example/CaseRepo"
)

func toJSONL(t *testing.T, rows []any) string {
	t.Helper()
	var b strings.Builder
	for _, r := range rows {
		raw, err := json.Marshal(r)
		if err != nil {
			t.Fatal(err)
		}
		b.Write(raw)
		b.WriteByte('\n')
	}
	return b.String()
}

func textPart(txt string) map[string]any {
	return map[string]any{"type": "text", "text": txt}
}

func piMsg(role string, content any, ts string) map[string]any {
	return map[string]any{
		"type":      "message",
		"timestamp": ts,
		"message":   map[string]any{"role": role, "content": content},
	}
}

func writeTranscript(t *testing.T, f testFixture, rel string, rows []any) string {
	t.Helper()
	p := filepath.Join(f.home, rel)
	src := []byte(toJSONL(t, rows))
	if strings.HasSuffix(rel, ".zstd") {
		enc, err := zstd.NewWriter(nil)
		if err != nil {
			t.Fatal(err)
		}
		src = enc.EncodeAll(src, nil)
		_ = enc.Close()
	}
	put(t, p, src)
	return p
}

func runDryDream(t *testing.T, f testFixture, extraArgs ...string) (cliResult, []string) {
	t.Helper()
	args := append([]string{"dream", "--root", f.root, "--dry-run"}, extraArgs...)
	res := runCLI(f, args, nil)
	if res.code != 0 {
		t.Fatalf("dry-run failed: %+v", res)
	}
	re := regexp.MustCompile(`(?m)^Digest: (.+)$`)
	m := re.FindStringSubmatch(res.out)
	if m == nil {
		t.Fatalf("missing Digest line in %q", res.out)
	}
	digestDir := m[1]
	entries, err := os.ReadDir(digestDir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "chunk-") && strings.HasSuffix(e.Name(), ".md") {
			names = append(names, e.Name())
		}
	}
	slices.Sort(names)
	chunks := make([]string, len(names))
	for i, name := range names {
		raw, err := os.ReadFile(filepath.Join(digestDir, name))
		if err != nil {
			t.Fatal(err)
		}
		chunks[i] = string(raw)
	}
	return res, chunks
}

func TestDreamExtractsVisibleTextFromThreeRealTranscriptShapes(t *testing.T) {
	f := newFixture(t)
	putStr(t, filepath.Join(f.root, "projects", "CaseRepo", "MEMORY.md"), "")
	header := map[string]any{"type": "session", "cwd": digestCwd, "timestamp": digestStamp}

	piPath := writeTranscript(t, f, ".pi/agent/sessions/test/a.jsonl", []any{
		header,
		piMsg("user", "Too early", "2026-11-16T23:59:59"),
		piMsg("user", []any{textPart("Pi user <system-reminder>hidden\ntext</system-reminder> stays"), map[string]any{"type": "image", "text": "Hidden image"}}, digestStamp),
		piMsg("toolResult", []any{textPart("Hidden tool result")}, digestStamp),
		piMsg("assistant", []any{
			textPart("Pi answer\n\n## Heading\n\nStill the Pi answer"),
			map[string]any{"type": "thinking", "text": "Hidden thinking"},
			map[string]any{"type": "toolCall", "text": "Hidden tool call"},
		}, digestStamp),
		piMsg("user", "Pi string message", digestStamp),
		piMsg("user", strings.Repeat("x", 2010), digestStamp),
	})
	writeTranscript(t, f, ".pi/agent/sessions/test/tmp.jsonl", []any{
		map[string]any{"type": "session", "cwd": "/private/tmp/run", "timestamp": digestStamp},
		piMsg("user", "Hidden tmp", digestStamp),
	})
	writeTranscript(t, f, ".pi/agent/sessions/test/tmp2.jsonl", []any{
		map[string]any{"type": "session", "cwd": "/tmp/run", "timestamp": digestStamp},
		piMsg("user", "Hidden tmp", digestStamp),
	})
	writeTranscript(t, f, ".pi/agent/sessions/test/worker.jsonl", []any{
		header,
		piMsg("user", `<file name="brief">`, digestStamp),
		piMsg("assistant", []any{textPart("Hidden worker")}, digestStamp),
	})

	parsedBase, err := time.Parse(time.RFC3339, digestStamp+"Z")
	if err != nil {
		t.Fatal(err)
	}
	dshTime := parsedBase.UnixMilli() + 1000
	dshRows := []any{
		map[string]any{"type": "session", "cwd": digestCwd, "createdAt": dshTime},
		map[string]any{"type": "system/message", "time": dshTime, "data": map[string]any{"content": []any{textPart("Hidden system")}}},
		map[string]any{"type": "user/message", "time": dshTime, "data": map[string]any{"source": map[string]any{"kind": "agent-instructions"}, "content": []any{textPart("Hidden injected instructions")}}},
		map[string]any{"type": "user/message", "time": dshTime, "data": map[string]any{"source": map[string]any{"kind": "user"}, "content": []any{textPart("DSH user")}}},
		map[string]any{"type": "assistant/message", "time": dshTime, "data": map[string]any{"message": map[string]any{"content": []any{textPart("DSH answer"), map[string]any{"type": "tool-call", "text": "Hidden DSH call"}}}}},
	}
	writeTranscript(t, f, ".dsh/sessions/test/main/session.v4.jsonl.zstd", dshRows)
	subHeader := map[string]any{"type": "session", "cwd": digestCwd, "createdAt": dshTime, "origin": "subagent"}
	writeTranscript(t, f, ".dsh/sessions/test/sub/session.v4.jsonl.zstd", append([]any{subHeader}, dshRows[1:]...))

	claudeMsg := func(typ string, content any, extra map[string]any) map[string]any {
		m := map[string]any{
			"type":      typ,
			"cwd":       digestCwd,
			"timestamp": "2026-11-17T12:00:02",
			"message":   map[string]any{"content": content},
		}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}
	human := map[string]any{"origin": map[string]any{"kind": "human"}}
	writeTranscript(t, f, ".claude/projects/test/main.jsonl", []any{
		map[string]any{"type": "file-history-snapshot"},
		claudeMsg("user", "<task-notification>Hidden task</task-notification>", map[string]any{"origin": map[string]any{"kind": "task-notification"}}),
		claudeMsg("user", "This session is being continued from a previous conversation. Hidden summary.", map[string]any{"isCompactSummary": true}),
		claudeMsg("user", "<command-name>/compact</command-name>", nil),
		claudeMsg("user", "<local-command-stdout>Hidden output</local-command-stdout>", nil),
		claudeMsg("user", "Claude user <system-reminder>Hidden reminder</system-reminder>", human),
		claudeMsg("user", []any{textPart("Claude parts"), map[string]any{"type": "tool_result", "content": "Hidden result"}}, human),
		claudeMsg("user", "Hidden human sidechain", map[string]any{"origin": map[string]any{"kind": "human"}, "isSidechain": true}),
		claudeMsg("assistant", []any{textPart("Hidden sidechain")}, map[string]any{"isSidechain": true}),
		claudeMsg("assistant", []any{textPart("Claude answer")}, nil),
	})
	writeTranscript(t, f, ".claude/projects/test/subagents/sub.jsonl", []any{
		claudeMsg("user", "Hidden subfolder", human),
	})

	before, err := os.ReadFile(piPath)
	if err != nil {
		t.Fatal(err)
	}
	res, chunks := runDryDream(t, f, "--since", "2026-11-17")
	if !strings.Contains(res.out, "Sessions: pi 1, DeepSeek Harness 1, Claude Code 1") {
		t.Fatalf("unexpected sessions line: %s", res.out)
	}
	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}
	digest := chunks[0]
	wantPrefix := "Sessions start with a line \"=== session: host | start | cwd | project ===\".\n\n"
	if !strings.HasPrefix(digest, wantPrefix) {
		t.Fatalf("missing preamble in %q", digest[:min(len(digest), 120)])
	}
	sessionHeaders := regexp.MustCompile(`(?m)^=== session:.* ===$`).FindAllString(digest, -1)
	if len(sessionHeaders) != 3 ||
		sessionHeaders[0] != "=== session: pi | 2026-11-17 12:00:00 | /example/CaseRepo | CaseRepo ===" ||
		!strings.Contains(sessionHeaders[1], "DeepSeek Harness") ||
		!strings.Contains(sessionHeaders[2], "Claude Code") {
		t.Fatalf("unexpected session headers: %#v", sessionHeaders)
	}
	if !strings.Contains(digest, "**Assistant:**\n\nPi answer\n\n## Heading\n\nStill the Pi answer\n\n**User:**\n\nPi string message") {
		t.Fatalf("missing formatted assistant/user block in digest")
	}
	for _, msg := range []string{"Pi user  stays", "Pi answer", "Pi string message", "DSH user", "DSH answer", "Claude user", "Claude parts", "Claude answer"} {
		if !strings.Contains(digest, msg) {
			t.Fatalf("missing expected text %q in digest", msg)
		}
	}
	forbidden := regexp.MustCompile(`Hidden|Too early|system-reminder|<command-name>`)
	if m := forbidden.FindString(digest); m != "" {
		t.Fatalf("found forbidden text %q in digest", m)
	}
	if strings.Contains(digest, strings.Repeat("x", 2001)) {
		t.Fatalf("found untruncated x{2001} in digest")
	}
	if !strings.Contains(digest, "[truncated]") {
		t.Fatalf("expected [truncated] marker")
	}
	after, _ := os.ReadFile(piPath)
	if string(after) != string(before) {
		t.Fatalf("transcript file modified")
	}
	if _, err := os.Stat(filepath.Join(f.root, ".dream", "cursor.json")); !os.IsNotExist(err) {
		t.Fatalf("expected cursor.json not to exist after dry-run")
	}
}

func TestDreamChunkSplittingBetweenTurns(t *testing.T) {
	f := newFixture(t)
	specs := []struct {
		label string
		count int
		hour  int
	}{
		{"alpha", 100, 12},
		{"beta", 100, 13},
		{"large", 160, 14},
	}
	for _, sp := range specs {
		ts := fmt.Sprintf("2026-11-17T%02d:00:00", sp.hour)
		rows := make([]any, 0, sp.count+1)
		rows = append(rows, map[string]any{"type": "session", "cwd": digestCwd, "timestamp": ts})
		for i := 0; i < sp.count; i++ {
			rows = append(rows, piMsg("user", []any{textPart(fmt.Sprintf("%s-%d %s", sp.label, i, strings.Repeat("a", 1970)))}, ts))
		}
		writeTranscript(t, f, fmt.Sprintf(".pi/agent/sessions/test/%s.jsonl", sp.label), rows)
	}
	res, chunks := runDryDream(t, f, "--since", "2026-11-17")
	if len(chunks) != 4 {
		t.Fatalf("expected 4 chunks, got %d", len(chunks))
	}
	userRe := regexp.MustCompile(`\*\*User:\*\*`)
	var counts []int
	totalChars := 0
	for i, ch := range chunks {
		counts = append(counts, len(userRe.FindAllString(ch, -1)))
		if len(ch) > 300_000 {
			t.Fatalf("chunk %d exceeds 300k: %d", i, len(ch))
		}
		totalChars += len(ch)
	}
	if !slices.Equal(counts, []int{100, 100, 150, 10}) {
		t.Fatalf("unexpected user turn counts across chunks: %v", counts)
	}
	wantStarts := []string{"12:00:00", "13:00:00", "14:00:00", "14:00:00"}
	for i, start := range wantStarts {
		lines := strings.SplitN(chunks[i], "\n", 4)
		if lines[0] != `Sessions start with a line "=== session: host | start | cwd | project ===".` ||
			lines[1] != "" ||
			lines[2] != fmt.Sprintf("=== session: pi | 2026-11-17 %s | %s | global ===", start, digestCwd) {
			t.Fatalf("unexpected header in chunk %d: %#v", i, lines[:3])
		}
	}
	if !strings.Contains(res.out, fmt.Sprintf("%d characters, 4 chunks", totalChars)) {
		t.Fatalf("unexpected size summary: %s", res.out)
	}
}
