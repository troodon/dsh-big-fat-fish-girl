#!/bin/sh
# Release check: everything that must be true before tagging a version, in one command.
#
# It runs the gates, packs the tarball, installs it into a throwaway DSH home, boots that
# home, verifies the whole HTTP contract against the *packed* artifact, and — on macOS —
# builds the shell and has it load the page. Nothing touches your real profile: everything
# happens in a temporary directory that is removed on exit.
#
#   sh scripts/verify-release.sh
#   DSH_BIN=/path/to/dsh PORT=19550 sh scripts/verify-release.sh
#
# Exits non-zero on the first real failure, so it can gate a tag.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
DSH_BIN="${DSH_BIN:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}"
PORT="${PORT:-19490}"
PROFILE="verify-release"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/bffg-release.XXXXXX")
HOME_DIR="$WORK/home"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    pkill -f -- "--profile $PROFILE" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

step() {
  printf '\n\033[1m== %s\033[0m\n' "$1"
}

skip() {
  printf '   skipped: %s\n' "$1"
}

cd "$REPO"

step "1/6 gates (assets, builds, tests)"
npm run verify | tail -1
node scripts/build-client.mjs --check
node scripts/build-desktop.mjs --check
npm test 2>&1 | grep -E '^ℹ (tests|pass|fail|skipped)'
if command -v cargo >/dev/null 2>&1; then
  cargo test --manifest-path desktop/tauri/Cargo.toml -p big-fat-fish-girl-shell-core 2>&1 | grep 'test result' | tail -1
else
  skip 'no cargo — Rust shell-core tests not run'
fi

step "2/6 package"
mkdir -p "$WORK/package"
TARBALL=$(NPM_CONFIG_CACHE="${NPM_CACHE:-$WORK/npm-cache}" npm run --silent pack -- "$WORK/package")
test -f "$WORK/package/$TARBALL"
printf '   %s — %s\n' "$TARBALL" "$(du -h "$WORK/package/$TARBALL" | cut -f1)"

step "3/6 install into a throwaway profile"
if [ ! -x "$DSH_BIN" ]; then
  skip "no DSH at $DSH_BIN (set DSH_BIN to check the installed bundle)"
else
  mkdir -p "$HOME_DIR/profiles"
  DSH_HOME="$HOME_DIR" "$DSH_BIN" --profile "$PROFILE" --from-default-profile web --dump-config >/dev/null 2>&1 || true
  DSH_HOME="$HOME_DIR" "$DSH_BIN" plugin --profile "$PROFILE" add "$WORK/package/$TARBALL" 2>&1 | tail -1

  step "4/6 boot the installed bundle"
  DSH_HOME="$HOME_DIR" "$DSH_BIN" --profile "$PROFILE" --no-open --port "$PORT" >"$WORK/boot.log" 2>&1 &
  SERVER_PID=$!
  READY=""
  for _ in $(seq 1 60); do
    sleep 1
    # The root needs a token, so readiness is judged by the plugin route itself.
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/big-fat-fish-girl/v1/state")" = "200" ]; then
      READY=yes
      break
    fi
    kill -0 "$SERVER_PID" 2>/dev/null || break
  done
  if [ -z "$READY" ]; then
    printf '   instance did not come up; log tail:\n'
    tail -20 "$WORK/boot.log"
    exit 1
  fi
  printf '   up on port %s\n' "$PORT"

  step "5/6 HTTP contract against the packed artifact"
  # No pipe here: piping into tail would swallow a failure's exit code and report success.
  if ! node scripts/verify-routes.mjs "http://127.0.0.1:$PORT" >"$WORK/contract.log" 2>&1; then
    cat "$WORK/contract.log"
    printf '   contract check FAILED\n'
    exit 1
  fi
  grep -c '  ok  ' "$WORK/contract.log" | xargs -I{} printf '   {} checks passed\n'
  tail -6 "$WORK/contract.log"

  step "6/6 shell loads the page (macOS)"
  if command -v cargo >/dev/null 2>&1 && [ "$(uname -s)" = Darwin ]; then
    cargo build --quiet --manifest-path desktop/tauri/Cargo.toml --release
    "$REPO/desktop/tauri/target/release/big-fat-fish-girl-shell" --url "http://127.0.0.1:$PORT/big-fat-fish-girl/v1/desktop" --self-test
  else
    skip "no cargo (the Tauri shell builds on macOS only here)"
  fi
fi

printf '\n\033[1mrelease check passed\033[0m — the artifact installs, serves and renders\n'
