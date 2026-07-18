# -*- coding: utf-8 -*-
"""Jump-cut refine for shorts.json: превращает сплошные spans в настоящий монтаж.

Берёт work/<id>/shorts.json (грубые spans от AI) + words.json + опционально
delete.json (индексы слов-паразитов/дублей) и переписывает spans:
- выкидывает слова из delete-диапазонов;
- режет паузы между словами > MAX_GAP_S (джамп-кат);
- паддинг краёв, склейка микро-сегментов.

Usage: python shorts_refine.py <work_dir>
Пишет shorts.json на место (бэкап shorts.raw.json).
"""
import json
import sys
from pathlib import Path

MAX_GAP_S = 0.42   # пауза длиннее — режем (джамп-кат)
PAD_HEAD = 0.08    # захват перед первым словом сегмента
PAD_TAIL = 0.14    # хвост после последнего слова
MIN_SUB_S = 0.25   # сегменты короче — сливаем/выкидываем
MERGE_GAP_S = 0.10 # если между сегментами почти нет выреза — склеить


def refine(work: Path):
    words = json.loads((work / "words.json").read_text(encoding="utf-8"))
    raw_text = (work / "shorts.json").read_text(encoding="utf-8")
    (work / "shorts.raw.json").write_text(raw_text, encoding="utf-8")
    data = json.loads(raw_text)

    deleted = set()
    del_file = work / "delete.json"
    if del_file.exists():
        for d in json.loads(del_file.read_text(encoding="utf-8")).get("delete", []):
            deleted.update(range(int(d["from"]), int(d["to"]) + 1))

    total_cut = 0.0
    for sh in data.get("shorts", []):
        spans = sh.get("spans") or []
        kept = []
        for a, b in spans:
            inside = [w for w in words
                      if w["start"] >= a - 0.05 and w["end"] <= b + 0.05
                      and w["i"] not in deleted]
            if not inside:
                continue
            # раскладываем на подсегменты по паузам
            cur = [inside[0]]
            groups = []
            for w in inside[1:]:
                if w["start"] - cur[-1]["end"] > MAX_GAP_S:
                    groups.append(cur)
                    cur = [w]
                else:
                    cur.append(w)
            groups.append(cur)
            for g in groups:
                s = max(a, g[0]["start"] - PAD_HEAD)
                e = min(b, g[-1]["end"] + PAD_TAIL)
                if e - s >= MIN_SUB_S:
                    kept.append([round(s, 3), round(e, 3)])

        # merge почти смежных
        merged = []
        for s, e in kept:
            if merged and s - merged[-1][1] <= MERGE_GAP_S:
                merged[-1][1] = e
            else:
                merged.append([s, e])

        before = sum(b - a for a, b in spans)
        after = sum(b - a for a, b in merged)
        total_cut += max(0.0, before - after)
        if merged:
            sh["spans"] = merged
        print(f"{sh.get('id')}: spans {len(spans)}→{len(merged)}, "
              f"{before:.1f}s→{after:.1f}s (вырезано {before - after:.1f}s)")

    (work / "shorts.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK refine: суммарно вырезано {total_cut:.1f}s")


if __name__ == "__main__":
    refine(Path(sys.argv[1]))
