export const SFX_FILES = {
  shotgunBlast: 'sfx/shotgun-blast.mp3',
  shotgunReload: 'sfx/shotgun-reload.mp3',
  shotgunPump: 'sfx/shotgun-pump.wav',
  chamberClick: 'sfx/chamber-click.mp3',
  cardShuffle: 'sfx/card-shuffle.wav',
  cardsTable: 'sfx/cards-table.mp3',
  paperRustle: 'sfx/paper-rustle.mp3',
  hammerHit: 'sfx/hammer-hit.wav',
  glassClink: 'sfx/glass-clink.wav',
  doorClose: 'sfx/door-close.wav',
  heartbeatSingle: 'sfx/heartbeat-single.wav',
  heartbeatFast: 'sfx/heartbeat-fast.wav',
} as const

export type SfxId = keyof typeof SFX_FILES

export const SFX_SOURCES: Readonly<Record<SfxId, { readonly title: string; readonly author: string; readonly url: string; readonly license: string }>> = {
  shotgunBlast: { title: 'Shotgun Blast', author: 'Universfield', url: 'https://pixabay.com/sound-effects/film-special-effects-shotgun-blast-352038/', license: 'Pixabay Content License' },
  shotgunReload: { title: 'Cinematic Shotgun with Reload', author: 'DRAGON-STUDIO', url: 'https://pixabay.com/sound-effects/cinematic-shotgun-with-reload-467480/', license: 'Pixabay Content License' },
  shotgunPump: { title: 'Shotgun long pump', author: 'Mixkit', url: 'https://mixkit.co/free-sound-effects/download/1666/', license: 'Mixkit Sound Effects Free License' },
  chamberClick: { title: 'Handgun click', author: 'Mixkit', url: 'https://mixkit.co/free-sound-effects/download/1660/', license: 'Mixkit Sound Effects Free License' },
  cardShuffle: { title: 'Thin metal card deck shuffle', author: 'Mixkit', url: 'https://mixkit.co/free-sound-effects/download/3175/', license: 'Mixkit Sound Effects Free License' },
  cardsTable: { title: 'Playing cards on a wooden table', author: 'snuq / Freesound', url: 'https://pixabay.com/sound-effects/film-special-effects-playing-cards-on-a-wooden-table-55088/', license: 'Pixabay Content License' },
  paperRustle: { title: 'Paper Rustle', author: 'BenjaminNelan / Freesound', url: 'https://pixabay.com/sound-effects/film-special-effects-paper-rustle-81855/', license: 'Pixabay Content License' },
  hammerHit: { title: 'Metal hammer hit', author: 'Mixkit', url: 'https://mixkit.co/free-sound-effects/download/833/', license: 'Mixkit Sound Effects Free License' },
  glassClink: { title: 'Glasses clinking', author: 'Mixkit', url: 'https://mixkit.co/free-sound-effects/download/2836/', license: 'Mixkit Sound Effects Free License' },
  doorClose: { title: 'Prison metal door close', author: 'Mixkit', url: 'https://mixkit.co/free-sound-effects/download/201/', license: 'Mixkit Sound Effects Free License' },
  heartbeatSingle: { title: 'Human single heart beat', author: 'Mixkit', url: 'https://mixkit.co/free-sound-effects/download/490/', license: 'Mixkit Sound Effects Free License' },
  heartbeatFast: { title: 'Fast Heartbeat', author: 'Mixkit', url: 'https://mixkit.co/free-sound-effects/download/493/', license: 'Mixkit Sound Effects Free License' },
}
