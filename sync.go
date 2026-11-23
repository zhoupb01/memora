package memora

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"unicode/utf8"
)

const (
	uncategorizedSection = "未分类"
	maxDescriptionChars  = 150
	maxIndexLines        = 200
)

func randomSuffix() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func writeAtomic(path string, content []byte, perm os.FileMode) error {
	suffix, err := randomSuffix()
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	base := filepath.Base(path)
	temp := filepath.Join(dir, fmt.Sprintf(".%s.%s.tmp", base, suffix))
	f, err := os.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, perm)
	if err != nil {
		return err
	}
	defer func() {
		_ = os.Remove(temp)
	}()
	if _, err := f.Write(content); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(temp, path)
}

type orderedSet struct {
	items []string
	seen  map[string]bool
}

func newOrderedSet(initial ...string) *orderedSet {
	s := &orderedSet{seen: make(map[string]bool, len(initial))}
	for _, item := range initial {
		s.add(item)
	}
	return s
}

func (s *orderedSet) add(item string) {
	if !s.seen[item] {
		s.seen[item] = true
		s.items = append(s.items, item)
	}
}

func (s *orderedSet) moveToEnd(item string) {
	if s.seen[item] {
		s.items = slices.DeleteFunc(s.items, func(v string) bool { return v == item })
		s.items = append(s.items, item)
	} else {
		s.add(item)
	}
}

func SyncIndexes(root string, stdout, stderr io.Writer) error {
	written := 0
	unchanged := 0
	warnings := 0
	warn := func(path, issue string) {
		warnings++
		_, _ = fmt.Fprintf(stderr, "%s: %s\n", path, issue)
	}

	type renderedNote struct {
		line  string
		group string
	}

	syncFolder := func(folder string, global bool) error {
		files, err := NoteFiles(folder)
		if err != nil {
			return err
		}
		if !global && len(files) == 0 {
			return nil
		}
		index := filepath.Join(folder, IndexFileName)
		previous, err := ReadIndex(index)
		if err != nil {
			return err
		}
		sections := newOrderedSet(previous.Sections...)
		notes := make(map[string]renderedNote, len(files))

		for _, file := range files {
			path := filepath.Join(folder, file)
			note, err := ReadNote(path)
			if err != nil {
				return err
			}
			var nameVal, descVal, typeVal, secVal any
			if note.Fields != nil {
				nameVal = note.Fields["name"]
				descVal = note.Fields["description"]
				typeVal = note.Fields["type"]
				secVal = note.Fields["section"]
			}
			group := uncategorizedSection
			if sec, ok := OneLine(secVal); ok {
				group = sec
			}
			sections.add(group)

			name, okName := OneLine(nameVal)
			desc, okDesc := OneLine(descVal)
			typStr, _ := typeVal.(string)
			validType := slices.Contains(NoteTypes, typStr)

			if note.Issue == "" && okName && okDesc && validType {
				if utf8.RuneCountInString(desc) > maxDescriptionChars {
					warn(path, fmt.Sprintf("description exceeds %d characters", maxDescriptionChars))
				}
				notes[file] = renderedNote{
					line:  fmt.Sprintf("- [%s](%s) — %s", name, file, desc),
					group: group,
				}
				continue
			}

			var missing []string
			if !okName {
				missing = append(missing, "name")
			}
			if !okDesc {
				missing = append(missing, "description")
			}
			if !validType {
				missing = append(missing, "type")
			}
			issue := note.Issue
			if issue == "" {
				issue = "missing or invalid frontmatter: " + strings.Join(missing, ", ")
			}
			warn(path, issue)

			firstLine := ""
			for _, l := range splitLines(string(note.Body)) {
				trimmed := strings.TrimSpace(l)
				if trimmed != "" {
					firstLine = trimmed
					break
				}
			}
			runes := []rune(firstLine)
			if len(runes) > maxDescriptionChars {
				runes = runes[:maxDescriptionChars]
			}
			base := strings.TrimSuffix(file, ".md")
			notes[file] = renderedNote{
				line:  fmt.Sprintf("- [%s](%s) — %s", base, file, string(runes)),
				group: group,
			}
		}

		order := newOrderedSet()
		if !global {
			order.add(NowFileName)
		}
		for _, f := range previous.EntryOrder {
			order.add(f)
		}
		for _, f := range files {
			order.add(f)
		}

		ordered := make([]renderedNote, 0, len(notes))
		for _, f := range order.items {
			if n, ok := notes[f]; ok {
				ordered = append(ordered, n)
			}
		}

		var lines []string
		if global {
			sections.moveToEnd(uncategorizedSection)
			groups := map[string][]renderedNote{}
			for _, n := range ordered {
				groups[n.group] = append(groups[n.group], n)
			}
			for _, sec := range sections.items {
				entries := groups[sec]
				if len(entries) == 0 {
					continue
				}
				if len(lines) > 0 {
					lines = append(lines, "")
				}
				lines = append(lines, "## "+sec)
				for _, n := range entries {
					lines = append(lines, n.line)
				}
			}
		} else {
			for _, n := range ordered {
				lines = append(lines, n.line)
			}
		}

		content := ""
		if len(lines) > 0 {
			content = strings.Join(lines, "\n") + "\n"
		}
		if len(lines) > maxIndexLines {
			warn(index, fmt.Sprintf("index exceeds %d lines (%d)", maxIndexLines, len(lines)))
		}
		if previous.Exists && content == previous.Content {
			unchanged++
			return nil
		}

		if err := os.MkdirAll(folder, 0o755); err != nil {
			return err
		}
		if err := writeAtomic(index, []byte(content), 0o666); err != nil {
			return err
		}
		written++
		return nil
	}

	if err := syncFolder(filepath.Join(root, "global"), true); err != nil {
		return err
	}
	projectsDir := filepath.Join(root, "projects")
	entries, err := FolderEntries(projectsDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			if err := syncFolder(filepath.Join(projectsDir, entry.Name()), false); err != nil {
				return err
			}
		}
	}
	_, _ = fmt.Fprintf(stdout, "Indexes: %d written, %d unchanged; %d warnings\n", written, unchanged, warnings)
	return nil
}
