# Insta Studio のアイコン：墨色の角丸の地に、紙色の明朝体「IS」と、差し色の細い線
import sys
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
S = 1024
INK, PAPER, ACCENT = (28, 27, 25), (251, 250, 247), (47, 93, 80)
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=INK)
font = ImageFont.truetype("C:/Windows/Fonts/yumindb.ttf", int(S * 0.52))
text = "IS"
l, t, r, b = d.textbbox((0, 0), text, font=font)
w, h = r - l, b - t
x = (S - w) / 2 - l
y = (S - h) / 2 - t - S * 0.04
d.text((x, y), text, font=font, fill=PAPER)
# 文字の下に、差し色の細い線
lw = int(S * 0.30)
ly = int(y + t + h + S * 0.07)
d.rounded_rectangle([(S - lw) // 2, ly, (S + lw) // 2, ly + int(S * 0.022)], radius=int(S * 0.011), fill=(135, 170, 158))
for size, name in [(32, "favicon-32.png"), (180, "apple-touch-icon.png"), (512, "icon-512.png")]:
    img.resize((size, size), Image.LANCZOS).save(f"{out}/{name}")
print("ok")
