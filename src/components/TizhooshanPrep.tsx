import { useState, useEffect, useMemo, useCallback } from 'react'
import confetti from 'canvas-confetti'
import { supabase } from '../supabaseClient'
import {
  tizhooshanChaptersData,
  tizhooshanTopicsData,
  TizhooshanTopic,
  TizhooshanQuestion,
} from '../data/tizhooshanQuestions'
import { generateRandomTizhooshanQuestion } from '../data/endlessGenerator'
import { toPersianDigits } from '../utils/persianNumbers'
import { sortByLastName } from '../utils/persianSort'

interface UserProgress {
  totalXp: number
  gems: number
  streak: number
  hearts: number
  lastActiveDate: string
  unlockedTopicIndex: number
  completedTopics: Record<string, { stars: number; xpEarned: number; completedAt: string }>
  completedQuestionIds: number[]
  openedChests: string[]
  wrongQuestionIds?: number[]
  dailyMultiplier?: number
  dailyMultiplierDate?: string
}

const STORAGE_KEY_PREFIX = 'tizhooshan_duolingo_'

function playSound(type: 'correct' | 'wrong' | 'complete' | 'click' | 'combo' | 'lifeline' | 'chest') {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContext) return
    const ctx = new AudioContext()

    if (type === 'correct') {
      const now = ctx.currentTime
      const osc1 = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const gain = ctx.createGain()

      osc1.type = 'triangle'
      osc2.type = 'sine'

      osc1.frequency.setValueAtTime(587.33, now) // D5
      osc1.frequency.setValueAtTime(880, now + 0.08) // A5

      osc2.frequency.setValueAtTime(440, now) // A4
      osc2.frequency.setValueAtTime(659.25, now + 0.08) // E5

      gain.gain.setValueAtTime(0.12, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35)

      osc1.connect(gain)
      osc2.connect(gain)
      gain.connect(ctx.destination)

      osc1.start(now)
      osc2.start(now)
      osc1.stop(now + 0.35)
      osc2.stop(now + 0.35)
    } else if (type === 'chest') {
      const now = ctx.currentTime
      const notes = [440, 554.37, 659.25, 880, 1108.73]
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const time = now + idx * 0.08
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq, time)
        gain.gain.setValueAtTime(0.14, time)
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(time)
        osc.stop(time + 0.3)
      })
    } else if (type === 'combo') {
      const now = ctx.currentTime
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51] // C, E, G, C6, E6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const time = now + idx * 0.07

        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, time)
        gain.gain.setValueAtTime(0.15, time)
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25)

        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(time)
        osc.stop(time + 0.25)
      })
    } else if (type === 'wrong') {
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(220, now)
      osc.frequency.linearRampToValueAtTime(130, now + 0.25)

      gain.gain.setValueAtTime(0.1, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(now)
      osc.stop(now + 0.28)
    } else if (type === 'complete') {
      const now = ctx.currentTime
      const notes = [523.25, 659.25, 783.99, 1046.5, 1174.66, 1318.51]
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const time = now + idx * 0.09

        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, time)
        gain.gain.setValueAtTime(0.15, time)
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35)

        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(time)
        osc.stop(time + 0.35)
      })
    } else if (type === 'lifeline') {
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(800, now)
      osc.frequency.exponentialRampToValueAtTime(1400, now + 0.15)
      gain.gain.setValueAtTime(0.09, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.18)
    } else if (type === 'click') {
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(600, now)
      gain.gain.setValueAtTime(0.04, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.05)
    }
  } catch (e) {
    // Audio context may be restricted by autoplay policy
  }
}

function triggerConfetti() {
  try {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.65 },
      colors: ['#22C55E', '#3B82F6', '#F59E0B', '#EC4899', '#8B5CF6'],
    })
  } catch (e) {
    // Ignore if not supported
  }
}

interface ChapterChest {
  id: string
  chapterId: number
  afterStepIndex: number
  label: string
  gems: number
  hearts: number
}

// Milestone Treasure Chests per chapter
const CHAPTER_CHESTS: ChapterChest[] = [
  // Chapter 1: 12 steps
  { id: 'ch1-chest-1', chapterId: 1, afterStepIndex: 3, label: 'صندوقچه واژگان اصیل 🎁', gems: 30, hearts: 2 },
  { id: 'ch1-chest-2', chapterId: 1, afterStepIndex: 7, label: 'صندوقچه کنایات و امثال 🎁', gems: 45, hearts: 3 },
  { id: 'ch1-chest-3', chapterId: 1, afterStepIndex: 11, label: 'صندوقچه شاهنامه و متون 🎁', gems: 60, hearts: 5 },
  // Chapter 2: 12 steps
  { id: 'ch2-chest-1', chapterId: 2, afterStepIndex: 3, label: 'صندوقچه الگوهای عددی 🎁', gems: 35, hearts: 2 },
  { id: 'ch2-chest-2', chapterId: 2, afterStepIndex: 7, label: 'صندوقچه طلسم جایگشت 🎁', gems: 50, hearts: 3 },
  { id: 'ch2-chest-3', chapterId: 2, afterStepIndex: 11, label: 'صندوقچه مربع‌های جادویی 🎁', gems: 65, hearts: 5 },
  // Chapter 3: 12 steps
  { id: 'ch3-chest-1', chapterId: 3, afterStepIndex: 3, label: 'صندوقچه استدلال و راستی 🎁', gems: 40, hearts: 3 },
  { id: 'ch3-chest-2', chapterId: 3, afterStepIndex: 7, label: 'صندوقچه ترازوی هوشمند 🎁', gems: 55, hearts: 4 },
  { id: 'ch3-chest-3', chapterId: 3, afterStepIndex: 11, label: 'صندوقچه کلاه‌های منطقی 🎁', gems: 70, hearts: 5 },
  // Chapter 4: 12 steps
  { id: 'ch4-chest-1', chapterId: 4, afterStepIndex: 3, label: 'صندوقچه منشورهای بلورین 🎁', gems: 40, hearts: 3 },
  { id: 'ch4-chest-2', chapterId: 4, afterStepIndex: 7, label: 'صندوقچه مکعب‌های جادویی 🎁', gems: 55, hearts: 4 },
  { id: 'ch4-chest-3', chapterId: 4, afterStepIndex: 11, label: 'صندوقچه پازل‌های فضایی 🎁', gems: 70, hearts: 5 },
  // Chapter 5: 8 steps
  { id: 'ch5-chest-1', chapterId: 5, afterStepIndex: 3, label: 'صندوقچه چرخ‌دنده‌های طلایی 🎁', gems: 45, hearts: 3 },
  { id: 'ch5-chest-2', chapterId: 5, afterStepIndex: 7, label: 'صندوقچه قطب‌نما و ناوبری 🎁', gems: 60, hearts: 4 },
  // Chapter 6: 8 steps
  { id: 'ch6-chest-1', chapterId: 6, afterStepIndex: 3, label: 'صندوقچه شبیه‌سازهای رسمی 🎁', gems: 60, hearts: 4 },
  { id: 'ch6-chest-2', chapterId: 6, afterStepIndex: 7, label: 'صندوقچه تراز و کارنامه نهایی 🎁', gems: 80, hearts: 5 },
]

export default function TizhooshanPrep({ student }: { student: any }) {
  const storageKey = `${STORAGE_KEY_PREFIX}${student?.id || 'guest'}`

  // Navigation mode: 'path' (Continuous Winding Road), 'endless' (Rapid Infinite Arena), 'league' (Class Leaderboard)
  const [activeMode, setActiveMode] = useState<'path' | 'endless' | 'league'>('path')

  // Selected Chapter for the dedicated Realm view
  const [selectedChapterId, setSelectedChapterId] = useState<number>(1)
  const [showRealmAtlasModal, setShowRealmAtlasModal] = useState<boolean>(false)
  const [lockedAlert, setLockedAlert] = useState<string | null>(null)

  // Progress State
  const [progress, setProgress] = useState<UserProgress>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        return {
          totalXp: parsed.totalXp ?? 0,
          gems: parsed.gems ?? 25,
          streak: parsed.streak ?? 1,
          hearts: parsed.hearts ?? 5,
          lastActiveDate: parsed.lastActiveDate ?? new Date().toISOString().split('T')[0],
          unlockedTopicIndex: parsed.unlockedTopicIndex ?? 0,
          completedTopics: parsed.completedTopics ?? {},
          completedQuestionIds: parsed.completedQuestionIds ?? [],
          openedChests: parsed.openedChests ?? [],
          wrongQuestionIds: parsed.wrongQuestionIds ?? [],
          dailyMultiplier: parsed.dailyMultiplier,
          dailyMultiplierDate: parsed.dailyMultiplierDate,
        }
      }
    } catch (e) {
      // Ignore
    }
    return {
      totalXp: 0,
      gems: 25,
      streak: 1,
      hearts: 5,
      lastActiveDate: new Date().toISOString().split('T')[0],
      unlockedTopicIndex: 0,
      completedTopics: {},
      completedQuestionIds: [],
      openedChests: [],
      wrongQuestionIds: [],
    }
  })

  const [isServerLoaded, setIsServerLoaded] = useState(false)
  const [isCloudSyncing, setIsCloudSyncing] = useState(false)
  const [allProgressMap, setAllProgressMap] = useState<Record<string, any>>({})

  // 1. Authoritative Load progress from server on mount
  useEffect(() => {
    if (!student?.id) {
      setIsServerLoaded(true)
      return
    }
    fetch(`/api/tizhooshan/progress?studentId=${student.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.progress) {
          const cloud = data.progress
          setProgress((prev) => {
            const merged = {
              ...prev,
              totalXp: cloud.totalXp ?? prev.totalXp,
              gems: cloud.gems ?? prev.gems,
              streak: cloud.streak ?? prev.streak,
              hearts: typeof cloud.hearts === 'number' ? cloud.hearts : prev.hearts,
              lastActiveDate: cloud.lastActiveDate || prev.lastActiveDate,
              unlockedTopicIndex: Math.max(prev.unlockedTopicIndex, cloud.unlockedTopicIndex ?? 0),
              completedTopics: { ...(cloud.completedTopics || {}), ...(prev.completedTopics || {}) },
              completedQuestionIds: Array.from(new Set([...(cloud.completedQuestionIds || []), ...(prev.completedQuestionIds || [])])),
              openedChests: Array.from(new Set([...(cloud.openedChests || []), ...(prev.openedChests || [])])),
              wrongQuestionIds: cloud.wrongQuestionIds || prev.wrongQuestionIds || [],
              dailyMultiplier: cloud.dailyMultiplier ?? prev.dailyMultiplier,
              dailyMultiplierDate: cloud.dailyMultiplierDate ?? prev.dailyMultiplierDate,
            }
            try {
              localStorage.setItem(storageKey, JSON.stringify(merged))
            } catch {}
            return merged
          })
        }
      })
      .catch((err) => console.warn('Failed to fetch cloud tizhooshan progress', err))
      .finally(() => {
        setIsServerLoaded(true)
      })
  }, [student?.id, storageKey])

  // 2. Save Progress to localStorage & Sync to Server (Guarded by isServerLoaded to avoid wiping cloud data)
  useEffect(() => {
    if (!isServerLoaded) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(progress))
      if (student?.id) {
        setIsCloudSyncing(true)
        const rawClass = localStorage.getItem('tizhooshan_class_progress')
        const classMap = rawClass ? JSON.parse(rawClass) : {}
        classMap[student.id] = {
          studentId: student.id,
          studentName: student.full_name,
          totalXp: progress.totalXp,
          gems: progress.gems,
          streak: progress.streak,
          hearts: progress.hearts,
          unlockedTopicIndex: progress.unlockedTopicIndex,
          completedTopicsCount: Object.keys(progress.completedTopics || {}).length,
          lastActiveDate: progress.lastActiveDate,
          wrongCount: (progress.wrongQuestionIds || []).length,
        }
        localStorage.setItem('tizhooshan_class_progress', JSON.stringify(classMap))

        // Sync to server persistent storage (tizhooshan_progress.json)
        fetch('/api/tizhooshan/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId: student.id,
            studentName: student.full_name,
            progress,
          }),
        })
          .catch((err) => console.warn('Cloud sync error for Tizhooshan', err))
          .finally(() => {
            setIsCloudSyncing(false)
          })
      }
    } catch (e) {
      console.error(e)
    }
  }, [progress, storageKey, student, isServerLoaded])

  const todayStr = new Date().toISOString().split('T')[0]

  // Daily XP Multiplier: 1.5x or 2.0x deterministic per student per day
  const dailyMultiplier = useMemo(() => {
    if (progress.dailyMultiplierDate === todayStr && progress.dailyMultiplier) {
      return progress.dailyMultiplier
    }
    const hash = (student?.id || 'guest')
      .split('')
      .reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0)
    const dayHash = todayStr.split('-').reduce((acc, c) => acc + Number(c), hash)
    return dayHash % 2 === 0 ? 2 : 1.5
  }, [todayStr, student?.id, progress.dailyMultiplierDate, progress.dailyMultiplier])

  // Classmates & Real Server Progress Map (Zero fake data)
  const [classmates, setClassmates] = useState<any[]>([])

  useEffect(() => {
    async function fetchLeaderboardData() {
      // 1. Fetch real student list from Supabase
      try {
        const { data } = await supabase.rpc('list_students_public')
        if (data && data.length > 0) {
          setClassmates(sortByLastName(data))
        }
      } catch (err) {
        console.warn('Classmates fetch error', err)
      }

      // 2. Fetch real cloud progress map for all students
      try {
        const res = await fetch('/api/tizhooshan/all-progress')
        const json = await res.json()
        if (json.success && json.progressMap) {
          setAllProgressMap(json.progressMap)
        }
      } catch (err) {
        console.warn('Failed to load all-progress for leaderboard', err)
      }
    }
    fetchLeaderboardData()
  }, [])

  // Active Quiz State
  const [isEndlessActive, setIsEndlessActive] = useState(false)
  const [activeTopic, setActiveTopic] = useState<TizhooshanTopic | null>(null)
  const [lessonPhase, setLessonPhase] = useState<'step1_technique' | 'questions'>('step1_technique')
  const [showLessonSummaryModal, setShowLessonSummaryModal] = useState<TizhooshanTopic | null>(null)
  const [showHeartsModal, setShowHeartsModal] = useState(false)
  const [showMistakesModal, setShowMistakesModal] = useState(false)
  const [showTechniqueModal, setShowTechniqueModal] = useState(false)
  const [showFullLeague, setShowFullLeague] = useState(false)
  const [chestModalReward, setChestModalReward] = useState<{ label: string; gems: number; hearts: number } | null>(null)

  const [currentQIndex, setCurrentQIndex] = useState(0)
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [isAnswerChecked, setIsAnswerChecked] = useState(false)
  const [isCorrect, setIsCorrect] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [quizFinished, setQuizFinished] = useState(false)
  const [sessionXpEarned, setSessionXpEarned] = useState(0)
  const [sessionCorrectCount, setSessionCorrectCount] = useState(0)
  const [comboCount, setComboCount] = useState(0)
  const [eliminatedOptions, setEliminatedOptions] = useState<number[]>([])

  // Endless Questions Queue
  const [endlessQuestions, setEndlessQuestions] = useState<TizhooshanQuestion[]>([])

  // Current League
  const league = useMemo(() => {
    return { name: 'لیگ کلاسی 🏆', color: '#2563EB', bg: '#EFF6FF', badge: 'کلاس' }
  }, [])

  // Current active question
  const currentQuestion: TizhooshanQuestion | null = useMemo(() => {
    if (isEndlessActive) {
      return endlessQuestions[currentQIndex] || null
    }
    if (activeTopic) {
      return activeTopic.questions[currentQIndex] || null
    }
    return null
  }, [isEndlessActive, endlessQuestions, activeTopic, currentQIndex])

  // Effective technique for Step 1
  const effectiveTechnique = useMemo(() => {
    if (!activeTopic) return null
    if (activeTopic.technique) return activeTopic.technique
    return {
      title: `قلق ذهنی و تکنیک کلیدی: ${activeTopic.topic}`,
      rule: activeTopic.lesson_summary || 'تحلیل گام‌به‌گام و توجه به الگوها، رد گزینه‌های نادرست و استنتاج منطقی کلید موفقیت در آزمون تیزهوشان است.',
      exampleQuestion: activeTopic.questions[0]?.question || '',
      exampleSolution: activeTopic.questions[0]?.explanation || '',
    }
  }, [activeTopic])

  // Positive Mascot Feedback
  const mascotFeedback = useMemo(() => {
    if (!isAnswerChecked) {
      if (currentQuestion?._isRepeat) {
        return { icon: '🔁', text: 'این سوال برای یادگیری عمیق مجدداً نمایش داده شده است. با تمرکز پاسخ بده!' }
      }
      return { icon: '🦉', text: 'با دقت فکر کن و بهترین گزینه رو انتخاب کن!' }
    }
    if (isCorrect) {
      if (currentQuestion?._isRepeat) {
        return { icon: '🌟', text: 'آفرین قهرمان! این بار سوال رو کاملاً درست یاد گرفتی و حل کردی!' }
      }
      if (comboCount >= 3) return { icon: '🔥', text: 'فوق‌العاده‌ای! با همین تمرکز ادامه بده!' }
      if (comboCount === 2) return { icon: '⚡', text: 'عالی بود! سرعت و دقتت فوق‌العاده‌ست!' }
      return { icon: '😄', text: 'آفرین قهرمان کلاس ششم! پاسخ کاملاً درسته!' }
    }
    return { icon: '🧐', text: 'اشکالی نداره عزیزم! این سوال به انتهای این مرحله اضافه شد تا دوباره مرورش کنی.' }
  }, [isAnswerChecked, isCorrect, comboCount, currentQuestion])

  // Leaderboard Calculation - 100% REAL DATA (No fake seeds or synthetic baselines)
  const leaderboard = useMemo(() => {
    const studentMap = new Map<string, { id: string; name: string; avatar: string }>()

    classmates.forEach((c) => {
      studentMap.set(c.id, { id: c.id, name: c.full_name || 'دانش‌آموز', avatar: c.avatar_url || '' })
    })

    // Also include any students who have saved progress on the server
    Object.keys(allProgressMap).forEach((id) => {
      if (!studentMap.has(id)) {
        const p = allProgressMap[id]
        studentMap.set(id, {
          id,
          name: p.studentName || 'دانش‌آموز',
          avatar: '',
        })
      }
    })

    // Ensure current student is present
    if (student?.id && !studentMap.has(student.id)) {
      studentMap.set(student.id, {
        id: student.id,
        name: student.full_name || 'شما',
        avatar: student.avatar_url || '',
      })
    }

    const list = Array.from(studentMap.values()).map((s) => {
      const isMe = s.id === student?.id
      const p = allProgressMap[s.id]
      const xp = isMe ? progress.totalXp : (Number(p?.totalXp) || 0)
      const streak = isMe ? progress.streak : (Number(p?.streak) || 0)
      const hearts = isMe ? progress.hearts : (typeof p?.hearts === 'number' ? p.hearts : 5)
      const unlockedTopicIndex = isMe ? progress.unlockedTopicIndex : (Number(p?.unlockedTopicIndex) || 0)

      return {
        id: s.id,
        name: isMe ? (student?.full_name ? `${student.full_name} (شما)` : 'شما') : s.name,
        avatar: s.avatar,
        xp,
        streak,
        hearts,
        unlockedTopicIndex,
        isMe,
      }
    })

    // Sort by XP descending, then by streak descending, then by name
    list.sort((a, b) => {
      if (b.xp !== a.xp) return b.xp - a.xp
      if (b.streak !== a.streak) return b.streak - a.streak
      return String(a.name || '').localeCompare(String(b.name || ''), 'fa')
    })

    return list
  }, [classmates, allProgressMap, student, progress.totalXp, progress.streak, progress.hearts, progress.unlockedTopicIndex])

  const myRank = useMemo(() => {
    const idx = leaderboard.findIndex((p) => p.isMe)
    return idx !== -1 ? idx + 1 : 1
  }, [leaderboard])

  // Selected Chapter & Active Realm Topics
  const currentChapter = useMemo(() => {
    return tizhooshanChaptersData.find((ch) => ch.id === selectedChapterId) || tizhooshanChaptersData[0]
  }, [selectedChapterId])

  const currentChapterTopics = useMemo(() => {
    return tizhooshanTopicsData.filter((t) => t.chapterId === currentChapter.id)
  }, [currentChapter.id])

  const currentChapterChests = useMemo(() => {
    return CHAPTER_CHESTS.filter((c) => c.chapterId === currentChapter.id)
  }, [currentChapter.id])

  const currentChapterIndex = useMemo(() => {
    return tizhooshanChaptersData.findIndex((ch) => ch.id === currentChapter.id)
  }, [currentChapter.id])

  const nextChapter = useMemo(() => {
    if (currentChapterIndex < tizhooshanChaptersData.length - 1) {
      return tizhooshanChaptersData[currentChapterIndex + 1]
    }
    return null
  }, [currentChapterIndex])

  const prevChapter = useMemo(() => {
    if (currentChapterIndex > 0) {
      return tizhooshanChaptersData[currentChapterIndex - 1]
    }
    return null
  }, [currentChapterIndex])

  // Chapter Unlock Checker: Chapter 1 is always unlocked.
  // Subsequent chapters are locked until all topics of the preceding chapter are completed.
  const isChapterUnlocked = useCallback(
    (chapterId: number): boolean => {
      if (chapterId === 1) return true
      const cIndex = tizhooshanChaptersData.findIndex((c) => c.id === chapterId)
      if (cIndex <= 0) return true
      const prevChap = tizhooshanChaptersData[cIndex - 1]
      const prevTopics = tizhooshanTopicsData.filter((t) => t.chapterId === prevChap.id)
      if (prevTopics.length === 0) return true
      const completedPrev = prevTopics.filter((t) => Boolean(progress.completedTopics[t.id])).length
      return completedPrev >= prevTopics.length
    },
    [progress.completedTopics]
  )

  const isCurrentChapterCompleted = useMemo(() => {
    if (!currentChapterTopics.length) return false
    const done = currentChapterTopics.filter((t) => Boolean(progress.completedTopics[t.id])).length
    return done >= currentChapterTopics.length
  }, [currentChapterTopics, progress.completedTopics])

  // 4-Skill Mastery Calculation (محاسبه تسلط مهارتی بر اساس مهارت‌های ۴گانه)
  const skillMastery = useMemo(() => {
    const completedIds = new Set(progress.completedQuestionIds || [])
    const wrongIds = new Set(progress.wrongQuestionIds || [])

    const skillsDef = [
      {
        key: 'math',
        title: 'هوش عددی و محاسباتی',
        icon: '🔢',
        color: '#0284C7',
        bg: '#E0F2FE',
        borderColor: '#BAE6FD',
        match: (t: TizhooshanTopic) => t.chapterId === 2,
      },
      {
        key: 'verbal',
        title: 'هوش کلامی و ادبی',
        icon: '🗣️',
        color: '#10B981',
        bg: '#D1FAE5',
        borderColor: '#A7F3D0',
        match: (t: TizhooshanTopic) => t.chapterId === 1,
      },
      {
        key: 'logic',
        title: 'هوش تحلیلی و منطقی',
        icon: '🧩',
        color: '#8B5CF6',
        bg: '#EDE9FE',
        borderColor: '#DDD6FE',
        match: (t: TizhooshanTopic) => t.chapterId === 3 || t.chapterId === 5,
      },
      {
        key: 'spatial',
        title: 'هوش تصویری و فضایی',
        icon: '📐',
        color: '#F59E0B',
        bg: '#FEF3C7',
        borderColor: '#FDE68A',
        match: (t: TizhooshanTopic) => t.chapterId === 4,
      },
    ]

    return skillsDef.map((s) => {
      const topics = tizhooshanTopicsData.filter(s.match)
      let totalQuestions = 0
      let completedQuestions = 0
      for (const t of topics) {
        for (const q of t.questions) {
          totalQuestions++
          if (completedIds.has(q.id) && !wrongIds.has(q.id)) {
            completedQuestions++
          }
        }
      }
      const totalTopics = topics.length
      const doneTopics = topics.filter((t) => Boolean(progress.completedTopics[t.id])).length
      const topicPercent = totalTopics > 0 ? (doneTopics / totalTopics) * 100 : 0
      const qPercent = totalQuestions > 0 ? (completedQuestions / totalQuestions) * 100 : 0
      const percent = Math.min(100, Math.round(Math.max(qPercent, topicPercent)))

      return {
        ...s,
        percent,
        totalQuestions,
        completedQuestions,
      }
    })
  }, [progress.completedQuestionIds, progress.wrongQuestionIds, progress.completedTopics])

  // Grouped Mistakes by Topic for the Mistake Box (تفکیک مبحثی سوالات غلط)
  const groupedMistakes = useMemo(() => {
    const wrongIds = progress.wrongQuestionIds || []
    if (wrongIds.length === 0) return []

    const list: {
      topicId: string
      topicTitle: string
      topicIcon: string
      chapterTitle: string
      count: number
      questions: TizhooshanQuestion[]
    }[] = []

    for (const t of tizhooshanTopicsData) {
      const wrongInThisTopic = t.questions.filter((q) => wrongIds.includes(q.id))
      if (wrongInThisTopic.length > 0) {
        list.push({
          topicId: t.id,
          topicTitle: t.topic,
          topicIcon: t.icon,
          chapterTitle: t.chapterTitle,
          count: wrongInThisTopic.length,
          questions: wrongInThisTopic,
        })
      }
    }
    return list
  }, [progress.wrongQuestionIds])

  // 4-Step Progressive Question Preparer: 2 simple, 2 medium, 1 hard sampad (with 🏆)
  function prepareTopicQuestions(topic: TizhooshanTopic): TizhooshanQuestion[] {
    if (topic.id === 'mistakes_review' || topic.chapterId === 6) {
      return [...topic.questions]
    }

    const allQ = [...topic.questions]
    const easyPool = allQ.filter((q) => q.difficulty === 'آسان' || q.stage === 'درک اولیه')
    const medPool = allQ.filter((q) => q.difficulty === 'متوسط' || q.stage === 'تثبیت و تسلط')
    const hardPool = allQ.filter((q) => q.difficulty === 'سخت' || q.stage === 'تست واقعی سمپاد' || (q.badge && q.badge.includes('سمپاد')))

    // Select 2 simple questions (گام ۲)
    const step2Easy: TizhooshanQuestion[] = []
    if (easyPool.length >= 2) {
      step2Easy.push(...easyPool.slice(0, 2))
    } else {
      step2Easy.push(...easyPool)
      for (const q of allQ) {
        if (step2Easy.length >= 2) break
        if (!step2Easy.some((x) => x.id === q.id) && !hardPool.some((x) => x.id === q.id)) {
          step2Easy.push(q)
        }
      }
    }

    // Select 2 medium questions (گام ۳)
    const step3Med: TizhooshanQuestion[] = []
    for (const q of medPool) {
      if (step3Med.length >= 2) break
      if (!step2Easy.some((x) => x.id === q.id)) {
        step3Med.push(q)
      }
    }
    if (step3Med.length < 2) {
      for (const q of allQ) {
        if (step3Med.length >= 2) break
        if (!step2Easy.some((x) => x.id === q.id) && !step3Med.some((x) => x.id === q.id) && !hardPool.some((x) => x.id === q.id)) {
          step3Med.push(q)
        }
      }
    }

    // Select 1 challenging Sampad question with 🏆 (گام ۴)
    let step4Hard = hardPool.find((q) => !step2Easy.some((x) => x.id === q.id) && !step3Med.some((x) => x.id === q.id))
    if (!step4Hard) {
      step4Hard = allQ[allQ.length - 1]
    }

    const formattedEasy = step2Easy.slice(0, 2).map((q, idx) => ({
      ...q,
      difficulty: 'آسان' as const,
      stage: 'درک اولیه' as const,
      badge: `گام ۲: سوال ${toPersianDigits(idx + 1)} تثبیت اولیه`,
    }))

    const formattedMed = step3Med.slice(0, 2).map((q, idx) => ({
      ...q,
      difficulty: 'متوسط' as const,
      stage: 'تثبیت و تسلط' as const,
      badge: `گام ۳: سوال ترکیبی ${toPersianDigits(idx + 1)}`,
    }))

    const formattedHard: TizhooshanQuestion[] = step4Hard
      ? [
          {
            ...step4Hard,
            difficulty: 'سخت' as const,
            stage: 'تست واقعی سمپاد' as const,
            badge: step4Hard.badge?.includes('۱۴۰') ? `🏆 ${step4Hard.badge}` : '🏆 گام ۴: چالش سمپاد ۱۴۰۲-۱۴۰۳',
          },
        ]
      : []

    return [...formattedEasy, ...formattedMed, ...formattedHard]
  }

  // Start Topic (مدیریت هوشمند قلب‌ها: مطالعه آزاد و دروس عادی همیشه باز، فقط آزمون‌های رکوردی مسدود)
  function startTopic(topic: TizhooshanTopic) {
    const isRecordExam = topic.chapterId === 6 || topic.category === 'آزمون جامع' || topic.category === 'دفترچه رسمی'
    if (isRecordExam && progress.hearts <= 0) {
      playSound('wrong')
      setShowHeartsModal(true)
      setLockedAlert('قلب‌های شما تمام شده است! شرکت در آزمون‌های رکوردی و جامع نیازمند قلب است. اما مطالعه آزاد دروس و جعبه مرور اشتباهات همچنان باز است.')
      return
    }

    playSound('click')
    const preparedQuestions = prepareTopicQuestions(topic)
    const hydratedTopic = { ...topic, questions: preparedQuestions }

    setActiveTopic(hydratedTopic)
    setIsEndlessActive(false)
    setCurrentQIndex(0)
    setSelectedOption(null)
    setIsAnswerChecked(false)
    setIsCorrect(false)
    setShowHint(false)
    setQuizFinished(false)
    setSessionXpEarned(0)
    setSessionCorrectCount(0)
    setComboCount(0)
    setEliminatedOptions([])
    setShowLessonSummaryModal(null)
    setLessonPhase(hydratedTopic.id !== 'mistakes_review' && (hydratedTopic.technique || hydratedTopic.lesson_summary) ? 'step1_technique' : 'questions')
  }

  // Start Mistakes Review (جعبه اشتباهات و بازآموزی - همیشه باز حتی با صفر قلب!)
  function startMistakesReview(filterTopicId?: string) {
    playSound('click')
    const wrongIds = progress.wrongQuestionIds || []
    if (wrongIds.length === 0) {
      setShowMistakesModal(false)
      setLockedAlert('آفرین! شما در حال حاضر هیچ سوال اشتباهی در جعبه خطاها ندارید.')
      return
    }

    let questionsToReview: TizhooshanQuestion[] = []
    let topicTitle = 'مرور خطاهای من 🩹'
    let chapterTitle = 'جعبه اشتباهات و بازآموزی'

    if (filterTopicId) {
      const matchedTopic = tizhooshanTopicsData.find((t) => t.id === filterTopicId)
      if (matchedTopic) {
        questionsToReview = matchedTopic.questions.filter((q) => wrongIds.includes(q.id))
        topicTitle = `بازآموزی: ${matchedTopic.topic}`
        chapterTitle = matchedTopic.chapterTitle
      }
    } else {
      const allQuestions: TizhooshanQuestion[] = []
      tizhooshanTopicsData.forEach((t) => allQuestions.push(...t.questions))
      questionsToReview = allQuestions.filter((q) => wrongIds.includes(q.id))
    }

    if (questionsToReview.length === 0) {
      setShowMistakesModal(false)
      setLockedAlert('سوالی برای این مبحث در لیست خطاهای شما یافت نشد.')
      return
    }

    const topic: TizhooshanTopic = {
      id: 'mistakes_review',
      chapterId: 1,
      chapterTitle: chapterTitle,
      chapterIcon: '🩹',
      unitNumber: 0,
      topic: topicTitle,
      category: 'مرور و تثبیت آموخته‌ها',
      icon: '🩹',
      lesson_summary: 'در این بخش سوالاتی که قبلاً اشتباه پاسخ داده بودید را مجدداً حل می‌کنید تا با پاسخ صحیح، قلب‌های از دست رفته‌تان بازگردد.',
      questions: questionsToReview,
    }

    setShowMistakesModal(false)
    setShowHeartsModal(false)
    setActiveTopic(topic)
    setIsEndlessActive(false)
    setCurrentQIndex(0)
    setSelectedOption(null)
    setIsAnswerChecked(false)
    setIsCorrect(false)
    setShowHint(false)
    setQuizFinished(false)
    setSessionXpEarned(0)
    setSessionCorrectCount(0)
    setComboCount(0)
    setEliminatedOptions([])
    setShowLessonSummaryModal(null)
    setLessonPhase('questions')
  }

  // Start Endless Arena Mode (قفل شدن در صورت اتمام قلب - آزمون رکوردی)
  function startEndlessPractice() {
    if (progress.hearts <= 0) {
      playSound('wrong')
      setShowHeartsModal(true)
      setLockedAlert('قلب‌های شما تمام شده است! ورود به آزمون رکوردی بی‌پایان مسدود است. اما مطالعه آزاد دروس و جعبه مرور اشتباهات کاملاً باز هستند تا بدون وقفه یادگیری را ادامه دهید!')
      return
    }
    playSound('click')
    const initialBatch = [
      generateRandomTizhooshanQuestion(),
      generateRandomTizhooshanQuestion(),
      generateRandomTizhooshanQuestion(),
      generateRandomTizhooshanQuestion(),
      generateRandomTizhooshanQuestion(),
    ]
    setEndlessQuestions(initialBatch)
    setIsEndlessActive(true)
    setActiveTopic(null)
    setCurrentQIndex(0)
    setSelectedOption(null)
    setIsAnswerChecked(false)
    setIsCorrect(false)
    setShowHint(false)
    setQuizFinished(false)
    setSessionXpEarned(0)
    setSessionCorrectCount(0)
    setComboCount(0)
    setEliminatedOptions([])
  }

  // 50/50 Lifeline
  function handleUseLifeline5050() {
    if (!currentQuestion || isAnswerChecked || eliminatedOptions.length > 0) return
    playSound('lifeline')
    const wrongIndices = currentQuestion.options
      .map((_, idx) => idx)
      .filter((idx) => idx !== currentQuestion.correct_index)
    const toEliminate = wrongIndices.sort(() => 0.5 - Math.random()).slice(0, 2)
    setEliminatedOptions(toEliminate)
  }

  // Open Treasure Chest
  function handleOpenChest(chest: ChapterChest) {
    if (progress.openedChests.includes(chest.id)) return
    playSound('chest')
    triggerConfetti()

    setProgress((prev) => ({
      ...prev,
      gems: prev.gems + chest.gems,
      hearts: Math.min(5, prev.hearts + chest.hearts),
      openedChests: [...prev.openedChests, chest.id],
    }))

    setChestModalReward({
      label: chest.label,
      gems: chest.gems,
      hearts: chest.hearts,
    })
  }

  // Check Answer Handler
  function handleCheckAnswer(selectedIdx?: number) {
    const optToEvaluate = selectedIdx !== undefined ? selectedIdx : selectedOption
    if (!currentQuestion || optToEvaluate === null || isAnswerChecked) return
    const correct = optToEvaluate === currentQuestion.correct_index

    setSelectedOption(optToEvaluate)
    setIsAnswerChecked(true)
    setIsCorrect(correct)

    if (correct) {
      const nextCombo = comboCount + 1
      setComboCount(nextCombo)

      if (nextCombo >= 2) {
        playSound('combo')
      } else {
        playSound('correct')
      }
      triggerConfetti()

      const comboBonus = nextCombo >= 3 ? 10 : nextCombo === 2 ? 5 : 0
      const baseEarned = currentQuestion.xp + comboBonus
      const gained = Math.round(baseEarned * dailyMultiplier)

      setSessionXpEarned((prev) => prev + gained)
      setSessionCorrectCount((prev) => prev + 1)

      const isMistakesMode = activeTopic?.id === 'mistakes_review'

      setProgress((prev) => ({
        ...prev,
        totalXp: prev.totalXp + gained,
        gems: prev.gems + 1,
        hearts: isMistakesMode ? Math.min(5, prev.hearts + 1) : prev.hearts,
        wrongQuestionIds: (isMistakesMode || currentQuestion._isRepeat)
          ? (prev.wrongQuestionIds || []).filter((id) => id !== currentQuestion.id)
          : prev.wrongQuestionIds,
        completedQuestionIds: prev.completedQuestionIds.includes(currentQuestion.id)
          ? prev.completedQuestionIds
          : [...prev.completedQuestionIds, currentQuestion.id],
      }))
    } else {
      playSound('wrong')
      setComboCount(0)
      setProgress((prev) => ({
        ...prev,
        hearts: Math.max(0, prev.hearts - 1),
        wrongQuestionIds: Array.from(new Set([...(prev.wrongQuestionIds || []), currentQuestion.id])),
      }))

      // چرخه یادگیری و تکرار سوالات اشتباه:
      // اگر دانش‌آموزی سوالی را غلط زد، آن سوال به انتهای صف همان مرحله اضافه می‌شود
      // تا در پایان مجدداً نمایش داده شود و مرحله تنها پس از یادگیری و پاسخ درست به پایان برسد.
      if (activeTopic) {
        setActiveTopic((prev) => {
          if (!prev) return null
          return {
            ...prev,
            questions: [
              ...prev.questions,
              {
                ...currentQuestion,
                _isRepeat: true,
              },
            ],
          }
        })
      }
    }
  }

  // Next Question Handler
  function handleNextQuestion() {
    playSound('click')
    setSelectedOption(null)
    setIsAnswerChecked(false)
    setIsCorrect(false)
    setShowHint(false)
    setEliminatedOptions([])

    if (isEndlessActive) {
      // Endless mode: seamlessly append questions so it never ends
      if (currentQIndex + 2 >= endlessQuestions.length) {
        setEndlessQuestions((prev) => [
          ...prev,
          generateRandomTizhooshanQuestion(),
          generateRandomTizhooshanQuestion(),
        ])
      }
      setCurrentQIndex((prev) => prev + 1)
    } else if (activeTopic) {
      if (currentQIndex + 1 < activeTopic.questions.length) {
        setCurrentQIndex((prev) => prev + 1)
      } else {
        // Finished Topic!
        playSound('complete')
        triggerConfetti()
        setQuizFinished(true)

        const topicIndex = tizhooshanTopicsData.findIndex((t) => t.id === activeTopic.id)
        const isNextUnlocked = Math.max(progress.unlockedTopicIndex, topicIndex + 1)

        setProgress((prev) => ({
          ...prev,
          unlockedTopicIndex: isNextUnlocked,
          hearts: Math.min(5, prev.hearts + 1),
          gems: prev.gems + 5,
          completedTopics: {
            ...prev.completedTopics,
            [activeTopic.id]: {
              stars: 3,
              xpEarned: (prev.completedTopics[activeTopic.id]?.xpEarned || 0) + sessionXpEarned,
              completedAt: new Date().toISOString(),
            },
          },
        }))
      }
    }
  }

  function handleRefillHeartsWithGems() {
    if (progress.gems < 20) return
    playSound('complete')
    setProgress((prev) => ({
      ...prev,
      gems: prev.gems - 20,
      hearts: 5,
    }))
    setShowHeartsModal(false)
  }

  function handleBuyBoostWithGems() {
    if (progress.gems < 30) return
    playSound('complete')
    triggerConfetti()
    setProgress((prev) => ({
      ...prev,
      gems: prev.gems - 30,
      dailyMultiplier: 2,
      dailyMultiplierDate: new Date().toISOString().split('T')[0],
    }))
    setShowHeartsModal(false)
  }

  return (
    <div className="tizhooshan-container">
      {/* Duolingo Sticky Top Bar */}
      <div className="tizhooshan-topbar">
        <div className="tizhooshan-brand">
          <span className="owl-mascot">🦉</span>
          <div className="brand-text">
            <span className="brand-title">باشگاه استعداد تحلیلی</span>
          </div>
          <span
            style={{
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 8,
              background: '#F0FDF4',
              color: '#15803D',
              border: '1px solid #BBF7D0',
              fontWeight: 800,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
            title="وضعیت پیشرفت به صورت دائمی در سرور ذخیره می‌شود و با تعویض دستگاه باقی می‌ماند"
          >
            <span>☁️</span>
            <span>{isCloudSyncing ? 'در حال همگام‌سازی...' : 'ذخیره در سرور'}</span>
          </span>
        </div>

        {/* Gamification Stats: Hearts, Gems, Streak, Mistakes */}
        <div className="tizhooshan-stats-bar" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <div
            className="stat-pill hearts-pill"
            style={{
              cursor: 'pointer',
              background: progress.hearts <= 1 ? '#FEE2E2' : '#FFFFFF',
              border: progress.hearts <= 1 ? '1.5px solid #EF4444' : '1.5px solid #E2E8F0',
            }}
            title="فرصت‌های پاسخ‌دهی (کلیک برای شارژ یا فروشگاه)"
            onClick={() => setShowHeartsModal(true)}
          >
            <span className="stat-icon">{progress.hearts > 0 ? '❤️' : '💔'}</span>
            <span className="stat-num">{progress.hearts}</span>
          </div>

          <div
            className="stat-pill gems-pill"
            style={{ cursor: 'pointer' }}
            title="الماس‌ها (کلیک برای خرید امکانات)"
            onClick={() => setShowHeartsModal(true)}
          >
            <span className="stat-icon">💎</span>
            <span className="stat-num">{progress.gems}</span>
          </div>

          <div className="stat-pill streak-pill" title="روزهای متوالی مطالعه">
            <span className="stat-icon pulse-fire">🔥</span>
            <span className="stat-num">{progress.streak}</span>
          </div>

          <button
            type="button"
            className="stat-pill mistakes-pill"
            style={{
              cursor: 'pointer',
              background: (progress.wrongQuestionIds || []).length > 0 ? '#FEF3C7' : '#F1F5F9',
              border: (progress.wrongQuestionIds || []).length > 0 ? '1.5px solid #F59E0B' : '1.5px solid #CBD5E1',
              color: (progress.wrongQuestionIds || []).length > 0 ? '#B45309' : '#475569',
              fontWeight: 800,
              padding: '4px 10px',
              borderRadius: 999,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
            }}
            title="جعبه اشتباهات: مرور و حل دوباره سوالات غلط به تفکیک مبحث"
            onClick={() => setShowMistakesModal(true)}
          >
            <span>🩹</span>
            <span>مرور خطاهای من ({(progress.wrongQuestionIds || []).length})</span>
            {progress.hearts <= 0 && (progress.wrongQuestionIds || []).length > 0 && (
              <span style={{ fontSize: 10, background: '#10B981', color: '#fff', padding: '1px 5px', borderRadius: 6 }}>
                قلب رایگان
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 4-Skill Mastery Bars (محاسبه Mastery مهارتی: عددی، کلامی، منطق، فضایی) */}
      <div
        style={{
          maxWidth: 640,
          margin: '0 auto 12px auto',
          background: '#FFFFFF',
          border: '1.5px solid #E2E8F0',
          borderRadius: 16,
          padding: '12px 14px',
          boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>🎯</span>
            <span style={{ fontSize: 13, fontWeight: 900, color: '#1E293B' }}>
              میزان تسلط مهارتی تیزهوشان (مهارت‌های ۴گانه)
            </span>
          </div>
          <span style={{ fontSize: 11, color: '#64748B', fontWeight: 700 }}>
            ارزیابی پیوسته یادگیری
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          {skillMastery.map((skill) => (
            <div
              key={skill.key}
              style={{
                background: skill.bg,
                border: `1px solid ${skill.borderColor}`,
                borderRadius: 12,
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: 14 }}>{skill.icon}</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: '#1E293B',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {skill.title}
                  </span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 900, color: skill.color }}>
                  {toPersianDigits(skill.percent)}٪
                </span>
              </div>
              <div style={{ height: 6, width: '100%', background: 'rgba(255, 255, 255, 0.7)', borderRadius: 999, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.max(4, skill.percent)}%`,
                    background: skill.color,
                    borderRadius: 999,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Daily XP Multiplier Lucky Bonus Banner */}
      <div
        style={{
          maxWidth: 640,
          margin: '0 auto 10px auto',
          background: dailyMultiplier >= 2 ? 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)' : '#EFF6FF',
          border: `2px solid ${dailyMultiplier >= 2 ? '#F59E0B' : '#3B82F6'}`,
          borderRadius: 14,
          padding: '8px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 12.5,
          fontWeight: 800,
          color: dailyMultiplier >= 2 ? '#92400E' : '#1E40AF',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>{dailyMultiplier >= 2 ? '🔥' : '⚡'}</span>
          <span>
            پاداش شانس روزانه: ضریب {dailyMultiplier === 2 ? '۲ برابری (2x XP)' : '۱/۵ برابری (1.5x XP)'} برای تمام سوالات امروز فعال است!
          </span>
        </div>
        <span style={{ fontSize: 11, background: '#FFFFFF', padding: '2px 8px', borderRadius: 8, border: '1px solid currentColor' }}>
          هدیه روزانه
        </span>
      </div>

      {/* Floating Alert for Locked Chapters/Activities */}
      {lockedAlert && (
        <div
          style={{
            maxWidth: 640,
            margin: '0 auto 12px auto',
            background: '#FEF2F2',
            border: '2px solid #EF4444',
            borderRadius: 14,
            padding: '10px 14px',
            color: '#991B1B',
            fontWeight: 800,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 4px 12px rgba(239, 68, 68, 0.15)',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <span>{lockedAlert}</span>
          <button
            type="button"
            onClick={() => setLockedAlert(null)}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#991B1B',
              fontWeight: 900,
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ========================================================
          ROADMAP + SPEED PRACTICE
          ======================================================== */}
      <div className="tizhooshan-roadmap-content">
        <div className="continuous-path-container" style={{ width: '100%', maxWidth: '640px', margin: '0 auto' }}>
          {/* Unified Class League Standings Strip */}
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: 16,
              border: '2px solid var(--black)',
              padding: '14px 16px',
              marginBottom: 16,
              boxShadow: '0 4px 14px rgba(0,0,0,0.06)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 26 }}>🏆</span>
                <div>
                  <h4 style={{ fontSize: 15, fontWeight: 900, margin: 0, color: 'var(--black)' }}>
                    جدول امتیازات کلاس
                  </h4>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowFullLeague((v) => !v)}
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  background: '#F1F5F9',
                  border: '1px solid #CBD5E1',
                  borderRadius: 10,
                  padding: '6px 12px',
                  cursor: 'pointer',
                  color: '#1E293B',
                }}
              >
                {showFullLeague ? 'بستن رده‌بندی ▲' : 'مشاهده کل کلاس ▼'}
              </button>
            </div>

            {/* Compact Podium Top 3 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center' }}>
              {leaderboard.slice(0, 3).map((item, idx) => (
                <div
                  key={item.id}
                  style={{
                    background: item.isMe ? '#EFF6FF' : '#F8FAFC',
                    border: item.isMe ? '2px solid #3B82F6' : '1px solid #E2E8F0',
                    borderRadius: 12,
                    padding: '8px 4px',
                  }}
                >
                  <div style={{ fontSize: 18 }}>{idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 900, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.name} {item.isMe && '(شما)'}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>
                    {item.xp} XP
                  </div>
                </div>
              ))}
            </div>

            {/* Expanded Leaderboard */}
            {showFullLeague && (
              <div style={{ marginTop: 14, borderTop: '1px solid #E2E8F0', paddingTop: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                  {leaderboard.map((item, idx) => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '7px 10px',
                        borderRadius: 8,
                        background: item.isMe ? '#DBEAFE' : '#F8FAFC',
                        border: item.isMe ? '1px solid #93C5FD' : '1px solid transparent',
                        fontSize: 12.5,
                      }}
                    >
                      <span style={{ fontWeight: 800, width: 28 }}>#{idx + 1}</span>
                      <span style={{ flex: 1, fontWeight: 800, color: '#0F172A' }}>
                        {item.name} {item.isMe && '(شما)'}
                      </span>
                      <span style={{ color: '#64748B', fontWeight: 700 }}>🔥 {item.streak} روز</span>
                      <span style={{ fontWeight: 900, color: '#1E293B', marginRight: 10 }}>{item.xp} XP</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Clean Layout of Chapters with Locked Future Chapters */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#475569' }}>
                📚 سرفصل‌های آموزشی:
              </span>
              <span style={{ fontSize: 11, color: '#64748B', fontWeight: 700 }}>
                فصل‌های بعدی پس از تکمیل فصل‌های قبل باز می‌شوند 🔒
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 8,
              }}
            >
              {tizhooshanChaptersData.map((ch) => {
                const isSelected = ch.id === currentChapter.id
                const isUnlocked = isChapterUnlocked(ch.id)
                const chapterTopics = tizhooshanTopicsData.filter((t) => t.chapterId === ch.id)
                const doneCount = chapterTopics.filter((t) => Boolean(progress.completedTopics[t.id])).length
                const pct = chapterTopics.length > 0 ? Math.round((doneCount / chapterTopics.length) * 100) : 0

                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => {
                      if (!isUnlocked) {
                        playSound('wrong')
                        setLockedAlert(`فصل ${ch.id} قفل است! برای باز شدن، ابتدا تمام گام‌های فصل قبلی را با موفقیت تکمیل کنید 🔒`)
                        setTimeout(() => setLockedAlert(null), 3500)
                        return
                      }
                      setSelectedChapterId(ch.id)
                      playSound('click')
                    }}
                    style={{
                      background: !isUnlocked
                        ? '#F8FAFC'
                        : isSelected
                        ? ch.cardGradient
                        : '#FFFFFF',
                      color: !isUnlocked
                        ? '#94A3B8'
                        : isSelected
                        ? '#FFFFFF'
                        : 'var(--black)',
                      border: !isUnlocked
                        ? '2px dashed #CBD5E1'
                        : isSelected
                        ? `2px solid ${ch.accentColor}`
                        : '2px solid #E2E8F0',
                      borderRadius: 14,
                      padding: '10px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      textAlign: 'center',
                      cursor: !isUnlocked ? 'not-allowed' : 'pointer',
                      opacity: !isUnlocked ? 0.65 : 1,
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected && isUnlocked ? `0 4px 12px ${ch.accentColor}40` : 'none',
                      position: 'relative',
                    }}
                  >
                    {!isUnlocked && (
                      <span
                        style={{
                          position: 'absolute',
                          top: 6,
                          left: 6,
                          fontSize: 10,
                          background: '#E2E8F0',
                          color: '#64748B',
                          padding: '1px 6px',
                          borderRadius: 999,
                          fontWeight: 800,
                        }}
                      >
                        🔒 قفل
                      </span>
                    )}
                    <span style={{ fontSize: 22 }}>{!isUnlocked ? '🔒' : ch.icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, opacity: isSelected && isUnlocked ? 0.9 : 0.65, marginTop: 2 }}>
                      فصل {ch.id} {!isUnlocked && '(قفل)'}
                    </span>
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: 900,
                        marginTop: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '100%',
                      }}
                    >
                      {ch.title.replace(`فصل ${ch.id}: `, '')}
                    </span>
                    <span style={{ fontSize: 10.5, opacity: isSelected && isUnlocked ? 0.9 : 0.7, marginTop: 2 }}>
                      {isUnlocked ? `${doneCount} از ${chapterTopics.length} گام (${pct}٪)` : 'قفل است'}
                    </span>
                    {isUnlocked && (
                      <div
                        style={{
                          marginTop: 6,
                          width: '100%',
                          background: isSelected ? 'rgba(255,255,255,0.3)' : '#E2E8F0',
                          height: 5,
                          borderRadius: 999,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: isSelected ? '#FFFFFF' : ch.color,
                          }}
                        />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

            {/* Realm Hero Banner */}
            {(() => {
              const completedCount = currentChapterTopics.filter((t) => progress.completedTopics[t.id]).length
              const percent = currentChapterTopics.length > 0 ? Math.round((completedCount / currentChapterTopics.length) * 100) : 0

              return (
                <div
                  className="section-banner-duo"
                  style={{
                    background: currentChapter.cardGradient,
                    boxShadow: `0 8px 24px ${currentChapter.accentColor}33`,
                  }}
                >
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', opacity: 0.9 }}>
                      {currentChapter.environmentName}
                    </div>
                    <h3 style={{ fontSize: '18px', fontWeight: 900, margin: '4px 0', color: '#FFFFFF' }}>
                      {currentChapter.icon} {currentChapter.title}
                    </h3>
                    <div style={{ fontSize: '12.5px', opacity: 0.95, maxWidth: '440px' }}>
                      {currentChapter.desc}
                    </div>
                  </div>

                  <div style={{ textAlign: 'left', minWidth: '85px' }}>
                    <div style={{ fontSize: '18px', fontWeight: 900 }}>{percent}٪</div>
                    <div style={{ fontSize: '11px', opacity: 0.9 }}>
                      {completedCount} از {currentChapterTopics.length} گام
                    </div>
                    <div
                      style={{
                        width: '80px',
                        height: '8px',
                        borderRadius: '999px',
                        background: 'rgba(255, 255, 255, 0.3)',
                        overflow: 'hidden',
                        marginTop: '6px',
                      }}
                    >
                      <div
                        style={{
                          width: `${percent}%`,
                          height: '100%',
                          background: '#FFFFFF',
                          borderRadius: '999px',
                        }}
                      />
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Winding zig-zag path of nodes for this chapter */}
            <div className="duolingo-path-wrapper" style={{ padding: '8px 0' }}>
              <div className="duolingo-nodes-path">
                {currentChapterTopics.map((t, idx) => {
                  const isCompleted = Boolean(progress.completedTopics[t.id])
                  // First topic of the chapter is unlocked; subsequent unlock sequentially
                  const isUnlocked = idx === 0 || Boolean(progress.completedTopics[currentChapterTopics[idx - 1]?.id])
                  const isCurrent = isUnlocked && !isCompleted && (idx === 0 || Boolean(progress.completedTopics[currentChapterTopics[idx - 1]?.id]))

                  // Winding offset
                  const offsets = [0, -38, 38, -26, 26, 0]
                  const xOffset = offsets[idx % offsets.length]

                  // Check if a treasure chest should appear right after this topic
                  const chestAfter = currentChapterChests.find((c) => c.afterStepIndex === idx)

                  return (
                    <div key={t.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div
                        className="path-node-row"
                        style={{ transform: `translateX(${xOffset}px)` }}
                      >
                        <div className="node-wrapper">
                          {/* Floating Duo Owl on the current active station */}
                          {isCurrent && (
                            <div className="duo-floating-owl">
                              <div className="duo-owl-bubble">گام بعدی رو بزن! 🎯</div>
                              <span className="duo-owl-avatar">🦉</span>
                            </div>
                          )}

                          {isCurrent && <div className="pulse-aura" />}

                          <button
                            type="button"
                            className={`duolingo-circle-btn ${
                              isCompleted
                                ? 'completed'
                                : isCurrent
                                ? 'current'
                                : isUnlocked
                                ? 'unlocked'
                                : 'locked'
                            }`}
                            disabled={!isUnlocked}
                            onClick={() => setShowLessonSummaryModal(t)}
                            aria-label={t.topic}
                          >
                            <span className="node-icon">{t.icon}</span>
                            {isCompleted && <span className="crown-badge">⭐</span>}
                            {!isUnlocked && <span className="lock-badge">🔒</span>}
                          </button>

                          {/* Label Box */}
                          <div
                            className={`node-label-box ${isCurrent ? 'active' : ''}`}
                            onClick={() => isUnlocked && setShowLessonSummaryModal(t)}
                          >
                            <span className="node-title">{t.topic}</span>
                            <div className="node-meta">
                              <span className="q-count">{t.questions.length} سوال</span>
                              <span className="xp-tag">
                                +{t.questions.reduce((sum, q) => sum + q.xp, 0)} XP
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Treasure Chest if configured for this position */}
                      {chestAfter && (
                        <div className="treasure-chest-row">
                          {progress.openedChests.includes(chestAfter.id) ? (
                            <div className="treasure-chest-btn opened">
                              <span style={{ fontSize: '20px' }}>📦✨</span>
                              <span style={{ fontSize: '12px', fontWeight: 800, color: '#64748B' }}>
                                صندوقچه باز شد (+{chestAfter.gems} 💎)
                              </span>
                            </div>
                          ) : isUnlocked ? (
                            <button
                              type="button"
                              className="treasure-chest-btn available"
                              onClick={() => handleOpenChest(chestAfter)}
                              title="کلیک کن تا جایزه بگیری!"
                            >
                              <span style={{ fontSize: '24px' }}>🎁</span>
                              <span style={{ fontSize: '13px', fontWeight: 900, color: '#B45309' }}>
                                {chestAfter.label} (باز کردن!)
                              </span>
                            </button>
                          ) : (
                            <div className="treasure-chest-btn" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                              <span style={{ fontSize: '20px' }}>🔒🎁</span>
                              <span style={{ fontSize: '12px', fontWeight: 700, color: '#94A3B8' }}>
                                {chestAfter.label}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Chapter Mastery Trophy */}
            {(() => {
              const completedCount = currentChapterTopics.filter((t) => progress.completedTopics[t.id]).length
              const isAllDone = completedCount === currentChapterTopics.length

              return (
                <div className="unit-trophy-card">
                  <span style={{ fontSize: '38px' }}>🏆</span>
                  <h4 style={{ fontSize: '16px', fontWeight: 900, color: '#92400E', margin: '6px 0 2px 0' }}>
                    جام فتح {currentChapter.realmName}
                  </h4>
                  <p style={{ fontSize: '12px', color: '#B45309', margin: 0 }}>
                    {isAllDone
                      ? '✅ تبریک شگفت‌انگیز! شما تمام گام‌های این اقلیم را با افتخار فتح کردید!'
                      : `با گذراندن تمام ${currentChapterTopics.length} گام، این جام زرین را به دست بیاور! (${completedCount} از ${currentChapterTopics.length})`}
                  </p>
                </div>
              )
            })()}

            {/* Portal Gate to Next World (Locked until all chapter topics are completed) */}
            {nextChapter ? (
              isCurrentChapterCompleted ? (
                <div className="realm-portal-gate">
                  <div style={{ fontSize: '42px', marginBottom: '4px' }}>🌌✨</div>
                  <h3 className="portal-title">دروازه ورود به فصل بعدی: {nextChapter.title}</h3>
                  <p className="portal-subtitle">
                    تبریک! شما این فصل را فتح کردید. اکنون می‌توانید وارد اقلیم «{nextChapter.environmentName}» شوید!
                  </p>
                  <button
                    type="button"
                    className="portal-btn"
                    onClick={() => {
                      setSelectedChapterId(nextChapter.id)
                      playSound('complete')
                      triggerConfetti()
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                  >
                    🚀 صعود به {nextChapter.realmName} ➔
                  </button>
                </div>
              ) : (
                <div
                  className="realm-portal-gate"
                  style={{
                    background: 'linear-gradient(135deg, #1E293B 0%, #334155 100%)',
                    borderColor: '#64748B',
                  }}
                >
                  <div style={{ fontSize: '38px', marginBottom: '4px' }}>🔒🌌</div>
                  <h3 className="portal-title">دروازه ورود به فصل بعدی: {nextChapter.title} (قفل)</h3>
                  <p className="portal-subtitle">
                    برای باز شدن این دروازه، باید تمامی {currentChapterTopics.length} گام فصل فعلی را فتح کنی! ({currentChapterTopics.filter((t) => progress.completedTopics[t.id]).length} از {currentChapterTopics.length} انجام شده)
                  </p>
                  <button
                    type="button"
                    className="portal-btn"
                    disabled
                    style={{
                      background: '#64748B',
                      cursor: 'not-allowed',
                      opacity: 0.8,
                      boxShadow: 'none',
                    }}
                  >
                    🔒 ابتدا تمام گام‌های این فصل را بگذرانید
                  </button>
                </div>
              )
            ) : (
              <div
                className="realm-portal-gate"
                style={{
                  background: 'linear-gradient(135deg, #78350F 0%, #B45309 50%, #D97706 100%)',
                  borderColor: '#F59E0B',
                }}
              >
                <div style={{ fontSize: '48px', marginBottom: '6px' }}>👑🏆</div>
                <h3 className="portal-title">فینال بزرگ: تمام اقلیم‌ها فتح شدند!</h3>
                <p className="portal-subtitle">
                  آفرین نابغه! تو تمام ۶ فصل و بیش از ۸۰ گام تخصصی را به پایان رساندی و آماده درخشش هستی!
                </p>
              </div>
            )}

            {/* ========================================================
                SPEED PRACTICE SECTION (DIRECTLY UNDER LEAGUE & ROADMAP)
                ======================================================== */}
            <div className="endless-arena-container" style={{ marginTop: 28, padding: 0 }}>
              <div
                className="endless-hero-card"
                style={{
                  border: '2.5px solid var(--black)',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
                  background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
                }}
              >
                <div className="endless-badge-hero">⚡ ماراتن تمرین سرعتی و بی‌پایان</div>
                <h2 className="endless-title">آرنای تمرین سرعتی پیوسته</h2>
                <p className="endless-desc">
                  اینجا سوالات هیچ‌وقت تمام نمی‌شوند! با حل سریع سوالات الگوها، جایگشت، ساعت، تقویم و سه‌راهی برق،
                  XP بالا جمع کن و در جدول امتیازات کلاس پیشرفت کن.
                </p>

                <div className="endless-stats-box">
                  <div className="stat-item">
                    <span className="val">♾️</span>
                    <span className="lbl">تعداد سوالات</span>
                  </div>
                  <div className="stat-item">
                    <span className="val">+۱۵ تا ۳۵</span>
                    <span className="lbl">XP برای هر سوال</span>
                  </div>
                  <div className="stat-item">
                    <span className="val">⚡</span>
                    <span className="lbl">ارتقای امتیاز</span>
                  </div>
                </div>

                <button
                  type="button"
                  className="endless-launch-btn"
                  onClick={startEndlessPractice}
                  style={progress.hearts <= 0 ? {
                    background: 'linear-gradient(135deg, #64748B 0%, #475569 100%)',
                    boxShadow: '0 5px 0 #334155',
                  } : undefined}
                >
                  {progress.hearts <= 0 ? '🔒 تمرین آزاد قفل است (قلب‌ها تمام شده)' : '🚀 شروع تمرین سرعتی و بی‌پایان'}
                </button>
              </div>

              <div className="covered-skills-panel" style={{ marginTop: 14 }}>
                <h4 className="panel-title">مباحث فعال در تمرین سرعتی:</h4>
                <div className="skills-grid">
                  <div className="skill-chip">🔢 جایگشت ارقام ۴ رقمی و ترتیبی</div>
                  <div className="skill-chip">🔌 سه‌راهی و چندراهی برق و پریزها</div>
                  <div className="skill-chip">👥 عضویت گروه‌های پژوهشی</div>
                  <div className="skill-chip">🧭 جهت‌یابی نقشه چرخشی ۹۰ درجه</div>
                  <div className="skill-chip">📈 الگوهای حسابی و تصاعدها</div>
                  <div className="skill-chip">📅 تقویم و شمارش روزهای هفته</div>
                  <div className="skill-chip">⏰ زاویه بین عقربه‌های ساعت</div>
                  <div className="skill-chip">🧮 معادلات حسابی جای خالی</div>
                  <div className="skill-chip">🎲 تاس و وجوه متقابل</div>
                  <div className="skill-chip">📐 شمارش فرمولی مثلث‌ها و مربع‌ها</div>
                </div>
              </div>
            </div>
          </div>
        </div>

      {/* ========================================================
          POPUP MODAL: DUOLINGO LESSON SUMMARY & PREVIEW
          ======================================================== */}
      {showLessonSummaryModal && (
        <div className="duo-modal-overlay" onClick={() => setShowLessonSummaryModal(null)}>
          <div className="duo-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-icon">
              <span className="big-icon">{showLessonSummaryModal.icon}</span>
            </div>
            <h3 className="modal-topic-title">{showLessonSummaryModal.topic}</h3>
            <div className="modal-badge-row">
              <span className="cat-badge">{showLessonSummaryModal.category}</span>
              <span className="q-badge">{showLessonSummaryModal.questions.length} سوال تستی استاندارد</span>
              <span className="xp-badge">
                +{showLessonSummaryModal.questions.reduce((sum, q) => sum + q.xp, 0)} XP
              </span>
            </div>

            {/* شیب یادگیری ۴گانه درس: از صفر تا سمپاد */}
            <div
              style={{
                background: '#F8FAFC',
                border: '1.5px solid #E2E8F0',
                borderRadius: 14,
                padding: '10px 12px',
                margin: '12px 0',
                textAlign: 'right',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 900, color: '#334155', marginBottom: 6 }}>
                📈 شیب یادگیری این درس (از صفر تا سمپاد):
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, fontSize: 11 }}>
                <div style={{ background: '#EFF6FF', color: '#1D4ED8', padding: '5px 8px', borderRadius: 8, fontWeight: 700 }}>
                  🎓 گام ۱: کارت آموزش و تکنیک حل
                </div>
                <div style={{ background: '#ECFDF5', color: '#047857', padding: '5px 8px', borderRadius: 8, fontWeight: 700 }}>
                  🟢 گام ۲: ۲ تست ساده درک اولیه
                </div>
                <div style={{ background: '#FEF3C7', color: '#B45309', padding: '5px 8px', borderRadius: 8, fontWeight: 700 }}>
                  🟡 گام ۳: ۲ تست متوسط تثبیت
                </div>
                <div style={{ background: '#FDF2F8', color: '#BE185D', padding: '5px 8px', borderRadius: 8, fontWeight: 800 }}>
                  🏆 گام ۴: ۱ تست واقعی آزمون سمپاد
                </div>
              </div>
            </div>

            {showLessonSummaryModal.technique ? (
              <div
                style={{
                  background: '#F0FDF4',
                  border: '1.5px solid #86EFAC',
                  borderRadius: 14,
                  padding: '12px 14px',
                  marginBottom: 14,
                  textAlign: 'right',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 16 }}>💡</span>
                  <span style={{ fontSize: 13, fontWeight: 900, color: '#166534' }}>
                    {showLessonSummaryModal.technique.title}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: '#14532D', margin: '0 0 8px 0', lineHeight: 1.6 }}>
                  <strong>کلید طلایی: </strong>
                  {showLessonSummaryModal.technique.rule}
                </p>
                <div style={{ background: '#FFFFFF', border: '1px solid #BBF7D0', borderRadius: 10, padding: '8px 10px', fontSize: 11.5, color: '#1E293B', marginBottom: 6 }}>
                  <strong>مثال حل‌شده: </strong>
                  {showLessonSummaryModal.technique.exampleQuestion}
                </div>
                <div style={{ fontSize: 11, color: '#15803D', lineHeight: 1.5 }}>
                  <strong>راه‌حل: </strong>
                  {showLessonSummaryModal.technique.exampleSolution}
                </div>
              </div>
            ) : (
              <div className="modal-lesson-summary">
                <h4 className="summary-title">💡 نکته کلیدی این درس:</h4>
                <p className="summary-text">{showLessonSummaryModal.lesson_summary}</p>
              </div>
            )}

            <div className="modal-action-buttons">
              <button
                type="button"
                className="start-lesson-btn"
                onClick={() => startTopic(showLessonSummaryModal)}
              >
                شروع درس (+{showLessonSummaryModal.questions.reduce((sum, q) => sum + q.xp, 0)} XP)
              </button>
              <button
                type="button"
                className="close-modal-btn"
                onClick={() => setShowLessonSummaryModal(null)}
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          POPUP MODAL: TREASURE CHEST OPENED REWARD
          ======================================================== */}
      {chestModalReward && (
        <div className="duo-modal-overlay" onClick={() => setChestModalReward(null)}>
          <div className="duo-modal-card" style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: '54px', marginBottom: '8px', animation: 'duoFloatOwl 2s infinite' }}>🎁✨</div>
            <h3 style={{ fontSize: '20px', fontWeight: 900, color: '#1E293B', margin: '0 0 8px 0' }}>
              صندوقچه گنج باز شد!
            </h3>
            <p style={{ fontSize: '13.5px', color: '#64748B', marginBottom: '20px' }}>
              آفرین به تلاش و پیوستگیت! این پاداش فوق‌العاده برای توست:
            </p>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginBottom: '24px' }}>
              <div style={{ background: '#FEF3C7', border: '2px solid #FCD34D', borderRadius: '16px', padding: '12px 20px' }}>
                <div style={{ fontSize: '24px' }}>💎</div>
                <div style={{ fontSize: '16px', fontWeight: 900, color: '#B45309' }}>+{chestModalReward.gems} الماس</div>
              </div>
              <div style={{ background: '#FEE2E2', border: '2px solid #FCA5A5', borderRadius: '16px', padding: '12px 20px' }}>
                <div style={{ fontSize: '24px' }}>❤️</div>
                <div style={{ fontSize: '16px', fontWeight: 900, color: '#B91C1C' }}>+{chestModalReward.hearts} قلب</div>
              </div>
            </div>

            <button
              type="button"
              className="start-lesson-btn"
              onClick={() => setChestModalReward(null)}
            >
              دریافت جوایز و ادامه مسیر 🚀
            </button>
          </div>
        </div>
      )}

      {/* ========================================================
          POPUP MODAL: REFILL HEARTS
          ======================================================== */}
      {showHeartsModal && (
        <div className="duo-modal-overlay" onClick={() => setShowHeartsModal(false)}>
          <div className="duo-modal-card" style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>❤️</div>
            <h3 style={{ fontSize: '18px', fontWeight: 900, color: '#1E293B', margin: '0 0 8px 0' }}>
              وضعیت فرصت‌ها (جان‌های پاسخ‌دهی)
            </h3>
            <p style={{ fontSize: '13px', color: '#64748B', marginBottom: '20px' }}>
              هر پاسخ اشتباه یک قلب کم می‌کند. با اتمام موفقیت‌آمیز درس‌ها یا باز کردن صندوقچه‌ها قلبت دوباره پر می‌شود!
            </p>

            <div style={{ fontSize: '28px', marginBottom: '20px' }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <span key={i} style={{ opacity: i < progress.hearts ? 1 : 0.25, margin: '0 3px' }}>
                  ❤️
                </span>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                className="start-lesson-btn"
                disabled={progress.gems < 20}
                onClick={handleRefillHeartsWithGems}
                style={{
                  background: progress.gems >= 20 ? 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)' : '#CBD5E1',
                  boxShadow: progress.gems >= 20 ? '0 5px 0 #991B1B' : 'none',
                }}
              >
                ❤️ شارژ کامل ۵ قلب با ۲۰ الماس 💎 (موجودی: {progress.gems})
              </button>

              <button
                type="button"
                className="start-lesson-btn"
                disabled={progress.gems < 30}
                onClick={handleBuyBoostWithGems}
                style={{
                  background: progress.gems >= 30 ? 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' : '#CBD5E1',
                  boxShadow: progress.gems >= 30 ? '0 5px 0 #B45309' : 'none',
                }}
              >
                🔥 خرید بوست ۲ برابری امتیاز (2x XP) با ۳۰ الماس 💎
              </button>

              {/* Notice when hearts are 0 */}
              {progress.hearts <= 0 && (
                <div
                  style={{
                    background: '#ECFDF5',
                    border: '1.5px solid #10B981',
                    borderRadius: 14,
                    padding: '10px 14px',
                    fontSize: 12,
                    color: '#065F46',
                    textAlign: 'right',
                    lineHeight: 1.6,
                  }}
                >
                  💡 <strong>مدیریت هوشمند قلب‌ها:</strong> اتمام قلب‌ها تنها ورود به آزمون‌های رکوردی و شبیه‌سازهای جامع را محدود می‌کند. <strong>مطالعه آزاد دروس</strong> و <strong>جعبه مرور اشتباهات</strong> کاملاً باز هستند تا آموزش متوقف نشود! همچنین با هر پاسخ درست در جعبه اشتباهات، ۱ قلب رایگان دریافت می‌کنید.
                </div>
              )}

              <button
                type="button"
                className="start-lesson-btn"
                onClick={() => {
                  setShowHeartsModal(false)
                  setShowMistakesModal(true)
                }}
                style={{
                  background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                  boxShadow: '0 5px 0 #047857',
                }}
              >
                🩹 ورود به جعبه اشتباهات (بازیابی رایگان قلب با حل درست!)
              </button>

              <button
                type="button"
                className="close-modal-btn"
                onClick={() => setShowHeartsModal(false)}
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          POPUP MODAL: MISTAKE BOX (جعبه اشتباهات و بازآموزی هوشمند)
          ======================================================== */}
      {showMistakesModal && (
        <div className="duo-modal-overlay" onClick={() => setShowMistakesModal(false)}>
          <div
            className="duo-modal-card"
            style={{ maxWidth: 520, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ textAlign: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: '42px', marginBottom: '4px' }}>🩹✨</div>
              <h3 style={{ fontSize: '18px', fontWeight: 900, color: '#1E293B', margin: '0 0 6px 0' }}>
                جعبه اشتباهات و بازآموزی هوشمند
              </h3>
              <p style={{ fontSize: '12.5px', color: '#64748B', margin: 0 }}>
                مرور سوالات غلط‌زده به تفکیک مبحث • با هر پاسخ صحیح ۱ قلب بازمی‌گردد!
              </p>
            </div>

            {/* Recovery rule reminder banner */}
            <div
              style={{
                background: '#FEF3C7',
                border: '1.5px solid #F59E0B',
                borderRadius: 12,
                padding: '8px 12px',
                fontSize: 11.5,
                color: '#92400E',
                marginBottom: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>❤️</span>
              <span>
                <strong>قانون کسب مجدد قلب:</strong> این بخش حتی در صورت صفر شدن قلب‌ها باز است. هر پاسخ صحیح، ۱ قلب به شما اضافه می‌کند و سوال از لیست خطاها حذف می‌شود.
              </span>
            </div>

            {groupedMistakes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 20px' }}>
                <div style={{ fontSize: 50, marginBottom: 12 }}>🎉🏆</div>
                <h4 style={{ fontSize: 16, fontWeight: 900, color: '#059669', marginBottom: 6 }}>
                  آفرین! هیچ سوال اشتباهی در جعبه شما وجود ندارد
                </h4>
                <p style={{ fontSize: 12.5, color: '#64748B' }}>
                  شما تمام سوالات را به درستی پاسخ داده‌اید یا اشتباهات گذشته را کاملاً تصحیح کرده‌اید.
                </p>
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                {/* Global Review All Button */}
                <button
                  type="button"
                  onClick={() => startMistakesReview()}
                  style={{
                    background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: 14,
                    padding: '12px 16px',
                    fontWeight: 900,
                    fontSize: 13.5,
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>🚀</span>
                    <span>تمرین همه سوالات غلط ({(progress.wrongQuestionIds || []).length} سوال)</span>
                  </div>
                  <span style={{ fontSize: 12, background: 'rgba(255,255,255,0.25)', padding: '2px 8px', borderRadius: 8 }}>
                    شروع جامع ←
                  </span>
                </button>

                <div style={{ fontSize: 12, fontWeight: 800, color: '#475569', marginTop: 4 }}>
                  یا انتخاب به تفکیک مبحث:
                </div>

                {groupedMistakes.map((item) => (
                  <div
                    key={item.topicId}
                    style={{
                      background: '#FFFFFF',
                      border: '1.5px solid #E2E8F0',
                      borderRadius: 14,
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ fontSize: 24, flexShrink: 0 }}>{item.topicIcon}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: '#1E293B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.topicTitle}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748B' }}>
                          {item.chapterTitle} • <strong style={{ color: '#EF4444' }}>{toPersianDigits(item.count)} سوال غلط</strong>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => startMistakesReview(item.topicId)}
                      style={{
                        background: '#EFF6FF',
                        border: '1.5px solid #3B82F6',
                        color: '#1D4ED8',
                        borderRadius: 10,
                        padding: '6px 12px',
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      تمرین این مبحث ←
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              className="close-modal-btn"
              onClick={() => setShowMistakesModal(false)}
            >
              بستن
            </button>
          </div>
        </div>
      )}

      {/* ========================================================
          POPUP MODAL: TECHNIQUE & WORKED EXAMPLE (گام اول: آموزش تکنیک)
          ======================================================== */}
      {showTechniqueModal && activeTopic?.technique && (
        <div className="duo-modal-overlay" onClick={() => setShowTechniqueModal(false)}>
          <div
            className="duo-modal-card"
            style={{ maxWidth: 540, textAlign: 'right', maxHeight: '85vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: '40px', marginBottom: '4px' }}>🎓✨</div>
              <div style={{ fontSize: '11px', color: '#6366F1', fontWeight: 800 }}>
                گام ۱ از شیب یادگیری ۴ پله‌ای سمپاد
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 900, color: '#1E293B', margin: '4px 0' }}>
                {activeTopic.technique.title}
              </h3>
              <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>
                مفهوم کلیدی و تکنیک حل سریع تست‌های استعداد تحلیلی
              </p>
            </div>

            <div
              style={{
                background: '#ECFDF5',
                border: '1.5px solid #10B981',
                borderRadius: 14,
                padding: '12px 14px',
                marginBottom: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 16 }}>🔑</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: '#065F46' }}>
                  فرمول و کلید طلایی تکنیک:
                </span>
              </div>
              <p style={{ fontSize: 12.5, color: '#047857', margin: 0, lineHeight: 1.7, whiteSpace: 'pre-line' }}>
                {activeTopic.technique.rule}
              </p>
            </div>

            <div
              style={{
                background: '#F8FAFC',
                border: '1.5px solid #CBD5E1',
                borderRadius: 14,
                padding: '12px 14px',
                marginBottom: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 16 }}>📝</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: '#1E293B' }}>
                  مثال حل‌شده و نمونه آزمون:
                </span>
              </div>
              <p style={{ fontSize: 12.5, color: '#334155', margin: '0 0 8px 0', lineHeight: 1.6 }}>
                {activeTopic.technique.exampleQuestion}
              </p>
              <div
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: 10,
                  padding: '8px 12px',
                  fontSize: 12,
                  color: '#0F172A',
                  lineHeight: 1.6,
                }}
              >
                <strong style={{ color: '#2563EB' }}>💡 روش حل گام‌به‌گام: </strong>
                {activeTopic.technique.exampleSolution}
              </div>
            </div>

            <div
              style={{
                background: '#EFF6FF',
                border: '1px solid #BFDBFE',
                borderRadius: 12,
                padding: '8px 12px',
                fontSize: 11.5,
                color: '#1E40AF',
                marginBottom: 16,
              }}
            >
              📌 <strong>برنامه تمرین:</strong> پس از مطالعه این تکنیک، ۲ سوال بسیار ساده (گام ۲)، ۲ سوال متوسط (گام ۳) و ۱ تست واقعی سمپاد (گام ۴) در انتظار شماست.
            </div>

            <button
              type="button"
              className="start-lesson-btn"
              onClick={() => setShowTechniqueModal(false)}
            >
              متوجه شدم، بزن بریم برای حل سوالات 🚀
            </button>
          </div>
        </div>
      )}

      {/* ========================================================
          POPUP MODAL: REALM ATLAS / WORLD MAP (نقشه اقلیم‌ها)
          ======================================================== */}
      {showRealmAtlasModal && (
        <div className="duo-modal-overlay" onClick={() => setShowRealmAtlasModal(false)}>
          <div className="realm-atlas-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="atlas-modal-header">
              <div>
                <h3 className="atlas-modal-title">نقشه اقلیم‌های شش‌گانه تیزهوشان 🗺️</h3>
                <p className="atlas-modal-desc">
                  هر فصل دنیایی مستقل با بیش از ۱۰ تا ۲۲ گام و دایره‌های تخصصی است. اقلیم مورد نظر خود را انتخاب کن:
                </p>
              </div>
              <button
                type="button"
                className="close-modal-btn"
                style={{ minWidth: '40px', padding: '8px 12px' }}
                onClick={() => setShowRealmAtlasModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="atlas-realms-grid">
              {tizhooshanChaptersData.map((ch) => {
                const isSelected = ch.id === currentChapter.id
                const isUnlocked = isChapterUnlocked(ch.id)
                const chapterTopics = tizhooshanTopicsData.filter((t) => t.chapterId === ch.id)
                const completedCount = chapterTopics.filter((t) => progress.completedTopics[t.id]).length
                const percent = chapterTopics.length > 0 ? Math.round((completedCount / chapterTopics.length) * 100) : 0

                return (
                  <div
                    key={ch.id}
                    className={`atlas-realm-card ${isSelected ? 'active' : ''}`}
                    onClick={() => {
                      if (!isUnlocked) {
                        playSound('wrong')
                        setLockedAlert(`اقلیم فصل ${ch.id} هنوز قفل است! برای ورود باید فصل‌های قبل را فتح کنید 🔒`)
                        setTimeout(() => setLockedAlert(null), 3500)
                        return
                      }
                      setSelectedChapterId(ch.id)
                      setShowRealmAtlasModal(false)
                      playSound('click')
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                    style={{
                      opacity: !isUnlocked ? 0.6 : 1,
                      cursor: !isUnlocked ? 'not-allowed' : 'pointer',
                      border: !isUnlocked ? '2px dashed #94A3B8' : undefined,
                    }}
                  >
                    <div className="realm-card-top">
                      <div className="realm-card-icon" style={{ background: !isUnlocked ? '#64748B' : ch.color }}>
                        {!isUnlocked ? '🔒' : ch.icon}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="realm-step-badge">
                          فصل {ch.id} • {ch.environmentName} {!isUnlocked && '(قفل)'}
                        </div>
                        <h4 className="realm-card-name">{ch.title}</h4>
                      </div>
                      {!isUnlocked ? (
                        <span className="active-tag" style={{ background: '#E2E8F0', color: '#64748B' }}>
                          🔒 قفل
                        </span>
                      ) : isSelected ? (
                        <span className="active-tag">🌟 در حال کاوش</span>
                      ) : null}
                    </div>

                    <p className="realm-card-desc">{ch.desc}</p>

                    <div className="realm-card-progress">
                      <div className="realm-progress-info">
                        <span>{isUnlocked ? `${completedCount} از ${chapterTopics.length} گام تکمیل شده` : 'نیاز به تکمیل فصل قبلی'}</span>
                        <span>{isUnlocked ? `${percent}٪` : '۰٪'}</span>
                      </div>
                      <div className="realm-progress-track">
                        <div
                          className="realm-progress-fill"
                          style={{
                            width: `${isUnlocked ? percent : 0}%`,
                            background: !isUnlocked ? '#94A3B8' : ch.accentColor,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <button
                type="button"
                className="close-modal-btn"
                style={{ width: '100%', maxWidth: '280px' }}
                onClick={() => setShowRealmAtlasModal(false)}
              >
                بستن نقشه
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          IN-LESSON / QUIZ FULLSCREEN CONTAINER
          ======================================================== */}
      {(activeTopic || isEndlessActive) && currentQuestion && (
        <div className="tizhooshan-quiz-modal">
          {/* Top Progress Bar and Exit Controls */}
          <div className="quiz-header-bar">
            <button
              type="button"
              className="quiz-exit-btn"
              onClick={() => {
                playSound('click')
                setActiveTopic(null)
                setIsEndlessActive(false)
              }}
              title="خروج از درس"
            >
              ✕
            </button>

            <div className="quiz-progress-track">
              <div
                className="quiz-progress-fill"
                style={{
                  width: isEndlessActive
                    ? `${Math.min(100, ((currentQIndex + 1) % 10) * 10)}%`
                    : `${((currentQIndex + (isAnswerChecked && isCorrect ? 1 : 0)) / (activeTopic?.questions.length || 1)) * 100}%`,
                }}
              />
            </div>

            <div className="quiz-hearts-display" title="قلب‌های باقیمانده">
              <span className="heart-icon">❤️</span>
              <span className="heart-count">{progress.hearts}</span>
            </div>
          </div>

          {!quizFinished ? (
            lessonPhase === 'step1_technique' && activeTopic && effectiveTechnique ? (
              <div className="quiz-card-body" style={{ maxWidth: 580, margin: '0 auto', textAlign: 'right' }}>
                {/* 4-Step Stepper Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    padding: '10px 14px',
                    background: '#F8FAFC',
                    border: '1.5px solid #E2E8F0',
                    borderRadius: 14,
                    marginBottom: 16,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
                        color: '#FFFFFF',
                        padding: '4px 10px',
                        borderRadius: 8,
                        fontSize: 11.5,
                        fontWeight: 900,
                        boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)',
                      }}
                    >
                      🎓 گام ۱: قلق ذهنی (در حال مطالعه)
                    </span>
                    <span
                      style={{
                        background: '#F1F5F9',
                        color: '#64748B',
                        padding: '4px 10px',
                        borderRadius: 8,
                        fontSize: 11.5,
                        fontWeight: 800,
                      }}
                    >
                      🟢 گام ۲: ۲ سوال ساده
                    </span>
                    <span
                      style={{
                        background: '#F1F5F9',
                        color: '#64748B',
                        padding: '4px 10px',
                        borderRadius: 8,
                        fontSize: 11.5,
                        fontWeight: 800,
                      }}
                    >
                      🟡 گام ۳: ۲ سوال ترکیبی
                    </span>
                    <span
                      style={{
                        background: '#F1F5F9',
                        color: '#64748B',
                        padding: '4px 10px',
                        borderRadius: 8,
                        fontSize: 11.5,
                        fontWeight: 800,
                      }}
                    >
                      🏆 گام ۴: چالش سمپاد
                    </span>
                  </div>
                </div>

                {/* Mascot Welcome Header */}
                <div className="q-bubble-box" style={{ marginBottom: 16 }}>
                  <div className="owl-mini">🦉</div>
                  <div className="q-speech-wrapper">
                    <span className="mascot-speech-bubble">
                      سلام قهرمان! قبل از شروع تست‌ها، قلق طلایی و تکنیک حل این مفهوم رو با هم یاد بگیریم!
                    </span>
                    <h3 className="q-text-prompt" style={{ fontSize: 16, margin: '6px 0 0 0', color: '#1E293B' }}>
                      {activeTopic.topic}
                    </h3>
                  </div>
                </div>

                {/* Card 1: Mental Trick & Golden Rule */}
                <div
                  style={{
                    background: '#ECFDF5',
                    border: '2px solid #10B981',
                    borderRadius: 16,
                    padding: '16px 18px',
                    marginBottom: 14,
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.08)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 20 }}>🔑</span>
                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#065F46' }}>
                      {effectiveTechnique.title || 'قلق ذهنی و کلید طلایی تکنیک'}
                    </h4>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.75, color: '#047857', whiteSpace: 'pre-line' }}>
                    {effectiveTechnique.rule}
                  </p>
                </div>

                {/* Card 2: Worked Example from Sampad */}
                <div
                  style={{
                    background: '#F8FAFC',
                    border: '1.5px solid #CBD5E1',
                    borderRadius: 16,
                    padding: '16px 18px',
                    marginBottom: 16,
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 20 }}>📝</span>
                    <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 900, color: '#1E293B' }}>
                      مثال حل‌شده و نمونه آزمون سمپاد:
                    </h4>
                  </div>
                  <p style={{ margin: '0 0 10px 0', fontSize: 13, lineHeight: 1.7, color: '#334155' }}>
                    {effectiveTechnique.exampleQuestion}
                  </p>
                  <div
                    style={{
                      background: '#FFFFFF',
                      border: '1.5px solid #E2E8F0',
                      borderRadius: 12,
                      padding: '10px 14px',
                      fontSize: 12.5,
                      color: '#0F172A',
                      lineHeight: 1.7,
                    }}
                  >
                    <strong style={{ color: '#2563EB' }}>💡 روش حل گام‌به‌گام: </strong>
                    {effectiveTechnique.exampleSolution}
                  </div>
                </div>

                {/* Learning Path Preview */}
                <div
                  style={{
                    background: '#EFF6FF',
                    border: '1.5px solid #BFDBFE',
                    borderRadius: 14,
                    padding: '12px 16px',
                    fontSize: 12,
                    color: '#1E40AF',
                    marginBottom: 20,
                    lineHeight: 1.7,
                  }}
                >
                  <strong>🎯 شیب یادگیری ۴ پله‌ای پیش‌رو:</strong>
                  <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span>• <strong>گام ۲:</strong> ۲ سوال ساده برای تثبیت مفهوم اولیه</span>
                    <span>• <strong>گام ۳:</strong> ۲ سوال متوسط ترکیبی</span>
                    <span>• <strong>گام ۴:</strong> ۱ سوال چالشی برگرفته از تست‌های واقعی ۱۴۰۲ و ۱۴۰۳ سمپاد 🏆</span>
                  </div>
                </div>

                {/* Action Button to Enter Step 2 */}
                <button
                  type="button"
                  className="start-lesson-btn"
                  style={{ width: '100%', padding: '14px 20px', fontSize: 15 }}
                  onClick={() => {
                    playSound('click')
                    setLessonPhase('questions')
                    setCurrentQIndex(0)
                  }}
                >
                  ورود به گام ۲: حل ۲ سوال تثبیت اولیه (ساده) ➔
                </button>
              </div>
            ) : (
              <div className="quiz-card-body">
                {/* 4-Step Learning Progression Staircase */}
                {!isEndlessActive && activeTopic && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                      padding: '8px 12px',
                      background: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      borderRadius: 12,
                      marginBottom: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 900, color: '#64748B' }}>شیب یادگیری:</span>
                      <button
                        type="button"
                        onClick={() => setLessonPhase('step1_technique')}
                        style={{
                          background: '#EFF6FF',
                          color: '#1D4ED8',
                          border: '1px solid #BFDBFE',
                          borderRadius: 8,
                          padding: '3px 8px',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                        title="مشاهده کارت تکنیک و مثال حل‌شده گام اول"
                      >
                        <span>🎓 گام ۱: قلق ذهنی ✓</span>
                      </button>

                      {currentQuestion._isRepeat ? (
                        <span
                          style={{
                            background: 'linear-gradient(135deg, #EA580C 0%, #C2410C 100%)',
                            color: '#FFFFFF',
                            padding: '3px 10px',
                            borderRadius: 8,
                            fontSize: 11,
                            fontWeight: 900,
                            boxShadow: '0 2px 6px rgba(234, 88, 12, 0.35)',
                          }}
                        >
                          🔁 حلقه بازیابی اشتباه
                        </span>
                      ) : (
                        <>
                          <span
                            style={{
                              background: currentQIndex < 2 ? '#10B981' : '#E2E8F0',
                              color: currentQIndex < 2 ? '#FFFFFF' : '#64748B',
                              padding: '3px 8px',
                              borderRadius: 8,
                              fontSize: 11,
                              fontWeight: 800,
                              transition: 'all 0.3s ease',
                            }}
                          >
                            🟢 گام ۲: ۲ سوال ساده {currentQIndex < 2 ? `(${toPersianDigits(currentQIndex + 1)} از ۲)` : '✓'}
                          </span>
                          <span
                            style={{
                              background: currentQIndex >= 2 && currentQIndex < 4 ? '#F59E0B' : '#E2E8F0',
                              color: currentQIndex >= 2 && currentQIndex < 4 ? '#FFFFFF' : '#64748B',
                              padding: '3px 8px',
                              borderRadius: 8,
                              fontSize: 11,
                              fontWeight: 800,
                              transition: 'all 0.3s ease',
                            }}
                          >
                            🟡 گام ۳: ۲ سوال ترکیبی {currentQIndex >= 2 && currentQIndex < 4 ? `(${toPersianDigits(currentQIndex - 1)} از ۲)` : currentQIndex >= 4 ? '✓' : ''}
                          </span>
                          <span
                            style={{
                              background: currentQIndex === 4 ? '#8B5CF6' : '#E2E8F0',
                              color: currentQIndex === 4 ? '#FFFFFF' : '#64748B',
                              padding: '3px 8px',
                              borderRadius: 8,
                              fontSize: 11,
                              fontWeight: 900,
                              transition: 'all 0.3s ease',
                            }}
                          >
                            🏆 گام ۴: چالش سمپاد {currentQIndex === 4 ? '(فعال)' : ''}
                          </span>
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setLessonPhase('step1_technique')}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#2563EB',
                        fontSize: 11.5,
                        fontWeight: 800,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      مرور قلق ذهنی 💡
                    </button>
                  </div>
                )}

                {/* Repeat Reminder Banner for Mistakes Queue */}
                {currentQuestion._isRepeat && (
                  <div
                    style={{
                      background: '#FFF7ED',
                      border: '2px solid #EA580C',
                      color: '#9A3412',
                      borderRadius: 12,
                      padding: '10px 14px',
                      marginBottom: 12,
                      fontSize: 12.5,
                      fontWeight: 900,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      lineHeight: 1.6,
                      boxShadow: '0 2px 8px rgba(234, 88, 12, 0.15)',
                    }}
                  >
                    <span style={{ fontSize: 20 }}>🔁</span>
                    <span>
                      <strong>حلقه بازیابی اشتباهات:</strong> این سوال را قبلاً اشتباه پاسخ داده بودید. برای اتمام درس و تسلط عمیق، این بار با دقت به تحلیل تکنیک و گزینه‌ها، گزینه درست را انتخاب کنید!
                    </span>
                  </div>
                )}

              {/* Question Meta Badge */}
              <div className="q-badge-header">
                <span className="q-difficulty-pill">
                  {currentQuestion.badge && (
                    <span
                      style={{
                        background: currentQuestion.stage === 'تست واقعی سمپاد'
                          ? 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)'
                          : '#2563EB',
                        color: '#FFFFFF',
                        padding: '2px 8px',
                        borderRadius: 6,
                        marginLeft: 6,
                        fontSize: 11,
                        fontWeight: 900,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        boxShadow: currentQuestion.stage === 'تست واقعی سمپاد' ? '0 2px 6px rgba(124, 58, 237, 0.3)' : 'none',
                      }}
                    >
                      <span>{currentQuestion.stage === 'تست واقعی سمپاد' ? '🏆' : '📌'}</span>
                      <span>{currentQuestion.badge}</span>
                    </span>
                  )}
                  {currentQuestion.difficulty === 'آسان'
                    ? '🟢 سطح آسان'
                    : currentQuestion.difficulty === 'متوسط'
                    ? '🟡 سطح متوسط'
                    : '🔴 سطح پیشرفته'}{' '}
                  (+{currentQuestion.xp} XP)
                </span>

                <div className="q-action-tools">
                  {activeTopic?.technique && (
                    <button
                      type="button"
                      className="lifeline-pill-btn"
                      onClick={() => setShowTechniqueModal(true)}
                      title="مشاهده تکنیک حل گام اول"
                      style={{ background: '#EFF6FF', color: '#1D4ED8', borderColor: '#BFDBFE' }}
                    >
                      🎓 تکنیک
                    </button>
                  )}

                  <button
                    type="button"
                    className="lifeline-pill-btn"
                    disabled={eliminatedOptions.length > 0 || isAnswerChecked}
                    onClick={handleUseLifeline5050}
                    title="حذف دو گزینه نادرست (۵۰/۵۰)"
                  >
                    ✂️ ۵۰/۵۰
                  </button>

                  <span className="q-progress-text">
                    {isEndlessActive
                      ? `سوال بی‌پایان #${toPersianDigits(currentQIndex + 1)}`
                      : `سوال ${toPersianDigits(currentQIndex + 1)} از ${toPersianDigits(activeTopic?.questions.length || 0)}`}
                  </span>
                </div>
              </div>

              {/* Question Prompt with Owl Mascot speech */}
              <div className="q-bubble-box">
                <div className="owl-mini">{mascotFeedback.icon}</div>
                <div className="q-speech-wrapper">
                  <span className="mascot-speech-bubble">{mascotFeedback.text}</span>
                  <h3 className="q-text-prompt">{currentQuestion.question}</h3>
                </div>
              </div>

              {/* Key Concept Hint */}
              <div className="hint-expander">
                <button
                  type="button"
                  className="hint-toggle-btn"
                  onClick={() => setShowHint(!showHint)}
                >
                  <span>💡</span> {showHint ? 'بستن راهنما' : 'راهنمایی و مفهوم کلیدی'}
                </button>
                {showHint && (
                  <div className="hint-text-panel">
                    {activeTopic?.lesson_summary || currentQuestion.explanation}
                  </div>
                )}
              </div>

              {/* Options Grid */}
              <div className="options-grid">
                {currentQuestion.options.map((option, optIdx) => {
                  const isSelected = selectedOption === optIdx
                  const isEliminated = eliminatedOptions.includes(optIdx)
                  const letters = ['الف', 'ب', 'ج', 'د']

                  let stateClass = ''
                  if (isAnswerChecked) {
                    if (optIdx === currentQuestion.correct_index) {
                      stateClass = 'correct'
                    } else if (isSelected && !isCorrect) {
                      stateClass = 'wrong'
                    }
                  } else if (isSelected) {
                    stateClass = 'selected'
                  }

                  return (
                    <button
                      key={optIdx}
                      type="button"
                      className={`duo-option-card ${stateClass} ${
                        isEliminated ? 'eliminated' : ''
                      }`}
                      disabled={isAnswerChecked || isEliminated}
                      onClick={() => {
                        handleCheckAnswer(optIdx)
                      }}
                    >
                      <span className="opt-letter">{letters[optIdx]}</span>
                      <span className="opt-text">{isEliminated ? '--- حذف شد ---' : option}</span>
                      {isAnswerChecked && optIdx === currentQuestion.correct_index && (
                        <span className="opt-check" style={{ color: '#16A34A' }}>✓</span>
                      )}
                      {isAnswerChecked && isSelected && !isCorrect && (
                        <span className="opt-check" style={{ color: '#DC2626' }}>✕</span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Sticky Bottom Action Drawer */}
              {isAnswerChecked && (
                <div
                  className={`quiz-footer-drawer ${
                    isCorrect ? 'correct-drawer' : 'wrong-drawer'
                  }`}
                >
                  <div className="feedback-content">
                    <div className="feedback-info">
                      <div className="feedback-title">
                        {isCorrect ? (
                          <>
                            <span className="feedback-icon">🎉</span>
                            <span>آفرین! پاسخ کاملاً درسته!</span>
                            <span className="xp-gain-badge">
                              +{currentQuestion.xp + (comboCount >= 3 ? 10 : comboCount === 2 ? 5 : 0)}{' '}
                              XP
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="feedback-icon">❌</span>
                            <span>پاسخ اشتباه بود!</span>
                            <span
                              style={{
                                fontSize: 12,
                                background: 'rgba(239, 68, 68, 0.2)',
                                color: '#991B1B',
                                padding: '4px 10px',
                                borderRadius: 8,
                                fontWeight: 900,
                                marginRight: 6,
                              }}
                            >
                              🔁 این سوال به انتهای صف اضافه شد و تا زمانی که آن را درست حل نکنید، درس بسته نخواهد شد.
                            </span>
                          </>
                        )}
                      </div>
                      <div className="feedback-explanation">
                        <div style={{ fontWeight: 900, marginBottom: 4, color: isCorrect ? '#166534' : '#991B1B' }}>
                          {isCorrect ? '💡 تحلیل و نکته کلیدی:' : '📚 پاسخ تشریحی کامل و راهبرد حل تست:'}
                        </div>
                        <div style={{ whiteSpace: 'pre-line', lineHeight: 1.7 }}>
                          {currentQuestion.explanation}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      className={`duo-continue-btn ${isCorrect ? 'green-btn' : 'red-btn'}`}
                      onClick={handleNextQuestion}
                    >
                      {isEndlessActive ? 'سوال بعدی بی‌پایان ♾️' : 'ادامه ←'}
                    </button>
                  </div>
                </div>
              )}
            </div>
            )
          ) : (
            /* Celebration Screen */
            <div className="quiz-celebration-container">
              <div className="celebration-animation">
                <span className="trophy-big">🏆</span>
                <div className="stars-row">⭐️ ⭐️ ⭐️</div>
              </div>

              <h2 className="celebration-title">درس با موفقیت تکمیل شد!</h2>
              <p className="celebration-sub">
                مهارت «{activeTopic?.topic}» با موفقیت تقویت شد!
              </p>

              <div className="celebration-stats-grid">
                <div className="celeb-card xp">
                  <span className="celeb-val">+{sessionXpEarned}</span>
                  <span className="celeb-lbl">امتیاز XP کسب‌شده</span>
                </div>
                <div className="celeb-card accuracy">
                  <span className="celeb-val">
                    {activeTopic
                      ? Math.round((sessionCorrectCount / activeTopic.questions.length) * 100)
                      : 100}
                    ٪
                  </span>
                  <span className="celeb-lbl">دقت پاسخگویی</span>
                </div>
                <div className="celeb-card next">
                  <span className="celeb-val">مرحله بعد</span>
                  <span className="celeb-lbl">قفل باز شد 🔓</span>
                </div>
              </div>

              <button
                type="button"
                className="celeb-finish-btn"
                onClick={() => {
                  playSound('click')
                  setActiveTopic(null)
                  setIsEndlessActive(false)
                }}
              >
                بازگشت به نقشه یادگیری 🦉
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
