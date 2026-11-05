"""从 Wikipedia / Wikimedia Commons 下载开放授权（CC / 公有领域）的广州景点照片，
生成 data/photos.js（含作者、授权信息，用于署名）。
用法：python tools/fetch_photos.py
"""
import json, os, re, sys, time, urllib.parse, urllib.request, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "photos")
os.makedirs(OUT_DIR, exist_ok=True)
UA = {"User-Agent": "GuangzhouTravelMap/1.0 (personal non-commercial travel guide)"}

# (文件名, 英文维基条目 或 'commons:搜索词', 中文标题, 对应地图景点名, 分组)
ITEMS = [
    ("canton_tower", "Canton Tower", "广州塔（小蛮腰）", "广州塔（小蛮腰）", "城市地标"),
    ("huacheng_square", "Huacheng Square", "花城广场", "花城广场", "城市地标"),
    ("opera_house", "Guangzhou Opera House", "广州大剧院", "广州大剧院", "城市地标"),
    ("gd_museum", "Guangdong Museum", "广东省博物馆", "广东省博物馆", "城市地标"),
    ("ifc", "Guangzhou International Finance Center", "广州国际金融中心（西塔）", "广州国际金融中心（西塔）", "城市地标"),
    ("ctf", "Guangzhou CTF Finance Centre", "周大福金融中心（东塔）", "广州周大福金融中心（东塔）", "城市地标"),
    ("tianhe_sports", "Tianhe Sports Center", "天河体育中心", "天河体育中心", "城市地标"),
    ("zhujiang_newtown", "Zhujiang New Town", "珠江新城天际线", "花城广场", "城市地标"),
    ("chen_clan", "Chen Clan Ancestral Hall", "陈家祠", "陈家祠", "岭南古韵"),
    ("shamian", "Shamian Island", "沙面岛", "沙面岛", "岭南古韵"),
    ("sun_yatsen_hall", "Sun Yat-sen Memorial Hall (Guangzhou)", "中山纪念堂", "中山纪念堂", "岭南古韵"),
    ("zhenhai_tower", "Zhenhai Tower", "镇海楼", "镇海楼（广州博物馆）", "岭南古韵"),
    ("five_rams", "commons:Five Rams Statue Yuexiu Park", "五羊石像", "越秀公园 · 五羊石像", "岭南古韵"),
    ("nanyue", "Museum of the Mausoleum of the Nanyue King", "南越王博物院", "南越王博物院（王墓展区）", "岭南古韵"),
    ("sacred_heart", "commons:Sacred Heart Cathedral Guangzhou", "石室圣心大教堂", "石室圣心大教堂", "岭南古韵"),
    ("guangxiao", "commons:Guangxiao Temple Guangzhou", "光孝寺", "光孝寺", "岭南古韵"),
    ("six_banyan", "Temple of the Six Banyan Trees", "六榕寺花塔", "六榕寺 · 花塔", "岭南古韵"),
    ("dafo", "commons:Dafo Temple Guangzhou", "大佛寺", "大佛寺", "岭南古韵"),
    ("beijing_road", "commons:Beijing Road Guangzhou pedestrian", "北京路步行街", "北京路步行街", "街巷烟火"),
    ("shangxiajiu", "Shangxiajiu Pedestrian Street", "上下九骑楼街", "上下九步行街", "街巷烟火"),
    ("yongqingfang", "commons:Yongqingfang Guangzhou", "永庆坊", "永庆坊", "街巷烟火"),
    ("lizhiwan", "commons:Liwan Lake Guangzhou", "荔湾湖公园", "荔湾湖公园", "街巷烟火"),
    ("dongshankou", "commons:Xinhepu Guangzhou", "东山洋楼", "东山口 · 新河浦", "街巷烟火"),
    ("white_swan", "White Swan Hotel", "白天鹅宾馆", "白天鹅宾馆", "街巷烟火"),
    ("haizhu_bridge", "Haizhu Bridge", "海珠桥", "海珠广场", "珠江风光"),
    ("pearl_river", "commons:Pearl River Guangzhou night", "珠江夜景", "海心沙", "珠江风光"),
    ("botanical", "South China Botanical Garden", "华南国家植物园", "华南国家植物园", "珠江风光"),
    ("yuexiu_park", "Yuexiu Park", "越秀公园", "越秀公园 · 五羊石像", "珠江风光"),
    ("dimsum", "Dim sum", "早茶点心", "", "广州味道"),
    ("har_gow", "Har gow", "虾饺", "", "广州味道"),
    ("char_siu", "Char siu", "叉烧", "", "广州味道"),
    ("cheung_fun", "Rice noodle roll", "肠粉", "", "广州味道"),
    ("wonton_noodle", "Wonton noodles", "云吞面", "", "广州味道"),
    ("double_skin", "Double skin milk", "双皮奶", "", "广州味道"),
    ("roast_goose", "Roast goose", "烧鹅", "", "广州味道"),
    ("white_cut", "White cut chicken", "白切鸡", "", "广州味道"),
    ("congee", "Teochew porridge", "生滚粥", "", "广州味道"),
    ("egg_tart", "Egg tart", "蛋挞", "", "广州味道"),
]


def fetch(url, timeout=40):
    for attempt in range(5):
        try:
            time.sleep(1.5)
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            if attempt == 4:
                raise
            wait = 8 * (attempt + 1)
            print("  retry in", wait, "s:", e)
            time.sleep(wait)


def get_json(url):
    return json.loads(fetch(url).decode("utf-8"))


def strip_html(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def file_from_wiki(title):
    q = urllib.parse.urlencode({"action": "query", "titles": title, "prop": "pageimages",
                                "piprop": "name", "format": "json", "redirects": 1})
    d = get_json("https://en.wikipedia.org/w/api.php?" + q)
    for p in d["query"]["pages"].values():
        if p.get("pageimage"):
            return "File:" + p["pageimage"]
    return None


def file_from_commons(term):
    q = urllib.parse.urlencode({"action": "query", "list": "search", "srsearch": term + " filetype:bitmap",
                                "srnamespace": 6, "srlimit": 10, "format": "json"})
    d = get_json("https://commons.wikimedia.org/w/api.php?" + q)
    for s in d["query"]["search"]:
        t = s["title"]
        if re.search(r"\.(jpe?g)$", t, re.I) and not re.search(r"map|logo|station|metro|exit|plan", t, re.I):
            return t
    return None


def file_info(ftitle):
    q = urllib.parse.urlencode({"action": "query", "titles": ftitle, "prop": "imageinfo",
                                "iiprop": "url|extmetadata|size", "iiurlwidth": 1280, "format": "json"})
    d = get_json("https://commons.wikimedia.org/w/api.php?" + q)
    p = next(iter(d["query"]["pages"].values()))
    ii = p["imageinfo"][0]
    md = ii.get("extmetadata", {})
    return {
        "thumb": ii.get("thumburl") or ii["url"],
        "page": ii.get("descriptionurl"),
        "author": strip_html(md.get("Artist", {}).get("value", "")) or "未知",
        "license": strip_html(md.get("LicenseShortName", {}).get("value", "")) or "见原页面",
    }


# 读取已有结果，已下载的跳过（断点续传）
JS_PATH = os.path.join(ROOT, "data", "photos.js")
done = {}
if os.path.exists(JS_PATH):
    txt = open(JS_PATH, encoding="utf-8").read()
    m = re.search(r"window\.PHOTOS = (\[.*\]);", txt, re.S)
    if m:
        for p in json.loads(m.group(1)):
            if os.path.exists(os.path.join(ROOT, p["file"])):
                done[p["file"]] = p

photos = []
for fname, src, title, spot, group in ITEMS:
    path = os.path.join(OUT_DIR, fname + ".jpg")
    key = "photos/" + fname + ".jpg"
    if key in done:
        p = done[key]; p.update({"title": title, "spot": spot, "group": group})
        photos.append(p); continue
    try:
        ftitle = file_from_commons(src[8:]) if src.startswith("commons:") else file_from_wiki(src)
        if not ftitle:
            print("NO IMAGE", src); continue
        info = file_info(ftitle)
        data = fetch(info["thumb"], timeout=90)
        with open(path, "wb") as f:
            f.write(data)
        photos.append({"file": key, "title": title, "spot": spot, "group": group,
                       "author": info["author"][:80], "license": info["license"], "source": info["page"]})
        print("OK", fname, ftitle, info["license"])
    except Exception as e:
        print("FAIL", fname, e)

os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
with open(os.path.join(ROOT, "data", "photos.js"), "w", encoding="utf-8") as f:
    f.write("// 自动生成：tools/fetch_photos.py；图片来自 Wikimedia Commons，均为开放授权，使用时需保留署名\n")
    f.write("window.PHOTOS = " + json.dumps(photos, ensure_ascii=False, indent=1) + ";\n")
print("total", len(photos))
