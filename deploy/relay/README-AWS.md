# DBReader sync relay — AWS deployment
#
# Two easy routes, pick ONE:
#
#  ROUTE 1 — Lightsail Container Service (simplest, HTTPS included, ~$7/mo)
#  ---------------------------------------------------------------
#  1. Build/upload the image:
#       docker build -t dbreader-relay .
#       docker tag dbreader-relay <account>.dkr.ecr.<region>.amazonaws.com/dbreader-relay
#       (or push to Docker Hub as yourname/dbreader-relay)
#  2. AWS Console → Lightsail → Containers → Create container service
#       - Power: 1 GB RAM / 1 vCPU (Nightly $5 or $7)
#       - Deployment: set image, port 8787, add env TOKEN=<your secret>
#       - Add deployment; the service gives you a free HTTPS endpoint:
#         https://<service-name>.<id>.<region>.cs.amazonaws.com
#       (Optionally attach your own domain via Lightsail DNS + it gets a free cert)
#  3. In DBReader on each device, set the sync address to that HTTPS URL
#     (no port needed) and the token to <your secret>.
#
#  ROUTE 2 — EC2 / Lightsail virtual server with your own domain (~$7/mo)
#  ---------------------------------------------------------------
#  1. Launch "Ubuntu 24.04" (any size ≥ t3.micro / 1GB).
#  2. Install Docker:
#       curl -fsSL https://get.docker.com | sh
#  3. Point your DNS A record (e.g. relay.example.com) at the server IP.
#  4. Copy this folder to the server and run:
#       TOKEN=<your secret> docker compose up -d
#     Caddy inside the compose file grabs a free Let's Encrypt cert for
#     relay.example.com and forwards 80/443 to the relay on :8787.
#  5. In DBReader's settings on each device, set the sync address to
#     https://relay.example.com and token <your secret>.
#
#  Testing from the Mac (before/after deploy):
#       curl https://<your-endpoint>/health     ->  {"ok":true}
#       curl -H "Authorization: Bearer <token>" https://<your-endpoint>/health
#
#  Data notes
#  ----------
#  - Ops are stored on disk under /data (the volume). Back it up by snapshotting
#    the volume or in Lightsail container: dashboard → Deployments → Data snapshots.
#  - The token protects writes/reads; without it anyone can pull your ops.
#  - The relay is stateless-ish: the node servers you skip offline merge on next push.
#
#  Cost: 2U/512MB container ≈ $5–7/mo. Dev-free alternative: run ROUTE 2 on a
#  free-tier t2.micro Lightsail (3.5/mo) or a free EC2 micro for a year.