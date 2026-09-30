FROM node:22.14-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7370
ENV DATA_DIR=/data

COPY package.json domain.mjs db.mjs server.mjs VERSION ./
COPY public ./public

RUN mkdir -p /data \
  && chown -R node:node /app /data

USER node
VOLUME /data
EXPOSE 7370

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7370)+'/').then((res)=>process.exit(res.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--experimental-sqlite", "server.mjs"]
