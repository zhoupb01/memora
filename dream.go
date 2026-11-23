package memora

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

//go:embed DREAM.md
var embeddedDreamGuide string

//go:embed CONTRACT.md
var embeddedContract string

const DefaultDreamModel = "sub2api/gpt-6.2-sol"

type ModelRequest struct {
	Root   string
	Model  string
	Prompt string
}

type Runner func(req ModelRequest) (string, error)

type DreamOptions struct {
	Root   string
	Since  *string
	DryRun bool
	Model  *string
}

var sinceDateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func runPi(req ModelRequest) (string, error) {
	cmd := exec.Command(
		"pi", "-p", "--model", req.Model, "--thinking", "high",
		"--no-session", "--no-context-files", "--no-extensions", "--no-mcp",
		"--no-skills", "--no-prompt-templates", "--tools", "read,edit,write,bash",
		"--", req.Prompt,
	)
	cmd.Dir = req.Root
	cmd.Stdin = nil
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg != "" {
			return "", errors.New(msg)
		}
		exitCode := 1
		if cmd.ProcessState != nil {
			exitCode = cmd.ProcessState.ExitCode()
		}
		return "", fmt.Errorf("pi exited with status %d", exitCode)
	}
	return stdout.String(), nil
}

func saveCursor(path string, cursor Cursor) error {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(cursor); err != nil {
		return err
	}
	return writeAtomic(path, buf.Bytes(), 0o600)
}

func parseSince(since *string) (*int64, error) {
	if since == nil {
		return nil, nil
	}
	s := *since
	if !sinceDateRe.MatchString(s) {
		return nil, errors.New("--since must be a valid local date (YYYY-MM-DD)")
	}
	t, err := time.ParseInLocation("2006-01-02", s, time.Local)
	if err != nil || LocalDate(t) != s {
		return nil, errors.New("--since must be a valid local date (YYYY-MM-DD)")
	}
	ms := t.UnixMilli()
	return &ms, nil
}

func marshalCompactJSON(v any) (string, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return "", err
	}
	return strings.TrimSuffix(buf.String(), "\n"), nil
}

func Dream(opts DreamOptions, runner Runner, home string, stdout, stderr io.Writer) error {
	if runner == nil {
		runner = runPi
	}
	if home == "" {
		h, err := userHomeDir()
		if err != nil {
			return err
		}
		home = h
	}
	model := DefaultDreamModel
	if opts.Model != nil {
		model = *opts.Model
	}
	start, err := parseSince(opts.Since)
	if err != nil {
		return err
	}
	directory := filepath.Join(opts.Root, ".dream")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}

	return WithDreamLock(filepath.Join(directory, "lock"), func() error {
		if err := os.WriteFile(filepath.Join(directory, ".gitignore"), []byte("*\n"), 0o644); err != nil {
			return err
		}
		cursorPath := filepath.Join(directory, "cursor.json")
		var previous Cursor
		if start == nil {
			if raw, err := os.ReadFile(cursorPath); err == nil {
				previous = Cursor{}
				if err := json.Unmarshal(raw, &previous); err != nil {
					return err
				}
			} else if !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}

		collected, err := CollectTranscripts(home, previous, start)
		if err != nil {
			return err
		}
		digest, err := WriteDigest(opts.Root, directory, collected.Sessions)
		if err != nil {
			return err
		}

		_, _ = fmt.Fprintf(stdout, "Sessions: pi %d, DeepSeek Harness %d, Claude Code %d\n",
			collected.Totals[HostPi], collected.Totals[HostDSH], collected.Totals[HostClaude])
		count := len(digest.Chunks)
		chunkWord := "chunks"
		if count == 1 {
			chunkWord = "chunk"
		}
		_, _ = fmt.Fprintf(stdout, "Size: %d characters, %d %s\n", digest.Characters, count, chunkWord)
		_, _ = fmt.Fprintf(stdout, "Digest: %s\n", digest.Path)
		if opts.DryRun {
			return nil
		}

		runCurator := func() error {
			if count == 0 {
				if err := SyncIndexes(opts.Root, stdout, stderr); err != nil {
					return err
				}
				if err := saveCursor(cursorPath, collected.Cursor); err != nil {
					return err
				}
				if previous == nil && start == nil {
					_, _ = fmt.Fprintf(stdout, "Cursor initialized: %d transcripts\n", len(collected.Cursor))
				}
				_, _ = fmt.Fprintln(stdout, "nothing new")
				return nil
			}

			finish, err := TrackDreamChanges(opts.Root)
			if err != nil {
				return err
			}
			today := LocalDate(time.Now())
			reports := make([]string, 0, count)

			for i, chunk := range digest.Chunks {
				entries, err := FolderEntries(filepath.Join(opts.Root, "projects"))
				if err != nil {
					return err
				}
				projects := make([]string, 0, len(entries))
				for _, entry := range entries {
					if entry.IsDir() {
						projects = append(projects, entry.Name())
					}
				}
				projectsJSON, err := marshalCompactJSON(projects)
				if err != nil {
					return err
				}
				chunkProjects := chunk.Projects
				if chunkProjects == nil {
					chunkProjects = []string{}
				}
				chunkProjectsJSON, err := marshalCompactJSON(chunkProjects)
				if err != nil {
					return err
				}
				prompt := fmt.Sprintf(
					"%s\nMemory root: %s\nDate: %s\nProject folders: %s\nProjects in this chunk: %s\nChunk: %s\n\n%s",
					embeddedDreamGuide, opts.Root, today, projectsJSON, chunkProjectsJSON, chunk.File, embeddedContract,
				)
				rawReport, runErr := runner(ModelRequest{Root: opts.Root, Model: model, Prompt: prompt})
				if runErr != nil {
					return fmt.Errorf("Dream chunk %d/%d failed: %s", i+1, count, runErr.Error())
				}
				report := strings.TrimSpace(rawReport)
				if report == "" {
					return fmt.Errorf("Dream chunk %d/%d failed: pi returned no report", i+1, count)
				}
				reportFile := strings.Replace(filepath.Base(chunk.File), "chunk-", "report-", 1)
				if err := os.WriteFile(filepath.Join(digest.Path, reportFile), []byte(report+"\n"), 0o600); err != nil {
					return fmt.Errorf("Dream chunk %d/%d failed: %s", i+1, count, err.Error())
				}
				reports = append(reports, report)
			}

			if err := SyncIndexes(opts.Root, stdout, stderr); err != nil {
				return err
			}
			summary := splitLines(reports[len(reports)-1])[0]
			changeRes, err := finish(fmt.Sprintf("dream %s: %s", today, summary))
			if err != nil {
				return err
			}
			if err := saveCursor(cursorPath, collected.Cursor); err != nil {
				return err
			}
			_, _ = fmt.Fprintf(stdout, "Chunks run: %d\n", len(reports))
			_, _ = fmt.Fprintf(stdout, "Notes: %d added, %d changed, %d moved, %d deleted\n",
				changeRes.Counts.Added, changeRes.Counts.Changed, changeRes.Counts.Moved, changeRes.Counts.Deleted)
			commitLabel := changeRes.Commit
			if commitLabel == "" {
				commitLabel = "none"
			}
			_, _ = fmt.Fprintf(stdout, "Commit: %s\n", commitLabel)
			if changeRes.Stat != "" {
				_, _ = fmt.Fprintln(stdout, changeRes.Stat)
			}
			_, _ = fmt.Fprintln(stdout, strings.Join(reports, "\n\n"))
			return nil
		}

		if err := runCurator(); err != nil {
			return fmt.Errorf("%s\nDigest: %s", err.Error(), digest.Path)
		}
		return nil
	})
}
