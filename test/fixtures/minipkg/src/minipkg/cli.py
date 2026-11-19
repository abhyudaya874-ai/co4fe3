"""The minipkg command line interface, in the shape of flask.cli."""

from __future__ import annotations

import click

from .helpers import get_verbose_flag


class MinipkgGroup(click.Group):
    """A click Group that registers minipkg's built-in commands."""

    def __init__(self, add_default_commands: bool = True) -> None:
        super().__init__("minipkg")
        if add_default_commands:
            self.add_command(routes_command)
            self.add_command(shell_command)


@click.command("routes", short_help="Show the routes for the app.")
def routes_command() -> None:
    """List the fake routes minipkg serves."""
    for route, endpoint in [("/", "index"), ("/help", "help")]:
        click.echo(f"{route:<12} {endpoint}")


@click.command("shell", short_help="Run a shell inside the app environment.")
def shell_command() -> None:
    """Report the verbose flag and pretend to start a shell."""
    click.echo(f"verbose={get_verbose_flag()}")
    click.echo("shell not available in the fixture")


def main() -> None:
    MinipkgGroup()


if __name__ == "__main__":
    main()
