import React, { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    console.error('getDerivedStateFromError captured:', error)
    return { hasError: true, error, errorInfo: null }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary componentDidCatch caught an error:', error, errorInfo)
    this.setState({ error, errorInfo })
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleResetAll = () => {
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch (e) {
      console.warn(e)
    }
    window.location.href = '/'
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #F8FAFC 0%, #EFF6FF 100%)',
            padding: '24px',
            fontFamily: "'Vazirmatn', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            color: '#0F172A',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              maxWidth: '600px',
              width: '100%',
              background: '#FFFFFF',
              borderRadius: '24px',
              padding: '32px 24px',
              boxShadow: '0 20px 40px -10px rgba(15, 23, 42, 0.1)',
              border: '1px solid #E2E8F0',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '20px',
                background: '#FEF2F2',
                border: '1.5px solid #FECDD3',
                color: '#EF4444',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px',
                margin: '0 auto 18px',
              }}
            >
              ⚠️
            </div>

            <h2
              style={{
                margin: '0 0 8px',
                fontSize: '20px',
                fontWeight: 800,
                color: '#0F172A',
              }}
            >
              خطایی در اجرای سامانه رخ داد
            </h2>

            <p
              style={{
                margin: '0 0 16px',
                fontSize: '14px',
                color: '#64748B',
                lineHeight: 1.6,
              }}
            >
              متن دقیق ارور برای بررسی و خطایابی در کادر زیر درج شده است:
            </p>

            {this.state.error && (
              <div
                style={{
                  background: '#1E293B',
                  border: '1px solid #334155',
                  borderRadius: '12px',
                  padding: '16px',
                  margin: '0 0 20px',
                  textAlign: 'left',
                  direction: 'ltr',
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  color: '#F87171',
                  maxHeight: '220px',
                  overflowY: 'auto',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                }}
              >
                <div style={{ color: '#FCD34D', fontWeight: 'bold', marginBottom: '8px' }}>
                  {this.state.error.name}: {this.state.error.message}
                </div>
                {this.state.error.stack && (
                  <div style={{ color: '#94A3B8', fontSize: '11px', lineHeight: 1.5 }}>
                    {this.state.error.stack}
                  </div>
                )}
                {this.state.errorInfo?.componentStack && (
                  <div style={{ color: '#60A5FA', fontSize: '11px', marginTop: '8px', lineHeight: 1.5 }}>
                    Component Stack:
                    {this.state.errorInfo.componentStack}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  flex: 1,
                  padding: '12px 18px',
                  borderRadius: '12px',
                  border: 'none',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
                }}
              >
                🔄 بارگذاری مجدد
              </button>
              <button
                type="button"
                onClick={this.handleResetAll}
                style={{
                  flex: 1,
                  padding: '12px 18px',
                  borderRadius: '12px',
                  border: '1px solid #E2E8F0',
                  background: '#F1F5F9',
                  color: '#475569',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                🧹 پاکسازی و شروع مجدد
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

