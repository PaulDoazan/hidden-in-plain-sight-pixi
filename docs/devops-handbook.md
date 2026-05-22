# Manuel DevOps — déploiement de _Hidden in Plain Sight_

> Document pédagogique exhaustif couvrant les étapes J1 à J7 de [deployment-plan.md](deployment-plan.md).
> Public visé : développeur fluent en code, débutant en infrastructure.
> Approche : tout expliquer en partant de zéro, avec analogies côté dev.

---

## Table des matières

1. [Introduction : qu'est-ce que « déployer » ?](#1-introduction)
2. [Concepts fondamentaux](#2-concepts-fondamentaux)
   - 2.1 [Le modèle client-serveur](#21-le-modèle-client-serveur)
   - 2.2 [IP, port, protocole](#22-ip-port-protocole)
   - 2.3 [DNS : du nom au numéro](#23-dns)
   - 2.4 [HTTP, HTTPS, TLS](#24-http-https-tls)
   - 2.5 [Système d'exploitation et Linux](#25-os-et-linux)
   - 2.6 [SSH : contrôler une machine à distance](#26-ssh)
   - 2.7 [Machines virtuelles, containers, images](#27-vm-container-image)
   - 2.8 [Firewall, security group](#28-firewall)
   - 2.9 [Processus et daemon](#29-processus-et-daemon)
   - 2.10 [Proxies (forward et reverse)](#210-proxies)
3. [Architecture cible](#3-architecture-cible)
4. [Les outils utilisés](#4-les-outils)
   - 4.1 [AWS](#41-aws)
   - 4.2 [Cloudflare](#42-cloudflare)
   - 4.3 [Docker](#43-docker)
   - 4.4 [Caddy](#44-caddy)
   - 4.5 [Outils annexes (apt, systemd, scp, gpg)](#45-outils-annexes)
5. [J1 — Compte AWS + sécurité de base](#5-j1)
6. [J2 — Cloudflare + achat domaine](#6-j2)
7. [J3 — Variables d'environnement](#7-j3)
8. [J4 — Client statique sur S3](#8-j4)
9. [J5 — Provisionner l'EC2 + Docker + SSH](#9-j5)
10. [J6 — Serveur NestJS dans Docker](#10-j6)
11. [J7 — Caddy + TLS + DNS](#11-j7)
12. [Annexes](#12-annexes)
    - A. [Glossaire](#a-glossaire)
    - B. [Commandes utiles au quotidien](#b-commandes-utiles)
    - C. [Comment debugger quand ça casse](#c-debugger)
    - D. [Coûts mensuels détaillés](#d-coûts)

---

## 1. Introduction

### 1.1 Qu'est-ce que « déployer » ?

En dev local, ton code tourne sur ta machine (`pnpm dev`), tu y accèdes via `http://localhost:5173`, et seul toi peux le voir.

**Déployer**, c'est rendre ce code accessible depuis n'importe quel navigateur dans le monde, à une adresse stable (`https://game.marche-ou-creve.com`), en continu, sans que ta machine soit allumée. Ça implique :

1. **Une (ou plusieurs) machine(s) distante(s)** qui tournent 24/7 et exécutent le code.
2. **Une adresse stable** pour les joindre (nom de domaine + adresse IP).
3. **De la sécurité** : HTTPS (chiffrement), restrictions d'accès, sauvegardes.
4. **De l'automatisation** : pour ne pas refaire tous les gestes à la main à chaque update.

### 1.2 Pourquoi c'est « plus dur » que le dev

En dev local, tu as un seul environnement (le tien), un seul utilisateur (toi), une seule machine. En prod tu as :

- Plusieurs **machines** qui doivent communiquer (DNS, IP, ports).
- Plusieurs **utilisateurs simultanés** (concurrence, scaling).
- Des **acteurs hostiles** (scanners de ports, bots qui tentent de SSH, requêtes malveillantes).
- Des **erreurs invisibles** (le serveur plante à 3h du matin, personne ne le voit sauf le monitoring).
- Du **multi-tenant** : ton compte AWS, ton domaine, tes credentials — tout doit être bien rangé et sécurisé.

L'analogie avec le dev : c'est comme passer d'un script qui tourne dans un terminal à une bibliothèque utilisée par des milliers de devs. Les contraintes deviennent **opérationnelles** et **sécuritaires** en plus d'être fonctionnelles.

### 1.3 Vocabulaire métier

- **DevOps** : la culture (et les outils) qui fusionnent le développement et l'opérationnel. Au lieu d'avoir « les devs qui écrivent le code » et « les ops qui le font tourner », tout le monde est responsable du cycle complet.
- **SRE** (Site Reliability Engineering) : sous-discipline qui se concentre sur la fiabilité (uptime, SLO).
- **IaC** (Infrastructure as Code) : décrire l'infra dans des fichiers texte versionnés (Terraform, CloudFormation, Pulumi). On y vient à J8.
- **CI/CD** : Continuous Integration / Continuous Deployment. Pipeline automatique : `git push` → tests → build → déploiement.

---

## 2. Concepts fondamentaux

### 2.1 Le modèle client-serveur

```
   ┌──────────┐    requête HTTP    ┌──────────┐
   │  Client  │ ────────────────▶ │  Serveur │
   │ (navig.) │                    │ (NestJS) │
   │          │ ◀───────────────── │          │
   └──────────┘    réponse HTTP    └──────────┘
```

- **Client** : programme qui initie la conversation. Pour nous, le navigateur web qui charge `https://game.marche-ou-creve.com`.
- **Serveur** : programme qui attend les connexions, traite les requêtes, répond. Pour nous, le serveur NestJS qui tourne sur l'EC2.

Le serveur **écoute** sur une adresse + un port (`0.0.0.0:3000` par exemple). Le client se **connecte** à cette adresse. Côté code, c'est le `app.listen(3000)` de NestJS.

Note : un même processus peut être **les deux**. Quand ton serveur appelle l'API de Stripe, il devient client de Stripe.

### 2.2 IP, port, protocole

Chaque machine connectée à internet a (au moins) **une adresse IP**. C'est l'équivalent d'une adresse postale.

- **IPv4** : 4 nombres entre 0 et 255, séparés par des points. Exemple : `15.237.242.223` (notre EC2). Il y a 4 milliards d'IPv4 possibles, donc on en manque depuis ~10 ans.
- **IPv6** : format plus long (8 groupes hexadécimaux). Exemple : `2001:db8::1`. Solution à la pénurie d'IPv4, déploiement progressif.

**Port** : sur une même machine, plusieurs programmes peuvent écouter. Le port identifie lequel. C'est l'équivalent du numéro d'appartement à une adresse.

- Port `22` : SSH (par convention)
- Port `80` : HTTP
- Port `443` : HTTPS
- Port `3000` : convention Node.js dev (mais arbitraire)
- Port `5173` : convention Vite (mais arbitraire)

Une **socket** est l'objet qui combine `IP + port + protocole`. Quand ton serveur fait `app.listen(3000)`, il crée une socket d'écoute sur `0.0.0.0:3000/tcp`.

**Protocole** : les règles de la conversation. Les deux principaux pour le web :

- **TCP** (Transmission Control Protocol) : connexion fiable, ordonnée, vérifiée. Utilisé par HTTP, SSH, WebSocket. Si un paquet se perd, TCP le retransmet.
- **UDP** (User Datagram Protocol) : pas de connexion, pas de garantie. Utilisé par DNS (requêtes simples), jeux vidéo temps réel, vidéo en direct.

Pour nous, **tout est TCP** : HTTP, WebSocket (Socket.IO), SSH.

```
              ┌─────────────────────────────┐
              │     Machine EC2             │
              │     IP: 15.237.242.223      │
              │                              │
              │  ┌──────┐  ┌──────┐  ┌────┐ │
              │  │ :22  │  │ :80  │  │... │ │
              │  │ ssh  │  │ caddy│  │    │ │
              │  └──────┘  └──────┘  └────┘ │
              │                              │
              │  ┌─────────────┐             │
              │  │ :3000       │             │
              │  │ nest container             │
              │  └─────────────┘             │
              └─────────────────────────────┘
```

### 2.3 DNS

**Problème** : les humains se souviennent mal des chiffres (`15.237.242.223`), mieux des noms (`api.marche-ou-creve.com`).

**Solution** : le DNS (Domain Name System) est un annuaire géant, distribué, qui associe les noms aux IPs.

```
   navigateur                    DNS resolver               serveur DNS
   "api.marche-ou-creve.com ?"   ─────────────────────▶
                                              ◀───────── "c'est 15.237.242.223"
       ◀───── "15.237.242.223"
```

Le DNS est **hiérarchique** :

```
                         . (root)
                        /  |  \
                      com  fr  org   ...
                      /
            marche-ou-creve.com   (notre zone)
                /    |
               api  game         (sous-domaines / records)
```

Quand un navigateur demande `api.marche-ou-creve.com`, ce qui se passe (simplifié) :

1. Il demande à son DNS resolver local (souvent celui de la box ou de l'OS).
2. Le resolver demande aux serveurs racines : « qui gère `.com` ? »
3. Les racines répondent : « les serveurs de Verisign ».
4. On demande à Verisign : « qui gère `marche-ou-creve.com` ? »
5. Verisign répond : « Cloudflare, serveurs `ace.ns.cloudflare.com` et `mona.ns.cloudflare.com` ».
6. On demande à Cloudflare : « c'est quoi l'IP de `api.marche-ou-creve.com` ? »
7. Cloudflare répond : `15.237.242.223`.

#### Types d'enregistrements DNS

- **A** : nom → IPv4. Exemple : `api.marche-ou-creve.com A 15.237.242.223`.
- **AAAA** : nom → IPv6.
- **CNAME** : nom → autre nom (alias). Exemple : `game.marche-ou-creve.com CNAME game.marche-ou-creve.com.s3-website.eu-west-3.amazonaws.com`.
- **MX** : pour les emails (où envoyer le courrier).
- **TXT** : texte libre, souvent pour vérifier la propriété d'un domaine ou les politiques SPF/DKIM (anti-spam mail).
- **NS** : qui gère cette zone. Exemple : `marche-ou-creve.com NS ace.ns.cloudflare.com`.

**TTL** (Time To Live) : durée pendant laquelle les resolvers peuvent garder la réponse en cache. Par défaut quelques minutes à quelques heures. Quand tu changes un record, les caches mettent ce temps à expirer.

**Analogie dev** : le DNS, c'est un service de résolution comme un import map ou un service registry. `import foo from 'lodash'` → le bundler regarde dans `node_modules/` quelle version résoudre. Le DNS fait pareil mais avec des noms d'hôte vers des IPs.

### 2.4 HTTP, HTTPS, TLS

#### HTTP

HTTP (HyperText Transfer Protocol) est le langage que parlent les navigateurs et les serveurs web. C'est du texte lisible :

```
GET /api/users/42 HTTP/1.1
Host: api.marche-ou-creve.com
User-Agent: Mozilla/5.0...
Accept: application/json

```

Réponse :

```
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 27

{"id": 42, "name": "Paul"}
```

Méthodes HTTP : `GET` (lire), `POST` (créer), `PUT/PATCH` (modifier), `DELETE` (supprimer), `OPTIONS` (négociation CORS). Tu connais déjà.

**Codes de status** :

- `1xx` : info (rare)
- `2xx` : succès. `200 OK`, `201 Created`, `204 No Content`.
- `3xx` : redirection. `301 Moved Permanently`, `302 Found`, `308 Permanent Redirect`.
- `4xx` : erreur côté client. `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `429 Too Many Requests`.
- `5xx` : erreur côté serveur. `500 Internal Server Error`, `502 Bad Gateway`, `503 Service Unavailable`.

#### HTTPS et TLS

HTTP en clair est lisible par n'importe quel intermédiaire (FAI, wifi public, gouvernement). C'est inacceptable pour des mots de passe, des cookies, des données personnelles.

**HTTPS** = HTTP **sur TLS**.

**TLS** (Transport Layer Security, anciennement SSL) chiffre la connexion. Trois propriétés :

1. **Confidentialité** : personne entre client et serveur ne peut lire.
2. **Intégrité** : personne ne peut modifier les paquets sans qu'on s'en aperçoive.
3. **Authentification** : tu es sûr de parler au bon serveur (pas à un imposteur).

L'authentification repose sur les **certificats** : un fichier signé par une autorité de certification (CA) reconnue, qui prouve que `api.marche-ou-creve.com` est bien le serveur que tu veux atteindre.

**Comment un certif est obtenu** :

1. Le serveur génère une paire de clés (publique + privée) et un CSR (Certificate Signing Request).
2. Il envoie le CSR à une CA (Let's Encrypt, DigiCert, etc.).
3. La CA demande au serveur de prouver qu'il contrôle bien le domaine (challenge HTTP-01 ou DNS-01).
4. Si OK, la CA renvoie un certificat signé valable ~3 mois (Let's Encrypt) à 1-2 ans (CAs payantes).
5. Le serveur le présente aux clients qui se connectent.

**Challenge HTTP-01** (utilisé par Caddy à J7) : la CA dit « mets un fichier à `http://api.marche-ou-creve.com/.well-known/acme-challenge/<token>` ». La CA le télécharge. Si le contenu match → tu prouves que tu contrôles le domaine.

**Le navigateur valide la chaîne de confiance** : il a une liste de CAs reconnues (Mozilla, Google, Apple les pré-installent). Le certif Let's Encrypt est signé par une CA root reconnue → cadenas vert.

#### WebSocket

HTTP est par défaut **requête/réponse, déconnecté**. Tu envoies une requête, tu reçois une réponse, c'est fini. Pas adapté pour du temps réel (chat, jeu multi).

**WebSocket** est un protocole qui **upgrade** une connexion HTTP en une connexion bidirectionnelle persistante :

```
Client : GET /socket HTTP/1.1
         Upgrade: websocket
         Connection: Upgrade
         Sec-WebSocket-Key: ...

Serveur: HTTP/1.1 101 Switching Protocols
         Upgrade: websocket
         Connection: Upgrade
         Sec-WebSocket-Accept: ...

[ensuite, frames binaires/texte dans les deux sens, tant que la connexion tient]
```

C'est ce que `socket.io` utilise pour le jeu multi.

### 2.5 OS et Linux

**Système d'exploitation** (OS) : le programme qui gère le hardware (CPU, RAM, disque, réseau) et expose des APIs aux applications. Sur ton Mac c'est macOS, sur l'EC2 c'est **Ubuntu 24.04 (Linux)**.

**Linux** : une famille de systèmes. Le « noyau » (kernel) Linux est le cœur, autour duquel sont assemblées des distributions (Ubuntu, Debian, RHEL, Alpine...) qui ajoutent des outils, un installeur, etc.

**Pourquoi Linux en serveur ?**

- Gratuit, open source.
- Très léger (notre EC2 t3.micro a 1 vCPU et 1 GB RAM, ça suffit).
- Stable, conçu pour tourner des années sans reboot.
- Outils en ligne de commande très matures.
- Toute la doc en ligne (Stack Overflow, etc.) suppose Linux.

#### Utilisateurs et permissions Linux

Linux est multi-utilisateurs depuis 1970. Chaque fichier appartient à un user + un group, avec des permissions (read/write/execute) pour : propriétaire, groupe, autres.

```
$ ls -la
-rw-r--r-- 1 ubuntu ubuntu  411 Mar 1 10:00 id_ed25519
^                  ^      ^
permissions     owner  group
```

- `rw-r--r--` = owner peut read/write, group et autres peuvent juste read.
- Forme numérique : `644` = `rw-r--r--`. Un peu comme du binaire encodé en octal.
- `600` = `rw-------` = owner uniquement (utilisé pour les clés privées SSH).

**root** : l'utilisateur tout-puissant (équivalent Administrator sur Windows). Il peut tout faire sur la machine. On ne se connecte **jamais** directement en root sur Linux ; on utilise `sudo` pour temporairement obtenir les droits root le temps d'une commande.

**Analogie dev** : `root` est comme un compte avec `AdministratorAccess` sur AWS. Tu ne l'utilises que pour ce qui le requiert vraiment, sinon tu utilises un compte avec moins de droits.

#### Arborescence Linux

```
/                  racine
├── home/          dossiers utilisateurs (équiv. /Users sur Mac)
│   └── ubuntu/    notre user sur l'EC2
├── etc/           configurations système (/etc/caddy/Caddyfile, /etc/ssh/sshd_config)
├── var/           données variables (logs, caches)
│   └── log/       fichiers de log
├── usr/           binaires utilisateur (programmes installés)
├── tmp/           fichiers temporaires (vidé au reboot)
└── root/          dossier home du user root
```

### 2.6 SSH

**SSH** (Secure Shell) : protocole pour ouvrir une session shell **distante** chiffrée. Tu tapes dans ton terminal local, ça s'exécute sur la machine distante.

```
[ ton Mac ] ─── connexion SSH chiffrée (TCP/22) ───▶ [ EC2 ubuntu user ]
   $ ssh ubuntu@15.237.242.223
                                                    $ uname -a
                                                    Linux ip-172-31-36-144 ...
```

#### Authentification par clé publique

Tu ne te connectes pas avec un mot de passe (trop facile à brute-forcer), mais avec une **clé cryptographique** :

1. Tu génères une **paire de clés** : `id_ed25519` (privée, secrète) + `id_ed25519.pub` (publique, partageable).
2. Tu mets la **clé publique** sur le serveur dans `~/.ssh/authorized_keys`.
3. Tu gardes la **clé privée** sur ta machine, en `600` (lisible uniquement par toi).
4. À la connexion, le serveur défie : « prouve-moi que tu as la clé privée correspondante ». Tu signes un nonce avec la privée, le serveur vérifie avec la publique. Si OK → tu rentres.

**Analogie dev** : comme une signature JWT asymétrique. La clé privée signe, la clé publique vérifie. Personne ne peut signer à ta place sans la privée.

**Types de clés** :

- `RSA` : ancien, large (2048 ou 4096 bits), compatible partout.
- `ED25519` : moderne, court (~256 bits), plus rapide, plus sûr. Notre choix.

**scp** : SCP (Secure Copy Protocol) = `cp` distant via SSH. Pour copier des fichiers entre machines.

```bash
scp -i ~/.ssh/marche-ou-creve-prod.pem fichier.tar ubuntu@15.237.242.223:~/app/
#       └─ identité (clé privée)           └─ source     └─ destination
```

### 2.7 VM, container, image

#### Machine virtuelle (VM)

Une VM est un **ordinateur entier émulé dans un autre ordinateur**. Sur un serveur physique chez AWS (avec 96 CPUs et 768 GB RAM), AWS découpe et te vend des « morceaux virtuels » :

- t3.micro = 2 vCPU + 1 GB RAM + 12 GB disque
- t3.medium = 2 vCPU + 4 GB RAM
- m5.xlarge = 4 vCPU + 16 GB RAM
- etc.

Une VM a son **propre OS** (Ubuntu, dans notre cas), son propre kernel, ses propres processus, ses propres ressources. Tu te connectes en SSH comme si c'était une vraie machine physique.

```
        ┌─────────────────────────────────────┐
        │   Hardware AWS (m5.metal)            │
        │   192 vCPU, 768 GB RAM              │
        │                                      │
        │  ┌──────┐ ┌──────┐ ┌──────┐         │
        │  │ VM 1 │ │ VM 2 │ │ VM 3 │  ...    │
        │  │ Ubu  │ │ Ubu  │ │ Win  │         │
        │  └──────┘ └──────┘ └──────┘         │
        │      ^                               │
        │      └── notre EC2 t3.micro          │
        └─────────────────────────────────────┘
```

L'isolation est assurée par un **hyperviseur** (Xen, KVM, AWS Nitro). Une VM ne peut pas voir les autres.

#### Container

Une VM, c'est lourd : OS entier, ~100 MB de RAM juste pour booter, plusieurs secondes à démarrer.

Un **container** est un compromis : ce n'est pas un OS complet, c'est un **processus isolé** sur l'OS hôte. Il partage le kernel de la machine hôte, mais a ses propres fichiers, son propre réseau, ses propres processus visibles.

```
        ┌─────────────────────────────────────┐
        │   VM EC2 (Ubuntu 24.04)             │
        │                                      │
        │  ┌──────┐ ┌──────┐ ┌──────┐         │
        │  │cont 1│ │cont 2│ │cont 3│         │
        │  │node  │ │postgr│ │redis │         │
        │  └──────┘ └──────┘ └──────┘         │
        │   shared kernel: Linux              │
        └─────────────────────────────────────┘
```

Avantages :

- **Léger** : démarre en ~100 ms, prend quelques MB.
- **Reproductible** : tu décris le container une fois, il tourne pareil partout (ton Mac, l'EC2, GitHub Actions).
- **Isolé** : un container ne voit pas les autres, pas le système hôte.

Inconvénient : moins isolé qu'une VM (même kernel). Pour des charges « multi-tenant hostiles », on préfère VM.

#### Image

Une **image** = un fichier compressé qui contient tout ce dont un container a besoin pour démarrer : binaires, libs, fichiers de config.

Une **image** est le « modèle » (comme une `class` en POO), un **container** est une instance qui tourne (comme un `new MyClass()`).

```
   docker build → produit l'image (artefact statique)
   docker run   → lance un container depuis l'image (processus vivant)
```

Une image Docker est composée de **layers** empilés. Chaque instruction du Dockerfile crée un layer. Les layers sont cachés et réutilisables : si tu changes ton code mais pas tes dépendances, le layer « install dependencies » est réutilisé du build précédent.

```
   ┌─────────────────────────┐
   │  layer: CMD ["node",...]│  <- très petit
   ├─────────────────────────┤
   │  layer: COPY dist       │  <- ~1 MB
   ├─────────────────────────┤
   │  layer: COPY node_mod   │  <- ~80 MB (cached souvent)
   ├─────────────────────────┤
   │  layer: node:22-alpine  │  <- ~50 MB (cached toujours)
   └─────────────────────────┘
        empilés = image finale
```

### 2.8 Firewall

Un **firewall** est un filtre réseau qui décide quels paquets passent ou pas, basé sur des règles : IP source, IP destination, port, protocole.

Sur AWS, le firewall s'appelle **Security Group**. C'est un firewall **stateful** : si tu autorises une connexion entrante, la réponse sortante est automatiquement autorisée. Tu n'as à gérer que les règles « inbound » (ingress) pour la plupart des cas.

Notre SG `sg-0c568554a02091eb2` a 3 règles inbound :

```
   protocole | port | source             | usage
   ─────────────────────────────────────────────────
   TCP       | 22   | 92.184.98.0/24    | SSH (toi seulement)
   TCP       | 80   | 0.0.0.0/0         | HTTP (tout le monde, pour LE)
   TCP       | 443  | 0.0.0.0/0         | HTTPS (tout le monde)
```

`0.0.0.0/0` veut dire « toutes les IPs ». Le `/0` est un masque CIDR : 0 bits fixes → toutes les valeurs autorisées. `92.184.98.0/24` veut dire « les 256 IPs allant de `92.184.98.0` à `92.184.98.255` ».

**Analogie dev** : c'est une whitelist applicative, comme du `if (allowedOrigins.includes(req.origin)) ...` mais au niveau TCP.

### 2.9 Processus et daemon

Un **processus** est une instance d'un programme en cours d'exécution. Chaque commande que tu lances dans un terminal démarre un processus.

```
$ ps aux | head -5
USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root         1  0.0  0.4 167964 11784 ?        Ss   May20   0:01 /sbin/init
ubuntu    1234  2.0  5.0 800000 50000 ?        Sl   12:34   0:42 node dist/main.js
caddy     2345  0.5  1.0 300000 10000 ?        Ssl  12:35   0:08 /usr/bin/caddy run
```

- `PID` : identifiant unique du processus
- `%CPU`, `%MEM` : usage
- `COMMAND` : ce qui tourne

**Daemon** : un processus qui tourne en arrière-plan, en continu, sans interface utilisateur. SSH (`sshd`), Caddy, Docker (`dockerd`), c'est des daemons.

**systemd** : le « chef d'orchestre » des daemons sur Linux moderne. Il démarre les services au boot, les redémarre s'ils crashent, gère leurs logs. Commandes utiles :

```bash
sudo systemctl status caddy         # statut du daemon
sudo systemctl start caddy          # le démarrer
sudo systemctl stop caddy           # l'arrêter
sudo systemctl restart caddy        # le redémarrer
sudo systemctl reload caddy         # recharger sa config sans redémarrer
sudo systemctl enable caddy         # auto-démarrage au boot
sudo systemctl disable caddy        # désactiver l'auto-démarrage
sudo journalctl -u caddy            # voir les logs
sudo journalctl -u caddy -f         # suivre les logs en temps réel
```

### 2.10 Proxies

#### Définition

Un **proxy** est un intermédiaire dans une conversation réseau. Au lieu que A parle directement à B, A parle à un proxy P, qui relaye à B (et inversement pour la réponse).

```
       sans proxy :              avec proxy :

       ┌───┐    ┌───┐            ┌───┐    ┌───┐    ┌───┐
       │ A │───▶│ B │            │ A │───▶│ P │───▶│ B │
       │   │◀───│   │            │   │◀───│   │◀───│   │
       └───┘    └───┘            └───┘    └───┘    └───┘
```

Pourquoi mettre un intermédiaire ? Selon le côté de la conversation où P est installé, les usages diffèrent. D'où la distinction **forward proxy** vs **reverse proxy**.

#### Forward proxy (proxy « côté client »)

C'est le **client** qui le met en place. P agit pour le compte du client. Le serveur ne sait pas (et ne se soucie pas) qu'il y a un proxy ; il voit le proxy comme s'il était le vrai requêteur.

```
       client   ──▶ forward proxy ──▶ serveur cible
       (toi)        (tu l'as choisi)   (voit l'IP du proxy,
                                         pas la tienne)
```

Usages typiques :

- **Réseau d'entreprise** : tous les employés passent par un forward proxy qui log et bloque certains sites.
- **VPN** : ton trafic sort par l'IP du VPN. Le serveur destination voit l'IP du VPN, pas la tienne.
- **Tor** : chaîne de forward proxies pour l'anonymat.
- **Cache FAI** : certains FAI cachent les contenus très populaires pour économiser de la bande passante.
- **Bloquer / monitorer** : parental control, employeur, gouvernement.

Le forward proxy est **opt-in** pour le client : il faut le configurer dans le navigateur ou le système.

#### Reverse proxy (proxy « côté serveur »)

C'est le **serveur** qui le met en place. Le client croit qu'il parle au vrai serveur, mais en réalité il tape sur le reverse proxy qui forward au backend. Le client n'a rien à configurer.

```
       client ──▶ reverse proxy ──▶ backend(s)
       (croit parler   (façade)      (les vrais
        au serveur)                    serveurs)
```

Usages typiques :

- **Terminaison TLS** : le proxy a le certificat, le backend reste en HTTP simple → moins de complexité dans l'app.
- **Load balancing** : le proxy répartit les requêtes entre plusieurs instances backend (round-robin, least-connections, etc.).
- **Cache** : le proxy met en cache les réponses (très utile pour les CDN).
- **WAF / rate limiting / IP filtering** : sécurité applicative en frontal.
- **Cacher l'IP d'origine** : seul le proxy est exposé, les backends sont en réseau privé. Si quelqu'un veut DDoS, il tape sur le proxy qui absorbe.
- **Single entry point** : un seul `domaine.com` qui route `/api/*` vers le backend A et `/admin/*` vers le backend B selon le path.
- **Compression, headers, rewrites** : transformations en passage.

Le reverse proxy est **transparent** pour le client : il pense parler directement au serveur.

#### Le mot « proxy » sans qualificatif

Dans le jargon dev :

- Quand on parle d'un **serveur web** (Nginx, Caddy, HAProxy, Traefik), « proxy » signifie quasi toujours **reverse proxy**.
- Quand on parle d'un **client** (browser, app mobile, OS), « proxy » signifie quasi toujours **forward proxy**.
- C'est le contexte qui tranche.

#### Différence clef : qui voit quelle IP ?

|                       | Forward proxy                             | Reverse proxy                                                                  |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| Mis en place par      | Le client                                 | Le serveur                                                                     |
| Le serveur final voit | L'IP du proxy                             | L'IP du proxy si pas de header X-Forwarded-For, sinon l'IP du client préservée |
| Le client voit        | L'IP de destination réelle (dans son URL) | L'IP du proxy (qu'il prend pour le serveur)                                    |
| Transparence          | Le client doit configurer le proxy        | Aucune config côté client                                                      |

#### Dans notre projet

Notre architecture utilise **deux reverse proxies stackés** :

**1) Cloudflare** (quand le proxy CF est « ON », nuage orange) joue le rôle de reverse proxy devant nos services AWS :

```
   navigateur ──▶ Cloudflare (RP) ──▶ S3 bucket  ← cas game.marche-ou-creve.com (proxy ON)
                  - termine le TLS
                  - cache CDN
                  - WAF gratuit
                  - cache l'IP S3
```

**2) Caddy** sur l'EC2 est un reverse proxy devant le container NestJS :

```
   client TCP ──▶ Caddy :443 (RP) ──▶ container :3000  ← cas api.marche-ou-creve.com
                  - termine le TLS (cert Let's Encrypt)
                  - HTTP/2, HTTP/3
                  - logs uniformes
                  - le container reste sur HTTP simple, lié à 127.0.0.1
```

Pour `api.marche-ou-creve.com` aujourd'hui, le proxy Cloudflare est désactivé (nuage gris), donc il n'y a qu'un seul reverse proxy (Caddy). Une fois activé, on aura deux RP en cascade :

```
   navigateur ──▶ Cloudflare RP ──▶ Caddy RP ──▶ NestJS
                  termine TLS edge   re-termine TLS    HTTP simple
                  + cache + WAF      vers son cert     localhost only
```

#### Analogie dev

- **Forward proxy** = ton `fetch` qui passe par un wrapper d'instrumentation/auth : `fetch = withAuth(realFetch)`. Le client est conscient et configure le wrapper.
- **Reverse proxy** = un middleware Express devant ta vraie route : `app.use(rateLimit); app.use(corsMiddleware); app.get('/api/users', handler)`. Le client tape `/api/users` sans savoir qu'il y a des middlewares avant.

---

## 3. Architecture cible

Vue d'ensemble de ce qu'on a construit J1 → J7 :

```
                                      ┌──────────────────┐
   navigateur (un joueur)              │  Cloudflare      │  ← DNS + CDN + TLS
   https://game.marche-ou-creve.com    │  (zone marche-   │     côté client
                                      │   ou-creve.com)  │
                                      └────────┬─────────┘
                                                │
                       ┌────────────────────────┴────────────────────────┐
                       │                                                  │
   game.marche-ou-creve.com                          api.marche-ou-creve.com
   (CNAME vers S3, proxy CF ON, SSL Flexible)        (A vers IP elastic, proxy CF OFF)
                       │                                                  │
                       ▼                                                  ▼
              ┌─────────────────┐                              ┌──────────────────┐
              │  S3 bucket      │                              │   EC2 t3.micro    │
              │  static website │                              │   eu-west-3       │
              │  hosting        │                              │  15.237.242.223  │
              │                 │                              │                   │
              │  index.html     │                              │  ┌─────────────┐ │
              │  /assets/*      │                              │  │ Caddy :443  │ │
              │  ...            │                              │  │ (TLS + RP)  │ │
              └─────────────────┘                              │  └──────┬──────┘ │
                                                                │         │ HTTP   │
                                                                │         ▼        │
                                                                │  ┌─────────────┐ │
                                                                │  │ container   │ │
                                                                │  │ marche-ou-  │ │
                                                                │  │ creve-server│ │
                                                                │  │ NestJS :3000│ │
                                                                │  │ (Socket.IO) │ │
                                                                │  └─────────────┘ │
                                                                │   Docker engine  │
                                                                │   Ubuntu 24.04   │
                                                                └──────────────────┘
                                                                       AWS
```

**Flux d'une partie de jeu** :

1. Joueur tape `game.marche-ou-creve.com` dans son navigateur.
2. DNS résolution : Cloudflare répond avec une IP de son réseau (proxy ON).
3. Navigateur fait un HTTPS GET, Cloudflare termine le TLS et forward à S3.
4. S3 sert `index.html` + JS bundle. Le client se charge dans le navigateur.
5. Le client JS ouvre une connexion **WebSocket** vers `wss://api.marche-ou-creve.com`.
6. DNS résolution : Cloudflare répond avec l'IP de l'EC2 (proxy OFF → IP réelle).
7. La connexion arrive sur l'EC2 port 443.
8. Caddy termine le TLS, fait reverse_proxy vers `localhost:3000` (NestJS dans Docker).
9. NestJS répond, la connexion WebSocket s'établit, la partie peut commencer.

---

## 4. Les outils utilisés

### 4.1 AWS

**AWS** (Amazon Web Services) est le plus gros cloud provider du monde. C'est un catalogue de ~200 services qu'on assemble pour construire son infra.

Pour notre projet, on utilise 5 services AWS :

- **IAM** (Identity and Access Management) : qui peut faire quoi sur le compte.
- **EC2** (Elastic Compute Cloud) : VMs.
- **S3** (Simple Storage Service) : stockage de fichiers.
- **Budgets** : alertes de coût.
- **VPC** (Virtual Private Cloud) : le réseau dans lequel vivent les EC2 — par défaut, AWS en crée un pour toi.

#### Région et Availability Zone

AWS a des datacenters partout dans le monde, regroupés en **régions** :

- `us-east-1` : Virginie (le plus gros, le moins cher, mais loin de la France)
- `eu-west-1` : Irlande
- `eu-west-3` : Paris (notre choix, latence minimale pour public FR)
- `ap-northeast-1` : Tokyo
- etc.

Chaque région contient plusieurs **Availability Zones** (AZ), qui sont des datacenters physiquement séparés mais reliés par fibre dédiée. Une panne d'AZ ne met pas la région à genoux.

Pour notre projet, on est en **eu-west-3** (Paris), AZ par défaut.

**Toutes les commandes AWS CLI doivent spécifier la région** sinon AWS ne sait pas où chercher tes ressources. On utilise `--region eu-west-3`.

#### Compte AWS, root, IAM

Quand tu crées un compte AWS, tu obtiens un **utilisateur racine** (root) identifié par ton email. Ce user peut tout faire, y compris fermer le compte ou modifier la facturation.

**Règle d'or** : **on n'utilise plus jamais le user root pour les opérations quotidiennes**. On active la MFA dessus, on note les credentials de récupération, et on l'oublie.

À la place, on crée des **utilisateurs IAM** :

- **User** : un humain ou un programme (CI, script).
- **Group** : un regroupement de users avec les mêmes droits (ex: `deployers`, `developers`).
- **Policy** : un document JSON qui décrit ce qu'on a le droit de faire. Ex : `AmazonS3FullAccess` (tout sur S3), `AmazonEC2FullAccess` (tout sur EC2).
- **Role** : comme un user, mais assumé par une autre identité (ex: une EC2 peut assumer un role pour parler à S3 sans avoir de credentials en dur).

Sur ce projet :

```
   ┌───────────────────────────────────┐
   │  Compte AWS 484056256094          │
   │                                    │
   │  user root (paul@...) - MFA only  │
   │                                    │
   │  group: deployers                 │
   │   │                                │
   │   ├── policy AmazonS3FullAccess   │
   │   ├── policy AmazonEC2FullAccess  │
   │   ├── policy CloudWatchLogsFullA. │
   │   └── policy IAMReadOnlyAccess    │
   │                                    │
   │  user IAM: deploy                 │
   │   │   in group deployers          │
   │   │   access key id: AKIA...      │
   │   │   secret key:    aBc...       │
   │   └── stocké local en `--profile deploy`
   └───────────────────────────────────┘
```

**Pourquoi pas `AdministratorAccess`** ? Defense in depth : si la clé `deploy` fuit (commit accidentel, vol de laptop), le voleur ne peut pas créer de nouveaux users, escalader, fermer le compte, voler de la donnée non-projet. Il est limité aux services qu'on lui a accordés.

#### AWS CLI

L'outil en ligne de commande pour parler aux APIs AWS. Installation : `brew install awscli`. Configuration : `aws configure --profile deploy` qui te demande access key + secret + région + format. Les credentials sont stockés dans `~/.aws/credentials`.

Tu trouves la liste complète des commandes sur la [doc officielle](https://docs.aws.amazon.com/cli/). Format général : `aws <service> <action> [--options]`.

#### S3 (Simple Storage Service)

S3 = stockage d'objets. Tu mets des fichiers dans des **buckets** (« seaux »). Chaque bucket a un nom **globalement unique au monde** (pas par compte, pas par région — au monde entier).

Caractéristiques :

- Pas un filesystem : tu ne peux pas modifier un fichier en place. Tu remplaces.
- Très durable (99.999999999% — onze 9).
- Pas cher (~0.023 $/GB/mois en eu-west-3).
- Peut être configuré en **static website hosting** : S3 te sert les fichiers via HTTP comme un mini-serveur web (pas de HTTPS natif sur l'endpoint, d'où le besoin de Cloudflare devant).

Pour J4, notre client (compilé via Vite en HTML + JS + CSS statique) est uploadé dans le bucket `game.marche-ou-creve.com`. Le nom du bucket **doit matcher l'hostname** pour que Cloudflare → S3 fonctionne sans réécriture de Host header.

#### EC2 (Elastic Compute Cloud)

EC2 = VMs à la demande. Tu choisis :

- **Instance type** : combien de CPU/RAM. Famille `t` (général burst), `m` (général), `c` (CPU-intensive), `r` (RAM-intensive), `g` (GPU). Génération (`t3` vs `t4g`). Taille (`nano`, `micro`, `small`, `medium`, `large`, `xlarge`...).
- **AMI** (Amazon Machine Image) : l'image disque de départ. Ubuntu 24.04, Amazon Linux, Windows Server, etc. AMIs maintenues par Canonical (Ubuntu), Amazon, ou des tiers.
- **Architecture** : x86_64 (Intel/AMD) ou ARM64 (`t4g`, `m6g`). Performance ARM excellente et moins cher, mais il faut que tes images Docker soient buildées pour ARM.
- **Storage** : EBS (volume disque réseau, persistant). Par défaut 8 GB, on a pris 12 pour avoir de la marge pour Docker.
- **Network** : VPC, subnet, security groups, public IP ou non.
- **Key pair** : pour SSH.
- **User data** (optionnel) : script à exécuter au premier boot pour pré-configurer la machine.

Notre EC2 : `t3.micro`, Ubuntu 24.04 x86, 12 GB EBS, dans le VPC par défaut, SG `marche-ou-creve-sg`, key `marche-ou-creve-prod`.

#### Elastic IP

Par défaut, quand tu lances une EC2, elle reçoit une IP publique aléatoire. Si tu reboot, la stop/start, ou la replace : tu obtiens une **autre IP**. Catastrophe pour le DNS (le record A devient faux).

Une **Elastic IP** (EIP) est une IP publique **réservée** que tu attaches à ton EC2. Tant qu'elle est attachée à une instance qui tourne, elle est gratuite. Si tu la détaches sans la libérer, AWS te facture (pour éviter le squat d'IPs).

Notre EIP : `15.237.242.223`. Elle restera la même même si on stop/start l'EC2.

#### VPC, subnet, route table

Un **VPC** (Virtual Private Cloud) est un réseau privé virtuel dans une région. Par défaut, AWS te crée un VPC par région, avec des subnets dans chaque AZ. Pour ce projet on utilise tout par défaut.

- **Subnet** : sous-réseau dans une AZ donnée. CIDR par défaut `172.31.0.0/16`. Notre EC2 a obtenu l'IP privée `172.31.36.144`.
- **Internet Gateway** : la passerelle qui connecte le VPC à internet. Le default VPC en a une par défaut.
- **Route table** : qui dit « cette destination → passe par tel gateway ».
- **NACL** (Network ACL) : firewall au niveau subnet. Par défaut « allow all ». On ne touche pas.

#### Security Group (SG)

Détaillé en 2.8.

#### Budgets / Billing

AWS te facture **par seconde** d'usage pour la plupart des services. Une facture surprise est facilement évitable avec :

- **Free tier** : pendant 12 mois, certains services sont gratuits dans des limites. EC2 `t3.micro` = 750 h/mois gratuit (assez pour 1 instance H24).
- **Budgets** : alertes par email quand tu approches un seuil. On a réglé à 10 €/mois avec alertes à 85% / 100% actual / 100% forecast.

#### CloudWatch

Service de logs et métriques. À J9 on l'utilisera. Pour l'instant on s'en sert juste pour les logs EC2 par défaut.

### 4.2 Cloudflare

Cloudflare est multi-services :

1. **Registrar** : achat/renouvellement de noms de domaine, **à prix coûtant**. Moins cher qu'OVH/Gandi (souvent ~10 €/an pour un `.com`).
2. **DNS** : héberge ta zone DNS, interface web ou API. Très rapide (anycast worldwide).
3. **CDN** : copie ton contenu statique dans des PoPs (Points of Presence) répartis dans le monde → les users sont servis depuis le PoP le plus proche.
4. **TLS** : certif universel offert, free.
5. **WAF / DDoS** : protection contre attaques, gratuite en plan free.
6. **Workers** : exécution de code à l'edge (équiv. Lambda mais distribué partout).
7. **R2** : object storage compatible S3 (concurrent S3, sans frais d'egress).

Pour le projet on utilise les services 1-5.

#### Le « proxy Cloudflare » (orange vs gris)

Pour chaque record DNS, tu choisis si Cloudflare doit **proxier** le trafic ou juste répondre l'IP de destination. Quand le proxy est activé, Cloudflare joue le rôle de **reverse proxy** au sens de §2.10 — il termine le TLS, peut cacher, filtrer, log, et le client ne sait pas que son trafic transite par CF (sauf à inspecter les headers de réponse).

```
┌──────────────────────────────────────────────────────────┐
│  Cas A : nuage GRIS (DNS only)                            │
│                                                            │
│   navigateur → DNS Cloudflare → reçoit l'IP réelle        │
│   navigateur → IP réelle (TCP direct)                     │
│                                                            │
│  Cloudflare ne voit JAMAIS le trafic.                     │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Cas B : nuage ORANGE (proxy ON)                          │
│                                                            │
│   navigateur → DNS Cloudflare → reçoit une IP Cloudflare │
│   navigateur → IP Cloudflare → CDN/WAF/TLS → IP réelle   │
│                                                            │
│  Cloudflare voit, peut cache, proteger, modifier.        │
│  Bonus : ton IP réelle n'est pas exposée publiquement.   │
└──────────────────────────────────────────────────────────┘
```

Sur notre projet :

- `game.marche-ou-creve.com` (client S3) → **ORANGE** : on veut le CDN (cache des assets) + le TLS (S3 website n'a pas de HTTPS).
- `api.marche-ou-creve.com` (server EC2) → **GRIS** : Caddy gère le TLS, et pour Let's Encrypt il faut que la CA puisse joindre directement notre IP (sinon le challenge ACME échoue).

Plus tard (optionnel) on peut activer le proxy sur `api` aussi, en passant Cloudflare en mode « Full strict » : Cloudflare termine le TLS edge-side, ouvre un nouveau TLS vers notre Caddy. Ça ajoute caching/WAF/DDoS sur l'API.

#### SSL modes Cloudflare

Quand le proxy CF est activé, on a 4 modes :

- **Off** : tout en HTTP, sans chiffrement. Jamais utilisé.
- **Flexible** : navigateur ↔ Cloudflare en HTTPS, Cloudflare ↔ origine en HTTP. Utile pour notre S3 website (HTTP-only). Risque : si quelqu'un peut sniffer entre CF et S3, c'est ouvert. En pratique, AWS+CF c'est suffisamment cloisonné.
- **Full** : HTTPS bout en bout, mais Cloudflare accepte n'importe quel certif (même self-signed) côté origine.
- **Full strict** : HTTPS bout en bout, Cloudflare valide le certif côté origine (signé par une CA reconnue). Le plus sûr. C'est l'objectif pour `api.marche-ou-creve.com` plus tard.

### 4.3 Docker

Détaillé en 2.7. Ici les commandes principales :

```bash
# Builder une image
docker build -t mon-image:tag -f path/to/Dockerfile .
# Avec buildx pour cross-arch
docker buildx build --platform linux/amd64 -t mon-image:tag --load .

# Lister images / containers
docker images
docker ps          # containers qui tournent
docker ps -a       # tous (y compris arrêtés)

# Lancer un container
docker run -d --name X -p 3000:3000 -e VAR=valeur mon-image:tag
#         └─ détaché (background)
#                 └─ nom        └─ port mapping  └─ env var

# Logs, exec, stop
docker logs mon-container
docker logs -f mon-container        # follow
docker exec -it mon-container sh    # rentrer dedans
docker stop mon-container
docker rm mon-container

# Save / load (transfert sans registry)
docker save mon-image:tag > image.tar
docker load < image.tar

# Compose : orchestrer plusieurs containers
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.prod.yml down
```

#### Dockerfile en multi-stage

Notre [apps/server/Dockerfile](../apps/server/Dockerfile) utilise des **stages** pour optimiser :

```dockerfile
FROM node:22-alpine AS base   # base commune (node + corepack)
WORKDIR /app

FROM base AS deps             # stage qui installe pnpm deps
COPY package.json ...
RUN pnpm install

FROM deps AS build            # stage qui build le TypeScript
COPY apps/server apps/server
RUN pnpm build

FROM base AS prod             # stage final, contient SEULEMENT le runtime
COPY --from=build /app/dist ./dist
CMD ["node", "dist/main.js"]
```

Avantage : l'image finale (`prod`) ne contient PAS les sources TypeScript ni les `devDependencies`. Elle est plus petite, plus rapide à transférer.

#### Le `.dockerignore`

Analogie : comme un `.gitignore`, mais pour le build context Docker. Tout ce qui matche est exclu de ce que Docker copie pour faire le build. Sans `.dockerignore`, Docker uploaderait `node_modules/` (gros !) à chaque build.

Notre [.dockerignore](../.dockerignore) exclut : `**/node_modules`, `**/dist`, `.git`, etc.

### 4.4 Caddy

**Caddy** est un serveur web moderne (concurrent de Nginx, Apache). Particularités :

- **HTTPS automatique** : il obtient et renouvelle les certificats Let's Encrypt automatiquement, sans config manuelle.
- **Config simple** : le `Caddyfile` est très lisible (vs Nginx qui est verbeux).
- **WebSocket out of the box** : `reverse_proxy` gère automatiquement l'upgrade.
- **HTTP/2 et HTTP/3** activés par défaut.

Notre [Caddyfile](../Caddyfile) :

```caddy
{
    email p.doazan@lehibou.com
}

api.marche-ou-creve.com {
    reverse_proxy localhost:3000
    log {
        output stdout
        format console
    }
}
```

- Le bloc `{}` au début c'est le **bloc global** (options qui s'appliquent à tout).
- `email` : pour Let's Encrypt (notifications d'expiration).
- `api.marche-ou-creve.com { ... }` est un **site block** : tout ce qui dedans s'applique à ce domaine.
- `reverse_proxy localhost:3000` : forward toutes les requêtes au serveur local sur le port 3000.
- `log` : structure des logs.

#### Caddy comme reverse proxy

Caddy joue le rôle de **reverse proxy** devant le container NestJS. Le concept général (forward vs reverse, usages, comparaison) est expliqué en §2.10. Concrètement pour nous :

```
   client TCP ─────▶ Caddy :443  ─────▶ container NestJS :3000
                     (TLS Let's          (HTTP simple,
                      Encrypt, HTTP/2)    bound à 127.0.0.1)
```

Usage principal pour notre projet : **terminaison TLS**. Caddy a le certif Let's Encrypt, NestJS reste en HTTP simple → l'app n'a pas à gérer la complexité TLS, le renouvellement, le HSTS, etc.

Bonus gratuits avec `reverse_proxy localhost:3000` : redirect HTTP→HTTPS automatique (308), upgrade WebSocket transparent (utile pour Socket.IO), HTTP/2 et HTTP/3 activés par défaut côté client.

### 4.5 Outils annexes

#### apt et dpkg

`apt` (Advanced Package Tool) est le gestionnaire de paquets d'Ubuntu/Debian. Commandes :

```bash
sudo apt update              # rafraîchir la liste des paquets disponibles
sudo apt upgrade             # mettre à jour les paquets installés
sudo apt install caddy       # installer un paquet
sudo apt remove caddy        # le désinstaller
sudo apt search nginx        # chercher
```

Les paquets viennent de **repos** définis dans `/etc/apt/sources.list` et `/etc/apt/sources.list.d/`. Par défaut Ubuntu utilise ses repos officiels (main, universe, multiverse).

Pour Caddy, on a ajouté le repo officiel **Cloudsmith** (maintenu par l'équipe Caddy) plus à jour que le paquet `caddy` d'Ubuntu universe.

#### gpg et la signature des paquets

Quand `apt` télécharge un paquet, comment être sûr qu'il vient bien du bon repo et n'a pas été altéré ? Via **signature cryptographique** :

1. L'éditeur (Cloudsmith) signe ses paquets avec une clé privée GPG.
2. Tu installes la clé publique correspondante sur ton système (`/usr/share/keyrings/`).
3. `apt` vérifie chaque paquet contre cette clé publique.

Commande utilisée à J7 :

```bash
curl -1sLf 'https://dl.cloudsmith.io/.../gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
```

- `curl -1sLf` télécharge la clé (`-1` force TLS 1.0+, `-s` silencieux, `-L` suit les redirects, `-f` échoue sur erreur HTTP).
- `gpg --dearmor` convertit le format ASCII-armored en binaire (format attendu par apt).
- `-o ...` écrit dans le dossier des keyrings système.

#### systemd (rappel)

Voir 2.9. Notre Caddy tourne en tant que daemon systemd : `sudo systemctl status caddy`.

#### scp

Voir 2.6. Pour copier des fichiers via SSH.

#### docker save / load

Quand on n'a pas de **registry** (Docker Hub, GHCR, ECR), on peut transférer une image directement :

```bash
# sur la machine A
docker save mon-image:tag | gzip > image.tar.gz
scp image.tar.gz user@machine-B:~/

# sur la machine B
docker load < image.tar.gz
```

C'est ce qu'on a fait pour J6 (provisoire). À J8 on automatisera via GHCR (GitHub Container Registry).

---

## 5. J1 — Compte AWS + sécurité de base

### Objectif

Avoir un compte AWS utilisable sans risque de facture surprise et sans risque sécurité.

### Étapes détaillées

#### 5.1 Créer le compte AWS

- Aller sur https://aws.amazon.com/.
- « Create an AWS Account » → email + nom + mot de passe.
- Saisir une CB (AWS exige une carte même pour le free tier).
- Choisir le plan « Basic Support » (gratuit).
- Validation par téléphone.

Résultat : tu as un **user root** identifié par ton email.

#### 5.2 Activer MFA sur le root

**MFA** (Multi-Factor Authentication) = deux preuves d'identité. Mot de passe (ce que tu sais) + appli OTP (ce que tu as).

- Connexion en root → menu compte → Security credentials.
- « Assign MFA device » → application virtuelle.
- Utiliser Google Authenticator, Authy, 1Password TOTP, ou similaire.
- Scanner le QR code, saisir 2 codes consécutifs.

**Pourquoi c'est critique** : si quelqu'un découvre ton mot de passe root, il peut tout faire sur ton compte (créer 1000 EC2, te facturer 50k €). Avec MFA, il lui faut aussi ton téléphone.

#### 5.3 Créer un user IAM `deploy`

Via la console IAM :

- Users → Add user → nom `deploy`.
- « Access type » : programmatic access (= clés API, pas de login console).
- Add to group : créer le groupe `deployers` avec les policies :
  - `AmazonS3FullAccess`
  - `AmazonEC2FullAccess`
  - `CloudWatchLogsFullAccess`
  - `IAMReadOnlyAccess` (utile pour debug : voir qui on est)
- Tags : optionnel.
- Récupérer la `Access key ID` (publique) et le `Secret access key` (à garder secret).

#### 5.4 Configurer le budget

- Console → Billing → Budgets → Create budget.
- Type : Cost budget.
- Period : Monthly.
- Amount : 10 USD.
- Alerts :
  - 85% of actual (te prévient quand tu approches).
  - 100% of actual (tu as dépassé).
  - 100% of forecast (sur la trajectoire actuelle, tu dépasseras).
- Email destinataire.

#### 5.5 Configurer l'AWS CLI en local

```bash
brew install awscli                # macOS
aws configure --profile deploy
# AWS Access Key ID: AKIA...
# AWS Secret Access Key: ...
# Default region name: eu-west-3
# Default output format: json
```

Vérification :

```bash
aws sts get-caller-identity --profile deploy
```

Doit retourner ton account ID + ARN de l'user `deploy`. Si erreur → vérifier `~/.aws/credentials` et `~/.aws/config`.

### Schéma du résultat J1

```
   ┌───────────────────────────────────────────────────┐
   │  Compte AWS 484056256094                          │
   │                                                    │
   │  ┌─────────────────────────────────────────────┐ │
   │  │  user root (p.doazan@...)                    │ │
   │  │  ├─ MFA: activé                              │ │
   │  │  └─ usage: jamais, sauf urgence              │ │
   │  └─────────────────────────────────────────────┘ │
   │                                                    │
   │  ┌─────────────────────────────────────────────┐ │
   │  │  IAM group: deployers                        │ │
   │  │  policies:                                    │ │
   │  │  - AmazonS3FullAccess                        │ │
   │  │  - AmazonEC2FullAccess                       │ │
   │  │  - CloudWatchLogsFullAccess                  │ │
   │  │  - IAMReadOnlyAccess                         │ │
   │  └─────────────────────────────────────────────┘ │
   │                                                    │
   │  ┌─────────────────────────────────────────────┐ │
   │  │  IAM user: deploy                            │ │
   │  │  ├─ membre de deployers                      │ │
   │  │  ├─ access key + secret (local profile)      │ │
   │  │  └─ MFA: optionnelle (programmatic only)     │ │
   │  └─────────────────────────────────────────────┘ │
   │                                                    │
   │  Budget: 10 €/mois, 3 alertes                     │
   └───────────────────────────────────────────────────┘
```

---

## 6. J2 — Cloudflare + achat domaine

### Objectif

Posséder un nom de domaine et avoir sa zone DNS pilotable via Cloudflare.

### Étapes

#### 6.1 Créer le compte Cloudflare

- https://dash.cloudflare.com/sign-up
- Email + mot de passe.
- Activer la MFA (Cloudflare propose TOTP ou hardware key).

#### 6.2 Acheter `marche-ou-creve.com` via le Registrar Cloudflare

- Domain Registration → Register Domains.
- Chercher `marche-ou-creve` → choisir l'extension `.com`.
- Vérifier le prix (CF est à prix coûtant, ~10 €/an pour `.com`).
- Acheter avec CB.

Cloudflare ajoute automatiquement le domaine à ton compte, avec une zone DNS vide, et configure les nameservers (`ace.ns.cloudflare.com`, `mona.ns.cloudflare.com`).

#### 6.3 Vérifier que la zone DNS est active

```bash
dig marche-ou-creve.com NS
```

Doit retourner les nameservers Cloudflare. Test rapide :

- Dans le dashboard CF → DNS → Records → Add record :
  - Type A, Name `@`, Content `192.0.2.1` (IP réservée RFC pour les tests).
- Depuis le terminal local : `dig marche-ou-creve.com` doit répondre `192.0.2.1` (TTL Auto = ~5 min).
- Supprimer le record.

Test passé → la zone est OK.

### Schéma du résultat J2

```
   Registrar Cloudflare
        │
        ▼  vend
   ┌────────────────────────────────────┐
   │  marche-ou-creve.com               │
   │  TLD: .com (Verisign)              │
   │  Auto-renew: ON                    │
   │  Nameservers:                       │
   │   - ace.ns.cloudflare.com           │
   │   - mona.ns.cloudflare.com          │
   │  Zone DNS: gérée par Cloudflare    │
   │  Records: (vide pour l'instant)    │
   └────────────────────────────────────┘
```

---

## 7. J3 — Variables d'environnement

### Objectif

Rendre le code déployable sans modifications manuelles. Toute la config qui change entre dev et prod passe par des variables d'env.

### Pourquoi

En dev : `CORS_ORIGIN=http://localhost:5173`, le client tourne sur Vite dev server.
En prod : `CORS_ORIGIN=https://game.marche-ou-creve.com`, le client est sur S3.

Si tu hardcodes la valeur de dev dans le code, soit tu dois modifier le code à chaque déploiement (cauchemar), soit tu acceptes un comportement faux en prod. La solution : **lire la valeur depuis l'environnement**.

```typescript
// AVANT (codé en dur)
const corsOrigin = 'http://localhost:5173'

// APRÈS (configurable)
const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173'
```

### Changements concrets faits à J3

1. **Client** : créer `apps/client/.env.production` avec `VITE_SERVER_URL=https://api.marche-ou-creve.com`. Vite injecte ces vars dans le bundle à build time (`import.meta.env.VITE_SERVER_URL`).

2. **Serveur** : extraire le CORS_ORIGIN hardcodé dans `main.ts` et `game.gateway.ts` vers un helper [config/cors-origin.ts](../apps/server/src/config/cors-origin.ts) qui lit `process.env.CORS_ORIGIN`.

3. **Convention multi-origin** : `CORS_ORIGIN` peut être une liste séparée par virgules (`http://localhost:5173,https://game.marche-ou-creve.com`). Le helper la parse.

4. **Tests de build** :
   - `pnpm --filter client build` → produit `apps/client/dist/index.html` + bundle.
   - `pnpm --filter server build` → produit `apps/server/dist/main.js`.

### Pourquoi commiter `.env.production` ?

Convention Vite : les fichiers `.env.production` sont chargés en prod build. Comme on n'y met **aucun secret** (que des URLs publiques), c'est OK de les commiter. À l'inverse, `.env.local` (clé d'API privée, mot de passe BDD) ne se commit jamais.

---

## 8. J4 — Client statique sur S3

### Objectif

Ouvrir `https://game.marche-ou-creve.com` et voir la home du jeu.

### Architecture J4

```
                ┌───────────────────┐
   navigateur ─▶│  Cloudflare DNS   │  game.marche-ou-creve.com
                │  + proxy (orange) │
                └────────┬──────────┘
                          │ TLS (Cloudflare cert) terminé ici
                          │ puis HTTP vers S3
                          ▼
                ┌───────────────────────────────────────┐
                │  S3 bucket: game.marche-ou-creve.com  │
                │  Static website hosting               │
                │  endpoint:                             │
                │   game.marche-ou-creve.com.s3-website.│
                │   eu-west-3.amazonaws.com (HTTP)      │
                └───────────────────────────────────────┘
```

### Étapes détaillées

#### 8.1 Créer le bucket S3

```bash
aws s3api create-bucket \
  --profile deploy --region eu-west-3 \
  --bucket game.marche-ou-creve.com \
  --create-bucket-configuration LocationConstraint=eu-west-3
```

Pourquoi `LocationConstraint` ? S3 a une particularité : `us-east-1` est la région par défaut, pour TOUTE autre région tu dois explicitement le préciser à la création.

**Important** : le nom du bucket doit **exactement** matcher l'hostname public (`game.marche-ou-creve.com`). Pourquoi ? Parce que Cloudflare va proxier la requête en gardant le header HTTP `Host: game.marche-ou-creve.com`. S3 cherche un bucket de ce nom pour répondre. Si ça ne match pas, S3 retourne 404.

#### 8.2 Activer le static website hosting

```bash
aws s3 website s3://game.marche-ou-creve.com/ \
  --profile deploy \
  --index-document index.html \
  --error-document index.html
```

- `index-document` : fichier servi quand on demande `/`.
- `error-document index.html` : si le path n'existe pas, retourne quand même `index.html`. Pourquoi ? Notre client est une **SPA** (Single Page Application) : tous les routes (`/game/abc`, `/profile/42`) sont gérées côté JS. Si l'user reload sur `/game/abc`, S3 cherche un fichier `/game/abc` qui n'existe pas → on lui sert `index.html` qui démarre la SPA qui lit `window.location.pathname` et affiche la bonne vue.

#### 8.3 Désactiver le « block public access »

Par défaut, S3 bloque tout accès public (sécurité par défaut). On veut servir des fichiers au monde, donc on désactive :

```bash
aws s3api put-public-access-block \
  --profile deploy --region eu-west-3 \
  --bucket game.marche-ou-creve.com \
  --public-access-block-configuration \
    "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"
```

#### 8.4 Ajouter une bucket policy

Une **bucket policy** est un document JSON qui dit qui peut faire quoi sur le bucket. Pour notre static website, on autorise tout le monde à faire `s3:GetObject` (lire) :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::game.marche-ou-creve.com/*"
    }
  ]
}
```

- `Principal: "*"` : n'importe qui (anonyme).
- `Action: s3:GetObject` : lire un objet (pas list, pas delete).
- `Resource: arn:...` : tous les objets dans ce bucket.

Applied via :

```bash
aws s3api put-bucket-policy --bucket ... --policy file://policy.json
```

#### 8.5 Uploader le contenu

Le script [scripts/deploy-client.sh](../scripts/deploy-client.sh) automatise :

```bash
# 1. Build
pnpm --filter @hips/shared build
pnpm --filter client build

# 2. Sync assets (immutable, cache 1 an)
aws s3 sync apps/client/dist/assets/ s3://game.marche-ou-creve.com/assets/ \
  --profile deploy \
  --cache-control "public, max-age=31536000, immutable" \
  --delete

# 3. Sync HTML (no-cache, recheck à chaque visite)
aws s3 cp apps/client/dist/index.html s3://game.marche-ou-creve.com/index.html \
  --profile deploy \
  --cache-control "no-cache, no-store, must-revalidate"
```

**Pourquoi 2 stratégies de cache** ?

- Les assets buildés par Vite ont un hash dans le nom (`bundle-a1b2c3.js`). Si le contenu change, le nom change. Donc on peut dire au navigateur « cache 1 an, ne re-vérifie jamais » → ultra-rapide pour les retours visiteurs.
- L'`index.html` ne change pas de nom, mais référence les assets par hash. Il faut qu'il soit toujours frais sinon les users restent sur l'ancienne version → `no-cache`.

#### 8.6 Configurer Cloudflare DNS

- Dashboard CF → marche-ou-creve.com → DNS → Records → Add :
  - Type **CNAME**
  - Name : `game`
  - Target : `game.marche-ou-creve.com.s3-website.eu-west-3.amazonaws.com`
  - Proxy : **ON (orange)**
- SSL/TLS → Overview → Mode : **Flexible**.

Vérification :

```bash
curl -I https://game.marche-ou-creve.com
# HTTP/2 200
```

Et dans le navigateur : la home du jeu s'affiche.

### Schéma du résultat J4

```
       User navigateur
            │
            │ https://game.marche-ou-creve.com
            │ (TLS Cloudflare wildcard cert)
            ▼
       Cloudflare PoP (Paris)
            │
            │ HTTP (Flexible mode)
            │ Host: game.marche-ou-creve.com
            ▼
       S3 bucket game.marche-ou-creve.com
            │
            └── index.html → bundle JS → page chargée
```

---

## 9. J5 — Provisionner l'EC2 + Docker + SSH

### Objectif

Avoir une VM Ubuntu accessible en SSH avec Docker installé.

### Étapes détaillées

#### 9.1 Récupérer l'IP publique du poste local

Pour limiter le SSH à mon IP uniquement :

```bash
curl -s https://checkip.amazonaws.com
# 92.184.98.215
```

Résultat → on l'utilisera dans la règle SG.

#### 9.2 Trouver l'AMI Ubuntu 24.04

Les AMIs Ubuntu officielles sont publiées par **Canonical** (owner ID `099720109477`). On filtre par nom :

```bash
aws ec2 describe-images \
  --profile deploy --region eu-west-3 \
  --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" \
            "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].[ImageId,Name,CreationDate]' \
  --output table
```

Décomposition :

- `--owners 099720109477` : seules les AMIs publiées par Canonical (évite les AMIs malveillantes tierces).
- `--filters Name=name,Values=...` : matching par nom avec wildcard.
  - `hvm` : type d'AMI moderne (HVM vs PV legacy).
  - `ssd-gp3` : disque SSD gp3 (le bon défaut).
  - `noble` : nom de code Ubuntu 24.04.
  - `amd64` : architecture x86_64 (vs `arm64`).
- `--filters Name=state,Values=available` : AMIs prêtes (pas en cours de copie).
- `--query 'sort_by(Images, &CreationDate)[-1]'` : tri par date, prendre la plus récente.
- `--output table` : format lisible.

Résultat : `ami-030cfb51a08050cad` (snapshot 2026-05-15).

#### 9.3 Créer la key pair

```bash
aws ec2 create-key-pair \
  --profile deploy --region eu-west-3 \
  --key-name marche-ou-creve-prod \
  --key-type ed25519 \
  --key-format pem \
  --query 'KeyMaterial' --output text \
  > ~/.ssh/marche-ou-creve-prod.pem

chmod 600 ~/.ssh/marche-ou-creve-prod.pem
```

- `--key-type ed25519` : type moderne (vs RSA).
- `--key-format pem` : format texte standard.
- `--query 'KeyMaterial' --output text` : ne récupérer que le contenu de la clé (pas le JSON wrapper).
- `chmod 600` : SSH refuse d'utiliser une clé privée si elle est lisible par d'autres users.

AWS garde la clé publique (pour l'injecter dans les EC2 que tu lanceras avec cette key pair), tu gardes la privée.

#### 9.4 Créer le Security Group

```bash
VPC_ID=$(aws ec2 describe-vpcs --profile deploy --region eu-west-3 \
  --filters "Name=is-default,Values=true" \
  --query 'Vpcs[0].VpcId' --output text)

SG_ID=$(aws ec2 create-security-group \
  --profile deploy --region eu-west-3 \
  --group-name marche-ou-creve-sg \
  --description "..." \
  --vpc-id "$VPC_ID" \
  --query 'GroupId' --output text)

aws ec2 authorize-security-group-ingress \
  --profile deploy --region eu-west-3 \
  --group-id "$SG_ID" \
  --ip-permissions '[
    {"IpProtocol":"tcp","FromPort":22,"ToPort":22,"IpRanges":[{"CidrIp":"92.184.98.215/32"}]},
    {"IpProtocol":"tcp","FromPort":80,"ToPort":80,"IpRanges":[{"CidrIp":"0.0.0.0/0"}]},
    {"IpProtocol":"tcp","FromPort":443,"ToPort":443,"IpRanges":[{"CidrIp":"0.0.0.0/0"}]}
  ]'
```

- 1ère commande : trouver le VPC par défaut.
- 2ème : créer le SG dedans.
- 3ème : ajouter les 3 règles ingress.

**Spoiler J5 (ce qu'on a appris en vivant)** : `/32` (IP unique) ne tient pas. Pourquoi ? La box opérateur fait du NAT et peut router le port 22 et le port 443 via des IPs source différentes. Résultat : SSH bloqué alors que HTTPS marche.

Diagnostic : on a temporairement ouvert SSH à `0.0.0.0/0`, fait `sudo grep -oP "from \K[\d.]+" /var/log/auth.log` pour récupérer l'IP source réelle vue par AWS, puis on a remis une règle plus large : `92.184.98.0/24` (256 IPs du pool ISP). Beaucoup plus étroit que `0.0.0.0/0`, suffisant pour couvrir les rotations NAT.

#### 9.5 Lancer l'instance EC2

```bash
aws ec2 run-instances \
  --profile deploy --region eu-west-3 \
  --image-id ami-030cfb51a08050cad \
  --instance-type t3.micro \
  --key-name marche-ou-creve-prod \
  --security-group-ids sg-0c568554a02091eb2 \
  --block-device-mappings '[{
    "DeviceName":"/dev/sda1",
    "Ebs":{"VolumeSize":12,"VolumeType":"gp3","DeleteOnTermination":true}
  }]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=marche-ou-creve-server}]' \
  --metadata-options 'HttpTokens=required,HttpPutResponseHopLimit=2'
```

Décomposition :

- `--image-id` : l'AMI Ubuntu 24.04 x86 trouvée plus haut.
- `--instance-type t3.micro` : la VM size (free tier 1ère année).
- `--key-name` : la key pair → la clé publique sera installée dans `~ubuntu/.ssh/authorized_keys` automatiquement.
- `--security-group-ids` : notre SG.
- `--block-device-mappings` : taille du disque root (12 GB gp3, supprimé à la terminaison de l'instance).
- `--tag-specifications` : tags pour s'y retrouver dans la console (Name = `marche-ou-creve-server`).
- `--metadata-options` : hardening IMDS (Instance Metadata Service). `HttpTokens=required` force IMDSv2 (avec token de session) plutôt que IMDSv1 (vulnérable à SSRF). `HttpPutResponseHopLimit=2` empêche un container Docker d'accéder à l'IMDS si tu ne le veux pas (le hop limit à 2 c'est par compromis : Docker NATs ajoute un hop, donc 2 c'est OK pour Docker mais limite plus loin).

Spoiler vécu : on a d'abord essayé `t4g.nano` (ARM, plus moderne) mais AWS l'a refusé : `"The specified instance type is not eligible for Free Tier"`. Le compte est en « Free Tier strict mode » qui empêche la création de ressources non éligibles. On a switché sur `t3.micro` (x86, free tier OK).

#### 9.6 Allouer et attacher l'Elastic IP

```bash
# Alloc
aws ec2 allocate-address \
  --profile deploy --region eu-west-3 \
  --domain vpc \
  --tag-specifications 'ResourceType=elastic-ip,Tags=[{Key=Name,Value=marche-ou-creve-eip}]'
# → eipalloc-0b8743d544497f12d, 15.237.242.223

# Attach
aws ec2 associate-address \
  --profile deploy --region eu-west-3 \
  --allocation-id eipalloc-0b8743d544497f12d \
  --instance-id i-0d32301df74930fcd
```

Maintenant l'EC2 a une IP publique stable : `15.237.242.223`.

#### 9.7 SSH + installer Docker

Une fois les status checks AWS passés (`aws ec2 wait instance-status-ok ...`), on peut se connecter :

```bash
ssh -i ~/.ssh/marche-ou-creve-prod.pem ubuntu@15.237.242.223
```

Décomposition :

- `-i` : path de la clé privée.
- `ubuntu@...` : se connecter en tant que user `ubuntu` (créé par défaut sur l'AMI Ubuntu).

Installer Docker via le script officiel :

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
```

- `get.docker.com` est un script qui détecte la distrib (Ubuntu, Debian, RHEL...) et installe Docker engine + le plugin `docker compose`.
- `usermod -aG docker ubuntu` : ajoute `ubuntu` au groupe `docker`. Sans ça il faudrait `sudo docker ...` à chaque fois. Avec ça, l'user peut parler au daemon Docker directement. **Sécurité importante** : appartenir au groupe `docker` = équivalent root sur la machine (tu peux mount `/` dans un container). On accepte le compromis sur un EC2 dédié.

Le changement de groupe ne s'applique qu'à la prochaine session SSH. Donc on déconnecte / reconnecte. Test :

```bash
docker --version
# Docker version 29.5.1
docker compose version
# Docker Compose version v5.1.3
docker run --rm hello-world
# Hello from Docker!
```

`hello-world` est une mini image qui imprime un message et se termine. Sert à vérifier que :

- Le user peut parler au daemon Docker (groupe).
- Docker peut télécharger une image depuis Docker Hub.
- Docker peut lancer un container.

### Schéma du résultat J5

```
       ┌────────────────────────────────────────────────┐
       │   AWS region eu-west-3                          │
       │                                                  │
       │  ┌──────────────────────────────────────────┐  │
       │  │  VPC vpc-01f532e32f9ad8278 (default)      │  │
       │  │                                            │  │
       │  │  ┌────────────────────────────────────┐  │  │
       │  │  │ Subnet eu-west-3a (default)         │  │  │
       │  │  │                                      │  │  │
       │  │  │  ┌──────────────────────────────┐  │  │  │
       │  │  │  │ EC2 instance                  │  │  │  │
       │  │  │  │ i-0d32301df74930fcd          │  │  │  │
       │  │  │  │ t3.micro, Ubuntu 24.04 x86   │  │  │  │
       │  │  │  │ Private IP 172.31.36.144     │  │  │  │
       │  │  │  │ Public IP 15.237.242.223 (EIP)│  │  │  │
       │  │  │  │ SG: sg-0c568554a02091eb2     │  │  │  │
       │  │  │  │   (SSH /24, HTTP+HTTPS world)│  │  │  │
       │  │  │  │ Docker 29.5.1 installé        │  │  │  │
       │  │  │  └──────────────────────────────┘  │  │  │
       │  │  └────────────────────────────────────┘  │  │
       │  └──────────────────────────────────────────┘  │
       └────────────────────────────────────────────────┘
                              ▲
                              │ SSH (key ed25519)
                              │
                       ton Mac local
```

---

## 10. J6 — Serveur NestJS dans Docker

### Objectif

Faire tourner le serveur NestJS dans un container sur l'EC2, accessible en local sur le port 3000.

### Pourquoi Docker ?

Sans Docker, il faudrait :

- Installer Node.js sur l'EC2.
- Installer pnpm.
- Copier les sources.
- Faire `pnpm install --prod`.
- Faire `pnpm build`.
- Lancer `node dist/main.js`.
- Gérer le restart en cas de crash (pm2, systemd...).

Avec Docker :

- L'image contient tout (Node + deps + code buildé).
- `docker compose up -d` lance, restart auto inclus.
- Si je veux upgrade Node 22 → 24, je change la base image, je rebuild, je redéploie. Pas d'installs/uninstalls manuels.
- Reproductible : ce qui tourne en prod est exactement ce que j'ai testé en local.

### Étapes détaillées

#### 10.1 Ajouter un .dockerignore

Pour ne pas envoyer `node_modules/`, `dist/`, `.git/` (énorme) à Docker à chaque build.

[.dockerignore](../.dockerignore) :

```
**/node_modules
**/dist
.git
.github
.husky
.vscode
.idea
docs
scripts
*.md
.env
.env.*
!.env.production
coverage
.DS_Store
```

Le `!.env.production` re-inclut ce fichier (qui contient des URLs publiques, pas des secrets).

#### 10.2 docker-compose.prod.yml

[docker-compose.prod.yml](../docker-compose.prod.yml) :

```yaml
services:
  server:
    image: marche-ou-creve-server:${IMAGE_TAG:-latest}
    container_name: marche-ou-creve-server
    restart: unless-stopped
    ports:
      - '127.0.0.1:3000:3000'
    environment:
      NODE_ENV: production
      PORT: 3000
      CORS_ORIGIN: https://game.marche-ou-creve.com
    logging:
      driver: json-file
      options:
        max-size: '10m'
        max-file: '3'
```

Décomposition :

- `image: ...:${IMAGE_TAG:-latest}` : l'image à utiliser. `${VAR:-default}` est une syntaxe shell : utilise `IMAGE_TAG` si défini, sinon `latest`.
- `container_name` : nom fixe (au lieu d'auto-généré).
- `restart: unless-stopped` : Docker redémarre le container s'il crashe, mais respecte un `docker stop` manuel. Au reboot de l'EC2, le container redémarre automatiquement.
- `ports: 127.0.0.1:3000:3000` : map le port 3000 du container sur `127.0.0.1:3000` de l'hôte. **Critical** : pas `0.0.0.0:3000` (qui exposerait au monde via le port 3000 — non, mais le SG le bloque déjà). En binding à `127.0.0.1`, on garantit que seul un process **local à l'EC2** (= Caddy) peut joindre le serveur. Defense in depth.
- `environment` : vars d'env injectées dans le container.
- `logging`: rotation des logs (10 MB × 3 fichiers max). Sans ça les logs Docker peuvent remplir le disque.

#### 10.3 Le Dockerfile multi-stage

[apps/server/Dockerfile](../apps/server/Dockerfile) :

```dockerfile
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/server apps/server
COPY packages/shared packages/shared
COPY tsconfig.base.json ./
RUN pnpm --filter @hips/shared build
RUN pnpm --filter server build

FROM base AS prod
ENV NODE_ENV=production
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/package.json apps/server/
COPY --from=build /app/apps/server/node_modules apps/server/node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/node_modules node_modules
WORKDIR /app/apps/server
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

Stage par stage :

- `base` : image Node Alpine (très petite, ~50 MB), avec `corepack` activé (gère pnpm/yarn/npm en versions épinglées via le `packageManager` field du package.json).

- `deps` : copie les manifests (`package.json`, `pnpm-lock.yaml`, workspace yaml) et fait `pnpm install`. **Astuce de cache** : tant que les manifests ne changent pas, ce layer est réutilisé du build précédent.

- `build` : copie les sources, build d'abord `@hips/shared` (sinon le serveur ne le trouve pas), puis le serveur (`nest build` produit `dist/main.js`).

- `prod` : repart d'une `base` propre (pas `build`, pour ne pas hériter des sources TS), et copie uniquement les artefacts dont la prod a besoin :
  - `apps/server/dist` : le code JS compilé.
  - `apps/server/package.json` : pour que Node puisse résoudre les modules par leur nom.
  - `apps/server/node_modules` : les deps du serveur (symlinks pnpm).
  - `packages/shared/dist` + `package.json` : le shared package buildé.
  - `node_modules` à la racine : les deps hoistées.

L'image finale fait ~150 MB (vs ~500 MB si on avait tout copié).

#### 10.4 Build cross-architecture

Mon Mac est ARM64 (Apple Silicon). Mon EC2 est x86_64. Si je build sans préciser, j'obtiens une image ARM qui ne tourne pas sur l'EC2.

Solution : `docker buildx` (extension Docker pour multi-platform builds) avec `--platform linux/amd64`.

```bash
docker buildx build \
  --platform linux/amd64 \
  --target prod \
  -t marche-ou-creve-server:j6 \
  -f apps/server/Dockerfile \
  --load \
  .
```

Décomposition :

- `--platform linux/amd64` : force le build pour x86_64 Linux. Docker utilise QEMU (émulation) pour compiler le binaire Node Alpine, etc. Plus lent qu'un build natif mais ça marche.
- `--target prod` : ne build que jusqu'au stage `prod` (pas `dev`).
- `-t name:tag` : tag de l'image.
- `-f apps/server/Dockerfile` : path du Dockerfile.
- `--load` : load l'image dans le docker engine local (par défaut buildx publie l'image dans le builder mais ne la load pas — il faut `--load` ou `--push`).
- `.` : le « build context » = le dossier qui sera envoyé au builder. Ici la racine du projet (puisque le Dockerfile copie depuis `apps/server/`, `packages/shared/`, etc.).

#### 10.5 Smoke test local

Avant de transférer, vérifier que l'image démarre correctement :

```bash
docker run --rm -d --platform linux/amd64 \
  --name moc-smoke -p 3099:3000 \
  -e CORS_ORIGIN=http://localhost:5173 \
  marche-ou-creve-server:j6

curl http://localhost:3099/
# HTTP 200

docker rm -f moc-smoke
```

- `--rm` : auto-delete à l'arrêt.
- `-d` : détaché (background).
- `--platform linux/amd64` : émulation x86 sur Mac M.
- `-p 3099:3000` : map port host:container (j'évite 3000 si déjà pris).
- `-e VAR=value` : env var.

Si le curl retourne 200 → bon signe, le serveur boot.

#### 10.6 Transfert vers l'EC2

Pour J6 on n'utilise pas encore de registry. On fait `save + scp + load`.

```bash
# Sauvegarder localement
docker save marche-ou-creve-server:j6 | gzip > /tmp/marche-ou-creve-server-j6.tar.gz
# ~84 MB compressé

# Préparer le dossier sur l'EC2
ssh -i ~/.ssh/marche-ou-creve-prod.pem ubuntu@15.237.242.223 'mkdir -p ~/app'

# Pousser image + compose file
scp -i ~/.ssh/marche-ou-creve-prod.pem \
  /tmp/marche-ou-creve-server-j6.tar.gz \
  docker-compose.prod.yml \
  ubuntu@15.237.242.223:~/app/

# Charger l'image et démarrer
ssh -i ~/.ssh/marche-ou-creve-prod.pem ubuntu@15.237.242.223 '
  cd ~/app && \
  docker load < marche-ou-creve-server-j6.tar.gz && \
  IMAGE_TAG=j6 docker compose -f docker-compose.prod.yml up -d && \
  sleep 3 && \
  docker compose -f docker-compose.prod.yml ps && \
  curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/
'
```

Tu dois voir :

- `Container marche-ou-creve-server Started`
- État `Up` dans `docker compose ps`.
- `HTTP 200`.

### Schéma du résultat J6

```
   ┌──────────────────────────────────────────────────┐
   │  EC2 i-0d32301df74930fcd                          │
   │                                                    │
   │  Ubuntu 24.04                                     │
   │  ┌────────────────────────────────────────────┐  │
   │  │ Docker engine 29.5.1                       │  │
   │  │                                              │  │
   │  │ ┌──────────────────────────────────────┐  │  │
   │  │ │ Container marche-ou-creve-server     │  │  │
   │  │ │ Image: marche-ou-creve-server:j6     │  │  │
   │  │ │ Port: 3000 (interne)                 │  │  │
   │  │ │ NODE_ENV=production                   │  │  │
   │  │ │ CORS_ORIGIN=https://game.marche-...  │  │  │
   │  │ │                                        │  │  │
   │  │ │   node dist/main.js                    │  │  │
   │  │ │   NestJS bootstrapped → listening :3000│  │  │
   │  │ └──────────────────────────────────────┘  │  │
   │  │       ▲                                    │  │
   │  │       │ port mapping                        │  │
   │  │       │ 127.0.0.1:3000 → container:3000    │  │
   │  └───────│──────────────────────────────────┘  │
   │          │                                       │
   │  ┌───────▼─────┐                                │
   │  │ 127.0.0.1   │  (loopback host)              │
   │  │ :3000       │                                │
   │  └─────────────┘                                │
   │                                                  │
   │  → NE PEUT PAS être joint depuis l'extérieur    │
   │    car bind 127.0.0.1 uniquement.               │
   │    → Caddy fera reverse proxy à J7              │
   └──────────────────────────────────────────────────┘
```

---

## 11. J7 — Caddy + TLS + DNS

### Objectif

`api.marche-ou-creve.com` accessible en HTTPS, le jeu jouable bout en bout.

### Vue d'ensemble

```
   navigateur (joueur) ──── wss://api.marche-ou-creve.com (TLS 1.3)
                                              │
                                              ▼
                                     ┌────────────────┐
                                     │  Cloudflare    │  DNS only (gris)
                                     │  DNS resolver  │  → renvoie 15.237.242.223
                                     └────────────────┘
                                              │
                                              ▼  TCP/443
                                     ┌──────────────────┐
                                     │  EC2 :443         │
                                     │  ┌────────────┐  │
                                     │  │  Caddy     │  │  termine TLS
                                     │  │  systemd   │  │  (certif Let's Encrypt)
                                     │  └─────┬──────┘  │
                                     │        │ HTTP    │
                                     │        ▼         │
                                     │  127.0.0.1:3000  │
                                     │  ┌────────────┐  │
                                     │  │ container  │  │
                                     │  │ NestJS     │  │
                                     │  └────────────┘  │
                                     └──────────────────┘
```

### Étapes détaillées

#### 11.1 Cloudflare DNS

- Dashboard CF → marche-ou-creve.com → DNS → Records → Add :
  - Type **A**
  - Name `api`
  - IPv4 `15.237.242.223`
  - Proxy : **OFF (gris, DNS only)**

**Pourquoi proxy OFF ?** Caddy doit obtenir un certif Let's Encrypt via le challenge HTTP-01. La CA appelle `http://api.marche-ou-creve.com/.well-known/acme-challenge/<token>`. Si CF est proxy ON, la requête arrive sur Cloudflare (qui ne sait pas répondre au challenge) → fail. Avec proxy OFF, le DNS répond l'IP réelle, la CA tape directement sur Caddy → Caddy répond au challenge → cert délivré.

Plus tard, une fois le cert obtenu et stable, on **peut** activer le proxy CF en mettant le mode SSL en « Full strict » : Caddy renouvelle ses certs périodiquement, Cloudflare termine le TLS en edge avec son propre cert public + re-fait du TLS vers Caddy. Mais ce n'est pas critique pour la mise en route.

Vérification :

```bash
dig +short api.marche-ou-creve.com A @1.1.1.1
# 15.237.242.223  ← bonne IP, donc proxy bien OFF (sinon on aurait une IP CF type 104.x.x.x)
```

#### 11.2 Installer Caddy via le repo officiel

Le paquet `caddy` de Ubuntu Universe est en retard. On utilise le repo officiel maintenu par l'équipe Caddy via **Cloudsmith** :

```bash
ssh -i ~/.ssh/marche-ou-creve-prod.pem ubuntu@15.237.242.223 \
  'sudo apt-get update && \
   sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl && \
   curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && \
   curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" | sudo tee /etc/apt/sources.list.d/caddy-stable.list && \
   sudo apt-get update && \
   sudo apt-get install -y caddy && \
   caddy version'
```

Étape par étape :

1. `apt-get update` : rafraîchir les indexes de paquets.
2. `apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl` : pré-requis (apt sait télécharger en HTTPS, on a curl, etc.).
3. `curl ... gpg.key | sudo gpg --dearmor -o ...` : récupère la clé publique GPG de Cloudsmith pour Caddy. La convertit en format binaire et la place dans le dossier système des keyrings. Apt vérifiera la signature des paquets Caddy contre cette clé.
4. `curl ... debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list` : ajoute le repo Cloudsmith à la liste des sources apt.
5. `apt-get update` : re-rafraîchir pour voir les nouveaux paquets disponibles dans le repo Cloudsmith.
6. `apt-get install -y caddy` : installe Caddy. Le paquet crée :
   - User `caddy` (qui fera tourner le daemon)
   - `/etc/caddy/Caddyfile` (Caddyfile par défaut, qu'on va écraser)
   - `/etc/systemd/system/caddy.service` (unit systemd)
   - Démarre et active le service Caddy automatiquement.
7. `caddy version` : sanity check → `v2.11.3`.

#### 11.3 Déposer notre Caddyfile

Notre [Caddyfile](../Caddyfile) :

```caddy
{
    email p.doazan@lehibou.com
}

api.marche-ou-creve.com {
    reverse_proxy localhost:3000

    log {
        output stdout
        format console
    }
}
```

Transfert + reload :

```bash
# scp depuis local
scp -i ~/.ssh/marche-ou-creve-prod.pem Caddyfile ubuntu@15.237.242.223:~/Caddyfile

# Sur l'EC2
ssh -i ~/.ssh/marche-ou-creve-prod.pem ubuntu@15.237.242.223 '
  sudo caddy validate --config ~/Caddyfile && \
  sudo mv ~/Caddyfile /etc/caddy/Caddyfile && \
  sudo chown root:root /etc/caddy/Caddyfile && \
  sudo systemctl reload caddy
'
```

- `caddy validate --config ...` : vérifie la syntaxe du Caddyfile sans rien démarrer.
- `mv` + `chown root:root` : on déplace dans `/etc/caddy/` (où Caddy lit sa config) et on remet le propriétaire `root` (les fichiers dans `/etc/` sont généralement root).
- `systemctl reload caddy` : envoie un signal `SIGHUP` à Caddy pour qu'il recharge sa config sans redémarrer le process. Caddy supporte le « zero-downtime reload ».

À ce moment, Caddy parse le Caddyfile, voit `api.marche-ou-creve.com`, et :

1. Démarre l'**ACME** (Automated Certificate Management Environment) pour obtenir un certif Let's Encrypt.
2. Écoute sur `:80` pour répondre au challenge HTTP-01.
3. Le challenge se fait : CA → `http://api.marche-ou-creve.com/.well-known/acme-challenge/...` → arrive sur Caddy → Caddy répond.
4. CA valide → délivre le certif.
5. Caddy active `:443` avec le cert obtenu.

Dans les logs (`journalctl -u caddy`) on a vu :

```
tls.obtain  obtaining certificate  identifier=api.marche-ou-creve.com
http.acme_client  authorization finalized  authz_status=valid
http.acme_client  validations succeeded; finalizing order
tls.obtain  certificate obtained successfully
```

Cert valide ~90 jours, Caddy le renouvelle automatiquement à ~60 jours.

#### 11.4 Vérifications

```bash
# HTTPS répond
curl -sS -o /dev/null -w "HTTPS %{http_code}\n" https://api.marche-ou-creve.com/
# HTTPS 200

# Cert Let's Encrypt
echo | openssl s_client -servername api.marche-ou-creve.com \
  -connect api.marche-ou-creve.com:443 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates
# issuer=C=US, O=Let's Encrypt, CN=E8
# subject=CN=api.marche-ou-creve.com
# notBefore=May 20 18:39:54 2026 GMT
# notAfter=Aug 18 18:39:53 2026 GMT

# HTTP redirige automatiquement vers HTTPS
curl -sS -o /dev/null -w "HTTP %{http_code} → %{redirect_url}\n" http://api.marche-ou-creve.com/
# HTTP 308 → https://api.marche-ou-creve.com/

# Socket.IO handshake
curl -sS "https://api.marche-ou-creve.com/socket.io/?EIO=4&transport=polling" | head -c 200
# 0{"sid":"...","upgrades":["websocket"],"pingInterval":25000,...}
```

Tout est vert → on ouvre `https://game.marche-ou-creve.com` dans un navigateur, on crée une room, on se connecte avec un 2ème onglet → la partie marche.

### Schéma du résultat J7

```
            Internet
   ┌─────────────────────────────────────────────────┐
   │                                                  │
   │     navigateur (Paris)                           │
   │           │                                       │
   │           │  https://game.marche-ou-creve.com    │
   │           ▼                                       │
   │     CF PoP Paris (proxy ON, SSL Flexible)        │
   │           │ HTTP                                  │
   │           ▼                                       │
   │     S3 bucket game.marche-ou-creve.com            │
   │     [HTML, JS bundle, assets]                    │
   │                                                  │
   │     ── client JS ouvre une connexion ──          │
   │                                                  │
   │     navigateur                                    │
   │           │  wss://api.marche-ou-creve.com       │
   │           │                                       │
   │           ▼  CF DNS only (gris) → 15.237.242.223 │
   │           ▼  TCP/443 direct                       │
   │                                                  │
   │     ┌────────────────────────────────────────┐  │
   │     │ EC2 15.237.242.223                      │  │
   │     │                                          │  │
   │     │ Caddy :443  (Let's Encrypt cert valid)  │  │
   │     │   │                                      │  │
   │     │   ▼ reverse_proxy localhost:3000        │  │
   │     │                                          │  │
   │     │ Container marche-ou-creve-server :3000  │  │
   │     │   NestJS, Socket.IO                      │  │
   │     │   handles game logic                     │  │
   │     └────────────────────────────────────────┘  │
   │                                                  │
   └─────────────────────────────────────────────────┘
```

---

## 12. Annexes

### A. Glossaire

| Terme         | Définition courte                                                                          |
| ------------- | ------------------------------------------------------------------------------------------ |
| **ACME**      | Protocole d'obtention auto de certificats TLS. Utilisé par Caddy avec Let's Encrypt.       |
| **AMI**       | Amazon Machine Image. Snapshot OS pour créer des EC2.                                      |
| **AZ**        | Availability Zone. Datacenter physique dans une région AWS.                                |
| **CDN**       | Content Delivery Network. Réseau de serveurs cache répartis dans le monde.                 |
| **CIDR**      | Notation IP+masque : `192.168.0.0/24` = les 256 IPs `192.168.0.0` → `192.168.0.255`.       |
| **CNAME**     | Type DNS : alias d'un nom vers un autre.                                                   |
| **DNS**       | Domain Name System. Annuaire nom → IP.                                                     |
| **EBS**       | Elastic Block Store. Volume disque AWS attachable à une EC2.                               |
| **EC2**       | Elastic Compute Cloud. VMs AWS.                                                            |
| **EIP**       | Elastic IP. IP publique réservée.                                                          |
| **GPG**       | GNU Privacy Guard. Système de chiffrement/signature, utilisé pour valider les paquets apt. |
| **HTTP**      | HyperText Transfer Protocol. Protocole du web.                                             |
| **HTTPS**     | HTTP sur TLS. Chiffré.                                                                     |
| **IaC**       | Infrastructure as Code. Décrire l'infra en fichiers (Terraform, etc.).                     |
| **IAM**       | Identity and Access Management. Service AWS de gestion d'accès.                            |
| **IMDS**      | Instance Metadata Service. Service local sur EC2 qui expose les métadonnées.               |
| **MFA**       | Multi-Factor Authentication.                                                               |
| **NACL**      | Network ACL. Firewall niveau subnet.                                                       |
| **PoP**       | Point of Presence. Datacenter d'un CDN.                                                    |
| **RP**        | Reverse Proxy.                                                                             |
| **S3**        | Simple Storage Service. Object storage AWS.                                                |
| **SG**        | Security Group. Firewall niveau instance EC2.                                              |
| **SPA**       | Single Page Application. App web entièrement client-side.                                  |
| **SSH**       | Secure Shell. Connexion shell distante chiffrée.                                           |
| **SSL**       | Ancien nom de TLS (encore utilisé par abus).                                               |
| **TLS**       | Transport Layer Security. Chiffrement de connexions TCP.                                   |
| **TTL**       | Time To Live. Durée de cache (DNS, HTTP, etc.).                                            |
| **VM**        | Virtual Machine.                                                                           |
| **VPC**       | Virtual Private Cloud. Réseau privé AWS.                                                   |
| **WAF**       | Web Application Firewall.                                                                  |
| **WebSocket** | Protocole de connexion bidirectionnelle persistante au-dessus de HTTP.                     |

### B. Commandes utiles au quotidien

#### Inspecter l'EC2 et son état

```bash
# Statut général
aws ec2 describe-instances --profile deploy --region eu-west-3 \
  --instance-ids i-0d32301df74930fcd \
  --query 'Reservations[0].Instances[0].[State.Name,PublicIpAddress,PrivateIpAddress]' \
  --output table

# Logs Caddy en live
ssh -i ~/.ssh/marche-ou-creve-prod.pem ubuntu@15.237.242.223 'sudo journalctl -u caddy -f'

# Logs du container
ssh -i ~/.ssh/marche-ou-creve-prod.pem ubuntu@15.237.242.223 'cd ~/app && docker compose -f docker-compose.prod.yml logs -f'

# Stats du système
ssh -i ~/.ssh/marche-ou-creve-prod.pem ubuntu@15.237.242.223 'top -b -n 1 | head -20; df -h; free -h'
```

#### Redéployer le serveur (J6 manual flow)

```bash
# 1. Build local
docker buildx build --platform linux/amd64 --target prod \
  -t marche-ou-creve-server:NEW_TAG -f apps/server/Dockerfile --load .

# 2. Save
docker save marche-ou-creve-server:NEW_TAG | gzip > /tmp/image.tar.gz

# 3. scp + load
scp -i ~/.ssh/marche-ou-creve-prod.pem /tmp/image.tar.gz ubuntu@15.237.242.223:~/app/

# 4. Up
ssh -i ~/.ssh/marche-ou-creve-prod.pem ubuntu@15.237.242.223 \
  'cd ~/app && docker load < image.tar.gz && IMAGE_TAG=NEW_TAG docker compose -f docker-compose.prod.yml up -d'
```

#### Re-déployer le client

```bash
./scripts/deploy-client.sh
# (build + sync vers S3)
```

#### Tester la stack publiquement

```bash
# Client up ?
curl -I https://game.marche-ou-creve.com

# API up ?
curl -I https://api.marche-ou-creve.com

# Socket.IO handshake
curl -s "https://api.marche-ou-creve.com/socket.io/?EIO=4&transport=polling"

# Voir le cert
echo | openssl s_client -servername api.marche-ou-creve.com -connect api.marche-ou-creve.com:443 2>/dev/null | openssl x509 -noout -dates
```

### C. Comment debugger quand ça casse

#### « Le site ne charge pas »

1. **DNS résout-il ?** `dig +short game.marche-ou-creve.com` doit retourner une IP.
2. **Le serveur derrière répond-il ?** `curl -I https://game.marche-ou-creve.com`.
3. **Si game→S3 down** : console S3 → bucket existe, policy public.
4. **Si api→EC2 down** : `aws ec2 describe-instances` → état `running` ? IP publique = celle attendue ?

#### « SSH timeout »

1. Mon IP a-t-elle changé ? `curl https://checkip.amazonaws.com`, comparer avec la règle SG (`aws ec2 describe-security-groups`).
2. SG : règle pour `tcp 22` présente ? Bonne IP source ?
3. NAT port-dépendant (cas vécu J5) : pool ISP qui change. Élargir à `/24` ou consulter `/var/log/auth.log` après une connexion réussie pour voir l'IP source réelle.
4. EC2 état `running` ? Health checks 2/2 ?

#### « HTTPS retourne erreur cert »

1. Cert expiré ? `openssl s_client -connect ...:443 | openssl x509 -dates`.
2. Caddy en cours d'obtention ? `sudo journalctl -u caddy | tail -50`.
3. Port 80 ouvert au monde dans le SG ? (Nécessaire pour HTTP-01.)
4. DNS pointe-t-il bien sur l'EC2 ? `dig +short api.marche-ou-creve.com`.

#### « WebSocket fails »

1. Erreur côté navigateur : Mixed content ? CORS ? Réseau ? Ouvrir DevTools.
2. Le serveur log-t-il la connexion ? `docker compose logs server`.
3. Le proxy CF est-il OFF sur `api` ? Sinon il faut s'assurer que CF supporte WebSocket (oui sur tous les plans).

#### « Container down sur l'EC2 »

```bash
ssh ... 'cd ~/app && docker compose -f docker-compose.prod.yml ps'

# Voir pourquoi il a crashé
ssh ... 'cd ~/app && docker compose -f docker-compose.prod.yml logs --tail=100'

# Redémarrer
ssh ... 'cd ~/app && docker compose -f docker-compose.prod.yml up -d'
```

### D. Coûts mensuels détaillés

| Composant                  | Coût mensuel                            | Note                                 |
| -------------------------- | --------------------------------------- | ------------------------------------ |
| EC2 t3.micro               | 0 € (free tier 1 an), puis ~6.40 €/mois | 750 h/mois gratuites la 1ère année   |
| EBS gp3 12 GB              | ~1 € (free tier 30 GB la 1ère année)    |                                      |
| S3 storage + requests      | < 0.50 €                                | très peu de fichiers, peu de trafic  |
| S3 egress                  | 0 € via CF cache                        | CF cache les assets, peu d'egress S3 |
| Elastic IP                 | 0 € (attachée)                          | gratuit tant qu'utilisée             |
| Cloudflare DNS + CDN + TLS | 0 €                                     | plan free                            |
| Cloudflare Registrar       | ~10 €/an                                | prix coûtant, ~0.85 €/mois           |
| **Total 1ère année**       | **~1 €/mois**                           | grâce au free tier                   |
| **Total steady state**     | **~7 €/mois**                           | après free tier EC2                  |

### E. Vocabulaire dev → infra (analogies)

| Concept dev                   | Équivalent infra                            |
| ----------------------------- | ------------------------------------------- |
| `package.json` deps           | image Docker base + RUN install             |
| `npm run build` artifact      | image Docker                                |
| Variable d'env via `.env`     | env var injectée dans le container          |
| Imports relatifs vs npm       | filesystem container vs volumes             |
| `console.log`                 | `docker logs` / `journalctl`                |
| try/catch + retry             | `restart: unless-stopped`                   |
| Memoization                   | cache CF / cache Docker layers              |
| Authentification JWT          | clé SSH (signature asymétrique)             |
| Liste blanche dans le code    | Security Group ingress rules                |
| `localhost:3000` en dev       | `127.0.0.1:3000` sur l'EC2 (Caddy y accède) |
| Service registry / import map | DNS                                         |
| `git clone`                   | `docker pull`                               |
| `git push origin main`        | `docker push ghcr.io/...` (à J8)            |
| `eslint --fix`                | `caddy validate`                            |
| `npm install` (cold)          | `docker pull` (cold)                        |

---

## Conclusion

Tu as maintenant une stack prod complète :

- Client statique servi via S3 + Cloudflare (CDN, TLS, DNS).
- Serveur NestJS containerisé sur EC2.
- Caddy reverse proxy avec TLS Let's Encrypt auto-renouvelé.
- Tout joignable sur `https://game.marche-ou-creve.com` et `wss://api.marche-ou-creve.com`.

**Prochaines étapes** (toujours dans [deployment-plan.md](deployment-plan.md)) :

- **J8** — CI/CD GitHub Actions : push sur `main` = déploiement automatique.
- **J9** — Monitoring + hardening : uptime checks, alertes, fail2ban, unattended-upgrades.
- **J10** (optionnel) — Backup + plan de reprise : snapshots EBS, doc disaster-recovery.

Et au-delà :

- Persistance (Postgres externalisé : Neon, Supabase).
- Auth users.
- API REST profil / historique.
- Leaderboard.
- Phase B (upgrade VM + Redis pour ~100 joueurs concurrents).
- Phase C (HA : ALB + 2 EC2 multi-AZ pour ~30 €/mois).
