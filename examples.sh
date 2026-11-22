#!/bin/bash
for i in examples/*.lm; do
    echo $i
    bun cli/laminar.ts emit $i --target native > $i.c
    bun cli/laminar.ts emit $i --target go > $i.go
done
