# 🧾 Rabbit Receipt Scanner | WIP (Experimentell)

Blog: https://atomlabor.de

⚠️ Experimentelles Projekt – OCR-basierte Belegerkennung kann unzuverlässig sein. Dies ist ein Work‑in‑Progress.

Eine experimentelle Web‑App für das Rabbit R1 zum Scannen von Belegen mit OCR‑Texterkennung (Deutsch/Englisch) und automatischem E‑Mail‑Versand über die Rabbit LLM API.

---

## 🎯 Über das Projekt

Rabbit Receipt Scanner ist ein experimentelles Tool, das die Kamera des Rabbit R1 nutzt, um Belege zu scannen und via OCR zu verarbeiten. Die App ist speziell für das Portrait‑Format des Rabbit R1 optimiert und sendet erkannte Daten automatisch per E‑Mail.

Hinweis: OCR (Optical Character Recognition) ist fehleranfällig – insbesondere bei schlechter Beleuchtung, verknitterten Belegen oder unleserlicher Schrift. Dieses Projekt dient als Proof‑of‑Concept und befindet sich in aktiver Entwicklung.

---

## ✨ Features

### 📷 Portrait‑Kamera‑Modus
- Optimiertes Portrait‑Viewport für Rabbit R1 (240×282 px)
- Rückseitenkamera (facingMode: 'environment')
- Touch‑to‑Capture Funktionalität

### 🔤 Dynamische Single‑Language‑OCR
- Automatische Spracherkennung (Deutsch oder Englisch)
- Tesseract.js 4.x basierte Texterkennung
- Lädt nur die benötigte Sprachdatei zur Laufzeit
- Reduzierte Ladezeiten durch Single‑Language Detection

### 🖼️ Adaptive Bildvorverarbeitung
- Automatische Helligkeitsanpassung
- Kontrastverstärkung für bessere OCR‑Qualität
- Binarisierung (Schwarz‑Weiß‑Konvertierung)
- Canvas‑basierte Bildfilterung

### 📧 Automatischer E‑Mail‑Versand
- Integration mit Rabbit LLM API (`rabbit.llm.sendMailToSelf()`)
- Sendet OCR‑Text + Original‑Foto als Anhang
- Keine manuelle E‑Mail‑Konfiguration erforderlich
- Funktioniert nur auf echtem Rabbit R1 (Browser‑Modus = Simulation)

### 🎨 Intuitive UI
- Dunkles Theme mit orangenen Akzenten
- Großer Scan‑Button mit Kamera‑Icon
- Live‑Kamera‑Vorschau mit „Tap to capture“ Overlay
- Hervorgehobene Ergebnisse (Summe, Datum) in farbiger Box

---

## ⚠️ Wichtige Hinweise

OCR ist experimentell und kann fehlschlagen bei:
- Schlechter Beleuchtung
- Verknitterten oder verschmutzten Belegen
- Handschriftlichen Notizen
- Ungewöhnlichen Schriftarten
- Thermopapier mit verblassten Stellen

Best Practices für bessere Ergebnisse:
- Gute, gleichmäßige Beleuchtung verwenden
- Beleg flach auf eine Unterlage legen
- Kamera direkt über dem Beleg positionieren
- Beleg vollständig im Bildausschnitt erfassen
- Mehrere Versuche bei schlechten Ergebnissen

---

## 🚀 Verwendung

1. App auf dem Rabbit R1 öffnen
2. „Scan Receipt“ drücken → Kamera startet
3. Beleg positionieren → „Tap to capture“ erscheint am unteren Rand
4. Auf Vorschau tippen → Foto wird aufgenommen
5. OCR läuft automatisch → Bild wird vorverarbeitet & analysiert
6. Ergebnisse anzeigen → Text wird interpretiert (Summe, Datum, etc.)
7. Automatischer E‑Mail‑Versand → Mail geht an deine Rabbit‑Account‑Adresse

---

## 🛠️ Technologie‑Stack
- HTML5 – Strukturiertes Markup
- CSS3 – Inline‑Styles mit Flexbox für Rabbit R1 Viewport
- JavaScript (ES6+) – Asynchrone Logik, Promise‑basiert
- Tesseract.js 4.x – OCR‑Engine (deu/eng)
- Rabbit LLM API – `rabbit.llm.sendMailToSelf()` für E‑Mail‑Versand
- MediaDevices API – Kamerazugriff (HTTPS erforderlich!)
- Canvas API – Bildvorverarbeitung & Filter

---

## 📂 Projektstruktur
```
rabbit-receipt-scanner/
├── index.html          # Main UI mit Inline-CSS
├── main.js             # Hauptlogik: Kamera, OCR, Mail-Trigger
├── tesseract/          # Tesseract.js Worker & Language Files
├── r1-cam.png          # Kamera-Icon für Scan-Button
├── rabbit.png          # Rabbit-Logo (optional)
└── README.md           # Diese Datei
```

---

## 🚀 Setup & Deployment

### GitHub Pages (Live)
Das Projekt ist öffentlich verfügbar unter:

👉 https://atomlabor.github.io/rabbit-receipt-scanner/

- Automatisches Deployment bei jedem Push zu `main`
- HTTPS ist aktiviert (erforderlich für Kamerazugriff)

### Lokale Entwicklung
```bash
# Repository klonen
git clone https://github.com/atomlabor/rabbit-receipt-scanner.git
cd rabbit-receipt-scanner

# Lokalen Webserver starten (HTTPS erforderlich für Kamera!)
python -m http.server 8000

# Browser öffnen
open http://localhost:8000
```
Hinweis: Die Rabbit LLM API funktioniert nur auf echtem Rabbit R1. Im Browser wird der E‑Mail‑Versand simuliert und in der Console geloggt.

### Produktion
- Auf Webserver mit HTTPS hosten
- Für volle Funktionalität auf Rabbit R1 deployen
- Keine E‑Mail‑Konfiguration erforderlich (nutzt Rabbit LLM API)

---

## 🔐 Sicherheit & Datenschutz
- HTTPS erforderlich – MediaDevices API funktioniert nur über sichere Verbindung
- Keine Server‑Speicherung – Alle Daten bleiben auf dem Gerät
- Keine externen APIs – Nur Rabbit LLM und Tesseract.js (client‑side)
- Keine Authentifizierung – Rabbit LLM nutzt automatisch deine R1‑Account‑Daten

---

## 📦 Dependencies
- Tesseract.js – OCR‑Engine (CDN oder lokal in `/tesseract/`)
- Rabbit LLM API – Nur auf echtem Rabbit R1 verfügbar

---

## 🤝 Credits
Entwickelt von atomlabor für die Rabbit R1 Community.
- Rabbit R1 – Hardware & LLM API
- Tesseract.js – Open‑Source OCR Engine
- GitHub Pages – Hosting

---

## 💡 Support & Issues
Bei Fragen oder Problemen erstelle bitte ein Issue auf GitHub: https://github.com/atomlabor/rabbit-receipt-scanner/issues

---

## 📄 Lizenz
Dieses Projekt ist öffentlich verfügbar und kann frei verwendet werden (keine spezifische Lizenz).

Made with ❤️ for Rabbit R1


---

# 🧾 Rabbit Receipt Scanner | WIP (Experimental) – English (UK)

Blog: https://atomlabor.de

⚠️ Experimental project – OCR‑based receipt recognition can be unreliable. This is a work‑in‑progress.

An experimental web app for the Rabbit R1 that scans receipts using OCR (German/English) and automatically emails the recognised data via the Rabbit LLM API.

---

## 🎯 About the project

Rabbit Receipt Scanner is an experimental tool that uses the Rabbit R1’s camera to capture receipts and process them via OCR. The app is optimised for the Rabbit R1’s portrait layout and automatically sends recognised data by email.

Note: OCR can be error‑prone – especially in poor lighting, with crumpled receipts, or difficult typefaces. This project is a proof‑of‑concept and under active development.

---

## ✨ Features

### 📷 Portrait camera mode
- Optimised portrait viewport for Rabbit R1 (240×282 px)
- Rear camera (facingMode: 'environment')
- Tap‑to‑capture functionality

### 🔤 Dynamic single‑language OCR
- Automatic language choice (German or English)
- Tesseract.js 4.x based text recognition
- Loads only the required language file at runtime
- Reduced load times via single‑language detection

### 🖼️ Adaptive image pre‑processing
- Automatic brightness adjustment
- Contrast enhancement for better OCR quality
- Binarisation (black‑and‑white conversion)
- Canvas‑based image filtering

### 📧 Automatic email after scan
- Integration with Rabbit LLM API (`rabbit.llm.sendMailToSelf()`)
- Sends OCR text plus the original photo as an attachment
- No manual email configuration required
- Works only on a real Rabbit R1 (browser mode = simulation)

### 🎨 Intuitive UI
- Dark theme with orange accents
- Large scan button with camera icon
- Live camera preview with “Tap to capture” overlay
- Highlighted results (total, date) in a coloured box

---

## ⚠️ Important notes

OCR is experimental and may fail with:
- Poor lighting
- Crumpled or dirty receipts
- Handwritten notes
- Unusual fonts
- Thermal paper with faded areas

Best practice tips:
- Use good, even lighting
- Place the receipt flat on a surface
- Hold the camera directly over the receipt
- Ensure the receipt is fully within frame
- Try multiple captures if results are poor

---

## 🚀 How to use

1. Open the app on the Rabbit R1
2. Press “Scan Receipt” → camera starts
3. Position the receipt → “Tap to capture” appears
4. Tap the preview → a photo is taken
5. OCR runs automatically → image is pre‑processed and analysed
6. View results → text is interpreted (total, date, etc.)
7. Automatic email → sent to your Rabbit account address

---

## 🛠️ Tech stack
- HTML5 – structured markup
- CSS3 – inline styles and flexbox for the Rabbit R1 viewport
- JavaScript (ES6+) – async logic, promises
- Tesseract.js 4.x – OCR engine (deu/eng)
- Rabbit LLM API – `rabbit.llm.sendMailToSelf()` for email
- MediaDevices API – camera access (HTTPS required!)
- Canvas API – image pre‑processing and filters

---

## 📂 Project structure
```
rabbit-receipt-scanner/
├── index.html          # Main UI with inline CSS
├── main.js             # Core logic: camera, OCR, email trigger
├── tesseract/          # Tesseract.js worker & language files
├── r1-cam.png          # Camera icon for scan button
├── rabbit.png          # Rabbit logo (optional)
└── README.md           # This file
```

---

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

---

## 🔐 Security & privacy
- HTTPS required – MediaDevices API works only over a secure connection
- No server storage – all data stays on the device
- No external APIs – only Rabbit LLM and Tesseract.js (client‑side)
- No authentication – Rabbit LLM uses your R1 account automatically

---

## 📦 Dependencies
- Tesseract.js – OCR engine (CDN or locally in `/tesseract/`)
- Rabbit LLM API – available only on a real Rabbit R1

---

## 🤝 Credits
Built by atomlabor for the Rabbit R1 community.
- Rabbit R1 – hardware & LLM API
- Tesseract.js – open‑source OCR engine
- GitHub Pages – hosting

---

## 💡 Support & issues
For questions or problems, please open an issue: https://github.com/atomlabor/rabbit-receipt-scanner/issues

---

## 📄 Licence
This project is publicly available and may be used freely (no specific licence).

Made with ❤️ for Rabbit R1
