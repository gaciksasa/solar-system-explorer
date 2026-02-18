# ── Stage 1: Build Angular frontend ─────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci --quiet
COPY frontend/ ./
RUN npm run build -- --configuration production

# ── Stage 2: Build Go backend ────────────────────────────────────────────────
FROM golang:1.22-alpine AS backend
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o solar-api main.go

# ── Stage 3: Minimal runtime image ───────────────────────────────────────────
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend /app/solar-api ./
COPY --from=frontend /app/dist/frontend/browser ./frontend/dist/frontend/browser
EXPOSE 8080
CMD ["./solar-api"]
