package memora

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/klauspost/compress/zstd"
)

type Host string

const (
	HostPi     Host = "pi"
	HostDSH    Host = "DeepSeek Harness"
	HostClaude Host = "Claude Code"
)

var hostOrder = []Host{HostPi, HostDSH, HostClaude}

var hostSources = map[Host][]string{
	HostPi:     {".pi", "agent", "sessions", "*", "*.jsonl"},
	HostDSH:    {".dsh", "sessions", "*", "*", "session.v4.jsonl.zstd"},
	HostClaude: {".claude", "projects", "*", "*.jsonl"},
}

type Turn struct {
	Role string
	Text string
}

type Session struct {
	Host     Host
	Cwd      string
	Start    int64
	HasStart bool
	Turns    []Turn
}

type FileState struct {
	Size    int64   `json:"size"`
	Mtime   float64 `json:"mtime"`
	Records int     `json:"records"`
}

type Cursor map[string]FileState

type TranscriptCollection struct {
	Sessions []Session
	Cursor   Cursor
	Totals   map[Host]int
}

var (
	systemReminderRe = regexp.MustCompile(`(?s)<system-reminder\b[^>]*>.*?</system-reminder>`)
	zstdOnce         sync.Once
	zstdDecoder      *zstd.Decoder
	zstdInitErr      error
)

func decodeZstd(raw []byte) ([]byte, error) {
	zstdOnce.Do(func() {
		zstdDecoder, zstdInitErr = zstd.NewReader(nil)
	})
	if zstdInitErr != nil {
		return nil, zstdInitErr
	}
	return zstdDecoder.DecodeAll(raw, nil)
}

func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

func truncateUTF16(s string, maxUnits int) string {
	n := 0
	for i, r := range s {
		w := 1
		if r >= 0x10000 {
			w = 2
		}
		if n+w > maxUnits {
			return s[:i]
		}
		n += w
	}
	return s
}

func statMtimeMs(info os.FileInfo) float64 {
	return float64(info.ModTime().UnixNano()) / 1e6
}

func parseTimestamp(raw json.RawMessage) (int64, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, false
	}
	var num float64
	if err := json.Unmarshal(raw, &num); err == nil {
		return int64(num), true
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil || s == "" {
		return 0, false
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.999999999-0700"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UnixMilli(), true
		}
	}
	for _, layout := range []string{"2006-01-02T15:04:05.999999999", "2006-01-02 15:04:05.999999999", "2006-01-02"} {
		if t, err := time.ParseInLocation(layout, s, time.Local); err == nil {
			return t.UnixMilli(), true
		}
	}
	return 0, false
}

type transcriptPart struct {
	Type string  `json:"type"`
	Text *string `json:"text"`
}

type transcriptMsg struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type transcriptRecord struct {
	Type        string          `json:"type"`
	Cwd         string          `json:"cwd"`
	Origin      json.RawMessage `json:"origin"`
	Timestamp   json.RawMessage `json:"timestamp"`
	Time        json.RawMessage `json:"time"`
	CreatedAt   json.RawMessage `json:"createdAt"`
	IsSidechain bool            `json:"isSidechain"`
	IsMeta      bool            `json:"isMeta"`
	Message     *transcriptMsg  `json:"message"`
	Data        *struct {
		Content json.RawMessage `json:"content"`
		Message *struct {
			Content json.RawMessage `json:"content"`
		} `json:"message"`
		Source *struct {
			Kind string `json:"kind"`
		} `json:"source"`
	} `json:"data"`
}

func originString(raw json.RawMessage) string {
	var s string
	if len(raw) > 0 && json.Unmarshal(raw, &s) == nil {
		return s
	}
	return ""
}

func originKind(raw json.RawMessage) string {
	var obj struct {
		Kind string `json:"kind"`
	}
	if len(raw) > 0 && raw[0] == '{' && json.Unmarshal(raw, &obj) == nil {
		return obj.Kind
	}
	return ""
}

func conversation(host Host, row transcriptRecord) (string, json.RawMessage, bool) {
	switch host {
	case HostPi:
		if row.Type == "message" && row.Message != nil {
			return row.Message.Role, row.Message.Content, true
		}
	case HostDSH:
		if row.Type == "user/message" && row.Data != nil && row.Data.Source != nil && row.Data.Source.Kind == "user" {
			return "user", row.Data.Content, true
		}
		if row.Type == "assistant/message" && row.Data != nil && row.Data.Message != nil {
			return "assistant", row.Data.Message.Content, true
		}
	case HostClaude:
		if !row.IsSidechain && !row.IsMeta && row.Message != nil {
			if row.Type == "assistant" || (row.Type == "user" && originKind(row.Origin) == "human") {
				return row.Type, row.Message.Content, true
			}
		}
	}
	return "", nil, false
}

func visibleText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var parts []transcriptPart
	if err := json.Unmarshal(raw, &parts); err == nil {
		var out []string
		for _, p := range parts {
			if p.Type == "text" && p.Text != nil {
				out = append(out, *p.Text)
			}
		}
		return strings.Join(out, "\n")
	}
	return ""
}

func inspectTranscript(host Host, path string, after int, afterInfinite bool, since *int64) (int, *Session, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, nil, err
	}
	if host == HostDSH {
		raw, err = decodeZstd(raw)
		if err != nil {
			return 0, nil, fmt.Errorf("%s: %w", path, err)
		}
	}
	input := string(raw)
	records := 0
	cwd := ""
	var start int64
	hasStart := false
	skip := false
	firstUser := true
	var turns []Turn

	for pos := 0; pos < len(input); {
		nl := strings.IndexByte(input[pos:], '\n')
		var line string
		atEndWithoutNewline := false
		if nl == -1 {
			line = input[pos:]
			pos = len(input)
			atEndWithoutNewline = true
		} else {
			line = input[pos : pos+nl]
			pos += nl + 1
		}
		if strings.TrimSpace(line) == "" {
			continue
		}
		var row transcriptRecord
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			if atEndWithoutNewline {
				break
			}
			return 0, nil, fmt.Errorf("%s: invalid JSONL record %d", path, records+1)
		}
		records++
		if skip || afterInfinite {
			continue
		}
		if host != HostClaude && records == 1 && row.Type == "session" {
			cwd = row.Cwd
			tsRaw := row.Timestamp
			if len(tsRaw) == 0 {
				tsRaw = row.CreatedAt
			}
			start, hasStart = parseTimestamp(tsRaw)
			skip = host == HostDSH && originString(row.Origin) == "subagent"
		}
		role, content, ok := conversation(host, row)
		if !ok || (role != "user" && role != "assistant") {
			continue
		}
		tsRaw := row.Time
		if len(tsRaw) == 0 {
			tsRaw = row.Timestamp
		}
		msgTime, hasMsgTime := parseTimestamp(tsRaw)
		if cwd == "" && row.Cwd != "" {
			cwd = row.Cwd
		}
		if !hasStart && hasMsgTime {
			start = msgTime
			hasStart = true
		}
		visible := visibleText(content)
		text := visible
		if role == "user" {
			text = systemReminderRe.ReplaceAllString(visible, "")
		}
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		if role == "user" && firstUser {
			firstUser = false
			if strings.HasPrefix(text, "<file name=") {
				skip = true
				continue
			}
		}
		if since == nil {
			if records <= after {
				continue
			}
		} else if !hasMsgTime || msgTime < *since {
			continue
		}
		const cut = "\n[truncated]"
		if utf16Len(text) > 2000 {
			text = truncateUTF16(text, 2000-len(cut)) + cut
		}
		turns = append(turns, Turn{Role: role, Text: text})
	}

	directory := ""
	if cwd != "" {
		if abs, err := filepath.Abs(cwd); err == nil {
			directory = abs
		}
	}
	sep := string(filepath.Separator)
	temporary := false
	for _, prefix := range []string{"/tmp", "/private/tmp"} {
		if directory == prefix || strings.HasPrefix(directory, prefix+sep) {
			temporary = true
			break
		}
	}
	if !skip && !temporary && len(turns) > 0 {
		return records, &Session{
			Host:     host,
			Cwd:      directory,
			Start:    start,
			HasStart: hasStart,
			Turns:    turns,
		}, nil
	}
	return records, nil, nil
}

func scanPattern(root string, segments []string) ([]string, error) {
	current := []string{root}
	for idx, seg := range segments {
		last := idx == len(segments)-1
		var next []string
		for _, dir := range current {
			if !strings.ContainsAny(seg, "*?[") {
				candidate := filepath.Join(dir, seg)
				info, err := os.Lstat(candidate)
				if err != nil {
					continue
				}
				if last {
					if info.Mode().IsRegular() {
						next = append(next, candidate)
					}
				} else if info.IsDir() {
					next = append(next, candidate)
				}
				continue
			}
			entries, err := os.ReadDir(dir)
			if err != nil {
				continue
			}
			for _, entry := range entries {
				matched, err := filepath.Match(seg, entry.Name())
				if err != nil || !matched {
					continue
				}
				candidate := filepath.Join(dir, entry.Name())
				if last {
					if entry.Type().IsRegular() {
						next = append(next, candidate)
					}
				} else if entry.IsDir() {
					next = append(next, candidate)
				}
			}
		}
		current = next
		if len(current) == 0 {
			break
		}
	}
	slices.Sort(current)
	return current, nil
}

func CollectTranscripts(home string, previous Cursor, since *int64) (TranscriptCollection, error) {
	cursor := Cursor{}
	var sessions []Session
	totals := map[Host]int{
		HostPi:     0,
		HostDSH:    0,
		HostClaude: 0,
	}
	for _, host := range hostOrder {
		paths, err := scanPattern(home, hostSources[host])
		if err != nil {
			return TranscriptCollection{}, err
		}
		for _, path := range paths {
			info, err := os.Stat(path)
			if err != nil {
				return TranscriptCollection{}, err
			}
			size := info.Size()
			mtime := statMtimeMs(info)
			last, hadLast := previous[path]
			if since == nil && hadLast && last.Size == size && last.Mtime == mtime {
				cursor[path] = last
				continue
			}
			afterInfinite := since == nil && previous == nil
			after := 0
			if hadLast {
				after = last.Records
			}
			records, session, err := inspectTranscript(host, path, after, afterInfinite, since)
			if err != nil {
				return TranscriptCollection{}, err
			}
			cursor[path] = FileState{Size: size, Mtime: mtime, Records: records}
			if session != nil {
				totals[host]++
				sessions = append(sessions, *session)
			}
		}
	}
	slices.SortStableFunc(sessions, func(a, b Session) int {
		sa, sb := int64(0), int64(0)
		if a.HasStart {
			sa = a.Start
		}
		if b.HasStart {
			sb = b.Start
		}
		if sa < sb {
			return -1
		}
		if sa > sb {
			return 1
		}
		return 0
	})
	return TranscriptCollection{Sessions: sessions, Cursor: cursor, Totals: totals}, nil
}
