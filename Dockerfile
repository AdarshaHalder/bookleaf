# Single image: Express serves the API and the built React app.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY server/package*.json server/
COPY client/package*.json client/
RUN npm --prefix server ci && npm --prefix client ci
COPY . .
RUN npm --prefix client run build && npm --prefix server run build && npm --prefix server prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4000 DATABASE_PATH=/data/bookleaf.db UPLOAD_DIR=/data/uploads
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
EXPOSE 4000
CMD ["node", "server/dist/index.js"]
