import React from 'react'

interface SchoolLogoProps {
  size?: number
  className?: string
  style?: React.CSSProperties
}

/**
 * Modern minimalist School Emblem with school emoji icon in a styled container
 */
export default function SchoolLogo({ size = 80, className = '', style = {} }: SchoolLogoProps) {
  const emojiSize = Math.max(16, Math.round(size * 0.54))
  const borderRadius = Math.max(8, Math.round(size * 0.28))

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        aspectRatio: '1 / 1',
        flexShrink: 0,
        position: 'relative',
        borderRadius,
        background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
        border: '1.5px solid #BFDBFE',
        boxShadow: '0 4px 12px rgba(37, 99, 235, 0.12)',
        userSelect: 'none',
        ...style,
      }}
      title="دبستان حضرت قائم (عج)"
      aria-label="آیکون مدرسه"
    >
      <span
        role="img"
        aria-label="مدرسه"
        style={{
          fontSize: emojiSize,
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.08))',
        }}
      >
        🏫
      </span>
    </div>
  )
}
