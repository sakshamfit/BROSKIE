# Docker & Kubernetes for BROSKIE

Only the **server** (`server/`) belongs in a container — it's the stateful,
long-running Socket.IO process. The Expo **app** stays on EAS Build for
native, and (optionally) gets exported as static files for web hosting —
that doesn't need Kubernetes.

## 1. Build & test locally with Docker

```bash
cd server
docker build -t broskie-server:local .
docker run -p 4000:4000 -e JWT_SECRET=devsecret -v broskie_data:/data broskie-server:local
```

Or with the compose file at the repo root:

```bash
docker compose up --build
```

Visit `http://localhost:4000` — same as `npm start`, just containerized (the
server-only image serves the API + WebSockets + `/uploads`; point a browser at
`/api/health` to confirm it's up, and serve the web UI separately — see "What's
out of scope"). The SQLite DB now lives in the `broskie_data` volume instead of
your filesystem, so `docker compose down && docker compose up` won't lose data.

> The image bakes in `DATA_DIR=/data`, so mounting a volume at `/data` is all
> it takes — the DB (`tomodachi.db` + WAL), local uploads, the 6-hourly +
> on-shutdown backups, and the web-push VAPID keys all land on it automatically.

## 2. Push the image to a registry

```bash
docker tag broskie-server:local ghcr.io/sakshamfit/broskie-server:latest
docker push ghcr.io/sakshamfit/broskie-server:latest
```

(Swap `ghcr.io/sakshamfit` for Docker Hub / GCR / ECR — whatever your
cluster can pull from.) Then set that image path in `k8s/02-deployment.yaml`
before deploying.

## 3. Deploy to Kubernetes

```bash
kubectl apply -f k8s/00-namespace-storage.yaml

kubectl create secret generic broskie-secrets -n broskie \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=VAPID_PUBLIC_KEY='' \
  --from-literal=VAPID_PRIVATE_KEY='' \
  --from-literal=VAPID_SUBJECT='mailto:you@example.com'

# edit k8s/02-deployment.yaml: set the real image path first
kubectl apply -f k8s/02-deployment.yaml
kubectl apply -f k8s/03-service-ingress.yaml

kubectl get pods -n broskie -w
```

Point `EXPO_PUBLIC_API_URL` in the app at your ingress host
(`https://api.yourdomain.com`). Edit the `host:` (and `ingressClassName`) in
`k8s/03-service-ingress.yaml`, and uncomment the `tls:` block once you have a
certificate (e.g. cert-manager).

`k8s/01-secret.example.yaml` documents the secret's shape but is entirely
comments, so `kubectl apply -f k8s/` is safe to run — just create the secret
(with the command above) before applying the Deployment.

## Why these specific choices

- **1 replica, `strategy: Recreate`, `ReadWriteOnce` PVC** — this repo uses
  SQLite (single-writer, single-file). Kubernetes loves to scale things
  horizontally, but scaling this server past 1 pod would mean two processes
  writing to the same DB file, which SQLite doesn't support safely across
  hosts. If you outgrow 1 replica: migrate to Postgres, put `uploads/` on S3
  instead of local disk, and add the Socket.IO Redis adapter for cross-pod
  broadcast — then you can scale freely.
- **Secrets, not ConfigMap, for `JWT_SECRET`/VAPID keys** — these are
  credentials, not config; Kubernetes Secrets keep them out of your YAML
  and git history. The VAPID keys are marked `optional` in the Deployment:
  leave them empty and the server auto-generates a keypair once, persisted on
  the `/data` volume (see `server/src/push.js`).
- **Ingress WebSocket timeouts** — Socket.IO holds long-lived connections;
  default proxy timeouts (60s) will silently kill idle sockets without the
  annotations included in `03-service-ingress.yaml`. The same manifest bumps
  `proxy-body-size` to 30m so the app's 25mb upload / JSON limits get through.
- **`/data` PVC** — matches this repo's existing `DATA_DIR` convention
  (see `DEPLOY.md` in the repo) so backups (`npm run backup`, the 6-hour
  auto-backup, and the pre-shutdown backup) all land on the persistent
  volume and survive pod restarts/redeploys, same as it already does on
  Railway/Render. The Deployment's `terminationGracePeriodSeconds: 30` gives
  that final backup time to run before the kubelet force-kills the pod.
- **Non-root, uid 1001** — the image runs as a dedicated `broskie` user, and
  the pod's `securityContext` (`runAsNonRoot`, dropped capabilities) matches.

## What's out of scope here

- `app/` (Expo) — build for web with `npx expo export --platform web` and
  serve the static output from any static host or CDN (Vercel/Cloudflare
  Pages, or an nginx container if you want it in the same cluster — say the
  word and I'll add that manifest too). Native builds go through EAS, not
  Docker.
- Multi-region / autoscaling — not meaningful until you're off SQLite.
