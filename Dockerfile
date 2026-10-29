# syntax not specified (no vendor/BuildKit-only directives)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:22-bookworm-slim
ENV NODE_ENV=production
ENV KPM_HTTP_HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/build ./build
COPY data ./data
USER node
EXPOSE 8080
CMD ["node", "build/remote/main.js"]
