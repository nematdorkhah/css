import express from 'express'
import path from 'path'
import { createServer as createViteServer } from 'vite'
import { GoogleGenAI } from '@google/genai'
import { createClient } from '@supabase/supabase-js'

const CANDIDATE_MODELS = ['gemini-3.8-flash', 'gemini-3.1-flash-lite']

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ephgqrnbpxvxlzloflhy.supabase.co'
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_bI5v4Hzokb0A4JWJDzuz1A_4B3lIUX_'

// 3-second timeout for all Supabase network calls
const SUPABASE_TIMEOUT_MS = 3000

const supabaseFetchWithTimeout: typeof fetch = async (url, options = {}) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS)
  const existingSignal = options.signal

  if (existingSignal) {
    if (existingSignal.aborted) {
      clearTimeout(timeoutId)
      controller.abort()
    } else {
      existingSignal.addEventListener('abort', () => {
        clearTimeout(timeoutId)
        controller.abort()
      })
    }
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
  global: { fetch: supabaseFetchWithTimeout },
})

// Safe promise wrapper ensuring execution never hangs for more than 3000ms
async function withSupabaseTimeout<T>(
  promise: Promise<T> | PromiseLike<T>,
  timeoutMs = SUPABASE_TIMEOUT_MS,
  fallback: any = { data: null, error: new Error('Supabase request timed out after 3000ms') }
): Promise<T> {
  let timer: NodeJS.Timeout
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(fallback)
    }, timeoutMs)
  })
  return Promise.race([
    Promise.resolve(promise).catch((err) => {
      console.warn('Supabase call error:', err?.message || err)
      return fallback
    }),
    timeoutPromise,
  ]).finally(() => {
    clearTimeout(timer)
  })
}

function sanitizeTeacherNote(text?: string): string {
  if (!text) return ''
  let cleaned = String(text).trim()
  if (cleaned.startsWith('{') || cleaned.includes('"teacherSummaryNote"')) {
    try {
      const m = cleaned.match(/\{[\s\S]*\}/)
      if (m) {
        const p = JSON.parse(m[0])
        cleaned = p.teacherSummaryNote || p.teacherNotes || p.summary || p.feedback || cleaned
      }
    } catch {}
  }
  cleaned = cleaned.replace(/```(?:json)?[\s\S]*?```/g, '').trim()
  const badPatterns = [
    /شما آموزگار مهربان.*?(?:هستید|باشید)[.،:\n]/gi,
    /وظایف شما:.*?(?=\n[۱-۹]|\n[A-Z]|\n\n|$)/gis,
    /اطلاعات سوالات، بارم.*?(?=\n\n|$)/gis,
    /خروجی صرفاً JSON.*?(?=\n\n|$)/gis,
    /System Instructions?:?.*?(?=\n\n|$)/gis,
    /Prompt:?.*?(?=\n\n|$)/gis,
    /\{\s*"grades"[\s\S]*?\}/gis,
  ]
  for (const b of badPatterns) cleaned = cleaned.replace(b, '')
  return cleaned.replace(/^[\{\}\[\]"'\s]+|[\{\}\[\]"'\s]+$/g, '').trim()
}

async function verifyTeacher(password?: string): Promise<boolean> {
  if (!password) return false
  const cleanPass = String(password).trim()
  if (!cleanPass) return false

  if (process.env.TEACHER_PASSWORD && cleanPass === process.env.TEACHER_PASSWORD.trim()) {
    return true
  }

  try {
    const { data, error } = await withSupabaseTimeout(
      supabase.rpc('verify_teacher', { p_password: cleanPass }),
      SUPABASE_TIMEOUT_MS,
      { data: false, error: new Error('Timeout') }
    )
    if (!error && data) return true
  } catch (err) {
    console.warn('Teacher verification failed', err)
  }
  return false
}

function normalizePersianForComparison(text: string): string {
  if (!text) return ''
  return String(text)
    .toLowerCase()
    .replace(/[\u200c\u200b\u200e\u200f]/g, '') // remove zero-width non-joiners
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[ة]/g, 'ه')
    .replace(/[آأإ]/g, 'ا')
    .replace(/\s+/g, '') // remove all whitespace for space-insensitivity
    .trim()
}

function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  })
}

async function callGeminiWithFallbacks(prompt: string, responseJson = false): Promise<string> {
  const ai = getGeminiClient()
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured on the server.')
  }

  let lastError: any = null
  for (const model of CANDIDATE_MODELS) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
        config: responseJson ? { responseMimeType: 'application/json' } : undefined,
      })
      if (res && res.text) {
        return res.text.trim()
      }
    } catch (err: any) {
      console.warn(`[Gemini] Model ${model} failed:`, err?.message || err)
      lastError = err
    }
  }

  throw lastError || new Error('خطا در برقراری ارتباط با مدل‌های هوش مصنوعی')
}

async function startServer() {
  const app = express()
  const PORT = 3000

  app.use(express.json({ limit: '20mb' }))

  const SYSTEM_TEACHER_KEY = process.env.TEACHER_PASSWORD?.trim() || '1234'

  // Centralized persistent memory backed by Supabase
  let cachedExams: any[] = []
  const cachedSubmissionsMap = new Map<string, any>()
  let cachedSubmissions: any[] = []
  let cachedTizhooshanProgress: Record<string, any> = {}
  let isInitializedFromSupabase = false

  // In-memory mutex per (examId:studentId) for atomic upsert operations to eliminate race conditions
  const submissionLocks = new Map<string, Promise<void>>()
  async function withSubmissionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const currentLock = submissionLocks.get(key) || Promise.resolve()
    let resolveNext: () => void
    const nextLock = new Promise<void>((resolve) => {
      resolveNext = resolve
    })
    submissionLocks.set(key, currentLock.then(() => nextLock))
    try {
      await currentLock
      return await fn()
    } finally {
      resolveNext!()
      if (submissionLocks.get(key) === nextLock) {
        submissionLocks.delete(key)
      }
    }
  }

  // Upsert an independent exam submission record per (examId, studentId) in Supabase
  async function upsertExamSubmissionRecord(
    examId: string,
    studentId: string,
    submission: any,
    teacherPassword?: string
  ) {
    const pass = teacherPassword || SYSTEM_TEACHER_KEY
    const subKey = `${examId}:${studentId}`
    const recordTitle = `__EXAM_SUB__:${examId}:${studentId}`
    const bodyJson = JSON.stringify(submission)

    // 1. Immediately update in-memory Map & array to keep server state synchronous
    cachedSubmissionsMap.set(subKey, submission)
    cachedSubmissions = Array.from(cachedSubmissionsMap.values())

    // 2. Persist to Supabase under an isolated record for this student and exam
    return withSubmissionLock(subKey, async () => {
      try {
        const { data: posts } = await withSupabaseTimeout(
          supabase.rpc('teacher_list_posts', { p_password: pass }),
          SUPABASE_TIMEOUT_MS,
          { data: [] }
        )
        const existing = (posts || []).filter((p: any) => p.title === recordTitle)

        if (existing.length > 0) {
          const primary = existing[0]
          await withSupabaseTimeout(
            supabase.rpc('teacher_update_post', {
              p_password: pass,
              p_post_id: primary.id,
              p_title: recordTitle,
              p_body: bodyJson,
              p_type: 'announcement',
              p_due_at: null,
              p_publish_at: new Date().toISOString(),
              p_attachment_path: null,
            }),
            SUPABASE_TIMEOUT_MS
          )

          // Clean up any duplicates for this key
          for (let i = 1; i < existing.length; i++) {
            withSupabaseTimeout(
              supabase.rpc('teacher_delete_post', { p_password: pass, p_post_id: existing[i].id }),
              SUPABASE_TIMEOUT_MS
            ).catch(() => {})
          }
        } else {
          await withSupabaseTimeout(
            supabase.rpc('teacher_create_post', {
              p_password: pass,
              p_type: 'announcement',
              p_title: recordTitle,
              p_body: bodyJson,
              p_due_at: null,
              p_publish_at: new Date().toISOString(),
              p_attachment_path: null,
            }),
            SUPABASE_TIMEOUT_MS
          )
        }
      } catch (err) {
        console.warn(`Failed persisting independent exam submission ${recordTitle} to Supabase:`, err)
      }
    })
  }

  async function initDataFromSupabase() {
    if (isInitializedFromSupabase) return
    try {
      const { data: posts } = await withSupabaseTimeout(
        supabase.rpc('list_published_posts'),
        SUPABASE_TIMEOUT_MS,
        { data: [] }
      )
      if (posts && Array.isArray(posts)) {
        // 1. Tizhooshan progress
        const progPost = posts.find((p: any) => p.title === '__SYSTEM_TIZHOOSHAN_PROGRESS__')
        if (progPost?.body) {
          try {
            cachedTizhooshanProgress = JSON.parse(progPost.body)
          } catch (e) {
            console.warn('Failed parsing tizhooshan progress from Supabase post', e)
          }
        }

        // 2. Exam submissions (individual records per examId and studentId + legacy fallback)
        const subPosts = posts.filter((p: any) => p.title && p.title.startsWith('__EXAM_SUB__:'))
        for (const sp of subPosts) {
          try {
            const parsed = JSON.parse(sp.body)
            if (parsed && parsed.examId && parsed.studentId) {
              cachedSubmissionsMap.set(`${parsed.examId}:${parsed.studentId}`, parsed)
            }
          } catch (e) {
            console.warn('Failed parsing independent submission from Supabase post', e)
          }
        }

        // Backward compatibility: load legacy __SYSTEM_EXAM_SUBMISSIONS__ entries not yet migrated
        const subsPost = posts.find((p: any) => p.title === '__SYSTEM_EXAM_SUBMISSIONS__')
        if (subsPost?.body) {
          try {
            const legacyArray = JSON.parse(subsPost.body)
            if (Array.isArray(legacyArray)) {
              for (const item of legacyArray) {
                if (item && item.examId && item.studentId) {
                  const key = `${item.examId}:${item.studentId}`
                  if (!cachedSubmissionsMap.has(key)) {
                    cachedSubmissionsMap.set(key, item)
                  }
                }
              }
            }
          } catch (e) {
            console.warn('Failed parsing legacy submissions from Supabase post', e)
          }
        }

        cachedSubmissions = Array.from(cachedSubmissionsMap.values())

        // 3. Exams
        const examPosts = posts.filter((p: any) => p.type === 'exam' || p.title === '__SYSTEM_EXAMS__')
        const loadedExamsMap = new Map<string, any>()
        for (const p of examPosts) {
          try {
            const parsed = JSON.parse(p.body)
            if (Array.isArray(parsed)) {
              parsed.forEach((e: any) => { if (e && e.id) loadedExamsMap.set(e.id, e) })
            } else if (parsed && parsed.id) {
              loadedExamsMap.set(parsed.id, parsed)
            }
          } catch {}
        }
        if (loadedExamsMap.size > 0) {
          cachedExams = Array.from(loadedExamsMap.values())
        }
      }

      isInitializedFromSupabase = true
    } catch (err) {
      console.warn('Initial Supabase load error:', err)
    }
  }

  // Sync helper to update or create system posts in Supabase with 3s timeout
  async function syncSystemPost(title: string, bodyJson: string, teacherPassword?: string) {
    const pass = teacherPassword || SYSTEM_TEACHER_KEY
    try {
      const { data: posts } = await withSupabaseTimeout(
        supabase.rpc('list_published_posts'),
        SUPABASE_TIMEOUT_MS,
        { data: [] }
      )
      const existing = (posts || []).filter((p: any) => p.title === title)
      
      const createRes = await withSupabaseTimeout(
        supabase.rpc('teacher_create_post', {
          p_password: pass,
          p_type: 'announcement',
          p_title: title,
          p_body: bodyJson,
          p_due_at: null,
          p_publish_at: new Date().toISOString(),
          p_attachment_path: null,
        }),
        SUPABASE_TIMEOUT_MS,
        { data: null }
      )

      const newId = (createRes as any)?.data?.id
      for (const old of existing) {
        if (old.id && old.id !== newId) {
          withSupabaseTimeout(
            supabase.rpc('teacher_delete_post', { p_password: pass, p_post_id: old.id }),
            SUPABASE_TIMEOUT_MS
          ).catch(() => {})
        }
      }
    } catch (err) {
      console.warn(`Failed syncing system post ${title} to Supabase:`, err)
    }
  }

  // Non-blocking background loader
  let initDataPromise: Promise<void> | null = null
  function runInitDataBackground() {
    if (isInitializedFromSupabase) return Promise.resolve()
    if (initDataPromise) return initDataPromise

    initDataPromise = (async () => {
      try {
        await initDataFromSupabase()
      } catch (err) {
        console.warn('Background Supabase initialization failed:', err)
      } finally {
        initDataPromise = null
      }
    })()

    return initDataPromise
  }

  // Route-level data assurance: non-blocking bounded wait so requests never hang
  async function ensureDataInitialized() {
    if (isInitializedFromSupabase) return
    try {
      await Promise.race([
        runInitDataBackground(),
        new Promise((resolve) => setTimeout(resolve, 1200)),
      ])
    } catch {}
  }

  // 1. Completely non-blocking background initialization: Does NOT block server listening
  setTimeout(() => {
    runInitDataBackground().catch((err) => {
      console.warn('Non-blocking init error:', err)
    })
  }, 0)

  // Teacher Authentication Middleware for sensitive management endpoints
  const requireTeacherAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    let teacherPass = (req.headers['x-teacher-password'] as string) || req.body?.teacherPassword
    if (!teacherPass) {
      const authHeader = req.headers['authorization']
      if (authHeader && authHeader.startsWith('Bearer ')) {
        teacherPass = authHeader.slice(7).trim()
      }
    }
    if (!teacherPass && req.query?.teacherPassword) {
      teacherPass = String(req.query.teacherPassword).trim()
    }

    if (!teacherPass) {
      return res.status(401).json({
        success: false,
        error: 'دسترسی غیرمجاز. ارائه هدر معتبر x-teacher-password برای انجام این عملیات الزامی است.',
      })
    }

    const isValid = await verifyTeacher(teacherPass)
    if (!isValid) {
      return res.status(403).json({
        success: false,
        error: 'رمز عبور آموزگار نادرست است. دسترسی به عملیات مدیریتی مجاز نمی‌باشد.',
      })
    }

    return next()
  }

  // AI Endpoint protection middleware: strictly requires valid teacher password/header
  const requireAiAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    let teacherPass = (req.headers['x-teacher-password'] as string) || req.body?.teacherPassword
    if (!teacherPass) {
      const authHeader = req.headers['authorization']
      if (authHeader && authHeader.startsWith('Bearer ')) {
        teacherPass = authHeader.slice(7).trim()
      }
    }

    if (!teacherPass) {
      return res.status(401).json({
        success: false,
        error: 'دسترسی به درگاه هوش مصنوعی مسدود است. ارائه رمز عبور یا هدر آموزگار (x-teacher-password) الزامی است.',
      })
    }

    const isValid = await verifyTeacher(teacherPass)
    if (!isValid) {
      return res.status(403).json({
        success: false,
        error: 'رمز عبور آموزگار نادرست یا نامعتبر است. دسترسی به امکانات هوش مصنوعی مجاز نمی‌باشد.',
      })
    }

    return next()
  }

  // --------------------------------------------------------------------------
  // PRINCIPAL READ-ONLY ACCESS (Secure, strictly read-only, answer keys stripped)
  // --------------------------------------------------------------------------
  const PRINCIPAL_PASSWORD = 'khalili100'

  const requirePrincipalAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    let pass = (req.headers['x-principal-password'] as string) || req.body?.principalPassword
    if (!pass) {
      const authHeader = req.headers['authorization']
      if (authHeader && authHeader.startsWith('Bearer ')) {
        pass = authHeader.slice(7).trim()
      }
    }
    if (!pass && req.query?.principalPassword) {
      pass = String(req.query.principalPassword).trim()
    }
    if (pass !== PRINCIPAL_PASSWORD) {
      return res.status(401).json({
        success: false,
        error: 'رمز عبور مدیریت مدرسه نادرست است.',
      })
    }
    return next()
  }

  // Strictly Read-Only Principal Dashboard Data
  app.get('/api/principal/classroom-data', requirePrincipalAuth, async (_req, res) => {
    try {
      await ensureDataInitialized()
      const [s, p, sub, allAtt, g] = await Promise.all([
        withSupabaseTimeout(supabase.rpc('teacher_list_students', { p_password: SYSTEM_TEACHER_KEY }), SUPABASE_TIMEOUT_MS, { data: [] }),
        withSupabaseTimeout(supabase.rpc('teacher_list_posts', { p_password: SYSTEM_TEACHER_KEY }), SUPABASE_TIMEOUT_MS, { data: [] }),
        withSupabaseTimeout(supabase.rpc('teacher_list_submissions', { p_password: SYSTEM_TEACHER_KEY }), SUPABASE_TIMEOUT_MS, { data: [] }),
        withSupabaseTimeout(supabase.rpc('teacher_list_attendance', { p_password: SYSTEM_TEACHER_KEY }), SUPABASE_TIMEOUT_MS, { data: [] }),
        withSupabaseTimeout(supabase.rpc('teacher_list_grades', { p_password: SYSTEM_TEACHER_KEY }), SUPABASE_TIMEOUT_MS, { data: [] }),
      ])

      // Sanitize exams so questions do not leak correct answers or rubrics
      const sanitizedExams = cachedExams.map((exam) => {
        const { ...safeExam } = exam
        if (Array.isArray(safeExam.questions)) {
          safeExam.questions = safeExam.questions.map((q: any) => {
            const { correctAnswer, rubricOrHint, ...safeQuestion } = q
            return safeQuestion
          })
        }
        return safeExam
      })

      res.json({
        success: true,
        students: s.data || [],
        posts: p.data || [],
        submissions: sub.data || [],
        allAttendance: allAtt.data || [],
        grades: g.data || [],
        tizhooshanProgress: cachedTizhooshanProgress || {},
        exams: sanitizedExams,
        examSubmissions: cachedSubmissions || [],
      })
    } catch (err: any) {
      console.error('Error fetching principal classroom data:', err)
      res.status(500).json({ success: false, error: 'خطا در دریافت اطلاعات نظارتی مدیریت' })
    }
  })

  // Uniformly enforce teacher authentication across ALL /api/ai/* endpoints to prevent unauthorized quota consumption
  app.use('/api/ai', requireAiAuth)

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    })
  })

  // --------------------------------------------------------------------------
  // EXAM CRUD & PERSISTENCE (With Student Answer-Key Stripping for Security)
  // --------------------------------------------------------------------------
  app.get('/api/exams', async (req, res) => {
    await ensureDataInitialized()
    const role = (req.query.role as string) || 'student'
    let teacherPass = (req.headers['x-teacher-password'] as string) || (req.query.teacherPassword as string)
    if (!teacherPass) {
      const authHeader = req.headers['authorization']
      if (authHeader && authHeader.startsWith('Bearer ')) {
        teacherPass = authHeader.slice(7).trim()
      }
    }
    const isTeacherAuthed = await verifyTeacher(teacherPass)

    // Security requirement: If teacher role is requested without valid auth, reject immediately
    if (role === 'teacher' && !isTeacherAuthed) {
      return res.status(401).json({
        success: false,
        error: 'دسترسی به اطلاعات آموزگار و کلید آزمون‌ها نیازمند احراز هویت آموزگار است.',
      })
    }

    if (!isTeacherAuthed) {
      // SECURITY FIX: Strip correctAnswer and rubricOrHint so student inspect element cannot leak answers!
      const sanitized = cachedExams
        .filter((e) => e.published)
        .map((exam) => ({
          ...exam,
          questions: (exam.questions || []).map((q: any) => {
            const { correctAnswer, rubricOrHint, ...safeQuestion } = q
            return safeQuestion
          }),
        }))
      return res.json({ success: true, exams: sanitized })
    }

    res.json({ success: true, exams: cachedExams })
  })

  app.post('/api/exams/save', requireTeacherAuth, async (req, res) => {
    try {
      await ensureDataInitialized()
      const { exam } = req.body
      const teacherPassword =
        (req.headers['x-teacher-password'] as string) || req.body?.teacherPassword || SYSTEM_TEACHER_KEY

      if (!exam || !exam.id) {
        return res.status(400).json({ success: false, error: 'اطلاعات آزمون ناقص است.' })
      }
      const idx = cachedExams.findIndex((e) => e.id === exam.id)
      if (idx >= 0) {
        cachedExams[idx] = exam
      } else {
        cachedExams.unshift(exam)
      }

      // Sync to Supabase system post AND exam post for full persistence
      await syncSystemPost('__SYSTEM_EXAMS__', JSON.stringify(cachedExams), teacherPassword)

      try {
        await withSupabaseTimeout(
          supabase.rpc('teacher_create_post', {
            p_password: teacherPassword,
            p_type: 'exam',
            p_title: `📝 آزمون: ${exam.title} (${exam.subject})`,
            p_body: JSON.stringify(exam),
            p_due_at: new Date(new Date(exam.scheduledStartTime).getTime() + (exam.durationMinutes || 45) * 60000).toISOString(),
            p_publish_at: new Date(exam.scheduledStartTime || Date.now()).toISOString(),
            p_attachment_path: null,
          }),
          SUPABASE_TIMEOUT_MS
        )
      } catch (e) {
        console.warn('Sync exam post to Supabase failed', e)
      }

      res.json({ success: true, exam })
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'خطا در ذخیره آزمون' })
    }
  })

  app.post('/api/exams/delete', requireTeacherAuth, async (req, res) => {
    try {
      await ensureDataInitialized()
      const { examId } = req.body
      const teacherPassword =
        (req.headers['x-teacher-password'] as string) || req.body?.teacherPassword || SYSTEM_TEACHER_KEY

      if (!examId) return res.status(400).json({ success: false, error: 'examId is required' })
      cachedExams = cachedExams.filter((e) => e.id !== examId)

      // Sync updated exams list to Supabase
      await syncSystemPost('__SYSTEM_EXAMS__', JSON.stringify(cachedExams), teacherPassword)

      res.json({ success: true })
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'خطا در حذف آزمون' })
    }
  })

  // Teacher delete post endpoint (for homework and announcements)
  app.post('/api/teacher/delete-post', async (req, res) => {
    try {
      const { teacherPassword, postId } = req.body
      if (!teacherPassword || !(await verifyTeacher(teacherPassword))) {
        return res.status(401).json({ success: false, error: 'رمز عبور آموزگار صحیح نمی‌باشد.' })
      }
      if (!postId) {
        return res.status(400).json({ success: false, error: 'شناسه پست ارسال نشده است.' })
      }

      // Also clean up if this was linked to exams
      const remainingExams = cachedExams.filter((e) => e.id !== postId)
      if (remainingExams.length !== cachedExams.length) {
        cachedExams = remainingExams
        await syncSystemPost('__SYSTEM_EXAMS__', JSON.stringify(cachedExams), teacherPassword).catch(() => {})
      }

      // 1. Delete dependent submissions
      try {
        await withSupabaseTimeout(
          supabase.from('submissions').delete().eq('post_id', postId),
          SUPABASE_TIMEOUT_MS
        )
      } catch (e) {
        console.warn('Deleting dependent submissions error:', e)
      }

      // 2. Try Supabase RPC
      let rpcOk = false
      try {
        const { error } = await withSupabaseTimeout(
          supabase.rpc('teacher_delete_post', {
            p_password: teacherPassword,
            p_post_id: postId,
          }),
          SUPABASE_TIMEOUT_MS
        )
        if (!error) rpcOk = true
      } catch (e) {
        console.warn('RPC teacher_delete_post failed:', e)
      }

      // 3. Fallback direct delete
      if (!rpcOk) {
        const { error: directErr } = await withSupabaseTimeout(
          supabase.from('posts').delete().eq('id', postId),
          SUPABASE_TIMEOUT_MS
        )
        if (directErr) {
          console.warn('Direct delete from posts failed:', directErr)
        }
      }

      return res.json({ success: true })
    } catch (err: any) {
      console.error('Delete post failed:', err)
      return res.status(500).json({ success: false, error: err?.message || 'خطا در حذف پست' })
    }
  })

  // --------------------------------------------------------------------------
  // EXAM SUBMISSIONS & SERVER-SIDE GRADING
  // --------------------------------------------------------------------------
  app.get('/api/exams/submissions', async (req, res) => {
    await ensureDataInitialized()
    const { examId, studentId } = req.query
    let teacherPass = (req.headers['x-teacher-password'] as string) || (req.query.teacherPassword as string)
    if (!teacherPass) {
      const authHeader = req.headers['authorization']
      if (authHeader && authHeader.startsWith('Bearer ')) {
        teacherPass = authHeader.slice(7).trim()
      }
    }
    const isTeacherAuthed = await verifyTeacher(teacherPass)

    // Only authenticated teachers can query all submissions or submissions without their own studentId
    if (!studentId && !isTeacherAuthed) {
      return res.status(401).json({
        success: false,
        error: 'مشاهده لیست کلی پاسخ‌های آزمون نیازمند احراز هویت آموزگار است.',
      })
    }

    let subs = [...cachedSubmissions]
    if (examId) {
      subs = subs.filter((s) => s.examId === examId)
    }
    if (studentId) {
      subs = subs.filter((s) => s.studentId === studentId)
    }
    res.json({ success: true, submissions: subs })
  })

  app.post('/api/exams/submit', async (req, res) => {
    try {
      await ensureDataInitialized()
      const { examId, studentId, studentName, answers, clientExam } = req.body
      if (!examId || !studentId) {
        return res.status(400).json({ success: false, error: 'examId and studentId are required' })
      }

      let masterExam = cachedExams.find((e) => e.id === examId)
      // Fallback to clientExam if newly created or offline
      if (!masterExam && clientExam) {
        masterExam = clientExam
        cachedExams.unshift(clientExam)
        await syncSystemPost('__SYSTEM_EXAMS__', JSON.stringify(cachedExams)).catch(() => {})
      }

      if (!masterExam) {
        return res.status(404).json({ success: false, error: 'آزمون یافت نشد.' })
      }

      const questionScores: Record<string, number> = {}
      const questionFeedbacks: Record<string, string> = {}
      let totalScore = 0
      const questionsToAiGrade: any[] = []

      for (const q of masterExam.questions) {
        const studentAns = answers?.[q.id] || {}
        if (q.type === 'multiple_choice') {
          const selected = studentAns.selectedOption
          const correct = q.correctAnswer
          if (selected !== undefined && Number(selected) === Number(correct)) {
            const pts = Number(q.points) || 2
            questionScores[q.id] = pts
            questionFeedbacks[q.id] = '✅ پاسخ کاملاً درست است.'
            totalScore += pts
          } else {
            questionScores[q.id] = 0
            questionFeedbacks[q.id] = `❌ پاسخ نادرست است. گزینه صحیح: گزینه ${Number(correct ?? 0) + 1}`
          }
        } else if (q.type === 'fill_in_the_blank') {
          const rawText = String(studentAns.textAnswer || '').trim()
          const rawCorrect = String(q.correctAnswer || '').trim()
          const normText = normalizePersianForComparison(rawText)
          const normCorrect = normalizePersianForComparison(rawCorrect)

          if (normText && (normText === normCorrect || normText.includes(normCorrect) || normCorrect.includes(normText))) {
            const pts = Number(q.points) || 2
            questionScores[q.id] = pts
            questionFeedbacks[q.id] = '✅ پاسخ جای خالی کاملاً درست است.'
            totalScore += pts
          } else if (rawText) {
            // Forward to AI for conceptual / synonym verification
            questionsToAiGrade.push({
              id: q.id,
              type: 'fill_in_the_blank',
              question: q.question,
              rubricOrHint: `کلید مورد نظر: «${q.correctAnswer}». نکته مهم: اگر مفهوم درست است یا واژه مترادف یا هم‌معنی (مانند بزرگتر/بیشتر) به کار رفته یا فاصله و نیم‌فاصله متفاوت است، نمره کامل داده شود.`,
              points: Number(q.points) || 2,
              studentAnswer: rawText,
            })
          } else {
            questionScores[q.id] = 0
            questionFeedbacks[q.id] = `❌ پاسخ خالی است. پاسخ صحیح: «${q.correctAnswer}»`
          }
        } else {
          // Descriptive or image questions: prepare for AI grading
          questionsToAiGrade.push({
            id: q.id,
            type: q.type,
            question: q.question,
            rubricOrHint: q.rubricOrHint || '',
            points: Number(q.points) || 3,
            studentAnswer: studentAns.textAnswer || (studentAns.imageAttachment ? '[تصویر پیوست شده]' : ''),
          })
        }
      }

      let serverTeacherNote = ''
      if (questionsToAiGrade.length > 0 && process.env.GEMINI_API_KEY) {
        try {
          const aiPrompt = `شما آموزگار مهربان، دلسوز، بسیار منعطف، صبور و باتجربه پایه ششم ابتدایی هستید. دانش‌آموز «${studentName || 'دانش‌آموز'}» به سوالات آزمون پاسخ داده است.
اطلاعات سوالات، بارم، راهنمای حل و پاسخ ثبت‌شده دانش‌آموز:
${JSON.stringify(questionsToAiGrade, null, 2)}

قوانین و معیارهای قطعی برای تصحیح مهربانانه، منعطف و مفهوم‌محور:
۱. **نمره کامل در صورت درک مفهوم (Concept-First)**:
   اگر مفهوم، جان‌کلام، ایده اصلی یا پیام پاسخ دانش‌آموز درست است، حتماً نمره کامل را بدهید. از هرگونه سخت‌گیری وسواس‌گونه یا نیاز به تطابق کلمه به کلمه با کتاب درسی پرهیز کنید.
۲. **نیم‌فاصله و فاصله‌ها**:
   نیم‌فاصله و فاصله‌ها (مانند «شهاب سنگ» در برابر «شهاب‌سنگ» یا «شهابسنگ»، «دست خوش» در برابر «دستخوش»، «دانش آموز» در برابر «دانش‌آموز»، «گیاه خوار» در برابر «گیاهخوار») به هیچ وجه نباید نمره صفر بگیرند یا کسر نمره شوند، بلکه کاملاً صحیح تلقی شده و نمره کامل داده شود.
۳. **واژگان هم‌معنی و مترادف**:
   کلمات هم‌معنی و معادل‌های مفهومی (مانند «بزرگتر» به جای «بیشتر»، «افزایش» به جای «زیاد شدن»، «کاهش» به جای «کم شدن»، «سریعتر» به جای «تندتر») به هیچ وجه نباید نمره صفر بگیرند و کاملاً درست بوده و نمره کامل دریافت می‌کنند.
۴. **نادیده گرفتن خطاهای املایی جزئی دانش‌آموز ششم**:
   خطاهای املایی و نگارشی جزئی دانش‌آموز ششم ابتدایی (مانند جابجایی حروف هم‌صدا مثل ص/س/ث، ت/ط، ذ/ز/ض/ظ، غ/ق، ه/ح، تشدید نگذاشتن یا جا افتادن یک حرف در تایپ) کاملاً نادیده گرفته شوند و اگر کلمه قابل تشخیص است نمره کامل داده شود.
۵. **پاسخ‌های تشریحی و جای‌خالی**:
   حتی اگر دانش‌آموز با زبان کودکانه خود پاسخ داده باشد نمره کامل داده شود. نمره صفر فقط در صورت کاملاً بی‌ربط بودن یا سفید گذاشتن داده شود.
۶. **یادداشت معلمانه (teacherSummaryNote)**:
   باید پرمهر، تشویقی، دلگرم‌کننده و بدون هرگونه اشاره به هوش مصنوعی باشد.

خروجی صرفاً JSON با ساختار زیر:
{
  "grades": [{ "id": "...", "score": 2.5, "feedback": "بازخورد تشویقی و مثبت" }],
  "teacherSummaryNote": "متن یادداشت آموزگار"
}`
          const aiResText = await callGeminiWithFallbacks(aiPrompt, true)
          let cleaned = aiResText.trim()
          if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim()
          if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim()
          const parsed = JSON.parse(cleaned)
          const gradesArr = Array.isArray(parsed) ? parsed : parsed.grades || []
          serverTeacherNote = parsed.teacherSummaryNote || ''
          for (const g of gradesArr) {
            const matchingQ = masterExam.questions.find((mq: any) => mq.id === g.id)
            const maxPts = Number(matchingQ?.points) || 3
            const safeScore = Math.min(maxPts, Math.max(0, Number(g.score) || 0))
            questionScores[g.id] = safeScore
            questionFeedbacks[g.id] = g.feedback || 'پاسخ بررسی شد.'
            totalScore += safeScore
          }
        } catch (e) {
          console.warn('AI grading failed, using heuristic grading', e)
          for (const q of questionsToAiGrade) {
            const text = String(q.studentAnswer || '').trim()
            let earned = 0
            let fb = ''
            if (text.length > 30) {
              earned = q.points
              fb = 'پاسخ کامل یا راه‌حل ثبت شده است.'
            } else if (text.length > 0) {
              earned = Math.round(q.points * 0.5 * 10) / 10
              fb = 'پاسخ مختصر درج شده است.'
            } else {
              fb = 'پاسخی ثبت نشده است.'
            }
            questionScores[q.id] = earned
            questionFeedbacks[q.id] = fb
            totalScore += earned
          }
        }
      }

      serverTeacherNote = sanitizeTeacherNote(serverTeacherNote)
      if (!serverTeacherNote) {
        const ratio = totalScore / (masterExam.totalPoints || 20)
        if (ratio >= 0.85) {
          serverTeacherNote = `آفرین ${studentName} عزیزم! عملکردت در این آزمون بسیار عالی و چشم‌گیر بود و تسلط خوبی روی مفاهیم نشان دادی. همین مسیر باانگیزه را ادامه بده.`
        } else if (ratio >= 0.6) {
          serverTeacherNote = `خسته نباشی ${studentName} جان؛ تلاشت در آزمون خوب بود. در سوالات تشریحی و نکته‌دار کمی بیشتر دقت کن تا در آزمون‌های بعدی نمره کامل را به دست آوری.`
        } else {
          serverTeacherNote = `${studentName} عزیز، خسته نباشی. نیاز است مباحث این درس را مجدداً با دقت مرور کنی و روی تمرین‌های کاربرگ کار کنی تا نقاط ضعف به نقطه قوت تبدیل شوند.`
        }
      }

      const masterTotal = Number(masterExam.totalPoints) || 20
      const scaledScore20 = masterTotal > 0 ? Math.round(((totalScore / masterTotal) * 20) * 10) / 10 : totalScore
      const roundedScore = Math.round(totalScore * 10) / 10
      const submission = {
        id: `sub_${examId}_${studentId}_${Date.now()}`,
        examId,
        studentId,
        studentName: studentName || 'دانش‌آموز',
        submittedAt: new Date().toISOString(),
        answers,
        aiGrading: {
          questionScores,
          questionFeedbacks,
          totalScore: roundedScore,
          scaledScore20,
          gradedAt: new Date().toISOString(),
          summary: serverTeacherNote,
        },
        teacherGrading: {
          approved: false,
          questionScores: { ...questionScores },
          questionFeedbacks: { ...questionFeedbacks },
          totalScore: roundedScore,
          scaledScore20,
          teacherNotes: serverTeacherNote,
        },
      }

      // Persist as independent submission record per (exam_id, student_id) in Supabase (Eliminating array race conditions)
      await upsertExamSubmissionRecord(examId, studentId, submission).catch((e) =>
        console.warn('Sync independent exam submission to Supabase error:', e)
      )

      res.json({ success: true, submission })
    } catch (err: any) {
      console.error('Error in exam submit:', err)
      res.status(500).json({ success: false, error: err?.message || 'خطا در ثبت آزمون' })
    }
  })

  app.post('/api/exams/approve', requireTeacherAuth, async (req, res) => {
    try {
      await ensureDataInitialized()
      const { submissionId, approvedScores, teacherNotes } = req.body
      const teacherPassword =
        (req.headers['x-teacher-password'] as string) || req.body?.teacherPassword || SYSTEM_TEACHER_KEY

      if (!submissionId) {
        return res.status(400).json({ success: false, error: 'submissionId is required' })
      }
      const sub = cachedSubmissions.find((s) => s.id === submissionId)
      if (!sub) {
        return res.status(404).json({ success: false, error: 'پاسخ آزمون یافت نشد.' })
      }

      let totalScore = 0
      if (approvedScores) {
        for (const val of Object.values(approvedScores)) {
          totalScore += Number(val) || 0
        }
      } else {
        totalScore = sub.aiGrading?.totalScore || 0
      }
      totalScore = Math.round(totalScore * 10) / 10

      const exam = cachedExams.find((e) => e.id === sub.examId)
      const examTotalPts = Number(exam?.totalPoints) || 20
      const scaledScore20 = examTotalPts > 0 ? Math.round(((totalScore / examTotalPts) * 20) * 10) / 10 : totalScore
      const cleanNote = sanitizeTeacherNote(teacherNotes || sub.aiGrading?.summary || 'تایید شده توسط آموزگار محترم')

      sub.teacherGrading = {
        approved: true,
        questionScores: approvedScores || sub.aiGrading?.questionScores || {},
        questionFeedbacks: sub.teacherGrading?.questionFeedbacks,
        teacherNotes: cleanNote,
        totalScore,
        scaledScore20,
        approvedAt: new Date().toISOString(),
      }

      // Upsert updated submission directly to Supabase as an independent record
      await upsertExamSubmissionRecord(sub.examId, sub.studentId, sub, teacherPassword).catch((e) =>
        console.warn('Sync approved independent submission to Supabase error:', e)
      )

      // Persist grade directly to Supabase grades table with 3s timeout
      try {
        await withSupabaseTimeout(
          supabase.rpc('teacher_add_grade', {
            p_password: teacherPassword,
            p_student_id: sub.studentId,
            p_subject: exam?.subject || 'عمومی',
            p_skill: `آزمون: ${exam?.title || 'آزمون کلاسی'}`,
            p_score: scaledScore20,
            p_max_score: 20,
          }),
          SUPABASE_TIMEOUT_MS
        )
      } catch (e) {
        console.warn('Could not record grade to Supabase grades table', e)
      }

      res.json({ success: true, submission: sub })
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'خطا در تایید آزمون' })
    }
  })

  // --------------------------------------------------------------------------
  // TIZHOOSHAN DUOLINGO PROGRESS API (Cloud Persistent in Supabase)
  // --------------------------------------------------------------------------
  app.get('/api/tizhooshan/progress', async (req, res) => {
    await ensureDataInitialized()
    const { studentId } = req.query
    if (!studentId) return res.status(400).json({ success: false, error: 'studentId is required' })
    const progress = cachedTizhooshanProgress[String(studentId)] || null
    res.json({ success: true, progress })
  })

  app.get('/api/tizhooshan/all-progress', async (req, res) => {
    await ensureDataInitialized()
    res.json({ success: true, progressMap: cachedTizhooshanProgress })
  })

  app.post('/api/tizhooshan/progress', async (req, res) => {
    try {
      await ensureDataInitialized()
      const { studentId, studentName, progress } = req.body
      if (!studentId || !progress) {
        return res.status(400).json({ success: false, error: 'studentId and progress are required' })
      }
      cachedTizhooshanProgress[String(studentId)] = {
        studentId,
        studentName: studentName || cachedTizhooshanProgress[String(studentId)]?.studentName || '',
        ...progress,
        updatedAt: new Date().toISOString(),
      }

      // Direct persistent backup to Supabase
      await syncSystemPost('__SYSTEM_TIZHOOSHAN_PROGRESS__', JSON.stringify(cachedTizhooshanProgress)).catch((e) =>
        console.warn('Sync tizhooshan progress to Supabase error:', e)
      )

      res.json({ success: true })
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'خطا در ثبت پیشرفت' })
    }
  })

  // --------------------------------------------------------------------------
  // COMPLETE SYSTEM BACKUP RESTORE (All Sections: Exams, Progress, Submissions)
  // --------------------------------------------------------------------------
  app.post('/api/backup/restore', requireTeacherAuth, async (req, res) => {
    try {
      await ensureDataInitialized()
      const { backup } = req.body
      const teacherPassword =
        (req.headers['x-teacher-password'] as string) || req.body?.teacherPassword || SYSTEM_TEACHER_KEY

      if (!backup || typeof backup !== 'object') {
        return res.status(400).json({ success: false, error: 'فایل پشتیبان نامعتبر است.' })
      }
      if (Array.isArray(backup.exams)) {
        cachedExams = backup.exams
        await syncSystemPost('__SYSTEM_EXAMS__', JSON.stringify(cachedExams), teacherPassword).catch(() => {})
      }
      if (Array.isArray(backup.examSubmissions)) {
        for (const sub of backup.examSubmissions) {
          if (sub && sub.examId && sub.studentId) {
            await upsertExamSubmissionRecord(sub.examId, sub.studentId, sub, teacherPassword).catch(() => {})
          }
        }
      }
      if (backup.tizhooshanProgress && typeof backup.tizhooshanProgress === 'object') {
        cachedTizhooshanProgress = { ...cachedTizhooshanProgress, ...backup.tizhooshanProgress }
        await syncSystemPost('__SYSTEM_TIZHOOSHAN_PROGRESS__', JSON.stringify(cachedTizhooshanProgress), teacherPassword).catch(() => {})
      }
      res.json({ success: true, message: 'پشتیبان سیستم با موفقیت در پایگاه داده Supabase و سرور ذخیره و اعمال شد.' })
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'خطا در بازیابی سرور' })
    }
  })

  // --------------------------------------------------------------------------
  // AI EXAM QUESTIONS GENERATOR (Genuine curriculum questions, NO templates)
  // --------------------------------------------------------------------------
  app.post('/api/ai/generate-exam', requireAiAuth, async (req, res) => {
    try {
      const {
        subject = '',
        topic = '',
        count = 5,
        types = ['multiple_choice', 'fill_in_the_blank', 'descriptive'],
        difficulty = 'medium',
        extraInstructions = '',
      } = req.body

      const rawTopic = String(topic || '').trim()
      if (!rawTopic) {
        return res.status(400).json({ success: false, error: 'موضوع آزمون مشخص نشده است.' })
      }

      // Intelligent subject inference
      let effectiveSubject = subject && subject.trim() ? subject.trim() : ''
      const lowerTopic = rawTopic.toLowerCase()

      if (
        lowerTopic.includes('علوم') ||
        lowerTopic.includes('گوارش') ||
        lowerTopic.includes('معده') ||
        lowerTopic.includes('بلع') ||
        lowerTopic.includes('روده') ||
        lowerTopic.includes('گردش خون') ||
        lowerTopic.includes('قلب') ||
        lowerTopic.includes('تنفس') ||
        lowerTopic.includes('شش') ||
        lowerTopic.includes('زلزله') ||
        lowerTopic.includes('سنگ') ||
        lowerTopic.includes('زمین') ||
        lowerTopic.includes('خاک') ||
        lowerTopic.includes('میکروسکوپ') ||
        lowerTopic.includes('سلول') ||
        lowerTopic.includes('نیرو') ||
        lowerTopic.includes('اهرم') ||
        lowerTopic.includes('انرژی') ||
        lowerTopic.includes('اسید') ||
        lowerTopic.includes('کاغذ') ||
        lowerTopic.includes('آتشفشان') ||
        lowerTopic.includes('گیاه') ||
        lowerTopic.includes('فتوسنتز') ||
        lowerTopic.includes('مخلوط') ||
        lowerTopic.includes('محلول') ||
        lowerTopic.includes('آهنربا') ||
        lowerTopic.includes('مدار') ||
        lowerTopic.includes('اصطکاک') ||
        lowerTopic.includes('آزمایش')
      ) {
        effectiveSubject = 'علوم تجربی'
      } else if (
        lowerTopic.includes('ریاضی') ||
        lowerTopic.includes('کسر') ||
        lowerTopic.includes('اعشار') ||
        lowerTopic.includes('مساحت') ||
        lowerTopic.includes('محیط') ||
        lowerTopic.includes('حجم') ||
        lowerTopic.includes('تناسب') ||
        lowerTopic.includes('مختصات') ||
        lowerTopic.includes('تقارن') ||
        lowerTopic.includes('زاویه') ||
        lowerTopic.includes('احتمال') ||
        lowerTopic.includes('اعداد صحیح') ||
        lowerTopic.includes('هندسه') ||
        lowerTopic.includes('درصد') ||
        lowerTopic.includes('تقسیم') ||
        lowerTopic.includes('ضرب')
      ) {
        effectiveSubject = 'ریاضی'
      } else if (
        lowerTopic.includes('فارسی') ||
        lowerTopic.includes('شعر') ||
        lowerTopic.includes('آرایه') ||
        lowerTopic.includes('تشبیه') ||
        lowerTopic.includes('کنایه') ||
        lowerTopic.includes('مفعول') ||
        lowerTopic.includes('نهاد') ||
        lowerTopic.includes('مسند') ||
        lowerTopic.includes('انشا') ||
        lowerTopic.includes('نگارش') ||
        lowerTopic.includes('ستایش') ||
        lowerTopic.includes('نیایش') ||
        lowerTopic.includes('املا')
      ) {
        effectiveSubject = 'فارسی'
      } else if (
        lowerTopic.includes('تیزهوشان') ||
        lowerTopic.includes('سمپاد') ||
        lowerTopic.includes('هوش') ||
        lowerTopic.includes('استعداد تحلیلی') ||
        lowerTopic.includes('مکعب') ||
        lowerTopic.includes('تاس') ||
        lowerTopic.includes('چرخ دنده')
      ) {
        effectiveSubject = 'هوش و استعداد تحلیلی (تیزهوشان)'
      } else if (
        lowerTopic.includes('هدیه') ||
        lowerTopic.includes('دینی') ||
        lowerTopic.includes('پیامبر') ||
        lowerTopic.includes('امام') ||
        lowerTopic.includes('نماز') ||
        lowerTopic.includes('وضو') ||
        lowerTopic.includes('قرآن') ||
        lowerTopic.includes('معاد')
      ) {
        effectiveSubject = 'هدیه‌های آسمان'
      } else if (
        lowerTopic.includes('اجتماعی') ||
        lowerTopic.includes('تاریخ') ||
        lowerTopic.includes('جغرافیا') ||
        lowerTopic.includes('مدنی') ||
        lowerTopic.includes('ایران') ||
        lowerTopic.includes('اصفهان') ||
        lowerTopic.includes('صفویه') ||
        lowerTopic.includes('کشاورزی') ||
        lowerTopic.includes('انرژی فسیلی')
      ) {
        effectiveSubject = 'مطالعات اجتماعی'
      }

      if (!effectiveSubject) {
        effectiveSubject = 'پایه ششم ابتدایی'
      }

      const numCount = Math.min(25, Math.max(1, Number(count) || 5))

      const difficultyDesc =
        difficulty === 'hard'
          ? 'سطح دشوار و تحلیلی تیزهوشانی (مدارس سمپاد)'
          : difficulty === 'easy'
          ? 'سطح ساده و روان برای تثبیت مفاهیم کتاب درسی'
          : 'سطح استاندارد امتحانات کلاسی و نهایی پایه ششم'

      const prompt = `شما همان آموزگار شایسته، دلسوز، خوش‌قریحه و حرفه‌ای پایه ششم ابتدایی هستید که بهترین تکالیف، تمرین‌ها و کاربرگ‌های کلاسی را طراحی می‌کنید.
معلم از شما خواسته است برای این موضوع، یک آزمون بسیار باکیفیت، استاندارد، عینی و درست‌وحسابی طراحی کنید (دقیقاً با همان قلم گیرا، آموزشی، خلاقانه و ملموس بخش تکالیف و تمرین‌ها):
🎯 موضوع و مبحث دقیق: «${rawTopic}»
🎯 حوزه و درس مربوطه: «${effectiveSubject}»
${extraInstructions ? `🎯 توضیحات و دستورات معلم: «${extraInstructions}»` : ''}
📊 سطح دشواری: ${difficultyDesc}
🔢 تعداد کل سوالات: ${numCount} سوال
📝 انواع سوالات مورد نظر: ${Array.isArray(types) ? types.join('، ') : 'چهارگزینه‌ای، جای خالی، تشریحی'}

*** اصول کلیدی برای طراحی سوالات درست‌وحسابی و جذاب (دقیقاً مانند بخش تمرین‌ها): ***
۱. سوالات باید زنده، ملموس و دارای سناریو یا داده‌های واقعی باشند (مثل مسائل زندگی روزمره، خرید، تقسیم خوراکی، پارچه، شکل‌های دقیق هندسی، ابیات و اشعار اصیل فارسی، آزمایش‌های علمی ملموس).
۲. از هرگونه عبارت کلیشه‌ای، فرمول خشک، یا سوالات ماشینی بدون روح پرهیز کنید.
۳. سوالات را دقیقاً متناسب با درک و سن دانش‌آموزان ۱۲ ساله پایه ششم بنویسید.
۴. در سوالات چهارگزینه‌ای: ۴ گزینه ملموس، متمایز و حساب‌شده طراحی کنید (گزینه‌های گمراه‌کننده هوشمندانه باشند).
۵. در سوالات جای خالی: صورت سوال روان باشد و جای خالی با ............ مشخص شده باشد.
۶. در سوالات تشریحی یا حل مسئله: مسئله‌ای هدفمند که دانش‌آموز با نوشتن مراحل به پاسخ برسد.
۷. در پاسخنامه و راهنمای تصحیح (rubricOrHint): دقیقاً مانند پاسخنامه کاربرگ تمرینی، توضیح کامل، آموزنده و گام‌به‌گام راه‌حل را بنویسید تا معلم و دانش‌آموز از آن بیاموزند.

خروجی باید صرفاً یک آرایه JSON معتبر طبق این الگو باشد:
[
  {
    "id": "q1",
    "type": "multiple_choice",
    "question": "متن روان، ملموس و دقیق صورت سوال درباره موضوع",
    "options": ["گزینه ۱", "گزینه ۲", "گزینه ۳", "گزینه ۴"],
    "correctAnswer": 0,
    "rubricOrHint": "توضیح کامل، گام‌به‌گام و آموزنده پاسخنامه",
    "points": 2
  },
  {
    "id": "q2",
    "type": "fill_in_the_blank",
    "question": "متن روان سوال با علامت ............ برای جای خالی",
    "correctAnswer": "پاسخ دقیق جای خالی",
    "rubricOrHint": "توضیح گام‌به‌گام پاسخ",
    "points": 2
  },
  {
    "id": "q3",
    "type": "descriptive",
    "question": "مسئله یا سوال تشریحی مفهومی که نیازمند توضیح یا محاسبه گام‌به‌گام است",
    "rubricOrHint": "معیار نمره‌دهی و راه‌حل گام‌به‌گام",
    "points": 3
  }
]`

      const jsonText = await callGeminiWithFallbacks(prompt, true)
      let cleaned = jsonText.trim()
      if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim()
      if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim()

      const firstBracket = cleaned.indexOf('[')
      const lastBracket = cleaned.lastIndexOf(']')
      if (firstBracket !== -1 && lastBracket !== -1) {
        cleaned = cleaned.substring(firstBracket, lastBracket + 1)
      }

      const parsed = JSON.parse(cleaned)
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('قالب بازگشتی هوش مصنوعی معتبر نبود.')
      }

      res.json({
        success: true,
        detectedSubject: effectiveSubject,
        questions: parsed,
      })
    } catch (err: any) {
      console.error('Error in generate-exam:', err)
      res.status(500).json({ success: false, error: err?.message || 'خطا در طراحی سوالات با هوش مصنوعی' })
    }
  })

  // --------------------------------------------------------------------------
  // AI SINGLE QUESTION REGENERATION (FOR TEACHER EXAM BUILDER)
  // --------------------------------------------------------------------------
  app.post('/api/ai/regenerate-question', requireAiAuth, async (req, res) => {
    try {
      const {
        subject = '',
        topic = '',
        type = 'multiple_choice',
        difficulty = 'medium',
        points = 2,
        previousQuestion = '',
        extraInstructions = '',
      } = req.body

      const rawTopic = String(topic || '').trim()
      const effectiveSubject = subject && subject.trim() ? subject.trim() : 'کتاب‌های درسی پایه ششم ابتدایی'

      const typeLabel =
        type === 'multiple_choice'
          ? 'چهارگزینه‌ای (تستی)'
          : type === 'fill_in_the_blank'
          ? 'جای خالی'
          : type === 'descriptive'
          ? 'تشریحی مفهومی'
          : 'تشریحی و تصویری'

      const difficultyLabel =
        difficulty === 'hard'
          ? 'سطح پیشرفته و تیزهوشان'
          : difficulty === 'easy'
          ? 'سطح ساده و پایه‌ای'
          : 'سطح استاندارد کتاب درسی'

      const prompt = `شما آموزگار متخصص، خلاق و طراح سوالات امتحانی پایه ششم ابتدایی در ایران هستید.
آموزگار در حال بررسی آزمون است و سوال قبلی زیر را تایید نکرده (رد کرده است):
«${previousQuestion || '(متن سوال قبلی در دسترس نیست)'}»

وظیفه شما:
یک «سوال کاملاً جدید، استاندارد، نوآورانه و باکیفیت» برای درس «${effectiveSubject}» و مبحث «${rawTopic || 'کتاب درسی ششم'}» طراحی کنید که:
۱. نوع سوال دقیقاً «${typeLabel}» (${type}) باشد.
۲. با سوال رد شده قبلی کاملاً متمایز، متفاوت و از زاویه‌ای تازه باشد تا نقص سوال قبلی جبران شود.
۳. در سطح دشواری «${difficultyLabel}» و متناسب با بارم «${Number(points) || 2} نمره» باشد.
۴. عبارات ریاضی و فرمول‌ها درون نماد $ (لاتک) قرار گیرند (مثال: $\\frac{3}{4}$).
${extraInstructions ? `۵. دستور ویژه آموزگار: ${extraInstructions}` : '۵. کاملاً منطبق بر سرفصل‌های رسمی پایه ششم ابتدایی آموزش و پرورش باشد.'}

پاسخ را دقیقاً و صرفاً به صورت یک شیء JSON معتبر (نه آرایه) با ساختار زیر تحویل دهید:
{
  "id": "q_${Date.now()}",
  "type": "${type}",
  "question": "متن روان، رسا و بدون ابهام سوال جدید",
  ${type === 'multiple_choice' ? `"options": ["گزینه ۱", "گزینه ۲", "گزینه ۳", "گزینه ۴"],\n  "correctAnswer": 0,` : ''}
  ${type === 'fill_in_the_blank' ? `"correctAnswer": "پاسخ دقیق جای خالی",` : ''}
  "rubricOrHint": "راهنما و کلید دقیق حل سوال برای معلم",
  "points": ${Number(points) || 2}
}`

      const jsonText = await callGeminiWithFallbacks(prompt, true)
      let cleaned = jsonText.trim()
      if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim()
      if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim()

      const firstBrace = cleaned.indexOf('{')
      const lastBrace = cleaned.lastIndexOf('}')
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1)
      }

      const parsed = JSON.parse(cleaned)
      if (!parsed.question) {
        throw new Error('قالب بازگشتی سوال معتبر نبود.')
      }

      parsed.points = Number(parsed.points) || Number(points) || 2
      if (parsed.type === 'multiple_choice' && (!Array.isArray(parsed.options) || parsed.options.length < 2)) {
        parsed.options = ['الف', 'ب', 'ج', 'د']
      }
      if (parsed.type === 'multiple_choice' && parsed.correctAnswer === undefined) {
        parsed.correctAnswer = 0
      }

      res.json({
        success: true,
        question: parsed,
      })
    } catch (err: any) {
      console.error('Error in regenerate-question:', err)
      res.status(500).json({ success: false, error: err?.message || 'خطا در بازتولید سوال با هوش مصنوعی' })
    }
  })

  // --------------------------------------------------------------------------
  // CONVERT PRACTICE / HOMEWORK TEXT TO INTERACTIVE EXAM QUESTIONS
  // --------------------------------------------------------------------------
  app.post('/api/ai/convert-practice-to-exam', requireAiAuth, async (req, res) => {
    try {
      const { text, subject = 'پایه ششم' } = req.body
      if (!text || !text.trim()) {
        return res.status(400).json({ success: false, error: 'متن تمرین یا کاربرگ ارسال نشده است.' })
      }

      const prompt = `شما دستیار هوشمند آموزگار پایه ششم هستید. متن کاربرگ تمرینی یا تکلیف زیر را تجزیه کرده و آن را به سوالات آزمون آنلاین استاندارد (آرایه JSON) تبدیل کنید.
اگر سوال چهارگزینه‌ای است به multiple_choice با ۴ گزینه و correctAnswer (شاخص عددی 0 تا 3) تبدیل کنید.
اگر جای خالی است به fill_in_the_blank با علامت ............ و correctAnswer مشخص تبدیل کنید.
اگر تشریحی، حل مسئله یا نیاز به توضیح است به descriptive تبدیل کنید.
اگر پاسخنامه در انتهای متن وجود دارد، پاسخ و استدلال هر سوال را در rubricOrHint قرار دهید.

متن تمرین/کاربرگ:
${text}

خروجی باید صرفاً یک آرایه JSON معتبر باشد:
[
  {
    "id": "q1",
    "type": "multiple_choice",
    "question": "صورت سوال",
    "options": ["گزینه ۱", "گزینه ۲", "گزینه ۳", "گزینه ۴"],
    "correctAnswer": 0,
    "rubricOrHint": "استدلال یا پاسخنامه",
    "points": 2
  }
]`

      const jsonText = await callGeminiWithFallbacks(prompt, true)
      let cleaned = jsonText.trim()
      if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim()
      if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim()

      const firstBracket = cleaned.indexOf('[')
      const lastBracket = cleaned.lastIndexOf(']')
      if (firstBracket !== -1 && lastBracket !== -1) {
        cleaned = cleaned.substring(firstBracket, lastBracket + 1)
      }

      const parsed = JSON.parse(cleaned)
      res.json({
        success: true,
        questions: parsed,
      })
    } catch (err: any) {
      console.error('Error in convert-practice-to-exam:', err)
      res.status(500).json({ success: false, error: err?.message || 'خطا در تبدیل تمرین به آزمون' })
    }
  })

  // --------------------------------------------------------------------------
  // AI PRACTICE WORKSHEET GENERATOR
  // --------------------------------------------------------------------------
  app.post('/api/ai/generate-practice', requireAiAuth, async (req, res) => {
    try {
      const { topic, count = 5, difficulty = 'medium' } = req.body
      const difficultyLabel = ({ easy: 'ساده', medium: 'متوسط', hard: 'سخت و تیزهوشانی' } as any)[difficulty] || 'متوسط'

      const prompt = `شما آموزگار شایسته، دلسوز و حرفه‌ای پایه ششم ابتدایی هستید.
موضوع و خواسته معلم برای تکلیف/تمرین: «${topic}»
سطح دشواری: ${difficultyLabel}
تعداد: ${count} سوال

دستورات حیاتی برای قالب‌بندی:
۱. هرگز و تحت هیچ شرایطی جواب، کلید سوال یا پاسخ درست را در صورت سوال یا بلافاصله پس از سوال ننویسید.
۲. صورت هر سوال باید کاملاً شفاف و تمیز باشد تا دانش‌آموز خود به تنهایی روی آن فکر کند و حل کند.
۳. در نگارش عبارات ریاضی:
   - علامت‌های کسر را به شکل کسری مشخص مانند ۳/۴ یا \\frac{۳}{۴} بنویسید.
   - ضرب را با علامت × و تقسیم را با ÷ یا کسر نمایش دهید.
۴. سوالات باید سناریودار، ملموس و مناسب سن ۱۲ سالگی باشند.
۵. پاسخنامه و راه‌حل گام‌به‌گام فقط و فقط در انتهای متن و پس از جداکننده «---» و با عنوان «📝 پاسخنامه و راهنمای حل تشریحی (ویژه معلم)» قرار گیرد.

ساختار کاربرگ:
- خط اول: عنوان شیک کاربرگ
- صورت سوالات شماره‌گذاری شده ۱ تا ${count}
- علامت جداکننده «---»
- پاسخنامه تشریحی گام‌به‌گام`

      const text = await callGeminiWithFallbacks(prompt, false)
      res.json({ success: true, text })
    } catch (err: any) {
      console.error('Error generating practice:', err)
      res.status(500).json({ success: false, error: err?.message || 'خطا در تولید تمرین' })
    }
  })

  // --------------------------------------------------------------------------
  // AI CLASSROOM DATA ASSISTANT (Chat with class performance data)
  // --------------------------------------------------------------------------
  app.post('/api/ai/classroom-chat', requireAiAuth, async (req, res) => {
    try {
      const { message, classroomContext } = req.body
      if (!message || !String(message).trim()) {
        return res.status(400).json({ success: false, error: 'متن پرسش یا پیام معلم مشخص نشده است.' })
      }

      const prompt = `شما یک دستیار هوشمند و مشاور ارشد پداگوژی و تحلیل داده‌های کلاس درس برای آموزگار پایه ششم ابتدایی هستید.
آموزگار درباره وضعیت تحصیلی، تکالیف و نمرات دانش‌آموزان با شما مشورت می‌کند.

داده‌های واقعی، مستند و به‌روز دریافتی از سامانه کلاس:
${JSON.stringify(classroomContext || {}, null, 2)}

پیام یا سوال آموزگار:
«${message}»

راهنمای پاسخ‌دهی شما:
۱. داده‌محور و دقیق باشید: اگر معلم درباره دانش‌آموزی (مثلاً علی، رضا و ...) سوال کرد، به تعداد تکالیف ارسالی و ارسال‌نشده او، میانگین نمراتش، دروس نقطه قوت و دروسی که در آن‌ها افت داشته یا نمره پایین گرفته، و وضعیت غیبت/تاخیر او استناد کنید.
۲. تمام نمرات را در مقیاس ۲۰ نمره تحلیل و بیان کنید (مثلاً نمره ۱۶ از ۲۰).
۳. تمامی اعداد و ارقام را حتماً به فارسی بنویسید (۰، ۱، ۲، ۳، ۴، ۵، ۶، ۷، ۸، ۹).
۴. علاوه بر بیان وضعیت، تحلیل روانشناختی-آموزشی و راهکارهای عملی (نظیر تکالیف جبرانی هدفمند، تشویق کلامی، جلسات رفع اشکال) به معلم پیشنهاد دهید.
۵. لحن شما صمیمی، دلسوزانه، محترمانه، منسجم و با ساختار بولت‌پوینت‌های خوانا و زیبا باشد.`

      const text = await callGeminiWithFallbacks(prompt, false)
      res.json({ success: true, reply: text })
    } catch (err: any) {
      console.error('Error in classroom-chat:', err)
      res.status(500).json({ success: false, error: err?.message || 'خطا در تحلیل هوش مصنوعی کلاس' })
    }
  })

  // --------------------------------------------------------------------------
  // AI PREVIEW SAMPLE
  // --------------------------------------------------------------------------
  app.post('/api/ai/preview', requireAiAuth, async (req, res) => {
    try {
      const { topic, difficulty = 'medium' } = req.body
      const prompt = `به عنوان طراح سوال پایه ششم، بر اساس این موضوع: «${topic}» و سطح «${difficulty}»، ۳ سوال نمونه واقعی و آموزنده طراحی کن. بین هر سوال فاصله بگذار. بدون حاشیه و پاسخنامه.`
      const text = await callGeminiWithFallbacks(prompt, false)
      res.json({ success: true, text })
    } catch (err: any) {
      console.error('Error in preview:', err)
      res.status(500).json({ success: false, error: err?.message || 'خطا در تولید پیش‌نمایش' })
    }
  })

  // --------------------------------------------------------------------------
  // AI ANNOUNCEMENT
  // --------------------------------------------------------------------------
  app.post('/api/ai/generate-announcement', requireAiAuth, async (req, res) => {
    try {
      const { topic } = req.body
      const prompt = `شما آموزگار مهربان و باانگیزه پایه ششم هستید. بر اساس یادداشت زیر، یک اطلاعیه کلاسی شاداب، رسمی، خوانا و منظم برای دانش‌آموزان و اولیا بنویسید:
«${topic}»
خط اول عنوان باشد و متن اعلان در ۲ الی ۴ بند مرتب.`

      const text = await callGeminiWithFallbacks(prompt, false)
      res.json({ success: true, text })
    } catch (err: any) {
      console.error('Error in announcement:', err)
      res.status(500).json({ success: false, error: err?.message || 'خطا در نگارش اعلان' })
    }
  })

  // --------------------------------------------------------------------------
  // AI SUBMISSION GRADING & TEACHER NOTE GENERATOR
  // --------------------------------------------------------------------------
  app.post('/api/ai/grade-submission', requireAiAuth, async (req, res) => {
    try {
      const { questions, studentName = 'دانش‌آموز', totalPoints = 20 } = req.body
      if (!Array.isArray(questions)) {
        return res.status(400).json({ error: 'questions array is required' })
      }

      const prompt = `شما آموزگار مهربان، دلسوز، بسیار منعطف، صبور و باتجربه پایه ششم ابتدایی هستید. نام شما آموزگار کلاس است.
دانش‌آموز پایه ششم به نام «${studentName}» در این آزمون شرکت کرده است.
اطلاعات سوالات، بارم، راهنمای حل/کلید، و پاسخ ثبت‌شده دانش‌آموز:
${JSON.stringify(questions, null, 2)}

اصول و دستورالعمل‌های حیاتی تصحیح (رعایت دقیق و قطعی این موارد الزامی است):
۱. **تصحیح کاملاً منعطف، مهربانانه و مفهوم‌محور (Lenient & Concept-First)**:
   - اگر مفهوم، جان‌کلام، ایده اصلی یا پیام پاسخ دانش‌آموز درست بود، حتماً و بدون تعلل **نمره کامل** آن سوال را بدهید. سخت‌گیری وسواس‌گونه یا انطباق کلمه به کلمه با کتاب اکیداً ممنوع است.
   - دانش‌آموز پایه ششم ابتدایی ممکن است آموخته‌های خود را با لحن و ادبیات کودکانه و صادقانه خود بنویسد؛ مادامی که نشان‌دهنده درک مطلب درس است باید نمره کامل کسب کند.

۲. **اغماض و انعطاف کامل در نیم‌فاصله‌ها و فاصله‌گذاری**:
   - نیم‌فاصله و فاصله‌ها (مانند «شهاب سنگ» در برابر «شهاب‌سنگ» یا «شهابسنگ») به هیچ وجه نباید نمره صفر بگیرند یا باعث کسر نمره شوند، بلکه کاملاً صحیح تلقی شده و نمره کامل داده شود.
   - مثال‌های دیگر: «دست خوش» در برابر «دستخوش»، «می شود» در برابر «میشود»، «کتاب ها» در برابر «کتابها»، «دانش آموز» در برابر «دانش‌آموز»، «گیاه خوار» در برابر «گیاهخوار». این موارد کاملاً درست و نمره کامل هستند.

۳. **پذیرش بی‌قیدوشرط کلمات مترادف و هم‌معنی**:
   - واژگان هم‌معنی (مانند «بزرگتر» به جای «بیشتر»، «افزایش یافت» به جای «زیاد شد»، «کاهش» به جای «کم شدن»، «سریعتر» به جای «تندتر»، «آهسته» به جای «کند»، «فراوان» به جای «زیاد») به هیچ وجه نباید نمره صفر بگیرند؛ بلکه باید **نمره کامل** دریافت کنند.

۴. **نادیده گرفتن خطاهای املایی و تایپی جزئی دانش‌آموز ششم ابتدایی**:
   - خطاهای املایی جزئی دانش‌آموز ششم ابتدایی (مانند جابجایی حروف هم‌صدا «س/ص/ث»، «ز/ض/ذ/ظ»، «ت/ط»، «ه/ح»، «غ/ق»، تشدید نگذاشتن، یا جا افتادن یا جابجا شدن یک حرف حین تایپ کیبورد) باید کاملاً نادیده گرفته شوند؛ اگر کلمه قابل تشخیص و مفهوم روشن است، نمره کامل منظور شود.

۵. **سوالات جای‌خالی و تشریحی**:
   - در سوالات جای‌خالی و تشریحی: اگر دانش‌آموز واژه کلیدی یا مترادف آن را حتی با املای ناقص، ادبیات کودکانه یا فاصله‌گذاری متفاوت نوشته باشد، نمره کامل سوال به او تعلق گیرد. نمره صفر فقط در صورتی مجاز است که سوال کاملاً سفید یا پاسخ ۱۰۰٪ بی‌ربط به درس باشد.

۶. **یادداشت معلمانه شخصی‌سازی‌شده و پرمهر (teacherSummaryNote)**:
   - مستقیماً از زبان آموزگار خطاب به دانش‌آموز «${studentName}» پیامی صمیمی، دلگرم‌کننده و انگیزاننده بنویسید.
   - نقاط قوت او را در پاسخ‌هایش تمجید کنید و در صورت نیاز به تقویت موضوعی، با لحن برادرانه و مشفقانه راهنمایی فرمایید.
   - لحن ۱۰۰٪ طبیعی از زبان آموزگار کلاس باشد و مطلقاً هیچ نامی از هوش مصنوعی، ربات، یا ابزار خودکار برده نشود.

پاسخ را صرفاً به صورت یک شیء JSON معتبر با این ساختار تحویل دهید:
{
  "grades": [
    {
      "id": "شناسه سوال",
      "score": نمره_عددی_کسب_شده,
      "feedback": "بازخورد مهربانانه، تشویقی و آموزنده به پاسخ سوال"
    }
  ],
  "teacherSummaryNote": "متن یادداشت و بازخورد پرمهر آموزگار به دانش‌آموز"
}`

      const jsonText = await callGeminiWithFallbacks(prompt, true)
      let cleaned = jsonText.trim()
      if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim()
      if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim()

      const parsed = JSON.parse(cleaned)
      const gradesArr = Array.isArray(parsed) ? parsed : (parsed.grades || [])
      const rawTeacherNote = Array.isArray(parsed) ? '' : (parsed.teacherSummaryNote || '')
      const cleanNote = sanitizeTeacherNote(rawTeacherNote)

      // Calculate total earned score and scale to 20 ($Score = (Earned / Total) * 20$)
      const totalEarned = gradesArr.reduce((sum: number, g: any) => sum + (Number(g.score) || 0), 0)
      const maxPts = Number(totalPoints) || 20
      const scaledScore20 = maxPts > 0 ? Math.round(((totalEarned / maxPts) * 20) * 10) / 10 : totalEarned

      res.json({
        success: true,
        grades: gradesArr,
        totalScore: totalEarned,
        maxScore: maxPts,
        scaledScore20,
        scale: 20,
        teacherSummaryNote: cleanNote,
      })

    } catch (err: any) {
      console.error('Error in grading submission:', err)
      res.status(500).json({ success: false, error: err?.message || 'خطا در بررسی پاسخ‌ها' })
    }
  })

  // --------------------------------------------------------------------------
  // VITE / STATIC SERVING
  // --------------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  } else {
    const distPath = path.join(process.cwd(), 'dist')
    app.use(express.static(distPath))
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'))
    })
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`)
  })
}

startServer().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
