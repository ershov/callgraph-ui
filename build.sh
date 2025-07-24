#!/bin/bash

rm -rf dist

npm run dist-mac
npm run dist-win
npm run dist-linux

# npm run dist-mac & npm run dist-win & npm run dist-linux

rm -f dist/*.blockmap

ls -lh dist/[Cc]allgraph* | fgrep -v .blockmap

# npx electron-builder
# npx electron-builder -m
# npx electron-builder --linux deb tar.xz
# bun run dist-linux
# bun run dist-win
# bun run dist-mac

