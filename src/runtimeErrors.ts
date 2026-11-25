export function installRuntimeErrorReporter(): () => void {
  const report = (message: string) => {
    console.error(`[Blood Ante] ${message}`)
    window.dispatchEvent(new CustomEvent('blood-ante:runtime-error', { detail: { message } }))
  }
  const onError = (event: ErrorEvent) => report(event.message || '未知界面错误')
  const onRejection = (event: PromiseRejectionEvent) => {
    report(event.reason instanceof Error ? event.reason.message : '未知异步错误')
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
