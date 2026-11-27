export type DialogueChannel = 'player' | 'enemy' | 'sister'

export const TYPE_CHAR_MS = 55
export const TYPE_PAUSE_MS = 180
export const TYPE_PAUSE_CHARS = '，。、！？…—'

export function typingDurationMs(text: string): number {
  return [...text].reduce((total, char) => total + TYPE_CHAR_MS + (TYPE_PAUSE_CHARS.includes(char) ? TYPE_PAUSE_MS : 0), 0)
}
