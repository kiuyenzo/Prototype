Sinnvolle Grafiken für deine Masterarbeit (ja!)
Für deine Evaluation sind diese Grafiken “akademisch sinnvoll” (und leicht zu begründen):
Performance (B vs V4a vs V1)
Bar Chart: Median Latenz (Handshake, E2E Request) pro Mode
Boxplot/Violin (wenn du magst): Verteilung (p50/p95) pro Mode
Bar Chart: Payload Size (Plain vs JWS vs JWE)
Line/Bar: CPU% pro Komponente (Ingressgateway, Sidecar, App)
Security/Visibility
Heatmap/Matrix: “Welche Daten sieht wer?”
Zeilen: {Ingress, Sidecar Proxy, App}
Spalten: {Host/Path, DID, VC-Type, VC-Claims, Payload}
Werte: Visible / Not visible / Config-dependent
Reproduzierbarkeit / Setup
Architekturdiagramm (sehr wertvoll): zwei Cluster, Ingressgateway, ServiceEntries, Proxies, DIDComm Layer (JWE/JWS) über mTLS.
Wenn du willst, kann ich dir als nächstes:
ein CSV/JSON Output-Format für alle Skripte definieren (damit Plotten trivial wird),
oder dir direkt ein kleines Python-Plot-Skript (matplotlib) geben, das aus deinen Rohdaten automatisch Abbildungen generiert.
Schick mir dafür kurz, welche Metriken du schon als Rohwerte hast (z. B. latency_ms, payload_bytes, cpu_percent) und in welchem Format (txt/json/csv).

