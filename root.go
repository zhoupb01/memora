package memora

import (
	"os"
	"path/filepath"
	"strings"
)

func userHomeDir() (string, error) {
	if h := os.Getenv("HOME"); h != "" {
		return h, nil
	}
	return os.UserHomeDir()
}

func ResolveMemoryRoot(directory *string) (string, error) {
	override := os.Getenv("MEMORA_DIR")
	var selected string
	hasSelected := false
	if directory != nil {
		selected = *directory
		hasSelected = true
	} else if strings.TrimSpace(override) != "" {
		selected = override
		hasSelected = true
	}
	if !hasSelected {
		home, err := userHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Abs(filepath.Join(home, ".agents", "memory"))
	}
	if selected == "~" || strings.HasPrefix(selected, "~/") || strings.HasPrefix(selected, `~\`) {
		home, err := userHomeDir()
		if err != nil {
			return "", err
		}
		rest := ""
		if len(selected) > 2 {
			rest = strings.ReplaceAll(selected[2:], `\`, string(filepath.Separator))
		}
		return filepath.Abs(filepath.Join(home, rest))
	}
	return filepath.Abs(selected)
}
