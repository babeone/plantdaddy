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

## 10. Backup del database — deliberatamente non configurato

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

## 11. Aggiornamenti e rollback

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

## 12. Checklist finale

- [ ] progetto `plantdaddy` separato dagli altri progetti sulla macchina
- [ ] `plantdaddy-db` con External Port vuoto
- [ ] `DATABASE_URL` che punta all'App Name del database, non a localhost
- [ ] tutte le env var impostate, VAPID incluse
- [ ] migrazioni applicate (`schema_migrations` contiene `001_init` e `002_action_tokens`)
- [ ] dominio `<HOST>` con certificato valido
- [ ] `https://<HOST>/api/health` risponde `{"ok":true}`
- [ ] `/api/cron/notify` senza header risponde 401
- [ ] Schedule oraria attiva (Shell Type: Sh) e testata a mano
- [ ] **verifica dall'esterno**: 5432 non raggiungibile, 3000 filtrata
- [ ] app installata sul telefono e notifiche attivate (su iPhone serve
      l'aggiunta alla Home: vedi README)
