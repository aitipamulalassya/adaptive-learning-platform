
import { ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type DashboardStats = {
  average_accuracy: number | null;
  tests_completed: number;
  topics_practiced: number;
  study_time_seconds: number;
};

type TestHistoryItem = {
  id: number;
  name: string;
  score: number;
  total_questions: number;
  date: string;
};

type SubjectPerformance = {
  subject: string;
  accuracy: number | null;
  questions_answered: number;
};

type DashboardResponse = {
  student: { id: number; name: string };
  stats: DashboardStats;
  recent_tests: TestHistoryItem[];
  subject_performance: SubjectPerformance[];
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const dashboardQueryKey = (studentId: number | null) =>
  ["dashboard", studentId] as const;

async function fetchDashboard(
  studentId: number
): Promise<DashboardResponse> {
  const response = await fetch(
    `${API_BASE_URL}/students/${studentId}/dashboard`,
    { credentials: "include" }
  );

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload?.detail || "Could not load dashboard data."
    );
  }

  return payload as DashboardResponse;
}

function formatDate(value: string) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

export default function Dashboard({
  studentId,
}: {
  studentId: number | null;
}) {
  const queryClient = useQueryClient();

  const {
    data,
    isPending,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: dashboardQueryKey(studentId),
    queryFn: () => {
      if (!studentId) {
        throw new Error("Please sign in to view your dashboard.");
      }

      return fetchDashboard(studentId);
    },
    enabled: Boolean(studentId),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Listen for successful operations that change Dashboard data.
  useEffect(() => {
    if (!studentId) return;

    const refreshDashboard = () => {
      void queryClient.invalidateQueries({
        queryKey: dashboardQueryKey(studentId),
      });
    };

    window.addEventListener(
      "dashboard-data-changed",
      refreshDashboard
    );

    return () => {
      window.removeEventListener(
        "dashboard-data-changed",
        refreshDashboard
      );
    };
  }, [studentId, queryClient]);

  const loading = isPending || (isFetching && !data);

  const stats = [
    {
      label: "Average accuracy",
      value:
        data?.stats.average_accuracy == null
          ? "—"
          : `${data.stats.average_accuracy.toFixed(1)}%`,
      icon: "🎯",
    },
    {
      label: "Tests completed",
      value: data ? String(data.stats.tests_completed) : "—",
      icon: "📝",
    },
    {
      label: "Topics practiced",
      value: data ? String(data.stats.topics_practiced) : "—",
      icon: "📚",
    },
    {
      label: "Weak Subjects",
      value: data
        ? String(
            data.subject_performance.filter(
              (item) =>
                item.accuracy != null && item.accuracy < 50
            ).length
          )
        : "—",
      icon: "📉",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <section className="flex flex-col gap-5 rounded-2xl bg-indigo-600 p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <p className="text-sm font-medium text-indigo-100">
            YOUR LEARNING SPACE
          </p>

          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
            Welcome back
            {data?.student?.name ? `, ${data.student.name}` : ""}!
          </h1>

          <p className="mt-2 max-w-xl text-sm text-indigo-100 sm:text-base">
            Continue learning, practice your subjects, and track
            your progress.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new Event("open-tests"))
          }
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-semibold text-indigo-700 transition hover:bg-indigo-50"
        >
          Take a test <span aria-hidden="true">→</span>
        </button>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
        >
          {error instanceof Error
            ? error.message
            : "Could not load dashboard data."}

          <button
            type="button"
            onClick={() => void refetch()}
            className="ml-2 font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}

      <section
        aria-label="Learning summary"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {stats.map((stat) => {
          const weakSubjects = (
            data?.subject_performance ?? []
          ).filter(
            (item) =>
              item.accuracy != null && item.accuracy < 50
          );

          const isWeakSubjectsCard =
            stat.label === "Weak Subjects";

          return (
            <article
              key={stat.label}
              className={`relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${
                isWeakSubjectsCard
                  ? "group cursor-help focus-within:ring-2 focus-within:ring-indigo-500"
                  : ""
              }`}
              tabIndex={isWeakSubjectsCard ? 0 : undefined}
              aria-describedby={
                isWeakSubjectsCard
                  ? "weak-subjects-tooltip"
                  : undefined
              }
            >
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {stat.label}
                </p>
                <span className="text-xl" aria-hidden="true">
                  {stat.icon}
                </span>
              </div>

              <p className="mt-4 text-3xl font-bold">
                {loading ? (
                  <span className="text-slate-300 dark:text-slate-700">
                    …
                  </span>
                ) : (
                  stat.value
                )}
              </p>

              {isWeakSubjectsCard && !loading && data && (
                <div
                  id="weak-subjects-tooltip"
                  role="tooltip"
                  className="invisible absolute right-0 top-full z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] translate-y-1 rounded-xl border border-slate-200 bg-white p-4 text-slate-900 opacity-0 shadow-xl transition duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus:visible group-focus:translate-y-0 group-focus:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                >
                  <p className="font-semibold">
                    Subjects that need improvement
                  </p>

                  <div className="mt-3 space-y-3">
                    {weakSubjects.length === 0 ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        No weak Subjects identified yet. Complete
                        more assessments to see your Subject
                        performance.
                      </p>
                    ) : (
                      weakSubjects.map((item) => (
                        <div
                          key={item.subject}
                          className="border-t border-slate-200 pt-3 first:border-0 first:pt-0 dark:border-slate-700"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium">
                              {item.subject}
                            </p>

                            <span className="shrink-0 rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                              Needs practice
                            </span>
                          </div>

                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Accuracy: {item.accuracy!.toFixed(1)}%
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold">
              Recent test history
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Your latest completed tests
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new Event("view-all-tests"))
            }
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50 hover:text-indigo-700"
          >
            View all
            <ArrowRight size={15} />
          </button>
        </div>

        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            Loading test history…
          </div>
        ) : !data?.recent_tests.length ? (
          <div className="px-5 py-12 text-center">
            <div className="text-4xl" aria-hidden="true">
              📝
            </div>

            <h3 className="mt-3 font-semibold">
              No completed tests yet
            </h3>

            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Your recent tests will appear here after you
              complete one.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.recent_tests.slice(0, 3).map((test) => (
              <article
                key={test.id}
                className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4"
              >
                <div className="col-span-2 sm:col-span-1">
                  <p className="text-xs text-slate-500">
                    Test name
                  </p>
                  <p className="mt-1 font-semibold">
                    {test.name}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-slate-500">
                    Score
                  </p>
                  <p className="mt-1 font-semibold">
                    {test.score.toFixed(1)}% (
                    {test.total_questions} questions)
                  </p>
                </div>

                <div>
                  <p className="text-xs text-slate-500">
                    Accuracy
                  </p>
                  <p className="mt-1 font-semibold">
                    {test.score.toFixed(1)}%
                  </p>
                </div>

                <div>
                  <p className="text-xs text-slate-500">
                    Date
                  </p>
                  <p className="mt-1 font-semibold">
                    {formatDate(test.date)}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-bold">Quick actions</h2>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new Event("open-tests"))
            }
            className="flex min-h-24 items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:border-indigo-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-indigo-100 text-2xl dark:bg-indigo-950">
              📝
            </span>

            <span>
              <span className="block font-semibold">
                Take a test
              </span>
              <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">
                Full mock or subject test
              </span>
            </span>

            <span className="ml-auto text-slate-400">→</span>
          </button>

          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new Event("open-ai-tutor"))
            }
            className="flex min-h-24 items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:border-emerald-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-emerald-100 text-2xl dark:bg-emerald-950">
              💬
            </span>

            <span>
              <span className="block font-semibold">
                Ask the AI Tutor
              </span>
              <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">
                Get help with your studies
              </span>
            </span>

            <span className="ml-auto text-slate-400">→</span>
          </button>
        </div>
      </section>
    </div>
  );
}
