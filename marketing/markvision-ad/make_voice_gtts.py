#!/usr/bin/env python3
import subprocess, os, urllib.parse, requests, time
HERE = os.path.dirname(os.path.abspath(__file__))
import imageio_ffmpeg
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

# Sentences (neutral / feminine wording so a female narrator is coherent)
sents = [
    "Мы упростили жизнь таргетологам и собрали решение, где денег больше, а работы меньше.",
    "С ним ты не боишься больших чеков. Знаешь, что результат вытащит система.",
    "Система, которая работает за тебя двадцать четыре на семь.",
    "Звучит как сказка, знаю.",
    "Но дело не в опыте, а в системе, которая пашет за тебя.",
    "Хочешь увидеть, как работает система? Жми: подробнее.",
    "Мест немного, не хочу плодить конкурентов.",
]

sess = requests.Session()  # uses HTTPS_PROXY + REQUESTS_CA_BUNDLE from env
parts = []
for i, s in enumerate(sents):
    url = ("https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ru&q="
           + urllib.parse.quote(s))
    for attempt in range(4):
        r = sess.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
        if r.status_code == 200 and len(r.content) > 500:
            break
        time.sleep(2*(attempt+1))
    else:
        raise SystemExit(f"failed chunk {i}: {r.status_code}")
    fn = os.path.join(HERE, f"g{i}.mp3")
    open(fn, "wb").write(r.content)
    parts.append(fn)
    print(f"chunk {i}: {len(r.content)} bytes")

# concat list with a short silence between sentences
sil = os.path.join(HERE, "sil.mp3")
subprocess.run([FFMPEG, "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
                "-t", "0.30", "-q:a", "9", sil], stderr=subprocess.DEVNULL)
listf = os.path.join(HERE, "concat.txt")
with open(listf, "w") as f:
    for i, p in enumerate(parts):
        f.write(f"file '{p}'\n")
        if i != len(parts)-1:
            f.write(f"file '{sil}'\n")

raw = os.path.join(HERE, "voice_g_raw.mp3")
subprocess.run([FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", listf,
                "-c", "copy", raw], stderr=subprocess.DEVNULL)
# polish: normalize loudness, gentle warmth, to final voice.mp3
out = os.path.join(HERE, "voice.mp3")
subprocess.run([FFMPEG, "-y", "-i", raw,
                "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,highpass=f=70,lowpass=f=9500",
                "-ar", "44100", "-ac", "1", out], stderr=subprocess.DEVNULL)
p = subprocess.run([FFMPEG, "-i", out], stderr=subprocess.PIPE, text=True)
print([l for l in p.stderr.splitlines() if "Duration" in l])
print("wrote", out)
