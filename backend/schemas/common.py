# coding: utf-8
"""Shared Pydantic models used across multiple routes."""
from pydantic import BaseModel


class ErrorResponse(BaseModel):
    success: bool = False
    error: str
    code: str = "INTERNAL_ERROR"
