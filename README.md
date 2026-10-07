# Tesla Inventory Checker

Selbst gehosteter Bestandsprüfer für Tesla Model 3 / Model Y in Deutschland.
Zwei Docker-Dienste laufen gemeinsam auf einem Linux-AMD64-Host, insbesondere
dem getesteten UGREEN-NAS am Heimanschluss:

1. **scraper**: Python, Chrome auf Xvfb, `nodriver` und `curl_cffi`; liefert vollständige Bestandsantworten.
2. **watcher**: TypeScript; Profile, SQLite und dauerhafte Versandaufträge für Telegram/SMTP.

Kein angeschlossener Bildschirm, Tesla-Konto oder Login erforderlich. Keine
Reservierungen, Käufe, CAPTCHA-Lösung oder Proxy-Rotation. Der Ansatz orientiert
sich an [TeslaWebScrape](https://github.com/JumpBearCode/TeslaWebScrape); das
undokumentierte Tesla-Format und die Erreichbarkeit können sich jederzeit ändern.
Der VPS war in unseren Tests blockiert; nativer Chrome-Headless-Modus ebenfalls.
Die NAS-Ergebnisse sind keine Garantie für dauerhaften Zugang oder Lieferung 2026.

## Ablauf und Grenzen

- Eine vollständige Abfrage pro Markt/Modell/Zustand, gemeinsam für alle passenden Profile.
- Mindestens 60 Sekunden Pause nach einem Zyklus plus 0–10 Sekunden Zufallsaufschlag; keine überlappenden Zyklen.
- Browser und Cookies werden wiederverwendet. Nach standardmäßig 30 Minuten wird eine neue Sitzung erzeugt; das ist eine Betriebsgrenze, keine behauptete Cookie-Lebensdauer.
- Ein API-401/403 erlaubt höchstens eine Sitzungserneuerung. Bleibt der Fehler bestehen, Pause. Eine im Browser erkannte Sperre wird sofort als Fehler behandelt.
- HTTP 429 respektiert `Retry-After`; andere Fehler erhalten steigende Wartezeiten. Keine Neustartschleifen bei Tesla-Sperren.
- Alle exakten Ergebnisseiten werden geladen. Doppelte VINs, wechselnde Trefferzahlen oder unvollständige Seiten machen den Abruf ungültig. Keine Aktualisierung der Erstaufnahme aus Teilantworten.
- Die Webseite kann ungefragt Baujahre und Postleitzahlen vorbelegen. Diese Filter werden vor der Deutschland-Abfrage entfernt; Profilfilter prüft ausschließlich der Watcher.
- `approximate` / `approximateOutside` sind ausdrücklich keine exakten Treffer und werden nicht übernommen.
- Ein erfolgreicher leerer Bestand bleibt von Zugriffssperren und Schemafehlern unterscheidbar.
- Keine freie Ziel-URL in der Abrufschnittstelle; nur Deutschland, m3/my und new/used.

## Profile

`profiles.example.json` ist ein Ausgangspunkt, keine verifizierte Liste aktueller
Tesla-Verkaufsbezeichnungen. Kopiere sie nach `profiles.json` und passe sie an.
Alle belegten Filter müssen passen. Einträge innerhalb einer Liste sind Alternativen.

Die Filter vergleichen vollständige normalisierte Bezeichnungen oder exakte
Tesla-Optionscodes. Es gibt **keine Teilstring-Suche**: `AWD` ist nicht automatisch
`Premium AWD`, `Grau` nicht automatisch `Stealth Grey`, `Black` nicht `Black and White`.
Fehlende Merkmale ergeben bei einem entsprechenden Filter keinen Treffer.
`OptionCodeData` wird mit der ausgewählten `OptionCodeList` abgeglichen;
`OptionCodeSpecs` wird nur für den tatsächlich ausgewählten Code ausgewertet.
Unbekannte Codes werden nicht als bekannte Ausstattungen geraten.

Verwende tatsächliche Antwortfelder zur Pflege der Profile. Für Diagnose ohne
VIN-/Cookie-Ausgabe gibt es `smoke.py --sample-schema`. Für neue Varianten müssen
repräsentative Neuwagendaten die Zuordnung bestätigen; ein leerer Bestand genügt nicht.

## Einrichtung auf dem NAS

Für die konkrete, eingerichtete Installation siehe [NAS-Betriebsanleitung](docs/NAS-OPERATIONS.md).

Docker und Docker Compose müssen installiert sein. Der SSH-Benutzer braucht
Docker-Zugriff; die Docker-Gruppe verleiht praktisch Administratorrechte.
SSH nur im Heimnetz/VPN freigeben. Kein Router-Portforwarding nötig.

Repository auf dem NAS auschecken; danach im Projektverzeichnis:

```sh
cp .env.example .env
cp profiles.example.json profiles.json
cp reports.example.json reports.json
mkdir -p state
chmod 600 .env
```

Der Watcher läuft als UID 1000; `state` muss für diese UID beschreibbar sein.
Nur diesen neu angelegten Projektordner entsprechend berechtigen, keine NAS-Freigaben
rekursiv umkonfigurieren. Bestehende `.env`, Profile oder Datenbanken nicht überschreiben.

Konfiguration in `.env`:

| Variable | Standard / Zweck |
| --- | --- |
| `INVENTORY_PROVIDER` | `browser`; `direct` ausdrücklich auswählbarer alter Adapter, kein automatischer Fallback |
| `POLL_INTERVAL_SECONDS` | `60`, Minimum 60 |
| `SESSION_MAX_AGE_SECONDS` | `1800` |
| `BROWSER_NO_SANDBOX` | Muss `false` bleiben; unsicherer Betrieb wird abgelehnt |
| `NOTIFY_ON_FIRST_SEEN` | `false`: erste vollständige Aufnahme bleibt still |
| `TECHNICAL_ALERTS` | `false`: keine Abruf-Störungsmeldungen; mit `true` gebündelte Störungsalarme |
| `REPORTS_CONFIG_PATH` | `/app/config/reports.json`; separate Konfiguration der Bestandsberichte |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Nur an den Watcher übergeben |
| `SMTP_*`, `EMAIL_FROM`, `EMAIL_TO` | Optionaler E-Mail-Kanal |
| `WATCHER_IMAGE`, `SCRAPER_IMAGE` | Veröffentlichte, zusammengehörige Release-Tags |

Aktiviere in den Profilen nur Kanäle, für die Zugangsdaten vorhanden sind.
Zugangsdaten, reale Profile, Browserdaten und SQLite sind aus Git und Docker-Builds
ausgeschlossen. Bereits öffentlich geteilte Bot-Tokens vor Produktion rotieren.

## Tägliche Bestandsberichte

`reports.json` steuert unabhängig von `profiles.json` die regelmäßigen Berichte:

```json
{
  "enabled": true,
  "timezone": "Europe/Berlin",
  "times": ["08:00", "12:00", "16:00", "20:00"],
  "notify": {"telegram": true, "email": true}
}
```

Die Anzahl der Uhrzeiten bestimmt die Häufigkeit (bis zu 24 unterschiedliche
`HH:mm`-Termine täglich). `enabled: false` deaktiviert Berichte. Mit den beiden
`notify`-Schaltern lassen sich Telegram und E-Mail einzeln auswählen; aktive
Kanäle benötigen die entsprechenden Zugangsdaten. Nach Änderungen den Watcher
neu starten: `docker compose restart watcher`. Die echte Datei bleibt außerhalb
von Git. Der Docker-Bind-Mount verlangt, dass `reports.json` vor dem Start existiert.
Beim direkten Programmstart ohne Datei bleibt die optionale Funktion deaktiviert.

Gezählt werden **alle vollständig abgerufenen Fahrzeuge in Teslas Kategorie
„Neu“ für Deutschland**, getrennt nach Model 3 und Model Y, einschließlich dort
gelisteter Vorführwagen. Kein Profil-, Preis-, Farb-, Innenraum- oder Antriebsfilter;
auch ohne aktive Suchprofile funktioniert der Bericht. Die Zahlen sind der
aktuelle Gesamtbestand, **nicht die neuen Zugänge seit der letzten Meldung**.
Die Kategorie ist keine Garantie für einen bestimmten Liefertermin.

Profilprüfungen und Berichte teilen sich höchstens 60 Sekunden alte vollständige
Antworten. Fehlerpausen werden gemeinsam respektiert. Pro Modell steht der
Datenstand im Bericht. Ein fehlgeschlagener oder unvollständiger Abruf ergibt
„aktuell nicht verfügbar“, niemals eine erfundene Null oder einen alten Ersatzwert.
Eine gültige Leerantwort ergibt dagegen ausdrücklich null Fahrzeuge.

Der laufende Watcher prüft fällige Termine auch während seiner Poll-Pausen.
Laufende Abrufe/Versand können den Termin verzögern. Nach einem kurzen Ausfall
wird nur der jüngste Termin innerhalb der letzten Stunde nachgeholt; ältere
Termine werden übersprungen. Bei der Zeitumstellung entfällt eine nicht existente
Uhrzeit, eine doppelte Uhrzeit wird nur einmal pro Kalendertag gemeldet.

Berichte und Versandzustände werden in SQLite dauerhaft gespeichert. Neustarts
senden bereits bestätigte Kanäle nicht erneut. Fehlgeschlagene Kanäle werden mit
steigendem Abstand erneut versucht, höchstens bis eine Stunde nach dem Termin.
Ein neuer Bericht ersetzt noch ausstehende ältere Berichte. Deaktivierte Kanäle
oder entfernte Termine verwerfen zugehörige wartende Sendungen. Nachträgliches
Hinzufügen eines Kanals versendet vorhandene Berichte nicht rückwirkend.
Wie bei Fahrzeugmeldungen kann ein Absturz genau zwischen externer Annahme und
lokaler Bestätigung eine Doppelmeldung verursachen. Die Berichte ersetzen keinen
externen Ausfallwächter: Bei vollständigem NAS-Ausfall bleibt auch ihr Versand aus.

### Chrome-Sandbox: verpflichtend und geprüft

Ab v0.3.0 verwendet der Scraper ein eingechecktes, eng angepasstes
[Seccomp-Profil](security/README.md). Damit läuft Chrome auf dem getesteten NAS
mit Xvfb **und** aktiver Browser-Sandbox. AppArmor, Nicht-root, entfernte Linux-
Capabilities, `no-new-privileges` und read-only bleiben erhalten.

Vor jedem neuen Browser-/Sitzungsstart prüft der Scraper Chromes eigene Statusseite
auf Namespace-, PID-, Netzwerk- und Seccomp-Schutz. Schlägt die Prüfung fehl, findet
kein Tesla-Abruf statt. `BROWSER_NO_SANDBOX=true` wird ausdrücklich abgelehnt.
Niemals `privileged`, zusätzliche Host-Rechte oder eine deaktivierte Sandbox
verwenden, um den Start zu erzwingen.

Der Scraper erhält keine SMTP-/Telegram-Secrets, keine dauerhaften Volumes und
keine veröffentlichten Ports. Beide Dienste benötigen ausgehenden Internetzugang.

## Zuerst ohne Benachrichtigungen testen

Lokal auf dem NAS bauen (alternativ Release-Images ziehen):

```sh
docker compose build
docker compose -p tesla-sandbox-test -f compose.sandbox.yaml run --rm sandbox-check
docker compose up -d scraper
docker compose run --rm live-check
```

`live-check` hat keine Benachrichtigungszugänge und keinen SQLite-Mount. Es verändert
die produktive Erstaufnahme nicht. Andere Kontrollabfragen:

```sh
docker compose run --rm -e LIVE_MODEL=m3 -e LIVE_CONDITION=used live-check
docker compose run --rm -e LIVE_MODEL=my -e LIVE_CONDITION=new live-check
docker compose exec scraper python smoke.py --model m3 --condition used --sample-schema
```

Nach erfolgreicher Prüfung bewusst den Watcher aktivieren:

```sh
docker compose up -d watcher
docker compose logs --tail=100 watcher
docker compose exec watcher node dist/status.js
```

Healthchecks prüfen Prozess-Lebendigkeit. Eine Tesla-Sperre soll keinen
Restart-Sturm auslösen. Der Zustand der Datenquelle ist getrennt sichtbar über
`status.js` (letzter erfolgreicher Poll, Versandwarteschlange) und Scraper `/health`
(letzter erfolgreicher Abruf, Fehlercode). Eine grüne Containeranzeige allein
beweist keine aktuellen Fahrzeugdaten.

Mit `TECHNICAL_ALERTS=true` sendet der laufende Watcher nach drei aufeinanderfolgenden
Abruffehlern eine Störungsmeldung über **alle konfigurierten Kanäle**, unabhängig
von den Fahrzeugprofilen. Erfolgreich gesendete Störungsmeldungen werden auf eine
pro Stunde begrenzt. Durch Tesla-Fehlerpausen kann die erste Meldung bei einer
Sperre etwa 30 Minuten benötigen. Fehlgeschlagene Fahrzeugnachrichten bleiben in
der Versandwarteschlange, lösen aber keinen eigenen Störungsalarm aus.

`restart: unless-stopped` startet beendete Container nach einem Absturz oder einem
Docker-Neustart erneut, sofern sie nicht bewusst gestoppt wurden. Ein lediglich
`unhealthy` markierter, aber noch laufender Container wird dadurch nicht neu gestartet.

**NAS-, Strom- oder vollständige Internetausfälle können die Dienste nicht selbst
melden.** Dafür ist ein unabhängiger externer Ausfallwächter erforderlich, etwa
ein Dead-Man-Monitor mit ausgehenden Erfolgspings nach vollständigen Abrufzyklen.
Eine solche externe Überwachung ist noch nicht integriert; ein grüner Docker-
Healthcheck oder aktiviertes SMTP ersetzt sie nicht.

Ein separat gestarteter, begrenzter Dauertest bleibt ohne echte Meldungen:

```sh
docker compose exec scraper python soak.py --cycles 1440 --interval 60
```

Er prüft m3 gebraucht als Positivkontrolle sowie beide Neuwagenabfragen, respektiert
Fehlerpausen und dauert wegen Abrufzeiten mindestens etwa 24 Stunden. Nicht parallel
zum produktiven Watcher betreiben. Er startet nicht automatisch bei Installation.

## Benachrichtigungen und SQLite

Treffer und Versandaufträge werden pro vollständiger Abfrage atomar gespeichert.
Telegram und E-Mail haben getrennte Zustände. Fehler werden mit 30 Sekunden bis
maximal einer Stunde Abstand erneut versucht, auch wenn später Tesla-Abrufe scheitern.
Ein verschwundenes Fahrzeug bleibt als bereits beobachteter Treffer in der Warteschlange;
Verfügbarkeit deshalb beim Öffnen des Links erneut prüfen.

Der Status `sent` wird erst nach erfolgreicher Kanalantwort gesetzt. Bei einem
Absturz zwischen externer Annahme und lokaler Bestätigung sind Doppelmeldungen
möglich (At-least-once, nicht Exactly-once).

Geänderte Profile erhalten eine neue Erstaufnahme; wartende Aufträge alter oder
deaktivierter Profile werden verworfen. Profile werden beim Prozessstart geladen:
nach Änderungen `docker compose restart watcher`. Mit
`NOTIFY_ON_FIRST_SEEN=true` werden vorhandene Treffer beim ersten Durchlauf einer
neuen Profilversion gemeldet. Ein späteres Umschalten spielt bereits still
aufgenommene Fahrzeuge nicht erneut ab.

Schema v3 ergänzt die Berichte samt eigener Versandwarteschlange; v2 führte die
Fahrzeug-Versandwarteschlange ein. Vor dem Upgrade einer vorhandenen
Datenbank entsteht automatisch ein konsistentes `*.pre-v3-*.sqlite`-Backup.
Frühere Sendemarkierungen und stille Erstaufnahmen werden konservativ erhalten.
Fehlgeschlagene v1-Sendungen sind nicht von still beobachteten Fahrzeugen
unterscheidbar und werden bei der Migration nicht nachträglich geraten.
Genau **eine Watcher-Instanz je Datenbank** betreiben.

Der explizite Nachrichtentest sendet ein synthetisches Testfahrzeug und fragt
Tesla nicht ab:

```sh
docker compose run --rm --no-deps watcher node dist/test-notification.js
```

## Entwicklung und Tests

Node >=22.13, Python 3.13 für die Produktionsumgebung; die Python-Unit-Tests
benötigen nur die Standardbibliothek. CI fragt Tesla nicht ab und sendet keine Nachrichten.

Der echte Browser-Sandbox-Test benötigt einen kompatiblen Linux-AMD64-Docker-Host.
Auf dem getesteten Apple-Silicon-Mac verweigert Docker Desktop im emulierten
AMD64-Container die erforderlichen User-Namespaces auch mit dem angepassten Profil.
Unit- und HTTP-Integrationstests sind dort möglich; Browser-/Sandbox-/Live-Tests
auf dem NAS ausführen. Keine Sicherheitsoptionen abschalten, um die Emulation
zu erzwingen.

```sh
npm ci
npm run check
npm test
npm run test:python
npm run build
npm run test:sandbox
docker compose -p tesla-tests -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from integration
docker compose -p tesla-tests -f compose.test.yaml down --volumes
```

Der Docker-Test läuft auf einem Netzwerk ohne Internetzugang. Er verbindet die
echte Python-HTTP-Grenze, TypeScript-Normalisierung, Filter und SQLite mit
kontrollierten Inventardaten und simulierten Nachrichtensendern, einschließlich
ungefilterter Bestandsberichte für beide Modelle und Kanäle. Die Fixture-
Implementierung wird nicht in das Produktionsimage kopiert.

## Releases, Updates und Rückwechsel

Ein Tag wie `v0.4.0` führt zuerst Tests inklusive Offline-Browserprüfung aus und veröffentlicht dann zwei AMD64-Images:

- `ghcr.io/<owner>/<repository>:0.4.0`
- `ghcr.io/<owner>/<repository>-scraper:0.4.0`

Compose verwendet zunächst lokale Image-Namen für `docker compose build`.
Für Releases die beiden Image-Variablen in `.env` auf die GHCR-Namen setzen.
Private GHCR-Pakete benötigen `docker login ghcr.io`
mit Leseberechtigung. Niemals Tokens in das Repository schreiben.

Auf dem NAS:

```sh
docker compose pull
docker compose -p tesla-sandbox-test -f compose.sandbox.yaml run --rm sandbox-check
docker compose up -d scraper
docker compose run --rm live-check
docker compose up -d watcher
```

Beide Image-Versionen gemeinsam aktualisieren. Für einen rollbackfähigen Datenstand
den Watcher vorher stoppen und `state` sowie lokale Konfigurationen sichern.
Vor dem ersten Upgrade auf v0.4.0 auch `reports.json` anlegen.
Bei einem Rückwechsel auf eine ältere Datenbankschema-Version **auch
das vor der Migration gesicherte Datenbankabbild wiederherstellen**, nicht die neue
Datenbank mit dem alten Programm weiterverwenden. Währenddessen entstandene
Versandzustände gehen beim Rückwechsel verloren; Doppelmeldungen sind möglich.

Chrome wird beim Build auf die freigegebene Version geprüft. Liefert Google eine
andere Version, schlägt ein frischer Build absichtlich fehl, statt ungetestet zu
aktualisieren. Die neue Version bewusst freigeben und auf dem Zielhost testen.
Release-Images sind die reproduzierbaren Deployment-Artefakte; Debian-Paketquellen
und der Chrome-Download sind kein langfristiges Quellarchiv. Die direkten und
transitiven Python-Abhängigkeiten sind festgelegt.
