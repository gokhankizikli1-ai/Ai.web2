#!/bin/sh
# KorvixAI — the WEB service start command. One definition, one place.
#
# THE INCIDENT THIS FILE EXISTS TO PREVENT (production, crash loop)
# -----------------------------------------------------------------
#   Error: Invalid value for '--port': '$PORT' is not a valid integer.
#
# uvicorn received the four literal characters `$PORT`. Nothing had
# expanded them, so click rejected the value, the process exited, and
# Railway restarted the container — continuously.
#
# WHY IT STARTED HAPPENING
# ------------------------
# The web service's start command lived ONLY in the Railway dashboard
# ("Settings → Deploy → Custom Start Command"), as `railway.toml` used to
# state deliberately. Under the old Nixpacks builder that string was run
# THROUGH A SHELL, so `--port $PORT` expanded and worked for years.
#
# Migrating both services to the Dockerfile builder changed how that same
# string is executed: Railway applies it as the container's command
# directly, with no shell in between. `$PORT` is then just an argument.
# The repository did not change; the execution model under it did.
#
# (The image's own CMD was never the failing command — it always wrapped
# itself in `sh -c` and used the root `api:app` entrypoint, while the
# error names `backend.api:app`. That is how we know the string came from
# the dashboard and not from this repo.)
#
# WHY A SCRIPT RATHER THAN A LONGER START COMMAND
# -----------------------------------------------
# The fix has to survive not knowing how Railway tokenizes a start
# command. A command containing quotes (`sh -c '…'`) is only safe if the
# platform splits it with shell quoting rules; a bare `sh scripts/start-web.sh`
# is three whitespace-separated tokens with no quotes and no metacharacters,
# so it means the same thing whether the platform splits naively, splits
# with shell rules, or wraps the whole string in a shell.
#
# The expansion then happens HERE, in a real shell, where it is guaranteed.
#
# Both start paths point at this file — `startCommand` in `railway.toml`
# and the image's `CMD` — so the web service cannot boot two different
# ways, and neither can drift from the other.
set -e

# Railway injects PORT. `:-` covers unset AND empty, so a blank value
# cannot reach uvicorn either. 8080 is the pre-existing fallback this
# image already shipped; it is deliberately unchanged, because Railway's
# proxy assumes 8080 when a service has no PORT of its own.
#
# NOTE: `backend/core/config.py` also defines `PORT` (default 8000), but
# nothing reads it — the listening port has always come from this
# argument. Left alone rather than quietly made load-bearing here.
PORT="${PORT:-8080}"

# PYTHONHASHSEED=0 is inherited verbatim from the Procfile `web:` line and
# the previous CMD. Exported here rather than as a Dockerfile ENV so the
# worker service, which shares this image, keeps its own environment.
export PYTHONHASHSEED=0

# `exec` so uvicorn replaces this shell and receives SIGTERM directly —
# Railway's graceful shutdown depends on it.
#
# `api:app` is the canonical root entrypoint (see `api.py`): it re-exports
# the app from `backend/api.py` and degrades to a /health-only app if that
# import fails, so a broken import still answers the Railway healthcheck
# instead of crash-looping. This is the entrypoint the image already used.
exec python -m uvicorn api:app --host 0.0.0.0 --port "$PORT"
