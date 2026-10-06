import { useState, useMemo, useEffect } from 'react'
import { toPersianDigits } from '../utils/persianNumbers'
import { sortByLastName } from '../utils/persianSort'
import { tizhooshanTopicsData } from '../data/tizhooshanQuestions'

interface StudentDuolingoData {
  studentId: string
  studentName: string
  totalXp: number
  gems: number
  streak: number
  hearts: number
  unlockedTopicIndex: number
  completedTopicsCount: number
  lastActiveDate: string
  hasStarted: boolean
}

export default function TeacherDuolingoTracker({
  students,
  onClose,
}: {
  students: any[]
  onClose?: () => void
}) {
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<'xp' | 'name' | 'step'>('xp')
  const [serverProgressMap, setServerProgressMap] = useState<Record<string, any>>({})
  const [isRefreshing, setIsRefreshing] = useState(false)

  const fetchLiveProgress = () => {
    setIsRefreshing(true)
    fetch('/api/tizhooshan/all-progress')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.progressMap) {
          setServerProgressMap(data.progressMap)
        }
      })
      .catch((err) => console.warn('Failed to fetch server tizhooshan all-progress', err))
      .finally(() => setIsRefreshing(false))
  }

  // Fetch live cloud progress from server on mount
  useEffect(() => {
    fetchLiveProgress()
  }, [])

  // Load progress data from Server + localStorage (100% REAL DATA, NO FAKE SEEDS)
  const studentsProgress = useMemo(() => {
    // 1. Try class registry from localStorage
    let classMap: Record<string, any> = {}
    try {
      const raw = localStorage.getItem('tizhooshan_class_progress')
      if (raw) classMap = JSON.parse(raw)
    } catch (e) {
      console.warn(e)
    }

    // 2. Gather data for all students in class
    return students.map((s) => {
      // Check server cloud progress first!
      let data = serverProgressMap[s.id]

      if (!data) {
        data = classMap[s.id]
      }

      if (!data) {
        try {
          const directRaw = localStorage.getItem(`tizhooshan_duolingo_${s.id}`)
          if (directRaw) {
            const p = JSON.parse(directRaw)
            data = {
              studentId: s.id,
              studentName: s.full_name,
              totalXp: p.totalXp ?? 0,
              gems: p.gems ?? 25,
              streak: p.streak ?? 0,
              hearts: p.hearts ?? 5,
              unlockedTopicIndex: p.unlockedTopicIndex ?? 0,
              completedTopicsCount: Object.keys(p.completedTopics || {}).length,
              lastActiveDate: p.lastActiveDate ?? 'امروز',
            }
          }
        } catch {
          // ignore
        }
      }

      // If student has not started yet, return clean real baseline (NO FAKE RANDOM NUMBERS)
      if (!data) {
        return {
          studentId: s.id,
          studentName: s.full_name,
          totalXp: 0,
          gems: 25,
          streak: 0,
          hearts: 5,
          unlockedTopicIndex: 0,
          completedTopicsCount: 0,
          lastActiveDate: 'هنوز شروع نکرده',
          hasStarted: false,
        }
      }

      const totalXp = Number(data.totalXp) || 0
      const completedTopicsCount = typeof data.completedTopicsCount === 'number'
        ? data.completedTopicsCount
        : Object.keys(data.completedTopics || {}).length
      const unlockedTopicIndex = Number(data.unlockedTopicIndex) || 0
      const hasStarted = totalXp > 0 || completedTopicsCount > 0 || unlockedTopicIndex > 0

      return {
        studentId: s.id,
        studentName: s.full_name,
        totalXp,
        gems: Number(data.gems) ?? 25,
        streak: Number(data.streak) || 0,
        hearts: typeof data.hearts === 'number' ? data.hearts : 5,
        unlockedTopicIndex,
        completedTopicsCount,
        lastActiveDate: data.lastActiveDate ?? (hasStarted ? 'امروز' : 'هنوز شروع نکرده'),
        hasStarted,
      } as StudentDuolingoData
    })
  }, [students, serverProgressMap])

  // Summary stats
  const totalClassXp = useMemo(
    () => studentsProgress.reduce((sum, sp) => sum + (sp.totalXp || 0), 0),
    [studentsProgress]
  )
  const avgCompletedSteps = useMemo(
    () =>
      studentsProgress.length > 0
        ? Math.round(
            (studentsProgress.reduce((sum, sp) => sum + (sp.completedTopicsCount || 0), 0) /
              studentsProgress.length) *
              10
          ) / 10
        : 0,
    [studentsProgress]
  )

  const filtered = useMemo(() => {
    let list = studentsProgress.filter((s) =>
      s.studentName.toLowerCase().includes(search.trim().toLowerCase())
    )

    if (sortField === 'xp') {
      list.sort((a, b) => b.totalXp - a.totalXp)
    } else if (sortField === 'step') {
      list.sort((a, b) => b.unlockedTopicIndex - a.unlockedTopicIndex)
    } else {
      list = sortByLastName(list, 'studentName')
    }
    return list
  }, [studentsProgress, search, sortField])

  return (
    <div style={{ direction: 'rtl', padding: 4 }}>
      {/* Header Bar */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 50%, #4338CA 100%)',
          borderRadius: 16,
          padding: '16px 20px',
          color: '#FFFFFF',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 32 }}>🦉</span>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#FFFFFF' }}>
                پایش پیشرفت تیزهوشان و مهارت‌های دولینگو
              </h3>
              <p style={{ margin: 0, fontSize: 12.5, color: '#C7D2FE' }}>
                رصد زنده و واقعی پیشروی گام‌به‌گام بچه‌ها، قلب‌ها، استریک و مراحل طی‌شده بدون داده‌های تصادفی
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={fetchLiveProgress}
              disabled={isRefreshing}
              style={{
                background: 'rgba(255,255,255,0.15)',
                color: '#FFFFFF',
                border: '1px solid rgba(255,255,255,0.3)',
                padding: '6px 12px',
                borderRadius: 10,
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>{isRefreshing ? '⏳' : '🔄'}</span>
              <span>{isRefreshing ? 'در حال بروزرسانی...' : 'بروزرسانی داده‌ها'}</span>
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 10,
                  width: 32,
                  height: 32,
                  cursor: 'pointer',
                  fontSize: 16,
                  fontWeight: 900,
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Quick KPI Strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: 10,
            marginTop: 14,
          }}
        >
          <div style={{ background: 'rgba(255,255,255,0.12)', padding: '10px 14px', borderRadius: 12 }}>
            <div style={{ fontSize: 11, color: '#E0E7FF' }}>مجموع امتیاز واقعی کلاس</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#FACC15', marginTop: 2 }}>
              {toPersianDigits(totalClassXp)} XP ⚡
            </div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.12)', padding: '10px 14px', borderRadius: 12 }}>
            <div style={{ fontSize: 11, color: '#E0E7FF' }}>دانش‌آموزان در حال تمرین</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#67E8F9', marginTop: 2 }}>
              {toPersianDigits(studentsProgress.filter((s) => s.hasStarted).length)} از {toPersianDigits(students.length)} نفر
            </div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.12)', padding: '10px 14px', borderRadius: 12 }}>
            <div style={{ fontSize: 11, color: '#E0E7FF' }}>میانگین گام‌های تکمیل‌شده</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#4ADE80', marginTop: 2 }}>
              {toPersianDigits(avgCompletedSteps)} از {toPersianDigits(tizhooshanTopicsData.length)} گام
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 14,
          alignItems: 'center',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 جستجوی دانش‌آموز در لیست تیزهوشان..."
          className="mobile-input"
          style={{ maxWidth: 280, height: 40, fontSize: 13 }}
        />

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B' }}>مرتب‌سازی:</span>
          <button
            type="button"
            className="upload-btn"
            style={{
              padding: '5px 10px',
              fontSize: 12,
              background: sortField === 'xp' ? '#4F46E5' : '#FFFFFF',
              color: sortField === 'xp' ? '#FFFFFF' : '#1E293B',
              borderColor: '#4F46E5',
            }}
            onClick={() => setSortField('xp')}
          >
            بیشترین XP ⚡
          </button>
          <button
            type="button"
            className="upload-btn"
            style={{
              padding: '5px 10px',
              fontSize: 12,
              background: sortField === 'step' ? '#4F46E5' : '#FFFFFF',
              color: sortField === 'step' ? '#FFFFFF' : '#1E293B',
              borderColor: '#4F46E5',
            }}
            onClick={() => setSortField('step')}
          >
            پیشروترین گام 🗺️
          </button>
          <button
            type="button"
            className="upload-btn"
            style={{
              padding: '5px 10px',
              fontSize: 12,
              background: sortField === 'name' ? '#4F46E5' : '#FFFFFF',
              color: sortField === 'name' ? '#FFFFFF' : '#1E293B',
              borderColor: '#4F46E5',
            }}
            onClick={() => setSortField('name')}
          >
            الفبایی 🔤
          </button>
        </div>
      </div>

      {/* Students Progress Table */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          maxHeight: '60vh',
          overflowY: 'auto',
          paddingLeft: 2,
        }}
      >
        {filtered.map((s, idx) => {
          const currentTopic = tizhooshanTopicsData[s.unlockedTopicIndex] || tizhooshanTopicsData[0]
          const progressPercent = Math.min(
            100,
            Math.round(((s.unlockedTopicIndex + 1) / tizhooshanTopicsData.length) * 100)
          )

          return (
            <div
              key={s.studentId}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                borderRadius: 14,
                border: '1.5px solid #E2E8F0',
                background: idx < 3 ? '#FEFCE8' : '#FFFFFF',
                boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              {/* Student identity & rank */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 900,
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: idx === 0 ? '#FACC15' : idx === 1 ? '#E2E8F0' : idx === 2 ? '#FDBA74' : '#F1F5F9',
                    color: '#0F172A',
                  }}
                >
                  {toPersianDigits(idx + 1)}
                </span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: '#0F172A' }}>
                    {s.studentName}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#475569', marginTop: 2 }}>
                    📍 در حال حاضر در: <strong>{currentTopic ? currentTopic.topic : 'شروع مسیر'}</strong>
                  </div>
                </div>
              </div>

              {/* Progress Bar & Stats */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ width: 120 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 3 }}>
                    <span>گام {toPersianDigits(s.unlockedTopicIndex + 1)} از {toPersianDigits(tizhooshanTopicsData.length)}</span>
                    <span>{toPersianDigits(progressPercent)}٪</span>
                  </div>
                  <div style={{ width: '100%', height: 6, background: '#E2E8F0', borderRadius: 999, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${progressPercent}%`,
                        height: '100%',
                        background: '#4F46E5',
                        borderRadius: 999,
                      }}
                    />
                  </div>
                </div>

                {/* Badges */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span
                    style={{
                      background: '#EFF6FF',
                      color: '#1D4ED8',
                      padding: '4px 8px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 800,
                      border: '1px solid #BFDBFE',
                    }}
                  >
                    ⚡ {toPersianDigits(s.totalXp)} XP
                  </span>
                  <span
                    style={{
                      background: '#FEF3C7',
                      color: '#B45309',
                      padding: '4px 8px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 800,
                      border: '1px solid #FDE68A',
                    }}
                    title="تعداد روزهای متوالی فعالیت"
                  >
                    🔥 {toPersianDigits(s.streak)} روز
                  </span>
                  <span
                    style={{
                      background: s.hearts <= 1 ? '#FEE2E2' : '#FFF1F2',
                      color: s.hearts <= 1 ? '#B91C1C' : '#BE123C',
                      padding: '4px 8px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 800,
                      border: `1px solid ${s.hearts <= 1 ? '#FCA5A5' : '#FECDD3'}`,
                    }}
                    title="تعداد قلب‌های باقیمانده"
                  >
                    ❤️ {toPersianDigits(s.hearts)} / ۵
                  </span>
                  <span
                    style={{
                      background: '#DCFCE7',
                      color: '#166534',
                      padding: '4px 8px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 800,
                      border: '1px solid #BBF7D0',
                    }}
                  >
                    ✅ {toPersianDigits(s.completedTopicsCount)} مرحله
                  </span>
                  <span
                    style={{
                      background: s.hasStarted ? '#F0FDF4' : '#F8FAFC',
                      color: s.hasStarted ? '#15803D' : '#64748B',
                      padding: '4px 8px',
                      borderRadius: 8,
                      fontSize: 11,
                      fontWeight: 800,
                      border: `1px solid ${s.hasStarted ? '#BBF7D0' : '#E2E8F0'}`,
                    }}
                  >
                    {s.hasStarted ? '🟢 فعال' : '⚪ هنوز شروع نکرده'}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
