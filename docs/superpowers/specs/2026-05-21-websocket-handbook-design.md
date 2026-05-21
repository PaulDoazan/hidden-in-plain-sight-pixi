# Handbook WebSockets + Architecture AWS — Design Spec

**Date** : 2026-05-21
**Auteur** : Paul (avec Claude)
**Status** : Draft — en attente de relecture utilisateur

## 1. Objectif

Produire un handbook pédagogique, imprimable en PDF, qui explique de manière complète :

1. **Comment fonctionnent les WebSockets** implémentés avec NestJS dans le projet _Hidden in Plain Sight_ (Phase 2 multijoueur).
2. **Comment un clic dans le navigateur traverse toute l'infrastructure** (Cloudflare, S3, EC2, Caddy, Docker, NestJS) avant de revenir à l'écran.

Le document doit pouvoir être relu dans 6 mois (ou par un Paul qui découvrirait le projet) et reconstruire la totalité du modèle mental nécessaire.

## 2. Audience et ton

- **Cible** : Paul lui-même, en mode apprentissage actif. Niveau pédagogique élevé : on ne suppose pas la maîtrise des concepts WebSocket, NestJS Gateway, Socket.IO, reverse proxy.
- **Ton** : tutoiement, première personne du pluriel ("on va voir…"), analogies vie courante quand utile.
- **Langue** : français.

## 3. Périmètre

### Inclus

- Concepts WebSocket (handshake HTTP → upgrade, frames, persistance) — niveau intermédiaire, avec un chapitre "pour aller plus loin" optionnel.
- Socket.IO en tant qu'abstraction au-dessus de WebSocket brut (rooms, reconnexion, fallback long-polling).
- NestJS WebSocket Gateway : décorateurs, hooks de cycle de vie, dépendance injection vers les services métier.
- Le code projet annoté : `game.gateway.ts`, `game-room.service.ts`, `room-registry.service.ts`.
- **Les 9 flux de jeu** en diagrammes de séquence : connexion, création/join room, lancement, input joueur, tick serveur, collision, fin de partie, déconnexion brutale, cycle de vie global.
- L'architecture AWS du projet : DNS Cloudflare, S3 (client statique), EC2 (serveur), Caddy (reverse proxy + TLS), Docker (conteneur NestJS).
- Le flux end-to-end "clic → écran" en 3 phases : charger le jeu, connecter le WebSocket, jouer une partie.
- Le pipeline de déploiement actuel (résumé, pas un tutoriel).

### Exclu (YAGNI)

- Versions multilingues.
- Version interactive / playground en ligne.
- Quiz, exercices, autoévaluations.
- Couverture des évolutions futures (auth, DB, leaderboard).
- Comparaisons approfondies avec d'autres technologies (Pusher, Ably, raw WebSocket sans Socket.IO, etc.). Mention rapide en intro du Ch.2 seulement.
- Captures d'écran (les schémas Mermaid suffisent).

## 4. Structure du document

Un seul document en deux parties, avec table des matières en haut.

### Partie 1 — Les WebSockets dans NestJS

| Chapitre | Titre                                                     | Pages estimées |
| -------- | --------------------------------------------------------- | -------------- |
| 1        | Pourquoi des WebSockets ?                                 | 3-4            |
| 2        | Anatomie d'une connexion WebSocket (niveau intermédiaire) | 5-6            |
| 3        | Pour aller plus loin : le protocole en profondeur         | 3-4            |
| 4        | NestJS Gateway : la théorie                               | 4-5            |
| 5        | Notre Gateway : `game.gateway.ts` ligne par ligne         | 5-6            |
| 6        | Les services métier : `RoomRegistry` et `GameRoom`        | 4-5            |
| 7        | Les 9 flux du jeu en diagrammes de séquence               | 10-12          |

**Détail du chapitre 7** :

- 7.1 Connexion d'un client (handshake + arrivée dans le gateway)
- 7.2 Création / rejoindre une room (room code)
- 7.3 Lancement de partie (synchronisation du state initial)
- 7.4 Input joueur (clic souris → tir → diffusion)
- 7.5 Boucle de tick serveur (mise à jour state → broadcast)
- 7.6 Détection de collision (qui calcule quoi, serveur vs client)
- 7.7 Fin de partie (condition de victoire, broadcast end)
- 7.8 Déconnexion brutale d'un joueur (cleanup, conséquences sur la room)
- 7.9 Cycle de vie complet d'une partie (vue d'ensemble synthétique)

### Partie 2 — Du clic à l'écran : voyage end-to-end

| Chapitre | Titre                                                         | Pages estimées |
| -------- | ------------------------------------------------------------- | -------------- |
| 8        | Vue d'avion : l'architecture complète                         | 2-3            |
| 9        | Phase 1 : charger le jeu (DNS → Cloudflare → S3)              | 4-5            |
| 10       | Phase 2 : connecter le WebSocket (DNS → EC2 → Caddy → Docker) | 5-6            |
| 11       | Phase 3 : jouer une partie (aller-retour d'un événement)      | 3-4            |
| 12       | Le déploiement, vu rapidement                                 | 3-4            |
| 13       | Annexes (glossaire + liens)                                   | 2-3            |

**Volume total estimé** : 55-65 pages PDF.

## 5. Architecture AWS de référence (source de vérité pour la Partie 2)

Synthèse de ce qui doit être documenté de manière exacte :

| Composant                 | Réalité du projet                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------- | ---- | ----- |
| Registrar + DNS + CDN     | **Cloudflare** (pas Route 53, pas CloudFront)                                                |
| Client statique           | Bucket S3 `game.marche-ou-creve.com`, région `eu-west-3`, static website hosting (HTTP-only) |
| Cloudflare pour le client | Proxy activé (orange), SSL mode "Flexible"                                                   |
| Serveur                   | EC2 t3.micro Ubuntu 24.04, EIP `15.237.242.223`, SG `sg-0c568554a02091eb2`                   |
| Reverse proxy             | Caddy v2.11.3 installé en natif sur l'EC2, TLS auto via Let's Encrypt                        |
| Cloudflare pour l'API     | DNS only (gris) — la requête atteint directement l'EIP, c'est Caddy qui termine TLS          |
| Application               | Container Docker bindé sur `127.0.0.1:3000:3000`, image push-pull manuel (`docker save       | gzip | scp`) |
| Reverse proxy → app       | Caddy `reverse_proxy localhost:3000`, gestion automatique de l'upgrade WebSocket             |

Détail crucial à expliquer : le mix Cloudflare proxy ON pour le client + DNS only pour l'API est précisément ce qui rend les WebSockets fonctionnels sans configuration spéciale.

## 6. Choix techniques de rendu

### Stack

- **Source** : `docs/handbook-websockets/handbook.md` — un seul fichier Markdown maître, versionnable.
- **Rendu HTML** : script `scripts/build-handbook.sh` qui :
  1. Convertit le Markdown en HTML via `markdown-it` + `markdown-it-anchor`.
  2. Injecte un `<style>` print-ready (typo lisible, sauts de page propres, pas de coupe au milieu d'un diagramme).
  3. Injecte la lib Mermaid en CDN qui rendra les diagrammes côté client à l'ouverture.
- **Sortie** : `docs/handbook-websockets/handbook.html` — un fichier autonome (sauf le CDN Mermaid).
- **PDF** : ouvert dans Chrome → Cmd+P → "Save as PDF". Pas d'outil tiers à installer.

### Diagrammes

- `flowchart LR` ou `flowchart TD` pour l'architecture.
- `sequenceDiagram` pour les 9 flux du jeu et le handshake WebSocket.
- `stateDiagram-v2` pour le cycle de vie d'une partie (Ch. 7.9).

### Engagement de simplicité

- Pas de framework de doc (Docusaurus, MkDocs, etc.) — le livrable est statique, pas un site.
- Pas de pipeline complexe — un script bash + ~2 dépendances npm max.
- Tout local, à part le CDN Mermaid (vendorisation possible plus tard).

### Structure de fichiers

```
docs/handbook-websockets/
├── handbook.md           ← source de vérité
├── handbook.html         ← généré, ouvert dans le navigateur
├── styles/
│   └── print.css         ← styles d'impression
└── README.md             ← comment régénérer et imprimer
scripts/
└── build-handbook.sh     ← commande unique
```

## 7. Stratégie de production du contenu

### Principe

Lire le code avant d'écrire chaque chapitre qui s'y rapporte. Pas de paraphrase de mémoire. Chaque extrait de code cité doit être vérifié contre le fichier source au moment de l'écriture.

### Ordre d'écriture

1. **Squelette** : `handbook.md` avec titres, table des matières, placeholders Mermaid. Vérification du pipeline de rendu (un Mermaid test, impression PDF Chrome contrôlée).
2. **Partie 1 — Ch. 1 à 4** : la théorie. Pas de lecture de code projet nécessaire.
3. **Partie 1 — Ch. 5 et 6** : lecture annotée. Relecture intégrale de `game.gateway.ts`, `game-room.service.ts`, `room-registry.service.ts` avant écriture.
4. **Partie 1 — Ch. 7** : les 9 flux. Traçage du code client → serveur → broadcast → client pour chaque flux avant le diagramme.
5. **Partie 2 — Ch. 8 à 12** : l'infra. Source : `deployment-plan.md`, `Caddyfile`, `docker-compose.prod.yml`, mémoires projet.
6. **Annexes** : glossaire et liens, en collectant tous les termes apparus.

### Décisions transverses actées

- **Aucune capture d'écran**. Schémas Mermaid uniquement.
- **Extraits de code ciblés** (5-20 lignes max) avec lien `apps/server/src/game/game.gateway.ts:42` vers la ligne exacte.
- **Annotations dans le bloc de code** (`// 👉 ici on attache le client à la room`), pas dans des paragraphes séparés.
- **Ton** : tutoiement, première personne du pluriel, analogies.

## 8. Garanties de qualité

- **Test d'impression à l'étape 1** : générer un HTML test avec une page de contenu + un Mermaid, imprimer en PDF depuis Chrome, vérifier que le rendu est correct (pas de diagramme coupé, pas de fonte cassée) avant d'écrire la suite.
- **Vérification du code cité** : chaque extrait vérifié contre le fichier source au moment de l'écriture.
- **Pas de fiction technique** : si une réalité du code ne correspond pas à la spec, on s'arrête et on signale plutôt que d'écrire un truc inexact.

## 9. Critères d'acceptation

Le handbook est considéré comme livré lorsque :

1. `docs/handbook-websockets/handbook.md` existe et couvre les 13 chapitres prévus.
2. `docs/handbook-websockets/handbook.html` se génère sans erreur via le script de build.
3. L'ouverture dans Chrome affiche correctement tous les diagrammes Mermaid.
4. L'impression PDF (Cmd+P) produit un document propre, sans diagramme coupé.
5. Tous les extraits de code cités correspondent au code réel au moment de la livraison (vérification manuelle ligne par ligne).
6. Les 9 flux de jeu sont chacun accompagnés d'un diagramme de séquence Mermaid.
7. La Partie 2 reflète fidèlement l'architecture AWS décrite section 5.

## 10. Hors périmètre du présent design

La maintenance du handbook (mise à jour automatique quand le code change) n'est pas dans le périmètre. Le handbook est une photographie à date — si le code évolue significativement, il faudra prévoir une révision manuelle.
