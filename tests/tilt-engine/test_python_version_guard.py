# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""The engine suite skips cleanly on interpreters older than the documented minimum (#4304)."""

import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from conftest import (
    MIN_TEST_PYTHON,
    asyncio_plugin_missing,
    pytest_ignore_collect,
    unsupported_python,
)


def test_minimum_matches_the_documented_python_version():
    assert MIN_TEST_PYTHON == (3, 10)
    assert unsupported_python((3, 9)) is True
    assert unsupported_python((3, 10)) is False
    assert unsupported_python((3, 12, 10)) is False


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("test_code_executor.py", True),
        ("test_manifest_properties.py", True),
        ("conftest.py", False),
    ],
)
def test_older_interpreters_ignore_test_modules_but_not_conftest(monkeypatch, name, expected):
    monkeypatch.setattr("conftest._running_version", lambda: (3, 9, 0))
    # True excludes the path; None leaves the decision to pytest (--ignore, collect_ignore, defaults).
    assert pytest_ignore_collect(Path("/work/tests/tilt-engine") / name, None) is (True if expected else None)


def test_supported_interpreters_leave_collection_to_pytest(monkeypatch):
    monkeypatch.setattr("conftest._running_version", lambda: (3, 10, 0))
    assert pytest_ignore_collect(Path("/work/tests/tilt-engine/test_code_executor.py"), None) is None


def _run_pytest_on_simulated_old_python(tmp_path, args):
    """Run pytest in a scratch rootdir whose conftest is this suite's, with the interpreter reported as 3.9."""
    engine_conftest = Path(__file__).with_name("conftest.py")
    (tmp_path / "conftest.py").write_text(textwrap.dedent(f"""
        import importlib.util
        spec = importlib.util.spec_from_file_location("engine_conftest", {str(engine_conftest)!r})
        engine = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(engine)
        engine._running_version = lambda: (3, 9, 0)
        pytest_configure = engine.pytest_configure
        pytest_ignore_collect = engine.pytest_ignore_collect
        pytest_pycollect_makemodule = engine.pytest_pycollect_makemodule
    """))
    (tmp_path / "test_new_syntax.py").write_text('raise RuntimeError("module was imported")\n')
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-p", "no:cacheprovider", "-W", "default", *args],
        cwd=tmp_path, capture_output=True, text=True, timeout=120,
    )


@pytest.mark.parametrize("args", [[], ["test_new_syntax.py"], ["test_new_syntax.py::test_anything"]])
def test_older_interpreter_never_imports_engine_modules_even_when_named_explicitly(tmp_path, args):
    result = _run_pytest_on_simulated_old_python(tmp_path, args)
    output = result.stdout + result.stderr
    assert "module was imported" not in output, output
    assert "require Python 3.10+" in output, output


def test_async_plugin_is_required_even_on_a_supported_interpreter():
    assert asyncio_plugin_missing(lambda name: None) is True
    assert asyncio_plugin_missing(lambda name: object() if name == "pytest_asyncio" else None) is False
