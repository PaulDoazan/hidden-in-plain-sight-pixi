# Audio credits

## Music

Both tracks were supplied by the project owner, and each is stored twice: Ogg/
Opus for Chrome, Firefox and Edge, MP3 for Safari, transcoded from the original
with ffmpeg. Files are named after the role they play, not the title, because
the two titles differ by one letter. Music is mixed as a bed, well under the
effects — see `MUSIC_MIX` in `apps/client/src/systems/AudioManager.ts`.

- `lobby.ogg` / `lobby.mp3` — "Course des Zombies". Menu, waiting room and
  bonus draft.
- `round.ogg` / `round.mp3` — "Course de Zombies". Starts when the round does
  and carries on through the scoreboard, until the lobby comes back.

## Zombie voices (`zombie/`)

Real recordings, both sources released under **CC0 1.0** (public domain
dedication — no attribution required; credited here anyway).

- `idle-*.mp3`, `walk-*.mp3`, `run-*.mp3`, `death-*.mp3` — from **"Zombies Sound
  Pack"** by _artisticdude_, OpenGameArt, CC0:
  https://opengameart.org/content/zombies-sound-pack

Each take was trimmed of leading silence, loudness-matched (EBU R128, I = -20
LUFS) and re-encoded as mono 22.05 kHz MP3 at 48 kbps. MP3 because it is the one
format `AudioContext.decodeAudioData` accepts in every browser, Safari included.

## Everything else

Every other sound effect — UI clicks, gunshots, impacts, bonuses, jingles — is
synthesised at runtime from oscillators and filtered noise, with no asset file
at all. The recipes live in `apps/client/src/systems/SoundBank.ts`.
