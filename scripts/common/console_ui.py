"""Utilidades comunes para salida estándar en scripts de consola."""

from __future__ import annotations

from typing import Any


def _fmt(level: str, msg: str, context: Any | None = None) -> str:
    """Formato estándar: [LEVEL] mensaje | contexto"""
    line = f"[{level}] {msg}"
    if context is not None:
        line = f"{line} | {context}"
    return line


def info(msg: str, context: Any | None = None) -> None:
    print(_fmt("INFO", msg, context))


def success(msg: str, context: Any | None = None) -> None:
    print(_fmt("OK", msg, context))


def warn(msg: str, context: Any | None = None) -> None:
    print(_fmt("WARN", msg, context))


def error(msg: str, context: Any | None = None) -> None:
    print(_fmt("ERROR", msg, context))


def step(msg: str, context: Any | None = None) -> None:
    print(_fmt("STEP", msg, context))


def table_header(columns: list[tuple[str, int]]) -> tuple[str, str]:
    """Devuelve encabezado y separador para tablas de ancho fijo reutilizable."""
    header = " | ".join(f"{title:<{width}}" for title, width in columns)
    sep = "-" * len(header)
    return header, sep


def table_row(values: list[str], widths: list[int]) -> str:
    return " | ".join(f"{value:<{width}}" for value, width in zip(values, widths))
