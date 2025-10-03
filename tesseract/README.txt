This folder contains local fallback assets for Tesseract.js when CDN is not reachable.

Place the following files here:
- tesseract/worker.min.js (from tesseract.js@4.x dist)
- tesseract/tesseract-core.wasm.js (from tesseract.js@4.x dist)
- tesseract/lang/deu.traineddata (from tessdata_fast repo)

Paths expected by main.js fallback:
- ./tesseract/worker.min.js
- ./tesseract/tesseract-core.wasm.js
- ./tesseract/lang/deu.traineddata
