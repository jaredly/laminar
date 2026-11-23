#!/bin/bash
for i in examples/*.lm; do
    echo $i
    bun cli/laminar.ts emit $i --target native > $i.c
    rm -rf $i.go
    mkdir $i.go
    bun cli/laminar.ts emit $i --target go -o $i.go/main.go
done
