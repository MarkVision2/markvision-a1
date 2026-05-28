#!/usr/bin/env python3
"""ElevenLabs text-to-speech helper. Stdlib only.

Reads API key from ELEVENLABS_API_KEY. Writes audio to --out.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"  # Rachel
DEFAULT_MODEL = "eleven_multilingual_v2"


def main() -> int:
    p = argparse.ArgumentParser(description="ElevenLabs TTS")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--text", help="text to speak")
    src.add_argument("--file", help="path to a file with the text")
    p.add_argument("--voice", default=DEFAULT_VOICE, help="voice_id")
    p.add_argument("--model", default=DEFAULT_MODEL, help="model id")
    p.add_argument("--out", default="voice.mp3", help="output audio path")
    p.add_argument("--format", default="mp3_44100_128", help="output_format")
    args = p.parse_args()

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        print("error: ELEVENLABS_API_KEY is not set", file=sys.stderr)
        return 2

    text = args.text
    if args.file:
        with open(args.file, "r", encoding="utf-8") as fh:
            text = fh.read()
    if not text or not text.strip():
        print("error: empty text", file=sys.stderr)
        return 2

    url = (
        f"https://api.elevenlabs.io/v1/text-to-speech/{args.voice}"
        f"?output_format={args.format}"
    )
    payload = json.dumps({"text": text, "model_id": args.model}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            audio = resp.read()
    except urllib.error.HTTPError as e:
        print(f"error: HTTP {e.code}: {e.read().decode('utf-8', 'replace')}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"error: request failed: {e.reason}", file=sys.stderr)
        return 1

    with open(args.out, "wb") as fh:
        fh.write(audio)
    print(f"wrote {args.out} ({len(audio)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
