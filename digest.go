package memora

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	sessionStart = "=== session:"
	sessionEnd   = " ==="
	preamble     = "Sessions start with a line \"=== session: host | start | cwd | project ===\".\n\n"
	digestLimit  = 300_000
)

type DigestChunk struct {
	File     string
	Projects []string
}

type Digest struct {
	Path       string
	Chunks     []DigestChunk
	Characters int
}

func LocalDate(t time.Time) string {
	t = t.In(time.Local)
	return fmt.Sprintf("%04d-%02d-%02d", t.Year(), int(t.Month()), t.Day())
}

func localTimestamp(ms int64, ok bool) string {
	if !ok {
		return "unknown time"
	}
	t := time.UnixMilli(ms).In(time.Local)
	return fmt.Sprintf("%s %02d:%02d:%02d", LocalDate(t), t.Hour(), t.Minute(), t.Second())
}

func WriteDigest(root string, directory string, sessions []Session) (Digest, error) {
	path, err := os.MkdirTemp(directory, "digest-")
	if err != nil {
		return Digest{}, err
	}
	var chunks []DigestChunk
	projects := map[string]*string{}
	chunkProjects := newOrderedSet()
	characters := 0
	chunk := ""
	chunkUnits := 0
	preambleUnits := utf16Len(preamble)

	flush := func() error {
		if chunk == "" {
			return nil
		}
		file := filepath.Join(path, fmt.Sprintf("chunk-%06d.md", len(chunks)+1))
		if err := os.WriteFile(file, []byte(chunk), 0o600); err != nil {
			return err
		}
		projList := make([]string, len(chunkProjects.items))
		copy(projList, chunkProjects.items)
		chunks = append(chunks, DigestChunk{File: file, Projects: projList})
		chunkProjects = newOrderedSet()
		characters += chunkUnits
		chunk = ""
		chunkUnits = 0
		return nil
	}

	for _, s := range sessions {
		if s.Cwd != "" {
			if _, cached := projects[s.Cwd]; !cached {
				res, err := ResolveProject(root, s.Cwd)
				if err != nil {
					return Digest{}, err
				}
				projects[s.Cwd] = res.Slug
			}
		}
		project := projects[s.Cwd]
		cwdLabel := s.Cwd
		if cwdLabel == "" {
			cwdLabel = "unknown cwd"
		}
		projectLabel := "global"
		if project != nil {
			projectLabel = *project
		}
		title := fmt.Sprintf("%s | %s | %s | %s", s.Host, localTimestamp(s.Start, s.HasStart), cwdLabel, projectLabel)
		escaped := strings.ReplaceAll(strings.ReplaceAll(title, "\r", `\r`), "\n", `\n`)
		header := fmt.Sprintf("%s %s%s\n\n", sessionStart, escaped, sessionEnd)
		headerUnits := utf16Len(header)

		type blockItem struct {
			text  string
			units int
		}
		blocks := make([]blockItem, len(s.Turns))
		size := headerUnits
		for i, turn := range s.Turns {
			speaker := "Assistant"
			if turn.Role == "user" {
				speaker = "User"
			}
			b := fmt.Sprintf("**%s:**\n\n%s\n\n", speaker, turn.Text)
			u := utf16Len(b)
			blocks[i] = blockItem{text: b, units: u}
			size += u
		}

		if chunkUnits+size > digestLimit {
			if err := flush(); err != nil {
				return Digest{}, err
			}
		}
		if chunk == "" {
			chunk = preamble + header
			chunkUnits = preambleUnits + headerUnits
		} else {
			chunk += header
			chunkUnits += headerUnits
		}
		for _, b := range blocks {
			if chunkUnits+b.units > digestLimit {
				if err := flush(); err != nil {
					return Digest{}, err
				}
				chunk = preamble + header
				chunkUnits = preambleUnits + headerUnits
			}
			if project != nil {
				chunkProjects.add(*project)
			}
			chunk += b.text
			chunkUnits += b.units
		}
	}
	if err := flush(); err != nil {
		return Digest{}, err
	}
	return Digest{Path: path, Chunks: chunks, Characters: characters}, nil
}
