# -*- coding: utf-8 -*-
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.inserts_enrich import enrich


class InsertsEnrichTest(unittest.TestCase):
    def test_fills_gaps_with_motion(self):
        with tempfile.TemporaryDirectory() as td:
            work = Path(td)
            words = [
                {"i": 0, "w": "думаешь", "pw": "Думаешь", "start": 0.0, "end": 0.4},
                {"i": 1, "w": "у", "pw": "у", "start": 0.4, "end": 0.5},
                {"i": 2, "w": "тебя", "pw": "тебя", "start": 0.5, "end": 0.8},
                {"i": 3, "w": "есть", "pw": "есть", "start": 0.8, "end": 1.0},
                {"i": 4, "w": "время", "pw": "время?", "start": 1.0, "end": 1.4},
                {"i": 5, "w": "деньги", "pw": "Деньги", "start": 6.0, "end": 6.5},
                {"i": 6, "w": "важны", "pw": "важны", "start": 6.5, "end": 7.0},
            ]
            (work / "words.json").write_text(json.dumps(words), encoding="utf-8")
            (work / "inserts.json").write_text(json.dumps({"inserts": []}), encoding="utf-8")

            out = enrich(work, gap_sec=4.0)
            self.assertGreaterEqual(len(out["inserts"]), 2)
            templates = {it["template"] for it in out["inserts"]}
            self.assertTrue(
                "countdown" in templates or "notification-toast" in templates or "kinetic-type" in templates,
            )
            for it in out["inserts"]:
                self.assertFalse(it.get("data", {}).get("cover", False))


if __name__ == "__main__":
    unittest.main()
