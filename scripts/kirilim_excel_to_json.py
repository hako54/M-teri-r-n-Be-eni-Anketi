"""Şirket grup adları Excel'ini uygulamanın kırılım dosyasına (src/kirilim.json) çevirir.

Kullanım: python3 scripts/kirilim_excel_to_json.py liste.xlsx

İlk satır başlıklardır ve sırası kırılım sırasıdır (soldaki üst seviye).
Yeni bir başlık eklemek için Excel'e sağa yeni bir sütun ekleyip betiği yeniden çalıştırmak yeterli.
Başı boş satırlar ve "Genel Toplam" satırı atlanır.
"""
import json
import sys
from pathlib import Path

import openpyxl


def clean(value):
    return " ".join(str(value).split()) if value is not None else ""


def main(path):
    sheet = openpyxl.load_workbook(path, read_only=True, data_only=True).active
    rows = sheet.iter_rows(values_only=True)
    levels = [clean(h) for h in next(rows) if clean(h)]
    seen = set()
    out = []
    skipped = 0
    for row in rows:
        values = [clean(v) for v in row[: len(levels)]]
        values += [""] * (len(levels) - len(values))
        if not values[0] or values[0].lower() == "genel toplam":
            skipped += any(values)
            continue
        # Kırılım soldan sağa doludur; ilk boş hücreden sonrası kesilir.
        if "" in values:
            values = values[: values.index("")]
        key = tuple(values)
        if key not in seen:
            seen.add(key)
            out.append(values)
    target = Path(__file__).resolve().parent.parent / "src" / "kirilim.json"
    target.write_text(json.dumps({"levels": levels, "rows": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(levels)} başlık, {len(out)} satır yazıldı; {skipped} satır atlandı -> {target}")


if __name__ == "__main__":
    main(sys.argv[1])
