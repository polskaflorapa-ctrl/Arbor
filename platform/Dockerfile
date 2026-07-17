# Arbor OS — API (Express + Socket.IO, node:sqlite / opcjonalnie PostgreSQL)
FROM node:24-alpine
WORKDIR /app

# tylko manifesty → cache warstwy zależności
COPY package*.json ./
# Twardy npm ci: build ma failować przy niespójnym package-lock zamiast po cichu
# dryfować wersjami zależności (reprodukowalne obrazy).
RUN npm ci --omit=dev

# kod serwera (dane runtime trzymane w wolumenie, patrz docker-compose)
COPY server ./server

ENV NODE_ENV=production
ENV ARBOR_API_PORT=8790
EXPOSE 8790

# node:sqlite jest wbudowany w Node 24 (ostrzeżenie "experimental" jest nieszkodliwe)
CMD ["node", "server/index.mjs"]
