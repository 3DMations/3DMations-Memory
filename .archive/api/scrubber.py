"""
scrubber.py — Credential and secret scrubber for Memory Hub entries.

Applies X1-X4 security rules from .claude/rules/audit-rules.md.
Scans entry text fields and replaces detected secrets with [REDACTED].

NOTE: The 64-char threshold avoids false positives on git SHAs (40 chars),
UUIDs (32-36 chars), and typical base64 hashes (44 chars). Only unusually
long unbroken alphanumeric strings are caught by the catch-all pattern.
"""
import re
from typing import Any

# X1 patterns — ordered most-specific first, catch-all last
_PATTERNS: list[tuple[str, str]] = [
    (r"ghp_[a-zA-Z0-9]{36,}", "[REDACTED:github-pat]"),
    (r"AKIA[0-9A-Z]{16}", "[REDACTED:aws-key]"),
    (r"xox[bps]-[a-zA-Z0-9\-]+", "[REDACTED:slack-token]"),
    (r"sk-[a-zA-Z0-9]{20,}", "[REDACTED:openai-key]"),
    (r"Bearer\s+[a-zA-Z0-9\-._~+/]{20,}", "[REDACTED:bearer-token]"),
    (r"password\s*[:=]\s*\S+", "[REDACTED:password]"),
    (r"secret\s*[:=]\s*\S+", "[REDACTED:secret]"),
    (r"[A-Za-z0-9_\-]{64,}", "[REDACTED:long-token]"),
]

_COMPILED = [(re.compile(p, re.IGNORECASE), r) for p, r in _PATTERNS]

_TEXT_FIELDS = frozenset({
    "title", "trigger_context", "root_cause",
    "what_happened", "correct_solution", "prevention_rule", "context_notes",
})


def scrub(text: str) -> str:
    """Remove credentials from a text string."""
    if not text:
        return text
    for pattern, replacement in _COMPILED:
        text = pattern.sub(replacement, text)
    return text


def scrub_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """Scrub all text fields of a memory entry dict in-place clone."""
    return {
        k: scrub(v) if k in _TEXT_FIELDS and isinstance(v, str) else v
        for k, v in entry.items()
    }
