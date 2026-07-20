"""Смоук: шаблон «Кейс-эксперт» — каждая мысль = сцена."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ExpertExplainerLogic(unittest.TestCase):
    def test_styles_json_thought_equals_scene(self):
        data = json.loads((ROOT / "docs/montage-templates/styles.json").read_text(encoding="utf-8"))
        style = data["expert-explainer"] if "expert-explainer" in data else next(
            s for s in data.get("styles", []) if s["id"] == "expert-explainer"
        )
        self.assertGreaterEqual(style["coverRatio"], 0.55)
        self.assertLessEqual(style["insertEverySec"], 4.0)
        self.assertTrue(style.get("keepCaptionsOnCover", False))
        rules = style["aiRules"].lower()
        self.assertIn("мысль", rules)
        self.assertIn("cover:true", rules)
        self.assertIn("karaoke", rules)

    def test_frontend_catalog_matches(self):
        ts = (ROOT / "src/lib/montageTemplates.ts").read_text(encoding="utf-8")
        self.assertIn('id: "expert-explainer"', ts)
        self.assertIn("coverRatio: 0.6", ts)
        self.assertIn("keepCaptionsOnCover: true", ts)
        self.assertIn("Каждая мысль = сцена", ts)

    def test_short916_keeps_captions_flag(self):
        src = (ROOT / "remotion/src/Shorts916.tsx").read_text(encoding="utf-8")
        self.assertIn("keepCaptionsOnCover", src)
        self.assertIn("!keepCaptionsOnCover &&", src)
        self.assertIn("captionsStay", src)

    def test_inserts_enrich_cover_ratio_arg(self):
        src = (ROOT / "pipeline/inserts_enrich.py").read_text(encoding="utf-8")
        self.assertIn("cover_ratio", src)
        self.assertIn("sys.argv[3]", src)
        self.assertIn('"cover"', src)


if __name__ == "__main__":
    unittest.main()
