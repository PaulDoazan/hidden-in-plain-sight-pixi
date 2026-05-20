# Plan de mise en production — AWS + Cloudflare

Guide de déploiement progressif pour _Hidden in Plain Sight_, conçu pour être suivi à raison d'une étape (~2h) par jour.

## Architecture cible

```
            ┌─────────────────────┐
            │     Cloudflare       │  ← DNS + CDN + TLS + DDoS (gratuit)
            └──────────┬──────────┘
                       │
        ┌──────────────┼──────────────┐
        │                              │
        ▼                              ▼
   game.marche-ou-creve.com           api.marche-ou-creve.com
   (client statique)            (WebSocket NestJS)
        │                              │
        ▼                              ▼
   ┌─────────┐                    ┌─────────┐
   │   S3    │                    │   EC2    │
   │ bucket  │                    │ t4g.nano │
   └─────────┘                    └─────────┘
                AWS                    AWS
```

## Coût mensuel estimé

| Phase                               | Coût   | Capacité                        |
| ----------------------------------- | ------ | ------------------------------- |
| Première année (free tier EC2)      | ~0–1 € | Toutes les features Phase A     |
| Steady state (après free tier)      | ~5–6 € | Jusqu'à ~50 joueurs concurrents |
| Phase B (upgrade t4g.small + Redis) | ~12 €  | ~100+ joueurs concurrents       |
| Phase C (HA, ALB + 2 EC2)           | ~30 €  | Haute disponibilité             |

---

## Plan d'exécution — 10 étapes

### J1 — Compte AWS + sécurité de base (~2h)

**Objectif** : avoir un compte AWS utilisable en sécurité, sans risque de facture surprise.

- [ ] Créer le compte AWS
- [ ] Activer MFA sur le compte root, puis ne plus l'utiliser
- [ ] Créer un user IAM `deploy` avec accès programmatique
- [ ] Attacher les policies nécessaires (S3, EC2, CloudWatch — pas AdministratorAccess en prod)
- [ ] Configurer un budget alert à 10 €/mois
- [ ] Installer l'AWS CLI en local et configurer le profil `deploy`
- [ ] Vérifier : `aws sts get-caller-identity` retourne l'user `deploy`

**Livrable** : credentials AWS fonctionnels en local, MFA actif, alerte de coût en place.

---

### J2 — Compte Cloudflare + achat domaine (~2h)

**Objectif** : posséder un domaine et avoir sa zone DNS pilotable via Cloudflare.

- [ ] Créer un compte Cloudflare
- [ ] Acheter un domaine via Cloudflare Registrar (prix coûtant), ou transférer depuis OVH/Gandi
- [ ] Vérifier que la zone DNS est active sur Cloudflare
- [ ] Ajouter un test DNS : `marche-ou-creve.com` → `192.0.2.1` (IP bidon), vérifier que `dig marche-ou-creve.com` répond
- [ ] Supprimer le test

**Livrable** : domaine acheté, zone DNS Cloudflare opérationnelle.

---

### J3 — Préparer le build de prod (variables d'env) (~2h)

**Objectif** : rendre le code déployable sans modifications manuelles. Tout passe par variables d'env.

- [x] Côté client : créer `apps/client/.env.production` avec `VITE_SERVER_URL=https://api.marche-ou-creve.com`
- [x] Côté serveur : extraire le `CORS_ORIGIN` codé en dur dans [main.ts:8](apps/server/src/main.ts#L8) et [game.gateway.ts:27](apps/server/src/game/game.gateway.ts#L27) en variable d'env (helper [config/cors-origin.ts](apps/server/src/config/cors-origin.ts))
- [x] Définir une convention : `CORS_ORIGIN` peut être une liste (`http://localhost:5173,https://game.marche-ou-creve.com`)
- [x] Tester `pnpm build` côté client → vérifier que `dist/` est généré
- [x] Tester `pnpm build` côté serveur → vérifier que `dist/main.js` est généré et démarre

**Livrable** : `pnpm build` produit des artifacts de prod, configurables par env vars.

---

### J4 — Déployer le client statique (S3 + Cloudflare) (~2h)

**Objectif** : ouvrir `https://game.marche-ou-creve.com` et voir la home du jeu.

- [x] Créer un bucket S3 — nommé `game.marche-ou-creve.com` (le nom DOIT matcher l'hôte pour que Cloudflare proxy → S3 fonctionne sans réécriture de Host header), région `eu-west-3`
- [x] Activer le mode "static website hosting" sur le bucket (index + error = `index.html` pour fallback SPA)
- [x] Bloc public access désactivé + bucket policy `s3:GetObject` public
- [x] Uploader `apps/client/dist/` vers S3 (via le script ci-dessous, cache-control par catégorie)
- [x] Dans Cloudflare DNS : ajouter `game` → CNAME vers `game.marche-ou-creve.com.s3-website.eu-west-3.amazonaws.com`, proxy activé (orange). **SSL mode = "Flexible"** (S3 website endpoint est HTTP-only)
- [x] Vérifier : `https://game.marche-ou-creve.com` affiche la home du jeu
- [x] Écrire un script [scripts/deploy-client.sh](scripts/deploy-client.sh) qui build + sync avec cache-control `immutable 1y` sur `/assets/*` et `no-cache` sur le reste

**Livrable** : client accessible en HTTPS sur le domaine custom, deploy en une commande.

---

### J5 — Provisionner l'EC2 + Docker + SSH (~2h)

**Objectif** : avoir une VM Ubuntu accessible en SSH avec Docker installé.

- [x] Lancer une EC2 t3.micro (free tier x86 imposé par le compte), Ubuntu 24.04 — `i-0d32301df74930fcd`, AMI `ami-030cfb51a08050cad`
- [x] Créer et télécharger une key pair dédiée — `marche-ou-creve-prod` (ed25519), stockée dans `~/.ssh/marche-ou-creve-prod.pem`
- [x] Configurer un security group `sg-0c568554a02091eb2` : SSH (22) depuis `92.184.98.0/24` (pool ISP, /32 ne tenait pas à cause du NAT port-dépendant), HTTP (80) et HTTPS (443) `0.0.0.0/0`
- [x] Attacher une IP elastic — `15.237.242.223` (`eipalloc-0b8743d544497f12d`)
- [x] Se connecter en SSH : `ssh -i ~/.ssh/marche-ou-creve-prod.pem ubuntu@15.237.242.223`
- [x] Installer Docker + plugin compose (`curl -fsSL https://get.docker.com | sudo sh`) — Docker 29.5.1, Compose v5.1.3
- [x] Ajouter `ubuntu` au groupe docker, vérifier avec `docker run --rm hello-world` (sans sudo)

**Livrable** : EC2 accessible en SSH, Docker fonctionnel.

---

### J6 — Déployer le serveur NestJS dans Docker (~2h)

**Objectif** : faire tourner le serveur sur l'EC2, accessible en local sur le port 3000.

- [x] Build de l'image Docker en local — `docker buildx build --platform linux/amd64 --target prod -t marche-ou-creve-server:j6 -f apps/server/Dockerfile --load .` (mac arm64 → x86 forcé pour t3.micro). Dockerfile amendé pour builder `@hips/shared` d'abord et copier `apps/server/node_modules` (résolution pnpm workspace).
- [x] `docker save | gzip` + `scp` l'image vers `~/app/` sur l'EC2 (~84 MB compressé)
- [x] `docker-compose.prod.yml` commit dans le repo, scp vers EC2 — vars: `NODE_ENV=production`, `PORT=3000`, `CORS_ORIGIN=https://game.marche-ou-creve.com`. Bind `127.0.0.1:3000:3000` (pas `0.0.0.0`) car Caddy en local sur l'EC2 à J7. Log rotation: 10 MB × 3 fichiers.
- [x] Lancer : `IMAGE_TAG=j6 docker compose -f docker-compose.prod.yml up -d` → container `Up`
- [x] Vérifier : `curl http://localhost:3000/` depuis l'EC2 → HTTP 200
- [x] `restart: unless-stopped` dans le compose (le container redémarrera automatiquement au reboot de l'EC2)

**Livrable** : serveur Node tourne en background sur l'EC2, redémarre automatiquement.

---

### J7 — Caddy + TLS + DNS (~2h)

**Objectif** : `api.marche-ou-creve.com` est joignable en HTTPS et le jeu est jouable de bout en bout.

- [ ] Installer Caddy sur l'EC2 (`sudo apt install caddy`)
- [ ] Écrire un `/etc/caddy/Caddyfile` minimal :
  ```
  api.marche-ou-creve.com {
      reverse_proxy localhost:3000
  }
  ```
- [ ] Dans Cloudflare DNS : ajouter `api` → A record vers l'IP elastic, **proxy désactivé** (cloud gris) pour laisser Caddy gérer le certificat directement avec Let's Encrypt
- [ ] Démarrer Caddy : `sudo systemctl enable --now caddy`
- [ ] Vérifier : `curl https://api.marche-ou-creve.com` retourne du contenu
- [ ] Ouvrir `https://game.marche-ou-creve.com` dans un navigateur, créer une room, vérifier que le WebSocket se connecte
- [ ] (Optionnel) une fois validé, réactiver le proxy Cloudflare et passer en mode SSL "Full strict"

**Livrable** : jeu jouable en multi de bout en bout sur le domaine prod.

---

### J8 — CI/CD GitHub Actions (~2h)

**Objectif** : push sur `main` déclenche un déploiement automatique.

- [ ] Créer les secrets GitHub Actions : `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EC2_SSH_KEY`, `EC2_HOST`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`
- [ ] Workflow `.github/workflows/deploy-client.yml` : build client → `aws s3 sync` → purge cache Cloudflare via API
- [ ] Workflow `.github/workflows/deploy-server.yml` : build image Docker → push vers GHCR → SSH sur l'EC2 → `docker pull` + `docker compose up -d`
- [ ] Tester chaque workflow avec un commit trivial
- [ ] Documenter le process de rollback (re-run du workflow sur un commit précédent)

**Livrable** : pipeline CI/CD complet, plus aucun deploy manuel.

---

### J9 — Monitoring + logs + hardening (~2h)

**Objectif** : être alerté si le serveur tombe, pouvoir investiguer les bugs en prod.

- [ ] Logs : vérifier que `docker compose logs` capture tout, configurer la rotation
- [ ] Uptime monitoring : créer un check UptimeRobot (gratuit) sur `https://api.marche-ou-creve.com/health` (créer l'endpoint si pas existant)
- [ ] Alertes email/Discord depuis UptimeRobot
- [ ] Hardening SSH : désactiver `PasswordAuthentication`, n'autoriser que les clés
- [ ] Installer `unattended-upgrades` pour les mises à jour de sécurité automatiques
- [ ] Installer `fail2ban` pour bloquer les tentatives de bruteforce SSH
- [ ] Vérifier les security groups : 22 fermé sauf depuis ton IP

**Livrable** : prod observable et durcie.

---

### J10 — Backup + plan de reprise (optionnel mais recommandé) (~2h)

**Objectif** : pouvoir tout redéployer en 1h si l'EC2 explose.

- [ ] Configurer des snapshots EBS automatiques (Data Lifecycle Manager AWS), 1 par semaine, rétention 4 semaines
- [ ] Documenter dans `docs/disaster-recovery.md` :
  - Comment relancer une EC2 depuis un snapshot
  - Comment redéployer from scratch (IaC manuelle suffit pour ce projet)
  - Liste des secrets à recharger
- [ ] Tester une fois : créer une 2e EC2 depuis un snapshot, vérifier qu'elle démarre

**Livrable** : tu dors mieux la nuit.

---

## Bonnes pratiques d'architecture à appliquer pendant le déploiement

Pour préparer l'ajout futur d'auth, DB, leaderboard (~1 semaine de travail), 4 ajustements à faire pendant J3 (~2h supplémentaires) :

1. **Externaliser les variables d'env** (déjà prévu J3)
2. **Préparer un `DatabaseModule` vide** dans NestJS pour forcer l'architecture en couches
3. **Séparer `GameRoomService` (état RAM) de `GameHistoryService` (futur, persistance)**
4. **Ne pas hardcoder `socket.id` comme identité du joueur** — introduire un `playerId` que tu pourras un jour remplacer par un `userId` issu d'un JWT

## Évolutions prévisibles

| Feature                      | Effort    | Impact infra                         |
| ---------------------------- | --------- | ------------------------------------ |
| Auth (email/password, OAuth) | 1–2 jours | Aucun                                |
| API REST profil/historique   | 1 jour    | Aucun (même process NestJS)          |
| Persistance (DB)             | 1 jour    | Ajouter Neon ou Supabase (free tier) |
| Leaderboard                  | 1 jour    | Requête SQL + cache 1 min            |

**Important** : ne **pas** mettre Postgres sur la même EC2 t4g.nano. Externaliser dès le début via Neon, Supabase ou Turso.

## Liens utiles

- [Console AWS](https://console.aws.amazon.com/)
- [Dashboard Cloudflare](https://dash.cloudflare.com/)
- [Documentation Caddy](https://caddyserver.com/docs/)
- [GitHub Actions for AWS](https://github.com/aws-actions/configure-aws-credentials)
- [Neon (Postgres serverless)](https://neon.tech/)
