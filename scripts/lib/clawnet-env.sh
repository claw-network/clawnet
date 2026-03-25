#!/usr/bin/env bash

clawnet_resolve_home() {
  if [ -n "${CLAWNET_HOME:-}" ]; then
    printf '%s\n' "$CLAWNET_HOME"
  else
    printf '%s\n' "$HOME/.clawnet"
  fi
}

clawnet_env_file() {
  printf '%s/.env\n' "$(clawnet_resolve_home)"
}

clawnet_require_env_file() {
  local clawnet_home env_file line trimmed key raw

  clawnet_home="$(clawnet_resolve_home)"
  env_file="${clawnet_home}/.env"

  export CLAWNET_HOME="$clawnet_home"
  export CLAWNET_ENV_FILE="$env_file"

  if [ ! -f "$env_file" ]; then
    echo "ERROR: required ClawNet env file not found: $env_file" >&2
    echo "Project-local .env files are no longer supported." >&2
    echo "Move your configuration to $env_file." >&2
    return 1
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    trimmed="${line#"${line%%[![:space:]]*}"}"
    case "$trimmed" in
      ''|'#'*) continue ;;
      export\ *) trimmed="${trimmed#export }" ;;
    esac

    case "$trimmed" in
      *=*) ;;
      *) continue ;;
    esac

    key="${trimmed%%=*}"
    raw="${trimmed#*=}"
    key="${key%"${key##*[![:space:]]}"}"

    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi

    if [ -n "${!key+x}" ]; then
      continue
    fi

    # shellcheck disable=SC2163
    eval "export ${key}=${raw}"
  done < "$env_file"
}
