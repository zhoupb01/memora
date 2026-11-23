package main

import (
	"os"

	"github.com/zhoupb01/memora"
)

func main() {
	os.Exit(memora.RunCLI(os.Args[1:], os.Stdout, os.Stderr))
}
