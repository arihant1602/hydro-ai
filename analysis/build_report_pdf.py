"""report/REPORT.md -> report/REPORT.pdf (Markdown -> styled HTML -> headless Chromium)."""
import re
import subprocess
from pathlib import Path

import markdown

REPORT = Path(__file__).resolve().parent.parent / "report"
CSS = """
@page { size: A4; margin: 18mm 16mm; }
body { font: 10.5pt/1.5 "Inter", "Helvetica Neue", Arial, sans-serif; color: #1d2420; max-width: 100%; }
h1 { font-size: 21pt; margin: 0 0 4pt; color: #1f5f45; }
h2 { font-size: 14pt; margin: 18pt 0 6pt; color: #1f5f45; border-bottom: 1.5px solid #cfe3da; padding-bottom: 3pt;
     break-after: avoid; }
h3 { font-size: 11.5pt; margin: 12pt 0 4pt; break-after: avoid; }
p, li { text-align: left; }
hr { border: 0; border-top: 1px solid #dde3df; margin: 12pt 0; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9pt; break-inside: avoid; }
th, td { border: 1px solid #d6ddd8; padding: 3pt 5pt; vertical-align: top; }
th { background: #eef6f2; text-align: left; }
tr:nth-child(even) td { background: #fafcfb; }
img { max-width: 100%; max-height: 105mm; display: block; margin: 8pt auto 2pt; break-inside: avoid; }
img[alt^="Dashboard"] { max-width: 78%; max-height: none; border: 1px solid #d6ddd8; }
p:has(> img) + p > em, .cap { font-size: 8.5pt; }
code { font: 8.8pt "DejaVu Sans Mono", Menlo, monospace; font-variant-ligatures: none; background: #f1f4f2; padding: 0 2pt; border-radius: 2px; }
pre { background: #f1f4f2; padding: 6pt 8pt; border-radius: 4px; font-size: 8.5pt; break-inside: avoid; white-space: pre-wrap; }
pre code { background: none; padding: 0; }
strong { color: #13241b; }
"""


def normalize(md):
    """Python-Markdown is stricter than GitHub: lists need a blank line before them and nested
    content needs 4-space indents. Patch that up so REPORT.md can stay GitHub-style."""
    out, fence = [], False
    list_item = re.compile(r"^\s*(-|\d+\.) ")
    for line in md.splitlines():
        if line.startswith("```"):
            fence = not fence
        if not fence:
            m = re.match(r"^( {2,3})(\S.*)$", line)
            if m:
                line = "    " + m.group(2)
            if list_item.match(line) and out and out[-1].strip() and not list_item.match(out[-1]) \
                    and not out[-1].startswith("    "):
                out.append("")
        out.append(line)
    return "\n".join(out)


def main():
    md = normalize((REPORT / "REPORT.md").read_text())
    body = markdown.markdown(md, extensions=["tables", "fenced_code", "sane_lists"])
    # Turn each image's alt text into a visible caption.
    body = re.sub(r'<p><img alt="([^"]*)" src="([^"]*)" /></p>',
                  r'<figure><img alt="\1" src="\2"><figcaption class="cap" style="text-align:center;color:#6b746e">\1</figcaption></figure>',
                  body)
    html = REPORT / "REPORT.html"
    html.write_text(f'<!doctype html><html><head><meta charset="utf-8"><title>Hydro AI report</title>'
                    f"<style>{CSS}</style></head><body>{body}</body></html>")
    subprocess.run(["chromium", "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={REPORT / 'REPORT.pdf'}", html.as_uri()],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    html.unlink()
    print(REPORT / "REPORT.pdf")


if __name__ == "__main__":
    main()
