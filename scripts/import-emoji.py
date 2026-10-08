"""Generate the bundled Unicode 17 emoji catalogue from official emoji-test.txt.

Usage: python scripts/import-emoji.py <emoji-test.txt> <unicode-license.txt>
Source: https://unicode.org/Public/17.0.0/emoji/emoji-test.txt
"""
import json
import pathlib
import re
import sys

groups = []
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    if line.startswith("# group: "):
        groups.append({"name": line.removeprefix("# group: "), "entries": []})
    match = re.match(r"^([0-9A-F ]+)\s*; fully-qualified\s*# \S+ E[\d.]+ (.+)$", line)
    if match:
        emoji = "".join(chr(int(point, 16)) for point in match[1].split())
        groups[-1]["entries"].append({"emoji": emoji, "name": match[2]})

destination = pathlib.Path(__file__).resolve().parents[1] / "frontend/src/lib/emoji"
destination.mkdir(parents=True, exist_ok=True)
(destination / "catalogue.json").write_text(
    json.dumps([group for group in groups if group["entries"]], ensure_ascii=False, separators=(",", ":")) + "\n",
    encoding="utf-8",
)
(destination / "UNICODE-LICENSE.txt").write_text(
    pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"), encoding="utf-8"
)
print(f"Imported {sum(len(group['entries']) for group in groups)} emoji")
