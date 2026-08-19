# KorvixAI — production image for BOTH Railway services (web + worker).
#
# WHY THIS FILE EXISTS
# --------------------
# Railway made Railpack the default builder and put Nixpacks into
# maintenance mode. `builder = "NIXPACKS"` in railway.toml stopped
# being honoured, so every build fell through to Railpack, which
# installs Python through `mise`. `mise` now REQUIRES GitHub artifact
# attestations for the binaries it fetches, and the python-build-
# standalone assets it wanted predate attestations:
#
#   mise ERROR Failed to install core:python@3.11.9
#   No GitHub artifact attestations found for python@3.11.9
#
# Nothing in this repo changed — an upstream verification policy did.
# Neither railway.toml nor the Railway UI could steer away from it,
# because the Nixpacks path itself is no longer a reliable target.
#
# A Dockerfile removes the whole failure class: the interpreter ships
# INSIDE the base image, so `mise` is never invoked and there is no
# version resolution and no attestation check at build time.
#
# WHY 3.11 SPECIFICALLY (do not bump casually)
# --------------------------------------------
# Production has always run the 3.11 line, and requirements.txt has a
# hard ceiling below 3.13:
#
#   asyncpg==0.29.0          wheels cp38–cp312  (no cp313)
#   psycopg[binary]==3.1.18  wheels cp37–cp312  (no cp313)
#
# Railpack's own default is 3.13.2, which would fail a SECOND way:
# psycopg-binary has no 3.13 wheel at all. 3.12 is the ceiling for the
# current pins; 3.11 is what production already runs, so 3.11 it is.
# Bumping past 3.12 requires bumping those two pins first.
#
# ONE IMAGE, TWO SERVICES
# -----------------------
# The web service (uvicorn) and the worker service (Celery) build from
# this same Dockerfile and differ ONLY in their start command:
#   * web    — Railway service start command (see railway.toml header)
#   * worker — `startCommand` in railway.worker.toml
# Both need the identical dependency set (celery + redis are already in
# requirements.txt), so a single image is correct and keeps the two
# services byte-for-byte consistent.

FROM python:3.11-slim

# /app matches the working directory Nixpacks used. backend/core/paths.py
# falls back to BARE RELATIVE SQLite filenames under the CWD when no
# durable data dir is configured, so changing WORKDIR would move those
# files. (With KORVIX_DATA_DIR or RAILWAY_VOLUME_MOUNT_PATH set, paths are
# absolute and WORKDIR is irrelevant — but we must not break the fallback.)
WORKDIR /app

# Unbuffered stdout/stderr so Railway's log drain sees output immediately
# and nothing is lost in the block buffer when a process dies. Logging
# behaviour only — no application behaviour depends on it.
ENV PYTHONUNBUFFERED=1

# Dependencies first, in their own layer: requirements.txt changes far less
# often than application code, so this layer stays cached across deploys.
#
# No apt-get build toolchain is installed on purpose. Every pinned
# dependency ships a manylinux cp311 wheel (verified against PyPI for the
# compiled ones: asyncpg, psycopg-binary, argon2-cffi), so nothing compiles
# from source. If a future dependency DOES need to build, that surfaces
# here at build time — add the toolchain then, not speculatively now.
COPY requirements.txt ./
RUN python -m pip install --no-cache-dir --upgrade pip \
 && python -m pip install --no-cache-dir -r requirements.txt

# Application source. `.dockerignore` keeps the context lean (the repo root
# carries ~9 MB of PNG screenshots plus a local node_modules).
COPY . .

# FALLBACK ONLY — Railway's service start command takes precedence over
# this CMD, and both services set one:
#   * web    — the service's start command in the Railway dashboard
#   * worker — `startCommand` in railway.worker.toml
#
# It exists because (a) an image with no CMD cannot run without an explicit
# command, and (b) if the web service's start command were ever cleared,
# this boots the API rather than failing outright. It mirrors the Procfile
# `web:` line verbatim — including PYTHONHASHSEED=0, kept in the CMD rather
# than a global ENV so the worker's environment is unchanged. `api:app` is
# the repo-root entrypoint (see STABLE_CHECKPOINT.md); it re-exports the app
# from backend/api.py and degrades to a /health-only app if that import
# fails, so a fallback boot still passes the Railway healthcheck.
#
# NOTE: the Dockerfile builder does NOT read the Procfile — that was a
# Nixpacks/Railpack feature. This CMD is what replaces it in the image.
CMD ["sh", "-c", "PYTHONHASHSEED=0 exec python -m uvicorn api:app --host 0.0.0.0 --port ${PORT:-8080}"]
