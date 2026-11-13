#!/bin/sh
set -eu

programs=",${REVIEW_DESK_AGENT_PROGRAMS:-claude,codex},"

json_string() {
  printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
}

list() {
  first=1
  printf '{"agents":['
  tmux list-panes -a -F '#{pane_id}	#{pane_current_path}	#{pane_current_command}' |
    while IFS='	' read -r id cwd command; do
      case "$programs" in *",$command,"*) ;; *) continue ;; esac
      [ "$first" = 1 ] || printf ','
      first=0
      printf '{"id":%s,"cwd":%s,"status":"unknown"}' "$(json_string "$id")" "$(json_string "$cwd")"
    done
  printf ']}\n'
}

case "${1:-}" in
  list) list ;;
  send)
    tmux load-buffer -b review-desk-plugin -
    tmux paste-buffer -p -d -b review-desk-plugin -t "$2"
    tmux send-keys -t "$2" Enter
    ;;
  read) tmux capture-pane -p -t "$2" -S "-$3" ;;
  *) echo "usage: $0 list | send <id> | read <id> <lines>" >&2; exit 2 ;;
esac
