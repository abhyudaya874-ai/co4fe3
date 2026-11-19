"""CliRunner tests for minipkg's built-in commands."""

from __future__ import annotations

from click.testing import CliRunner

from minipkg.cli import MinipkgGroup


def test_help_lists_builtins() -> None:
    result = CliRunner().invoke(MinipkgGroup(), ["--help"])
    assert result.exit_code == 0
    for name in ("routes", "shell"):
        assert name in result.output


def test_routes_lists_paths() -> None:
    result = CliRunner().invoke(MinipkgGroup(), ["routes"])
    assert result.exit_code == 0
    assert "/" in result.output
    assert "/help" in result.output


def test_shell_reports_verbose(monkeypatch) -> None:
    monkeypatch.setenv("MINIPKG_VERBOSE", "1")
    result = CliRunner().invoke(MinipkgGroup(), ["shell"])
    assert result.exit_code == 0
    assert "verbose=True" in result.output
