# 🧾 Rabbit Receipt Scanner | WIP

> ⚠️ **Experimentelles Projekt** – OCR-basierte Belegerkennung kann unzuverlässig sein. Dies ist ein Work-in-Progress.

Eine experimentelle Web-App für das Rabbit R1 zum Scannen von Belegen mit OCR-Texterkennung (Deutsch/Englisch) und automatischem E-Mail-Versand über die Rabbit LLM API.

---

## 🎯 Über das Projekt

**Rabbit Receipt Scanner** ist ein experimentelles Tool, das die Kamera des Rabbit R1 nutzt, um Belege zu scannen und via OCR zu verarbeiten. Die App ist speziell für das Portrait-Format des Rabbit R1 optimiert und sendet erkannte Daten automatisch per E-Mail.

**Hinweis:** OCR (Optical Character Recognition) ist fehleranfällig – insbesondere bei schlechter Beleuchtung, verknitterten Belegen oder unleserlicher Schrift. Dieses Projekt dient als Proof-of-Concept und befindet sich in aktiver Entwicklung.

---

## ✨ Features

### 📷 Portrait-Kamera-Modus
- Optimiertes Portrait-Viewport für Rabbit R1 (240x282px)
- Rückseitenkamera (facingMode: 'environment')
- Touch-to-Capture Funktionalität

### 🔤 Dynamische Single-Language-OCR
- Automatische Spracherkennung (Deutsch oder Englisch)
- Tesseract.js 4.x basierte Texterkennung
- Lädt nur die benötigte Sprachdatei zur Laufzeit
- Reduzierte Ladezeiten durch single-language detection

### 🖼️ Adaptive Bildvorverarbeitung
- Automatische Helligkeitsanpassung
- Kontrastverstärkung für bessere OCR-Qualität
- Binarisierung (Schwarz-Weiß-Konvertierung)
- Canvas-basierte Bildfilterung

### 📧 Automatischer E-Mail-Versand
- Integration mit Rabbit LLM API (`rabbit.llm.sendMailToSelf()`)
- Sendet OCR-Text + Original-Foto als Anhang
- Keine manuelle E-Mail-Konfiguration erforderlich
- Funktioniert nur auf echtem Rabbit R1 (Browser-Modus = Simulation)

### 🎨 Intuitive UI
- Dunkles Theme mit orangenen Akzenten
- Großer Scan-Button mit Kamera-Icon
- Live-Kamera-Vorschau mit "Tap to capture" Overlay
- Hervorgehobene Ergebnisse (Summe, Datum) in farbiger Box

---

## ⚠️ Wichtige Hinweise

**OCR ist experimentell und kann fehlschlagen bei:**
- Schlechter Beleuchtung
- Verknitterten oder verschmutzten Belegen
- Handschriftlichen Notizen
- Ungewöhnlichen Schriftarten
- Thermopapier mit verblassten Stellen

**Best Practices für bessere Ergebnisse:**
- Gute, gleichmäßige Beleuchtung verwenden
- Beleg flach auf eine Unterlage legen
- Kamera direkt über dem Beleg positionieren
- Beleg vollständig im Bildausschnitt erfassen
- Mehrere Versuche bei schlechten Ergebnissen

---

## 🚀 Verwendung

1. **App öffnen** auf Rabbit R1
2. **"Scan Receipt"** Button drücken → Kamera startet
3. **Beleg positionieren** → "Tap to capture" erscheint am unteren Rand
4. **Auf Vorschau tippen** → Foto wird aufgenommen
5. **OCR läuft automatisch** → Bild wird vorverarbeitet & analysiert
6. **Ergebnisse anzeigen** → Text wird interpretiert (Summe, Datum, etc.)
7. **Automatischer E-Mail-Versand** → Mail geht an deine Rabbit-Account-Adresse

---

## 🛠️ Technologie-Stack

- **HTML5** – Strukturiertes Markup
- **CSS3** – Inline-Styles mit Flexbox für Rabbit R1 Viewport
- **JavaScript (ES6+)** – Asynchrone Logik, Promise-basiert
- **Tesseract.js 4.x** – OCR-Engine (deu/eng)
- **Rabbit LLM API** – `rabbit.llm.sendMailToSelf()` für E-Mail-Versand
- **MediaDevices API** – Kamerazugriff (HTTPS erforderlich!)
- **Canvas API** – Bildvorverarbeitung & Filter

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

👉 **https://atomlabor.github.io/rabbit-receipt-scanner/**

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

**Hinweis:** Die Rabbit LLM API funktioniert nur auf echtem Rabbit R1. Im Browser wird der E-Mail-Versand simuliert und in der Console geloggt.

### Produktion
- Auf Webserver mit **HTTPS** hosten
- Für volle Funktionalität auf **Rabbit R1** deployen
- Keine E-Mail-Konfiguration erforderlich (nutzt Rabbit LLM API)

---

## 🔐 Sicherheit & Datenschutz

✅ **HTTPS erforderlich** – MediaDevices API funktioniert nur über sichere Verbindung
✅ **Keine Server-Speicherung** – Alle Daten bleiben auf dem Gerät
✅ **Keine externen APIs** – Nur Rabbit LLM und Tesseract.js (client-side)
✅ **Keine Authentifizierung** – Rabbit LLM nutzt automatisch deine R1-Account-Daten

---

## 📦 Dependencies

- **Tesseract.js** – OCR-Engine (CDN oder lokal in `/tesseract/`)
- **Rabbit LLM API** – Nur auf echtem Rabbit R1 verfügbar

---

## 🤝 Credits

Entwickelt von **atomlabor** für die **Rabbit R1 Community**.

- **Rabbit R1** – Hardware & LLM API
- **Tesseract.js** – Open-Source OCR Engine
- **GitHub Pages** – Hosting

---

## 💡 Support & Issues

Bei Fragen oder Problemen erstelle bitte ein [Issue auf GitHub](https://github.com/atomlabor/rabbit-receipt-scanner/issues).

---

## 📄 Lizenz

Dieses Projekt ist öffentlich verfügbar und kann frei verwendet werden (keine spezifische Lizenz).

---

**Made with ❤️ for Rabbit R1**
