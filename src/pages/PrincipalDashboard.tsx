import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
} from 'recharts'
import { toPersianDigits } from '../utils/persianNumbers'
import { getJalaliDateLabel, todayISO } from '../useJalaliDate'
import { sortByLastName } from '../utils/persianSort'
import { exportClassroomToExcel } from '../utils/excelExport'
import SchoolLogo from '../components/SchoolLogo'
import StudentReportCard from '../components/StudentReportCard'
import LoadingScreen from '../components/LoadingScreen'

interface PrincipalDashboardProps {
  principalPassword?: string
  onLogout: () => void
}

type FilterStatus = 'all' | 'needs_effort' | 'absent_today' | 'top'
type ViewMode = 'card' | 'table'

export default function PrincipalDashboard({
  principalPassword = 'khalili100',
  onLogout,
}: PrincipalDashboardProps) {
  const { weekday, jalali } = getJalaliDateLabel()
  const todayStr = todayISO()

  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [search, setSearch] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null)
  const [chartView, setChartView] = useState<'levels' | 'attendance'>('levels')
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('card')

  // Screen size awareness
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : false))
  const [isSmallScreen, setIsSmallScreen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 480 : false))

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth
      setIsMobile(w < 768)
      setIsSmallScreen(w < 480)
      if (w >= 768) {
        setViewMode('table')
      }
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Raw data from server
  const [students, setStudents] = useState<any[]>([])
  const [posts, setPosts] = useState<any[]>([])
  const [submissions, setSubmissions] = useState<any[]>([])
  const [allAttendance, setAllAttendance] = useState<any[]>([])
  const [grades, setGrades] = useState<any[]>([])
  const [tizhooshanProgress, setTizhooshanProgress] = useState<Record<string, any>>({})
  const [exams, setExams] = useState<any[]>([])
  const [examSubmissions, setExamSubmissions] = useState<any[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    setErrorMsg('')
    try {
      const res = await fetch('/api/principal/classroom-data', {
        headers: {
          'x-principal-password': principalPassword,
        },
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'خطا در احراز هویت یا دریافت اطلاعات مدیر')
      }

      setStudents(data.students || [])
      setPosts(data.posts || [])
      setSubmissions(data.submissions || [])
      setAllAttendance(data.allAttendance || [])
      setGrades(data.grades || [])
      setTizhooshanProgress(data.tizhooshanProgress || {})
      setExams(data.exams || [])
      setExamSubmissions(data.examSubmissions || [])
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'خطا در برقراری ارتباط با سرور')
    } finally {
      setLoading(false)
    }
  }, [principalPassword])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Homework posts
  const homeworkPosts = useMemo(() => {
    return posts.filter((p: any) => p.type === 'homework')
  }, [posts])

  // Integrated grades (Standard grades + Exam scores)
  const combinedGrades = useMemo(() => {
    const list = [...grades]
    const examMap = new Map(exams.map((e: any) => [e.id, e]))
    for (const sub of examSubmissions) {
      const exam = examMap.get(sub.examId)
      if (!exam) continue
      const score = sub.teacherGrading?.totalScore ?? sub.aiGrading?.totalScore ?? sub.studentScore
      if (score === undefined || score === null) continue
      const exists = list.some(
        (g) => g.student_id === sub.studentId && (g.skill === `آزمون: ${exam.title}` || g.skill === exam.title)
      )
      if (!exists) {
        list.push({
          id: `exam_sub_${sub.id}`,
          student_id: sub.studentId,
          subject: exam.subject || 'عمومی',
          skill: `آزمون: ${exam.title}`,
          score: Number(score),
          max_score: exam.totalPoints || 20,
          recorded_at: sub.submittedAt || new Date().toISOString(),
          is_exam: true,
          exam,
          sub,
        })
      }
    }
    return list
  }, [grades, exams, examSubmissions])

  // Sorted students alphabetically by family name
  const sortedStudents = useMemo(() => {
    return sortByLastName(students, 'full_name')
  }, [students])

  // KPI 1: Today's Attendance Percentage (درصد حضور و غیاب امروز)
  const attendanceKpi = useMemo(() => {
    if (!students.length) return { percent: 0, text: '۰٪', note: 'اطلاعاتی ثبت نشده', absentsCount: 0 }
    const todayRecords = allAttendance.filter((a: any) => a.date === todayStr)

    if (todayRecords.length > 0) {
      const presentCount = todayRecords.filter((a: any) => a.status === 'present' || a.status === 'late').length
      const rate = Math.round((presentCount / students.length) * 100)
      const absents = todayRecords.filter((a: any) => a.status === 'absent').length
      return {
        percent: rate,
        text: `${toPersianDigits(rate)}٪`,
        note: absents > 0 ? `${toPersianDigits(absents)} نفر غایب امروز` : 'حضور کامل تمامی دانش‌آموزان',
        absentsCount: absents,
      }
    }

    // Fallback: If teacher hasn't submitted today's roll call yet, compute latest session
    const dateSet = Array.from(new Set(allAttendance.map((a: any) => a.date))).sort()
    const latestDate = dateSet.pop()
    if (latestDate) {
      const recs = allAttendance.filter((a: any) => a.date === latestDate)
      const pres = recs.filter((a: any) => a.status === 'present' || a.status === 'late').length
      const rate = Math.round((pres / students.length) * 100)
      const abs = recs.filter((a: any) => a.status === 'absent').length
      return {
        percent: rate,
        text: `${toPersianDigits(rate)}٪`,
        note: `آخرین جلسه (${new Date(latestDate).toLocaleDateString('fa-IR')})`,
        absentsCount: abs,
      }
    }

    return { percent: 100, text: '۱۰۰٪', note: 'در انتظار ثبت حضور آموزگار', absentsCount: 0 }
  }, [students, allAttendance, todayStr])

  // KPI 2: Homework Participation Rate (درصد مشارکت در تکالیف)
  const homeworkKpi = useMemo(() => {
    if (!students.length || !homeworkPosts.length) {
      return { percent: 100, text: '۱۰۰٪', note: 'تکلیف فعالی وجود ندارد' }
    }
    const totalExpected = homeworkPosts.length * students.length
    const totalSubmitted = submissions.length
    const rate = Math.min(100, Math.round((totalSubmitted / totalExpected) * 100))
    return {
      percent: rate,
      text: `${toPersianDigits(rate)}٪`,
      note: `${toPersianDigits(totalSubmitted)} تحویل از ${toPersianDigits(totalExpected)} تکلیف`,
    }
  }, [students, homeworkPosts, submissions])

  // KPI 3: Total Solved Tizhooshan Questions (تعداد کل تست‌های حل‌شده تیزهوشان)
  const tizhooshanKpi = useMemo(() => {
    let totalQuestions = 0
    let activeStudentsCount = 0

    Object.values(tizhooshanProgress).forEach((prog: any) => {
      const qCount = Array.isArray(prog?.completedQuestionIds)
        ? prog.completedQuestionIds.length
        : 0
      const topicCount = Object.keys(prog?.completedTopics || {}).length
      const estimatedCount = Math.max(qCount, topicCount * 5)
      if (estimatedCount > 0 || (prog?.totalXp && prog.totalXp > 0)) {
        activeStudentsCount++
        totalQuestions += Math.max(estimatedCount, Math.round((prog?.totalXp || 0) / 10))
      }
    })

    return {
      total: totalQuestions,
      text: `${toPersianDigits(totalQuestions)} تست`,
      note: `${toPersianDigits(activeStudentsCount)} دانش‌آموز فعال در سمپاد`,
    }
  }, [tizhooshanProgress])

  // Student metrics for table and distribution
  const studentMetrics = useMemo(() => {
    return sortedStudents.map((s: any) => {
      const sGrades = combinedGrades.filter((g: any) => g.student_id === s.id)
      const avg = sGrades.length
        ? Number(
            (
              sGrades.reduce(
                (sum: number, g: any) => sum + (Number(g.score) / Number(g.max_score || 20)) * 20,
                0
              ) / sGrades.length
            ).toFixed(1)
          )
        : null

      let level: 'خیلی خوب' | 'خوب' | 'قابل قبول' | 'نیازمند تلاش' = 'قابل قبول'
      let levelColor = '#10B981'
      if (avg !== null) {
        if (avg >= 18) {
          level = 'خیلی خوب'
          levelColor = '#10B981'
        } else if (avg >= 15) {
          level = 'خوب'
          levelColor = '#3B82F6'
        } else if (avg >= 12) {
          level = 'قابل قبول'
          levelColor = '#F59E0B'
        } else {
          level = 'نیازمند تلاش'
          levelColor = '#EF4444'
        }
      }

      // Homework participation
      const sSubs = submissions.filter((sub: any) => sub.student_id === s.id)
      const hwRate = homeworkPosts.length > 0 ? Math.round((sSubs.length / homeworkPosts.length) * 100) : 100

      // Attendance
      const sAtt = allAttendance.filter((a: any) => a.student_id === s.id)
      const todayAttRecord = sAtt.find((a: any) => a.date === todayStr)
      const todayStatus = todayAttRecord ? todayAttRecord.status : 'ثبت نشده'

      // Tizhooshan solved
      const tProg = tizhooshanProgress[s.id]
      const solvedTiz = Array.isArray(tProg?.completedQuestionIds)
        ? tProg.completedQuestionIds.length
        : Object.keys(tProg?.completedTopics || {}).length * 5

      return {
        id: s.id,
        name: s.full_name,
        avg,
        level,
        levelColor,
        gradesCount: sGrades.length,
        homeworkCount: sSubs.length,
        hwRate,
        todayStatus,
        attendanceTotal: sAtt.length,
        solvedTiz,
      }
    })
  }, [sortedStudents, combinedGrades, homeworkPosts, submissions, allAttendance, todayStr, tizhooshanProgress])

  // Counts for filters
  const filterCounts = useMemo(() => {
    return {
      all: studentMetrics.length,
      needs_effort: studentMetrics.filter((s) => s.level === 'نیازمند تلاش').length,
      absent_today: studentMetrics.filter((s) => s.todayStatus === 'absent').length,
      top: studentMetrics.filter((s) => s.level === 'خیلی خوب').length,
    }
  }, [studentMetrics])

  // Filtered students by search & status
  const filteredStudents = useMemo(() => {
    return studentMetrics.filter((s) => {
      // Search query
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        if (!s.name.toLowerCase().includes(q)) return false
      }
      // Status pill
      if (statusFilter === 'needs_effort' && s.level !== 'نیازمند تلاش') return false
      if (statusFilter === 'absent_today' && s.todayStatus !== 'absent') return false
      if (statusFilter === 'top' && s.level !== 'خیلی خوب') return false
      return true
    })
  }, [studentMetrics, search, statusFilter])

  // Chart Data: Distribution of student performance levels
  const levelDistributionData = useMemo(() => {
    const counts = {
      'خیلی خوب': 0,
      'خوب': 0,
      'قابل قبول': 0,
      'نیازمند تلاش': 0,
    }
    studentMetrics.forEach((s) => {
      counts[s.level]++
    })

    return [
      {
        name: isSmallScreen ? 'خیلی خوب' : 'خیلی خوب (۱۸-۲۰)',
        fullLabel: 'خیلی خوب (۱۸-۲۰)',
        count: counts['خیلی خوب'],
        fill: '#10B981',
      },
      {
        name: isSmallScreen ? 'خوب' : 'خوب (۱۵-۱۷.۹)',
        fullLabel: 'خوب (۱۵-۱۷.۹)',
        count: counts['خوب'],
        fill: '#3B82F6',
      },
      {
        name: isSmallScreen ? 'قابل قبول' : 'قابل قبول (۱۲-۱۴.۹)',
        fullLabel: 'قابل قبول (۱۲-۱۴.۹)',
        count: counts['قابل قبول'],
        fill: '#F59E0B',
      },
      {
        name: isSmallScreen ? 'نیازمند تلاش' : 'نیازمند تلاش (<۱۲)',
        fullLabel: 'نیازمند تلاش (زیر ۱۲)',
        count: counts['نیازمند تلاش'],
        fill: '#EF4444',
      },
    ]
  }, [studentMetrics, isSmallScreen])

  // Chart Data: Attendance distribution by latest dates
  const attendanceTimelineData = useMemo(() => {
    const dates = Array.from(new Set(allAttendance.map((a: any) => a.date)))
      .sort()
      .slice(isSmallScreen ? -5 : -7)

    if (dates.length === 0) return []

    return dates.map((d: any) => {
      const dayRecs = allAttendance.filter((a: any) => a.date === d)
      const pres = dayRecs.filter((a: any) => a.status === 'present').length
      const lates = dayRecs.filter((a: any) => a.status === 'late').length
      const abs = dayRecs.filter((a: any) => a.status === 'absent').length

      const jalaliLabel = new Date(d).toLocaleDateString('fa-IR', {
        month: 'numeric',
        day: 'numeric',
      })

      return {
        date: jalaliLabel,
        'حاضر': pres,
        'تاخیر': lates,
        'غایب': abs,
      }
    })
  }, [allAttendance, isSmallScreen])

  // Export to Excel handler
  function handleExcelExport() {
    exportClassroomToExcel({
      students,
      grades,
      submissions,
      allAttendance,
      homeworkPosts,
    })
  }

  if (loading) {
    return <LoadingScreen message="در حال دریافت داده‌های نظارتی مدیر مدرسه..." />
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#F1F5F9',
        direction: 'rtl',
        color: '#0F172A',
        paddingBottom: 'calc(40px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      {/* Inline styles for responsive tweaks */}
      <style>{`
        .principal-header-actions button {
          min-height: 40px;
          touch-action: manipulation;
        }
        .principal-kpi-card {
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .principal-kpi-card:active {
          transform: scale(0.985);
        }
        .principal-student-card {
          transition: all 0.2s ease;
          touch-action: manipulation;
        }
        .principal-student-card:active {
          transform: scale(0.985);
          background-color: #F8FAFC;
        }
        /* Mobile scroll bar styling */
        .custom-scroll-container::-webkit-scrollbar {
          height: 6px;
        }
        .custom-scroll-container::-webkit-scrollbar-thumb {
          background: #CBD5E1;
          border-radius: 4px;
        }
        @media (max-width: 640px) {
          .recharts-legend-wrapper {
            font-size: 11px !important;
          }
        }
      `}</style>

      {/* Top Principal Header Banner */}
      <header
        style={{
          background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #334155 100%)',
          color: '#FFFFFF',
          paddingTop: 'calc(12px + env(safe-area-inset-top, 0px))',
          paddingBottom: '14px',
          paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))',
          paddingRight: 'max(16px, env(safe-area-inset-right, 0px))',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          borderBottom: '2px solid #475569',
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          {/* Brand Info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 280px' }}>
            <div style={{ flexShrink: 0 }}>
              <SchoolLogo size={isSmallScreen ? 44 : 52} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span
                  style={{
                    background: '#2563EB',
                    color: '#FFFFFF',
                    padding: '2px 8px',
                    borderRadius: 6,
                    fontSize: 10.5,
                    fontWeight: 900,
                    letterSpacing: '0.02em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  🏛️ پنل نظارتی مدیر
                </span>
                <span
                  style={{
                    background: 'rgba(239, 68, 68, 0.25)',
                    color: '#FCA5A5',
                    padding: '2px 8px',
                    borderRadius: 6,
                    fontSize: 10.5,
                    fontWeight: 800,
                    whiteSpace: 'nowrap',
                  }}
                >
                  🔒 فقط‌خواندنی
                </span>
              </div>
              <h1
                style={{
                  margin: '4px 0 0 0',
                  fontSize: isSmallScreen ? 15.5 : 18,
                  fontWeight: 900,
                  color: '#F8FAFC',
                  lineHeight: 1.3,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                دبستان حضرت قائم (عج) — پایه ششم
              </h1>
              <div style={{ fontSize: 11.5, color: '#CBD5E1', marginTop: 2 }}>
                {weekday}، {toPersianDigits(jalali)} • {toPersianDigits(students.length)} دانش‌آموز
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div
            className="principal-header-actions"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              width: isMobile ? '100%' : 'auto',
              justifyContent: isMobile ? 'flex-start' : 'flex-end',
            }}
          >
            <button
              type="button"
              onClick={handleExcelExport}
              style={{
                flex: isMobile ? '1 1 auto' : 'initial',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                background: '#10B981',
                color: '#FFFFFF',
                border: 'none',
                padding: isSmallScreen ? '8px 10px' : '9px 14px',
                borderRadius: 10,
                fontSize: isSmallScreen ? 12 : 13,
                fontWeight: 900,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
                whiteSpace: 'nowrap',
              }}
              title="خروجی رسمی اکسل با فرمت XLSX شامل ۳ برگه کارنامه جامع، تکالیف و ریزنمرات"
            >
              <span>📥 {isSmallScreen ? 'خروجی اکسل' : 'خروجی رسمی اکسل (XLSX)'}</span>
            </button>

            <button
              type="button"
              onClick={loadData}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                background: '#334155',
                color: '#E2E8F0',
                border: '1px solid #475569',
                padding: isSmallScreen ? '8px 10px' : '9px 12px',
                borderRadius: 10,
                fontSize: isSmallScreen ? 12 : 13,
                fontWeight: 800,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              title="بروزرسانی داده‌ها"
            >
              <span>🔄 {isSmallScreen ? 'تازه' : 'بروزرسانی'}</span>
            </button>

            <button
              type="button"
              onClick={onLogout}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                background: '#EF4444',
                color: '#FFFFFF',
                border: 'none',
                padding: isSmallScreen ? '8px 12px' : '9px 14px',
                borderRadius: 10,
                fontSize: isSmallScreen ? 12 : 13,
                fontWeight: 900,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <span>🚪 خروج</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main
        style={{
          maxWidth: 1100,
          margin: '16px auto',
          padding: '0 max(12px, env(safe-area-inset-left, 0px))',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {errorMsg && (
          <div
            style={{
              background: '#FEF2F2',
              border: '2px solid #F87171',
              color: '#991B1B',
              padding: '12px 16px',
              borderRadius: 12,
              fontWeight: 800,
              fontSize: 13,
            }}
          >
            ⚠️ {errorMsg}
          </div>
        )}

        {/* 1. TOP STATISTICAL KPI CARDS (WITHOUT TOTAL GRADE AVERAGE!) */}
        <section aria-label="شاخص‌های کلیدی کلاسی">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
              gap: 12,
            }}
          >
            {/* KPI Card 1: Attendance Today */}
            <div
              className="principal-kpi-card"
              style={{
                background: '#FFFFFF',
                borderRadius: 16,
                padding: isSmallScreen ? '14px 16px' : '18px 20px',
                border: '1.5px solid #E2E8F0',
                boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <div
                style={{
                  width: isSmallScreen ? 44 : 50,
                  height: isSmallScreen ? 44 : 50,
                  borderRadius: 12,
                  background: '#ECFDF5',
                  border: '1.5px solid #A7F3D0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: isSmallScreen ? 22 : 26,
                  flexShrink: 0,
                }}
              >
                ✅
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#64748B', marginBottom: 2 }}>
                  درصد حضور و غیاب امروز
                </div>
                <div style={{ fontSize: isSmallScreen ? 22 : 26, fontWeight: 900, color: '#065F46', lineHeight: 1.2 }}>
                  {attendanceKpi.text}
                </div>
                <div style={{ fontSize: 11, color: '#059669', marginTop: 4, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {attendanceKpi.note}
                </div>
              </div>
            </div>

            {/* KPI Card 2: Homework Participation Rate */}
            <div
              className="principal-kpi-card"
              style={{
                background: '#FFFFFF',
                borderRadius: 16,
                padding: isSmallScreen ? '14px 16px' : '18px 20px',
                border: '1.5px solid #E2E8F0',
                boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <div
                style={{
                  width: isSmallScreen ? 44 : 50,
                  height: isSmallScreen ? 44 : 50,
                  borderRadius: 12,
                  background: '#EFF6FF',
                  border: '1.5px solid #BFDBFE',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: isSmallScreen ? 22 : 26,
                  flexShrink: 0,
                }}
              >
                📢
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#64748B', marginBottom: 2 }}>
                  درصد مشارکت در تکالیف
                </div>
                <div style={{ fontSize: isSmallScreen ? 22 : 26, fontWeight: 900, color: '#1E40AF', lineHeight: 1.2 }}>
                  {homeworkKpi.text}
                </div>
                <div style={{ fontSize: 11, color: '#2563EB', marginTop: 4, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {homeworkKpi.note}
                </div>
              </div>
            </div>

            {/* KPI Card 3: Total Solved Tizhooshan Questions */}
            <div
              className="principal-kpi-card"
              style={{
                background: '#FFFFFF',
                borderRadius: 16,
                padding: isSmallScreen ? '14px 16px' : '18px 20px',
                border: '1.5px solid #E2E8F0',
                boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <div
                style={{
                  width: isSmallScreen ? 44 : 50,
                  height: isSmallScreen ? 44 : 50,
                  borderRadius: 12,
                  background: '#FAF5FF',
                  border: '1.5px solid #E9D5FF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: isSmallScreen ? 22 : 26,
                  flexShrink: 0,
                }}
              >
                🦉
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#64748B', marginBottom: 2 }}>
                  تعداد کل تست‌های تیزهوشان
                </div>
                <div style={{ fontSize: isSmallScreen ? 22 : 26, fontWeight: 900, color: '#6B21A8', lineHeight: 1.2 }}>
                  {tizhooshanKpi.text}
                </div>
                <div style={{ fontSize: 11, color: '#7E22CE', marginTop: 4, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {tizhooshanKpi.note}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 2. RECHARTS VISUAL CHART SECTION */}
        <section
          style={{
            background: '#FFFFFF',
            borderRadius: 18,
            padding: isSmallScreen ? '14px 14px' : '18px 20px',
            border: '1.5px solid #E2E8F0',
            boxShadow: '0 2px 10px rgba(0,0,0,0.03)',
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 14,
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div>
              <h2 style={{ fontSize: isSmallScreen ? 14.5 : 16, fontWeight: 900, margin: 0, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📊</span>
                <span>نمودار تحلیلی عملکرد کلاسی</span>
              </h2>
              <p style={{ margin: '2px 0 0 0', fontSize: 11.5, color: '#64748B' }}>
                تحلیل جامع توزیع کیفی و حضور دانش‌آموزان
              </p>
            </div>

            {/* View Switcher */}
            <div
              style={{
                display: 'inline-flex',
                background: '#F1F5F9',
                borderRadius: 10,
                padding: 3,
                border: '1px solid #CBD5E1',
                width: isMobile ? '100%' : 'auto',
              }}
            >
              <button
                type="button"
                onClick={() => setChartView('levels')}
                style={{
                  flex: isMobile ? 1 : 'initial',
                  textAlign: 'center',
                  background: chartView === 'levels' ? '#FFFFFF' : 'transparent',
                  color: chartView === 'levels' ? '#0F172A' : '#64748B',
                  fontWeight: chartView === 'levels' ? 900 : 700,
                  border: 'none',
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: isSmallScreen ? 11 : 12,
                  cursor: 'pointer',
                  boxShadow: chartView === 'levels' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                توزیع سطوح عملکردی
              </button>
              <button
                type="button"
                onClick={() => setChartView('attendance')}
                style={{
                  flex: isMobile ? 1 : 'initial',
                  textAlign: 'center',
                  background: chartView === 'attendance' ? '#FFFFFF' : 'transparent',
                  color: chartView === 'attendance' ? '#0F172A' : '#64748B',
                  fontWeight: chartView === 'attendance' ? 900 : 700,
                  border: 'none',
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: isSmallScreen ? 11 : 12,
                  cursor: 'pointer',
                  boxShadow: chartView === 'attendance' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                روند حضور جلسات
              </button>
            </div>
          </div>

          {/* Recharts Container */}
          <div style={{ width: '100%', height: isSmallScreen ? 230 : 260, minWidth: 0 }}>
            {chartView === 'levels' ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={levelDistributionData}
                  margin={{
                    top: 15,
                    right: 8,
                    left: isSmallScreen ? -18 : -10,
                    bottom: isSmallScreen ? 25 : 20,
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#475569', fontSize: isSmallScreen ? 9.5 : 11, fontWeight: 700 }}
                    axisLine={{ stroke: '#CBD5E1' }}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: '#64748B', fontSize: 11 }}
                    axisLine={{ stroke: '#CBD5E1' }}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value: any) => [`${toPersianDigits(value)} دانش‌آموز`, 'تعداد']}
                    labelFormatter={(label, payload) => {
                      const entry = payload?.[0]?.payload
                      return entry?.fullLabel || label
                    }}
                    labelStyle={{ fontWeight: 800, color: '#0F172A', direction: 'rtl' }}
                    contentStyle={{
                      backgroundColor: '#FFFFFF',
                      borderRadius: 10,
                      border: '1.5px solid #CBD5E1',
                      direction: 'rtl',
                      textAlign: 'right',
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={isSmallScreen ? 44 : 60}>
                    {levelDistributionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              attendanceTimelineData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={attendanceTimelineData}
                    margin={{
                      top: 15,
                      right: 8,
                      left: isSmallScreen ? -18 : -10,
                      bottom: 20,
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: '#475569', fontSize: isSmallScreen ? 10 : 11, fontWeight: 700 }}
                      axisLine={{ stroke: '#CBD5E1' }}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: '#64748B', fontSize: 11 }}
                      axisLine={{ stroke: '#CBD5E1' }}
                      tickLine={false}
                    />
                    <Tooltip
                      labelStyle={{ fontWeight: 800, color: '#0F172A', direction: 'rtl' }}
                      contentStyle={{
                        backgroundColor: '#FFFFFF',
                        borderRadius: 10,
                        border: '1.5px solid #CBD5E1',
                        direction: 'rtl',
                        textAlign: 'right',
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="حاضر" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="تاخیر" fill="#F59E0B" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="غایب" fill="#EF4444" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 13 }}>
                  اطلاعات کافی برای نمایش روند هفتگی ثبت نشده است.
                </div>
              )
            )}
          </div>
        </section>

        {/* 3. STRICTLY READ-ONLY GRADES & STUDENT ROSTER SECTION */}
        <section
          style={{
            background: '#FFFFFF',
            borderRadius: 18,
            padding: isSmallScreen ? '14px 14px' : '18px 20px',
            border: '1.5px solid #E2E8F0',
            boxShadow: '0 2px 10px rgba(0,0,0,0.03)',
          }}
        >
          {/* Header & Controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 14,
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div>
              <h2 style={{ fontSize: isSmallScreen ? 14.5 : 16, fontWeight: 900, margin: 0, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📋</span>
                <span>فهرست نمرات و سوابق دانش‌آموزان</span>
              </h2>
              <p style={{ margin: '2px 0 0 0', fontSize: 11.5, color: '#64748B' }}>
                برای مشاهده کارنامه کامل و ریزنمرات، روی هر دانش‌آموز بزنید. (فقط‌خواندنی)
              </p>
            </div>

            {/* View Toggle on Mobile/Tablet */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: isMobile ? '100%' : 'auto' }}>
              {/* Search Input */}
              <div style={{ position: 'relative', flex: 1, minWidth: isMobile ? 0 : 240 }}>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="🔍 جستجوی نام..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1.5px solid #CBD5E1',
                    fontSize: 13,
                    outline: 'none',
                    direction: 'rtl',
                    boxSizing: 'border-box',
                  }}
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    style={{
                      position: 'absolute',
                      left: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: '#E2E8F0',
                      border: 'none',
                      borderRadius: '50%',
                      width: 20,
                      height: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      cursor: 'pointer',
                      color: '#475569',
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Mobile View Mode Switcher (Card vs Table) */}
              {isMobile && (
                <div
                  style={{
                    display: 'inline-flex',
                    background: '#F1F5F9',
                    borderRadius: 10,
                    padding: 2,
                    border: '1px solid #CBD5E1',
                    flexShrink: 0,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setViewMode('card')}
                    style={{
                      background: viewMode === 'card' ? '#FFFFFF' : 'transparent',
                      color: viewMode === 'card' ? '#0F172A' : '#64748B',
                      fontWeight: 800,
                      border: 'none',
                      borderRadius: 8,
                      padding: '6px 10px',
                      fontSize: 12,
                      cursor: 'pointer',
                      boxShadow: viewMode === 'card' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    }}
                    title="نمایش کارتی مناسب موبایل"
                  >
                    📱 کارتی
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('table')}
                    style={{
                      background: viewMode === 'table' ? '#FFFFFF' : 'transparent',
                      color: viewMode === 'table' ? '#0F172A' : '#64748B',
                      fontWeight: 800,
                      border: 'none',
                      borderRadius: 8,
                      padding: '6px 10px',
                      fontSize: 12,
                      cursor: 'pointer',
                      boxShadow: viewMode === 'table' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    }}
                    title="نمایش جدولی"
                  >
                    📊 جدول
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Quick Filter Pills (Especially handy on touch devices) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              overflowX: 'auto',
              paddingBottom: 10,
              marginBottom: 10,
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              style={{
                background: statusFilter === 'all' ? '#1E293B' : '#F1F5F9',
                color: statusFilter === 'all' ? '#FFFFFF' : '#475569',
                border: '1px solid',
                borderColor: statusFilter === 'all' ? '#1E293B' : '#E2E8F0',
                borderRadius: 8,
                padding: '4px 10px',
                fontSize: 11.5,
                fontWeight: 800,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              همه ({toPersianDigits(filterCounts.all)})
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('needs_effort')}
              style={{
                background: statusFilter === 'needs_effort' ? '#EF4444' : '#FEF2F2',
                color: statusFilter === 'needs_effort' ? '#FFFFFF' : '#991B1B',
                border: '1px solid',
                borderColor: statusFilter === 'needs_effort' ? '#DC2626' : '#FECDD3',
                borderRadius: 8,
                padding: '4px 10px',
                fontSize: 11.5,
                fontWeight: 800,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              ⚠️ نیازمند تلاش ({toPersianDigits(filterCounts.needs_effort)})
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('absent_today')}
              style={{
                background: statusFilter === 'absent_today' ? '#EA580C' : '#FFF7ED',
                color: statusFilter === 'absent_today' ? '#FFFFFF' : '#9A3412',
                border: '1px solid',
                borderColor: statusFilter === 'absent_today' ? '#C2410C' : '#FFEDD5',
                borderRadius: 8,
                padding: '4px 10px',
                fontSize: 11.5,
                fontWeight: 800,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              ❌ غایبین امروز ({toPersianDigits(filterCounts.absent_today)})
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('top')}
              style={{
                background: statusFilter === 'top' ? '#10B981' : '#ECFDF5',
                color: statusFilter === 'top' ? '#FFFFFF' : '#065F46',
                border: '1px solid',
                borderColor: statusFilter === 'top' ? '#059669' : '#A7F3D0',
                borderRadius: 8,
                padding: '4px 10px',
                fontSize: 11.5,
                fontWeight: 800,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              🏆 خیلی خوب ({toPersianDigits(filterCounts.top)})
            </button>
          </div>

          {/* VIEW MODE 1: MOBILE CARD LIST (Optimized for Phones & Touch) */}
          {viewMode === 'card' && isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredStudents.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 10px', color: '#94A3B8', fontSize: 13 }}>
                  دانش‌آموزی با این مشخصات یافت نشد.
                </div>
              ) : (
                filteredStudents.map((s, idx) => {
                  const originalStudent = students.find((st: any) => st.id === s.id)
                  return (
                    <div
                      key={s.id}
                      className="principal-student-card"
                      onClick={() => setSelectedStudent(originalStudent)}
                      style={{
                        background: '#FFFFFF',
                        border: '1.5px solid #E2E8F0',
                        borderRadius: 14,
                        padding: '12px 14px',
                        cursor: 'pointer',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.02)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {/* Top Row: Name + Level Badge */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: '50%',
                              background: '#F1F5F9',
                              color: '#64748B',
                              fontSize: 11,
                              fontWeight: 800,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {toPersianDigits(idx + 1)}
                          </span>
                          <span style={{ fontWeight: 900, fontSize: 14, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {s.name}
                          </span>
                        </div>

                        <span
                          style={{
                            padding: '3px 9px',
                            borderRadius: 8,
                            fontSize: 11.5,
                            fontWeight: 800,
                            color: s.levelColor,
                            background:
                              s.level === 'خیلی خوب'
                                ? '#ECFDF5'
                                : s.level === 'خوب'
                                ? '#EFF6FF'
                                : s.level === 'قابل قبول'
                                ? '#FFFBEB'
                                : '#FEF2F2',
                            border: `1px solid ${s.levelColor}40`,
                            flexShrink: 0,
                          }}
                        >
                          {s.level}
                        </span>
                      </div>

                      {/* Middle Row: Quick Stats */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(3, 1fr)',
                          gap: 6,
                          background: '#F8FAFC',
                          padding: '8px 10px',
                          borderRadius: 10,
                          fontSize: 11,
                          textAlign: 'center',
                        }}
                      >
                        <div>
                          <div style={{ color: '#64748B', marginBottom: 2 }}>نمرات ثبت‌شده</div>
                          <strong style={{ color: '#0F172A' }}>{toPersianDigits(s.gradesCount)} نمره</strong>
                        </div>
                        <div>
                          <div style={{ color: '#64748B', marginBottom: 2 }}>تکالیف</div>
                          <strong style={{ color: s.hwRate >= 80 ? '#10B981' : '#F59E0B' }}>
                            {toPersianDigits(s.hwRate)}٪
                          </strong>
                        </div>
                        <div>
                          <div style={{ color: '#64748B', marginBottom: 2 }}>حضور امروز</div>
                          <strong
                            style={{
                              color:
                                s.todayStatus === 'present'
                                  ? '#10B981'
                                  : s.todayStatus === 'late'
                                  ? '#F59E0B'
                                  : s.todayStatus === 'absent'
                                  ? '#EF4444'
                                  : '#94A3B8',
                            }}
                          >
                            {s.todayStatus === 'present'
                              ? 'حاضر'
                              : s.todayStatus === 'late'
                              ? 'تاخیر'
                              : s.todayStatus === 'absent'
                              ? 'غایب'
                              : 'ثبت‌نشده'}
                          </strong>
                        </div>
                      </div>

                      {/* Bottom Row: Tap action cue */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5 }}>
                        <span style={{ color: '#64748B' }}>
                          هوش سمپاد: <strong>{toPersianDigits(s.solvedTiz)} تست</strong>
                        </span>
                        <span style={{ color: '#2563EB', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          مشاهده کارنامه و ریزنمرات ➔
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          ) : (
            /* VIEW MODE 2: TABLE (Optimized for Tablets, Laptops & Full Display) */
            <div className="custom-scroll-container" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              {isMobile && (
                <div style={{ fontSize: 11, color: '#64748B', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>👉 جدول به چپ و راست قابل اسکرول است</span>
                </div>
              )}
              <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', textAlign: 'right', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #CBD5E1', color: '#475569' }}>
                    <th style={{ padding: '10px 8px', fontWeight: 800, width: 40, textAlign: 'center' }}>#</th>
                    <th style={{ padding: '10px 10px', fontWeight: 800 }}>نام و نام خانوادگی</th>
                    <th style={{ padding: '10px 10px', fontWeight: 800, textAlign: 'center' }}>سطح کیفی</th>
                    <th style={{ padding: '10px 10px', fontWeight: 800, textAlign: 'center' }}>نمرات ثبت‌شده</th>
                    <th style={{ padding: '10px 10px', fontWeight: 800, textAlign: 'center' }}>مشارکت تکالیف</th>
                    <th style={{ padding: '10px 10px', fontWeight: 800, textAlign: 'center' }}>حضور امروز</th>
                    <th style={{ padding: '10px 10px', fontWeight: 800, textAlign: 'center' }}>کارنامه و ریزنمرات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '30px', color: '#94A3B8' }}>
                        دانش‌آموزی با این مشخصات یافت نشد.
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((s, idx) => {
                      const originalStudent = students.find((st: any) => st.id === s.id)
                      return (
                        <tr
                          key={s.id}
                          onClick={() => setSelectedStudent(originalStudent)}
                          style={{
                            borderBottom: '1px solid #E2E8F0',
                            cursor: 'pointer',
                            transition: 'background 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#F8FAFC'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent'
                          }}
                        >
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#64748B', fontWeight: 700 }}>
                            {toPersianDigits(idx + 1)}
                          </td>
                          <td style={{ padding: '10px 10px', fontWeight: 800, color: '#0F172A', whiteSpace: 'nowrap' }}>
                            {s.name}
                          </td>
                          <td style={{ padding: '10px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '3px 10px',
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 800,
                                color: s.levelColor,
                                background:
                                  s.level === 'خیلی خوب'
                                    ? '#ECFDF5'
                                    : s.level === 'خوب'
                                    ? '#EFF6FF'
                                    : s.level === 'قابل قبول'
                                    ? '#FFFBEB'
                                    : '#FEF2F2',
                                border: `1px solid ${s.levelColor}40`,
                              }}
                            >
                              {s.level}
                            </span>
                          </td>
                          <td style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 800, color: '#334155' }}>
                            {toPersianDigits(s.gradesCount)} نمره
                          </td>
                          <td style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 800 }}>
                            <span style={{ color: s.hwRate >= 80 ? '#10B981' : '#F59E0B' }}>
                              {toPersianDigits(s.hwRate)}٪
                            </span>
                          </td>
                          <td style={{ padding: '10px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 800,
                                color:
                                  s.todayStatus === 'present'
                                  ? '#10B981'
                                  : s.todayStatus === 'late'
                                  ? '#F59E0B'
                                  : s.todayStatus === 'absent'
                                  ? '#EF4444'
                                  : '#94A3B8',
                              }}
                            >
                              {s.todayStatus === 'present'
                                ? '✅ حاضر'
                                : s.todayStatus === 'late'
                                ? '⏳ تاخیر'
                                : s.todayStatus === 'absent'
                                ? '❌ غایب'
                                : '— در انتظار'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedStudent(originalStudent)
                              }}
                              style={{
                                background: '#EFF6FF',
                                border: '1.5px solid #3B82F6',
                                color: '#1D4ED8',
                                padding: '5px 12px',
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <span>🔍 ریزنمرات و کارنامه</span>
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* STRICTLY READ-ONLY STUDENT REPORT CARD MODAL */}
      {selectedStudent && (
        <StudentReportCard
          student={selectedStudent}
          grades={combinedGrades.filter((g: any) => g.student_id === selectedStudent.id)}
          attendanceRows={allAttendance.filter((a: any) => a.student_id === selectedStudent.id)}
          submissions={submissions.filter((sub: any) => sub.student_id === selectedStudent.id)}
          homeworkCount={homeworkPosts.length}
          reportNote={undefined}
          onClose={() => setSelectedStudent(null)}
        />
      )}
    </div>
  )
}
