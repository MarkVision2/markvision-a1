#!/usr/bin/env python3
"""Video pipeline orchestrator: Hyperframes + ElevenLabs + FFmpeg.

Python is the glue: render HTML to MP4, generate voiceover, mix into a final clip.
Stdlib only. Requires `node`/`npx`, `ffmpeg`, and (for voice) ELEVENLABS_API_KEY.
"""
import argparse
import os
import shutil
import subprocess
import sys

SKILLS_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TTS = os.path.join(SKILLS_DIR, "elevenlabs", "scripts", "tts.py")


def run(cmd, **kw):
    print("+", " ".join(cmd))
    subprocess.run(cmd, check=True, **kw)


def require(tool):
    if shutil.which(tool) is None:
        sys.exit(f"error: '{tool}' not found in PATH")


def main() -> int:
    p = argparse.ArgumentParser(description="HTML->video pipeline")
    p.add_argument("--project", required=True, help="Hyperframes project dir")
    p.add_argument("--video", default="output.mp4",
                   help="rendered video filename inside the project dir")
    p.add_argument("--script", help="text file with the voiceover script")
    p.add_argument("--voice", help="ElevenLabs voice_id")
    p.add_argument("--music", help="background music file (optional)")
    p.add_argument("--music-volume", default="0.2", help="music volume 0..1")
    p.add_argument("--out", default="final.mp4", help="final output path")
    args = p.parse_args()

    require("ffmpeg")
    require("npx")

    # 1. Render visuals with Hyperframes
    run(["npx", "hyperframes", "render"], cwd=args.project)
    video = os.path.join(args.project, args.video)
    if not os.path.exists(video):
        sys.exit(f"error: rendered video not found at {video}")

    # 2. Generate voiceover (optional)
    voice = None
    if args.script:
        voice = "voice.mp3"
        tts_cmd = [sys.executable, TTS, "--file", args.script, "--out", voice]
        if args.voice:
            tts_cmd += ["--voice", args.voice]
        run(tts_cmd)

    # 3. Mix with FFmpeg
    if not voice and not args.music:
        shutil.copyfile(video, args.out)
        print(f"no audio to mix; copied video -> {args.out}")
        return 0

    cmd = ["ffmpeg", "-y", "-i", video]
    if voice:
        cmd += ["-i", voice]
    if args.music:
        cmd += ["-i", args.music]

    if voice and args.music:
        flt = (f"[2:a]volume={args.music_volume}[m];"
               f"[1:a][m]amix=inputs=2:duration=first[a]")
        cmd += ["-filter_complex", flt, "-map", "0:v", "-map", "[a]"]
    elif voice:
        cmd += ["-map", "0:v", "-map", "1:a"]
    else:  # music only
        flt = f"[1:a]volume={args.music_volume}[a]"
        cmd += ["-filter_complex", flt, "-map", "0:v", "-map", "[a]"]

    cmd += ["-c:v", "copy", "-shortest", "-movflags", "+faststart", args.out]
    run(cmd)
    print(f"done -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
