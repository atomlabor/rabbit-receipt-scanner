# 🧾 Rabbit Receipt Scanner | WIP (Experimentell)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/E1E51DRUM)

Blog: https://atomlabor.de

⚠️ Experimentelles Projekt – OCR-basierte Belegerkennung kann unzuverlässig sein. Dies ist ein Work‑in‑Progress.

---

## 🇩🇪 Deutsch

Wichtiger Hinweis zum aktuellen Stand:
- UI-Sprache: Nur Deutsch. Die Benutzeroberfläche ist ausschließlich auf Deutsch verfügbar.
- OCR-Sprachen: Texterkennung funktioniert für Deutsch und Englisch.
- Versand nach jedem Scan: Ergebnistext und Foto werden automatisch per Rabbit LLM an die eigene Rabbit‑E‑Mail gesendet (nur echtes Rabbit‑Gerät).
- OCR-Feld-Höhe: Der sichtbare OCR-Textbereich hat eine maximale Höhe von 160px.
- Branding/Titel: Branding und Titel bleiben unverändert.
- Ladeanimation: rabbit-thinking.gif wird als Ladeanimation verwendet.
- Ko‑fi: Der Ko‑fi‑Button oben bleibt unverändert erhalten.

### 🎯 Über das Projekt
Rabbit Receipt Scanner nutzt die Kamera des Rabbit R1, um Belege aufzunehmen und per OCR auszulesen. Die App ist für das Portrait‑Format des Rabbit R1 optimiert und sendet die erkannten Daten nach jedem Scan automatisch per E‑Mail über die Rabbit LLM API.

Hinweis: OCR (Optical Character Recognition) ist fehleranfällig – insbesondere bei schlechter Beleuchtung, verknitterten Belegen oder unleserlicher Schrift. Dieses Projekt ist ein Proof‑of‑Concept und befindet sich in aktiver Entwicklung.

### ✨ Features
- 📷 Portrait‑Kamera‑Modus: Optimiertes Rabbit‑R1‑Viewport (240×282 px), Rückkamera, Tap‑to‑Capture
- 🔤 Dynamische Single‑Language‑OCR: Lädt zur Laufzeit nur benötigte Sprachdateien (deu/eng)
- 🖼️ Bildvorverarbeitung: Helligkeit/Kontrast, Binarisierung, Canvas‑Filter
- 📧 Automatischer E‑Mail‑Versand: `rabbit.llm.sendMailToSelf()` mit OCR‑Text + Original‑Foto als Anhang; funktioniert nur auf echtem Rabbit R1 (Browser simuliert)
- 🎨 Intuitive UI: Dunkles Theme, großer Scan‑Button, Live‑Vorschau, hervorgehobene Ergebnisse
- 📝 OCR‑Ausgabe: Sichtbereich mit `max-height: 160px` und Scrollmöglichkeit
- ⏳ Ladeanimation: Verwendung von `rabbit-thinking.gif` während der Verarbeitung

### ⚠️ Wichtige Hinweise
OCR kann fehlschlagen bei schlechter Beleuchtung, verknitterten/verschmutzten Belegen, Handschrift, ungewöhnlichen Fonts oder verblasstem Thermopapier. Für bessere Ergebnisse: gute Beleuchtung, Beleg flach ausrichten, Kamera senkrecht halten, vollständigen Ausschnitt erfassen, ggf. mehrfach scannen.

### 🚀 Verwendung
1. App auf dem Rabbit R1 öffnen
2. "Scan Receipt" drücken → Kamera startet
3. Beleg positionieren → "Tap to capture" erscheint
4. Auf Vorschau tippen → Foto wird aufgenommen
5. OCR startet → Bild wird vorverarbeitet & analysiert
6. Ergebnis ansehen → Text (z. B. Summe, Datum)
7. Automatische E‑Mail → OCR‑Text und Foto via Rabbit LLM an dein Rabbit‑Postfach

---

## 🇬🇧 English (UK)

Current status note:
- UI language: German only. The user interface is available in German only.
- OCR languages: OCR works for German and English.
- Post‑scan email: After each scan, the recognised text and the photo are mailed via Rabbit LLM to your Rabbit email (Rabbit device only).
- OCR field height: The visible OCR text area has a maximum height of 160px.
- Branding/title: Branding and title remain unchanged.
- Loading animation: rabbit-thinking.gif is used as the loading animation.
- Ko‑fi: The Ko‑fi button above remains unchanged.

### 🎯 About the project
Rabbit Receipt Scanner uses the Rabbit R1 camera to capture receipts and read them via OCR. The app is optimised for the Rabbit R1 portrait layout and automatically emails the recognised data after every scan via the Rabbit LLM API.

Note: OCR can be error‑prone – especially in poor lighting, with crumpled receipts or hard‑to‑read typefaces. This is a proof‑of‑concept and under active development.

### ✨ Features
- 📷 Portrait camera mode: Optimised Rabbit R1 viewport (240×282 px), rear camera, tap‑to‑capture
- 🔤 Dynamic single‑language OCR: Loads only the required language files at runtime (deu/eng)
- 🖼️ Image pre‑processing: brightness/contrast, binarisation, canvas filters
- 📧 Automatic email: `rabbit.llm.sendMailToSelf()` sends OCR text + original photo; works only on a real Rabbit R1 (browser simulates)
- 🎨 Intuitive UI: dark theme, large scan button, live preview, highlighted results
- 📝 OCR output: visible area with `max-height: 160px` and scroll capability
- ⏳ Loading: uses `rabbit-thinking.gif` during processing

### ⚠️ Important notes
OCR may fail with poor lighting, crumpled/dirty receipts, handwriting, unusual fonts, or faded thermal paper. For better results: use even lighting, place the receipt flat, hold the camera directly above, keep the receipt fully in frame, and retry if needed.

### 🚀 How to use
1. Open the app on the Rabbit R1
2. Press "Scan Receipt" → camera starts
3. Position the receipt → "Tap to capture" appears
4. Tap the preview → a photo is taken
5. OCR runs → image is pre‑processed and analysed
6. View results → text (e.g. total, date)
7. Automatic email → OCR text and photo via Rabbit LLM to your Rabbit inbox

---

## 🛠️ Tech stack
- HTML5, CSS3 (inline, flexbox for Rabbit R1 viewport)
- JavaScript (ES6+), async logic with promises
- Tesseract.js 4.x – OCR engine (deu/eng)
- Rabbit LLM API – `rabbit.llm.sendMailToSelf()` for email
- MediaDevices API – camera access (HTTPS required)
- Canvas API – image pre‑processing & filters

## 📂 Project structure
```
rabbit-receipt-scanner/
├── index.html          # Main UI with inline CSS
├── main.js             # Core logic: camera, OCR, email trigger
├── tesseract/          # Tesseract.js worker & language files
├── r1-cam.png          # Camera icon for scan button
├── rabbit-thinking.gif # Loading animation
├── rabbit.png          # Rabbit logo (optional)
└── README.md           # This file
```

## 🚀 Setup & deployment
### GitHub Pages (live)
Publicly available at:
👉 https://atomlabor.github.io/rabbit-receipt-scanner/
- Automatic deployments on every push to `main`
- HTTPS enabled (required for camera access)

### Local development
```bash
# Clone the repository
git clone https://github.com/atomlabor/rabbit-receipt-scanner.git
cd rabbit-receipt-scanner
# Start a local web server (HTTPS required for camera!)
python -m http.server 8000
# Open your browser
open http://localhost:8000
```
Note: The Rabbit LLM API only works on a real Rabbit R1. In a desktop browser the email step is simulated and logged to the console.

### Production
- Host on a server with HTTPS
- Deploy to a Rabbit R1 for full functionality
- No email configuration needed (uses Rabbit LLM API)

## 🔐 Security & privacy
- HTTPS required – MediaDevices API works only over a secure connection
- No server storage – all data stays on the device
- No external APIs – only Rabbit LLM and Tesseract.js (client‑side)
- No authentication – Rabbit LLM uses your R1 account automatically

## 📦 Dependencies
- Tesseract.js – OCR engine (CDN or locally in `/tesseract/`)
- Rabbit LLM API – available only on a real Rabbit R1

## 🤝 Credits
Built by atomlabor for the Rabbit R1 community.
- Rabbit R1 – hardware & LLM API
- Tesseract.js – open‑source OCR engine
- GitHub Pages – hosting

## 💡 Support & issues
For questions or problems, please open an issue: https://github.com/atomlabor/rabbit-receipt-scanner/issues

## 📄 Licence
This project is publicly available and may be used freely (no specific licence).

Made with ❤️ for Rabbit R1
