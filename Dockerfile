FROM node:22.14-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data

COPY package.json domain.mjs db.mjs server.mjs ./
COPY public ./public

RUN mkdir -p /data
VOLUME /data
EXPOSE 8080

CMD ["node", "--experimental-sqlite", "server.mjs"]
