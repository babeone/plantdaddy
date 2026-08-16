-- Creazione di un amministratore del pannello.
--
-- Questo file NON contiene password: contiene i segnaposto. La password in
-- chiaro non deve stare in un file, e tantomeno in un repository pubblico.
--
-- PASSO 1 — genera l'hash sulla tua macchina (o dentro il container):
--
--   npm run admin:hash
--
-- Ti chiede email e password senza mostrarla a schermo e stampa una riga come
--
--   scrypt$32768$8$1$Xk9…$7fQ…
--
-- Con  npm run admin:hash -- --insert  fa direttamente l'INSERT usando
-- DATABASE_URL e questo file non serve.
--
-- PASSO 2 — incolla qui sotto email e hash ed esegui da TablePlus o psql.

insert into admins (email, password_hash)
values (
	'tu@example.com',
	'INCOLLA_QUI_L_HASH_SCRYPT'
);

-- PASSO 3 — abilita il pannello nelle variabili d'ambiente dell'applicazione:
--
--   ADMIN_ENABLED=true
--
-- e riavvia. Senza questa variabile il percorso del pannello risponde 404.
--
-- PASSO 4 — apri il percorso del pannello (per default /superman), entra con
-- email e password e configura il secondo fattore: al primo accesso compare un
-- QR da inquadrare con l'app di autenticazione. È obbligatorio, non si salta.

-- ---------------------------------------------------------------------------
-- MANUTENZIONE
-- ---------------------------------------------------------------------------

-- Telefono perso o app di autenticazione reinstallata: si azzera il secondo
-- fattore e al login successivo riparte l'arruolamento con un QR nuovo.
-- Non esiste una scorciatoia dentro l'applicazione, ed è voluto: un "ho perso il
-- telefono" cliccabile dal browser sarebbe il modo più comodo per scavalcare la
-- 2FA. Serve accesso al database, cioè a qualcosa che un attaccante non ha.
--
--   update admins
--   set totp_secret = null, totp_confirmed_at = null, last_totp_step = null
--   where lower(email) = lower('tu@example.com');

-- Sbloccare un account dopo troppi tentativi falliti, senza aspettare:
--
--   update admins set failed_attempts = 0, locked_until = null
--   where lower(email) = lower('tu@example.com');

-- Sospendere un amministratore lasciando la sua traccia nell'audit:
--
--   update admins set disabled = true where lower(email) = lower('tu@example.com');

-- Chiudere subito tutte le sessioni aperte di un amministratore:
--
--   delete from admin_sessions
--   where admin_id = (select id from admins where lower(email) = lower('tu@example.com'));
