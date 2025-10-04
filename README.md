# 🧾 Rabbit Receipt Scanner | WIP

Ein modernes Web-Tool zum Scannen und Verarbeiten von Belegen für das Rabbit R1-Gerät mit OCR-Unterstützung und automatischem E-Mail-Versand via Rabbit LLM.

## ✨ Funktionen

- 📷 **Beleg-Scanning über Kamera** - Nutzt die Gerätekamera für hochwertige Scans
- 🔤 **OCR-Texterkennung** - Unterstützt Deutsch und Englisch mit Tesseract.js
- 🧠 **Intelligente Interpretation** - Erkennt automatisch Summen, Datum und wichtige Informationen
- 📧 **Automatischer E-Mail-Versand** - Sendet Scan-Ergebnisse automatisch per Rabbit LLM Mail
- 📱 **Optimiert für Rabbit R1** - Speziell angepasstes UI (240x282px)
- 🎨 **Modernes Design** - Dunkles Theme mit orangenen Akzenten

## 🚀 Verwendung

1. **"Scan Receipt" Button drücken** - Startet die Kamera
2. **Beleg positionieren und antippen** - "Tap to capture" erscheint unten
3. **Automatische Verarbeitung** - OCR läuft automatisch
4. **Ergebnisse anzeigen** - Text wird interpretiert und angezeigt
5. **Automatischer E-Mail-Versand** - Receipt wird automatisch per Rabbit LLM an Ihre E-Mail gesendet

## 📧 Rabbit LLM Mail Integration

### Automatischer Trigger

Die App sendet nach jedem erfolgreichen Scan automatisch eine E-Mail über die Rabbit LLM API:

```javascript
// TRIGGER: Nach erfolgreichem OCR-Scan
await sendReceiptViaRabbitMail(ocrResultText);
```

### Was wird gesendet?

**E-Mail enthält:**
- **Subject:** "Receipt Scan - [Datum/Uhrzeit]"
- **Body:** Formatierter OCR-Text mit erkannten Informationen (Summe, Datum, etc.)
- **Attachment:** Originalfoto des gescannten Belegs als JPEG

### API-Verwendung

Die App nutzt die `rabbit.llm.sendMailToSelf()` API:

```javascript
await rabbit.llm.sendMailToSelf({
  subject: `Receipt Scan - ${timestamp}`,
  body: ocrText,
  attachment: capturedImageData  // Base64 JPEG
});
```

### Browser-Modus

Beim Testen im Browser (ohne Rabbit LLM API) wird der Versand simuliert und in der Console geloggt.

## 🛠️ Technologie-Stack

- **HTML5** - Modernes Markup
- **CSS3** - Responsive Design mit Flexbox
- **JavaScript (ES6+)** - Moderne asynchrone Programmierung
- **Tesseract.js 4.x** - OCR-Engine für Deutsch & Englisch
- **Rabbit LLM API** - `rabbit.llm.sendMailToSelf()` für E-Mail-Versand
- **MediaDevices API** - Kamerazugriff
- **Canvas API** - Bildverarbeitung

## 📂 Dateistruktur

```
rabbit-receipt-scanner/
├── index.html          # Haupt-HTML mit Inline-CSS (ohne Email-Input)
├── main.js             # Hauptlogik mit Rabbit LLM Mail-Trigger
├── r1-cam.png          # Kamera-Icon
├── rabbit.png          # Rabbit-Logo
└── README.md           # Diese Datei
```

## 🎨 UI-Anpassungen

### Header
- Zeigt immer "rabbit receipt scanner" statt dynamischem Status
- Fixe Höhe von 32px mit dunklem Hintergrund

### Scan-Button
- Großer, runder Button (80x80px) in Orange
- Kamera-Icon aus r1-cam.png
- Zentriert im Content-Bereich

### Kamera-Vorschau
- Vollbild-Ansicht mit Video-Stream
- "Tap to capture" Overlay am unteren Rand
- Aktivierung durch Antippen der Vorschau

### Ergebnisse
- Hervorgehobene Informationen (Summe, Datum) in farbiger Box
- Vollständiger OCR-Text darunter
- Scrollbar bei langen Texten
- Erfolgsanzeige "✓ Receipt sent!" nach E-Mail-Versand

## 🌍 OCR-Sprachunterstützung

Die OCR-Engine ist für Deutsch und Englisch konfiguriert:

```javascript
const worker = await Tesseract.createWorker(['deu', 'eng'], 1, { ... });
```

### Erkennungsmuster

**Deutsche Begriffe:**
- Summe, Gesamt, Betrag
- Datum-Formate: DD.MM.YYYY, DD/MM/YYYY
- EUR, € Symbole

**Englische Begriffe:**
- Total, Amount
- Datum-Formate: MM/DD/YYYY, YYYY-MM-DD
- EUR, € Symbole

## 🚀 Deployment

### GitHub Pages (Aktuell aktiv)

Das Projekt ist automatisch über GitHub Pages verfügbar:
- **URL:** https://atomlabor.github.io/rabbit-receipt-scanner/
- Automatisches Deployment bei jedem Push zu main

### Lokale Entwicklung

1. Repository klonen:
```bash
git clone https://github.com/atomlabor/rabbit-receipt-scanner.git
cd rabbit-receipt-scanner
```

2. Lokalen Server starten (z.B. mit Python):
```bash
python -m http.server 8000
```

3. Browser öffnen: http://localhost:8000

### Produktions-Deployment

1. Files auf Webserver hochladen
2. **HTTPS verwenden** (für Kamerazugriff erforderlich!)
3. Auf Rabbit R1 deployen für volle Rabbit LLM API-Unterstützung

## 🔐 Sicherheitshinweise

- **HTTPS erforderlich** - Die MediaDevices API funktioniert nur über HTTPS
- **Keine externe Konfiguration** - Rabbit LLM API erfordert keine SMTP-Zugangsdaten
- **Keine Speicherung** - Bilder und Texte werden nicht serverseitig gespeichert
- **Automatischer Versand** - E-Mail wird nach jedem Scan automatisch an Ihre Rabbit-Account-E-Mail gesendet

## 📝 Changelog

### Version 3.0 (2025-10-03)
- ✅ **Rabbit LLM Integration** - Ersetzt SMTP durch `rabbit.llm.sendMailToSelf()`
- ✅ **Automatischer Trigger** - E-Mail wird nach erfolgreichem Scan automatisch gesendet
- ✅ **Dokumentierter Trigger** - Vollständige JSDoc-Dokumentation in main.js
- ✅ **Email-Input entfernt** - Keine manuelle E-Mail-Eingabe mehr nötig
- ✅ **SMTP.js entfernt** - Keine externen SMTP-Konfigurationen mehr erforderlich
- ✅ **Vereinfachtes UI** - Cleaner ohne Email-Eingabefeld

### Version 2.0 (2025-10-03)
- ✅ E-Mail-Eingabe nach oben verschoben (über Scan-Button)
- ✅ "Click to scan" Overlay entfernt
- ✅ Header zeigt jetzt "rabbit receipt scanner" statt "Ready"
- ✅ "Tap to capture" Overlay am unteren Rand der Kamera-Vorschau
- ✅ SMTP.js für Open-Source E-Mail-Versand integriert
- ✅ EmailJS entfernt, vollständig durch SMTP.js ersetzt
- ✅ Verbesserte OCR-Interpretation für Deutsch & Englisch
- ✅ Automatische Erkennung von Summen und Datum
- ✅ E-Mail mit formatiertem HTML und Bild-Anhang

### Version 1.0 (2025-10-01)
- 🎉 Initiale Version
- Basis-Funktionalität mit Kamera und OCR

## 🤝 Beiträge

Beiträge sind willkommen! Bitte erstellen Sie einen Pull Request mit einer Beschreibung Ihrer Änderungen.

## 📄 Lizenz

Dieses Projekt ist öffentlich verfügbar und kann frei verwendet werden.

## 💡 Support

Bei Fragen oder Problemen erstellen Sie bitte ein Issue auf GitHub.

---

Made with ❤️ for Rabbit R1
