const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

export interface Topic { id: number; name: string; subject: string; description?: string | null }
export interface Assessment { id: number; title: string; topic_id: number | null; topic_name?: string | null; subject?: string | null; question_count?: number }
export interface TestQuestion { id: number; topic_id: number; question_text: string; options: Record<string, string>; difficulty: 'easy' | 'medium' | 'hard'; topic_name?: string; subject?: string }
export interface TestResult { question_id: number; question_text: string; options: Record<string, string>; selected_option: string | null; is_correct: boolean; correct_option: string; explanation: string; difficulty: string; topic_name: string; subject: string }
export interface SubmissionResult { attempt_id: number; assessment_id: number; title: string; score: number; correct_answers: number; incorrect_answers: number; unanswered: number; total_questions: number; duration_seconds: number; results: TestResult[] }
export interface AuthUser { id: number; name: string; email: string }
export interface AuthResponse { student: AuthUser }



async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const makeRequest = () =>
    fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })

  let response = await makeRequest()

  const authPaths = [
    '/auth/signin',
    '/auth/signup',
    '/auth/refresh',
    '/auth/forgot-password',
    '/auth/reset-password',
  ]

  if (response.status === 401 && !authPaths.includes(path)) {
    const refreshed = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    if (refreshed.ok) {
      response = await makeRequest()
    }
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.detail || `Request failed (${response.status})`)
  }

  return data as T
}

export async function authSignIn(payload: { email: string; password: string }) { return request<AuthResponse>('/auth/signin', { method: 'POST', body: JSON.stringify(payload) }) }
export async function authSignUp(payload: { name: string; email: string; password: string }) { return request<AuthResponse>('/auth/signup', { method: 'POST', body: JSON.stringify(payload) }) }

export async function authRefresh() {
  return request<AuthResponse>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function authSignOut() { return request<{ message: string }>('/auth/signout', { method: 'POST', body: JSON.stringify({}) }) }
export async function requestPasswordReset(email: string) { return request<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }) }
export async function resetPassword(token: string, password: string) { return request<{ message: string }>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }) }
export async function getProfile() { return request<{ student: AuthUser & { created_at?: string } }>('/auth/profile') }
export async function updateProfile(name: string) { return request<{ student: AuthUser & { created_at?: string } }>('/auth/profile', { method: 'PATCH', body: JSON.stringify({ name }) }) }
export async function getCatalog() { return request<{ topics: Topic[]; assessments: Assessment[] }>('/test-catalog') }
export async function getDemoStudent() { return request<{ student: { id: number; name: string; email: string } }>('/demo-student') }
export async function getExistingTopicTest(assessmentId: number) { return request<{ assessment: Assessment; questions: TestQuestion[] }>(`/assessments/${assessmentId}/test-questions`) }
export async function getExistingFullMock() { return request<{ assessment: Assessment; questions: TestQuestion[]; message?: string }>('/full-mock-test') }
export async function generateTest(payload: { mode: 'full' | 'topic'; subject_names: string[]; topic_id: number | null; duration_minutes: number; difficulty: 'easy' | 'medium' | 'hard' | 'recommended'; question_count: number; student_id?: number | null }) {
  return request<{ assessment: Assessment; questions: TestQuestion[] }>('/ai-tests/generate', { method: 'POST', body: JSON.stringify(payload) })
}
export async function submitTest(payload: { student_id: number; assessment_id: number; question_ids: number[]; answers: Record<number, string>; duration_seconds: number }) {
  return request<SubmissionResult>('/tests/submit', { method: 'POST', body: JSON.stringify(payload) })
}
export interface ChatAttachment { document_id: number; name: string; pages: number }
export interface ChatMessage { id: number; role: 'user' | 'assistant'; content: string; metadata: Record<string, unknown>; created_at: string }
export interface Chat { id: number; student_id: number; title: string; created_at: string; updated_at: string }
export async function askAITutor(payload: { question: string; subject?: string; chat_id?: number; student_id?: number }) {
  return request<{ answer: string }>('/ai-tutor/ask', { method: 'POST', body: JSON.stringify(payload) })
}
export async function createChat(payload: { student_id: number; title?: string }) { return request<{ chat: Chat }>('/chats', { method: 'POST', body: JSON.stringify(payload) }) }
export async function getChats(studentId: number) { return request<{ chats: Omit<Chat, 'student_id'>[] }>(`/chats?student_id=${studentId}`) }
export async function getChat(chatId: number, studentId: number) { return request<{ chat: Chat; messages: ChatMessage[] }>(`/chats/${chatId}?student_id=${studentId}`) }
export async function saveChatExchange(chatId: number, payload: { student_id: number; question: string; answer: string; attachment?: ChatAttachment | null }) {
  return request<{ message: string; chat_id: number }>(`/chats/${chatId}/messages`, { method: 'POST', body: JSON.stringify(payload) })
}
export async function deleteChat(chatId: number, studentId: number) { return request<{ message: string; chat_id: number }>(`/chats/${chatId}?student_id=${studentId}`, { method: 'DELETE' }) }
export interface StudentDocument { id: number; document_name: string; file_size_bytes: number | null; total_pages: number; status: 'processing' | 'processed' | 'failed'; created_at: string }
export interface DocumentsResponse { student_id: number; documents: StudentDocument[]; total_documents: number }
export async function getDocuments(studentId: number, chatId: number) { return request<DocumentsResponse>(`/documents?student_id=${studentId}&chat_id=${chatId}`) }

export async function uploadDocument(
  studentId: number,
  chatId: number,
  file: File,
) {
  const formData = new FormData()
  formData.append('student_id', String(studentId))
  formData.append('chat_id', String(chatId))
  formData.append('file', file)

  const response = await fetch(`${API_BASE_URL}/documents/upload`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.detail || `Upload failed (${response.status})`)
  }

  return data as {
    message: string
    document_id: number
    document_name: string
    total_pages: number
    chunks_created: number
    embedding_dimensions: number
    status: StudentDocument['status']
  }
}

export async function deleteDocument(documentId: number, studentId: number) { return request<{ message: string; document_id: number; document_name: string }>(`/documents/${documentId}?student_id=${studentId}`, { method: 'DELETE' }) }
