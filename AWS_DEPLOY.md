# Deploying +one to AWS (EC2 + Docker + EBS)

The whole deployment is scripted. You only click through the AWS Console a
few times — everything else runs in **CloudShell**, the browser terminal
inside the AWS Console (zero installs, already logged in as you).

**What you end up with** (all in `ap-south-1`, Mumbai):

| Piece | What | Rough cost |
|---|---|---|
| EC2 `t4g.small` | Ubuntu 24.04 ARM, runs the Docker backend (API + Socket.IO + web bundle) | ~$12/mo |
| EBS `gp3` 20 GB | mounted at `/data` — SQLite db, uploads, 6-hour backups, VAPID keys. Survives reboots AND instance replacement | ~$1.7/mo |
| Elastic IP | stable public IPv4 for your domain | free while attached |
| Caddy | TLS (free Let's Encrypt cert, auto-renew) + HTTPS→app proxy on the box | free |
| Route53 domain | e.g. yourapp.com | ~$14/yr + $0.50/mo hosted zone |

Why EC2 and not Lambda/Amplify: +one holds **WebSocket** connections (Socket.IO)
and keeps **SQLite** on disk — it needs one always-on process with a real,
persistent local filesystem. This is the same shape as the old Railway setup.

---

## Step 0 — buy the domain (5–30 min, console only)

1. Console → **Route 53 → Registered domains → Register domain**
2. Pick a name (`.com` ≈ $14/yr, `.in` ≈ $10/yr, `.app` ≈ $16/yr and forces HTTPS — fine)
3. Complete purchase; wait until its status is **Registered** (Route53 creates the hosted zone automatically — don't touch it)

> While you wait, do Step 1 — provisioning doesn't need the domain.

## Step 1 — provision the server (~10 min, CloudShell)

1. Set your console region (top-right) to **Asia Pacific (Mumbai) ap-south-1**
2. Open **CloudShell** (terminal icon in the console toolbar)
3. Run:

```bash
git clone --depth 1 https://github.com/sakshamfit/BROSKIE.git
cd BROSKIE
bash scripts/aws/provision.sh
```

It creates the security group, SSH key (saved to `~/.ssh/plusone-key.pem`
inside CloudShell — never commit it), EC2 instance, EBS volume and Elastic
IP, then prints your IP and next steps. First boot builds the app inside
Docker — watch it if you're curious:

```bash
ssh -i ~/.ssh/plusone-key.pem ubuntu@<IP-from-output> \
  'tail -f /var/log/plusone-bootstrap.log'
```

## Step 2 — domain + HTTPS (once the domain is Registered)

```bash
cd BROSKIE   # still in CloudShell
bash scripts/aws/setup-domain.sh yourdomain.com
```

Creates `yourdomain.com` / `www.yourdomain.com` A records → the Elastic IP,
installs the Caddy config on the box, and waits until
`https://yourdomain.com/health` answers. That's the live app — web bundle,
API and WebSockets all on one origin, exactly like local single-host mode.

## Step 3 — migrate your existing Railway data

The database is where all users/chats/messages live. Get it out of Railway
(on any machine with the Railway CLI logged in):

```bash
railway link                       # pick the BROSKIE project + service
railway shell "ls -t /data/backups | head -1"           # newest backup name
railway ssh "cat /data/backups/THAT-NAME" > tomodachi.db
railway ssh "cat /data/vapid-keys.json" > vapid-keys.json   # optional: keeps browser push alive
```

(Fallback without `railway ssh`: open `railway shell` inside the container,
run `base64 -w0 /data/tomodachi.db`, copy/paste, then `base64 -d` locally.)

Upload the file(s) into CloudShell (Actions → Upload file), then:

```bash
bash scripts/aws/migrate-data.sh tomodachi.db vapid-keys.json
```

It stops the backend, swaps in your database (the fresh one is kept as
`/data/tomodachi.db.pre-migrate`), fixes ownership and restarts. Log in with
an existing account to verify. Photos uploaded while Supabase was configured
keep working unchanged (they live in Supabase, not on disk) — copy
`SUPABASE_URL` / `SUPABASE_SERVICE_KEY` from Railway into `/opt/plusone/.env`
on the box and `docker compose up -d` to keep it that way.

## Step 4 — tell Arena the domain

Back in your Arena session, post the final domain. The app-side defaults in
`app/src/api.js` (and the split-host configs `vercel.json` / `wrangler.jsonc`)
still point at the old Railway/Vercel origins — they'll be repointed to
`https://yourdomain.com` for future native builds. The already-deployed web
app needs nothing: it talks to the same origin it's served from.

### Afterwards

- **Deploy an update:** `bash scripts/aws/deploy-update.sh` (CloudShell)
- **Check logs:** `ssh -i ~/.ssh/plusone-key.pem ubuntu@<IP> 'sudo docker compose -f /opt/plusone/compose.yaml logs -f'`
- **Tighten SSH:** in EC2 → Security Groups → `plusone-sg`, limit port 22 to your IP
- **Costs/cleanup:** all resources carry the tag `Project=plusone`; terminate them from the EC2 console (release the Elastic IP and delete the volume too)
- **Backups:** the server's built-in 6-hour backups land in `/data/backups` on the EBS volume. For belt-and-braces, snapshot the volume: EC2 → Elastic Block Store → Snapshots
