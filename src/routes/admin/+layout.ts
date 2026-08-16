/**
 * Il pannello va nella direzione opposta al resto dell'app.
 *
 * ssr: l'app utente ha `ssr = false` nel layout radice, perché il server non sa
 *      chi sia l'utente finché il JavaScript non legge il token da localStorage.
 *      Qui invece il server lo sa benissimo — c'è un cookie — quindi può
 *      renderizzare la pagina già piena.
 *
 * csr = false: nessun JavaScript viene consegnato al browser per queste pagine.
 *      Si perdono transizioni e trascina-per-aggiornare, che a un pannello di
 *      sola lettura non servono, e si guadagna che nessuna logica di sessione
 *      admin esiste lato client, dove potrebbe essere letta o manomessa.
 */
export const ssr = true;
export const csr = false;
export const prerender = false;
