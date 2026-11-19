"""檢查 theme.css 的顏色是否和 DESIGN.md 的設計規範一致。

用法：python3 tests/check_design_tokens.py
DESIGN.md 是正式數值；theme.css 是實作。改顏色時兩邊要一起改。
"""
import pathlib
import re
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
# DESIGN.md token → theme.css 變數
MAPPING = {
    "primary": "--primary", "on-primary": "--on-primary", "primary-container": "--primary-soft",
    "ink": "--ink", "secondary": "--ink-2", "muted": "--ink-3",
    "neutral": "--bg", "surface": "--surface", "surface-dim": "--surface-2", "surface-chip": "--surface-3",
    "outline": "--line", "outline-strong": "--line-strong", "outline-field": "--field",
    "accent": "--brand", "chart-1": "--series-1",
    "success": "--ok", "success-container": "--ok-bg", "info": "--info", "info-container": "--info-bg",
    "warning": "--warn", "warning-container": "--warn-bg", "error": "--danger", "error-container": "--danger-bg",
}
# 只在淺色模式設定、深色模式沿用的 token
LIGHT_ONLY = {"accent"}


def front_matter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        sys.exit("DESIGN.md 沒有 front matter")
    return yaml.safe_load(m.group(1))


def css_vars(block):
    return {k: v.strip().lower() for k, v in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", block)}


def main():
    tokens = front_matter((ROOT / "DESIGN.md").read_text(encoding="utf-8"))["colors"]
    css = (ROOT / "theme.css").read_text(encoding="utf-8")
    light = css_vars(re.search(r"\n:root \{(.*?)\n\}", css, re.S).group(1))
    dark_blocks = [
        css_vars(re.search(r":root:where\(:not\(\[data-theme=\"light\"\]\)\) \{(.*?)\n  \}", css, re.S).group(1)),
        css_vars(re.search(r"\n:root\[data-theme=\"dark\"\] \{(.*?)\n\}", css, re.S).group(1)),
    ]
    problems = []
    for token, var in MAPPING.items():
        want = str(tokens[token]).lower()
        if light.get(var) != want:
            problems.append(f"淺色 {var}：theme.css 是 {light.get(var)}，DESIGN.md {token} 是 {want}")
        if token in LIGHT_ONLY:
            continue
        want_dark = str(tokens[token + "-dark"]).lower() if token + "-dark" in tokens else None
        if want_dark is None:
            problems.append(f"DESIGN.md 缺少 {token}-dark")
            continue
        for i, block in enumerate(dark_blocks):
            if block.get(var) != want_dark:
                where = "系統深色模式" if i == 0 else "data-theme=dark"
                problems.append(f"{where} {var}：theme.css 是 {block.get(var)}，DESIGN.md {token}-dark 是 {want_dark}")
    for p in problems:
        print("FAIL " + p)
    print(f"{'FAIL' if problems else 'PASS'} design tokens：檢查 {len(MAPPING)} 個顏色（淺色＋兩組深色）")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
