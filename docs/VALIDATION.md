# Integrationsprüfung – 7. Oktober 2026 (Europe/Berlin)

## Aktualisierung v0.4.0: tägliche Bestandsberichte

- 47 Node-Tests und 36 Python-Tests erfolgreich; TypeScript-Typprüfung und Build erfolgreich.
- Neue Tests für Konfigurationsvalidierung, vier tägliche Termine, Berliner
  Sommer-/Winterzeit, Mitternacht, begrenztes Nachholen, unfiltrierte Zählung
  einschließlich Vorführwagen, Leerbestand versus Abruffehler, Snapshot-Cache und
  Fehlerpausen, getrennte Telegram-/E-Mail-Wiederholung, Neustart-Deduplizierung,
  abgelaufene/deaktivierte Sendungen und Datenbankmigration v2 → v3.
- Telegram-/SMTP-Nachrichtenformat mit simulierten Transporten geprüft; keine
  echten Nachrichten im Unit- oder Docker-Integrationstest.
- Isolierter Docker-HTTP-Test ohne Internet erfolgreich, einschließlich beider
  Bestandszahlen, beider simulierten Kanäle und Deduplizierung.
- Produktionsimages auf Linux AMD64 festgelegt. Offline-Chrome-Test auf dem NAS
  bestanden; Namespace-, PID-, Netzwerk- und Seccomp-Sandbox aktiv.
- NAS-Konfiguration validiert: zwei aktuelle Premium-Suchprofile, kein Preis-,
  Innenraum- oder Antriebsfilter. Model 3: Stealth Grey / Marine Blue; Model Y:
  Quicksilver / Stealth Grey / Marine Blue. Beide Benachrichtigungskanäle gemäß
  aktuellen lokalen Dateien übernommen.
- `reports.json`: 08:00, 12:00, 16:00, 20:00 Uhr Europe/Berlin, Telegram und E-Mail.
  Komplette deutsche Tesla-Kategorie „Neu“, keine Suchprofile oder Zusatzfilter.
- Bestehende Zugangsdaten unverändert. `.env`, Profile und Berichtskonfiguration
  auf dem NAS mit Modus 600; Statusverzeichnis mit Modus 700.
- Watcher vor der Datensicherung gestoppt. Konfigurations-/Datenbanksicherung:
  `/home/oemera/tesla-before-reports.mQPXy5`; zusätzlich automatische SQLite-
  Sicherung `state/watcher.sqlite.pre-v3-1791405761121.sqlite`.
- Version 0.4.0 auf dem NAS aktiviert; beide Dienste `healthy`,
  `restart: unless-stopped`. Erster regulärer Poll erfolgreich um 22:43 Uhr.
- Zusätzliche echte Neuwagen-Livechecks erfolgreich: Model 3 = 0, Model Y = 0;
  gültige vollständige Leerantworten, keine aus Fehlern abgeleiteten Nullwerte.
- Aktivierung nach dem letzten Tageszeitfenster: erster regulärer Bericht am
  8. Oktober 2026 um 08:00 Uhr vorgesehen. Noch kein planmäßiger Berichtsversand
  zum Zeitpunkt dieser Validierung; keine künstliche Produktionsuhr/-termine.
- Watcher-Image: `sha256:ef9fb9557c39abe222f5453f80c052184581734894b19c761f4c8bdadf3f9fee`.
- Scraper-Image: `sha256:085d79f523edabc21f754e15fe97b528be627bdfd8f4edb7dc2fa3fd994d1166`.
- Kein 24-Stunden-Test, NAS-Neustart, Commit, Push oder GitHub-Release für diese
  Erweiterung durchgeführt. Externer Ausfallwächter weiterhin nicht integriert.

## Aktualisierung v0.3.0: verpflichtende Sandbox

Die unten dokumentierten frühen Versuche ohne Sandbox sind historisch. Die
aktuelle Implementierung lehnt diesen Betrieb ab und prüft vor jedem Tesla-
Aufruf einer neuen Sitzung die aktive Namespace-/PID-/Netzwerk-/Seccomp-Sandbox.
Das neue Seccomp-Profil wurde auf dem NAS mit Chrome 155.0.8059.39 verifiziert:
51 gebrauchte Model 3 über drei vollständige Seiten, beide Neuwagenabfragen
gültig leer. Details und Profilherkunft stehen in `security/README.md`.

Die Regressionstests umfassen jetzt 30 Node- und 36 Python-Tests; alle bestanden.
TypeScript-Typprüfung, Build und Docker-HTTP-/Outbox-Integration bestanden.
Ein echter Offline-Chrome-Test erbt die Produktionskonfiguration und ist ein
zusätzliches CI-/Release-Gate. Er prüft aktive Sandbox-Schichten und weiterhin
gesperrte Rechte; fehlender Schutz wird nicht als erfolgreicher Test behandelt.

Auf Docker Desktop 29.8.2 am Apple-Silicon-Mac schlägt dieser Browser-Test unter
AMD64-Emulation fehl: User-Namespaces werden verweigert, Chrome beendet sich beim
Start. Das ist kein erfolgreicher lokaler Browser-Test. Die Produktionsfreigabe
erfordert deshalb die Prüfung auf dem nativen AMD64-Zielhost.

Die integrierte Produktionsversion hat diese NAS-Prüfung anschließend bestanden:

- `sandbox_check.py` im neuen Produktionsimage erfolgreich; alle vier Sandbox-
  Statuswerte wahr, weiterhin gesperrte Rechte geprüft.
- Echter TypeScript-Client: 51 gebrauchte Model 3 vollständig normalisiert;
  beide Neuwagenmodelle mit vollständigen gültigen Leerantworten.
- Alle 36 Python-Tests zusätzlich im Produktionsimage unter Python 3.13 bestanden.
- Vier Benutzerprofile formal gültig; freigegebenen Code `PREMIUM_WHITE` ergänzt.
- Je eine ausdrücklich freigegebene Test-Störungsmeldung von Telegram und dem
  SMTP-Server angenommen. Dies beweist nicht die Anzeige im E-Mail-Posteingang.
- Zugangsdaten ausschließlich nach ausdrücklicher Freigabe per SSH übertragen;
  `.env` und Profile mit Modus 600, Statusverzeichnis mit Modus 700.
- Produktiver Watcher am 7. Oktober 2026 auf dem NAS gestartet, mehrere erfolgreiche
  Prüfzyklen ohne Abruffehler oder wartende Nachrichten. Beide Dienste `healthy`.
- Kontrollierter Watcher-Neustart erfolgreich; danach weiterer vollständiger Poll.
  Beide Dienste verwenden `unless-stopped`. UGOS-Dienst `docker_serv.service` ist
  aktiviert und zieht `docker.socket` nach; globale Dienstkonfiguration unverändert.
- Scraper-Image: `sha256:317896fa655bdfe9ba33c1ae0f2fd505244004b911df5cc769b445ce3cb56e9d`.
- Watcher-Image: `sha256:1337dc904340c7652172b1416454162aa23df0515eba729548206bcf88c238d8`.
- Kein 24-Stunden-Dauertest und kein tatsächlicher NAS-Neustart durchgeführt.
- Externe Überwachung eines vollständigen NAS-/Internetausfalls bleibt offen.

## Historischer Stand v0.2.0

### Automatisiert

- TypeScript-Typprüfung für Anwendung **und** Tests erfolgreich.
- 29 Node-Tests erfolgreich.
- 26 Python-Tests erfolgreich, einschließlich HTTP-Vertrag, Seitennavigation,
  Sitzungserneuerung, Sperren und Fehlerpausen.
- Docker-Integrationstest erfolgreich: Python-Fixture über HTTP → echter
  TypeScript-Client → Normalisierung/Matching → SQLite → beide simulierten
  Benachrichtigungskanäle → keine erneute Meldung beim Folgeabruf.
- Das Docker-Testnetz hatte keinen Internetzugang. Keine echte Nachricht wurde gesendet.
- Produktionsimages für Linux AMD64 gebaut; Compose-Konfiguration validiert.

### Live auf dem UGREEN-NAS

Testumgebung: Linux AMD64, Docker 29.6.2, Chrome 155.0.8059.39 auf Xvfb.
Nicht-root, read-only Dateisystem, keine Linux-Capabilities, no-new-privileges,
2 GiB Speicherlimit, 256 MiB Shared Memory, zwei CPUs. Keine veröffentlichten
Ports, Produktionsdatenbank, Host-Dateifreigaben oder Benachrichtigungszugänge.

| Prüfung | Ergebnis |
| --- | --- |
| Browser-Sandbox in der eingeschränkten Standardkonfiguration | Chrome startet nicht; `browser_start_failed` |
| Begrenzter Test mit `BROWSER_NO_SANDBOX=true` | Abruf erfolgreich |
| Model 3 gebraucht | 57 Fahrzeuge vollständig über 3 Seiten |
| Wiederholter Abruf | 57 Fahrzeuge; dieselbe Sitzung (Generation 1) |
| Model 3 neu | Vollständige gültige Antwort, 0 Fahrzeuge |
| Model Y neu | Vollständige gültige Antwort, 0 Fahrzeuge |
| Sitzungserneuerung nach 120 Sekunden Testgrenze | Generation 2; erneut 57 Fahrzeuge / 3 Seiten |
| Echter TypeScript-Client im zweiten NAS-Container | 57 normalisierte Fahrzeuge |
| Auflösung von OptionCodeData mit OptionCodeList | 57/57 Lack- und 57/57 Innenraumbeschreibungen aufgelöst |
| Beide Neuwagenmodelle über TypeScript-Client | Erfolgreich, jeweils 0 Fahrzeuge |

Ein einzelner Ressourcenmesspunkt nach einem Abruf lag bei rund 705 MiB RAM;
das ist keine Aussage über Spitzenverbrauch oder Dauerbetrieb.

Die Tesla-Seite belegte beim Gebrauchtwagenaufruf Baujahre und eine Postleitzahl
vor. Der erste Dienstentwurf lehnte dies ab. Die korrigierte Implementierung
übernimmt Markt/Modell/Zustand, entfernt die impliziten Filter und lädt alle
exakten Seiten der Deutschland-Abfrage. Das Verhalten ist durch Tests abgesichert.

### Damals noch nicht freigegeben / nicht nachgewiesen

- Kein 24-Stunden-Dauertest. `soak.py` ist dafür vorbereitet, aber nicht automatisch gestartet.
- Kein dauerhafter Produktionsdienst aktiviert.
- Kein automatischer Nachrichtentest an echte Telegram-/SMTP-Empfänger.
- Keine Gewähr für zukünftige Erreichbarkeit oder für Lieferung noch 2026.
- Die gewünschten neuen Premium-AWD-Varianten waren nicht verfügbar; deren
  konkrete Bezeichnungen/Codes müssen bei Verfügbarkeit mit einem repräsentativen
  Datensatz bestätigt werden. Keine geratenen Ausstattungszuordnungen.
- Aktivierung ohne Chrome-Sandbox erfordert eine bewusste Sicherheitsentscheidung.
  Die Standardkonfiguration bleibt `BROWSER_NO_SANDBOX=false`.
- Keine GitHub-Veröffentlichung ausgeführt. Der Release-Workflow wurde lokal
  vorbereitet; ein tatsächlicher Actions-/GHCR-Lauf steht nach Push/Tag aus.

Die temporären Testcontainer und das eigene Testnetz werden nach der Prüfung
entfernt. Testimages bleiben zur Reproduktion auf dem NAS. Bestehende NAS-Dienste,
reale Profile, `.env` und produktive SQLite-Dateien wurden nicht verändert.
