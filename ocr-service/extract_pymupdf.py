"""
PyMuPDF (fitz) ile yapılandırılmış PDF → Markdown çıkarımı.
Başlık seviyeleri font boyutundan; üstbilgi/altbilgi tekrarları ayıklanır.
Geleneksel tek sütun paragraf metin kalır; tablo, yan yana kutu ve
çok sütunlu düzenler sayfa klipli görsel (PNG/JPEG) olarak gömülür.
"""

from __future__ import annotations

import base64
import re
from collections import Counter
from typing import Any

import pymupdf as fitz


def _median(vals: list[float]) -> float:
    if not vals:
        return 11.0
    s = sorted(vals)
    n = len(s)
    mid = n // 2
    if n % 2:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2.0


def _normalize_line(text: str) -> str:
    return re.sub(r"\s+", " ", _repair_turkish(text or "").strip())


def _repair_turkish(text: str) -> str:
    """Win-1254 / UTF-8 mojibake ve � (U+FFFD) onarımı — özellikle ı/İ."""
    if not text:
        return text
    import unicodedata

    s = unicodedata.normalize("NFC", text)
    replacements = [
        ("Ä±", "ı"),
        ("Ä°", "İ"),
        ("ÄŸ", "ğ"),
        ("Äž", "Ğ"),
        ("ÅŸ", "ş"),
        ("Åž", "Ş"),
        ("Ã¼", "ü"),
        ("Ãœ", "Ü"),
        ("Ã¶", "ö"),
        ("Ã–", "Ö"),
        ("Ã§", "ç"),
        ("Ã‡", "Ç"),
        # CP1254 as Latin-1
        ("ý", "ı"),
        ("Ý", "İ"),
        ("ð", "ğ"),
        ("Ð", "Ğ"),
        ("þ", "ş"),
        ("Þ", "Ş"),
    ]
    for a, b in replacements:
        s = s.replace(a, b)

    # U+FFFD: kelime içi → i; kelime sonu → sesli uyumu
    s = re.sub(
        r"([A-Za-zÇĞİÖŞÜçğıöşü])\uFFFD([A-Za-zÇĞİÖŞÜçğıöşü])",
        r"\1i\2",
        s,
    )

    def _fill_fffd(m: re.Match[str]) -> str:
        start = m.start()
        before = s[max(0, start - 24) : start]
        wm = re.search(r"[A-Za-zÇĞİÖŞÜçğıöşü]+$", before, re.I)
        stem = wm.group(0) if wm else ""
        vowels = re.findall(r"[aeıioöuüAEIİOÖUÜ]", stem)
        last = vowels[-1] if vowels else "a"
        return "i" if re.search(r"[eiöüEİÖÜ]", last) else "ı"

    s = re.sub(r"\uFFFD", _fill_fffd, s)
    return unicodedata.normalize("NFC", s)


def _is_page_number(text: str) -> bool:
    t = text.strip()
    if re.fullmatch(r"\d{1,4}", t):
        return True
    if re.fullmatch(r"[-–—]?\s*\d{1,4}\s*[-–—]?", t):
        return True
    if re.fullmatch(r"(sayfa|page|s\.)\s*\d{1,4}", t, re.I):
        return True
    return False


def _escape_cell(text: str) -> str:
    return _normalize_line(text).replace("|", "\\|")


def _md_column_sections(header: list[str], bodies: list[str] | None = None) -> str:
    """Yan yana kutular → her sütun için ### başlık + gövde (alt alta)."""
    bodies = bodies or [""] * len(header)
    parts: list[str] = []
    n = max(len(header), len(bodies))
    for i in range(n):
        title = _normalize_line(header[i] if i < len(header) else "")
        body = _normalize_line(bodies[i] if i < len(bodies) else "")
        if not title and not body:
            continue
        if title:
            parts.append(f"### {title}")
        if body:
            parts.append(body)
    return "\n\n".join(parts)


def _md_table(rows: list[list[str]], *, boxes: bool = False) -> str:
    """Gerçek veri tablosu (find_tables). Kutu düzeni ise dikey bölümlere çevir."""
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    if width < 2:
        return ""
    norm = [r + [""] * (width - len(r)) for r in rows]
    if boxes or (len(norm) <= 2 and all(len(c) <= 55 for c in norm[0] if c)):
        header = norm[0]
        bodies = norm[1] if len(norm) > 1 else [""] * width
        # Çok satırlı gövde varsa sütun bazında birleştir
        if len(norm) > 2:
            merged = [""] * width
            for row in norm[1:]:
                for ci, text in enumerate(row):
                    if not text:
                        continue
                    merged[ci] = f"{merged[ci]} {text}".strip() if merged[ci] else text
            bodies = merged
        return _md_column_sections(header, bodies)

    header = norm[0]
    body = norm[1:]
    sep = "| " + " | ".join(["---"] * width) + " |"
    lines = [
        "| " + " | ".join(_escape_cell(c) for c in header) + " |",
        sep,
    ]
    for row in body:
        lines.append("| " + " | ".join(_escape_cell(c) for c in row) + " |")
    return "\n".join(lines)


def _span_inside(sp: dict[str, Any], rect: tuple[float, float, float, float]) -> bool:
    x0, y0, x1, y1 = rect
    cx = (sp["x0"] + sp["x1"]) / 2
    cy = (sp["y0"] + sp["y1"]) / 2
    return x0 - 2 <= cx <= x1 + 2 and y0 - 2 <= cy <= y1 + 2


def _collect_spans(page: fitz.Page) -> list[dict[str, Any]]:
    """Sayfadaki metin span'lerini okuma sırasıyla topla (bbox dahil)."""
    data = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
    spans_out: list[dict[str, Any]] = []

    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            # Her MuPDF span ayrı hücre adayı — satırı tek parçada birleştirme
            for span in line.get("spans", []):
                t = span.get("text") or ""
                if not t.strip():
                    continue
                text = _normalize_line(t)
                if not text:
                    continue
                bbox = span.get("bbox") or line.get("bbox")
                if not bbox:
                    continue
                size = float(span.get("size") or 11)
                flags = int(span.get("flags") or 0)
                bold = bool(flags & 2**4)
                spans_out.append(
                    {
                        "text": text,
                        "size": size,
                        "bold": bold,
                        "x": float(bbox[0]),
                        "y": float(bbox[1]),
                        "x0": float(bbox[0]),
                        "y0": float(bbox[1]),
                        "x1": float(bbox[2]),
                        "y1": float(bbox[3]),
                    }
                )

    spans_out.sort(key=lambda s: (round(s["y"], 1), s["x"]))
    return spans_out


def _clip_region_markdown(
    page: fitz.Page,
    rect: tuple[float, float, float, float] | Any,
    *,
    alt: str = "Tablo",
    dpi: int = 150,
) -> str | None:
    """Sayfa bölgesini PNG/JPEG kesip markdown görsel satırı üret."""
    try:
        r = fitz.Rect(rect)
        pad = 3.0
        r = fitz.Rect(r.x0 - pad, r.y0 - pad, r.x1 + pad, r.y1 + pad)
        r = r & page.rect
        if r.is_empty or r.width < 24 or r.height < 18:
            return None
        page_area = max(1.0, page.rect.width * page.rect.height)
        if r.get_area() > page_area * 0.88:
            # Neredeyse tüm sayfa — muhtemelen yanlış tablo
            return None
        pix = page.get_pixmap(clip=r, dpi=dpi, alpha=False)
        if pix.width < 36 or pix.height < 24:
            return None
        raw = pix.tobytes("png")
        mime = "image/png"
        # Büyük kliplerde JPEG (IndexedDB / yanıt boyutu)
        if len(raw) > 420_000:
            raw = pix.tobytes("jpeg", jpg_quality=84)
            mime = "image/jpeg"
        if len(raw) > 1_200_000:
            # Daha düşük çözünürlük dene
            pix2 = page.get_pixmap(clip=r, dpi=110, alpha=False)
            raw = pix2.tobytes("jpeg", jpg_quality=78)
            mime = "image/jpeg"
        if not raw or len(raw) < 80:
            return None
        b64 = base64.b64encode(raw).decode("ascii")
        return f"![{alt}](data:{mime};base64,{b64})"
    except Exception:
        return None


def _rows_look_like_concept_boxes(rows: list[list[str]]) -> bool:
    """Kısa başlıklı 1–2 satırlık yan yana kutu → metin bölümü kalsın."""
    if not rows or len(rows) > 2:
        return False
    width = max(len(r) for r in rows)
    if width < 2 or width > 4:
        return False
    header = rows[0]
    return all(0 < len(c) <= 55 and not c.endswith((".", "!", "?", "…")) for c in header if c)


def _extract_native_tables(
    page: fitz.Page,
) -> list[dict[str, Any]]:
    """PyMuPDF find_tables → {y0, rect, markdown}.

    Gerçek tablolar görsel (PNG) olarak gömülür; kısa kutu düzenleri metin kalır.
    """
    out: list[dict[str, Any]] = []
    try:
        finder = page.find_tables()
    except Exception:
        return out
    tables = getattr(finder, "tables", None) or []
    for tab in tables:
        try:
            raw = tab.extract()
        except Exception:
            continue
        if not raw or len(raw) < 1:
            continue
        rows: list[list[str]] = []
        for row in raw:
            cells = [_normalize_line(str(c or "")) for c in row]
            if any(cells):
                rows.append(cells)
        if len(rows) < 1:
            continue
        # En az 2 sütun
        if max(len(r) for r in rows) < 2:
            continue
        bbox = getattr(tab, "bbox", None) or (0, 0, 0, 0)
        rect = (
            float(bbox[0]),
            float(bbox[1]),
            float(bbox[2]),
            float(bbox[3]),
        )

        # Tablo / kutu ızgarası → görsel (metin aktarımı kaybettiriyor)
        md = _clip_region_markdown(page, rect, alt="Tablo")
        if not md:
            # Son çare: kısa kavram kutusu metin, diğerleri GFM
            md = _md_table(rows, boxes=_rows_look_like_concept_boxes(rows))

        if not md:
            continue
        out.append(
            {
                "y0": rect[1],
                "rect": rect,
                "markdown": md,
            }
        )
    return out


def _find_repeating_margins(
    pages_spans: list[list[dict[str, Any]]],
) -> set[str]:
    """Çoğu sayfada tekrarlayan kısa üst/alt satırları (header/footer) bul."""
    if len(pages_spans) < 3:
        return set()

    edge_lines: list[str] = []
    for spans in pages_spans:
        if not spans:
            continue
        candidates = spans[:2] + spans[-2:]
        for s in candidates:
            t = s["text"]
            if len(t) < 80 and not _is_page_number(t):
                edge_lines.append(t.casefold())

    counts = Counter(edge_lines)
    threshold = max(3, len(pages_spans) // 2)
    return {line for line, n in counts.items() if n >= threshold}


def _looks_like_prose_phrase(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if t.endswith((",", ";")) or "," in t or ";" in t:
        return True
    if len(t) > 55 or len(t.split()) > 8:
        return True
    return bool(
        re.search(
            r"\b(için|olarak|olan|üzere|nedeniyle|ancak|fakat|edilir|"
            r"edilmesi|olunması|kabul|hale|kapsamında|sahip|veren)\b",
            t,
            re.I,
        )
    )


def _heading_level(size: float, body: float, bold: bool, text: str) -> int | None:
    """1=# 2=## 3=### — body fontuna göre."""
    if len(text) > 120:
        return None
    if _is_page_number(text):
        return None
    if text.endswith((",", ";", ".", "!", "?", "…")):
        return None
    if _looks_like_prose_phrase(text):
        return None

    ratio = size / body if body > 0 else 1.0

    m = re.match(
        r"^(bölüm|chapter|unit|ünite|konu|kısım|part|section)\b(.*)$",
        text,
        re.I,
    )
    if m:
        rest = (m.group(2) or "").strip()
        # "Konu şu sayıdaki…" → başlık değil
        if rest and (
            _looks_like_prose_phrase(rest)
            or re.match(r"^(şu|bu|bir|ile|ve|veya)\b", rest, re.I)
            or len(rest.split()) > 6
        ):
            return None
        if rest and not re.match(r"^[:.\-–—\d]", rest):
            if len(rest.split()) > 4 or len(rest) > 40:
                return None
        return 1

    if ratio >= 1.45 or (ratio >= 1.32 and bold):
        return 1
    if ratio >= 1.22 or (ratio >= 1.12 and bold and len(text) <= 80):
        return 2
    # Kısa kalın satırlar (kutu başlıkları) — gövdeyle aynı boyutta olsa bile
    if (
        bold
        and len(text) <= 55
        and not text.endswith((".", "!", "?", "…", ",", ";", ":"))
        and len(text.split()) <= 7
        and ratio >= 0.95
    ):
        return 3
    if ratio >= 1.08 and bold and len(text) <= 70 and not text.endswith((".", "…")):
        return 3

    if re.match(r"^\d+(\.\d+){0,3}\.?\s+\S", text) and len(text) <= 90:
        if not text.endswith((".", "!", "?")):
            depth = text.split()[0].count(".")
            return 2 if depth <= 1 else 3

    # Title Case kısa satır (font farkı zayıf PDF'ler)
    words = text.split()
    if (
        1 <= len(words) <= 6
        and len(text) <= 50
        and not text.endswith((".", "!", "?", "…"))
        and sum(1 for w in words if w[:1].isupper()) >= max(1, (len(words) + 1) // 2)
        and ratio >= 1.05
    ):
        return 3

    return None


def _band_gap_threshold(items: list[dict[str, Any]], body: float) -> float:
    widths = [max(8.0, s["x1"] - s["x0"]) for s in items]
    med_w = _median(widths)
    # Uzun satır span'lerinde med_w şişmesin (yarı sayfa genişliği gutter sanılmasın)
    capped = min(med_w * 0.45, body * 3.2)
    return max(body * 1.7, capped, 16.0)


def _cell_looks_like_title(text: str) -> bool:
    t = (text or "").strip()
    if not t or len(t) > 55:
        return False
    if t.endswith((".", "!", "?", "…")):
        return False
    words = t.split()
    return 1 <= len(words) <= 7


_BIG_NUM_TOKEN = re.compile(r"\d{1,3}(?:[.,]\d{3}){1,4}(?:[.,]\d+)?")


def _looks_like_big_number(text: str) -> bool:
    """KPI kartı rakamı: 2.400.000.000 / 1,200,000,000."""
    t = (text or "").strip().replace(" ", "").replace("\u00a0", "")
    if not t:
        return False
    if _BIG_NUM_TOKEN.fullmatch(t):
        return True
    if re.fullmatch(r"\d{6,15}", t):
        return True
    # Satırda birden fazla büyük sayı
    return len(_BIG_NUM_TOKEN.findall(t)) >= 2 and len(t) <= 80


def _count_big_numbers(text: str) -> int:
    t = (text or "").strip()
    n = len(_BIG_NUM_TOKEN.findall(t))
    if n:
        return n
    if re.fullmatch(r"\d{6,15}", t.replace(" ", "")):
        return 1
    return 0


def _looks_like_currency_unit(text: str) -> bool:
    t = (text or "").strip()
    if not t or len(t) > 40:
        return False
    if re.fullmatch(
        r"(türk\s*lirası|tl|usd|eur|gbp|\$|€|£|₺|milyon|milyar|mn|bn)s?",
        t,
        re.I,
    ):
        return True
    # "Türk Lirası Türk Lirası Türk Lirası" tek satırda
    parts = re.findall(r"türk\s*lirası|tl\b", t, re.I)
    return len(parts) >= 2 and len(t) <= 80


def _looks_like_kpi_label(text: str) -> bool:
    t = (text or "").strip()
    if not t or len(t) > 64:
        return False
    if t.endswith((".", "!", "?", "…")):
        return False
    if _looks_like_big_number(t) or _looks_like_currency_unit(t):
        return False
    words = t.split()
    if not words or len(words) > 8:
        return False
    if re.search(
        r"\b(20\d{2}|aktif|toplam|sat[ıi][şs]|has[ıi]lat|gelir|gider|"
        r"k[aâ]r|zarar|özkaynak|bor[çc]|varl[ıi]k|net|ciro|ebitda|"
        r"fiyat|adet|oran|pay|getiri)\b",
        t,
        re.I,
    ):
        return True
    return _cell_looks_like_title(t)


def _span_is_stat_atom(sp: dict[str, Any]) -> bool:
    t = sp.get("text") or ""
    return (
        _looks_like_big_number(t)
        or _looks_like_currency_unit(t)
        or _looks_like_kpi_label(t)
    )


def _band_is_stat_like(band: list[dict[str, Any]]) -> bool:
    """Büyük rakam / kısa etiket / para birimi satırı — paragraf değil."""
    if not band:
        return False
    for s in band:
        t = s.get("text") or ""
        if len(t) > 72 and not _looks_like_big_number(t) and not _looks_like_currency_unit(t):
            return False
    atoms = sum(1 for s in band if _span_is_stat_atom(s))
    return atoms >= max(1, int(len(band) * 0.55 + 0.5))


def _cluster_is_kpi_block(spans: list[dict[str, Any]]) -> bool:
    """En az 2 büyük sayı veya sayı+etiket kart düzeni."""
    if len(spans) < 2:
        return False
    nums = sum(_count_big_numbers(s.get("text") or "") for s in spans)
    labels = sum(1 for s in spans if _looks_like_kpi_label(s.get("text") or ""))
    units = sum(1 for s in spans if _looks_like_currency_unit(s.get("text") or ""))
    if nums >= 2:
        return True
    if nums >= 1 and labels >= 1 and len(spans) >= 3:
        return True
    if nums >= 1 and units >= 1 and labels >= 1:
        return True
    return False


def _spans_bbox(
    items: list[dict[str, Any]],
) -> tuple[float, float, float, float]:
    return (
        min(s["x0"] for s in items),
        min(s["y0"] for s in items),
        max(s["x1"] for s in items),
        max(s["y1"] for s in items),
    )


def _emit_clip_unit(
    page: fitz.Page | None,
    region_spans: list[dict[str, Any]],
    body: float,
    *,
    alt: str,
    fallback_md: str = "",
) -> dict[str, Any]:
    rect = _spans_bbox(region_spans)
    x0, y0, x1, y1 = rect
    pad_x = max(10.0, body * 1.4)
    pad_y = max(8.0, body * 1.0)
    rect = (x0 - pad_x, y0 - pad_y, x1 + pad_x, y1 + pad_y)
    md: str | None = None
    if page is not None:
        md = _clip_region_markdown(page, rect, alt=alt)
    if not md:
        md = fallback_md or " ".join(
            (s.get("text") or "").strip() for s in region_spans if s.get("text")
        )
    return {
        "type": "sections",
        "markdown": md,
        "y0": region_spans[0]["y0"],
    }


def _is_column_band(items: list[dict[str, Any]], body: float) -> bool:
    """Aynı y bandında geniş boşluklarla ayrılmış kısa başlık hücreleri mi?"""
    if len(items) < 2:
        return False
    ordered = sorted(items, key=lambda s: s["x0"])
    if any(len(s["text"]) > 80 for s in ordered):
        return False
    # Başlık satırlarında gutter eşiğini düşür (uzun span medyanı şişirmesin)
    thr = min(_band_gap_threshold(ordered, body), max(body * 1.4, 12.0))
    gap_info = _largest_horizontal_gap(ordered)
    if not gap_info or gap_info[0] < thr:
        # Merkez mesafesi ile de dene (span'ler neredeyse bitişik görünebilir)
        if len(ordered) == 2:
            a, b = ordered[0], ordered[1]
            mid_gap = ((b["x0"] + b["x1"]) / 2.0) - ((a["x0"] + a["x1"]) / 2.0)
            if mid_gap < max(body * 4.0, 40.0):
                return False
        else:
            return False
    bounds = _column_bounds_from_band(ordered, body)
    if len(bounds) < 2:
        if gap_info and len(ordered) >= 2:
            _, bi = gap_info
            left, right = ordered[: bi + 1], ordered[bi + 1 :]
            if left and right:
                bounds = [
                    (min(s["x0"] for s in left), max(s["x1"] for s in left)),
                    (min(s["x0"] for s in right), max(s["x1"] for s in right)),
                ]
    if len(bounds) < 2 or len(bounds) > 4:
        return False
    cells = _assign_band_to_columns(ordered, bounds)
    filled = [c for c in cells if c]
    if len(filled) < 2:
        return False
    return all(_cell_looks_like_title(c) for c in filled)


def _largest_horizontal_gap(
    items: list[dict[str, Any]],
) -> tuple[float, int] | None:
    """x sıralı span'ler arasında en büyük boşluk (gap, index after left group)."""
    ordered = sorted(items, key=lambda s: s["x0"])
    if len(ordered) < 2:
        return None
    best_gap = -1.0
    best_i = -1
    for i, (a, b) in enumerate(zip(ordered, ordered[1:])):
        gap = b["x0"] - a["x1"]
        if gap > best_gap:
            best_gap = gap
            best_i = i
    if best_i < 0:
        return None
    return best_gap, best_i


def _is_multi_column_layout(items: list[dict[str, Any]], body: float) -> bool:
    """Yan yana sütun / kutu gövdesi — tek paragraf değil."""
    if len(items) < 2:
        return False
    ordered = sorted(items, key=lambda s: s["x0"])
    gap_info = _largest_horizontal_gap(ordered)
    if not gap_info:
        return False
    best_gap, _ = gap_info
    thr = _band_gap_threshold(ordered, body)
    # İki sütunlu sayfa metni: gutter çoğu zaman 18–40pt
    if best_gap < max(thr * 0.85, body * 1.5, 14.0):
        return False
    bounds = _column_bounds_from_band(ordered, body)
    if len(bounds) < 2 or len(bounds) > 4:
        # Basit ikiye böl (en büyük gap)
        return _is_two_column_prose_band(ordered, body)
    for (x0, x1), (nx0, _nx1) in zip(bounds, bounds[1:]):
        if nx0 - x1 < body * 1.0:
            return False
    cells = _assign_band_to_columns(ordered, bounds)
    filled = [c for c in cells if c and len(c) >= 3]
    return len(filled) >= 2


def _is_two_column_prose_band(items: list[dict[str, Any]], body: float) -> bool:
    """
    Aynı satırda sol | gutter | sağ — satış türleri / başvuru süreci gibi
    iki paralel paragraf sütunu.
    """
    if len(items) < 2:
        return False
    ordered = sorted(items, key=lambda s: s["x0"])
    gap_info = _largest_horizontal_gap(ordered)
    if not gap_info:
        return False
    best_gap, best_i = gap_info
    if best_gap < max(body * 1.5, 14.0):
        return False
    left = ordered[: best_i + 1]
    right = ordered[best_i + 1 :]
    if not left or not right:
        return False
    left_len = sum(len(s.get("text") or "") for s in left)
    right_len = sum(len(s.get("text") or "") for s in right)
    if left_len < 6 or right_len < 6:
        return False
    left_x1 = max(s["x1"] for s in left)
    right_x0 = min(s["x0"] for s in right)
    if right_x0 - left_x1 < max(body * 1.2, 12.0):
        return False
    # Kelime aralığı değil: sol grubun sağ kenarı ile sağ grubun sol kenarı
    # ve her iki taraf da 'sütun' gibi bir miktar genişlik tutsun
    left_w = left_x1 - min(s["x0"] for s in left)
    right_w = max(s["x1"] for s in right) - right_x0
    return left_w >= body * 2.0 and right_w >= body * 2.0


def _band_dominant_side(
    band: list[dict[str, Any]], page_mid: float
) -> str | None:
    if not band:
        return None
    cx = sum((s["x0"] + s["x1"]) / 2.0 for s in band) / len(band)
    # Orta şeritte belirsiz
    if abs(cx - page_mid) < 18:
        return None
    return "L" if cx < page_mid else "R"


def _cluster_looks_like_parallel_columns(
    spans: list[dict[str, Any]], page_mid: float
) -> bool:
    """Zigzag L/R satırları gerçekten iki paralel sütun mu?"""
    left = [s for s in spans if (s["x0"] + s["x1"]) / 2.0 < page_mid - 8]
    right = [s for s in spans if (s["x0"] + s["x1"]) / 2.0 > page_mid + 8]
    if len(left) < 3 or len(right) < 3:
        return False
    left_chars = sum(len(s.get("text") or "") for s in left)
    right_chars = sum(len(s.get("text") or "") for s in right)
    if left_chars < 40 or right_chars < 40:
        return False
    # Her iki sütun da benzer dikey aralıkta
    left_y0, left_y1 = min(s["y0"] for s in left), max(s["y1"] for s in left)
    right_y0, right_y1 = min(s["y0"] for s in right), max(s["y1"] for s in right)
    overlap = min(left_y1, right_y1) - max(left_y0, right_y0)
    span_h = max(left_y1, right_y1) - min(left_y0, right_y0)
    return span_h > 0 and overlap / span_h >= 0.45


def _group_y_bands(
    spans: list[dict[str, Any]], body: float
) -> list[list[dict[str, Any]]]:
    if not spans:
        return []
    # Okuma sırası karışık gelse bile aynı satırı birleştir
    ordered = sorted(spans, key=lambda s: (round(s["y0"], 1), s["x0"]))
    tol = body * 0.55
    bands: list[list[dict[str, Any]]] = []
    cur: list[dict[str, Any]] = [ordered[0]]
    cur_y = ordered[0]["y0"]
    for sp in ordered[1:]:
        if abs(sp["y0"] - cur_y) <= tol:
            cur.append(sp)
            cur_y = sum(s["y0"] for s in cur) / len(cur)
        else:
            bands.append(cur)
            cur = [sp]
            cur_y = sp["y0"]
    bands.append(cur)
    return bands


def _column_bounds_from_band(
    band: list[dict[str, Any]], body: float
) -> list[tuple[float, float]]:
    """Yatay boşluklara göre sütun x aralıkları."""
    ordered = sorted(band, key=lambda s: s["x0"])
    if len(ordered) < 2:
        x0, x1 = ordered[0]["x0"], ordered[0]["x1"]
        return [(x0, x1)]

    thr = _band_gap_threshold(ordered, body)
    groups: list[list[dict[str, Any]]] = [[ordered[0]]]
    for sp in ordered[1:]:
        gap = sp["x0"] - groups[-1][-1]["x1"]
        if gap >= thr:
            groups.append([sp])
        else:
            groups[-1].append(sp)

    bounds: list[tuple[float, float]] = []
    for g in groups:
        bounds.append(
            (min(s["x0"] for s in g), max(s["x1"] for s in g)),
        )
    return bounds


def _assign_band_to_columns(
    band: list[dict[str, Any]],
    bounds: list[tuple[float, float]],
) -> list[str]:
    """Her span'i x konumuna göre sütuna ata; hücre içinde soldan sağa birleştir."""
    n = len(bounds)
    buckets: list[list[dict[str, Any]]] = [[] for _ in range(n)]
    margin = 10.0

    for sp in band:
        cx = (sp["x0"] + sp["x1"]) / 2.0
        best_i = 0
        best_d = 1e9
        for i, (x0, x1) in enumerate(bounds):
            mid = (x0 + x1) / 2.0
            d = abs(cx - mid)
            if x0 - margin <= cx <= x1 + margin and d < best_d:
                best_d = d
                best_i = i
            elif d < best_d:
                best_d = d
                best_i = i
        buckets[best_i].append(sp)

    out: list[str] = []
    for bucket in buckets:
        if not bucket:
            out.append("")
            continue
        bucket.sort(key=lambda s: s["x0"])
        out.append(_normalize_line(" ".join(s["text"] for s in bucket)))
    return out


def _merge_column_bands(
    bands: list[list[dict[str, Any]]],
    body: float,
    page: fitz.Page | None = None,
) -> list[dict[str, Any]]:
    """
    1) KPI / büyük rakam kartları → görsel
    2) Yan yana / iki sütunlu sayfa → görsel (satır satır birleştirme yok)
    3) Tek sütun prose → metin
    """
    out: list[dict[str, Any]] = []
    page_mid = 300.0
    if page is not None:
        page_mid = float(page.rect.width) / 2.0
    elif bands:
        flat = [s for b in bands for s in b]
        if flat:
            page_mid = (min(s["x0"] for s in flat) + max(s["x1"] for s in flat)) / 2.0

    i = 0
    while i < len(bands):
        band = bands[i]

        # --- KPI / istatistik kart kümesi ---
        if _band_is_stat_like(band):
            region_spans: list[dict[str, Any]] = list(band)
            j = i + 1
            prev_bottom = max(s["y1"] for s in band)
            while j < len(bands) and j - i < 16:
                nxt = bands[j]
                next_top = min(s["y0"] for s in nxt)
                if next_top - prev_bottom > body * 4.8:
                    break
                if not _band_is_stat_like(nxt):
                    break
                if any(
                    len(s.get("text") or "") > 55
                    and not _span_is_stat_atom(s)
                    for s in nxt
                ):
                    break
                region_spans.extend(nxt)
                prev_bottom = max(s["y1"] for s in nxt)
                j += 1
            if _cluster_is_kpi_block(region_spans):
                out.append(
                    _emit_clip_unit(
                        page,
                        region_spans,
                        body,
                        alt="Gösterge",
                    )
                )
                i = j
                continue

        # --- Zigzag: L,R,L,R… (sütunlar farklı y baseline) ---
        side0 = _band_dominant_side(band, page_mid)
        if side0 and not (
            _is_column_band(band, body)
            or _is_multi_column_layout(band, body)
            or _is_two_column_prose_band(band, body)
        ):
            zig: list[dict[str, Any]] = list(band)
            j = i + 1
            prev_bottom = max(s["y1"] for s in band)
            prev_side = side0
            alternations = 0
            while j < len(bands) and j - i < 48:
                nxt = bands[j]
                next_top = min(s["y0"] for s in nxt)
                if next_top - prev_bottom > body * 3.2:
                    break
                # Aynı satırda iki sütun başladıysa zigzag değil, aşağıdaki layout yolu
                if (
                    _is_multi_column_layout(nxt, body)
                    or _is_two_column_prose_band(nxt, body)
                    or _is_column_band(nxt, body)
                ):
                    break
                side = _band_dominant_side(nxt, page_mid)
                if side is None or side == prev_side:
                    break
                zig.extend(nxt)
                prev_bottom = max(s["y1"] for s in nxt)
                prev_side = side
                alternations += 1
                j += 1
            if alternations >= 3 and _cluster_looks_like_parallel_columns(zig, page_mid):
                out.append(
                    _emit_clip_unit(page, zig, body, alt="İki sütun")
                )
                i = j
                continue

        layout = (
            _is_column_band(band, body)
            or _is_multi_column_layout(band, body)
            or _is_two_column_prose_band(band, body)
        )
        if not layout:
            out.append({"type": "prose", "items": band, "y0": band[0]["y0"]})
            i += 1
            continue

        bounds = _column_bounds_from_band(band, body)
        if len(bounds) < 2 and _is_two_column_prose_band(band, body):
            # En büyük gap ile zorunlu iki sütun
            gap_info = _largest_horizontal_gap(band)
            if gap_info:
                ordered = sorted(band, key=lambda s: s["x0"])
                _, bi = gap_info
                left = ordered[: bi + 1]
                right = ordered[bi + 1 :]
                bounds = [
                    (min(s["x0"] for s in left), max(s["x1"] for s in left)),
                    (min(s["x0"] for s in right), max(s["x1"] for s in right)),
                ]
        n_cols = len(bounds)
        if n_cols < 2:
            out.append({"type": "prose", "items": band, "y0": band[0]["y0"]})
            i += 1
            continue

        header = _assign_band_to_columns(band, bounds)
        bodies = [""] * n_cols
        region_spans = list(band)
        j = i + 1
        prev_bottom = max(s["y1"] for s in band)
        body_bands = 0

        while j < len(bands) and body_bands < 40:
            nxt = bands[j]
            next_top = min(s["y0"] for s in nxt)
            if next_top - prev_bottom > body * 5.0:
                break
            # Yeni kavram-kutu başlık satırı (iki sütun prose devamı değilse)
            if (
                _is_column_band(nxt, body)
                and body_bands >= 1
                and not _is_two_column_prose_band(nxt, body)
                and not _is_multi_column_layout(nxt, body)
            ):
                break

            multi = (
                _is_multi_column_layout(nxt, body)
                or _is_two_column_prose_band(nxt, body)
            )
            assigned = _assign_band_to_columns(nxt, bounds)
            filled = sum(1 for c in assigned if c)

            # KPI devam satırları (Türk Lirası vb.) sütun layout olmasa da al
            if _band_is_stat_like(nxt) and next_top - prev_bottom <= body * 3.8:
                region_spans.extend(nxt)
                for ci, text in enumerate(assigned):
                    if text and ci < len(bodies):
                        bodies[ci] = (
                            f"{bodies[ci]} {text}".strip() if bodies[ci] else text
                        )
                prev_bottom = max(s["y1"] for s in nxt)
                body_bands += 1
                j += 1
                continue

            # Aynı yatay düzende devam (çok sütun / iki sütun prose)
            if multi and next_top - prev_bottom <= body * 4.0:
                for ci, text in enumerate(assigned):
                    if not text:
                        continue
                    if ci < len(bodies):
                        bodies[ci] = (
                            f"{bodies[ci]} {text}".strip() if bodies[ci] else text
                        )
                region_spans.extend(nxt)
                prev_bottom = max(s["y1"] for s in nxt)
                body_bands += 1
                j += 1
                continue

            # Zigzag devam: yalnızca sol veya yalnızca sağ satır
            side = _band_dominant_side(nxt, page_mid)
            if (
                side
                and filled <= 1
                and next_top - prev_bottom <= body * 2.8
                and body_bands >= 0
            ):
                region_spans.extend(nxt)
                for ci, text in enumerate(assigned):
                    if text and ci < len(bodies):
                        bodies[ci] = (
                            f"{bodies[ci]} {text}".strip() if bodies[ci] else text
                        )
                prev_bottom = max(s["y1"] for s in nxt)
                body_bands += 1
                j += 1
                continue

            if filled < 1:
                break
            if (
                body_bands == 0
                and filled == 1
                and all(_cell_looks_like_title(c) for c in assigned if c)
            ):
                break
            if filled == 1 and body_bands >= 1:
                only = next((c for c in assigned if c), "")
                if len(only) > 70:
                    break
            if filled == 1 and next_top - prev_bottom > body * 2.2:
                break

            for ci, text in enumerate(assigned):
                if not text:
                    continue
                bodies[ci] = f"{bodies[ci]} {text}".strip() if bodies[ci] else text
            region_spans.extend(nxt)
            prev_bottom = max(s["y1"] for s in nxt)
            body_bands += 1
            j += 1

        # Okunabilir iki sütun → alt alta metin; bozuksa bölge görseli
        text_md = _md_column_sections(header, bodies)
        filled_bodies = sum(1 for b in bodies if len((b or "").strip()) >= 10)
        filled_headers = sum(1 for h in header if (h or "").strip())
        prefer_text = filled_bodies >= 2 or (filled_headers >= 2 and filled_bodies >= 1)
        if prefer_text and text_md.strip():
            out.append(
                {
                    "type": "sections",
                    "markdown": text_md,
                    "y0": band[0]["y0"],
                }
            )
        else:
            out.append(
                _emit_clip_unit(
                    page,
                    region_spans,
                    body,
                    alt="Şekil",
                    fallback_md=text_md,
                )
            )
        i = j
    return out


def _spans_to_markdown(
    spans: list[dict[str, Any]],
    body_size: float,
    ban: set[str],
    native_tables: list[dict[str, Any]] | None = None,
    page: fitz.Page | None = None,
) -> str:
    native_tables = native_tables or []

    # Native tablo bölgelerindeki span'leri çıkar (çift yazım olmasın)
    filtered: list[dict[str, Any]] = []
    for sp in spans:
        text = sp["text"]
        if _is_page_number(text):
            continue
        if text.casefold() in ban:
            continue
        if any(_span_inside(sp, t["rect"]) for t in native_tables):
            continue
        filtered.append(sp)

    bands = _group_y_bands(filtered, body_size)
    units = _merge_column_bands(bands, body_size, page=page)

    # Native tabloları y0 ile birleştir
    events: list[tuple[float, str, Any]] = []
    for t in native_tables:
        events.append((t["y0"], "native", t["markdown"]))
    for u in units:
        events.append((u["y0"], u["type"], u))
    events.sort(key=lambda e: e[0])

    lines: list[str] = []
    para: list[str] = []
    prev_y: float | None = None

    def flush_para() -> None:
        nonlocal para
        if not para:
            return
        lines.append(" ".join(para).strip())
        para = []

    for _y, kind, payload in events:
        if kind == "native":
            flush_para()
            lines.append(payload)
            prev_y = _y
            continue

        if kind == "sections":
            flush_para()
            md = payload.get("markdown") if isinstance(payload, dict) else None
            if md:
                lines.append(md)
            prev_y = _y
            continue

        if kind == "table":
            flush_para()
            md = _md_table(
                payload["rows"],
                boxes=bool(payload.get("boxes")),
            )
            if md:
                lines.append(md)
            prev_y = _y
            continue

        # prose band
        items = sorted(payload["items"], key=lambda s: s["x0"])
        if not items:
            continue

        y = items[0]["y0"]

        # Son çare: kaçmış iki sütun satırını yan yana birleştirme — görsel kes
        if page is not None and (
            _is_two_column_prose_band(items, body_size)
            or _is_multi_column_layout(items, body_size)
        ):
            flush_para()
            clipped = _emit_clip_unit(
                page, items, body_size, alt="İki sütun"
            )
            md = clipped.get("markdown") or ""
            if md.startswith("!["):
                lines.append(md)
                prev_y = y
                continue

        text = _normalize_line(" ".join(s["text"] for s in items))
        if not text:
            continue

        # Geniş yatay boşluk varsa yine de tek satırda birleştirme
        gap_info = _largest_horizontal_gap(items)
        if gap_info and gap_info[0] >= max(body_size * 1.8, 16.0):
            flush_para()
            ordered = items
            _, bi = gap_info
            left = _normalize_line(
                " ".join(s["text"] for s in ordered[: bi + 1])
            )
            right = _normalize_line(
                " ".join(s["text"] for s in ordered[bi + 1 :])
            )
            if left:
                lines.append(left)
            if right:
                lines.append(right)
            prev_y = y
            continue

        size = _median([s["size"] for s in items])
        bold = any(s["bold"] for s in items)

        if prev_y is not None and (y - prev_y) > body_size * 1.85:
            flush_para()

        level = _heading_level(size, body_size, bold, text)
        if level:
            flush_para()
            lines.append(f"{'#' * level} {text}")
            prev_y = y
            continue

        if re.match(r"^([•●▪‣·]|[-–—])\s+", text) or re.match(
            r"^\d+[.)]\s+\S", text
        ):
            flush_para()
            if re.match(r"^\d+[.)]\s+", text):
                body = re.sub(r"^\d+[.)]\s+", "", text)
                lines.append(f"1. {body}")
            else:
                body = re.sub(r"^([•●▪‣·]|[-–—])\s+", "", text)
                lines.append(f"- {body}")
            prev_y = y
            continue

        if re.match(r"^(tanım|önemli|dikkat|örnek|not)\s*[:：]", text, re.I):
            flush_para()
            m = re.match(
                r"^(tanım|önemli|dikkat|örnek|not)\s*[:：]\s*(.*)$",
                text,
                re.I,
            )
            if m:
                label = m.group(1).capitalize()
                lines.append(f"> **{label}:** {m.group(2).strip()}")
            prev_y = y
            continue

        if para and re.search(r"[-\u2010\u2011]$", para[-1]):
            para[-1] = re.sub(r"[-\u2010\u2011]$", "", para[-1]) + text
        elif (
            prev_y is not None
            and abs(y - prev_y) < body_size * 0.45
            and para
        ):
            para.append(text)
        elif (
            para
            and not re.search(r"[.!?…]$", para[-1])
            and (y - (prev_y or y)) <= body_size * 1.85
        ):
            para.append(text)
        else:
            para.append(text)

        prev_y = y

    flush_para()
    return "\n\n".join(lines).strip()


def extract_pdf_to_markdown_pages(pdf_bytes: bytes) -> dict[str, Any]:
    """
    Returns:
      {
        engine: "pymupdf",
        totalPages: int,
        pages: [{ pageNumber, text (markdown), imageCount }],
        markdown: full doc markdown
      }
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        all_sizes: list[float] = []
        pages_spans: list[list[dict[str, Any]]] = []
        image_counts: list[int] = []
        pages_tables: list[list[dict[str, Any]]] = []

        for page in doc:
            spans = _collect_spans(page)
            pages_spans.append(spans)
            pages_tables.append(_extract_native_tables(page))
            for s in spans:
                if 7 <= s["size"] <= 18:
                    all_sizes.append(s["size"])
            raw = page.get_text("dict")
            n_img = sum(1 for b in raw.get("blocks", []) if b.get("type") == 1)
            image_counts.append(n_img)

        body = _median(all_sizes) if all_sizes else 11.0
        ban = _find_repeating_margins(pages_spans)

        pages_out: list[dict[str, Any]] = []
        md_parts: list[str] = []

        for i, spans in enumerate(pages_spans):
            md = _spans_to_markdown(
                spans, body, ban, pages_tables[i], page=doc[i]
            )
            n_img = image_counts[i] if i < len(image_counts) else 0
            if n_img > 0 and md:
                md = md + "\n\n<!-- study:page-image -->"
            elif n_img > 0 and not md:
                md = "<!-- study:page-image -->"

            pages_out.append(
                {
                    "pageNumber": i + 1,
                    "text": _repair_turkish(md),
                    "imageCount": n_img,
                }
            )
            if md:
                md_parts.append(f"<!-- page {i + 1} -->\n\n{_repair_turkish(md)}")

        return {
            "engine": "pymupdf",
            "totalPages": len(pages_out),
            "pages": pages_out,
            "markdown": "\n\n---\n\n".join(md_parts),
            "bodyFontSize": round(body, 2),
        }
    finally:
        doc.close()
