#!/usr/bin/env python3
import subprocess, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
import imageio_ffmpeg
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
AUDIO = os.path.join(HERE, "voice.mp3")
ASS = os.path.join(HERE, "subs.ass")
OUT = os.path.join(HERE, "markvision_ad.mp4")
W, H, FPS = 1080, 1920, 30

def dur_of(path):
    p = subprocess.run([FFMPEG, "-i", path], stderr=subprocess.PIPE, text=True)
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", p.stderr)
    return int(m[1])*3600 + int(m[2])*60 + float(m[3])

# --- sentence windows from the individual TTS chunks (tight sync) ---
GAP = 0.30
d = [dur_of(os.path.join(HERE, f"g{i}.mp3")) for i in range(7)]
starts, t = [], 0.0
for i in range(7):
    starts.append(t); t += d[i] + (GAP if i < 6 else 0)
TOTAL = round(dur_of(AUDIO) + 0.4, 2)
def win(i):
    s = starts[i]; e = s + d[i]
    return s, e
print("sentence windows:", [(round(win(i)[0],2), round(win(i)[1],2)) for i in range(7)], "TOTAL", TOTAL)

GOLD="&H42C5F5&"; WHITE="&HFFFFFF&"; GREEN="&H80DE4A&"; DARK="&H20100B&"
def body(txt):
    return txt.replace("{gold}", "{\\1c"+GOLD+"}").replace("\n","\\N")
def ts(x):
    x=max(0,x); cs=int(round(x*100)); h=cs//360000; cs%=360000; mm=cs//6000; cs%=6000; ss=cs//100; cc=cs%100
    return f"{h}:{mm:02d}:{ss:02d}.{cc:02d}"

events=[]
def ev(s,e,style,text,layer=0):
    events.append(f"Dialogue: {layer},{ts(s)},{ts(e)},{style},,0,0,0,,{text}")
def at(i,f0,f1):
    s,e=win(i); return s+(e-s)*f0, s+(e-s)*f1

# brand + tagline persistent
ev(0,TOTAL,"Brand","{\\fad(400,400)}MARKVISION")
ev(0,TOTAL,"Tag","система, которая работает за тебя")

def card(i,f0,f1,text,style="Head"):
    s,e=at(i,f0,f1)
    ev(s,e,style,"{\\fad(300,300)\\move(540,900,540,860,0,300)}"+body(text))

# slides mapped to actual sentence timing
card(0,0.00,0.50,"Мы упростили жизнь\nтаргетологам")
card(0,0.52,1.00,"Денег — {gold}больше{\\1c&HFFFFFF&},\nработы — {gold}меньше")
card(1,0.00,0.50,"Ты не боишься\nбольших чеков")
card(1,0.52,1.00,"Результат вытащит\n{gold}система")
card(2,0.00,1.00,"Она работает за тебя\n{gold}24 / 7","Big")
card(3,0.00,1.00,"Звучит как сказка?\nЗнаю.")
card(4,0.00,1.00,"Дело не в опыте —\nа в системе,\nкоторая пашет за тебя")
card(5,0.00,0.42,"Хочешь увидеть,\nкак она работает?")

# CTA button during second half of sentence 5, extended a touch into sentence 6 start via 6
cs,_=at(5,0.44,1.0); ce=win(6)[0]  # up to sentence6 start
bx0,bx1,by0,by1,r=250,830,980,1090,20
draw=(f"m {bx0+r} {by0} l {bx1-r} {by0} b {bx1} {by0} {bx1} {by0} {bx1} {by0+r} "
      f"l {bx1} {by1-r} b {bx1} {by1} {bx1} {by1} {bx1-r} {by1} "
      f"l {bx0+r} {by1} b {bx0} {by1} {bx0} {by1} {bx0} {by1-r} "
      f"l {bx0} {by0+r} b {bx0} {by0} {bx0} {by0} {bx0+r} {by0}")
ev(cs,ce,"Head","{\\fad(300,250)\\pos(540,840)}Тогда жми",layer=1)
ev(cs,ce,"Btn","{\\fad(300,250)\\an7\\pos(0,0)\\1c"+GOLD+"\\bord0\\shad0\\p1}"+draw+"{\\p0}",layer=2)
ev(cs,ce,"BtnTxt","{\\fad(300,250)\\pos(540,1035)}ПОДРОБНЕЕ",layer=3)

# closing line (sentence 6)
s6,e6=win(6); e6=TOTAL
ev(s6,e6,"Head","{\\fad(300,350)\\move(540,900,540,860,0,300)}"+body("Мест немного."))
ev(s6,e6,"Sub","{\\fad(300,350)\\pos(540,1080)}Не хочу плодить конкурентов")

# progress bar
ev(0,TOTAL,"Bar","{\\an7\\pos(0,0)\\1c&H3A3A3A&\\bord0\\shad0\\p1}m 80 1770 l 1000 1770 l 1000 1778 l 80 1778{\\p0}",layer=4)
fill=("{\\an7\\pos(0,0)\\1c"+GOLD+"\\bord0\\shad0\\clip(80,1768,80,1780)\\t(0,"+str(int(TOTAL*1000))+
      ",\\clip(80,1768,1000,1780))\\p1}m 80 1770 l 1000 1770 l 1000 1778 l 80 1778{\\p0}")
ev(0,TOTAL,"Bar",fill,layer=5)

ass=f"""[Script Info]
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
Style: BtnTxt,DejaVu Sans,58,{DARK},{DARK},&H00000000&,&H00000000&,1,0,0,0,100,100,3,0,1,0,0,5,0,0,0,1
Style: Sub,DejaVu Sans,34,{GREEN},{GREEN},&H00000000&,&H00000000&,0,0,0,0,100,100,1,0,1,0,0,5,0,0,0,1
Style: Btn,DejaVu Sans,1,{GOLD},{GOLD},&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Bar,DejaVu Sans,1,{GOLD},{GOLD},&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""" + "\n".join(events) + "\n"
open(ASS,"w",encoding="utf-8").write(ass)
print("events:", len(events))

assp=ASS.replace("\\","/").replace(":","\\:")
src=(f"gradients=s={W}x{H}:c0=0x141d36:c1=0x080c1a:c2=0x10172e:nb_colors=3:"
     f"x0=0:y0=0:x1={W}:y1={H}:speed=0.012:d={TOTAL}:r={FPS}")
vf=(f"[0:v]zoompan=z='min(zoom+0.0005,1.10)':d=1:s={W}x{H}:fps={FPS},format=yuv420p,ass='{assp}'[v]")
cmd=[FFMPEG,"-y","-f","lavfi","-i",src,"-i",AUDIO,"-filter_complex",vf,
     "-map","[v]","-map","1:a","-t",str(TOTAL),"-r",str(FPS),
     "-c:v","libx264","-preset","medium","-crf","20","-pix_fmt","yuv420p",
     "-c:a","aac","-b:a","160k","-movflags","+faststart",OUT]
print("rendering...")
r=subprocess.run(cmd,stderr=subprocess.PIPE,text=True)
if r.returncode:
    print(r.stderr[-3000:]); raise SystemExit(1)
print("OK",OUT)
