#!/bin/zsh
set -euo pipefail

repo_dir="${0:A:h:h}"
source_file="$repo_dir/native/CodexControlsHelper/main.swift"
info_file="$repo_dir/native/CodexControlsHelper/Info.plist"
app_dir="$repo_dir/com.courcelle.codex-controls.sdPlugin/bin/Codex Controls Helper.app"
contents_dir="$app_dir/Contents"
executable_dir="$contents_dir/MacOS"
executable_file="$executable_dir/Codex Controls Helper"
architecture="$(uname -m)"

mkdir -p "$executable_dir"
cp "$info_file" "$contents_dir/Info.plist"
xcrun swiftc \
  -O \
  -sdk "$(xcrun --show-sdk-path)" \
  -target "$architecture-apple-macos12.0" \
  -framework AppKit \
  -framework ApplicationServices \
  -framework Vision \
  "$source_file" \
  -o "$executable_file"

signing_identity="${CODEX_CONTROLS_SIGN_IDENTITY:-}"
if [[ -z "$signing_identity" ]]; then
  signing_identity="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*\([0-9A-F]\{40\}\) "Apple Development:.*/\1/p' | head -n 1)"
fi
if [[ -n "$signing_identity" ]]; then
  codesign --force --sign "$signing_identity" --options runtime --timestamp=none "$app_dir"
  print "Built and signed Codex Controls Helper with an Apple Development identity."
else
  codesign --force --sign - --timestamp=none "$app_dir"
  print "Built Codex Controls Helper with an ad-hoc signature."
fi
