# coding: utf-8
import os
from fastapi import Header, HTTPException, status

VELORA_API_KEY = os.getenv("VELORA_API_KEY", "")


def verify_api_key(x_api_key: str = Header(default="")):
    """
    Optional API key check.
    If VELORA_API_KEY is set in env, all requests must provide it.
    If not set, all requests pass (open mode for development).
    """
    if not VELORA_API_KEY:
        return True  # open mode
    if x_api_key != VELORA_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "invalid_api_key", "message": "Invalid or missing API key"},
        )
    return True
