# Betrieb auf dem UGREEN-NAS

## Installation

- SSH: `oemera@192.168.5.15`, über Heimnetz/VPN.
- Projekt: `/home/oemera/tesla-inventory-checker` auf dem persistenten NAS-Datenvolume.
- Images: `tesla-inventory-checker:0.4.0` und `tesla-inventory-checker-scraper:0.4.0`, Linux AMD64.
- Diese Installation verwendet lokal gebaute und per SSH übertragene Images.
  Es wurde kein GitHub-Release veröffentlicht und kein Commit/Push ausgeführt.
- `compose.override.yaml` enthält ausschließlich lokale Betriebseinstellungen.
  `.env`, `profiles.json` und `reports.json` bleiben außerhalb von Git, nur für UID 1000 lesbar.
- SQLite liegt dauerhaft in `state/watcher.sqlite`. Nicht während des Betriebs löschen.

Beide Dienste haben `restart: unless-stopped`. Auf diesem NAS ist der UGOS-Dienst
`docker_serv.service` aktiviert und zieht `docker.socket` nach. Docker wird von
UGOS verwaltet; `docker.service` nicht unabhängig davon umkonfigurieren. Ein
tatsächlicher NAS-Neustart wurde für dieses Deployment nicht durchgeführt.

## Aktive Einstellungen

- Zwei Premium-Neuwagenprofile, Deutschland; je Modell eine gemeinsame Abfrage.
- Model 3: Stealth Grey oder Marine Blue. Model Y: Quicksilver, Stealth Grey oder Marine Blue.
- Kein Preis-, Innenraum- oder Antriebsfilter in den Suchprofilen.
- Fahrzeugtreffer gehen laut den aktuellen lokalen Profilen an Telegram und E-Mail.
- Unabhängige Bestandsberichte um 08:00, 12:00, 16:00 und 20:00 Uhr, Europe/Berlin,
  über Telegram **und** E-Mail; konfigurierbar in `reports.json`.
- Die Berichte zählen den kompletten deutschen Tesla-Bestand der Kategorie „Neu“
  für Model 3 und Model Y inklusive dort gelisteter Vorführwagen, ohne Suchfilter.
- 60 Sekunden Pause nach jedem Zyklus plus 0–10 Sekunden Zufallsaufschlag.
- Stille Erstaufnahme (`NOTIFY_ON_FIRST_SEEN=false`): Erst danach neu auftauchende
  passende Fahrzeuge werden gemeldet.
- Chrome-Sandbox verpflichtend; Prüfung vor jedem neuen Browser-/Sitzungsstart.
- Störungsalarme über Telegram **und** E-Mail (`TECHNICAL_ALERTS=true`).

Die Profile sind formal gültig. Da die Neuwagenabfragen leer waren, sind die
konkreten Premium-/Farbbezeichnungen noch nicht vollständig gegen reale
Neuwagentreffer bestätigt. Filter vergleichen vollständige Namen oder Codes,
keine Teilstrings. Keine unbekannten Varianten automatisch als passend werten.

## Zustand prüfen

Nach SSH-Anmeldung:

```sh
cd /home/oemera/tesla-inventory-checker
docker compose ps
docker compose exec watcher node dist/status.js
docker compose logs --tail=50 watcher
```

Erwartet: Beide Dienste laufen, `lastSuccessfulPoll` ist aktuell, wiederkehrende
`poll_complete`-Meldungen und normalerweise keine wartenden Versandaufträge.
`healthy` allein bestätigt nur Prozess-Lebendigkeit, nicht aktuelle Tesla-Daten.
Zugangsdaten nicht mit ungekürzten `docker inspect`-/`docker compose config`-
Ausgaben veröffentlichen; diese können Umgebungsvariablen enthalten.

Nach bewusstem Stoppen wieder starten:

```sh
docker compose up -d
```

Profile oder Berichtszeiten/-kanäle bearbeiten und anschließend neu laden:

```sh
docker compose restart watcher
```

Geänderte Profile erhalten eine neue stille Erstaufnahme. Die lokale Datei
`profiles.json` und die NAS-Kopie sind getrennte Dateien; bewusst synchron halten.
Das gilt ebenso für `reports.json`. Details zu Fehlern, Zeitumstellung, Versand-
wiederholung und Nachholen innerhalb einer Stunde stehen im README.
`status.js` zeigt zusätzlich `reports` und `lastReport`.

## Was die Alarme erfassen — und was nicht

Nach drei aufeinanderfolgenden Abruffehlern versucht der Watcher eine Meldung an
die konfigurierten Telegram-/SMTP-Kanäle. Nach erfolgreich gesendetem Alarm gilt
eine Stunde Pause. Bei Tesla-Sperren können wegen der Fehlerpausen rund 30 Minuten
bis zur ersten Meldung vergehen. Versandfehler von Fahrzeugmeldungen verbleiben
in der Warteschlange und lösen derzeit keinen separaten Alarm aus.

Ein vollständig ausgefallenes NAS, ein hängender Watcher oder ein kompletter
Internet-/Stromausfall kann nicht zuverlässig vom betroffenen Dienst selbst
gemeldet werden. Docker sendet bei `unhealthy` auch keine E-Mail und startet
einen lediglich hängenden Container nicht automatisch neu.

Für diese Fälle fehlt noch ein unabhängiger externer Ausfallwächter, der nach
vollständig erfolgreichen Abrufzyklen ein Lebenszeichen erwartet und bei dessen
Ausbleiben selbst eine E-Mail sendet. Keine Router-Freigabe wäre dafür erforderlich.

## Updates

Vor Updates Tests ausführen, Images und eingechecktes Seccomp-Profil gemeinsam
versionieren. Auf dem NAS den geheimnisfreien Offline-Sandbox-Test und einen
Live-Check ausführen; fehlgeschlagene Tests nicht durch Lockerung der Sicherheit
umgehen. Die lokale `compose.override.yaml` pinnt die Images und muss bei einem
Versionswechsel ebenfalls angepasst werden. Vor Migrationen den Watcher stoppen
und die SQLite-Dateien konsistent sichern. Keine zweite Watcher-Instanz auf
derselben Datenbank starten.
