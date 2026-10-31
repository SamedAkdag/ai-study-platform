import { useEffect, useId, useRef, useState } from 'react'
import {
  MOOD_THEMES,
  applyMoodTheme,
  readMoodTheme,
  type MoodThemeId,
} from '@/lib/moodTheme'

export default function ThemePicker() {
  const labelId = useId()
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<MoodThemeId>(() => readMoodTheme())
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    applyMoodTheme(theme)
  }, [theme])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const current = MOOD_THEMES.find((t) => t.id === theme) ?? MOOD_THEMES[0]!

  return (
    <div className="theme-picker" ref={rootRef}>
      <button
        type="button"
        className="theme-picker__btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelId}
        title="Çalışma ruhu"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="theme-picker__swatch"
          style={{ background: current.swatch }}
          aria-hidden
        />
        <span id={labelId} className="theme-picker__label">
          {current.label}
        </span>
      </button>
      {open ? (
        <ul
          className="theme-picker__menu surface-panel"
          role="listbox"
          aria-label="Çalışma ruhu"
        >
          {MOOD_THEMES.map((t) => (
            <li key={t.id} role="option" aria-selected={t.id === theme}>
              <button
                type="button"
                className={`theme-picker__option${
                  t.id === theme ? ' is-active' : ''
                }`}
                onClick={() => {
                  setTheme(t.id)
                  setOpen(false)
                }}
              >
                <span
                  className="theme-picker__swatch"
                  style={{ background: t.swatch }}
                  aria-hidden
                />
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
