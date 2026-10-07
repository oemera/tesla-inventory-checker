# Chromium-Sandbox unter Docker (Linux AMD64)

`chrome-seccomp.json` ist Bestandteil des Deployments, nicht des Images. Compose
übergibt es nur an den Scraper. AppArmor bleibt beim Host-Standard, alle Container-
Capabilities bleiben entfernt, `no-new-privileges` und read-only bleiben aktiv.

## Herkunft und Änderungen

Die Ausgangsdatei `docker-default.json` stammt aus
[moby/profiles](https://github.com/moby/profiles/blob/main/seccomp/default.json),
abgerufen am 7. Oktober 2026, unter Apache-2.0 (siehe `LICENSE.moby`). Lediglich ein
abschließender Zeilenumbruch wurde ergänzt; alle Regeln sind unverändert.

- SHA-256 des Downloads: `6416b47770785a41ac59073cdc77d9fe98517df2799dc83ef207e622de3053f6`
- SHA-256 der eingecheckten Basisdatei: `514c38e72edc5363e87287ea87212211172c6c3251a974ca21ebfd05a56c7f5d`
- SHA-256 des getesteten Chrome-Profils: `47eff122c1330986a05534e50e97b6eb5d7eeffe5c1973516145558f45d5e479`

Diese Kopie wird nicht beim Start heruntergeladen. Sie wird nicht als byteidentisch
mit dem eingebauten Profil jeder Docker-Version ausgegeben. Auf Docker 29.6.2
reproduzierten beide Ausgangsprofile denselben Fehler.

Angehängt sind ausschließlich sieben AMD64-spezifische Freigaben:

- `clone` mit exakt `SIGCHLD` und den Namespace-Kombinationen USER, USER+PID,
  USER+NET, USER+PID+NET oder PID; keine pauschale Freigabe.
- `unshare` ausschließlich mit `CLONE_NEWUSER`.
- `chroot`: Chromium beschränkt damit sein Dateisystem innerhalb seines eigenen
  User-Namespace auf ein leeres Verzeichnis. Seccomp kann den Pfad-Zeiger nicht
  inhaltlich prüfen. Kernel- und AppArmor-Prüfungen bleiben deshalb wesentlich.
  Der Container erhält **kein** `CAP_SYS_CHROOT` und **kein** `CAP_SYS_ADMIN`.

`setns`, `clone3`, `mount` und andere Systemaufrufe werden nicht erweitert. Die
Unit-Tests vergleichen sämtliche unveränderten Basisregeln und jede Zusatzregel.
Die zusätzlichen Kernel-Schnittstellen sind trotzdem eine bewusste Abwägung:
Sie ermöglichen Chromes eigene, zusätzliche Sandbox innerhalb des Containers.

## Nachweis statt stiller Rückfall

Der Scraper prüft bei jedem Browserstart `chrome://sandbox`, **vor** dem ersten
Tesla-Aufruf. Namespace-, PID-, Netzwerk- und Seccomp-BPF-Schutz müssen bestätigt
werden. Unbekannte Statusformate, fehlender Schutz oder `BROWSER_NO_SANDBOX=true`
brechen den Abruf ab. Optionaler Yama-Schutz wird nicht vorausgesetzt.

`npm run test:sandbox` startet einen echten Browser ohne Netzwerk und übernimmt
die Produktionskonfiguration über Compose `extends`. Zusätzlich prüft der Test,
dass Mount-/UTS-/eigenständige Netzwerk-Namespaces und `chroot` aus dem äußeren
Containerkontext weiterhin gesperrt bleiben. Keine Geheimnisse, Host-Mounts oder
Produktionsdaten werden eingebunden. Dieser Test ist auch ein CI-/Release-Gate.

Bei Chrome-, Docker-, Kernel- oder Profil-Updates den Offline-Test und danach
einen begrenzten Live-Test auf dem tatsächlichen Zielhost wiederholen. Keinesfalls
mit `privileged`, `SYS_ADMIN`, `seccomp=unconfined`, `apparmor=unconfined` oder
`--no-sandbox` einen fehlgeschlagenen Test umgehen.
