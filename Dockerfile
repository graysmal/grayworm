FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --chown=node:node web/ ./web/
COPY --chown=node:node server/ ./server/

USER node

EXPOSE 3000

CMD ["node", "web/server.js"]