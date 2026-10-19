# Project workflow

- Keep local Git history for completed functional changes. Inspect `git status`
  before editing and preserve unrelated user changes. After the appropriate checks,
  create a local commit for the completed task unless the user asks otherwise.
- Do not push to GitHub unless the user explicitly requests it. Do not rewrite
  history or run a destructive reset without an explicit rollback request.
- Before changing an existing database or performing data migrations, create a
  checkpoint with `python tools/create_checkpoint.py <short-label>`. Code rollback
  and database rollback are separate operations; preserve the current database
  before any restore.
- The portable Git executable in this Windows workspace is
  `.cache/runtime/git/cmd/git.exe`; use installed Git when available elsewhere.
  The portable Python executable is `.cache/runtime/python/python.exe`.
- Keep runtime databases, uploads, secrets, dependencies and `.snapshots` out of
  commits. Generate optional demo data locally; do not track database snapshots.
- Use the isolated demo for development. Do not change external servers as part
  of local work unless requested.
