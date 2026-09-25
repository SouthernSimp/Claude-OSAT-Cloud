#!/bin/zsh
# Build this folder into the OSAT Field Mac app and install it in /Applications.
# Your notes are kept in ~/Library/Application Support/OSAT Field and are not touched.
set -e
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
npm run install:mac
open "/Applications/OSAT Field.app"
