package memora

import (
	"errors"
	"os"
	"regexp"
	"slices"
	"strings"
)

const (
	IndexFileName = "MEMORY.md"
	NowFileName   = "NOW.md"
)

type IndexEntry struct {
	Name        string
	Description string
	Section     string
}

type ParsedIndex struct {
	Content    string
	Exists     bool
	Sections   []string
	EntryOrder []string
	Entries    map[string]IndexEntry
}

var indexLinkRe = regexp.MustCompile(`^- \[(.+)\]\((.+\.md)\) — (.*)$`)

func FolderEntries(folder string) ([]os.DirEntry, error) {
	entries, err := os.ReadDir(folder)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	slices.SortFunc(entries, func(a, b os.DirEntry) int {
		return strings.Compare(a.Name(), b.Name())
	})
	return entries, nil
}

func NoteFiles(folder string) ([]string, error) {
	entries, err := FolderEntries(folder)
	if err != nil {
		return nil, err
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.Type().IsRegular() && strings.HasSuffix(entry.Name(), ".md") && entry.Name() != IndexFileName {
			files = append(files, entry.Name())
		}
	}
	return files, nil
}

func splitLines(s string) []string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.Split(s, "\n")
}

func ReadIndex(path string) (ParsedIndex, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ParsedIndex{Entries: map[string]IndexEntry{}}, nil
		}
		return ParsedIndex{}, err
	}
	content := string(raw)
	result := ParsedIndex{
		Content: content,
		Exists:  true,
		Entries: map[string]IndexEntry{},
	}
	sectionSeen := map[string]bool{}
	var currentSection string
	for _, line := range splitLines(content) {
		if strings.HasPrefix(line, "## ") {
			currentSection = line[3:]
			if !sectionSeen[currentSection] {
				sectionSeen[currentSection] = true
				result.Sections = append(result.Sections, currentSection)
			}
		} else if m := indexLinkRe.FindStringSubmatch(line); m != nil {
			file := m[2]
			if _, exists := result.Entries[file]; !exists {
				result.EntryOrder = append(result.EntryOrder, file)
				result.Entries[file] = IndexEntry{
					Name:        m[1],
					Description: m[3],
					Section:     currentSection,
				}
			}
		}
	}
	return result, nil
}
