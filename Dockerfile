# Build stage
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Serve stage
FROM node:20-slim
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist
EXPOSE 8080
# Cloud Run sets the PORT environment variable. We use 8080 as default.
CMD ["serve", "-s", "dist", "-l", "8080"]
