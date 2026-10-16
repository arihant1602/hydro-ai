# Flat corn app icon in the app palette. Writes icon.svg / fg.svg / mono.svg to the current directory; render with
#   for f in icon fg mono; do rsvg-convert -w 1024 -h 1024 $f.svg -o $f.png; done
# then copy to assets/icon.png, android-icon-foreground.png, android-icon-monochrome.png (favicon = icon at 48 px).
EMBER, IVORY, SOOT = '#D5360C', '#E6D5BD', '#101010'

def corn(cob, groove, husk, scale, mono=False):
    # Drawn upright around (0,0) in a ~ 600-unit box, then rotated 35deg and scaled.
    W, H = 250, 560            # cob width / height
    top, bot = -300, 260
    cob_path = (f"M{-W/2},{bot-60} L{-W/2},{top+170} C{-W/2},{top+40} {-60},{top} 0,{top} "
                f"C60,{top} {W/2},{top+40} {W/2},{top+170} L{W/2},{bot-60} "
                f"C{W/2},{bot+10} {W/4},{bot+40} 0,{bot+40} C{-W/4},{bot+40} {-W/2},{bot+10} {-W/2},{bot-60} Z")
    lines = []
    for x in (-W/6, W/6):                   # three kernel columns
        lines.append(f'<line x1="{x}" y1="{top-20}" x2="{x}" y2="{bot+60}"/>')
    y = top + 95
    while y < bot + 40:                     # kernel rows
        lines.append(f'<line x1="{-W}" y1="{y}" x2="{W}" y2="{y}"/>')
        y += 80
    # Husk leaves sweep up from the stem, hugging each side of the cob's lower half.
    left = f"M0,{bot+150} C-210,{bot+90} -250,{bot-160} -190,{top+150} C-150,{top+250} -60,{bot-120} 0,{bot+150} Z"
    right = f"M0,{bot+150} C220,{bot+110} 270,{bot-130} 225,{top+230} C170,{top+300} 60,{bot-90} 0,{bot+150} Z"
    stem = f'<rect x="-34" y="{bot+110}" width="68" height="110" rx="34" fill="{husk}"/>'
    if mono:
        g = (f'<mask id="m"><rect x="-2000" y="-2000" width="4000" height="4000" fill="#fff"/>'
             f'<g stroke="#000" stroke-width="22" stroke-linecap="round">{"".join(lines)}</g>'
             f'<path d="{left}" fill="#000" stroke="#000" stroke-width="36"/><path d="{right}" fill="#000" stroke="#000" stroke-width="36"/></mask>'
             f'<path d="{cob_path}" fill="{cob}" mask="url(#m)"/>{stem}<path d="{left}" fill="{husk}"/><path d="{right}" fill="{husk}"/>')
    else:
        g = (f'<clipPath id="c"><path d="{cob_path}"/></clipPath>'
             f'<path d="{cob_path}" fill="{cob}"/>'
             f'<g clip-path="url(#c)" stroke="{groove}" stroke-width="22" stroke-linecap="round">{"".join(lines)}</g>'
             f'{stem}<path d="{left}" fill="{husk}" stroke="{groove}" stroke-width="16" stroke-linejoin="round"/>'
             f'<path d="{right}" fill="{husk}" stroke="{groove}" stroke-width="16" stroke-linejoin="round"/>')
    return f'<g transform="translate(512 512) rotate(35) scale({scale}) translate(-10 -45)">{g}</g>'

def svg(body, bg=None):
    rect = f'<rect width="1024" height="1024" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">{rect}{body}</svg>'

open('icon.svg', 'w').write(svg(corn(IVORY, EMBER, SOOT, 0.84), EMBER))
open('fg.svg', 'w').write(svg(corn(IVORY, EMBER, SOOT, 0.66)))
open('mono.svg', 'w').write(svg(corn('#fff', '#000', '#fff', 0.66, mono=True)))
