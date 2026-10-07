# Integrationsprüfung – 7. Oktober 2026 (Europe/Berlin)

## Automatisiert

- TypeScript-Typprüfung für Anwendung **und** Tests erfolgreich.
- 29 Node-Tests erfolgreich.
- 26 Python-Tests erfolgreich, einschließlich HTTP-Vertrag, Seitennavigation,
  Sitzungserneuerung, Sperren und Fehlerpausen.
- Docker-Integrationstest erfolgreich: Python-Fixture über HTTP → echter
  TypeScript-Client → Normalisierung/Matching → SQLite → beide simulierten
  Benachrichtigungskanäle → keine erneute Meldung beim Folgeabruf.
- Das Docker-Testnetz hatte keinen Internetzugang. Keine echte Nachricht wurde gesendet.
- Produktionsimages für Linux AMD64 gebaut; Compose-Konfiguration validiert.

## Live auf dem UGREEN-NAS

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

## Noch nicht freigegeben / nicht nachgewiesen

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
