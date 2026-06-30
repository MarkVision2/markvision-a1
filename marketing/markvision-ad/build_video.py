#!/usr/bin/env python3
import subprocess, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
import imageio_ffmpeg
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
AUDIO = os.path.join(HERE, "voice.mp3")
ASS = os.path.join(HERE, "subs.ass")
OUT = os.path.join(HERE, "markvision_ad.mp4")
W, H, FPS = 1080, 1920, 30

p = subprocess.run([FFMPEG, "-i", AUDIO], stderr=subprocess.PIPE, text=True)
m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", p.stderr)
dur = int(m[1])*3600 + int(m[2])*60 + float(m[3])
TOTAL = round(dur + 0.5, 2)
print("audio", dur, "total", TOTAL)

# ---- timeline (weights proportional to spoken length) ----
segs = [
    ("head", "Я упростил жизнь\nтаргетологам", 13),
    ("head", "Решение, где денег больше,\nа работы — меньше", 17),
    ("head", "Ты не боишься\nбольших чеков", 14),
    ("head", "Результат вытащит\n{gold}система", 13),
    ("big",  "Она работает за тебя\n{gold}24 / 7", 14),
    ("head", "Звучит как сказка?\nЗнаю.", 10),
    ("head", "Дело не в опыте —\nа в системе,\nкоторая пашет за тебя", 18),
    ("head", "Хочешь увидеть,\nкак она работает?", 13),
    ("cta",  "", 9),
    ("head", "Мест немного.\nНе хочу плодить\nконкурентов", 14),
]
wsum = sum(w for *_, w in segs)
t = 0.0
timed = []
for kind, txt, w in segs:
    s, e = t, t + TOTAL*w/wsum
    timed.append([kind, txt, round(s, 2), round(e, 2)])
    t = e
timed[-1][3] = TOTAL

def ts(x):
    cs = int(round(x*100)); h=cs//360000; cs%=360000; mm=cs//6000; cs%=6000; ss=cs//100; cc=cs%100
    return f"{h}:{mm:02d}:{ss:02d}.{cc:02d}"

GOLD="&H42C5F5&"; WHITE="&HFFFFFF&"; GREEN="&H80DE4A&"; DARK="&H20100B&"
def body(txt):
    txt = txt.replace("{gold}", "{\\1c"+GOLD+"}")
    return txt.replace("\n", "\\N")

events = []
def ev(start, end, style, text, layer=0):
    events.append(f"Dialogue: {layer},{ts(start)},{ts(end)},{style},,0,0,0,,{text}")

# brand (persistent)
ev(0, TOTAL, "Brand", "{\\fad(400,400)}MARKVISION")
ev(0, TOTAL, "Tag", "система, которая работает за тебя")

# headline segments
for kind, txt, s, e in timed:
    if kind == "cta":
        # gold rounded button (drawing) + label + supporting lines
        bx0, bx1, by0, by1, r = 250, 830, 980, 1090, 20
        draw = (f"m {bx0+r} {by0} l {bx1-r} {by0} b {bx1} {by0} {bx1} {by0} {bx1} {by0+r} "
                f"l {bx1} {by1-r} b {bx1} {by1} {bx1} {by1} {bx1-r} {by1} "
                f"l {bx0+r} {by1} b {bx0} {by1} {bx0} {by1} {bx0} {by1-r} "
                f"l {bx0} {by0+r} b {bx0} {by0} {bx0} {by0} {bx0+r} {by0}")
        ev(s, e, "Head", "{\\fad(300,300)\\pos(540,840)}Тогда жми", layer=1)
        ev(s, e, "Btn", "{\\fad(300,300)\\an7\\pos(0,0)\\1c"+GOLD+"\\bord0\\shad0\\p1}"+draw+"{\\p0}", layer=2)
        ev(s, e, "BtnTxt", "{\\fad(300,300)\\pos(540,1035)}ПОДРОБНЕЕ", layer=3)
        ev(s, e, "Sub", "{\\fad(300,300)\\pos(540,1200)}Мест немного — не хочу плодить конкурентов", layer=3)
    else:
        style = "Big" if kind == "big" else "Head"
        ev(s, e, style, "{\\fad(350,350)\\move(540,900,540,860,0,350)}"+body(txt))

# progress bar (track + animated fill via clip reveal)
ev(0, TOTAL, "Bar", "{\\an7\\pos(0,0)\\1c&H3A3A3A&\\bord0\\shad0\\p1}m 80 1770 l 1000 1770 l 1000 1778 l 80 1778{\\p0}", layer=4)
fill = ("{\\an7\\pos(0,0)\\1c"+GOLD+"\\bord0\\shad0"
        "\\clip(80,1768,80,1780)\\t(0,"+str(int(TOTAL*1000))+",\\clip(80,1768,1000,1780))\\p1}"
        "m 80 1770 l 1000 1770 l 1000 1778 l 80 1778{\\p0}")
ev(0, TOTAL, "Bar", fill, layer=5)

ass = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Head,DejaVu Sans,76,{WHITE},{WHITE},&H30000000&,&HA0000000&,1,0,0,0,100,100,1,0,1,0,5,5,80,80,0,1
Style: Big,DejaVu Sans,96,{WHITE},{WHITE},&H30000000&,&HA0000000&,1,0,0,0,100,100,1,0,1,0,6,5,80,80,0,1
Style: Brand,DejaVu Sans,42,{WHITE},{WHITE},&H00000000&,&H00000000&,1,0,0,0,100,100,8,0,1,0,0,8,140,0,0,1
Style: Tag,DejaVu Sans,30,{GOLD},{GOLD},&H00000000&,&H00000000&,0,0,0,0,100,100,2,0,1,0,0,8,0,0,195,1
Style: Btn,DejaVu Sans,1,{GOLD},{GOLD},&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: BtnTxt,DejaVu Sans,58,{DARK},{DARK},&H00000000&,&H00000000&,1,0,0,0,100,100,3,0,1,0,0,5,0,0,0,1
Style: Sub,DejaVu Sans,32,{GREEN},{GREEN},&H00000000&,&H00000000&,0,0,0,0,100,100,1,0,1,0,0,5,0,0,0,1
Style: Bar,DejaVu Sans,1,{GOLD},{GOLD},&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""" + "\n".join(events) + "\n"

with open(ASS, "w", encoding="utf-8") as f:
    f.write(ass)
print("wrote ASS,", len(events), "events")

assp = ASS.replace("\\", "/").replace(":", "\\:")
src = (f"gradients=s={W}x{H}:c0=0x141d36:c1=0x080c1a:c2=0x10172e:nb_colors=3:"
       f"x0=0:y0=0:x1={W}:y1={H}:speed=0.012:d={TOTAL}:r={FPS}")
vf = (
    f"[0:v]zoompan=z='min(zoom+0.0005,1.10)':d=1:s={W}x{H}:fps={FPS},"
    f"format=yuv420p,ass='{assp}'[v]"
)
cmd = [FFMPEG, "-y", "-f", "lavfi", "-i", src,
       "-i", AUDIO, "-filter_complex", vf,
       "-map", "[v]", "-map", "1:a", "-t", str(TOTAL), "-r", str(FPS),
       "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
       "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", OUT]
print("rendering...")
r = subprocess.run(cmd, stderr=subprocess.PIPE, text=True)
if r.returncode:
    print(r.stderr[-3000:]); raise SystemExit(1)
print("OK", OUT)
