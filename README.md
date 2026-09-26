# 💘 Giochi di coppia

Webapp privata (niente account, niente server con le vostre foto) per giocare in due dal telefono:

| Gioco | Come si gioca |
|---|---|
| 🕵️ **Indovina Chi** | Crei le tue tabelle con foto e nomi, le riusi quando vuoi. Crei la partita → link da mandare al partner → ognuno sceglie il personaggio segreto → domande sì/no a turno, carte da abbassare, rivincita con punteggio. |
| 🌍 **GeoGuesser** | Crei pacchetti di foto con la loro posizione (letta dal GPS della foto, oppure cercata/toccata sulla mappa). Il partner indovina dove sono state scattate: online col link, oppure sullo stesso telefono. Punteggio stile GeoGuessr (max 5000 a foto) con severità regolabile (mondo / Europa / paese / città). |
| 💞 **Quanto mi conosci?** | Online: a turno uno risponde su di sé in segreto e l'altro prova a indovinare. 48 domande già pronte + le vostre. |
| 🃏 **Memory** | Con le foto delle tue tabelle, sullo stesso telefono, 1 o 2 giocatori. |

## Privacy
- Foto e tabelle sono salvate **solo nel browser** del telefono (IndexedDB). Da *Impostazioni* puoi esportare/importare un backup.
- Durante una partita online le foto passano **direttamente da telefono a telefono** (WebRTC, cifrato). Il server pubblico di PeerJS serve solo a far "trovare" i due telefoni; se la connessione diretta non riesce (alcune reti mobili) i dati cifrati passano da un relay TURN, che non può leggerli.
- Le mappe sono di OpenStreetMap / Esri: si scaricano solo i riquadri della mappa, mai le foto.

## Pubblicazione (una volta sola, anche da telefono)
Il workflow `.github/workflows/deploy.yml` compila e pubblica su GitHub Pages a ogni push.
1. GitHub Pages sui repository **privati** richiede un piano a pagamento: con account gratuito vai su *Settings → General → Change visibility → Public* (il codice non contiene foto né dati).
2. *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
3. *Actions → Pubblica su GitHub Pages → Run workflow* (o fai un push).
4. L'app sarà su `https://<utente>.github.io/games/`. Aprila dal telefono e usa *Condividi → Aggiungi a schermata Home*.

## Sviluppo
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # output in dist/
```
Per provare le partite online senza rete, apri due schede con `?local` (es. `http://localhost:5173/?local#/`): comunicano tramite BroadcastChannel.

Struttura: `src/lib` (UI, archivio locale, immagini, rete P2P, mappe), `src/views` (una vista per gioco). Ogni gioco online è un *reducer* che gira sul telefono di chi crea la partita; l'altro invia azioni e riceve lo stato.
