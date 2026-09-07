#!/usr/bin/env bash
# install-new-env.sh -- Linux/WSL one-shot idempotent installer for dsh-web-relay
# Counterpart of install-new-env.ps1 (Windows). Same three-step contract:
#   1) install plugin into a dsh profile + register it in cordis.patch.yml
#   2) install optional capability pack (skills/docs/scripts)
#   3) register the watchdog daemon (systemd user service, or crontab fallback)
# Plus: write env hints for platform-ops readSecret, and print a post-install checklist.
set -euo pipefail

PROFILE="web"
CAPABILITY_PACK=""
REPO_DEST=""
PLUGIN_ROOT=""
CC_TASKS_ROOT=""
GEMINI_API_KEY_VAL=""
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: install-new-env.sh [-s plugin_root] [-p profile] [-c capability_pack]
                           [-r repo_dest] [-e gemini_api_key] [-t cc_tasks_root] [-n] [-h]

  -s <plugin_root>      plugin root, must contain lib/ bin/ package.json (and
                         optionally cordis.patch.yml). Default: auto-detected by
                         walking up from this script's directory to the nearest
                         directory containing package.json.
  -p <profile>          dsh profile name. Default: web
  -c <capability_pack>  path to dist/dsh-relay-capability-pack-*.tar.gz (optional)
  -r <repo_dest>        docs/scripts reference target. Default: plugin_root
  -e <gemini_api_key>   GEMINI_API_KEY to persist into ~/.dsh/env (optional)
  -t <cc_tasks_root>    DSH_CC_TASKS_ROOT to persist into ~/.dsh/env (optional)
  -n                    dry run: print planned actions, write nothing
  -h                    show this help
EOF
}

log() {
  echo "[install-new-env] $*"
}

plan() {
  echo "[dry-run] $*"
}

while getopts "s:p:c:r:e:t:nh" opt; do
  case "$opt" in
    s) PLUGIN_ROOT="$OPTARG" ;;
    p) PROFILE="$OPTARG" ;;
    c) CAPABILITY_PACK="$OPTARG" ;;
    r) REPO_DEST="$OPTARG" ;;
    e) GEMINI_API_KEY_VAL="$OPTARG" ;;
    t) CC_TASKS_ROOT="$OPTARG" ;;
    n) DRY_RUN=1 ;;
    h) usage; exit 0 ;;
    \?) usage; exit 1 ;;
  esac
done

# --- resolve plugin root (auto-detect: walk up to nearest package.json) ---
if [ -z "$PLUGIN_ROOT" ]; then
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  found=""
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/package.json" ]; then
      found="$dir"
      break
    fi
    dir="$(dirname "$dir")"
  done
  if [ -z "$found" ]; then
    echo "error: could not auto-detect plugin root, pass -s <plugin_root>" >&2
    exit 1
  fi
  PLUGIN_ROOT="$found"
fi
PLUGIN_ROOT="$(cd "$PLUGIN_ROOT" 2>/dev/null && pwd || echo "$PLUGIN_ROOT")"

[ -z "$REPO_DEST" ] && REPO_DEST="$PLUGIN_ROOT"

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
TARGET="$PROFILE_DIR/node_modules/dsh-web-relay"
CORDIS_PATCH="$PROFILE_DIR/cordis.patch.yml"

log "plugin_root=$PLUGIN_ROOT profile=$PROFILE target=$TARGET dry_run=$DRY_RUN"

if [ "$DRY_RUN" -eq 0 ]; then
  for req in lib bin package.json; do
    if [ ! -e "$PLUGIN_ROOT/$req" ]; then
      echo "error: $PLUGIN_ROOT/$req not found (check -s plugin_root)" >&2
      exit 1
    fi
  done
fi

get_version() {
  local f="$1"
  if [ -f "$f" ]; then
    grep -m1 '"version"' "$f" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
  fi
}

# =========================================================================
# step 1: plugin install into ~/.dsh/profiles/<profile>/node_modules/dsh-web-relay
# =========================================================================
SRC_VERSION="$(get_version "$PLUGIN_ROOT/package.json")"
TARGET_VERSION="$(get_version "$TARGET/package.json")"

if [ -f "$TARGET/package.json" ] && [ -n "$TARGET_VERSION" ] && [ "$TARGET_VERSION" = "$SRC_VERSION" ]; then
  log "step1: dsh-web-relay already installed at $TARGET (version $TARGET_VERSION), skip"
else
  log "step1: installing dsh-web-relay into $TARGET (version ${SRC_VERSION:-unknown})"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "mkdir -p $TARGET"
    plan "cp -r $PLUGIN_ROOT/lib $TARGET/lib"
    plan "cp -r $PLUGIN_ROOT/bin $TARGET/bin"
    plan "cp $PLUGIN_ROOT/package.json $TARGET/package.json"
    plan "cp $PLUGIN_ROOT/cordis.patch.yml $TARGET/cordis.patch.yml (if present)"
  else
    mkdir -p "$TARGET"
    cp -r "$PLUGIN_ROOT/lib" "$TARGET/"
    cp -r "$PLUGIN_ROOT/bin" "$TARGET/"
    cp "$PLUGIN_ROOT/package.json" "$TARGET/"
    if [ -f "$PLUGIN_ROOT/cordis.patch.yml" ]; then
      cp "$PLUGIN_ROOT/cordis.patch.yml" "$TARGET/"
    fi
  fi
fi

# register the plugin in the profile's cordis.patch.yml (idempotent)
if [ -f "$CORDIS_PATCH" ] && grep -q "dsh-web-relay" "$CORDIS_PATCH" 2>/dev/null; then
  log "step1: $CORDIS_PATCH already registers dsh-web-relay, skip"
else
  log "step1: registering dsh-web-relay in $CORDIS_PATCH"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "append to $CORDIS_PATCH:"
    plan "  - insert:"
    plan "      - id: dsh-web-relay"
    plan "        name: dsh-web-relay"
  else
    mkdir -p "$PROFILE_DIR"
    {
      echo "- insert:"
      echo "  - id: dsh-web-relay"
      echo "    name: dsh-web-relay"
    } >> "$CORDIS_PATCH"
  fi
fi

# =========================================================================
# step 2: optional capability pack (skills + docs/scripts reference copy)
# =========================================================================
if [ -n "$CAPABILITY_PACK" ]; then
  if [ ! -f "$CAPABILITY_PACK" ]; then
    echo "error: capability pack not found: $CAPABILITY_PACK" >&2
    exit 1
  fi
  log "step2: installing capability pack $CAPABILITY_PACK"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "tar -xzf $CAPABILITY_PACK -> <tmpdir>"
    plan "cp -r <tmpdir>/skills/* -> $DSH_HOME/skills/"
    plan "cp -r <tmpdir>/docs -> $REPO_DEST/"
    plan "cp -r <tmpdir>/scripts -> $REPO_DEST/"
  else
    tmpdir="$(mktemp -d)"
    trap 'rm -rf "$tmpdir"' EXIT
    tar -xzf "$CAPABILITY_PACK" -C "$tmpdir"
    mkdir -p "$DSH_HOME/skills"
    if [ -d "$tmpdir/skills" ]; then
      cp -r "$tmpdir"/skills/. "$DSH_HOME/skills/"
    fi
    if [ -d "$tmpdir/docs" ]; then
      mkdir -p "$REPO_DEST/docs"
      cp -r "$tmpdir"/docs/. "$REPO_DEST/docs/"
    fi
    if [ -d "$tmpdir/scripts" ]; then
      mkdir -p "$REPO_DEST/scripts"
      cp -r "$tmpdir"/scripts/. "$REPO_DEST/scripts/"
    fi
  fi
else
  log "step2: no capability pack given (-c), skip"
fi

# =========================================================================
# step 3: watchdog daemon registration (systemd user service, else crontab)
# =========================================================================
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/dsh-web-watchdog.service"

systemd_available() {
  command -v systemctl >/dev/null 2>&1 || return 1
  systemctl --user list-units >/dev/null 2>&1
}

if [ -f "$SERVICE_FILE" ]; then
  log "step3: watchdog systemd unit already present at $SERVICE_FILE, skip"
elif systemd_available; then
  log "step3: registering watchdog via systemd --user"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "write $SERVICE_FILE (ExecStart=node $PLUGIN_ROOT/bin/watchdog.mjs, Restart=on-failure, RestartSec=5)"
    plan "systemctl --user daemon-reload"
    plan "systemctl --user enable --now dsh-web-watchdog.service"
  else
    mkdir -p "$SERVICE_DIR"
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=dsh-web-relay watchdog

[Service]
ExecStart=node $PLUGIN_ROOT/bin/watchdog.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now dsh-web-watchdog.service
  fi
else
  log "step3: systemd --user not available, falling back to crontab @reboot"
  if ! command -v crontab >/dev/null 2>&1; then
    log "step3: crontab not available either, skipping watchdog registration"
  elif crontab -l 2>/dev/null | grep -q "dsh-web-watchdog"; then
    log "step3: crontab entry for dsh-web-watchdog already present, skip"
  else
    CRON_LINE="@reboot node $PLUGIN_ROOT/bin/watchdog.mjs # dsh-web-watchdog"
    if [ "$DRY_RUN" -eq 1 ]; then
      plan "append crontab entry: $CRON_LINE"
    else
      ( crontab -l 2>/dev/null; echo "$CRON_LINE" ) | crontab -
    fi
  fi
fi

# =========================================================================
# step 4: env hints (Linux equivalent of Windows setx), read by platform-ops readSecret
# =========================================================================
ENV_FILE="$DSH_HOME/env"
ENV_LINES=()
ENV_LINES+=("DSH_RELAY_REPO=$PLUGIN_ROOT")
[ -n "$CC_TASKS_ROOT" ] && ENV_LINES+=("DSH_CC_TASKS_ROOT=$CC_TASKS_ROOT")
[ -n "$GEMINI_API_KEY_VAL" ] && ENV_LINES+=("GEMINI_API_KEY=$GEMINI_API_KEY_VAL")

log "step4: persisting env hints into $ENV_FILE"
if [ "$DRY_RUN" -eq 1 ]; then
  for line in "${ENV_LINES[@]}"; do
    plan "set in $ENV_FILE: ${line%%=*}=..."
  done
else
  mkdir -p "$DSH_HOME"
  touch "$ENV_FILE"
  for line in "${ENV_LINES[@]}"; do
    key="${line%%=*}"
    if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
      sed -i "s#^${key}=.*#${line}#" "$ENV_FILE"
    else
      echo "$line" >> "$ENV_FILE"
    fi
  done
fi

# =========================================================================
# step 5: post-install checklist
# =========================================================================
log "step5: install steps complete."
log "  next: restart 'dsh web' (or the harness process) to pick up the new plugin"
log "  next: run the verify script (if provided) to confirm dsh-web-relay + watchdog are healthy"
log "  next: source or re-login so ~/.dsh/env is picked up by platform-ops readSecret"
if [ "$DRY_RUN" -eq 1 ]; then
  log "(dry-run: no files were written, no services were started)"
fi
