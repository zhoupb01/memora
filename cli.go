package memora

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

const Usage = "Usage: memora sync [--root <dir>]\n" +
	"       memora resolve [dir] [--json] [--root <dir>]\n" +
	"       memora dream [--since <YYYY-MM-DD>] [--dry-run] [--model <id>] [--root <dir>]"

type optionKind int

const (
	optString optionKind = iota
	optBool
)

type parsedArgs struct {
	strings     map[string]*string
	bools       map[string]bool
	positionals []string
}

func parseCLIArgs(args []string, spec map[string]optionKind, allowPositionals bool) (parsedArgs, error) {
	res := parsedArgs{
		strings: map[string]*string{},
		bools:   map[string]bool{},
	}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			rest := args[i+1:]
			if len(rest) > 0 && !allowPositionals {
				return res, fmt.Errorf("Unexpected argument %q", rest[0])
			}
			res.positionals = append(res.positionals, rest...)
			break
		}
		if strings.HasPrefix(arg, "--") {
			name := arg[2:]
			var inlineVal *string
			if eq := strings.IndexByte(name, '='); eq != -1 {
				v := name[eq+1:]
				name = name[:eq]
				inlineVal = &v
			}
			kind, ok := spec[name]
			if !ok {
				return res, fmt.Errorf("Unknown option '--%s'", name)
			}
			if kind == optBool {
				if inlineVal != nil {
					return res, fmt.Errorf("Option '--%s' does not take an argument", name)
				}
				res.bools[name] = true
			} else {
				if inlineVal != nil {
					v := *inlineVal
					res.strings[name] = &v
				} else {
					if i+1 >= len(args) {
						return res, fmt.Errorf("Option '--%s' argument missing", name)
					}
					i++
					v := args[i]
					res.strings[name] = &v
				}
			}
			continue
		}
		if strings.HasPrefix(arg, "-") && len(arg) > 1 {
			return res, fmt.Errorf("Unknown option '%s'", arg)
		}
		if !allowPositionals {
			return res, fmt.Errorf("Unexpected argument %q", arg)
		}
		res.positionals = append(res.positionals, arg)
	}
	return res, nil
}

func RunCLI(args []string, stdout, stderr io.Writer) int {
	if err := runCommand(args, stdout, stderr); err != nil {
		_, _ = fmt.Fprintln(stderr, err.Error())
		return 1
	}
	return 0
}

func runCommand(args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		return errors.New(Usage)
	}
	command, rest := args[0], args[1:]
	switch command {
	case "sync":
		parsed, err := parseCLIArgs(rest, map[string]optionKind{"root": optString}, false)
		if err != nil {
			return err
		}
		root, err := ResolveMemoryRoot(parsed.strings["root"])
		if err != nil {
			return err
		}
		return SyncIndexes(root, stdout, stderr)

	case "resolve":
		parsed, err := parseCLIArgs(rest, map[string]optionKind{"root": optString, "json": optBool}, true)
		if err != nil {
			return err
		}
		if len(parsed.positionals) > 1 {
			return errors.New("resolve accepts at most one directory")
		}
		root, err := ResolveMemoryRoot(parsed.strings["root"])
		if err != nil {
			return err
		}
		dir := ""
		if len(parsed.positionals) == 1 {
			dir = parsed.positionals[0]
		}
		result, err := ResolveProject(root, dir)
		if err != nil {
			return err
		}
		if parsed.bools["json"] {
			var buf bytes.Buffer
			enc := json.NewEncoder(&buf)
			enc.SetEscapeHTML(false)
			if err := enc.Encode(result); err != nil {
				return err
			}
			_, _ = stdout.Write(buf.Bytes())
		} else if result.Folder != nil {
			_, _ = fmt.Fprintln(stdout, *result.Folder)
		}
		return nil

	case "dream":
		parsed, err := parseCLIArgs(rest, map[string]optionKind{
			"root":    optString,
			"since":   optString,
			"dry-run": optBool,
			"model":   optString,
		}, false)
		if err != nil {
			return err
		}
		root, err := ResolveMemoryRoot(parsed.strings["root"])
		if err != nil {
			return err
		}
		return Dream(DreamOptions{
			Root:   root,
			Since:  parsed.strings["since"],
			DryRun: parsed.bools["dry-run"],
			Model:  parsed.strings["model"],
		}, nil, "", stdout, stderr)

	default:
		return errors.New(Usage)
	}
}
