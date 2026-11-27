import { Component, type ErrorInfo, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Blood Ante] 界面渲染失败', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-abyss-950 px-6 text-center text-bone-200">
          <h1 className="font-display text-2xl">牌桌暂时失去了响应</h1>
          <p className="max-w-md text-sm text-bone-200/60">刷新页面可重新加载游戏；若已有可用检查点，将从最近保存的层继续。</p>
          <button type="button" className="metal-btn min-h-11 px-6" onClick={() => window.location.reload()}>刷新游戏</button>
        </main>
      )
    }
    return this.props.children
  }
}
