# -*- coding: utf-8 -*-
"""Build vertical Shorts916 props from work/<id>/shorts.json.

Each short = ordered source-time spans (clean takes) concatenated. For every
short we emit remotion/props/<id>.json with:
- segments (frame trims) + per-segment face crop offset (tx) and zoom originY;
- karaoke words (text/from/to in frames, accent flag) built from words.json,
  with per-word text fixes (clean ASR, format numbers) from shorts.json;
- punch zooms on accent words.

Native full-bleed 9:16: the 16:9 source is scaled to fill height 1920, so its
width is 3413 px; we translate X to centre the face (from faces.json).

Usage:
  python shorts.py <work_dir> <remotion_props_dir> draft   # dump words per short
  python shorts.py <work_dir> <remotion_props_dir>          # build props
"""
import json
import subprocess
import sys
from pathlib import Path

CANVAS_W = 1080
CANVAS_H = 1920
VIDEO_W = round(CANVAS_H * 16 / 9)   # 3413: source scaled to fill height
TX_MIN = CANVAS_W - VIDEO_W           # -2333 (clamp so no black edge)


def load(work: Path, name: str):
    return json.loads((work / name).read_text(encoding="utf-8"))


def probe_frames(path: Path, fps: float) -> int:
    dur = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)], text=True).strip()
    return int(round(float(dur) * fps))


def probe_audio_duration(path: Path) -> float | None:
    """Audio stream duration in seconds (falls back to container duration)."""
    if not path.exists():
        return None
    for args in (
        ["-select_streams", "a:0", "-show_entries", "stream=duration"],
        ["-show_entries", "format=duration"],
    ):
        try:
            dur = subprocess.check_output(
                ["ffprobe", "-v", "error", *args, "-of", "csv=p=0", str(path)],
                text=True,
            ).strip()
            if dur and dur != "N/A":
                return float(dur)
        except (subprocess.CalledProcessError, ValueError):
            continue
    return None


def probe_dims(path: Path):
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(path)],
        text=True).strip()
    w, h = out.split("x")[:2]
    return int(w), int(h)


def face_center(faces, t):
    best = min((f for f in faces if f.get("found")),
               key=lambda f: abs(f["t"] - t), default=None)
    if not best:
        return 0.5, 0.4
    b = best["box"]
    return b["x"] + b["w"] / 2, b["y"] + b["h"] / 2


def build(work: Path, props_dir: Path, draft: bool):
    # fps from edl.json when the full pipeline ran; shorts-only mode has no EDL
    fps = load(work, "edl.json")["fps"] if (work / "edl.json").exists() else 30

    words = load(work, "words.json")
    faces = load(work, "faces.json")
    data = load(work, "shorts.json")
    shorts = data["shorts"]
    media = data.get("media", "source")  # base media name in public/ (remakes use their own)
    preview = (props_dir.parent / "public" / f"{media}_preview.mp4").exists()

    # Source aspect → width when scaled to fill canvas height. A 16:9 landscape
    # source is cropped to vertical (video_w 3413); a natively vertical 9:16
    # source fills the 1080-wide canvas exactly (video_w 1080), tx clamped to 0.
    src_path = props_dir.parent / "public" / f"{media}.mp4"
    sw, sh_dim = probe_dims(src_path) if src_path.exists() else (16, 9)
    video_w = round(CANVAS_H * sw / sh_dim)
    tx_min = CANVAS_W - video_w
    src_audio_dur = probe_audio_duration(src_path)
    max_end_frame = int(src_audio_dur * fps) if src_audio_dur else None

    for sh in shorts:
        spans = sh["spans"]
        fixes = {int(k): v for k, v in sh.get("fixes", {}).items()}
        accents = set(sh.get("accents", []))

        # source-time -> output-time (seconds) within this short's spans
        def out_t(src):
            acc = 0.0
            for a, b in spans:
                if a <= src <= b:
                    return acc + (src - a)
                acc += b - a
            return None

        # words falling inside the spans, in order
        wlist = [w for w in words if out_t(w["start"]) is not None]
        wlist.sort(key=lambda w: out_t(w["start"]))

        if draft:
            lines = [f"# {sh['id']} — {sh['title']}  ({sum(b-a for a,b in spans):.1f}s)"]
            for w in wlist:
                lines.append(f"{w['i']:5d} [{w['start']:8.2f}] {w['w']}")
            out = props_dir.parent / "props" / f"_draft_{sh['id']}.txt"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text("\n".join(lines), encoding="utf-8")
            print(f"draft {sh['id']}: {len(wlist)} words -> {out.name}")
            continue

        # segments with face crop offset
        segments = []
        for a, b in spans:
            if src_audio_dur is not None:
                b = min(b, src_audio_dur)
            fx, fy = face_center(faces, (a + b) / 2)
            tx = max(tx_min, min(0, round(CANVAS_W / 2 - fx * video_w)))
            end_f = round(b * fps)
            if max_end_frame is not None:
                end_f = min(end_f, max_end_frame)
            start_f = min(round(a * fps), end_f)
            segments.append({
                "start": a, "end": b,
                "startFrame": start_f, "endFrame": end_f,
                "tx": tx, "faceY": round(fy * 100, 1),
            })
        total = sum(s["endFrame"] - s["startFrame"] for s in segments)

        # karaoke words (highlight window = up to the next word, capped at 1.5 s)
        kw = []
        for w in wlist:
            txt = fixes.get(w["i"], w["w"])
            if txt == "":
                continue
            kw.append({"text": txt, "from": round(out_t(w["start"]) * fps),
                       "accent": w["i"] in accents})
        for idx, k in enumerate(kw):
            nxt = kw[idx + 1]["from"] if idx + 1 < len(kw) else k["from"] + 12
            k["to"] = max(k["from"] + 2, min(nxt, k["from"] + 45))

        # punch zooms — выключены по умолчанию (disableZoom), иначе «стремный» зум
        punch = []
        disable_zoom = bool(sh.get("disableZoom", True))
        if not disable_zoom:
            for w in wlist:
                if w["i"] in accents:
                    _, fy = face_center(faces, w["start"])
                    punch.append({"from": round(out_t(w["start"]) * fps) - 4,
                                  "originY": round(fy * 100, 1)})

        # b-roll inserts anchored inside this short; layout: third (default) / half / full
        insert_events = []
        ins_file = work / "inserts.json"
        if ins_file.exists():
            wbi = {w["i"]: w for w in words}
            public = props_dir.parent / "public"
            media_cache = {}
            for it in json.loads(ins_file.read_text(encoding="utf-8"))["inserts"]:
                w0, w1 = wbi.get(it["anchorWord"]), wbi.get(it["endWord"])
                if not w0 or not w1:
                    continue
                span = next(((a, b) for a, b in spans if a <= w0["start"] <= b), None)
                if span is None:                       # anchor not in this short
                    continue
                f0 = round(out_t(w0["start"]) * fps)
                f1 = round(out_t(min(w1["end"], span[1])) * fps)
                # Code-based motion-graphics insert (no file) — see remotion/src/motion.tsx
                if it.get("template"):
                    f1 = max(f1, f0 + 30)              # motion needs room to animate (>=1s)
                    ev = {
                        "type": "motion",
                        "template": it["template"],
                        "from": f0, "to": min(f1, total),
                    }
                    if it.get("data"):
                        ev["data"] = it["data"]
                    if it.get("layout"):
                        ev["layout"] = it["layout"]
                    insert_events.append(ev)
                    continue
                is_video = it["file"].lower().endswith((".mp4", ".mov", ".webm"))
                if is_video:                           # cap to the clip's own length
                    p = public / "inserts" / it["file"]
                    if it["file"] not in media_cache:
                        media_cache[it["file"]] = probe_frames(p, fps) if p.exists() else 120
                    f1 = min(f1, f0 + media_cache[it["file"]])
                f1 = max(f1, f0 + 20)                   # keep on screen >=0.66s
                ev = {
                    "file": f"inserts/{it['file']}",
                    "type": "video" if is_video else "image",
                    "from": f0, "to": min(f1, total),
                }
                if it.get("layout"):
                    ev["layout"] = it["layout"]
                # Video cutaway: full-screen — third/half + failed decode looked like
                # empty grey 50/50 with the speaker crushed at the bottom.
                if is_video and ev.get("layout") in (None, "third", "half"):
                    ev["layout"] = "full"
                if it.get("coverBox"):  # blur plate over burned-in subs of the fragment
                    ev["coverBox"] = it["coverBox"]
                insert_events.append(ev)
        insert_events.sort(key=lambda e: e["from"])

        props = {
            "src": f"{media}.mp4",
            "previewSrc": f"{media}_preview.mp4" if preview else None,
            "fps": fps,
            "segments": segments,
            "words": kw,
            "punchZooms": punch,
            "inserts": insert_events,
            "audioTrack": None,
            "totalDurationInFrames": total,
            "videoW": video_w,
            "captionStyle": sh.get("captionStyle", "pill"),
            "keepCaptionsOnCover": bool(
                sh.get("keepCaptionsOnCover")
                or sh.get("captionStyle") == "karaoke-box"
            ),
            "disableZoom": disable_zoom,
        }
        out = props_dir / f"{sh['id']}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(props, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"OK {sh['id']}: {total}f ({total/fps:.1f}s) segs={len(segments)} "
              f"words={len(kw)} accents={len(punch)} inserts={len(insert_events)}")


if __name__ == "__main__":
    work = Path(sys.argv[1])
    props_dir = Path(sys.argv[2])
    draft = len(sys.argv) > 3 and sys.argv[3] == "draft"
    build(work, props_dir, draft)
