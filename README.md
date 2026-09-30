# Taskspark

Taskspark is a family chore board and a points board. One phone sets a household code. That phone is approved. Later phones enter the same code and wait until an approved phone accepts them under Admin, Devices.

The board is Today, Tomorrow, and Later. The crown opens the scoreboard. The menu opens Calendar, Completed, and Admin.

There is no household code in the image. The first phone chooses it.

## Run with Docker

A push to `main` makes GitHub build `ghcr.io/d1same/taskspark` for `linux/amd64` and `linux/arm64`. You pull that image.

You put the board on the kitchen computer. Chores stay in the data folder, so a reboot does not wipe the house.

```bash
docker run -d --name taskspark --restart unless-stopped -p 7370:7370 -v taskspark:/data ghcr.io/d1same/taskspark:latest
```

To keep the database in a folder on the computer instead of a named volume, use `-v /path/to/taskspark:/data` in that same command.

Open `http://127.0.0.1:7370`.

The container runs as user id 1000. That user must be allowed to write the data folder.

Logs are one line each, with a time and the word info or error. Read them with `docker logs taskspark`. On Unraid, open the container log.

## Roll back

`latest` is the newest image. This logs release is `0.1.0`. To go back, set the tag to an older version, for example `ghcr.io/d1same/taskspark:0.1.0`, instead of `latest`.

```bash
docker run -d --name taskspark --restart unless-stopped -p 7370:7370 -v taskspark:/data ghcr.io/d1same/taskspark:0.1.0
```

The data folder stays. Bump the `VERSION` file for the next release so `0.1.0` stays on this image.

## Run with Docker Compose

From this folder:

```bash
docker compose up -d
```

Compose pulls `ghcr.io/d1same/taskspark:latest`. GitHub built that tag.

## Unraid

Add a container in the Docker page.

- Image: `ghcr.io/d1same/taskspark:latest`
- Network: bridge
- Port: host `7370` to container `7370`
- Path: `/mnt/user/appdata/taskspark` to `/data`
- Variable: `TZ` = `America/New_York`
- Privileged: off
- Extra devices: none

The appdata folder must be writable by user id 1000.

To roll back, edit the container and set the repository to an older tag, for example `ghcr.io/d1same/taskspark:0.1.0`, instead of `latest`. Then apply. Read problems in the container log.

`unraid/taskspark.xml` is a Community Applications style template with those same fields. Paste this template URL into the Unraid Docker UI:

`https://raw.githubusercontent.com/d1same/Taskspark/main/unraid/taskspark.xml`

## Home Assistant

This folder is a local add-on. `config.yaml` pulls `ghcr.io/d1same/taskspark:latest`, the image GitHub built.

1. Copy this folder to `/addons/taskspark` on the Home Assistant host.
2. Open Settings, Add-ons, Add-on store. Reload the store.
3. Install Taskspark and start it.
4. Open port 7370.

The add-on stores the database in its data folder, mounted at `/data`.

## Phone

The app is a PWA. Add it to the home screen from the browser menu. On a public HTTPS address, the session cookie is `HttpOnly`, `Secure`, and `SameSite=Lax`. On plain HTTP, such as a local Docker port, the cookie stays `HttpOnly` and `SameSite=Lax` so the phone can remember the household.

## Tests

```bash
npm test
```

## License

MIT. See `LICENSE`.
