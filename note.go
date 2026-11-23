package memora

import (
	"bytes"
	"fmt"
	"os"
	"strings"

	"go.yaml.in/yaml/v3"
)

var NoteTypes = []string{"user", "feedback", "project", "reference"}

type Note struct {
	Body   []byte
	Fields map[string]any
	Issue  string
}

func splitFrontmatter(raw []byte) (yamlBytes []byte, body []byte, hasOpen bool, hasClose bool) {
	openLen := 0
	if bytes.HasPrefix(raw, []byte("---\n")) {
		openLen = 4
	} else if bytes.HasPrefix(raw, []byte("---\r\n")) {
		openLen = 5
	} else {
		return nil, raw, false, false
	}

	for pos := openLen; pos < len(raw); {
		if bytes.HasPrefix(raw[pos:], []byte("---")) {
			end := pos + 3
			if end == len(raw) {
				return raw[openLen:pos], raw[end:], true, true
			}
			if raw[end] == '\n' {
				return raw[openLen:pos], raw[end+1:], true, true
			}
			if raw[end] == '\r' && end+1 < len(raw) && raw[end+1] == '\n' {
				return raw[openLen:pos], raw[end+2:], true, true
			}
		}
		next := pos
		for next < len(raw) && raw[next] != '\n' && raw[next] != '\r' {
			next++
		}
		if next < len(raw) {
			if raw[next] == '\r' && next+1 < len(raw) && raw[next+1] == '\n' {
				next += 2
			} else {
				next++
			}
		}
		pos = next
	}
	return nil, raw, true, false
}

func yamlNodeToValue(n *yaml.Node, seen map[*yaml.Node]bool) (any, error) {
	if n == nil {
		return nil, nil
	}
	if n.Kind == yaml.AliasNode {
		if seen[n] {
			return nil, fmt.Errorf("cyclic alias")
		}
		seen[n] = true
		defer delete(seen, n)
		return yamlNodeToValue(n.Alias, seen)
	}
	switch n.Kind {
	case yaml.ScalarNode:
		if n.Tag == "!!str" || n.Tag == "!!timestamp" {
			return n.Value, nil
		}
		var v any
		if err := n.Decode(&v); err != nil {
			return nil, err
		}
		return v, nil
	case yaml.MappingNode:
		m := make(map[string]any, len(n.Content)/2)
		for i := 0; i+1 < len(n.Content); i += 2 {
			kNode, vNode := n.Content[i], n.Content[i+1]
			var key string
			if kNode.Kind == yaml.ScalarNode {
				key = kNode.Value
			} else {
				kv, err := yamlNodeToValue(kNode, seen)
				if err != nil {
					return nil, err
				}
				key = fmt.Sprint(kv)
			}
			if _, exists := m[key]; exists {
				return nil, fmt.Errorf("duplicate mapping key %q", key)
			}
			val, err := yamlNodeToValue(vNode, seen)
			if err != nil {
				return nil, err
			}
			m[key] = val
		}
		return m, nil
	case yaml.SequenceNode:
		s := make([]any, 0, len(n.Content))
		for _, child := range n.Content {
			val, err := yamlNodeToValue(child, seen)
			if err != nil {
				return nil, err
			}
			s = append(s, val)
		}
		return s, nil
	default:
		return nil, fmt.Errorf("unexpected YAML node kind %v", n.Kind)
	}
}

func ReadNote(path string) (Note, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Note{}, err
	}
	yamlBytes, body, hasOpen, hasClose := splitFrontmatter(raw)
	if !hasOpen {
		return Note{Body: raw, Issue: "missing frontmatter"}, nil
	}
	if !hasClose {
		return Note{Body: raw, Issue: "missing closing frontmatter delimiter"}, nil
	}

	var doc yaml.Node
	if err := yaml.Unmarshal(yamlBytes, &doc); err != nil {
		return Note{Body: body, Issue: fmt.Sprintf("invalid YAML (%v)", err)}, nil
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) != 1 || doc.Content[0].Kind != yaml.MappingNode {
		return Note{Body: body, Issue: "frontmatter is not a mapping"}, nil
	}
	val, err := yamlNodeToValue(doc.Content[0], map[*yaml.Node]bool{})
	if err != nil {
		return Note{Body: body, Issue: fmt.Sprintf("invalid YAML (%v)", err)}, nil
	}
	fields, ok := val.(map[string]any)
	if !ok {
		return Note{Body: body, Issue: "frontmatter is not a mapping"}, nil
	}
	return Note{Body: body, Fields: fields}, nil
}

func OneLine(value any) (string, bool) {
	s, ok := value.(string)
	if !ok || strings.TrimSpace(s) == "" || strings.ContainsAny(s, "\r\n") {
		return "", false
	}
	return s, true
}
