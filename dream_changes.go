package memora

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
)

const exactRenames = "-M100%"

type DreamCounts struct {
	Added   int
	Changed int
	Moved   int
	Deleted int
}

type DreamChangeResult struct {
	Counts DreamCounts
	Commit string
	Stat   string
}

func isNoteRelPath(rel string) bool {
	rel = filepath.ToSlash(rel)
	if !strings.HasPrefix(rel, "global/") && !strings.HasPrefix(rel, "projects/") {
		return false
	}
	return strings.HasSuffix(rel, ".md") && path.Base(rel) != IndexFileName
}

func runGit(root string, args []string, allowOutside bool) (string, bool, error) {
	cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err == nil {
		return stdout.String(), true, nil
	}
	errMsg := strings.TrimSpace(stderr.String())
	if allowOutside && strings.Contains(errMsg, "not a git repository") {
		return "", false, nil
	}
	if errMsg != "" {
		return "", false, fmt.Errorf("%s", errMsg)
	}
	exitCode := 1
	if cmd.ProcessState != nil {
		exitCode = cmd.ProcessState.ExitCode()
	}
	return "", false, fmt.Errorf("git %s exited with status %d", args[0], exitCode)
}

func snapshotNotes(root string) (map[string]string, error) {
	result := map[string]string{}
	var walk func(relDir string) error
	walk = func(relDir string) error {
		absDir := filepath.Join(root, relDir)
		files, err := NoteFiles(absDir)
		if err != nil {
			return err
		}
		for _, f := range files {
			relPath := filepath.ToSlash(filepath.Join(relDir, f))
			raw, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(relPath)))
			if err != nil {
				return err
			}
			sum := sha256.Sum256(raw)
			result[relPath] = hex.EncodeToString(sum[:])
		}
		entries, err := FolderEntries(absDir)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if entry.IsDir() {
				if err := walk(filepath.Join(relDir, entry.Name())); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := walk("global"); err != nil {
		return nil, err
	}
	if err := walk("projects"); err != nil {
		return nil, err
	}
	return result, nil
}

func compareNoteSnapshots(before, after map[string]string) DreamCounts {
	var counts DreamCounts
	removed := map[string]int{}
	for p, hash := range before {
		afterHash, exists := after[p]
		if !exists {
			counts.Deleted++
			removed[hash]++
		} else if afterHash != hash {
			counts.Changed++
		}
	}
	for p, hash := range after {
		if _, existed := before[p]; existed {
			continue
		}
		if matches := removed[hash]; matches > 0 {
			removed[hash] = matches - 1
			counts.Deleted--
			counts.Moved++
		} else {
			counts.Added++
		}
	}
	return counts
}

func TrackDreamChanges(root string) (func(summary string) (DreamChangeResult, error), error) {
	insideOut, ok, err := runGit(root, []string{"rev-parse", "--is-inside-work-tree"}, true)
	if err != nil {
		return nil, err
	}
	inGit := ok && strings.TrimSpace(insideOut) == "true"
	var before map[string]string
	if !inGit {
		before, err = snapshotNotes(root)
		if err != nil {
			return nil, err
		}
	}

	return func(summary string) (DreamChangeResult, error) {
		if !inGit {
			after, err := snapshotNotes(root)
			if err != nil {
				return DreamChangeResult{}, err
			}
			return DreamChangeResult{Counts: compareNoteSnapshots(before, after)}, nil
		}
		status, _, err := runGit(root, []string{"status", "--porcelain", "--untracked-files=all", "--", "."}, false)
		if err != nil {
			return DreamChangeResult{}, err
		}
		if status == "" {
			return DreamChangeResult{}, nil
		}
		if _, _, err := runGit(root, []string{"add", "-A", "--", "."}, false); err != nil {
			return DreamChangeResult{}, err
		}
		if _, _, err := runGit(root, []string{"commit", "--only", "-m", summary, "--", "."}, false); err != nil {
			return DreamChangeResult{}, err
		}
		commitOut, _, err := runGit(root, []string{"rev-parse", "HEAD"}, false)
		if err != nil {
			return DreamChangeResult{}, err
		}
		commit := strings.TrimSpace(commitOut)
		statOut, _, err := runGit(root, []string{"show", "--relative", "--format=", "--stat", exactRenames, commit, "--", "."}, false)
		if err != nil {
			return DreamChangeResult{}, err
		}
		stat := strings.TrimRight(statOut, " \t\r\n")
		nameStatus, _, err := runGit(root, []string{"show", "--relative", "--format=", "--name-status", "-z", exactRenames, commit, "--", "."}, false)
		if err != nil {
			return DreamChangeResult{}, err
		}
		entries := strings.Split(nameStatus, "\x00")
		var counts DreamCounts
		for i := 0; i < len(entries) && entries[i] != ""; {
			statusCode := entries[i][0]
			i++
			if i >= len(entries) {
				break
			}
			srcPath := entries[i]
			i++
			if statusCode == 'R' {
				if i >= len(entries) {
					break
				}
				dstPath := entries[i]
				i++
				if isNoteRelPath(srcPath) && isNoteRelPath(dstPath) {
					counts.Moved++
				} else if isNoteRelPath(srcPath) {
					counts.Deleted++
				} else if isNoteRelPath(dstPath) {
					counts.Added++
				}
			} else if isNoteRelPath(srcPath) {
				switch statusCode {
				case 'A':
					counts.Added++
				case 'D':
					counts.Deleted++
				default:
					counts.Changed++
				}
			}
		}
		return DreamChangeResult{Counts: counts, Commit: commit, Stat: stat}, nil
	}, nil
}
