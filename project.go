package memora

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type ProjectResolution struct {
	Slug   *string `json:"slug"`
	Folder *string `json:"folder"`
	Exists bool    `json:"exists"`
}

func ResolveProject(root string, directory string) (ProjectResolution, error) {
	cwd, err := filepath.Abs(directory)
	if err != nil {
		return ProjectResolution{}, err
	}
	out, gitErr := exec.Command("git", "-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir").Output()
	if gitErr == nil {
		commonDir := filepath.Clean(strings.TrimRight(string(out), "\r\n"))
		slug := filepath.Base(filepath.Dir(commonDir))
		folder := filepath.Join(root, "projects", slug)
		info, statErr := os.Stat(folder)
		exists := statErr == nil && info.IsDir()
		return ProjectResolution{Slug: &slug, Folder: &folder, Exists: exists}, nil
	}

	homeDir, err := userHomeDir()
	if err != nil {
		return ProjectResolution{}, err
	}
	home, err := filepath.Abs(homeDir)
	if err != nil {
		return ProjectResolution{}, err
	}
	for ancestor := cwd; ancestor != home && filepath.Dir(ancestor) != ancestor; ancestor = filepath.Dir(ancestor) {
		slug := filepath.Base(ancestor)
		folder := filepath.Join(root, "projects", slug)
		if info, statErr := os.Stat(folder); statErr == nil && info.IsDir() {
			return ProjectResolution{Slug: &slug, Folder: &folder, Exists: true}, nil
		}
	}
	return ProjectResolution{}, nil
}
