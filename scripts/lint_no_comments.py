import ast
import io
import sys
import tokenize
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

EXCLUDED_PARTS = {
    ".git",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    "node_modules",
    ".agents",
}

SUPPORTED_EXTENSIONS = {".py", ".js", ".html"}


def check_python_source(source: str, path: Path) -> List[Tuple[Path, int, int, str]]:
    violations: List[Tuple[Path, int, int, str]] = []
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except tokenize.TokenError as exc:
        violations.append((path, 1, 0, f"TokenError: {exc}"))
        return violations

    for tok in tokens:
        if tok.type == tokenize.COMMENT:
            line, col = tok.start
            snippet = tok.string.strip()
            violations.append((path, line, col + 1, f"Python comment prohibited: {snippet[:60]}"))

    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError as exc:
        violations.append((path, exc.lineno or 1, exc.offset or 1, f"SyntaxError: {exc.msg}"))
        return violations

    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.body:
                first_stmt = node.body[0]
                if (
                    isinstance(first_stmt, ast.Expr)
                    and isinstance(first_stmt.value, ast.Constant)
                    and isinstance(first_stmt.value.value, str)
                ):
                    line = getattr(first_stmt, "lineno", 1)
                    col = getattr(first_stmt, "col_offset", 0) + 1
                    first_line = first_stmt.value.value.strip().splitlines()
                    preview = first_line[0] if first_line else ""
                    violations.append(
                        (path, line, col, f"Python docstring prohibited: {preview[:60]}")
                    )

    violations.sort(key=lambda item: (item[1], item[2]))
    return violations


def check_js_source(
    source: str,
    path: Path,
    base_line: int = 1,
) -> List[Tuple[Path, int, int, str]]:
    violations: List[Tuple[Path, int, int, str]] = []
    n = len(source)
    i = 0
    line = base_line
    col = 1
    state = "CODE"
    regex_allowed = True
    in_regex_charset = False

    def advance(chars: int = 1) -> None:
        nonlocal i, line, col
        for _ in range(chars):
            if i < n:
                if source[i] == "\n":
                    line += 1
                    col = 1
                else:
                    col += 1
                i += 1

    while i < n:
        ch = source[i]
        nxt = source[i + 1] if i + 1 < n else ""

        if state == "CODE":
            if ch in (" ", "\t", "\r", "\n"):
                advance(1)
                continue

            if ch == "/" and nxt == "/":
                start_line, start_col = line, col
                end_idx = source.find("\n", i)
                snippet = source[i : end_idx if end_idx != -1 else n].strip()
                violations.append(
                    (path, start_line, start_col, f"JS line comment prohibited: {snippet[:60]}")
                )
                if end_idx == -1:
                    break
                advance(end_idx - i + 1)
                regex_allowed = True
                continue

            if ch == "/" and nxt == "*":
                start_line, start_col = line, col
                end_idx = source.find("*/", i + 2)
                raw = source[i : (end_idx + 2) if end_idx != -1 else n]
                first_line = raw.strip().splitlines()
                preview = first_line[0] if first_line else "/* */"
                violations.append(
                    (path, start_line, start_col, f"JS block comment prohibited: {preview[:60]}")
                )
                if end_idx == -1:
                    break
                advance(end_idx + 2 - i)
                continue

            if ch == "'":
                state = "SINGLE_QUOTE"
                regex_allowed = False
                advance(1)
                continue

            if ch == '"':
                state = "DOUBLE_QUOTE"
                regex_allowed = False
                advance(1)
                continue

            if ch == "`":
                state = "TEMPLATE"
                regex_allowed = False
                advance(1)
                continue

            if ch == "/" and regex_allowed:
                state = "REGEX"
                in_regex_charset = False
                regex_allowed = False
                advance(1)
                continue

            if ch in "([{,;:?=!&|~^+-*%<>":
                regex_allowed = True
            elif ch in ")]}":
                regex_allowed = False
            else:
                regex_allowed = False

            advance(1)

        elif state == "SINGLE_QUOTE":
            if ch == "\\":
                advance(2)
            elif ch == "'":
                state = "CODE"
                advance(1)
            else:
                advance(1)

        elif state == "DOUBLE_QUOTE":
            if ch == "\\":
                advance(2)
            elif ch == '"':
                state = "CODE"
                advance(1)
            else:
                advance(1)

        elif state == "TEMPLATE":
            if ch == "\\":
                advance(2)
            elif ch == "`":
                state = "CODE"
                advance(1)
            else:
                advance(1)

        elif state == "REGEX":
            if ch == "\\":
                advance(2)
            elif ch == "[":
                in_regex_charset = True
                advance(1)
            elif ch == "]" and in_regex_charset:
                in_regex_charset = False
                advance(1)
            elif ch == "/" and not in_regex_charset:
                state = "CODE"
                advance(1)
            elif ch == "\n":
                state = "CODE"
                advance(1)
            else:
                advance(1)

    return violations


def check_html_source(source: str, path: Path) -> List[Tuple[Path, int, int, str]]:
    violations: List[Tuple[Path, int, int, str]] = []
    idx = 0
    while True:
        start = source.find("<!--", idx)
        if start == -1:
            break
        line = source.count("\n", 0, start) + 1
        last_nl = source.rfind("\n", 0, start)
        col = start - (last_nl + 1) + 1
        end = source.find("-->", start + 4)
        snippet_end = (end + 3) if end != -1 else len(source)
        raw = source[start:snippet_end].strip().splitlines()
        preview = raw[0] if raw else "<!-- -->"
        violations.append((path, line, col, f"HTML comment prohibited: {preview[:60]}"))
        if end == -1:
            break
        idx = end + 3

    violations.sort(key=lambda item: (item[1], item[2]))
    return violations


def check_file(path: Path) -> List[Tuple[Path, int, int, str]]:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        return []
    source = path.read_text(encoding="utf-8")
    if suffix == ".py":
        return check_python_source(source, path)
    if suffix == ".js":
        return check_js_source(source, path)
    if suffix == ".html":
        return check_html_source(source, path)
    return []


def collect_target_files(paths: Iterable[str]) -> List[Path]:
    collected: List[Path] = []
    seen = set()

    raw_paths = list(paths) or ["."]
    for raw in raw_paths:
        target = Path(raw)
        if not target.exists():
            continue
        if target.is_file():
            if not any(part in EXCLUDED_PARTS for part in target.parts):
                if target.suffix.lower() in SUPPORTED_EXTENSIONS and target not in seen:
                    seen.add(target)
                    collected.append(target)
        elif target.is_dir():
            for child in sorted(target.rglob("*")):
                if not child.is_file():
                    continue
                if any(part in EXCLUDED_PARTS for part in child.parts):
                    continue
                if child.suffix.lower() in SUPPORTED_EXTENSIONS and child not in seen:
                    seen.add(child)
                    collected.append(child)

    return collected


def main(argv: Optional[List[str]] = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    files = collect_target_files(args)
    all_violations: List[Tuple[Path, int, int, str]] = []

    for file_path in files:
        all_violations.extend(check_file(file_path))

    if all_violations:
        for file_path, line, col, msg in all_violations:
            print(f"{file_path}:{line}:{col}: NOCOMMENT001 {msg}", file=sys.stderr)
        print(
            f"\nFound {len(all_violations)} prohibited comment/docstring violation(s) across {len(files)} scanned file(s).",
            file=sys.stderr,
        )
        return 1

    print(f"No-comment lint passed ({len(files)} file(s) scanned, 0 comments/docstrings found).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
