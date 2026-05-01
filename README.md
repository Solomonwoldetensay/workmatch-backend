# WorkMatch Backend

Express API server for the WorkMatch / WE-NEED-U backend.

## Requirements

- Docker and Docker Compose, recommended
- Or Node.js 20+ and PostgreSQL 15+

The Docker setup uses PostgreSQL 18 by default.

## Quick Start With Docker

Create a local environment file:

```bash
cp .env.docker.example .env
```

Edit `.env` and replace the placeholder secrets:

```bash
POSTGRES_PASSWORD=replace_with_a_strong_password
JWT_SECRET=replace_with_a_long_random_secret
```

Set the public port for the API with `HOST_PORT`:

```bash
HOST_PORT=8080
```

Start PostgreSQL:

```bash
docker compose up -d db
```

Run the database setup script once:

```bash
docker compose --profile setup run --rm migrate
```

Build and start the API:

```bash
docker compose up -d --build api
```

Check that the API is running:

```bash
curl http://localhost:8080/api/health
```

If you keep the default `HOST_PORT=3000`, use:

```bash
curl http://localhost:3000/api/health
```

## Docker Commands

View logs:

```bash
docker compose logs -f api
```

Stop the stack:

```bash
docker compose down
```

Stop the stack and delete the database volume:

```bash
docker compose down -v
```

Re-run database setup:

```bash
docker compose --profile setup run --rm migrate
```

Open a PostgreSQL shell:

```bash
docker compose exec db psql -U workmatch_user -d workmatch
```

## Environment Variables

Required:

```bash
HOST_PORT=3000
APP_PORT=3000
POSTGRES_HOST_PORT=5432
POSTGRES_DB=workmatch
POSTGRES_USER=workmatch_user
POSTGRES_PASSWORD=replace_with_a_strong_password
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d
```

Optional integrations:

```bash
GOOGLE_CLIENT_ID=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
APNS_PRIVATE_KEY=
APNS_KEY_ID=
APNS_TEAM_ID=
APNS_BUNDLE_ID=com.weneedu.app
```

Cloudinary is needed for avatar and upload endpoints. Google auth needs `GOOGLE_CLIENT_ID`. APNs variables are only needed for push notifications.

## Local Setup Without Docker

Install dependencies:

```bash
npm install
```

Create a PostgreSQL database and user:

```bash
sudo -u postgres psql
```

```sql
CREATE USER workmatch_user WITH PASSWORD 'replace_with_a_strong_password';
CREATE DATABASE workmatch OWNER workmatch_user;
GRANT ALL PRIVILEGES ON DATABASE workmatch TO workmatch_user;
\c workmatch
CREATE EXTENSION IF NOT EXISTS pgcrypto;
\q
```

Create `.env`:

```bash
PORT=3000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=5432
DB_NAME=workmatch
DB_USER=workmatch_user
DB_PASSWORD=replace_with_a_strong_password

JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d
```

Initialize the database:

```bash
npm run setup-db
```

Start the development server:

```bash
npm run dev
```

Start the production server:

```bash
npm start
```

## API Entry Points

Health check:

```text
GET /api/health
```

Mounted route groups:

```text
/api/auth
/api/projects
/api/matches
/api/messages
/api/notifications
```

## Schema Note

The included setup script creates the core tables:

```text
users
projects
swipes
matches
conversations
messages
```

Some routes also reference tables and columns that are not currently created by `npm run setup-db`:

```text
comments
likes
notifications
device_tokens
users.google_id
users.auth_provider
```

The server can start with the core schema, but endpoints that touch those missing tables or columns will fail until a follow-up migration adds them.

## Deployment Notes

The API listens on `APP_PORT` inside the container. The host machine exposes it through `HOST_PORT`.

Example:

```bash
HOST_PORT=8080
APP_PORT=3000
```

This maps:

```text
localhost:8080 -> api container port 3000
```

PostgreSQL is exposed only on `127.0.0.1` by default:

```bash
POSTGRES_HOST_PORT=5432
```

For public deployments, set strong values for `POSTGRES_PASSWORD` and `JWT_SECRET`.
