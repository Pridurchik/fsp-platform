# Классический Docker, хост на Debian. База — Debian bookworm, как на хосте.
# У проекта нет внешних npm-зависимостей, поэтому npm install не нужен:
# копируем только исходники. База SQLite живёт в volume /app/data.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=::

WORKDIR /app

COPY package.json server.js ./
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/
COPY tests/ ./tests/

RUN mkdir -p data && chown -R node:node /app

USER node

VOLUME ["/app/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/mobile/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
