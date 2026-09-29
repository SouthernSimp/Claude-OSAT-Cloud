#!/bin/zsh
# Build and launch the OSAT preview from this folder's current branch.
# Uses the separate "OSAT Dev" data folder - your real notes are not touched.
set -e
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
npm run start:mac
