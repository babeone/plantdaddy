#!/bin/sh
# Avvio del container: migrazioni, poi il server.
#
# Le migrazioni girano QUI e non in un pre-deploy command della piattaforma
# perché non tutte le versioni di Dokploy ne hanno uno, e perché in questo modo
# lo schema è sempre allineato al codice che sta partendo: sono la stessa
# immagine, lo stesso deploy, la stessa storia git. Lo script è idempotente
# (schema_migrations tiene il conto), quindi ripartire non riapplica nulla.
#
# Se le migrazioni falliscono il container esce con errore invece di servire
# un'app che si aspetta tabelle inesistenti: meglio un deploy visibilmente
# fallito che un 500 in mano all'utente.
set -e

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
	# Al primo deploy il database può non essere ancora pronto ad accettare
	# connessioni: qualche tentativo evita un ciclo di restart inutilmente
	# rumoroso nei log di Swarm.
	attempt=1
	max=5
	until npm run --silent migrate; do
		if [ "$attempt" -ge "$max" ]; then
			echo "migrazioni fallite dopo $max tentativi: mi fermo" >&2
			exit 1
		fi
		echo "database non pronto o migrazione fallita, nuovo tentativo fra 3s ($attempt/$max)" >&2
		attempt=$((attempt + 1))
		sleep 3
	done
else
	echo "RUN_MIGRATIONS=0: migrazioni saltate"
fi

# exec: il server diventa il processo 1 e riceve SIGTERM da Docker, così
# adapter-node può chiudere le connessioni in corso invece di essere ucciso.
exec node build/index.js
