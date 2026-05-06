"""Utilidades de consola para scripts ejecutados desde lanzadores Windows."""

from __future__ import annotations

import sys


def configure_console_utf8(line_buffering: bool = True) -> None:
    """Asegura stdin/stdout/stderr en consola real y codificación UTF-8."""
    try:
        if sys.stdout is None or getattr(sys.stdout, "name", "").upper() == "NUL":
            sys.stdout = open("CONOUT$", "w", encoding="utf-8")
            sys.stderr = open("CONOUT$", "w", encoding="utf-8")
            sys.stdin = open("CONIN$", "r", encoding="utf-8")
    except Exception:
        pass

    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", line_buffering=line_buffering)
        except Exception:
            pass
