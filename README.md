# 🧾 Rabbit Receipt Scanner

Ein modernes Web-Tool zum Scannen und Verarbeiten von Belegen für das Rabbit R1-Gerät mit OCR-Unterstützung und E-Mail-Versand.

## ✨ Funktionen

- 📷 **Beleg-Scanning über Kamera** - Nutzt die Gerätekamera für hochwertige Scans
- 🔤 **OCR-Texterkennung** - Unterstützt Deutsch und Englisch mit Tesseract.js
- 🧠 **Intelligente Interpretation** - Erkennt automatisch Summen, Datum und wichtige Informationen
- 📧 **E-Mail-Versand** - Sendet Scan-Ergebnisse direkt per E-Mail (SMTP)
- 📱 **Optimiert für Rabbit R1** - Speziell angepasstes UI (240x282px)
- 🎨 **Modernes Design** - Dunkles Theme mit orangenen Akzenten

## 🚀 Verwendung

1. **E-Mail-Adresse eingeben** (optional) - Oben im Eingabefeld
2. **"Scan Receipt" Button drücken** - Startet die Kamera
3. **Beleg positionieren und antippen** - "Tap to capture" erscheint unten
4. **Automatische Verarbeitung** - OCR läuft automatisch
5. **Ergebnisse anzeigen** - Text wird interpretiert und angezeigt
6. **E-Mail-Versand** - Automatisch wenn E-Mail-Adresse eingegeben

## 🔧 SMTP-Konfiguration (für E-Mail-Funktion)

### Schnellstart mit SMTP.js

Die Anwendung verwendet [SMTP.js](https://smtpjs.com/) für den E-Mail-Versand. Um die E-Mail-Funktion zu aktivieren:

#### Option 1: SMTP.js SecureToken (Empfohlen für Produktion)

1. Besuchen Sie https://smtpjs.com/
2. Erstellen Sie einen kostenlosen Account
3. Generieren Sie einen **SecureToken** mit Ihren SMTP-Zugangsdaten
4. Öffnen Sie `main.js` und ersetzen Sie in der `sendEmail()` Funktion:

```javascript
const smtpConfig = {
  SecureToken: 'YOUR_SECURE_TOKEN', // ← Hier Ihren SecureToken einfügen
  To: toEmail,
  From: 'receipts@yourdomain.com', // ← Ihre Absender-E-Mail
  Subject: 'Receipt Scan - ' + new Date().toLocaleDateString(),
  // ...
};
```

#### Option 2: SMTP-Server-Daten direkt (nur für Tests)

**⚠️ Warnung:** Verwenden Sie diese Methode NICHT in Produktionsumgebungen, da die Zugangsdaten im Code sichtbar sind!

```javascript
const smtpConfig = {
  Host: 'smtp.gmail.com',
  Username: 'your-email@gmail.com',
  Password: 'your-app-password',
  To: toEmail,
  From: 'your-email@gmail.com',
  Subject: 'Receipt Scan - ' + new Date().toLocaleDateString(),
  // ...
};
```

### Gmail-Konfiguration

Wenn Sie Gmail verwenden:

1. Aktivieren Sie die **2-Faktor-Authentifizierung** in Ihrem Google-Konto
2. Erstellen Sie ein **App-Passwort**:
   - Gehen Sie zu https://myaccount.google.com/apppasswords
   - Wählen Sie "Mail" und "Anderes Gerät"
   - Kopieren Sie das generierte 16-stellige Passwort
3. Verwenden Sie dieses App-Passwort in der SMTP-Konfiguration

### Alternative SMTP-Anbieter

- **Mailgun** - https://www.mailgun.com/
- **SendGrid** - https://sendgrid.com/
- **AWS SES** - https://aws.amazon.com/ses/
- **Postmark** - https://postmarkapp.com/

## 🛠️ Technologie-Stack

- **HTML5** - Modernes Markup
- **CSS3** - Responsive Design mit Flexbox
- **JavaScript (ES6+)** - Moderne asynchrone Programmierung
- **Tesseract.js 4.x** - OCR-Engine für Deutsch & Englisch
- **SMTP.js** - Open-Source E-Mail-Client für Browser
- **MediaDevices API** - Kamerazugriff
- **Canvas API** - Bildverarbeitung

## 📂 Dateistruktur

```
rabbit-receipt-scanner/
├── index.html          # Haupt-HTML mit Inline-CSS
├── main.js             # Hauptlogik (Kamera, OCR, E-Mail)
├── r1-cam.png          # Kamera-Icon
├── rabbit.png          # Rabbit-Logo
└── README.md           # Diese Datei
```

## 🎨 UI-Anpassungen

### Header
- Zeigt immer "rabbit receipt scanner" statt dynamischem Status
- Fixe Höhe von 32px mit dunklem Hintergrund

### E-Mail-Eingabe
- **Neu:** Befindet sich ganz oben, direkt unter dem Header
- Kompaktes Design mit Label und Input-Feld
- Fokus-Highlight in Orange (#ff6b00)

### Scan-Button
- Großer, runder Button (80x80px) in Orange
- Kamera-Icon aus r1-cam.png
- Zentriert im Content-Bereich

### Kamera-Vorschau
- Vollbild-Ansicht mit Video-Stream
- **"Tap to capture" Overlay** am unteren Rand (nicht mehr "Click to scan")
- Aktivierung durch Antippen der Vorschau

### Ergebnisse
- Hervorgehobene Informationen (Summe, Datum) in farbiger Box
- Vollständiger OCR-Text darunter
- Scrollbar bei langen Texten

## 🌍 OCR-Sprachunterstützung

Die OCR-Engine ist für **Deutsch und Englisch** konfiguriert:

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
- URL: `https://atomlabor.github.io/rabbit-receipt-scanner/`
- Automatisches Deployment bei jedem Push zu `main`

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

3. Browser öffnen: `http://localhost:8000`

### Produktions-Deployment

1. SMTP-Konfiguration in `main.js` anpassen (siehe oben)
2. Files auf Webserver hochladen
3. HTTPS verwenden (für Kamerazugriff erforderlich!)

## 🔐 Sicherheitshinweise

- **HTTPS erforderlich** - Die MediaDevices API funktioniert nur über HTTPS
- **SMTP-Zugangsdaten** - Niemals im Code speichern! Nutzen Sie SecureToken von SMTP.js
- **E-Mail-Validierung** - Die App prüft das E-Mail-Format vor dem Versand
- **Keine Speicherung** - Bilder und Texte werden nicht serverseitig gespeichert

## 📝 Changelog

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

**Made with ❤️ for Rabbit R1**
