export function isDocumentBackgrounded(): boolean {
  return document.hidden && !document.hasFocus()
}
