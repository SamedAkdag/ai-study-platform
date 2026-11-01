# EMA Lightning (yerel kopya)

Tarayıcı TTS modeli buradan sunulur: `/models/ema/`.

## İlk kurulum

```bash
npm run ema:models
```

İndirilenler (`*.onnx`, `normalizer.wasm`, `meta.json`) `public/models/ema/` altına yazılır.
Vite / production build bunları kendi origin’inizden verir; Hugging Face’e gerek kalmaz.
Tarayıcı yine Cache Storage kullanır — sonraki ziyaretlerde anında açılır.

Zorla yeniden indirmek için:

```bash
npm run ema:models:force
```

`npm run build` eksik dosyaları otomatik çeker.

## Dosyalar (~36 MB)

| Dosya | Açıklama |
| --- | --- |
| `meta.json` | kelime dağarcığı / hop |
| `normalizer.wasm` | Türkçe metin normalizer |
| `text.onnx` | harf → gizli durum |
| `sound.onnx` | latent frame |
| `decoder.onnx` | dalga formu |

Upstream (Apache-2.0): https://huggingface.co/ozcancelik/ema-lightning-onnx
