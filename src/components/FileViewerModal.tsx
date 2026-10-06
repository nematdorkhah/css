import { useState, useMemo, useEffect } from 'react'
import { toPersianDigits } from '../utils/persianNumbers'
import { supabase } from '../supabaseClient'

export default function FileViewerModal({
  url,
  fileName,
  onClose,
}: {
  url: string
  fileName?: string
  onClose: () => void
}) {
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [loading, setLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  // Resolve Supabase or relative URL if necessary
  const resolvedUrl = useMemo(() => {
    if (!url) return ''
    const trimmed = url.trim()
    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('data:') ||
      trimmed.startsWith('blob:')
    ) {
      return trimmed
    }
    // Attempt public URL from materials or submissions bucket
    try {
      const { data: matData } = supabase.storage.from('materials').getPublicUrl(trimmed)
      if (matData?.publicUrl) return matData.publicUrl
    } catch {}
    try {
      const { data: subData } = supabase.storage.from('submissions').getPublicUrl(trimmed)
      if (subData?.publicUrl) return subData.publicUrl
    } catch {}
    return trimmed
  }, [url])

  // Reset states whenever URL changes
  useEffect(() => {
    setLoading(true)
    setHasError(false)
    setZoom(1)
    setRotation(0)
  }, [resolvedUrl])

  // Listen for Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const cleanUrl = (resolvedUrl || '').split('?')[0].toLowerCase()
  const isPdf = /\.pdf($|\?)/i.test(cleanUrl) || resolvedUrl.startsWith('data:application/pdf')
  const isVideo = /\.(mp4|webm|ogg|mov)($|\?)/i.test(cleanUrl) || resolvedUrl.startsWith('data:video/')
  const isAudio = /\.(mp3|wav|ogg|m4a)($|\?)/i.test(cleanUrl) || resolvedUrl.startsWith('data:audio/')
  const isImage = !isPdf && !isVideo && !isAudio

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(3.5, Math.round((prev + 0.25) * 100) / 100))
  }

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(0.4, Math.round((prev - 0.25) * 100) / 100))
  }

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360)
  }

  const handleReset = () => {
    setZoom(1)
    setRotation(0)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(15, 23, 42, 0.88)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: fullscreen ? 0 : 12,
        direction: 'rtl',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: fullscreen ? 0 : 20,
          width: fullscreen ? '100vw' : '100%',
          maxWidth: fullscreen ? '100vw' : 980,
          height: fullscreen ? '100vh' : 'auto',
          maxHeight: fullscreen ? '100vh' : '94vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          border: fullscreen ? 'none' : '3px solid #0F172A',
          transition: 'all 0.2s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header & Controls Bar */}
        <div
          style={{
            padding: '12px 18px',
            background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          {/* File Name & Type Icon */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 22 }}>
              {isImage ? '🖼️' : isPdf ? '📄' : isVideo ? '🎬' : isAudio ? '🎵' : '📎'}
            </span>
            <span
              style={{
                fontWeight: 900,
                fontSize: 14.5,
                color: '#FFFFFF',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={fileName || 'نمایش فایل'}
            >
              {fileName || (isPdf ? 'فایل سند PDF' : isVideo ? 'فایل ویدیو' : 'مشاهده تصویر پیوست')}
            </span>
          </div>

          {/* Action Tools */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, direction: 'ltr', flexWrap: 'wrap' }}>
            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              style={{
                background: '#EF4444',
                color: '#FFFFFF',
                border: 'none',
                width: 36,
                height: 36,
                borderRadius: '50%',
                fontSize: 18,
                fontWeight: 900,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(239, 68, 68, 0.4)',
                transition: 'transform 0.15s ease',
              }}
              title="بستن پنجره (Esc)"
            >
              ✕
            </button>

            {/* Fast Download Button */}
            <a
              href={resolvedUrl}
              download={fileName || 'attachment'}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: '#10B981',
                color: '#FFFFFF',
                textDecoration: 'none',
                padding: '6px 14px',
                borderRadius: 10,
                fontWeight: 800,
                fontSize: 13,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
              }}
              title="دانلود فایل به حافظه"
            >
              📥 دانلود سریع
            </a>

            {/* Fullscreen Toggle */}
            <button
              type="button"
              onClick={() => setFullscreen(!fullscreen)}
              style={{
                background: 'rgba(255, 255, 255, 0.15)',
                color: '#FFFFFF',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                padding: '6px 10px',
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
              title={fullscreen ? 'خروج از تمام‌صفحه' : 'نمایش تمام‌صفحه'}
            >
              {fullscreen ? '⤢ خروج' : '⤢ تمام‌صفحه'}
            </button>

            {/* Image Manipulation Controls (Zoom & Rotate) */}
            {isImage && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: 'rgba(255, 255, 255, 0.18)',
                  borderRadius: 10,
                  padding: '2px 4px',
                  gap: 4,
                }}
              >
                <button
                  type="button"
                  onClick={handleRotate}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#FFFFFF',
                    width: 28,
                    height: 28,
                    cursor: 'pointer',
                    fontSize: 15,
                  }}
                  title="چرخش ۹۰ درجه تصویر"
                >
                  🔄
                </button>
                <button
                  type="button"
                  onClick={handleZoomOut}
                  disabled={zoom <= 0.4}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#FFFFFF',
                    width: 26,
                    height: 28,
                    cursor: zoom > 0.4 ? 'pointer' : 'default',
                    fontSize: 18,
                    fontWeight: 900,
                    opacity: zoom <= 0.4 ? 0.35 : 1,
                  }}
                  title="کوچک‌نمایی"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#FACC15',
                    fontSize: 12,
                    fontWeight: 900,
                    padding: '0 4px',
                    cursor: 'pointer',
                  }}
                  title="بزرگنمایی پیش‌فرض (۱۰۰٪)"
                >
                  {toPersianDigits(Math.round(zoom * 100))}%
                </button>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  disabled={zoom >= 3.5}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#FFFFFF',
                    width: 26,
                    height: 28,
                    cursor: zoom < 3.5 ? 'pointer' : 'default',
                    fontSize: 18,
                    fontWeight: 900,
                    opacity: zoom >= 3.5 ? 0.35 : 1,
                  }}
                  title="بزرگ‌نمایی"
                >
                  +
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Content Viewer Body */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'auto',
            background: '#F8FAFC',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: fullscreen ? 0 : 12,
            minHeight: fullscreen ? 'calc(100vh - 65px)' : 360,
            maxHeight: fullscreen ? 'calc(100vh - 65px)' : 'calc(94vh - 65px)',
          }}
        >
          {/* Skeleton / Spinner Loading State */}
          {loading && !hasError && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#F8FAFC',
                zIndex: 10,
                gap: 14,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  border: '4px solid #E2E8F0',
                  borderTopColor: '#2563EB',
                  borderRadius: '50%',
                  animation: 'spinSmooth 0.8s linear infinite',
                }}
              />
              <div style={{ fontWeight: 800, fontSize: 13.5, color: '#475569' }}>
                در حال بارگذاری و آماده‌سازی فایل...
              </div>
              <div style={{ fontSize: 11.5, color: '#94A3B8' }}>
                لطفاً شکیبا باشید
              </div>
            </div>
          )}

          {/* Render by File Type */}
          {isImage ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: '100%',
                overflow: 'auto',
                padding: 10,
              }}
            >
              {!hasError ? (
                <img
                  src={resolvedUrl}
                  alt={fileName || 'تصویر پیوست'}
                  onLoad={() => setLoading(false)}
                  onError={() => {
                    setLoading(false)
                    setHasError(true)
                  }}
                  style={{
                    maxWidth: zoom <= 1 ? '100%' : 'none',
                    maxHeight: zoom <= 1 ? (fullscreen ? '90vh' : '75vh') : 'none',
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                    transformOrigin: 'center center',
                    transition: 'transform 0.15s ease-out',
                    borderRadius: 10,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                    objectFit: 'contain',
                    display: loading ? 'none' : 'block',
                  }}
                />
              ) : (
                <div style={{ textAlign: 'center', padding: 32 }}>
                  <div style={{ fontSize: 42, marginBottom: 12 }}>⚠️</div>
                  <h4 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 800, color: '#DC2626' }}>
                    خطا در نمایش تصویر
                  </h4>
                  <p style={{ margin: '0 0 16px', fontSize: 13, color: '#64748B' }}>
                    فایل ممکن است در دسترس نباشد یا منقضی شده باشد.
                  </p>
                  <a
                    href={resolvedUrl}
                    download={fileName || 'attachment'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn"
                    style={{ display: 'inline-flex', width: 'auto', padding: '8px 16px', fontSize: 13 }}
                  >
                    📥 دریافت مستقیم فایل
                  </a>
                </div>
              )}
            </div>
          ) : isPdf ? (
            <div style={{ width: '100%', height: fullscreen ? '100%' : '76vh' }}>
              <iframe
                src={`${resolvedUrl}#toolbar=1&navpanes=0`}
                title={fileName || 'سند PDF'}
                onLoad={() => setLoading(false)}
                onError={() => {
                  setLoading(false)
                  setHasError(true)
                }}
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  borderRadius: fullscreen ? 0 : 10,
                  background: '#FFFFFF',
                }}
              />
            </div>
          ) : isVideo ? (
            <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
              <video
                controls
                autoPlay={false}
                src={resolvedUrl}
                onLoadedData={() => setLoading(false)}
                onError={() => {
                  setLoading(false)
                  setHasError(true)
                }}
                style={{
                  maxWidth: '100%',
                  maxHeight: fullscreen ? '86vh' : '74vh',
                  borderRadius: 12,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                  display: loading ? 'none' : 'block',
                }}
              />
            </div>
          ) : isAudio ? (
            <div
              style={{
                padding: 40,
                textAlign: 'center',
                background: '#FFFFFF',
                borderRadius: 16,
                border: '2px solid #E2E8F0',
                maxWidth: 480,
                width: '100%',
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 12 }}>🎵</div>
              <h4 style={{ margin: '0 0 16px 0', fontSize: 16, fontWeight: 800 }}>
                {fileName || 'پخش فایل صوتی'}
              </h4>
              <audio
                controls
                src={resolvedUrl}
                onLoadedData={() => setLoading(false)}
                onError={() => {
                  setLoading(false)
                  setHasError(true)
                }}
                style={{ width: '100%' }}
              />
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, background: '#FFFFFF', borderRadius: 16, border: '2px solid #E2E8F0', maxWidth: 480 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📎</div>
              <h4 style={{ fontSize: 16, fontWeight: 900, color: '#0F172A', marginBottom: 8 }}>
                {fileName || 'فایل ضمیمه'}
              </h4>
              <p style={{ fontWeight: 600, color: '#64748B', fontSize: 13, marginBottom: 20, lineHeight: 1.7 }}>
                پیش‌نمایش درون‌برنامه‌ای برای این فرمت پشتیبانی نمی‌شود. می‌توانید مستقیماً فایل را دریافت کنید.
              </p>
              <a
                href={resolvedUrl}
                download={fileName || 'attachment'}
                target="_blank"
                rel="noopener noreferrer"
                className="btn"
                style={{ display: 'inline-flex', width: 'auto', padding: '10px 20px', fontSize: 14 }}
              >
                📥 دانلود مستقیم فایل
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
