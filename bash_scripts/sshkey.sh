#!/usr/bin/env bash
#
# sshkey.sh — friendly OpenSSH key manager.
#
#   sshkey new  [name]     Generate a key (wizard) and register it.
#   sshkey list            Show your key registry (managed + unmanaged).
#   sshkey rm   <name>     Remove a key: file, config entry, agent, manifest.
#   sshkey rotate <name>   Replace a key, archiving the old one for rollback.
#   sshkey help            This help.
#
# State:
#   ~/.ssh/keys.tsv        Manifest (tab-separated): name app type created alias status superseded purpose
#   ~/.ssh/config.d/*.conf One Host block per key, pulled in by an Include line.
#
set -euo pipefail

SSH_DIR="${HOME}/.ssh"
CONFIG="${SSH_DIR}/config"
CONFD="${SSH_DIR}/config.d"
MAN="${SSH_DIR}/keys.tsv"
OLD_AGE_DAYS="${SSHKEY_OLD_AGE_DAYS:-180}"   # flag keys older than this in `list`

# --- pretty output ----------------------------------------------------------
if [[ -t 1 ]]; then
  B=$'\e[1m'; DIM=$'\e[2m'; GRN=$'\e[32m'; YLW=$'\e[33m'; CYN=$'\e[36m'; RED=$'\e[31m'; RST=$'\e[0m'
else
  B=""; DIM=""; GRN=""; YLW=""; CYN=""; RED=""; RST=""
fi
info() { printf '%s==>%s %s\n' "$CYN" "$RST" "$*"; }
ok()   { printf '%s✓%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '%s!%s %s\n' "$YLW" "$RST" "$*"; }
die()  { printf '%s✗ %s%s\n' "$RED" "$*" "$RST" >&2; exit 1; }

ask() { # ask "Prompt" "default" -> echoes answer
  local prompt="$1" default="${2:-}" reply
  if [[ -n "$default" ]]; then
    read -r -e -p "$(printf '%s%s%s [%s]: ' "$B" "$prompt" "$RST" "$default")" reply
    printf '%s' "${reply:-$default}"
  else
    read -r -e -p "$(printf '%s%s%s: ' "$B" "$prompt" "$RST")" reply
    printf '%s' "$reply"
  fi
}
yesno() { # yesno "Prompt" "Y|N"(default) -> 0 for yes
  local prompt="$1" default="${2:-Y}" reply hint
  [[ "$default" == "Y" ]] && hint="Y/n" || hint="y/N"
  read -r -p "$(printf '%s%s%s (%s): ' "$B" "$prompt" "$RST" "$hint")" reply
  reply="${reply:-$default}"
  [[ "$reply" =~ ^[Yy] ]]
}

clip_copy() {
  local data="$1"
  if   command -v pbcopy   >/dev/null 2>&1; then printf '%s' "$data" | pbcopy; return 0
  elif command -v wl-copy  >/dev/null 2>&1; then printf '%s' "$data" | wl-copy; return 0
  elif command -v xclip    >/dev/null 2>&1; then printf '%s' "$data" | xclip -selection clipboard; return 0
  elif command -v xsel     >/dev/null 2>&1; then printf '%s' "$data" | xsel --clipboard --input; return 0
  elif command -v clip.exe >/dev/null 2>&1; then printf '%s' "$data" | clip.exe; return 0
  fi
  return 1
}

# --- manifest helpers (tab-separated, no jq needed) -------------------------
# columns: 1 name  2 app  3 type  4 created  5 alias  6 status  7 superseded  8 purpose
man_init() {
  [[ -f "$MAN" ]] && return 0
  printf 'name\tapp\ttype\tcreated\talias\tstatus\tsuperseded\tpurpose\n' > "$MAN"
  chmod 600 "$MAN"
}
man_row()  { [[ -f "$MAN" ]] && awk -F'\t' -v k="$1" 'NR>1 && $1==k{print;exit}' "$MAN"; }
man_has()  { [[ -n "$(man_row "$1")" ]]; }
man_field(){ man_row "$1" | awk -F'\t' -v c="$2" '{print $c}'; }
man_put()  { # name app type created alias status superseded purpose
  man_init
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@" >> "$MAN"
}
man_del()  {
  [[ -f "$MAN" ]] || return 0
  local tmp; tmp="$(mktemp)"
  awk -F'\t' -v k="$1" 'NR==1 || $1!=k' "$MAN" > "$tmp" && mv "$tmp" "$MAN"
  chmod 600 "$MAN"
}
man_set()  { # name column value
  [[ -f "$MAN" ]] || return 0
  local tmp; tmp="$(mktemp)"
  awk -F'\t' -v OFS='\t' -v k="$1" -v c="$2" -v v="$3" 'NR>1 && $1==k{$c=v}1' "$MAN" > "$tmp" && mv "$tmp" "$MAN"
  chmod 600 "$MAN"
}

age_days() { # YYYY-MM-DD -> integer days, or "?" if unparseable
  local d="$1" then now
  then="$(date -d "$d" +%s 2>/dev/null)" || { printf '?'; return; }
  now="$(date +%s)"
  printf '%d' $(( (now - then) / 86400 ))
}

ensure_ssh_dir() { mkdir -p "$SSH_DIR" && chmod 700 "$SSH_DIR"; }
ensure_confd() {
  mkdir -p "$CONFD" && chmod 700 "$CONFD"
  if [[ ! -f "$CONFIG" ]]; then
    printf 'Include config.d/*.conf\n' > "$CONFIG"
    chmod 600 "$CONFIG"
  elif ! grep -q '^\s*Include\s\+config.d/\*' "$CONFIG"; then
    local tmp; tmp="$(mktemp)"
    { printf 'Include config.d/*.conf\n\n'; cat "$CONFIG"; } > "$tmp" && mv "$tmp" "$CONFIG"
    chmod 600 "$CONFIG"
  fi
}

# ---------------------------------------------------------------------------
# new
# ---------------------------------------------------------------------------
cmd_new() {
  ensure_ssh_dir
  printf '%sGenerate SSH key%s\n' "$B" "$RST"

  local name="${1:-}"
  [[ -z "$name" ]] && name="$(ask "Key name (filename in ~/.ssh)" "id_ed25519")"
  [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || die "Invalid name '$name' (letters, numbers, . _ - only)"
  local keyfile="${SSH_DIR}/${name}"

  if [[ -e "$keyfile" ]]; then
    yesno "${RED}${keyfile} already exists.${RST} Overwrite?" "N" || die "Aborted — pick another name (or: sshkey rotate ${name})."
    rm -f "$keyfile" "${keyfile}.pub"
  fi

  printf '\nKey type:\n'
  printf '  %s1%s) ed25519   %s(recommended)%s\n' "$B" "$RST" "$DIM" "$RST"
  printf '  %s2%s) rsa 4096  %s(max compatibility)%s\n' "$B" "$RST" "$DIM" "$RST"
  printf '  %s3%s) ecdsa 521%s\n' "$B" "$RST" "$RST"
  local choice type; local -a extra
  choice="$(ask "Choose" "1")"
  case "$choice" in
    1) type="ed25519"; extra=() ;;
    2) type="rsa";     extra=(-b 4096) ;;
    3) type="ecdsa";   extra=(-b 521) ;;
    *) die "Invalid choice '$choice'." ;;
  esac

  local default_comment comment
  default_comment="${USER}@$(hostname -s 2>/dev/null || hostname)-$(date +%Y%m%d)"
  comment="$(ask "Comment" "$default_comment")"

  local passphrase="" p1 p2
  if yesno "Protect the key with a passphrase?" "Y"; then
    while :; do
      read -r -s -p "$(printf '%sPassphrase%s: ' "$B" "$RST")" p1; echo
      read -r -s -p "$(printf '%sConfirm%s:    ' "$B" "$RST")" p2; echo
      [[ "$p1" == "$p2" ]] && { passphrase="$p1"; break; }
      warn "Passphrases didn't match — try again."
    done
  else
    warn "Generating a key with NO passphrase."
  fi

  printf '\n'; info "Generating ${type} key at ${keyfile}"
  ssh-keygen -t "$type" "${extra[@]}" -f "$keyfile" -C "$comment" -N "$passphrase" -q
  chmod 600 "$keyfile"; chmod 644 "${keyfile}.pub"
  ok "Key created — $(ssh-keygen -lf "${keyfile}.pub" | awk '{print $2}')"

  # metadata for the registry
  local app purpose
  app="$(ask "App / tag (e.g. github, wp-server)" "$name")"
  purpose="$(ask "Purpose (free text)" "")"

  # ssh-agent
  if yesno "Add to ssh-agent now?" "Y"; then
    local rc=0; ssh-add -l >/dev/null 2>&1 || rc=$?
    if [[ $rc -eq 2 ]]; then
      warn "No ssh-agent running in this shell (start one: eval \"\$(ssh-agent -s)\")."
    elif [[ "$(uname)" == "Darwin" ]] && ssh-add --apple-use-keychain "$keyfile" 2>/dev/null; then
      ok "Added to ssh-agent (macOS keychain)."
    elif ssh-add "$keyfile"; then ok "Added to ssh-agent."
    else warn "ssh-add failed — add later with: ssh-add ${keyfile}"; fi
  fi

  # Host entry -> config.d
  local alias_name="-"
  if yesno "Register a Host entry (ssh <alias>)?" "Y"; then
    ensure_confd
    alias_name="$(ask "  Host alias" "$name")"
    local hostname_val user_val port_val
    hostname_val="$(ask "  HostName (IP or domain)" "")"
    user_val="$(ask "  User" "root")"
    port_val="$(ask "  Port" "22")"
    {
      printf '# %s — added by sshkey.sh %s\n' "$app" "$(date +%Y-%m-%d)"
      printf 'Host %s\n' "$alias_name"
      [[ -n "$hostname_val" ]] && printf '    HostName %s\n' "$hostname_val"
      printf '    User %s\n    Port %s\n    IdentityFile %s\n    IdentitiesOnly yes\n' \
        "$user_val" "$port_val" "$keyfile"
    } > "${CONFD}/${alias_name}.conf"
    chmod 600 "${CONFD}/${alias_name}.conf"
    ok "Registered — connect with: ${B}ssh ${alias_name}${RST}"
  fi

  # clipboard + show
  if yesno "Copy public key to clipboard?" "Y"; then
    if clip_copy "$(cat "${keyfile}.pub")"; then ok "Public key copied."
    else warn "No clipboard tool found."; fi
  fi

  man_put "$name" "$app" "$type" "$(date +%F)" "$alias_name" "active" "-" "$purpose"

  printf '\n%sPublic key:%s\n%s%s%s\n' "$B" "$RST" "$GRN" "$(cat "${keyfile}.pub")" "$RST"
  printf '%sDeploy:%s ssh-copy-id -i %s.pub user@host   |   gh ssh-key add %s.pub\n' \
    "$DIM" "$RST" "$keyfile" "$keyfile"
}

# ---------------------------------------------------------------------------
# list
# ---------------------------------------------------------------------------
cmd_list() {
  ensure_ssh_dir
  # fingerprints currently loaded in the agent
  local agent_fps=""; local rc=0
  agent_fps="$(ssh-add -l 2>/dev/null | awk '{print $2}')" || rc=$?

  local fmt="%-16s %-12s %-9s %6s  %-14s %-5s %-9s %s\n"
  # shellcheck disable=SC2059
  printf "${B}${fmt}${RST}" "NAME" "APP" "TYPE" "AGE" "ALIAS" "AGENT" "STATUS" "FINGERPRINT"

  local printed=" "
  # managed keys (from manifest)
  if [[ -f "$MAN" ]]; then
    while IFS=$'\t' read -r name app type created alias status superseded purpose; do
      [[ "$name" == "name" ]] && continue
      printed+="$name "
      local pub="${SSH_DIR}/${name}.pub" fp="-" agent="-" age d
      [[ -f "$pub" ]] && fp="$(ssh-keygen -lf "$pub" 2>/dev/null | awk '{print $2}')"
      [[ -n "$fp" && "$fp" != "-" && "$agent_fps" == *"$fp"* ]] && agent="✓" || agent="✗"
      d="$(age_days "$created")"; age="${d}d"
      local flag=""
      [[ "$status" != "active" ]] && flag=" ${YLW}⚠${RST}"
      [[ "$d" != "?" && "$d" -gt "$OLD_AGE_DAYS" ]] && flag=" ${YLW}⚠ old${RST}"
      [[ ! -f "$pub" ]] && { status="MISSING"; flag=" ${RED}⚠${RST}"; }
      # shellcheck disable=SC2059
      printf "$fmt" "$name" "$app" "$type" "$age" "$alias" "$agent" "$status" "${fp}${flag}"
    done < "$MAN"
  fi

  # unmanaged keys (present in ~/.ssh but not in the manifest)
  local pub name fp agent
  for pub in "$SSH_DIR"/*.pub; do
    [[ -e "$pub" ]] || continue
    name="$(basename "$pub" .pub)"
    [[ "$printed" == *" $name "* ]] && continue
    fp="$(ssh-keygen -lf "$pub" 2>/dev/null | awk '{print $2}')"
    [[ -n "$fp" && "$agent_fps" == *"$fp"* ]] && agent="✓" || agent="✗"
    local ktype; ktype="$(ssh-keygen -lf "$pub" 2>/dev/null | awk '{print $NF}' | tr -d '()' | tr '[:upper:]' '[:lower:]')"
    # shellcheck disable=SC2059
    printf "$fmt" "$name" "-" "$ktype" "?" "-" "$agent" "${DIM}unmanaged${RST}" "$fp"
  done

  printf '\n%sTip:%s adopt an unmanaged key with `sshkey adopt <name>`, or create one with `sshkey new`.\n' "$DIM" "$RST"
}

# ---------------------------------------------------------------------------
# rm
# ---------------------------------------------------------------------------
cmd_rm() {
  local name="${1:-}"; [[ -n "$name" ]] || die "Usage: sshkey rm <name>"
  local keyfile="${SSH_DIR}/${name}"
  [[ -e "$keyfile" || -e "${keyfile}.pub" ]] || man_has "$name" || die "No key named '$name'."

  printf '%sAbout to remove '%s':%s\n' "$B" "$name" "$RST"
  [[ -e "$keyfile" ]] && printf '  key file      %s\n' "$keyfile"
  local alias; alias="$(man_field "$name" 5 2>/dev/null || true)"
  [[ -n "$alias" && "$alias" != "-" && -f "${CONFD}/${alias}.conf" ]] && printf '  config entry  %s\n' "${CONFD}/${alias}.conf"
  man_has "$name" && printf '  manifest row\n'
  yesno "${RED}Delete all of the above?${RST}" "N" || die "Aborted."

  # drop from agent (best effort)
  [[ -f "${keyfile}.pub" ]] && ssh-add -d "$keyfile" >/dev/null 2>&1 || true
  rm -f "$keyfile" "${keyfile}.pub"
  [[ -n "$alias" && "$alias" != "-" ]] && rm -f "${CONFD}/${alias}.conf"
  man_del "$name"
  ok "Removed '$name'."
}

# ---------------------------------------------------------------------------
# rotate
# ---------------------------------------------------------------------------
cmd_rotate() {
  local name="${1:-}"; [[ -n "$name" ]] || die "Usage: sshkey rotate <name>"
  local keyfile="${SSH_DIR}/${name}"
  [[ -f "$keyfile" ]] || die "No key file at ${keyfile}."

  local type="ed25519"
  man_has "$name" && type="$(man_field "$name" 3)"
  local stamp; stamp="$(date +%Y%m%d)"
  local archive="${keyfile}.retired-${stamp}"

  printf '%sRotating '%s' (%s)%s\n' "$B" "$name" "$type" "$RST"
  printf 'The current key will be archived to %s for rollback,\n' "$(basename "$archive")"
  printf 'then a fresh key generated at the same name. Deploy the new public key,\n'
  printf 'confirm it works, then: %ssshkey rm %s%s\n\n' "$B" "$(basename "$archive")" "$RST"
  yesno "Proceed?" "Y" || die "Aborted."

  # archive old
  mv "$keyfile" "$archive"; mv "${keyfile}.pub" "${archive}.pub"
  man_has "$name" && man_put "$(basename "$archive")" \
    "$(man_field "$name" 2)" "$type" "$(man_field "$name" 4)" "-" "retired" "$name" "superseded by rotation"

  # new key
  local comment passphrase="" p1 p2
  comment="${USER}@$(hostname -s 2>/dev/null || hostname)-$(date +%Y%m%d)"
  local -a extra=(); [[ "$type" == "rsa" ]] && extra=(-b 4096); [[ "$type" == "ecdsa" ]] && extra=(-b 521)
  if yesno "Passphrase on the new key?" "Y"; then
    while :; do
      read -r -s -p "$(printf '%sPassphrase%s: ' "$B" "$RST")" p1; echo
      read -r -s -p "$(printf '%sConfirm%s:    ' "$B" "$RST")" p2; echo
      [[ "$p1" == "$p2" ]] && { passphrase="$p1"; break; }
      warn "Didn't match — try again."
    done
  fi
  ssh-keygen -t "$type" "${extra[@]}" -f "$keyfile" -C "$comment" -N "$passphrase" -q
  chmod 600 "$keyfile"; chmod 644 "${keyfile}.pub"
  man_has "$name" && man_set "$name" 4 "$(date +%F)"
  ok "New key generated — $(ssh-keygen -lf "${keyfile}.pub" | awk '{print $2}')"

  # refresh agent + clipboard
  ssh-add -d "$archive" >/dev/null 2>&1 || true
  ssh-add "$keyfile" >/dev/null 2>&1 && ok "Swapped in ssh-agent." || true
  clip_copy "$(cat "${keyfile}.pub")" && ok "New public key copied to clipboard." || true

  printf '\n%sNew public key:%s\n%s%s%s\n' "$B" "$RST" "$GRN" "$(cat "${keyfile}.pub")" "$RST"
  printf '%sNow deploy it (gh ssh-key add / ssh-copy-id / paste), verify, then:%s sshkey rm %s\n' \
    "$DIM" "$RST" "$(basename "$archive")"
}

# ---------------------------------------------------------------------------
# adopt — bring an existing (unmanaged) key into the registry
# ---------------------------------------------------------------------------
cmd_adopt() {
  local name="${1:-}"; [[ -n "$name" ]] || die "Usage: sshkey adopt <name>"
  local pub="${SSH_DIR}/${name}.pub"
  [[ -f "$pub" ]] || die "No public key at ${pub}."
  man_has "$name" && die "'$name' is already managed."

  local type created app purpose alias
  type="$(ssh-keygen -lf "$pub" 2>/dev/null | awk '{print $NF}' | tr -d '()' | tr '[:upper:]' '[:lower:]')"
  created="$(stat -c %y "${SSH_DIR}/${name}" 2>/dev/null | cut -d' ' -f1)"; created="${created:-$(date +%F)}"
  # best-effort alias: find a Host block whose IdentityFile points at this key
  alias="-"
  local hit; hit="$(grep -rlE "IdentityFile.*/${name}$" "$CONFD" "$CONFIG" 2>/dev/null | head -1 || true)"
  [[ -n "$hit" ]] && alias="$(awk '/^Host /{print $2; exit}' "$hit" 2>/dev/null || echo "-")"

  info "Adopting '$name' (${type}, created ${created}, alias ${alias})"
  app="$(ask "App / tag" "$name")"
  purpose="$(ask "Purpose (free text)" "")"
  man_put "$name" "$app" "$type" "$created" "$alias" "active" "-" "$purpose"
  ok "Adopted '$name' into the registry."
}

cmd_help() {
  cat <<EOF
${B}sshkey${RST} — OpenSSH key manager

  ${B}sshkey new${RST}  [name]      Generate a key (wizard) and register it
  ${B}sshkey list${RST}             Show your key registry
  ${B}sshkey rm${RST}   <name>      Remove key file + config entry + agent + manifest
  ${B}sshkey rotate${RST} <name>    Replace a key, archiving the old for rollback
  ${B}sshkey adopt${RST}  <name>    Bring an existing (unmanaged) key into the registry
  ${B}sshkey help${RST}             This help

State: ${DIM}~/.ssh/keys.tsv${RST} (manifest), ${DIM}~/.ssh/config.d/*.conf${RST} (Host entries)
Env:   ${DIM}SSHKEY_OLD_AGE_DAYS${RST} (default ${OLD_AGE_DAYS}) flags aging keys in \`list\`
EOF
}

# --- dispatch ---------------------------------------------------------------
cmd="${1:-help}"; shift || true
case "$cmd" in
  new)    cmd_new "$@" ;;
  list|ls) cmd_list "$@" ;;
  rm|remove|delete) cmd_rm "$@" ;;
  rotate) cmd_rotate "$@" ;;
  adopt)  cmd_adopt "$@" ;;
  help|-h|--help) cmd_help ;;
  *) die "Unknown command '$cmd' — try: sshkey help" ;;
esac
