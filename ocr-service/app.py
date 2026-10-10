"""
Studium PDF service — PyMuPDF extract + opsiyonel OCR (Docling/Tesseract).

Çalıştır:
  cd ocr-service
  python -m venv .venv
  .venv\\Scripts\\activate
  pip install -r requirements.txt
  uvicorn app:app --reload --host 127.0.0.1 --port 8787
"""

from __future__ import annotations

import os
import tempfile
from typing import Any, Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Studium PDF Service", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("OCR_CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Engine = Literal["docling", "tesseract", "pymupdf", "none"]


class PageOut(BaseModel):
    pageNumber: int
    text: str
    imageCount: int | None = None


class OcrResponse(BaseModel):
    engine: Engine
    totalPages: int
    pages: list[PageOut]
    warning: str | None = None
    markdown: str | None = None


def _configure_tesseract() -> None:
    import pytesseract

    env_cmd = os.getenv("TESSERACT_CMD")
    if env_cmd:
        pytesseract.pytesseract.tesseract_cmd = env_cmd
        return

    candidates = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        "/usr/bin/tesseract",
        "/usr/local/bin/tesseract",
    ]
    for path in candidates:
        if os.path.isfile(path):
            pytesseract.pytesseract.tesseract_cmd = path
            return


def _tesseract_available() -> bool:
    try:
        import pytesseract

        _configure_tesseract()
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def _docling_available() -> bool:
    try:
        import docling  # noqa: F401

        return True
    except Exception:
        return False


def _pymupdf_available() -> bool:
    try:
        import pymupdf  # noqa: F401

        return True
    except Exception:
        try:
            import fitz  # noqa: F401

            return True
        except Exception:
            return False


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "pymupdf": _pymupdf_available(),
        "docling": _docling_available(),
        "tesseract": _tesseract_available(),
    }


def ocr_docling(pdf_bytes: bytes) -> list[PageOut]:
    from collections import defaultdict

    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    pipeline = PdfPipelineOptions(
        do_ocr=True,
        do_table_structure=True,
    )
    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline),
        }
    )

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        path = tmp.name

    try:
        result = converter.convert(path)
        doc = result.document
        by_page: dict[int, list[str]] = defaultdict(list)

        try:
            for item, _level in doc.iterate_items():
                text = getattr(item, "text", None) or getattr(item, "orig", None)
                if not text or not str(text).strip():
                    continue
                page_no = 1
                prov = getattr(item, "prov", None) or []
                if prov:
                    p0 = prov[0]
                    page_no = int(
                        getattr(p0, "page_no", None) or getattr(p0, "page", 1) or 1
                    )
                by_page[page_no].append(str(text).strip())
        except Exception:
            by_page.clear()

        if by_page:
            return [
                PageOut(pageNumber=pn, text="\n\n".join(parts))
                for pn, parts in sorted(by_page.items())
            ]

        md = (doc.export_to_markdown() or "").strip()
        if not md:
            raise RuntimeError("Docling boş çıktı üretti")
        return [PageOut(pageNumber=1, text=md)]
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _preprocess_bgr(img_bgr):  # type: ignore[no-untyped-def]
    import cv2
    import numpy as np

    h, w = img_bgr.shape[:2]
    if max(h, w) < 1800:
        img_bgr = cv2.resize(
            img_bgr, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC
        )

    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    bw = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11
    )
    return bw


def ocr_tesseract(pdf_bytes: bytes, lang: str = "tur+eng") -> list[PageOut]:
    import cv2
    import numpy as np
    import pytesseract
    from pdf2image import convert_from_bytes
    from PIL import Image

    _configure_tesseract()
    poppler = os.getenv("POPPLER_PATH") or None
    dpi = int(os.getenv("OCR_DPI", "280"))

    images = convert_from_bytes(pdf_bytes, dpi=dpi, poppler_path=poppler)
    pages: list[PageOut] = []
    config = r"--oem 3 --psm 6"

    for i, pil in enumerate(images, start=1):
        bgr = cv2.cvtColor(np.array(pil.convert("RGB")), cv2.COLOR_RGB2BGR)
        bw = _preprocess_bgr(bgr)
        text = pytesseract.image_to_string(
            Image.fromarray(bw), lang=lang, config=config
        )
        pages.append(PageOut(pageNumber=i, text=(text or "").strip()))

    return pages


def _read_pdf_upload(file: UploadFile, data: bytes) -> None:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "PDF gerekli")
    if not data:
        raise HTTPException(400, "Boş dosya")
    max_mb = int(os.getenv("OCR_MAX_MB", "50"))
    if len(data) > max_mb * 1024 * 1024:
        raise HTTPException(400, f"Maksimum {max_mb}MB")


@app.post("/extract/pdf", response_model=OcrResponse)
async def extract_pdf(file: UploadFile = File(...)) -> OcrResponse:
    """
    Metinli PDF → yapılandırılmış Markdown (PyMuPDF).
    OCR yapmaz; tarama sayfalar boş/zayıf gelebilir.
    """
    data = await file.read()
    _read_pdf_upload(file, data)

    if not _pymupdf_available():
        raise HTTPException(
            503,
            "PyMuPDF yok. `pip install pymupdf` çalıştır.",
        )

    try:
        from extract_pymupdf import extract_pdf_to_markdown_pages

        result = extract_pdf_to_markdown_pages(data)
        pages = [
            PageOut(
                pageNumber=p["pageNumber"],
                text=p.get("text") or "",
                imageCount=p.get("imageCount"),
            )
            for p in result["pages"]
        ]
        return OcrResponse(
            engine="pymupdf",
            totalPages=result["totalPages"],
            pages=pages,
            markdown=result.get("markdown"),
        )
    except Exception as err:
        raise HTTPException(500, f"PyMuPDF extract başarısız: {err}") from err


@app.post("/ocr/pdf", response_model=OcrResponse)
async def ocr_pdf(
    file: UploadFile = File(...),
    prefer: str = "auto",
) -> OcrResponse:
    data = await file.read()
    _read_pdf_upload(file, data)

    prefer = (prefer or "auto").lower()
    errors: list[str] = []

    # Metinli PDF için önce hızlı PyMuPDF (OCR değil)
    if prefer in ("auto", "pymupdf") and _pymupdf_available():
        try:
            from extract_pymupdf import extract_pdf_to_markdown_pages

            result = extract_pdf_to_markdown_pages(data)
            pages = [
                PageOut(
                    pageNumber=p["pageNumber"],
                    text=p.get("text") or "",
                    imageCount=p.get("imageCount"),
                )
                for p in result["pages"]
            ]
            # Sayfaların çoğu doluysa OCR’a gerek yok
            nonempty = sum(1 for p in pages if len((p.text or "").strip()) >= 40)
            if nonempty >= max(1, int(len(pages) * 0.5)):
                return OcrResponse(
                    engine="pymupdf",
                    totalPages=len(pages),
                    pages=pages,
                    markdown=result.get("markdown"),
                )
            errors.append("pymupdf: çoğu sayfa boş — OCR’a düşülüyor")
        except Exception as err:
            errors.append(f"pymupdf: {err}")
            if prefer == "pymupdf":
                raise HTTPException(500, f"PyMuPDF başarısız: {err}") from err

    if prefer in ("auto", "docling") and _docling_available():
        try:
            pages = ocr_docling(data)
            return OcrResponse(
                engine="docling",
                totalPages=len(pages),
                pages=pages,
                warning="; ".join(errors) if errors else None,
            )
        except Exception as err:
            errors.append(f"docling: {err}")
            if prefer == "docling":
                raise HTTPException(500, f"Docling başarısız: {err}") from err

    if prefer in ("auto", "tesseract") and _tesseract_available():
        try:
            pages = ocr_tesseract(data)
            warning = None
            if errors:
                warning = "Önceki motorlar yetersiz, Tesseract kullanıldı. " + "; ".join(
                    errors
                )
            return OcrResponse(
                engine="tesseract",
                totalPages=len(pages),
                pages=pages,
                warning=warning,
            )
        except Exception as err:
            errors.append(f"tesseract: {err}")
            raise HTTPException(
                500,
                "OCR başarısız. " + "; ".join(errors),
            ) from err

    raise HTTPException(
        503,
        "Motor yok. `pip install pymupdf` (önerilen) veya Docling/Tesseract kur. "
        + (" | ".join(errors) if errors else ""),
    )
