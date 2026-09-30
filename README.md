# Taskspark

Taskspark is a family chore board and a points board. One phone sets a household code. That phone is approved. Later phones enter the same code and wait until an approved phone accepts them under Admin, Devices.

The board is Today, Tomorrow, and Later. The crown opens the scoreboard. The menu opens Calendar, Completed, and Admin.

## Run with Docker Compose

From this folder, run:

```bash
docker compose up -d
```

Open `http://127.0.0.1:8080`.

The SQLite file is in the `taskspark` volume, mounted at `/data` in the container.

## Run with Docker

Build the image, then start it:

```bash
docker build -t taskspark .
docker run -d --name taskspark -p 8080:8080 -v taskspark:/data taskspark
```

The image uses `node:22.14-bookworm-slim`, which publishes `linux/amd64` and `linux/arm64`. To build both at once:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t taskspark .
```

There is no household code in the image. The first phone chooses it.

## Home Assistant

This folder is a local add-on. `config.yaml` sits next to the `Dockerfile`.

1. Copy this folder to `/addons/taskspark` on the Home Assistant host.
2. Open Settings, Add-ons, Add-on store. Reload the store.
3. Install Taskspark and start it.
4. Open port 8080.

The add-on stores the database in its data folder, mounted at `/data`.

## Phone

The app is a PWA. Add it to the home screen from the browser menu. On a public HTTPS address, the session cookie is `HttpOnly`, `Secure`, and `SameSite=Lax`. On plain HTTP, such as a local Docker port, the cookie stays `HttpOnly` and `SameSite=Lax` so the phone can remember the household.

## Tests

```bash
npm test
```

## License

MIT. See `LICENSE`.
