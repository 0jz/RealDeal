FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/src ./src
COPY --from=build /app/data/fixtures ./data/fixtures
COPY --from=build /app/data/strategy ./data/strategy
COPY --from=build /app/web/dist ./web/dist
USER node
EXPOSE 8787
CMD ["npm", "start"]
