r"""压缩照片：photos/*.jpg 压到最长边 1024、质量 70；另生成 photos/thumb/ 缩略图（宽 480）
原图备份到 文档\guangzhou-travel-photos-original（只备份一次）。可重复运行。
用法：python tools/compress_photos.py
"""
import os, shutil
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "photos")
THUMB = os.path.join(SRC, "thumb")
BACKUP = os.path.join(os.path.expanduser("~"), "Documents", "guangzhou-travel-photos-original")
os.makedirs(THUMB, exist_ok=True)
os.makedirs(BACKUP, exist_ok=True)

before = after = 0
for fn in sorted(os.listdir(SRC)):
    if not fn.lower().endswith(".jpg"):
        continue
    p = os.path.join(SRC, fn)
    before += os.path.getsize(p)
    bk = os.path.join(BACKUP, fn)
    if not os.path.exists(bk):
        shutil.copy2(p, bk)
    im = ImageOps.exif_transpose(Image.open(bk)).convert("RGB")
    full = im.copy(); full.thumbnail((1024, 1024), Image.LANCZOS)
    full.save(p, "JPEG", quality=70, optimize=True, progressive=True)
    th = im.copy(); th.thumbnail((480, 480 * 3), Image.LANCZOS)
    th.save(os.path.join(THUMB, fn), "JPEG", quality=70, optimize=True, progressive=True)
    after += os.path.getsize(p)
    print(f"{fn:22s} {os.path.getsize(bk)//1024:5d} KB -> {os.path.getsize(p)//1024:4d} KB, thumb {os.path.getsize(os.path.join(THUMB, fn))//1024} KB")

tsum = sum(os.path.getsize(os.path.join(THUMB, f)) for f in os.listdir(THUMB))
print(f"大图合计 {before/1048576:.1f} MB -> {after/1048576:.1f} MB；缩略图合计 {tsum/1048576:.1f} MB；原图备份在 {BACKUP}")
