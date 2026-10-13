import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowLeft, ArrowRight, Atom, BookOpen, Brain, CheckCircle2, ChevronRight,
  CircleHelp, FileText, FlaskConical, GraduationCap, LoaderCircle, RotateCcw,
  Send, Target, Timer, Trophy, XCircle,
} from 'lucide-react'
import Dashboard from './components/Dashboard'
import AITutor from './components/AITutor'
import { useAuth, ThemeToggle, navigate, usePathname, AuthPage, ForgotPasswordPage, ResetPasswordPage } from './auth'
import ProfilePage from './ProfilePage'
import {
  generateTest, getCatalog, getExistingFullMock,
  getExistingTopicTest, submitTest,
  type Assessment, type SubmissionResult, type TestQuestion, type Topic,
} from './services/api'

type Screen =
  | 'dashboard'
  | 'home'
  | 'full-mock'
  | 'subjects'
  | 'ai-tutor'
    | "history"
  | 'topic'
  | 'configure'
  | 'taking'
  | 'results'
type Difficulty = 'easy' | 'medium' | 'hard' | 'recommended'
type TestMode = 'existing' | 'ai'

const routeForScreen: Record<Screen, string> = { dashboard: 'dashboard', home: 'tests', 'full-mock': 'tests/full-mock', subjects: 'subjects', 'ai-tutor': 'tutor', history: 'history', topic: 'subjects/topic', configure: 'tests/configure', taking: 'tests/active', results: 'tests/results' }
function screenFromPath(pathname: string): Screen {
  const route = pathname.replace(/^\/app\/?/, '')
  const routeMap: Record<string, Screen> = { dashboard: 'dashboard', tests: 'home', 'tests/full-mock': 'full-mock', 'tests/configure': 'configure', 'tests/active': 'taking', 'tests/results': 'results', subjects: 'subjects', 'subjects/topic': 'topic', tutor: 'ai-tutor', history: 'history' }
  return routeMap[route] ?? 'dashboard'
}

type TestHistoryItem = {
  attempt_id: number;
  assessment_id: number;
  test_name: string;
  total_questions: number;
  score: number | null;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  status: "completed" | "in_progress";
};

const difficultyOptions: { value: Difficulty; label: string; description: string }[] = [
  { value: 'easy', label: 'Easy', description: 'Build confidence with fundamentals' },
  { value: 'medium', label: 'Medium', description: 'Balanced conceptual practice' },
  { value: 'hard', label: 'Hard', description: 'Challenge yourself with advanced questions' },
  { value: 'recommended', label: 'Recommended', description: 'Adapts to previous performance' },
]

const subjectStyles: Record<string, { icon: typeof Atom; tint: string }> = {
  Physics: { icon: Atom, tint: 'from-sky-500 to-blue-600' },
  Mathematics: { icon: Target, tint: 'from-violet-500 to-indigo-600' },
  Maths: { icon: Target, tint: 'from-violet-500 to-indigo-600' },
  Chemistry: { icon: FlaskConical, tint: 'from-emerald-500 to-teal-600' },
}

function LearningApp() {
 const { user, signOut } = useAuth()
 const [screen, setScreenState] = useState<Screen>(() => screenFromPath(window.location.pathname))
 const setScreen = useCallback((next: Screen) => { setScreenState(next); const nextPath = `/app/${routeForScreen[next]}`; if (window.location.pathname !== nextPath) { window.history.pushState({}, '', nextPath); window.dispatchEvent(new PopStateEvent('popstate')) } }, [])
 useEffect(() => { const syncRoute = () => setScreenState(screenFromPath(window.location.pathname)); window.addEventListener('popstate', syncRoute); return () => window.removeEventListener('popstate', syncRoute) }, [])
  const [topics, setTopics] = useState<Topic[]>([])
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [studentId, setStudentId] = useState<number | null>(user?.id ?? null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null)
  const [testMode, setTestMode] = useState<TestMode>('existing')
  const [duration, setDuration] = useState(30)
  const [difficulty, setDifficulty] = useState<Difficulty>('recommended')
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(['Physics', 'Mathematics', 'Chemistry'])
  const [activeAssessment, setActiveAssessment] = useState<Assessment | null>(null)
  const [questions, setQuestions] = useState<TestQuestion[]>([])
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [startedSeconds, setStartedSeconds] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [historyRefresh, setHistoryRefresh] = useState(0);
const [testHistory, setTestHistory] = useState<TestHistoryItem[]>([]);
const [historyLoading, setHistoryLoading] = useState(false);
const [historyError, setHistoryError] = useState("");

  const [results, setResults] = useState<SubmissionResult | null>(null)
  

useEffect(() => {
  if (screen !== "history" || studentId === null) return;

  let cancelled = false;

  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError("");

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL || "http://localhost:8000"}/students/${studentId}/test-history?limit=100`,
        { credentials: 'include' }
      );

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          payload?.detail || "Failed to load test history."
        );
      }

      if (!cancelled) {
        setTestHistory(payload.history ?? []);
      }
    } catch (err) {
      if (!cancelled) {
        setHistoryError(
          err instanceof Error
            ? err.message
            : "Failed to load test history."
        );
      }
    } finally {
      if (!cancelled) setHistoryLoading(false);
    }
  }

  void loadHistory();

  return () => {
    cancelled = true;
  };
},[screen, studentId, historyRefresh]);

useEffect(() => {
  const openTests = () => {
    setError('')
    setScreen('home')
  }

  const viewAllTests = () => {
  setError("");
  setScreen("history");
};
  const openAITutor = () => {
  setError('')
  setScreen('ai-tutor')
}

  window.addEventListener('open-tests', openTests)
  window.addEventListener('view-all-tests', viewAllTests)
  window.addEventListener('open-ai-tutor', openAITutor)

  return () => {
    window.removeEventListener('open-tests', openTests)
    window.removeEventListener('view-all-tests', viewAllTests)
    window.removeEventListener('open-ai-tutor', openAITutor)
  }
}, [setScreen])
  const activeStudentId = user?.id ?? null
  const loadCatalog = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const catalog = await getCatalog()
      setTopics(catalog.topics)
      setAssessments(catalog.assessments)
      setStudentId(activeStudentId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to the backend')
    } finally {
      setLoading(false)
    }
  }, [activeStudentId])

  useEffect(() => {
    // Fetching remote catalog data is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCatalog()
  }, [loadCatalog])

  const subjects = useMemo(
    () => Array.from(new Set(topics.map((topic) => topic.subject))).sort(),
    [topics],
  )
  const topicList = topics.filter((topic) => topic.subject === selectedSubject)
  const activeQuestion = questions[currentQuestion]
  const answeredCount = questions.filter((question) => answers[question.id]).length

  const beginTest = (assessment: Assessment, nextQuestions: TestQuestion[], minutes: number) => {
    if (!nextQuestions.length) {
      setError('This test does not have questions yet. Add questions to the database or generate an AI test.')
      return
    }
    setError('')
    setActiveAssessment(assessment)
    setQuestions(nextQuestions)
    setAnswers({})
    setCurrentQuestion(0)
    setDuration(minutes)
    setRemainingSeconds(minutes * 60)
    setStartedSeconds(Date.now())
    setResults(null)
    setScreen('taking')
  }

  const startExistingFullMock = async () => {
    setError('')
    setLoading(true)
    try {
      const data = await getExistingFullMock()
      if (!data.questions.length) {
        setError('There are no saved questions yet. You can add sample questions or create an AI-generated mock test.')
        return
      }
      beginTest(data.assessment, data.questions, 60)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the mock test')
    } finally {
      setLoading(false)
    }
  }

  const startExistingTopic = async (topic: Topic) => {
    setError('')
    setLoading(true)
    try {
      const assessment = assessments.find((item) => item.topic_id === topic.id)
      if (!assessment) {
        setError(`No existing assessment is set up for ${topic.name} yet.`)
        return
      }
      const data = await getExistingTopicTest(assessment.id)
      if (!data.questions.length) {
        setError(`"${topic.name}" has an assessment record, but no questions yet. Choose AI-generated test or add questions first.`)
        return
      }
      beginTest(data.assessment, data.questions, 30)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the topic test')
    } finally {
      setLoading(false)
    }
  }

  const startAiTest = async () => {
    setError('')
    setLoading(true)
    try {
      const data = await generateTest({
        mode: selectedTopic ? 'topic' : 'full',
        subject_names: screen === 'full-mock' ? selectedSubjects : [selectedSubject],
        topic_id: selectedTopic?.id ?? null,
        duration_minutes: duration,
        difficulty,
        question_count: Math.max(5, Math.min(60, Math.floor(duration / 2))),
        student_id: studentId,
      })
      setAssessments((current) => [...current, {
        ...data.assessment,
        topic_id: data.assessment.topic_id,
        question_count: data.questions.length,
      }])
      beginTest(data.assessment, data.questions, duration)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate your test')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = useCallback(async () => {
    if (!activeAssessment || !studentId || submitting || !questions.length) return
    setSubmitting(true)
    setError('')
    try {
      const response = await submitTest({
        student_id: studentId,
        assessment_id: activeAssessment.id,
        question_ids: questions.map((question) => question.id),
        answers,
        duration_seconds: Math.max(0, Math.floor((Date.now() - startedSeconds) / 1000)),
      })
      setResults(response)
      setScreen('results')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the test')
    } finally {
      setSubmitting(false)
    }
  }, [activeAssessment, studentId, submitting, questions, answers, startedSeconds, setScreen])

  useEffect(() => {
    if (screen !== 'taking' || submitting) return
    const timer = window.setInterval(() => {
      setRemainingSeconds((value) => Math.max(0, value - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [screen, submitting])

  useEffect(() => {
    if (screen === 'taking' && remainingSeconds === 0 && questions.length > 0 && !submitting) {
      // Auto-submit when the countdown expires.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void handleSubmit()
    }
  }, [screen, remainingSeconds, questions.length, submitting, handleSubmit])

  const goHome = () => {
    setError('')
    setScreen('home')
    setSelectedTopic(null)
    setActiveAssessment(null)
    setQuestions([])
    setResults(null)
  }

  const formatTime = (seconds: number) =>
    `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`

 
const pageTitle: Record<Screen, string> = {
  home: 'Your learning workspace',
  'full-mock': 'Full Mock Test',
  dashboard: 'Dashboard',
  'ai-tutor': 'AI Tutor',
  history: 'Test History',
  subjects: 'Subject Tests',
  topic: selectedTopic?.name ?? 'Choose a topic',
  configure: 'Configure your test',
  taking: activeAssessment?.title ?? 'Test in progress',
  results: 'Your test results',
}


  return (
    <div className="app-shell min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <button onClick={() => setScreen('dashboard')} className="flex items-center gap-3 text-left">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white"><Brain size={24} /></span>
            <span><span className="block text-lg font-bold tracking-tight">AdaptiveLearning</span><span className="block text-xs text-slate-500">Learn at your own pace</span></span>
          </button>
          <div className="flex items-center gap-2"><div className="hidden items-center gap-2 text-sm text-slate-500 sm:flex"><GraduationCap size={18} /> {user?.name ?? 'Student workspace'}</div><button type="button" onClick={() => navigate('/app/profile')} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Profile</button><ThemeToggle compact/><button type="button" onClick={() => void signOut()} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Sign out</button></div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
        {screen !== 'dashboard' && screen !== 'taking' && screen !== 'results' && (
          <button 
onClick={() => {
  setError('')
  if(screen === 'ai-tutor'){
    setScreen('dashboard')
  }
  else if(screen === 'history'){
   setScreen('dashboard')
  }
  else if (screen === 'home') {
    setScreen('dashboard')
  } else if (screen === 'subjects' || screen === 'full-mock') {
    goHome()
  } else if (screen === 'topic') {
    setScreen('subjects')
  } else if (screen === 'configure') {
    setScreen(selectedTopic ? 'topic' : 'full-mock')
  }
}}
 className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-indigo-700">
            <ArrowLeft size={16} /> Back
          </button>
        )}
{screen !== 'dashboard' && (
        <div className="mb-6">
         
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{pageTitle[screen]}</h1>
          {screen === 'home' && <p className="mt-2 max-w-2xl text-slate-500">Choose a full-length mock test or focus on a specific subject and topic. Your results will guide your next practice session.</p>}
        </div>)}

        {error && (
          <div role="alert" className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <XCircle size={18} className="mt-0.5 shrink-0" /><span>{error}</span>
            <button className="ml-auto" onClick={() => setError('')} aria-label="Dismiss error"><XCircle size={16}/></button>
          </div>
        )}
        {loading && (
          <div className="mb-5 flex items-center gap-2 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-700"><LoaderCircle size={17} className="animate-spin"/> Connecting to AdaptiveLearning backend…</div>
        )}
{screen === 'dashboard' && <Dashboard studentId={studentId} />}

{screen === 'history' && (
  <section className="space-y-6">
    {/* Page heading */}
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
    

      <button
        type="button"
        onClick={() => {
         setHistoryRefresh((count) => count + 1)
          setScreen('dashboard');
          setScreen('history');
        }}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
      >
        <RotateCcw size={16} />
        Refresh history
      </button>
    </div>

    {/* Summary cards */}
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">Tests found</p>
        <p className="mt-2 text-3xl font-bold text-slate-900">
          {testHistory.length}
        </p>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">Completed tests</p>
        <p className="mt-2 text-3xl font-bold text-emerald-600">
          {testHistory.filter((item) => item.status === 'completed').length}
        </p>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">In-progress tests</p>
        <p className="mt-2 text-3xl font-bold text-amber-600">
          {testHistory.filter((item) => item.status === 'in_progress').length}
        </p>
      </article>
    </div>

    {/* History table */}
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
        <h3 className="text-lg font-bold text-slate-900">
          All test attempts
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Your saved attempts appear here.
        </p>
      </div>

      {historyLoading ? (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <LoaderCircle size={36} className="animate-spin text-indigo-600" />
          <p className="mt-4 text-sm text-slate-500">
            Loading test history...
          </p>
        </div>
      ) : historyError ? (
        <div className="px-6 py-12 text-center">
          <XCircle size={36} className="mx-auto text-rose-500" />
          <h3 className="mt-3 font-semibold text-slate-900">
            Could not load test history
          </h3>
          <p className="mt-2 break-words text-sm text-rose-600">
            {historyError}
          </p>
          <button
            type="button"
            onClick={() => {
              setScreen('dashboard');
              window.setTimeout(() => setScreen('history'), 0);
            }}
            className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Try again
          </button>
        </div>
      ) : testHistory.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-indigo-600">
            <FileText size={27} />
          </div>
          <h3 className="mt-4 font-semibold text-slate-900">
            No test history yet
          </h3>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
            Complete and submit a test to see its saved score and details here.
          </p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event('open-tests'))}
            className="mt-5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Take a test
          </button>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-6 py-4 font-semibold">Test name</th>
                  <th className="px-6 py-4 font-semibold">Score</th>
                  <th className="px-6 py-4 font-semibold">Questions</th>
                  <th className="px-6 py-4 font-semibold">Date</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {testHistory.map((item) => {
                  const date = item.completed_at ?? item.started_at;
                  const score =
                    item.score == null ? null : Number(item.score);

                  return (
                    <tr
                      key={item.attempt_id}
                      className="transition hover:bg-slate-50"
                    >
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
                            <FileText size={19} />
                          </span>
                          <div>
                            <p className="font-semibold text-slate-900">
                              {item.test_name}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              Attempt #{item.attempt_id}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-5 font-semibold text-slate-900">
                        {score == null ? '—' : `${score.toFixed(1)}%`}
                      </td>

                      <td className="px-6 py-5 text-slate-600">
                        {item.total_questions}
                      </td>

                      <td className="whitespace-nowrap px-6 py-5 text-slate-600">
                        {date
                          ? new Date(date).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })
                          : '—'}
                      </td>

                      <td className="px-6 py-5">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            item.status === 'completed'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {item.status === 'completed'
                            ? 'Completed'
                            : 'In progress'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="divide-y divide-slate-100 md:hidden">
            {testHistory.map((item) => {
              const date = item.completed_at ?? item.started_at;
              const score =
                item.score == null ? null : Number(item.score);

              return (
                <article key={item.attempt_id} className="space-y-4 p-5">
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
                      <FileText size={20} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <h3 className="break-words font-semibold text-slate-900">
                        {item.test_name}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Attempt #{item.attempt_id}
                      </p>
                    </div>

                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        item.status === 'completed'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {item.status === 'completed'
                        ? 'Completed'
                        : 'In progress'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4">
                    <div>
                      <p className="text-xs text-slate-500">Score</p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {score == null ? '—' : `${score.toFixed(1)}%`}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-slate-500">Questions</p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {item.total_questions}
                      </p>
                    </div>

                    <div className="col-span-2">
                      <p className="text-xs text-slate-500">Date</p>
                      <p className="mt-1 font-medium text-slate-700">
                        {date
                          ? new Date(date).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })
                          : '—'}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>

    
  </section>
)}

  {screen === 'ai-tutor' && (
  <AITutor
    studentId={studentId}
    onBack={() => setScreen('dashboard')}
  />

)}
        {screen === 'home' && (
          <>
            <section className="mb-7 overflow-hidden rounded-3xl bg-gradient-to-r from-indigo-700 via-indigo-600 to-violet-600 p-7 text-white sm:p-10">
              <div className="max-w-2xl">
                <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-indigo-100">Your next step starts here</p>
                <h2 className="text-3xl font-bold sm:text-4xl">Practice with purpose.</h2>
                <p className="mt-3 text-indigo-100">Take an exam-style mock test or practise one topic. After each test, see your score, review explanations and discover what to improve next.</p>
              </div>
            </section>
            <div className="grid gap-5 lg:grid-cols-2">
              <button onClick={() => { setScreen('full-mock'); setTestMode('existing'); setError('') }} className="group rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-1 hover:border-indigo-300 hover:shadow-lg sm:p-8">
                <div className="flex items-start justify-between">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700"><ClipboardIcon /></span>
                  <ChevronRight className="text-slate-400 transition group-hover:translate-x-1 group-hover:text-indigo-600"/>
                </div>
                <h3 className="mt-5 text-xl font-bold">Full Mock Test</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">Test yourself across multiple subjects in one exam-style session. Choose an existing mock or generate a custom one with AI.</p>
                <span className="mt-5 inline-flex rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">Explore mock tests</span>
              </button>
              <button onClick={() => { setScreen('subjects'); setError('') }} className="group rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-1 hover:border-emerald-300 hover:shadow-lg sm:p-8">
                <div className="flex items-start justify-between">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><BookOpen size={27}/></span>
                  <ChevronRight className="text-slate-400 transition group-hover:translate-x-1 group-hover:text-emerald-600"/>
                </div>
                <h3 className="mt-5 text-xl font-bold">Subject Tests</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">Choose Physics, Mathematics or Chemistry, focus on a topic, and take its saved test or generate targeted practice questions.</p>
                <span className="mt-5 inline-flex rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white">Choose a subject</span>
              </button>
            </div>
            <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex items-center gap-3"><span className="rounded-xl bg-amber-50 p-2.5 text-amber-700"><Trophy size={21}/></span><div><h3 className="font-bold">Your test workspace</h3><p className="text-sm text-slate-500">Choose a test to get started. Your completed attempts will be saved.</p></div></div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <InfoTile label="Subjects available" value={subjects.length ? String(subjects.length) : '—'} />
                <InfoTile label="Topics available" value={topics.length ? String(topics.length) : '—'} />
                <InfoTile label="Saved assessments" value={assessments.length ? String(assessments.length) : '—'} />
              </div>
            </section>
          </>
        )}

        {screen === 'full-mock' && (
          <div className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-bold">Choose how to take your mock test</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <ModeCard active={testMode === 'existing'} icon={<FileText size={22}/>} title="Existing Mock Test" description="Use questions already saved in the database." onClick={() => setTestMode('existing')}/>
                <ModeCard active={testMode === 'ai'} icon={<Brain size={22}/>} title="AI-Generated Mock" description="Create a test using your own settings." onClick={() => setTestMode('ai')}/>
              </div>
              {testMode === 'existing' ? (
                <div className="mt-6 rounded-xl bg-slate-50 p-4">
                  <p className="font-semibold">Full Mock Test</p><p className="mt-1 text-sm text-slate-500">Uses up to 30 saved questions across all available subjects. Default duration: 60 minutes.</p>
                  <button disabled={loading} onClick={() => void startExistingFullMock()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"><BookOpen size={17}/> Start existing mock</button>
                </div>
              ) : (
                <TestConfiguration duration={duration} setDuration={setDuration} difficulty={difficulty} setDifficulty={setDifficulty} subjects={subjects} selectedSubjects={selectedSubjects} setSelectedSubjects={setSelectedSubjects} showSubjects onGenerate={() => void startAiTest()} disabled={loading || !subjects.length}/>
              )}
            </section>
            <aside className="rounded-2xl bg-indigo-950 p-6 text-white">
              <Brain size={28} className="text-indigo-300"/>
              <h3 className="mt-4 text-xl font-bold">Recommended difficulty</h3>
              <p className="mt-2 text-sm leading-6 text-indigo-200">For new students, Recommended starts with a balanced mix. As test history builds up, the system uses performance to choose a more suitable difficulty mix.</p>
              <div className="mt-5 space-y-3 text-sm">{['Questions from selected subjects','Timer and question navigation','Results with explanations','Saved attempt history'].map((item) => <div key={item} className="flex items-center gap-2"><CheckCircle2 size={17} className="text-emerald-300"/>{item}</div>)}</div>
            </aside>
          </div>
        )}

        {screen === 'subjects' && (
          <>
            <p className="mb-5 text-slate-500">Choose a subject to see its available topics and tests.</p>
            {subjects.length === 0 && !loading ? <EmptyState text="No subjects found. Add topics to your PostgreSQL database first."/> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {subjects.map((subject) => {
                const style = subjectStyles[subject] ?? { icon: BookOpen, tint: 'from-indigo-500 to-violet-600' }
                const Icon = style.icon
                const count = topics.filter((topic) => topic.subject === subject).length
                return <button key={subject} onClick={() => { setSelectedSubject(subject); setScreen('topic'); setError('') }} className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-md">
                  <span className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${style.tint} text-white`}><Icon size={24}/></span>
                  <h3 className="mt-4 text-lg font-bold">{subject}</h3><p className="mt-1 text-sm text-slate-500">{count} topics available</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-indigo-600">View topics <ArrowRight size={15}/></span>
                </button>
              })}
            </div>}
          </>
        )}

        {screen === 'topic' && (
          <>
            <div className="mb-5 flex items-center gap-3 rounded-xl bg-indigo-50 p-4 text-indigo-800"><BookOpen size={21}/><div><p className="font-semibold">{selectedSubject}</p><p className="text-sm text-indigo-700">Select a topic to take an existing test or create an AI-generated test.</p></div></div>
            {topicList.length === 0 ? <EmptyState text="No topics are available for this subject."/> : <div className="grid gap-4 md:grid-cols-2">
              {topicList.map((topic) => {
                const assessment = assessments.find((item) => item.topic_id === topic.id)
                return <article key={topic.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{topic.name}</h3><p className="mt-1 text-sm text-slate-500">{topic.description || 'Build understanding and check your progress.'}</p></div><span className="rounded-lg bg-slate-100 p-2 text-slate-600"><CircleHelp size={20}/></span></div>
                  <p className="mt-4 text-xs text-slate-500">{assessment ? `${assessment.question_count ?? 0} saved questions` : 'No existing assessment'}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button disabled={loading || !assessment || !(assessment.question_count ?? 0)} onClick={() => { setSelectedTopic(topic); void startExistingTopic(topic) }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40">Existing test</button>
                    <button onClick={() => { setSelectedTopic(topic); setTestMode('ai'); setDuration(15); setDifficulty('recommended'); setScreen('configure'); setError('') }} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">AI-generated test</button>
                  </div>
                </article>
              })}
            </div>}
          </>
        )}

        {screen === 'configure' && (
          <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <div className="mb-6 flex items-center gap-3"><span className="rounded-xl bg-violet-50 p-3 text-violet-700"><Brain size={24}/></span><div><h2 className="font-bold">AI-generated topic test</h2><p className="text-sm text-slate-500">{selectedSubject} · {selectedTopic?.name}</p></div></div>
            <TestConfiguration duration={duration} setDuration={setDuration} difficulty={difficulty} setDifficulty={setDifficulty} subjects={subjects} selectedSubjects={[selectedSubject]} setSelectedSubjects={() => undefined} showSubjects={false} onGenerate={() => void startAiTest()} disabled={loading || !selectedTopic}/>
          </div>
        )}

        {screen === 'taking' && activeQuestion && (
          <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div><p className="text-sm text-indigo-600">{activeAssessment?.title}</p><p className="mt-1 text-sm text-slate-500">Question {currentQuestion + 1} of {questions.length}</p></div>
                <div className={`flex items-center gap-2 rounded-xl px-3 py-2 font-mono font-bold ${remainingSeconds <= 60 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-800'}`}><Timer size={18}/>{formatTime(remainingSeconds)}</div>
              </div>
              <div className="mb-4 flex flex-wrap gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize">{activeQuestion.difficulty}</span>{activeQuestion.subject && <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{activeQuestion.subject}</span>}{activeQuestion.topic_name && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs">{activeQuestion.topic_name}</span>}</div>
              <h2 className="text-xl font-semibold leading-8">{activeQuestion.question_text}</h2>
              <div className="mt-6 space-y-3">
                {Object.entries(activeQuestion.options ?? {}).map(([key, value]) => <button key={key} onClick={() => setAnswers((current) => ({ ...current, [activeQuestion.id]: key }))} className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${answers[activeQuestion.id] === key ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-indigo-200 hover:bg-slate-50'}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${answers[activeQuestion.id] === key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{key}</span><span className="pt-1">{String(value)}</span></button>)}
              </div>
              <div className="mt-8 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
                <button disabled={currentQuestion === 0} onClick={() => setCurrentQuestion((value) => value - 1)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold disabled:opacity-40"><ArrowLeft size={16}/> Previous</button>
                {currentQuestion < questions.length - 1 ? <button onClick={() => setCurrentQuestion((value) => value + 1)} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">Next <ArrowRight size={16}/></button> : <button disabled={submitting} onClick={() => void handleSubmit()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><Send size={16}/> {submitting ? 'Submitting…' : 'Submit test'}</button>}
              </div>
            </section>
            <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="font-bold">Question navigator</h3><p className="mt-1 text-sm text-slate-500">{answeredCount} of {questions.length} answered</p>
              <div className="mt-4 grid grid-cols-5 gap-2">{questions.map((question, index) => <button key={question.id} onClick={() => setCurrentQuestion(index)} aria-label={`Go to question ${index + 1}`} className={`flex aspect-square items-center justify-center rounded-lg text-sm font-semibold ${index === currentQuestion ? 'bg-indigo-600 text-white ring-2 ring-indigo-200' : answers[question.id] ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{index + 1}</button>)}</div>
              <div className="mt-5 space-y-2 text-xs text-slate-500"><p>● Green: answered</p><p>● Grey: unanswered</p><p>● Indigo: current question</p></div>
              <button onClick={() => { if (window.confirm('Submit the test now? Unanswered questions will be marked incorrect.')) void handleSubmit() }} disabled={submitting} className="mt-6 w-full rounded-xl border border-rose-200 px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Submit test</button>
            </aside>
          </div>
        )}

        {screen === 'results' && results && (
          <div className="space-y-5">
            <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-700 to-violet-700 p-6 text-white sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-sm font-semibold text-indigo-200">TEST COMPLETED</p><h2 className="mt-2 text-2xl font-bold">{results.title}</h2><p className="mt-2 text-indigo-100">Attempt #{results.attempt_id} · {Math.floor(results.duration_seconds / 60)}m {results.duration_seconds % 60}s taken</p></div><div className="rounded-2xl bg-white/10 p-5 text-center"><p className="text-sm text-indigo-100">Your score</p><p className="mt-1 text-4xl font-bold">{results.score}%</p><p className="mt-1 text-sm text-indigo-100">{results.correct_answers} / {results.total_questions} correct</p></div></div>
              <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-emerald-300" style={{ width: `${results.score}%` }}/></div>
            </section>
            <div className="grid gap-3 sm:grid-cols-4"><ResultStat label="Correct" value={results.correct_answers} tone="green"/><ResultStat label="Incorrect" value={results.incorrect_answers} tone="red"/><ResultStat label="Unanswered" value={results.unanswered} tone="amber"/><ResultStat label="Total questions" value={results.total_questions} tone="indigo"/></div>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
              <h2 className="text-xl font-bold">Topic-wise performance</h2><p className="mt-1 text-sm text-slate-500">Use this breakdown to decide what to practise next.</p>
              <div className="mt-5 space-y-4">{Object.entries(results.results.reduce<Record<string, { total: number; correct: number }>>((acc, item) => { const key = item.topic_name || item.subject || 'General'; acc[key] ??= { total: 0, correct: 0 }; acc[key].total++; if (item.is_correct) acc[key].correct++; return acc }, {})).map(([name, stats]) => { const percent = Math.round(stats.correct / stats.total * 100); return <div key={name}><div className="mb-1 flex justify-between gap-3 text-sm"><span className="font-semibold">{name}</span><span className="text-slate-500">{stats.correct}/{stats.total} correct · {percent}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${percent >= 80 ? 'bg-emerald-500' : percent >= 60 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${percent}%` }}/></div></div> })}</div>
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
              <h2 className="text-xl font-bold">Review answers and explanations</h2>
              <div className="mt-5 space-y-4">{results.results.map((item, index) => <article key={item.question_id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start gap-3"><span className={`mt-0.5 rounded-lg p-2 ${item.is_correct ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{item.is_correct ? <CheckCircle2 size={19}/> : <XCircle size={19}/>}</span><div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Question {index + 1} · {item.topic_name}</p><h3 className="mt-1 font-semibold">{item.question_text}</h3><div className="mt-3 space-y-2">{Object.entries(item.options ?? {}).map(([key, value]) => <p key={key} className={`rounded-lg px-3 py-2 text-sm ${key === item.correct_option ? 'bg-emerald-50 font-semibold text-emerald-800' : key === item.selected_option && !item.is_correct ? 'bg-rose-50 text-rose-800' : 'text-slate-600'}`}>{key}. {String(value)} {key === item.correct_option ? '· Correct answer' : key === item.selected_option ? '· Your answer' : ''}</p>)}</div><div className="mt-3 rounded-lg bg-slate-50 p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Explanation</p><p className="mt-1 text-sm leading-6 text-slate-700">{item.explanation}</p></div></div></div>
              </article>)}</div>
            </section>
           
            <div className="flex flex-wrap gap-3"><button onClick={goHome} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold">Back to test menu</button><button onClick={() => { setAnswers({}); setCurrentQuestion(0); setResults(null); setRemainingSeconds(duration * 60); setStartedSeconds(Date.now()); setScreen('taking') }} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white"><RotateCcw size={16}/> Retake test</button></div>
          </div>
        )}
      </main>
      <footer className="mt-12 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-slate-500 sm:px-6 lg:px-8"><span>AdaptiveLearning · Personalized practice</span><span>Questions and scores are processed by the backend</span></div></footer>
    </div>
  )
}

function ClipboardIcon() { return <FileText size={27}/> }

function InfoTile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>
}

function ModeCard({ active, icon, title, description, onClick }: { active: boolean; icon: ReactNode; title: string; description: string; onClick: () => void }) {
  return <button onClick={onClick} className={`rounded-xl border p-4 text-left transition ${active ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-indigo-200'}`}><span className="text-indigo-600">{icon}</span><p className="mt-3 font-semibold">{title}</p><p className="mt-1 text-sm leading-5 text-slate-500">{description}</p></button>
}

function TestConfiguration({ duration, setDuration, difficulty, setDifficulty, subjects, selectedSubjects, setSelectedSubjects, showSubjects, onGenerate, disabled }: { duration: number; setDuration: (value: number) => void; difficulty: Difficulty; setDifficulty: (value: Difficulty) => void; subjects: string[]; selectedSubjects: string[]; setSelectedSubjects: (value: string[]) => void; showSubjects: boolean; onGenerate: () => void; disabled: boolean }) {
  const toggleSubject = (subject: string) => setSelectedSubjects(selectedSubjects.includes(subject) ? selectedSubjects.filter((item) => item !== subject) : [...selectedSubjects, subject])
  return <div className="mt-6 space-y-6">
    {showSubjects && <div><h3 className="font-bold">1. Choose subjects</h3><p className="mt-1 text-sm text-slate-500">Select one or more subjects for the full mock test.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{subjects.map((subject) => <label key={subject} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-medium ${selectedSubjects.includes(subject) ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'}`}><input type="checkbox" checked={selectedSubjects.includes(subject)} onChange={() => toggleSubject(subject)} className="h-4 w-4 accent-indigo-600"/>{subject}</label>)}</div></div>}
    <div><h3 className="font-bold">{showSubjects ? '2' : '1'}. Choose duration</h3><div className="mt-3 flex flex-wrap gap-2">{[10, 15, 30, 60, 90, 180].map((minutes) => <button key={minutes} onClick={() => setDuration(minutes)} className={`rounded-xl border px-4 py-2.5 text-sm font-semibold ${duration === minutes ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white hover:border-indigo-300'}`}>{minutes} min</button>)}</div><p className="mt-2 text-xs text-slate-500">The number of generated questions is estimated from the selected duration.</p></div>
    <div><h3 className="font-bold">{showSubjects ? '3' : '2'}. Choose difficulty</h3><div className="mt-3 grid gap-2 sm:grid-cols-2">{difficultyOptions.map((item) => <button key={item.value} onClick={() => setDifficulty(item.value)} className={`rounded-xl border p-3 text-left ${difficulty === item.value ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-200' : 'border-slate-200 hover:border-indigo-200'}`}><span className="block font-semibold">{item.label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{item.description}</span></button>)}</div></div>
    <button disabled={disabled || (showSubjects && selectedSubjects.length === 0)} onClick={onGenerate} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3.5 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"><Brain size={18}/> Generate AI test</button>
  </div>
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><CircleHelp size={30} className="mx-auto text-slate-400"/><p className="mt-3 text-sm text-slate-500">{text}</p></div>
}

function ResultStat({ label, value, tone }: { label: string; value: number; tone: 'green' | 'red' | 'amber' | 'indigo' }) {
  const tones = { green: 'bg-emerald-50 text-emerald-800', red: 'bg-rose-50 text-rose-800', amber: 'bg-amber-50 text-amber-800', indigo: 'bg-indigo-50 text-indigo-800' }
  return <div className={`rounded-xl p-4 ${tones[tone]}`}><p className="text-sm opacity-80">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>
}

function App() {
  const path = usePathname()
  const { user, ready } = useAuth()
  useEffect(() => {
    if (!ready) return
    if (path === '/' || path === '/signin' || path === '/signup') {
      if (user) navigate('/app')
      else if (path === '/') navigate('/signin')
    } else if (path.startsWith('/app') && (!user)) {
      navigate('/signin')
    } else if (!['/signin', '/signup', '/forgot-password'].includes(path) && !path.startsWith('/reset-password') && !path.startsWith('/app')) {
      navigate(user ? '/app' : '/signin')
    }
  }, [path, user, ready])
  if (!ready) return <div className="route-loading"><span className="loader-dot"/>Preparing your learning space…</div>
  if (path === '/signin') return <AuthPage mode="signin" />
  if (path === '/signup') return <AuthPage mode="signup" />
  if (path === '/forgot-password') return <ForgotPasswordPage />
  if (path.startsWith('/reset-password')) return <ResetPasswordPage />
  if (path === '/app/profile' && user) return <ProfilePage />
  if (path.startsWith('/app') && user) return <LearningApp />
  return <div className="route-loading"><span className="loader-dot"/>Redirecting…</div>
}

export default App
