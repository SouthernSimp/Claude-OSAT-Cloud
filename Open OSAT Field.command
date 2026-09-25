#!/bin/zsh
# Open the OSAT Field preview. Does not launch or modify OSAT V2.
set -e
cd "${0:A:h}"
export PATH="/Users/nate/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
(sleep 1 && /usr/bin/open "http://127.0.0.1:5239/") &
npm run dev -- --host 127.0.0.1 --port 5239 --strictPort
