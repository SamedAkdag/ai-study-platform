# Studium PDF Service

PyMuPDF ile yapılandırılmış **Markdown extract** + opsiyonel OCR (Docling / Tesseract).

## Ne yapar?

| Endpoint | Amaç |
|----------|------|
| `GET /health` | `pymupdf` / `docling` / `tesseract` |
| `POST /extract/pdf` | Metinli PDF → başlıklı Markdown (hızlı) |
| `POST /ocr/pdf` | Önce PyMuPDF; zayıfsa Docling/Tesseract |

Frontend (`VITE_OCR_SERVICE_URL`) servis açıksa PyMuPDF’i tercih eder; yoksa tarayıcı pdf.js yoluna düşer.

## Windows kurulum

```bat
cd ocr-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload --host 127.0.0.1 --port 8787
```

veya `start.bat`

Frontend `.env.local`:

```
VITE_OCR_SERVICE_URL=http://127.0.0.1:8787
```

## Test

```bat
curl http://127.0.0.1:8787/health
curl -F "file=@ornek.pdf" http://127.0.0.1:8787/extract/pdf
```

## Opsiyonel OCR

Tarama PDF’ler için:

- Tesseract + Poppler (Windows)
- veya `pip install docling` (ağır)

Metinli PDF’lerde **sadece pymupdf yeterli**.
