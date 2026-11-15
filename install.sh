#!/bin/sh
# Installs Eon on Mac and Linux. Run it from the unzipped folder:  sh install.sh
# Or, for a public copy of the repo, with one line (it downloads Eon to ~/eon first):
#   curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/install.sh | sh
set -e

REPO="${EON_REPO:-OWNER/REPO}"
say() { printf '\n== %s\n' "$1"; }
die() { printf '\nInstall stopped: %s\n' "$1" >&2; exit 1; }

# Where is Eon? Next to this script, or download it.
HERE="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" || HERE=""
if [ -z "$HERE" ] || [ ! -f "$HERE/bin/eon.js" ]; then
  command -v git >/dev/null 2>&1 || die "git is needed to download Eon. Install git, or download the zip and run: sh install.sh"
  case "$REPO" in OWNER/*) die "this copy does not know where to download Eon from. Download the zip, unzip it and run: sh install.sh";; esac
  HERE="$HOME/eon"
  say "Downloading Eon to $HERE"
  if [ -d "$HERE/.git" ]; then git -C "$HERE" pull --ff-only; else git clone --depth 1 "https://github.com/$REPO.git" "$HERE"; fi
fi
cd "$HERE"

say "Checking Node.js (version 18 or newer)"
if command -v node >/dev/null 2>&1 && [ "$(node -p "process.versions.node.split('.')[0]")" -ge 18 ]; then
  echo "Node $(node -v)"
else
  if command -v brew >/dev/null 2>&1; then say "Installing Node.js with Homebrew"; brew install node
  else die "Node.js 18 or newer is needed. Install the LTS version from https://nodejs.org (or with your package manager), then run this again."; fi
fi

say "Checking git"
command -v git >/dev/null 2>&1 || die "git is needed. Install it (for example: xcode-select --install on Mac, or your package manager on Linux), then run this again."
git --version

say "Installing Eon (this downloads a browser the first time; it can take a few minutes)"
if [ "${EON_SKIP_BROWSER:-}" = "1" ]; then node bin/setup.js --no-browser; else node bin/setup.js; fi

say "Checking this computer"
if command -v eon >/dev/null 2>&1; then eon first-run; else node bin/eon.js first-run; fi

printf '\nDone. Open a NEW terminal, go to a project folder and type:  eon\nFirst time: type  eon login  to sign in to DeepSeek.\n'
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) if [ -x "$HOME/.local/bin/eon" ]; then printf 'If "eon" is not found, add this to your PATH: %s/.local/bin\n' "$HOME"; fi;; esac
exit 0
