# Deploy di PlantDaddy su Dokploy

Procedura per mettere PlantDaddy su un VPS con Dokploy, scritta per il caso in
cui **sulla stessa macchina girano già altri progetti**: progetto Dokploy
separato, database dedicato, nessuna porta pubblicata sull'host.

Sostituisci `<HOST>` con il tuo dominio. Se non vuoi configurare DNS va bene un
nome `sslip.io` tipo `plantdaddy.TUO-IP.sslip.io`, che risolve l'indirizzo
contenuto nel nome stesso. `<IP-DEL-VPS>` è l'indirizzo della macchina.

---

## 0. Regole di isolamento (da rispettare, non da interpretare)

| Regola                                                              | Perché                                                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Progetto Dokploy nuovo**, non servizi aggiunti a uno esistente    | i progetti condividono variabili e ciclo di vita: un redeploy sbagliato toccherebbe entrambi |
| Nomi con prefisso `plantdaddy-` (`plantdaddy-app`, `plantdaddy-db`) | i nomi dei container sono anche i nomi DNS interni: due `db` collidono                       |
| **PostgreSQL dedicato**, mai quello di un altro progetto            | un dump o un `DROP` accidentale su un DB condiviso è un incidente su due progetti            |
| **Nessuna porta pubblicata sull'host**, né app né database          | Traefik instrada per header `Host`: due app possono stare entrambe sulla 3000 interna        |
| Hostname distinto, certificato Let's Encrypt separato               | evita conflitti di routing e rinnovi incrociati                                              |
| Volume e backup del database separati                               | ripristinare PlantDaddy non deve poter sovrascrivere i dati di un altro progetto             |
| Lo Schedule del cron sta nel progetto PlantDaddy                    | il cron porta il `CRON_SECRET` di PlantDaddy: non ha senso altrove                           |

### Rete condivisa: il motivo per cui l'allowlist delle push non è teoria

In Dokploy **tutti i container stanno sulla stessa rete Docker**
(`dokploy-network`) e si risolvono per nome. Quindi il container di PlantDaddy
**può raggiungere il database di qualunque altro progetto** sulla stessa
macchina, con un semplice `nc -z <nome-service> 5432`. Non è un difetto di
configurazione: è come funziona Dokploy.

È esattamente per questo che `POST /api/push/subscribe` valida l'endpoint contro
una allowlist rigida (`src/lib/server/push-endpoints.ts`). Quell'endpoint è una
URL scelta dal client, e il cron ci fa una POST **dall'interno della rete**:
senza allowlist, chi registra `https://un-altro-db:5432/` userebbe PlantDaddy
come trampolino per sondare i servizi interni degli altri progetti (SSRF).
Se un domani qualcuno "semplifica" quel file, riapre esattamente questa strada.

### Cosa deve restare vero sulla macchina

- Traefik pubblica **80** e **443**; nient'altro di PlantDaddy è pubblicato.
- Il database di PlantDaddy non è raggiungibile dall'host né da internet: solo
  dalla rete interna di Docker.
- L'app ascolta sulla 3000 **dentro** il container e riceve traffico solo da
  Traefik.

---

## 1. Creare il progetto

Dokploy → **Projects** → **Create Project**

- Name: `plantdaddy`
- Description: `Cura piante di casa — PWA + push`

---

## 2. Database PostgreSQL dedicato

Dentro il progetto `plantdaddy` → **Create Service** → **Database** → **PostgreSQL**

| Campo             | Valore                              |
| ----------------- | ----------------------------------- |
| Name              | `plantdaddy-db`                     |
| Docker image      | `postgres:16-alpine`                |
| Database name     | `plantdaddy`                        |
| Database user     | `plantdaddy`                        |
| Database password | genera una password lunga e casuale |
| External port     | **VUOTO / DISATTIVATO**             |

> **Controlla due volte l'External Port.** Se Dokploy pubblica la 5432
> sull'host, il database finisce su internet: vedi la sezione 9, dove si spiega
> perché `ufw status` non è una prova.

Dopo il **Deploy** del database, verifica dalla shell del VPS che non risultino
porte pubblicate:

```bash
docker ps --filter "name=plantdaddy-db" --format '{{.Names}}\t[{{.Ports}}]'
```

La parentesi quadra deve essere **vuota** o contenere solo `5432/tcp` senza
`0.0.0.0:` davanti.

---

## 3. Connection string interna

Il container dell'app raggiunge il database **per nome del container**, non su
`localhost`: dentro un container `localhost` è il container stesso.

Il nome da usare **non è** il campo Name, e non è nemmeno esattamente l'App Name
mostrato nel pannello: Dokploy gira in **Swarm mode** e aggiunge all'App Name un
suffisso casuale generato alla creazione del service. Con Name `plantdaddy-db` e
App Name `plantdaddy-plantdaddydb`, il service reale può chiamarsi
`plantdaddy-plantdaddydb-ib0ewe` — e quello è l'alias DNS nella rete:

```
DATABASE_URL=postgres://plantdaddy:LA_PASSWORD@plantdaddy-plantdaddydb-ib0ewe:5432/plantdaddy
```

Non inventarlo: leggilo. Il nome del service è quello che precede `.1.` nel nome
del container.

```bash
docker service ls | grep -i plant
```

```bash
docker ps --format '{{.Names}}' | grep -i plant
```

Il suffisso resta stabile ai redeploy, ma cambia se cancelli e ricrei il service:
dopo un'operazione del genere, ricontrolla il `DATABASE_URL`.

Attenzione anche a `docker inspect`: cercare il _service_ per nome dà
`No such object`, perché inspect vuole il container (`servizio.1.taskid`) mentre
il DNS interno risolve il service. Sono due spazi di nomi diversi, e non è un
segno che il database non esista.

Con l'hostname sbagliato l'app parte e muore con `ENOTFOUND`, che sembra un
problema di credenziali e non lo è. Verifica la risoluzione dall'app, dopo il
deploy:

```bash
docker exec -it $(docker ps --format '{{.Names}}' | grep plantdaddy-app | head -1) node -e "require('dns').promises.lookup(process.argv[1]).then(r=>console.log('risolve:',r)).catch(e=>console.log('NON risolve:',e.code))" plantdaddy-plantdaddydb-ib0ewe
```

---

## 4. Application collegata al repo

Progetto `plantdaddy` → **Create Service** → **Application**

| Campo      | Valore                                     |
| ---------- | ------------------------------------------ |
| Name       | `plantdaddy-app`                           |
| Source     | GitHub / Git provider → repo di PlantDaddy |
| Branch     | `main`                                     |
| Build Type | **Dockerfile**                             |
| Dockerfile | `./Dockerfile`                             |
| Port       | `3000` (porta **interna**, non pubblicata) |

Il Dockerfile è multi-stage: compila con le dipendenze complete e nell'immagine
finale copia solo `build/`, `package.json`, le dipendenze di produzione e le
migrazioni. Gira come utente `node`, non root, e include un `HEALTHCHECK` che
interroga `/api/health`.

> Nota sul `.npmrc` del progetto: contiene `engine-strict=true`. Se un giorno il
> tag `node:22-alpine` risolvesse a una 22.x più vecchia di 22.13, `npm ci`
> fallirebbe **durante la build** invece di produrre un'immagine rotta. È
> voluto. In quel caso passa a `node:24-alpine`, che combacia con `.nvmrc`.

---

## 4b. Auto deploy a ogni push

Se il repo è collegato con la **GitHub App** di Dokploy (Settings → Git
Providers → GitHub), basta attivare **Auto Deploy** nell'Application e
controllare che Branch sia `main`: il webhook lo gestisce Dokploy.

Se invece il Source è **Git** con URL e deploy key, il webhook va aggiunto a
mano: `plantdaddy-app` → tab **Deployments** → copia la **Webhook URL**, poi su
GitHub → Settings → Webhooks → Add webhook, content type
`application/json`, evento **Just the push event**. Quella URL contiene un token:
va trattata come una credenziale.

Verifica con un commit vuoto:

```bash
git commit --allow-empty -m "prova autodeploy" && git push
```

Se non parte niente, GitHub → Settings → Webhooks → **Recent Deliveries** dice se
la richiesta è arrivata (`200` = webhook ok, quindi manca il toggle Auto Deploy)
o se l'URL è sbagliata.

**Conseguenza da tenere presente**: con l'auto deploy attivo, ogni push su `main`
va in produzione **migrazioni incluse**, perché le applica l'entrypoint
all'avvio. È il comportamento voluto, ma significa che `main` non è più un posto
dove sperimentare: per provare qualcosa usa un branch e sposta il campo Branch
solo quando vuoi promuovere.

## 5. Variabili d'ambiente

`plantdaddy-app` → **Environment**:

| Variabile                 | Valore                                                        | Note                                                       |
| ------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`            | `postgres://plantdaddy:...@<NOME-SERVICE-DB>:5432/plantdaddy` | nome del service Swarm (con suffisso), non localhost       |
| `ORIGIN`                  | `https://<HOST>`                                              | serve ad adapter-node per costruire le URL dietro il proxy |
| `APP_TIMEZONE`            | `Europe/Rome`                                                 | decide qual è "oggi": il container gira in UTC             |
| `PUBLIC_VAPID_PUBLIC_KEY` | chiave pubblica VAPID                                         | l'unica esposta al client (prefisso `PUBLIC_`)             |
| `VAPID_PRIVATE_KEY`       | chiave privata VAPID                                          | resta sul server                                           |
| `VAPID_SUBJECT`           | `mailto:tuo@indirizzo`                                        | contatto richiesto dai push service                        |
| `CRON_SECRET`             | `openssl rand -hex 32`                                        | protegge `/api/cron/notify`                                |
| `BODY_SIZE_LIMIT`         | `8M` (già nel Dockerfile)                                     | l'import di un backup pieno supera il default di 512K      |

Facoltative, solo se vuoi il pannello di controllo (vedi § 10):

| Variabile              | Valore        | Note                                                 |
| ---------------------- | ------------- | ---------------------------------------------------- |
| `ADMIN_ENABLED`        | `true`        | senza questa ogni rotta del pannello risponde 404    |
| `PUBLIC_ADMIN_PATH`    | `/superman`   | percorso pubblico; **non** è una misura di sicurezza |
| `ADMIN_IP_ALLOWLIST`   | `1.2.3.4`     | IP esatti separati da virgola; fuori elenco è 404    |
| `ADMIN_SHOW_USER_TEXT` | non impostata | a `true` mostra le note scritte dagli utenti         |
| `ADMIN_SESSION_HOURS`  | `8`           | durata massima della sessione admin                  |

> **`Cross-site POST form submissions are forbidden` al login del pannello.**
> SvelteKit confronta l'header `Origin` del browser con l'origine calcolata da
> adapter-node e rifiuta la POST con 403 prima ancora di entrare negli hook. Le
> API utente non se ne sono mai accorte perché mandano JSON: il controllo vale
> solo per i content-type delle form, e quelle del pannello sono le prime del
> progetto.
>
> **Prima di toccare `ORIGIN`, guarda quale `Origin` ha mandato il browser**
> (DevTools → Network → la POST → Request Headers, oppure "Copy as cURL"). Le due
> cause danno lo stesso messaggio ma si distinguono subito:
>
> **`origin: null`** — non è la configurazione, è la referrer policy della
> pagina. La regola di Fetch che compone l'header dice che per una richiesta di
> navigazione con metodo diverso da GET/HEAD, cioè l'invio di una form, con
> referrer policy `no-referrer` l'`Origin` viene serializzato come `null`, anche
> verso la stessa origine. È successo davvero: `adminHeaders()` in
> `src/lib/server/admin/guard.ts` mandava `Referrer-Policy: no-referrer`. Ora
> manda `same-origin`, che protegge lo stesso — verso l'esterno il Referer non
> parte affatto — senza azzerare `Origin`. Se qualcuno rimette `no-referrer`, il
> login smette di funzionare.
>
> **`origin: https://qualcos-altro`** — allora sì, è `ORIGIN`. Verificato in
> locale su una build di produzione, con `Host` e `X-Forwarded-Proto` di Traefik
> simulati:
>
> | `ORIGIN`                         | Esito                                         |
> | -------------------------------- | --------------------------------------------- |
> | assente                          | passa (ripiego su `X-Forwarded-Proto`/`Host`) |
> | `https://<HOST>`                 | passa                                         |
> | `https://<HOST>/` (slash finale) | passa, lo slash viene normalizzato            |
> | `http://<HOST>`                  | **403**                                       |
> | `https://<ALTRO-HOST>`           | **403**                                       |
> | `http://127.0.0.1:3000`          | **403**                                       |
>
> `ORIGIN` deve essere identica a quello che si legge nella barra degli
> indirizzi: stesso schema, stesso host, niente percorso. Attenzione se raggiungi
> l'app sia con un nome `sslip.io` sia col dominio vero — solo uno dei due
> combacia.
>
> **Nota di metodo: con curl questo bug è invisibile.** L'header `Origin` lo si
> scrive a mano e nessuna referrer policy lo tocca, quindi una prova a riga di
> comando passa mentre il browser fallisce. Le form vanno provate con un browser
> vero.

> **Se un import fallisce con `{"message":"Body JSON non valido"}`, guarda qui
> prima di cercare bug nel JSON.** Quando il corpo supera `BODY_SIZE_LIMIT`
> adapter-node interrompe lo stream, e quello che l'app vede è un JSON troncato:
> l'errore che arriva all'utente parla di JSON, non di dimensione. Verificato in
> locale: un backup da 672 KB viene rifiutato col limite di default e passa con
> `8M` (60 piante e 7.200 eventi importati).

Le chiavi VAPID si generano una volta sola:

```bash
npx web-push generate-vapid-keys
```

> Se cambi le chiavi VAPID **tutte le subscription esistenti diventano
> invalide**: i browser hanno cifrato con la vecchia chiave pubblica. Gli utenti
> devono riattivare le notifiche. Generale una volta e conservale nel gestore
> di password.

---

## 6. Migrazioni

Le migrazioni sono versionate in `db/migrations/`, tracciate in
`schema_migrations`, e ogni file gira in una transazione. Lo script è
idempotente: rilanciarlo non riapplica nulla.

```bash
npm run migrate
```

Due modi per lanciarle, con rischi diversi.

### Opzione A — All'avvio del container (quella in uso)

`docker-entrypoint.sh` applica le migrazioni e poi lancia il server. Non serve
configurare niente in Dokploy: è dentro l'immagine.

- **Pro**: nessun passaggio manuale da ricordare, lo schema è sempre allineato al
  codice che sta partendo (sono la stessa immagine e lo stesso commit), e se una
  migrazione fallisce il container **esce con errore** invece di servire un'app
  che si aspetta colonne inesistenti. Traefik continua a instradare sulla task
  vecchia finché la nuova non diventa sana.
- **Contro**: se la migrazione è lenta o distruttiva parte comunque, senza che
  nessuno la guardi. Con `ALTER TABLE` su tabelle grandi Postgres prende un lock
  e l'avvio resta bloccato finché non finisce. Su questo progetto le tabelle sono
  piccole, quindi il rischio è teorico.
- **Attenzione alle repliche**: con più di una replica gli avvii sono in
  parallelo e le migrazioni non hanno un lock distribuito, quindi due esecuzioni
  simultanee della stessa migrazione possono farne fallire una. Con `Replicas: 1`
  non è un problema; se un giorno sali di numero, passa all'opzione B.
- Per saltarle durante un debug: variabile `RUN_MIGRATIONS=0`.

> **Non usare la voce "Run Command" di Dokploy** (Advanced → Run Command, con
> Command `/bin/sh` e Args) per le migrazioni: quel campo **sostituisce** il
> comando di avvio del container, quindi il container eseguirebbe le migrazioni
> _invece_ dell'app e poi terminerebbe. Questa versione di Dokploy non ha un
> pre-deploy command, ed è la ragione per cui le migrazioni stanno
> nell'entrypoint.

### Opzione B — A mano dalla shell del container

Dopo il primo deploy:

```bash
docker exec -it $(docker ps --format '{{.Names}}' | grep plantdaddy-app | head -1) sh
npm run migrate
```

- **Pro**: la lanci quando decidi tu, guardando l'output; è la strada giusta per
  una migrazione pesante o rischiosa, magari con l'app in manutenzione.
- **Contro**: è un passaggio che si dimentica. Se il deploy va in produzione e
  la migrazione no, l'app parte contro uno schema vecchio e gli errori arrivano
  agli utenti, non a te.

**Consiglio**: l'opzione A è già attiva e va bene per il funzionamento normale.
Quando una migrazione è grossa o irreversibile, imposta `RUN_MIGRATIONS=0`,
distribuisci, lancia la migrazione a mano guardando l'output, poi rimetti la
variabile a 1.

Verifica dello schema dopo il deploy (gira in una transazione con `ROLLBACK`,
non lascia dati). Il file `db/verify.sql` non è dentro l'immagine — è escluso dal
`.dockerignore` perché è uno strumento di sviluppo — quindi il comando va
lanciato da una macchina che ha il repo, con il file letto dalla shell locale:

```bash
cd /percorso/del/repo/PlantDaddy
docker exec -i $(docker ps --format '{{.Names}}' | grep plantdaddy-db | head -1) \
  psql -U plantdaddy -d plantdaddy < db/verify.sql
# atteso: NOTICE: verify: tutti i controlli passati
```

---

## 7. Dominio e certificato Let's Encrypt

`plantdaddy-app` → **Domains** → **Add Domain**

| Campo          | Valore            |
| -------------- | ----------------- |
| Host           | `<HOST>`          |
| Path           | `/`               |
| Container Port | `3000`            |
| HTTPS          | **on**            |
| Certificate    | **Let's Encrypt** |

Se usi un hostname `sslip.io` non serve configurare DNS: risolve l'IP contenuto
nel nome. L'hostname deve essere **diverso** da quello degli altri progetti sulla
macchina: Traefik instrada per header `Host`, quindi i certificati restano
indipendenti e due app possono convivere entrambe sulla 3000 interna.

Verifica:

```bash
curl -sI https://<HOST>/api/health | head -3
curl -s https://<HOST>/api/health
# atteso: {"ok":true}
```

> **HTTPS non è opzionale**: senza, il service worker non si registra, la PWA
> non è installabile e le push non esistono. `localhost` è l'unica eccezione, e
> vale solo in sviluppo.

---

## 8. Schedule del cron per le notifiche

Progetto `plantdaddy` → **Schedules** → **Create Schedule**

| Campo      | Valore                              |
| ---------- | ----------------------------------- |
| Task Name  | `plantdaddy-notify`                 |
| Schedule   | `0 * * * *` (ogni ora, al minuto 0) |
| Timezone   | indifferente: vedi sotto            |
| Shell Type | **Sh**, non Bash                    |
| Service    | `plantdaddy-app`                    |
| Command    | vedi sotto                          |

**Shell Type: Sh.** L'immagine è `node:22-alpine` e **non contiene bash**: con
Bash selezionato il task muore con `bash: not found`. Se il menu offre solo Bash,
l'alternativa è installare bash nell'immagine, che per un `fetch` non ha senso.

**Timezone: qualunque.** Il task gira ogni ora al minuto 0, e l'ora di
riferimento la calcola l'endpoint con `APP_TIMEZONE`, non lo scheduler. Metterlo
su `Europe/Rome` non fa danno ma non cambia niente.

**Command:**

```sh
node -e "fetch('http://127.0.0.1:3000/api/cron/notify',{headers:{Authorization:'Bearer '+process.env.CRON_SECRET}}).then(async r=>{const t=await r.text();console.log(r.status,t);if(!r.ok)process.exit(1)}).catch(e=>{console.error(e.message);process.exit(1)})"
```

Gira **dentro** il container, quindi passa da `127.0.0.1` senza toccare la rete
pubblica, e il segreto viene letto dall'ambiente invece di comparire nella riga
di comando (dove sarebbe visibile in `ps` e nei log dello scheduler). L'`exit 1`
sui codici non-2xx fa sì che Dokploy segni l'esecuzione come fallita invece di
dire "ok" su una notifica mai partita.

Se nei log leggi `ECONNREFUSED 127.0.0.1:3000`, significa che lo scheduler non
esegue dentro il container dell'app ma in una task separata: in quel caso
sostituisci `127.0.0.1` col nome del service dell'app, quello che leggi da
`docker service ls | grep plant`.

**Ogni ora e non una volta al giorno**: l'endpoint filtra internamente per
`notify_hour` di ciascun utente, quindi ognuno riceve la sua unica notifica
quotidiana all'ora che ha scelto. Lo stesso giro cancella gli action token
scaduti e le subscription che rispondono 404/410.

Prova manuale, forzando l'ora:

```bash
docker exec -it $(docker ps --format '{{.Names}}' | grep plantdaddy-app | head -1) node -e "fetch('http://127.0.0.1:3000/api/cron/notify?hour=9',{headers:{Authorization:'Bearer '+process.env.CRON_SECRET}}).then(async r=>console.log(r.status, await r.text()))"
```

---

## 9. VERIFICA DELL'ESPOSIZIONE (da fare dopo il primo deploy)

### Perché non basta guardare la configurazione

Docker non chiede il permesso a UFW: scrive regole proprie nella catena
`DOCKER` di iptables e un DNAT in `PREROUTING`. Quel traffico viene valutato
**prima** delle regole di UFW, che agiscono su `INPUT`. Conseguenza pratica:

> una porta pubblicata con `-p 5432:5432` è raggiungibile da internet **anche
> se `ufw status` dice che la 5432 è chiusa**.

È un errore silenzioso e frequente: si legge "Status: active, 5432 DENY", si
tira un sospiro di sollievo, e il database è su internet da settimane. Per
questo la verifica va fatta **dall'esterno**, e le due prove non sono
interscambiabili: quella interna dice cosa hai configurato, quella esterna dice
cosa è davvero raggiungibile.

### 9a. Dall'esterno del VPS (la prova che conta)

Esegui da **un'altra macchina**: il tuo portatile su rete diversa dal VPS, un
telefono in hotspot, o un altro VPS. Non dalla shell del server.

```bash
# Scansione delle porte che contano
nmap -Pn -p 22,80,443,3000,5432 <IP-DEL-VPS>

# Atteso:
#   22/tcp    open       (ssh)
#   80/tcp    open       (Traefik, redirect a 443)
#   443/tcp   open       (Traefik)
#   3000/tcp  filtered|closed   (il pannello Dokploy non deve essere aperto a internet)
#   5432/tcp  filtered|closed   <-- DEVE essere così
```

Senza `nmap` installato:

```bash
# Se il database fosse esposto, questa stamperebbe "succeeded"
nc -zv -w 5 <IP-DEL-VPS> 5432 || echo "5432 non raggiungibile: corretto"

# Prova diretta con un client Postgres: deve fallire in timeout o connection refused
psql "postgres://plantdaddy:qualsiasi@<IP-DEL-VPS>:5432/plantdaddy" -c 'select 1'
```

L'app deve invece rispondere **solo** via Traefik:

```bash
curl -s -o /dev/null -w 'https  %{http_code}\n' https://<HOST>/api/health
curl -s -o /dev/null -w 'http   %{http_code}\n' http://<HOST>/api/health   # atteso 301/308
curl -s -o /dev/null -w 'porta 3000 diretta  %{http_code}\n' --max-time 5 http://<IP-DEL-VPS>:3000/api/health || echo "3000 non raggiungibile: corretto"
```

### 9b. Sull'host, per capire il perché

```bash
# Nessuna riga deve mostrare 0.0.0.0: o ::: davanti a una porta di plantdaddy
docker ps --format '{{.Names}}\t[{{.Ports}}]' | grep plantdaddy

# Chi è in ascolto e su quale interfaccia
sudo ss -tlnp | grep -E ':(3000|5432|5433)\b'
# 127.0.0.1:5432 va bene: è solo loopback (es. un tunnel locale)
# 0.0.0.0:5432 NON va bene

# Le regole che Docker ha scritto: se qui compare una DNAT verso 5432,
# la porta è pubblicata qualunque cosa dica ufw
sudo iptables -t nat -S DOCKER | grep -E '5432|3000' || echo "nessuna DNAT verso database o app"
sudo iptables -S DOCKER | grep -E '5432|3000' || echo "nessuna regola di forward dedicata"

# Cosa dice UFW (informativo, NON è una prova)
sudo ufw status verbose
```

### 9c. Isolamento e raggiungibilità interna

Il database **deve** essere raggiungibile dall'app e da nessun altro:

```bash
APP=$(docker ps --format '{{.Names}}' | grep plantdaddy-app | head -1)

# Deve funzionare
docker exec -it $APP node -e "require('net').connect(5432,'plantdaddy-db').on('connect',()=>{console.log('plantdaddy-db raggiungibile: ok');process.exit(0)}).on('error',e=>{console.log('errore:',e.code);process.exit(1)})"

# Questa RIUSCIRÀ anche lei: la rete è condivisa. Non è un bug da correggere
# qui, è il motivo per cui esiste l'allowlist delle push.
docker exec -it $APP node -e "require('net').connect(5432,'ALTRO-DB').on('connect',()=>{console.log('ATTENZIONE: raggiungo anche il DB di un altro progetto — la rete e condivisa');process.exit(0)}).on('error',e=>{console.log('non raggiungibile:',e.code);process.exit(0)})"
```

Verifica che l'allowlist regga davvero, in produzione:

```bash
TOKEN=$(curl -s -X POST https://<HOST>/api/session | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

# Endpoint verso un servizio interno: atteso 400
curl -s -X POST https://<HOST>/api/push/subscribe \
  -H "X-Session-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"endpoint":"https://un-altro-db:5432/","keys":{"p256dh":"x","auth":"y"}}'

# Host che finge di essere Google: atteso 400
curl -s -X POST https://<HOST>/api/push/subscribe \
  -H "X-Session-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"endpoint":"https://fcm.googleapis.com.evil.tld/send","keys":{"p256dh":"x","auth":"y"}}'
```

E che il cron non sia apribile senza segreto:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<HOST>/api/cron/notify
# atteso 401
```

### 9d. Se una porta risulta esposta

1. In Dokploy, svuota il campo **External Port** del service e ridistribuisci.
2. Controlla di non avere `ports:` in un docker-compose personalizzato: usa
   `expose:` (visibile solo nella rete Docker) al posto di `ports:`.
3. Se ti serve accedere al database dal portatile, **non pubblicare la porta**:
   usa un tunnel SSH, che passa dall'autenticazione di SSH e non apre niente.

**Attenzione al bersaglio del forward**: l'host lo risolve `sshd` sulla macchina,
che non sta nella rete Docker e **non conosce i nomi dei container**. Quindi
`-L 15432:plantdaddy-db:5432` non funziona, e `-L 15432:localhost:5432` finisce
su qualunque cosa ascolti sul loopback dell'host — spesso il Postgres di un
altro progetto, con un `password authentication failed` che sembra un problema di
credenziali e invece è un problema di indirizzo. Serve l'IP del container:

In Swarm gli IP della rete overlay non sono instradabili dall'host, quindi non
basta puntare il forward all'IP del container. La strada che funziona è un
`socat` che pubblica **solo sulla loopback dell'host**, sul VPS:

```bash
docker run -d --restart unless-stopped --name plantdaddy-pgtunnel --network dokploy-network -p 127.0.0.1:15432:5432 alpine/socat tcp-listen:5432,fork,reuseaddr tcp-connect:NOME-SERVICE-DB:5432
```

Il `127.0.0.1:` davanti è la parte che conta: senza quello la porta finisce su
tutte le interfacce e il database è su internet. Poi dal portatile:

```bash
ssh -N -L 15432:127.0.0.1:15432 utente@<IP-DEL-VPS>
```

Poi in locale: `psql postgres://plantdaddy:...@127.0.0.1:15432/plantdaddy`, oppure
in un client grafico host `127.0.0.1` porta `15432`, senza la sua funzione "over
SSH" (altrimenti apre un secondo tunnel e ti ritrovi a interrogare il loopback
sbagliato).

Se devi solo dare un'occhiata ai dati è più rapido saltare tutto:

```bash
ssh utente@<IP-DEL-VPS> -t "docker exec -it \$(docker ps --format '{{.Names}}' | grep plantdaddy-plantdaddydb | head -1) psql -U plantdaddy -d plantdaddy"
```

---

### 9e. `password authentication failed` dopo aver cambiato la password

`POSTGRES_PASSWORD` viene applicata **solo alla prima inizializzazione del
volume**. Se cambi il campo Password in Dokploy e ridistribuisci, il ruolo nel
volume conserva quella vecchia e l'errore è indistinguibile da una credenziale
sbagliata. Verifica forzando TCP dentro il container (col socket locale
l'immagine ufficiale usa `trust` e passerebbe comunque):

```bash
docker exec -e PGPASSWORD='LA_PASSWORD_DI_DOKPLOY' $(docker ps --format '{{.Names}}' | grep plantdaddy-plantdaddydb | head -1) psql -h 127.0.0.1 -U plantdaddy -d plantdaddy -c 'select current_user'
```

Se fallisce, allinea il ruolo alla password del pannello:

```bash
docker exec -it $(docker ps --format '{{.Names}}' | grep plantdaddy-plantdaddydb | head -1) psql -U plantdaddy -d postgres -c "alter user plantdaddy with password 'LA_PASSWORD_DI_DOKPLOY';"
```

Cancellare il volume e ridistribuire è l'alternativa: accettabile solo a database
vuoto, perché dopo significa perdere i dati.

## 10. Pannello di controllo (facoltativo)

Un pannello di **sola lettura** per chi ospita l'istanza: quanti utenti, quante
piante, se le notifiche arrivano, quali migrazioni sono state applicate. Non può
scrivere, non può cancellare, non può impersonare nessuno — non esiste il codice
per farlo.

**Finché `ADMIN_ENABLED` non vale `true`, ogni indirizzo del pannello risponde 404.** Non 403: un 403 confermerebbe che il pannello c'è ed è solo chiuso.

### 10a. Creare il primo amministratore

Dalla shell del container (Dokploy → **Terminal**, oppure via SSH):

```bash
docker exec -it $(docker ps --format '{{.Names}}' | grep plantdaddy-app | head -1) npm run admin:hash -- --insert
```

Chiede email e password — la password non compare a schermo e non passa dagli
argomenti del comando, quindi non finisce in `ps` né nella cronologia della
shell. Minimo 12 caratteri. L'hash è scrypt con sale.

Senza `--insert` stampa soltanto l'hash e l'`INSERT` pronto, se preferisci
incollarlo in TablePlus. I comandi di manutenzione stanno in
`db/admin/insert-admin.sql`.

### 10b. Accendere il pannello

Aggiungi `ADMIN_ENABLED=true` alle variabili d'ambiente (§ 5) e riavvia
l'applicazione. Poi apri `https://<HOST>/superman`.

**Il secondo fattore è obbligatorio.** Al primo accesso compare un QR da
inquadrare con l'app di autenticazione (Google Authenticator, Aegis, 1Password…)
e il segreto anche in chiaro, per chi preferisce digitarlo. Finché non confermi
un codice non si raggiunge nessuna pagina con dati.

### 10c. Telefono perso

Non c'è nessuna scorciatoia dentro l'applicazione, ed è voluto: un "ho perso il
telefono" cliccabile dal browser sarebbe il modo più comodo per scavalcare la
2FA. Si azzera il segreto dal database, e al login successivo riparte
l'arruolamento con un QR nuovo:

```sql
update admins
set totp_secret = null, totp_confirmed_at = null, last_totp_step = null
where lower(email) = lower('tu@example.com');
```

Stesso posto per sbloccare un account dopo troppi tentativi falliti:

```sql
update admins set failed_attempts = 0, locked_until = null
where lower(email) = lower('tu@example.com');
```

### 10d. Cosa NON protegge il percorso

`PUBLIC_ADMIN_PATH` ha il prefisso `PUBLIC_` perché serve anche al browser
(l'hook `reroute` è universale), quindi **quella stringa è dentro il bundle
servito ai client**. Cambiarla toglie rumore dai log — i bot provano `/admin` e
`/wp-admin` — e nient'altro. Se vuoi una barriera vera davanti al pannello, usa
`ADMIN_IP_ALLOWLIST` con l'IP da cui ti colleghi, oppure mettilo dietro VPN.

La verifica che conta, dall'esterno:

```bash
# Senza ADMIN_ENABLED deve rispondere 404
curl -o /dev/null -w '%{http_code}\n' https://<HOST>/superman

# Il percorso interno /admin deve SEMPRE rispondere 404, anche a pannello acceso
curl -o /dev/null -w '%{http_code}\n' https://<HOST>/admin

# Il cookie del pannello deve avere Secure, HttpOnly, SameSite=Strict e Path
curl -sD- -o /dev/null -X POST https://<HOST>/superman \
  -H "Origin: https://<HOST>" --data-urlencode 'email=x@y.z' --data-urlencode 'password=zzz' \
  | grep -i set-cookie
```

## 10b. RustFS per le foto delle piante (facoltativo)

Senza questa sezione l'app funziona: le API delle foto rispondono **503** con
"Archivio foto non configurato" e tutto il resto — piante, cure, notifiche,
pannello — va normalmente. Verificato.

> **Da sapere prima di iniziare, senza addolcirlo.** RustFS è a **`1.0.0-rc.2`**,
> cioè release candidate, e il suo Docker Hub sconsiglia l'uso in produzione. Le
> foto degli utenti non si rigenerano: il backup verso un bucket esterno
> (§ 10b.7) qui non è un extra, è la sola rete fra un problema del motore di
> storage e una perdita definitiva.
>
> Inoltre RustFS **non ha CLI né API per creare chiavi con permessi limitati** —
> è una lacuna aperta a monte ([rustfs/rustfs#1571](https://github.com/rustfs/rustfs/issues/1571)).
> Con MinIO l'app usava una chiave che poteva solo leggere, scrivere e cancellare
> oggetti dentro il suo bucket. Qui usa le credenziali principali, che possono
> anche cancellare il bucket e creare altre chiavi. La probabilità di perderle è
> identica — stessa variabile d'ambiente — ma le conseguenze sono più ampie.
> Quando l'issue sarà chiusa si torna a una chiave limitata cambiando due env.

### 10b.1 Perché l'archivio non va pubblicato su internet

Le immagini passano dal **proxy dell'app** (`GET /api/photos/<id>`), non da URL
firmati. Due ragioni concrete:

1. La CSP dell'app è `img-src 'self' blob:` senza host esterni. Un URL verso
   l'archivio richiederebbe di allargarla.
2. Un URL firmato richiede l'archivio raggiungibile dal browser, quindi pubblicato
   attraverso Traefik: una superficie in più esposta per risparmiare banda su
   immagini da 38 KB.

Conseguenza: nel compose la **9000 non è pubblicata**. L'app raggiunge RustFS come
`http://plantdaddy-rustfs:9000` sulla rete interna di Docker.

### 10b.2 Credenziali

```bash
echo "S3_ACCESS_KEY=plantdaddy"; echo "S3_SECRET_KEY=$(openssl rand -base64 30 | tr -d '/+=' | head -c 32)"
```

Queste due sono **anche le credenziali principali di RustFS**: sono la coppia con
cui si entra nella console e quella che usa l'app. È la conseguenza della lacuna
sulle chiavi IAM descritta sopra.

> **I default di RustFS sono `rustfsadmin`/`rustfsadmin`.** Se le variabili non
> arrivassero — nome sbagliato, campo vuoto in Dokploy — il server partirebbe con
> le credenziali di fabbrica e l'archivio delle foto sarebbe aperto a chiunque
> conosca quel valore. Per questo l'init container **prova ad autenticarsi con i
> default e fa fallire il deploy se funzionano**: è una verifica automatica, non un
> passaggio da ricordare.

### 10b.3 Il servizio

Progetto `plantdaddy` → **Create Service** → **Compose**.

| Campo        | Valore                        |
| ------------ | ----------------------------- |
| Name         | `plantdaddy-rustfs`           |
| Source       | lo stesso repo dell'app       |
| Compose Path | `./deploy/rustfs-compose.yml` |

Nella scheda **Environment** del servizio Compose:

```
S3_ACCESS_KEY=plantdaddy
S3_SECRET_KEY=<quella generata sopra>
S3_BUCKET=plantdaddy
S3_REGION=us-east-1
```

Il file `deploy/rustfs-compose.yml` fa cinque cose che vanno capite prima di
premere Deploy:

- **volumi nominati** per dati e log, che sopravvivono ai redeploy;
- un container `rustfs-prepare` che **sistema i permessi** dei volumi prima
  dell'avvio. RustFS gira come UID 10001 e un volume nominato nasce di proprietà
  di root: senza questo passaggio il server parte e muore con `permission denied`
  su `/data`. Costa un secondo al primo deploy e trasforma un guasto probabile in
  un non-evento;
- **limiti espliciti** di 512 MB e 0,5 vCPU, in entrambe le forme (`mem_limit` per
  compose standalone, `deploy.resources` per Swarm) perché con una sola il limite
  sarebbe silenziosamente inefficace nella modalità sbagliata — ed è il campo che
  impedisce a RustFS di mangiarsi la RAM di Postgres;
- un init che **crea il bucket** e **verifica che le credenziali di fabbrica non
  funzionino più**;
- i **log in un volume** e non su stdout, perché il driver json-file di Docker non
  ruota i log per default e col tempo riempirebbe il disco.

L'init usa la **AWS CLI** e solo chiamate S3 pure. Non `mc`: RustFS espone
`/rustfs/admin/v3/` mentre `mc admin` parla a `/minio/admin/v3/`, quindi i comandi
amministrativi non funzionano. Le operazioni S3 sì, su entrambi — ed è anche il
motivo per cui questo init resta valido identico su R2.

Il tag dell'immagine è **fissato**, non `:latest`. Su un release candidate conta il
doppio: `latest` può cambiare comportamento fra due redeploy senza avvisare.

### 10b.4 La rete: è qui che si sbaglia

`docker compose up` crea una **rete propria del progetto** e ci mette dentro i suoi
container. L'app invece è un service Swarm su `dokploy-network`: due mondi che per
default **non si vedono**. Il deploy riesce, RustFS parte, e ogni upload risponde
503 "Archivio non raggiungibile" senza niente di evidente nei log.

Per questo il compose dichiara `dokploy-network` come `external` e attacca RustFS
con un **alias esplicito**, `plantdaddy-rustfs`. L'alias e non il nome di servizio
`rustfs` perché la rete è condivisa fra tutti i progetti della macchina.

Da verificare una volta sola, prima del primo deploy:

```bash
docker network ls | grep dokploy
```

Se il nome non è esattamente `dokploy-network`, va corretto nel compose. Con il
nome sbagliato il deploy **fallisce subito** con `network ... not found`, che è
molto meglio di un deploy riuscito e un'app che non trova l'archivio.

### 10b.5 Variabili nell'applicazione

In `plantdaddy-app` → **Environment**:

| Variabile               | Valore                          | Note                                         |
| ----------------------- | ------------------------------- | -------------------------------------------- |
| `S3_ENDPOINT`           | `http://plantdaddy-rustfs:9000` | l'**alias di rete** del compose              |
| `S3_BUCKET`             | `plantdaddy`                    |                                              |
| `S3_ACCESS_KEY`         | `plantdaddy`                    | le stesse del servizio Compose               |
| `S3_SECRET_KEY`         | `<segreto>`                     |                                              |
| `S3_REGION`             | `us-east-1`                     | il protocollo pretende un valore per firmare |
| `PHOTO_UPLOADS_PER_DAY` | `10`                            | limita il churn di chi cancella e ricarica   |

> **`S3_ENDPOINT` non segue la regola del § 3.** Il database è un service Swarm e
> ha il suffisso casuale (`plantdaddy-plantdaddydb-ib0ewe`); RustFS è un servizio
> Compose, quindi `docker service ls` **non lo elenca affatto** e il nome che
> Dokploy mostra è quello del progetto compose, non un nome DNS. L'indirizzo
> raggiungibile è l'alias dichiarato nel file: **`plantdaddy-rustfs`**, stabile per
> costruzione.
>
> Per convincersene dopo il deploy, dal container dell'app:
>
> ```bash
> docker exec -it $(docker ps --format '{{.Names}}' | grep plantdaddy-app | head -1) \
>   node -e "fetch('http://plantdaddy-rustfs:9000/health/ready').then(r=>console.log('RustFS risponde:',r.status)).catch(e=>console.log('NON raggiungibile:',e.message))"
> ```

`BODY_SIZE_LIMIT` è già a `20M` nel Dockerfile: serve ai 15 MB di una foto, ed è
**globale** per adapter-node, quindi alza anche il tetto di `/api/import`.

### 10b.6 I due Schedule

Progetto `plantdaddy` → **Schedules**, oltre a quello delle notifiche di § 8:

| Task            | Schedule     | Command                                                                                                 |
| --------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| Promemoria foto | `0 * * * *`  | `curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://plantdaddy-app:3000/api/cron/photo-reminders` |
| Pulizia orfani  | `30 4 * * *` | `curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://plantdaddy-app:3000/api/cron/photo-cleanup`   |

I promemoria girano **ogni ora** perché `notify_hour` è per utente: la query serve
solo chi ha scelto quell'ora, stretta alla fascia 10–20. Ogni utente riceve al
massimo **una** notifica foto al giorno, aggregata se più piante maturano insieme.

Con `?dry-run` la pulizia dice cosa cancellerebbe senza toccare niente:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" "http://plantdaddy-app:3000/api/cron/photo-cleanup?dry-run"
```

### 10b.7 La console di amministrazione

Il compose pubblica la console **solo su 127.0.0.1 del VPS**:

```yaml
ports:
  - '127.0.0.1:9001:9001'
```

Quel prefisso è tutta la differenza. `127.0.0.1:9001:9001` ascolta solo sul
loopback: da internet la porta risulta chiusa e nemmeno Traefik la vede.
`9001:9001` senza prefisso la esporrebbe al mondo.

Il tunnel giusto è verso **127.0.0.1**, non verso il nome del container:

```bash
ssh -L 9001:127.0.0.1:9001 root@<IP-DEL-VPS>
```

Poi `http://localhost:9001` nel browser, con `S3_ACCESS_KEY` e `S3_SECRET_KEY`.

> **`ssh -L 9001:plantdaddy-rustfs:9001` NON funziona.** In `-L porta:host:porta`
> quell'`host` viene risolto **dal VPS**, e `plantdaddy-rustfs` è un alias del DNS
> interno di Docker: esiste solo dentro la rete dei container. Il tunnel si apre e
> poi fallisce alla prima connessione. Per convincersene:
>
> ```bash
> ssh root@<IP-DEL-VPS> 'getent hosts plantdaddy-rustfs || echo "l'"'"'host non risolve questo nome"'
> ```

### 10b.8 Backup delle foto — questo sì che serve

Il database non è sotto backup per scelta (§ 11), e le foto sono un caso
**diverso**: uno storico di annaffiature si può ricostruire a memoria, una foto di
due anni fa no. Con un motore di storage a release candidate, ancora di più.

`deploy/backup-foto.sh` fa un `mc mirror` incrementale verso un bucket esterno.
Come destinazione conviene **Cloudflare R2**: l'egress è gratuito, quindi il giorno
del ripristino — l'unico in cui scarichi tutto — non arriva una bolletta.

`mc` va bene qui anche con RustFS: `mirror`, `ls` e `du` sono operazioni S3, non
comandi amministrativi.

Da mettere come Schedule giornaliero, con queste variabili:

```
SRC_KEY / SRC_SECRET      le credenziali di RustFS
DST_ENDPOINT              https://<account-id>.r2.cloudflarestorage.com
DST_BUCKET                plantdaddy-foto
DST_KEY / DST_SECRET      un token R2 con accesso a quel solo bucket
```

Lo script usa `--remove`, quindi propaga anche le cancellazioni e il backup non
cresce per sempre. E provalo davvero, ripristinando qualche file su un bucket
temporaneo: un backup non verificato non è un backup.

### 10b.9 Quanto spazio stanno occupando

Le dimensioni sono nel database, quindi si leggono senza interrogare l'archivio:

```sql
select
  count(*) as foto,
  pg_size_pretty(sum(bytes_stored + bytes_thumb)) as occupato,
  pg_size_pretty(sum(bytes_original)) as originali_prima_della_compressione
from plant_photos;
```

Il tetto è calcolabile: **100 piante per utente**, un avatar più `1 + trimestri`
slot ciascuna. Un utente con 100 piante da due anni sta sotto i 400 MB. Per il
disco della macchina:

```bash
docker system df -v | grep plantdaddy-rustfs
df -h /
```

Quando il disco si avvicina alla saturazione gli upload rispondono 503 con un
messaggio chiaro, mentre l'app continua a funzionare — le pagine si caricano e le
foto già presenti si vedono.

---

## 10c. Migrare da MinIO a RustFS, e togliere MinIO

> **L'ORDINE DI QUESTI PASSAGGI NON È NEGOZIABILE.** Il passo 6 cancella dati in
> modo irreversibile. Non anticiparlo: finché non hai verificato che le foto si
> vedono servite da RustFS, MinIO è l'unica copia che hai.

### 1. RustFS accanto a MinIO

Deploya il servizio Compose di § 10b.3 **senza toccare MinIO**. Per un momento
girano entrambi: due archivi, due alias di rete distinti, nessun conflitto.

### 2. Copia i file

Da una shell del VPS, con `<SEGRETO-MINIO>` e `<SEGRETO-RUSTFS>` al posto giusto:

```bash
docker run --rm --network dokploy-network --entrypoint sh \
  quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z -c '
    mc alias set vecchio http://plantdaddy-minio:9000 plantdaddy-app "<SEGRETO-MINIO>" &&
    mc alias set nuovo  http://plantdaddy-rustfs:9000 plantdaddy   "<SEGRETO-RUSTFS>" &&
    mc mirror --overwrite vecchio/plantdaddy nuovo/plantdaddy &&
    echo "--- conteggi ---" &&
    echo "vecchio: $(mc ls --recursive vecchio/plantdaddy | wc -l)" &&
    echo "nuovo:   $(mc ls --recursive nuovo/plantdaddy   | wc -l)"'
```

**I due conteggi devono coincidere.** Se non coincidono, fermati qui e non
proseguire: rilancia il mirror.

Nota che **non** c'è `--remove`: è una copia, non una sincronizzazione. Se qualcosa
va storto, MinIO è ancora intatto.

### 3. Cambia l'endpoint dell'app

`plantdaddy-app` → Environment → `S3_ENDPOINT=http://plantdaddy-rustfs:9000`
(più `S3_ACCESS_KEY` e `S3_SECRET_KEY` di RustFS). Poi **Redeploy**.

### 4. Verifica dall'app, non dai log

Apri l'app e controlla tre cose:

- una foto **già esistente** si vede — significa che la copia ha funzionato;
- **carichi una foto nuova** e appare — significa che la scrittura funziona;
- **cancelli** quella foto di prova e sparisce.

Poi che il conteggio del database e quello dell'archivio combacino:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  "http://plantdaddy-app:3000/api/cron/photo-cleanup?dry-run"
```

`chiavi_nel_bucket` e `chiavi_nel_database` devono corrispondere e
`orfani_trovati` deve essere **0**. Se ci fossero orfani, qualcosa nella copia non
è andato: **non** far girare la pulizia vera, indaga prima.

### 5. Lascia passare qualche giorno

Non c'è fretta di cancellare. MinIO fermo non consuma CPU e occupa solo disco, e
tenerlo qualche giorno è l'unico modo di accorgersi di un problema che si manifesta
dopo. Per intanto fermalo senza distruggere niente:

Dokploy → `plantdaddy-minio` → **Stop**.

Se qualcosa non torna, si riparte cambiando `S3_ENDPOINT` all'indietro.

### 6. Rimozione definitiva — questo cancella le foto da MinIO

Solo quando il passo 4 è verificato e sono passati alcuni giorni.

**a. Il servizio.** Dokploy → progetto `plantdaddy` → `plantdaddy-minio` →
**Delete**. Questo rimuove i container ma **non** il volume: i dati sono ancora lì.

**b. Il volume.** È il passaggio irreversibile. Prima guarda cosa stai per
cancellare:

```bash
docker volume ls | grep -i minio
```

Il nome sarà tipo `plantdaddy-minio-zwulcd_plantdaddy-minio-data` — il prefisso è
il nome del progetto compose. Controlla quanto pesa e che sia davvero quello:

```bash
docker system df -v | grep -i minio
```

E solo allora:

```bash
docker volume rm <NOME-ESATTO-DEL-VOLUME>
```

Se risponde `volume is in use`, un container esiste ancora: non forzare con
`docker rm -f` alla cieca, trova chi lo usa con `docker ps -a --filter volume=<NOME>`.

**c. Le immagini.** Recuperano qualche centinaio di MB di disco:

```bash
docker rmi quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z
docker rmi quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z
```

Tieni `mc` se usi `deploy/backup-foto.sh`, che se ne serve.

**d. Le variabili.** In Dokploy non resta niente da togliere se hai cancellato il
servizio Compose: le sue env vanno via con lui. Controlla solo che
`plantdaddy-app` non abbia più `S3_ENDPOINT` che punta a `plantdaddy-minio`.

### Se qualcosa va storto dopo il passo 6

Non c'è ritorno da MinIO: il volume non esiste più. L'unica copia è il backup
esterno di § 10b.8 — che è il motivo per cui quella sezione esiste e per cui vale
la pena farlo girare **prima** di questa migrazione, non dopo.

## 10d. Metriche e query lente

### 10d.1 Lo Schedule del rollup

Progetto `plantdaddy` → **Schedules**:

| Task            | Schedule    | Command                                                                                                |
| --------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| Rollup metriche | `5 * * * *` | `curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://plantdaddy-app:3000/api/cron/metrics-rollup` |

Al minuto 5 e non allo scoccare dell'ora: gli altri due job girano al minuto 0 e
30, e non c'è motivo di farli competere per le stesse due vCPU.

Il job aggrega, campiona l'occupazione e ripulisce, in quest'ordine. È idempotente:
rieseguirlo ricalcola invece di duplicare, verificato — 240 righe orarie prima e
240 dopo un secondo giro.

Se lo Schedule non c'è, la raccolta funziona comunque ma **niente viene mai
aggregato né cancellato**: la tabella grezza cresce fino al tetto di
`METRICS_MAX_RAW_ROWS` e poi si auto-pota in modo aggressivo. La dashboard alla
scheda Metriche mostra l'ultima esecuzione di ogni job, quindi il problema si vede.

### 10d.2 Quanto occupa, misurato

A 70.000 righe grezze — sette giorni a 10.000 richieste al giorno — misurato su
Postgres reale:

|                                            |                               |
| ------------------------------------------ | ----------------------------- |
| heap della tabella grezza                  | 5,4 MB                        |
| indice `request_metrics_pkey`              | 1,5 MB                        |
| indice `request_metrics_created_idx`       | 2,7 MB                        |
| indice `request_metrics_route_created_idx` | 5,2 MB                        |
| **totale grezza**                          | **15 MB** (219 byte per riga) |
| rollup orario, 240 righe                   | 88 kB                         |
| rollup giornaliero, 120 righe              | 64 kB                         |

Estrapolando la retention completa: grezzi 15 MB, orari 90 giorni circa 10 MB,
giornalieri 12 mesi circa 2 MB. **Sotto i 30 MB a regime.**

> Il primo calcolo che avevo fatto diceva 84 byte per riga e ~10 MB: era
> sbagliato di 2,6 volte perché non contava l'indice della chiave primaria e
> sottostimava quello su `(route, created_at)`, che porta con sé il testo della
> rotta. I numeri qui sopra sono misurati, non stimati.

Il tetto di `METRICS_MAX_RAW_ROWS=2000000` corrisponde quindi a circa **420 MB**.
Su 40 GB condivisi con Postgres e le foto è accettabile come limite estremo, ma se
vuoi stare più stretto abbassa quel valore: è il solo parametro che governa il caso
peggiore.

### 10d.3 Query Postgres lente, senza riavviare il database

```bash
docker exec -it $(docker ps --format '{{.Names}}' | grep plantdaddy-plantdaddydb | head -1) \
  psql -U plantdaddy -d plantdaddy -c "alter system set log_min_duration_statement = '500ms'" \
  -c "select pg_reload_conf()"
```

**Nessun riavvio**: `log_min_duration_statement` è modificabile a caldo e
`pg_reload_conf()` basta. Si spegne allo stesso modo con `= -1`.

Costo in risorse: praticamente nullo in CPU — Postgres misura già la durata di ogni
statement, questo decide solo se stamparla. Su un'app personale a 500 ms sono una
manciata di righe al giorno.

> **L'unica accortezza vera è la rotazione dei log.** Il driver `json-file` di
> Docker non ruota per default: un log che cresce senza limite è esattamente il
> "logging verboso che riempie il disco" da evitare. Nel servizio del database, in
> Dokploy → Advanced, imposta il logging con `max-size: 10m` e `max-file: 3`.
> Senza quello, non attivare il logging delle query.

Per leggere cosa esce:

```bash
docker logs --tail 200 $(docker ps --format '{{.Names}}' | grep plantdaddy-plantdaddydb | head -1) 2>&1 | grep -i duration
```

**`pg_stat_statements` NON è stato attivato**, di proposito: darebbe l'aggregato per
query normalizzata, che è più utile di righe sparse, ma richiede
`shared_preload_libraries` e quindi un **riavvio del container Postgres**, cioè
downtime del database. Il momento per farlo è quando i log mostrano che c'è
davvero qualcosa da aggregare — non prima.

---

## 11. Backup del database — deliberatamente non configurato

Nessuno Schedule di backup: scelta consapevole per un'app personale.

Sappi cosa comporta. Senza account e senza backup del database, se il volume di
Postgres si perde i dati non tornano: non c'è nessuna copia sul server. L'unica
rete di sicurezza è l'**export JSON dall'app** (Impostazioni → Esporta backup),
che è lato utente e va fatto a mano.

Se un giorno cambi idea, sono due minuti: `plantdaddy-db` → **Backups** →
`0 3 * * *`, destinazione separata dagli altri progetti, 14 copie. E poi provalo
davvero, ripristinando su un database temporaneo: un backup non verificato non è
un backup.

---

## 12. Aggiornamenti e rollback

- **Aggiornamento**: push su `main` → Dokploy ricostruisce l'immagine. Con il
  pre-deploy command le migrazioni girano prima che il nuovo container prenda
  traffico, e l'`HEALTHCHECK` impedisce a Traefik di instradare verso un
  container non pronto.
- **Rollback del codice**: in Dokploy, **Deployments** → seleziona un deploy
  precedente → Redeploy.
- **Rollback dello schema**: non esiste automatico. Le migrazioni sono solo in
  avanti: se una modifica va annullata, si scrive una nuova migrazione
  (`003_...sql`) che la disfa. Per questo conviene evitare `DROP COLUMN` in una
  prima migrazione e usare invece due passaggi (smetti di scrivere la colonna,
  poi la rimuovi in un deploy successivo).

## 13. Checklist finale

- [ ] progetto `plantdaddy` separato dagli altri progetti sulla macchina
- [ ] `plantdaddy-db` con External Port vuoto
- [ ] `DATABASE_URL` che punta all'App Name del database, non a localhost
- [ ] tutte le env var impostate, VAPID incluse
- [ ] migrazioni applicate (`schema_migrations` contiene tutte e cinque le versioni)
- [ ] dominio `<HOST>` con certificato valido
- [ ] `https://<HOST>/api/health` risponde `{"ok":true}`
- [ ] `/api/cron/notify` senza header risponde 401
- [ ] Schedule oraria attiva (Shell Type: Sh) e testata a mano
- [ ] **verifica dall'esterno**: 5432 non raggiungibile, 3000 filtrata
- [ ] app installata sul telefono e notifiche attivate (su iPhone serve
      l'aggiunta alla Home: vedi README)
- [ ] pannello di controllo: se NON lo vuoi, `https://<HOST>/superman` risponde
      404; se lo vuoi, primo admin creato, 2FA configurata e `/admin` che
      risponde 404
