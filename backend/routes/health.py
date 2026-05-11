# coding: utf-8
# Phase 5.3 — /health now exposes Railway-injected build metadata so the
# post-deploy GitHub Actions workflow can verify the new build is live.
#
# Railway automatically sets:
#   RAILWAY_GIT_COMMIT_SHA       — full SHA of the deployed commit
#   RAILWAY_GIT_BRANCH           — source branch (usually "main")
#   RAILWAY_DEPLOYMENT_ID        — unique per-deploy id
#   RAILWAY_ENVIRONMENT          — "production" / "staging" / ...
#
# Stays backward compatible: existing `status` and `version` keys preserved.
import os
import time
from fastapi import APIRouter

router = APIRouter(tags=["system"])

# Pid + start time captured ONCE at import — uptime is derived from this so
# the value is meaningful across the process lifetime, not the request.
_STARTED_AT = time.time()


@router.get("/health")
async def health_check() -> dict:
    """Railway health probe — must respond quickly (no I/O)."""
    sha = os.getenv("RAILWAY_GIT_COMMIT_SHA", "")
    return {
        "status":         "ok",
        "version":        "3.0.0",
        "build": {
            "commit_sha":      sha,
            "commit_sha_short": sha[:7] if sha else "",
            "branch":          os.getenv("RAILWAY_GIT_BRANCH", ""),
            "deployment_id":   os.getenv("RAILWAY_DEPLOYMENT_ID", ""),
            "environment":     os.getenv("RAILWAY_ENVIRONMENT", os.getenv("ENVIRONMENT", "")),
        },
        "uptime_seconds": round(time.time() - _STARTED_AT, 1),
    }
