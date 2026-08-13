# PlantDaddy — immagine di produzione.
#
# Tre stage: le dipendenze complete servono solo a compilare, nell'immagine
# finale entrano soltanto la build, il package.json e le dipendenze di runtime.
#
# node:22-alpine risolve all'ultima 22.x, che soddisfa i requisiti del
# toolchain (ESLint 10 vuole Node >= 22.13) e il TypeScript nativo usato da
# `npm run migrate` (Node >= 22.6). Con `node:24-alpine` funziona identico e
# combacia con .nvmrc, se preferisci la parità con lo sviluppo locale.

# ---------- deps: dipendenze complete, solo per compilare ----------
FROM node:22-alpine AS deps
WORKDIR /app
# Solo i manifest: così questo layer si invalida quando cambiano le dipendenze,
# non a ogni modifica del codice.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# ---------- builder: produce build/ ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `npm run build` esegue vite build: l'adapter-node scrive un server Node
# autonomo in build/, che si avvia con `node build/index.js`.
RUN npm run build

# ---------- prod-deps: solo dipendenze di runtime ----------
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

# ---------- runner ----------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
# Il default di adapter-node è 512K e rifiuterebbe l'import di un backup vero:
# 100 piante x 300 eventi sono circa 30.000 righe, cioè ~4 MB di JSON. 8M lascia
# margine senza permettere a chiunque di far streammare un corpo enorme.
ENV BODY_SIZE_LIMIT=8M

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY package.json ./
# Migrazioni dentro l'immagine: servono per poter lanciare `npm run migrate`
# come pre-deploy command o dalla shell del container. Sono pochi KB di SQL.
COPY db ./db
COPY scripts ./scripts

# L'immagine ufficiale ha già l'utente non privilegiato `node` (uid 1000).
# Girare da root darebbe a un'eventuale RCE i permessi per riscrivere l'app.
RUN chown -R node:node /app
USER node

EXPOSE 3000

# Dokploy e Traefik leggono lo stato di salute: senza, il traffico arriverebbe
# anche a un container che sta ancora avviandosi o che ha perso il database.
# node -e invece di curl: alpine non ha curl e non vale la pena installarlo.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build/index.js"]
