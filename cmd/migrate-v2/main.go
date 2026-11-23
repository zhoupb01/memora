package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/zhoupb01/memora"
	"go.yaml.in/yaml/v3"
)

const legacyPrefix = "-Users-zhoupb-Documents-"
const openThreadsFile = "open-threads.md"

func legacyProjectSlugs() map[string]string {
	m := map[string]string{
		"Pi":                        "Pi",
		"esp32-lab":                 "esp32-lab",
		"github-reverse-skill":      "reverse-skill",
		"huahua-materials":          "huahua-materials",
		"kilimall-business-finance": "business-finance",
		"kilimall-finance-projects": "finance-projects",
		"kilimall-games":            "kilimall-games",
		"kilimall-ir-2026-10":       "kilimall-ir-2026-10",
		"kiro-wacky-ideas":          "kiro-wacky-ideas",
		"stocks":                    "stocks",
		"tietie-materials":          "tietie-materials",
		"wx-kit":                    "wx-kit",
	}
	for _, slug := range []string{
		"NotchClip", "hoku", "kili-clip-ai", "kili-finance", "kili-pulse", "kinoshell", "memora", "monopoly-3d",
		"moonparlor", "obol", "peer-drop", "sitetraffic", "tietie", "unidroid", "zhoupb-blog",
	} {
		m["projects-"+slug] = slug
	}
	return m
}

type catchAllRule struct {
	file    string
	folder  []string
	section string
}

func catchAllRules() map[string][]catchAllRule {
	memoraFolder := []string{"projects", "memora"}
	return map[string][]catchAllRule{
		legacyPrefix + "deepseek-harness-default-workspace": {
			{file: "memora-release-expectations.md", folder: memoraFolder},
			{file: "gpt-search-release-expectations.md", folder: []string{"global"}, section: "工具"},
			{file: "chrome-mcp-native-config.md", folder: []string{"global"}, section: "工具"},
			{file: "electric-bicycle-shopping.md", folder: []string{"global"}, section: "生活"},
		},
		legacyPrefix + "projects": {
			{file: "memory-adapter-parity.md", folder: []string{"projects", "memora", "archive"}},
		},
	}
}

type moveOp struct {
	source      string
	destination string
}

type writeOp struct {
	path     string
	contents []byte
}

type untouchedFile struct {
	path  string
	issue string
}

type migrationPlan struct {
	writes         []writeOp
	untouched      []untouchedFile
	renamedFolders []moveOp
	rehomedNotes   []moveOp
	renamedNow     []moveOp
	removedFolders []string
}

func requireFree(path, futurePath string) error {
	if _, err := os.Lstat(path); err == nil {
		return fmt.Errorf("Destination already exists: %s", futurePath)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func formatYAMLField(key string, val any) (string, error) {
	if val == nil {
		return "", nil
	}
	raw, err := yaml.Marshal(map[string]any{key: val})
	if err != nil {
		return "", err
	}
	s := string(raw)
	if strings.Count(s, "\n") == 1 {
		return s, nil
	}
	if str, ok := val.(string); ok {
		return fmt.Sprintf("%s: %s\n", key, strconv.Quote(str)), nil
	}
	return s, nil
}

func stringifyFrontmatter(name, description, typ, section any) ([]byte, error) {
	var buf bytes.Buffer
	for _, pair := range []struct {
		k string
		v any
	}{
		{"name", name},
		{"description", description},
		{"type", typ},
		{"section", section},
	} {
		line, err := formatYAMLField(pair.k, pair.v)
		if err != nil {
			return nil, err
		}
		buf.WriteString(line)
	}
	return buf.Bytes(), nil
}

func planMigration(root string) (migrationPlan, error) {
	global := filepath.Join(root, "global")
	projects := filepath.Join(root, "projects")
	slugs := legacyProjectSlugs()
	catchAll := catchAllRules()

	var plan migrationPlan
	oldBySlug := map[string]string{}

	entries, err := memora.FolderEntries(projects)
	if err != nil {
		return plan, err
	}
	var folders []os.DirEntry
	for _, entry := range entries {
		if entry.IsDir() {
			folders = append(folders, entry)
		}
	}

	for _, f := range folders {
		name := f.Name()
		if _, isCatchAll := catchAll[name]; isCatchAll {
			continue
		}
		var slug string
		if strings.HasPrefix(name, legacyPrefix) {
			slug = slugs[name[len(legacyPrefix):]]
		}
		if slug == "" {
			return plan, fmt.Errorf("Unknown project folder: %s", filepath.Join(projects, name))
		}
		source := filepath.Join(projects, name)
		destination := filepath.Join(projects, slug)
		if err := requireFree(destination, destination); err != nil {
			return plan, err
		}
		oldBySlug[slug] = source
		plan.renamedFolders = append(plan.renamedFolders, moveOp{source: source, destination: destination})
	}

	normalize := func(path string, override memora.IndexEntry, hasSection bool) error {
		note, err := memora.ReadNote(path)
		if err != nil {
			return err
		}
		if note.Fields == nil {
			rel, _ := filepath.Rel(root, path)
			plan.untouched = append(plan.untouched, untouchedFile{path: filepath.ToSlash(rel), issue: note.Issue})
			return nil
		}
		name := note.Fields["name"]
		if override.Name != "" {
			name = override.Name
		}
		desc := note.Fields["description"]
		if override.Description != "" {
			desc = override.Description
		}
		typ := note.Fields["type"]
		if typ == nil {
			if meta, ok := note.Fields["metadata"].(map[string]any); ok {
				typ = meta["type"]
			}
		}
		var sec any
		if hasSection && override.Section != "" {
			sec = override.Section
		}
		fm, err := stringifyFrontmatter(name, desc, typ, sec)
		if err != nil {
			return err
		}
		var out bytes.Buffer
		out.WriteString("---\n")
		out.Write(fm)
		out.WriteString("---\n")
		out.Write(note.Body)
		plan.writes = append(plan.writes, writeOp{path: path, contents: out.Bytes()})
		return nil
	}

	normalizeFolder := func(folder string, globalNotes bool, destination string) error {
		parsed, err := memora.ReadIndex(filepath.Join(folder, memora.IndexFileName))
		if err != nil {
			return err
		}
		normalizeNotes := func(directory string) error {
			local := parsed.Entries
			if directory != folder {
				subParsed, err := memora.ReadIndex(filepath.Join(directory, memora.IndexFileName))
				if err != nil {
					return err
				}
				local = subParsed.Entries
			}
			files, err := memora.NoteFiles(directory)
			if err != nil {
				return err
			}
			for _, file := range files {
				path := filepath.Join(directory, file)
				entry := local[file]
				if directory == folder && destination != "" && file == openThreadsFile {
					if err := requireFree(filepath.Join(folder, memora.NowFileName), filepath.Join(destination, memora.NowFileName)); err != nil {
						return err
					}
					plan.renamedNow = append(plan.renamedNow, moveOp{
						source:      filepath.Join(destination, file),
						destination: filepath.Join(destination, memora.NowFileName),
					})
					entry.Name = "现在做到哪"
				}
				if globalNotes {
					rel, _ := filepath.Rel(folder, path)
					entry.Section = parsed.Entries[filepath.ToSlash(rel)].Section
				} else {
					entry.Section = ""
				}
				if err := normalize(path, entry, globalNotes); err != nil {
					return err
				}
			}
			return nil
		}
		var walkArchive func(directory string) error
		walkArchive = func(directory string) error {
			if err := normalizeNotes(directory); err != nil {
				return err
			}
			subEntries, err := memora.FolderEntries(directory)
			if err != nil {
				return err
			}
			for _, sub := range subEntries {
				if sub.IsDir() {
					if err := walkArchive(filepath.Join(directory, sub.Name())); err != nil {
						return err
					}
				}
			}
			return nil
		}
		if err := normalizeNotes(folder); err != nil {
			return err
		}
		return walkArchive(filepath.Join(folder, "archive"))
	}

	if err := normalizeFolder(global, true, ""); err != nil {
		return plan, err
	}
	for _, m := range plan.renamedFolders {
		if err := normalizeFolder(m.source, false, m.destination); err != nil {
			return plan, err
		}
	}

	for _, f := range folders {
		name := f.Name()
		rules, ok := catchAll[name]
		if !ok {
			continue
		}
		folder := filepath.Join(projects, name)
		parsed, err := memora.ReadIndex(filepath.Join(folder, memora.IndexFileName))
		if err != nil {
			return plan, err
		}
		contents, err := memora.FolderEntries(folder)
		if err != nil {
			return plan, err
		}
		for _, entry := range contents {
			inRules := slices.ContainsFunc(rules, func(r catchAllRule) bool { return r.file == entry.Name() })
			if !entry.Type().IsRegular() || (entry.Name() != memora.IndexFileName && !inRules) {
				return plan, fmt.Errorf("Unexpected catch-all entry: %s", filepath.Join(folder, entry.Name()))
			}
		}
		for _, rule := range rules {
			source := filepath.Join(folder, rule.file)
			exists := slices.ContainsFunc(contents, func(e os.DirEntry) bool { return e.Name() == rule.file })
			if !exists {
				return plan, fmt.Errorf("Missing catch-all note: %s", source)
			}
			destParts := append([]string{root}, rule.folder...)
			destParts = append(destParts, rule.file)
			destination := filepath.Join(destParts...)
			if rule.folder[0] == "projects" {
				old, hasOld := oldBySlug[rule.folder[1]]
				if !hasOld {
					return plan, fmt.Errorf("Missing destination project: %s", filepath.Join(root, rule.folder[0], rule.folder[1]))
				}
				oldParts := append([]string{old}, rule.folder[2:]...)
				oldParts = append(oldParts, rule.file)
				if err := requireFree(filepath.Join(oldParts...), destination); err != nil {
					return plan, err
				}
			} else {
				if err := requireFree(destination, destination); err != nil {
					return plan, err
				}
			}
			entry := parsed.Entries[rule.file]
			entry.Section = rule.section
			if err := normalize(source, entry, rule.section != ""); err != nil {
				return plan, err
			}
			plan.rehomedNotes = append(plan.rehomedNotes, moveOp{source: source, destination: destination})
		}
		plan.removedFolders = append(plan.removedFolders, folder)
	}

	return plan, nil
}

func runMigrate(args []string, stdout, stderr io.Writer) error {
	if len(args) != 1 || strings.TrimSpace(args[0]) == "" {
		return errors.New("Usage: migrate-v2 <memory-root>")
	}
	arg := args[0]
	root, err := memora.ResolveMemoryRoot(&arg)
	if err != nil {
		return err
	}
	plan, err := planMigration(root)
	if err != nil {
		return err
	}
	for _, w := range plan.writes {
		if err := os.WriteFile(w.path, w.contents, 0o644); err != nil {
			return err
		}
	}
	for _, m := range plan.renamedFolders {
		if err := os.Rename(m.source, m.destination); err != nil {
			return err
		}
	}
	for _, m := range plan.rehomedNotes {
		if err := os.MkdirAll(filepath.Dir(m.destination), 0o755); err != nil {
			return err
		}
		if err := os.Rename(m.source, m.destination); err != nil {
			return err
		}
	}
	for _, m := range plan.renamedNow {
		if err := os.Rename(m.source, m.destination); err != nil {
			return err
		}
	}
	for _, folder := range plan.removedFolders {
		_ = os.Remove(filepath.Join(folder, memora.IndexFileName))
		if err := os.Remove(folder); err != nil {
			return err
		}
	}
	if err := memora.SyncIndexes(root, stdout, stderr); err != nil {
		return err
	}
	_, _ = fmt.Fprintf(stdout, "Notes normalized: %d\n", len(plan.writes))
	_, _ = fmt.Fprintf(stdout, "Folders renamed: %d\n", len(plan.renamedFolders))
	_, _ = fmt.Fprintf(stdout, "Notes rehomed: %d\n", len(plan.rehomedNotes))
	_, _ = fmt.Fprintf(stdout, "Files left untouched: %d\n", len(plan.untouched))
	for _, u := range plan.untouched {
		_, _ = fmt.Fprintf(stdout, "- %s: %s\n", u.path, u.issue)
	}
	return nil
}

func main() {
	if err := runMigrate(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}
