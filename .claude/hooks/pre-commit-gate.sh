#!/bin/zsh
# Pre-commit gate (Claude Code PreToolUse hook on Bash).
# When Claude tries to run `git commit`, run the FAST frontend gate first and BLOCK the
# commit (exit 2) if it fails. Backend (mvn) is left to `/gate` so this stays env-light and quick.
# Bypass: this only governs Claude's commits, not your own terminal commits.

input=$(cat)
cmd=$(printf '%s' "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

# only act on git commits
case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root/frontend" 2>/dev/null || exit 0   # no frontend ⇒ nothing to gate

if ! npx tsc --noEmit >/tmp/gate_tsc.log 2>&1; then
  echo "BLOCKED: pre-commit gate failed — frontend type errors (tsc --noEmit). Fix them, then commit. Details:" >&2
  tail -20 /tmp/gate_tsc.log >&2
  exit 2
fi
if ! npm test --silent >/tmp/gate_test.log 2>&1; then
  echo "BLOCKED: pre-commit gate failed — frontend tests (npm test) are red. Fix them, then commit. Details:" >&2
  tail -25 /tmp/gate_test.log >&2
  exit 2
fi

# Frontend green. Remind about the backend half (not run here to avoid JAVA_HOME/Mongo flakiness).
echo "Frontend gate passed. Before relying on this commit, run the backend gate too: \`cd backend && mvn test\` (and \`RUN_MONGO_TESTS=1 mvn test\` if you touched an endpoint/DTO/repo/domain). See /gate." >&2
exit 0
