"""Small helpers shared by the CLI, in the shape of flask.helpers."""

from __future__ import annotations

import os

FALSE_VALUES = {"0", "false", "no"}


def get_verbose_flag(key: str = "MINIPKG_VERBOSE") -> bool:
    """Return True when the environment variable ``key`` is set to a truthy value.

    The values ``"0"``, ``"false"`` and ``"no"`` count as false. Any other
    non-empty value counts as true; an unset variable is false.
    """
    value = os.environ.get(key, "")
    return value.strip().lower() not in FALSE_VALUES and value != ""
