#!/bin/zsh
# Build this folder into the OSAT Mac app and install it in /Applications.
# Your notes stay in ~/Library/Application Support/OSAT and are not touched.
set -e
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
npm ci
npm test
npm run install:mac
open "/Applications/OSAT.app"
