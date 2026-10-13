import { useEffect, useRef, useState, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {

  ArrowLeft,

  BrainCircuit,

  FileText,

  Lightbulb,

  MessageSquare,

  MessageSquarePlus,

  Paperclip,

  Send,

  SidebarClose,

  SidebarOpen,

  Trash2,

  User,

} from 'lucide-react'

import {

  askAITutor,

  createChat,

  getChats,

  getChat,

  saveChatExchange,

  deleteChat as deleteChatApi,

  type Chat as ApiChat,


  uploadDocument,



} from '../services/api'

type Message = {

  role: 'user' | 'assistant'

  content: string

  attachment?: {

    document_id?: number
    name: string

    pages: number

  }

}

type Chat = {

  id: string

  title: string

  messages: Message[]

  updatedAt: string

}

type AITutorProps = {

  studentId: number | null

  onBack: () => void

}

const suggestions = [

  { label: 'Explain a concept in simple words', icon: BrainCircuit },

  { label: 'Help me understand a question', icon: MessageSquare },

  { label: 'Give me a step-by-step solution', icon: Lightbulb },

  { label: 'Ask questions about my PDF', icon: FileText },

]

export default function AITutor({

  onBack,

  studentId,

}: AITutorProps) {

  const [chats, setChats] = useState<Chat[]>([])

  const [activeId, setActiveId] = useState<string | null>(null)

  const [question, setQuestion] = useState('')

  const [loadingChatIds, setLoadingChatIds] = useState<string[]>([])
  const isActiveChatLoading = activeId !== null && loadingChatIds.includes(activeId)

  const [error, setError] = useState('')

  const [sidebarOpen, setSidebarOpen] = useState(true)

  const activeChat = chats.find((chat) => chat.id === activeId)

  const messages = activeChat?.messages ?? []

const [documentBusy, setDocumentBusy] = useState(false)
  const [pendingAttachment, setPendingAttachment] = useState<{ document_id: number; name: string; pages: number } | null>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)

  function mapApiChat(chat: ApiChat): Chat {

    return {

      id: String(chat.id),

      title: chat.title,

      messages: [],

      updatedAt: new Date(chat.updated_at).toLocaleString(),

    }

  }


  useEffect(() => {

    if (!studentId) return

    let cancelled = false

    getChats(studentId)

      .then((response) => {

        if (!cancelled) {

          setChats(

            response.chats.map((chat) =>

              mapApiChat({ ...chat, student_id: studentId }),

            ),

          )

        }

      })

      .catch((err) => {

        if (!cancelled) {

          setError(

            err instanceof Error

              ? err.message

              : 'Could not load saved chats.',

          )

        }

      })

    return () => {

      cancelled = true

    }

  }, [studentId])

  function startNewChat() {

    setActiveId(null)
    setPendingAttachment(null)

    setQuestion('')

    setError('')

  }

  async function openChat(id: string) {

    if (!studentId) {

      setError('Student information is not ready. Please try again.')

      return

    }

    setActiveId(id)
    setQuestion('')
    setPendingAttachment(null)
    setError('')

    try {

      const response = await getChat(Number(id), studentId)

      setChats((previous) =>

        previous.map((chat) =>

          chat.id === id

            ? {

                ...chat,

                title: response.chat.title,

                messages: response.messages.map((message) => {
                  const metadata = message.metadata ?? {}
                  const raw = metadata.attachment as { document_id?: number; name?: string; pages?: number } | undefined
                  return {
                    role: message.role,
                    content: message.content,
                    attachment: raw?.name && raw?.pages != null ? { document_id: raw.document_id ?? 0, name: raw.name, pages: raw.pages } : undefined,
                  }
                }),

                updatedAt: new Date(

                  response.chat.updated_at,

                ).toLocaleString(),

              }

            : chat,

        ),

      )

    } catch (err) {

      setError(

        err instanceof Error

          ? err.message

          : 'Could not load this conversation.',

      )

    }

  }

async function handleDocumentUpload(file: File) {
    if (!studentId || documentBusy) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please select a PDF file.')
      return
    }
    setDocumentBusy(true)
    setError('')
    try {
      let chatId = activeId
      if (!chatId) {
        const created = await createChat({ student_id: studentId, title: file.name.replace(/\.pdf$/i, '').slice(0, 60) || 'New chat' })
        chatId = String(created.chat.id)
        setActiveId(chatId)
        setChats(previous => [{ id: chatId!, title: created.chat.title, messages: [], updatedAt: 'Just now' }, ...previous])
      }
      const result = await uploadDocument(studentId, Number(chatId), file)
      setPendingAttachment({ document_id: result.document_id, name: result.document_name, pages: result.total_pages })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the PDF.')
    } finally {
      setDocumentBusy(false)
    }
  }

async function handleSubmit(

  event: FormEvent<HTMLFormElement>,

) {

  event.preventDefault()

  const text = question.trim()

  if (!text || (activeId !== null && loadingChatIds.includes(activeId))) return

  if (!studentId) {

    setError('Student information is not ready. Please try again.')

    return

  }

  const attachmentToSend = pendingAttachment
  setPendingAttachment(null)
  setQuestion('')
  setError('')

  let chatId = activeId

  try {

    // Create a database chat if this is a new conversation.

    if (!chatId) {

      const created = await createChat({

        student_id: studentId,

        title: text.slice(0, 60) || 'New chat',

      })

      chatId = String(created.chat.id)

      setActiveId(chatId)
      setLoadingChatIds(previous => previous.includes(chatId!) ? previous : [...previous, chatId!])

      // Add the new chat and the user's question exactly once.

      setChats((previous) => [

        {

          id: chatId!,

          title: created.chat.title,

          messages: [{ role: 'user', content: text, attachment: attachmentToSend ?? undefined }],

          updatedAt: 'Just now',

        },

        ...previous,

      ])

    } else {
      setLoadingChatIds(previous => previous.includes(chatId!) ? previous : [...previous, chatId!])

      // Show the user's question immediately in an existing chat.

      setChats((previous) =>

        previous.map((chat) =>

          chat.id === chatId

            ? {

                ...chat,

                messages: [

                  ...chat.messages,

                  { role: 'user', content: text, attachment: attachmentToSend ?? undefined },

                ],

                updatedAt: 'Just now',

              }

            : chat,

        ),

      )

    }

    // Ask Groq for the answer.

    const answerResponse = await askAITutor({

  question: text,

  chat_id: Number(chatId),

  student_id: studentId,

})

    const answer = answerResponse.answer

    // Save the question and answer to PostgreSQL.

    await saveChatExchange(Number(chatId), {

      student_id: studentId,

      question: text,
      answer,
      attachment: attachmentToSend,
    })

    // Add only the assistant's answer; do not add the question again.

    setChats((previous) =>

      previous.map((chat) =>

        chat.id === chatId

          ? {

              ...chat,

              messages: [

                ...chat.messages,

                { role: 'assistant', content: answer },

              ],

              updatedAt: 'Just now',

            }

          : chat,

      ),

    )

  } catch (err) {

    setError(

      err instanceof Error

        ? err.message

        : 'Could not get an answer or save this conversation.',

    )

  } finally {
    if (chatId) setLoadingChatIds(previous => previous.filter(id => id !== chatId))
  }

}

  async function deleteChat(id: string) {

    if (!studentId) return

    try {

      await deleteChatApi(Number(id), studentId)

      setChats((previous) =>

        previous.filter((chat) => chat.id !== id),

      )

      if (activeId === id) {

        setActiveId(null)

        setQuestion('')

      }

      setError('')

    } catch (err) {

      setError(

        err instanceof Error

          ? err.message

          : 'Could not delete this conversation.',

      )

    }

  }

  return (

    <div className="flex min-h-[75vh] overflow-hidden rounded-2xl border border-slate-200 bg-white">

      {sidebarOpen && (

        <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50 max-sm:w-48">

          <div className="flex items-center justify-between border-b border-slate-200 p-3">

            <span className="text-sm font-semibold">

              Your conversations

            </span>

            <button

              onClick={() => setSidebarOpen(false)}

              aria-label="Close sidebar"

              className="rounded-lg p-2 text-slate-500 hover:bg-slate-200"

            >

              <SidebarClose size={17} />

            </button>

          </div>

          <button

            onClick={startNewChat}

            className="mx-3 mt-3 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"

          >

            <MessageSquarePlus size={17} />

            New chat

          </button>

          <p className="px-4 pb-2 pt-5 text-xs font-medium uppercase tracking-wide text-slate-400">

            Recent chats

          </p>

          <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">

            {chats.length === 0 && (

              <p className="px-2 py-3 text-xs leading-5 text-slate-400">

                Your conversations will appear here.

              </p>

            )}

            {chats.map((chat) => (

              <div

                key={chat.id}

                className={`group flex items-center gap-1 rounded-lg ${

                  activeId === chat.id

                    ? 'bg-indigo-100'

                    : 'hover:bg-slate-200'

                }`}

              >

                <button

                  onClick={() => void openChat(chat.id)}

                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-3 text-left text-sm"

                >

                  <MessageSquare

                    size={16}

                    className="shrink-0 text-slate-500"

                  />

                  <span className="truncate">{chat.title}</span>

                </button>

                <button

                  onClick={() => void deleteChat(chat.id)}

                  aria-label={`Delete ${chat.title}`}

                  className="mr-1 rounded p-1.5 text-slate-400 opacity-0 hover:text-red-600 group-hover:opacity-100"

                >

                  <Trash2 size={14} />

                </button>

              </div>

            ))}

          </div>

          <button

            onClick={onBack}

            className="flex items-center gap-2 border-t border-slate-200 p-4 text-sm text-slate-600 hover:text-indigo-600"

          >

            <ArrowLeft size={16} />

            Back to Dashboard

          </button>

        </aside>

      )}

      <section className="flex min-w-0 flex-1 flex-col">

        <header className="flex items-center gap-3 border-b border-slate-200 p-4">

          {!sidebarOpen && (

            <button

              onClick={() => setSidebarOpen(true)}

              aria-label="Open sidebar"

              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"

            >

              <SidebarOpen size={19} />

            </button>

          )}

          <div className="rounded-xl bg-indigo-600 p-2.5 text-white">

            <BrainCircuit size={22} />

          </div>

          <div className="min-w-0 flex-1">

            <h1 className="font-semibold text-slate-900">

              AI Tutor

            </h1>

            <p className="text-xs text-slate-500">

              Your personal learning assistant

            </p>

          </div>

          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs text-emerald-700">

            Study mode

          </span>

        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">

{messages.length === 0 ? (

            <div className="mx-auto max-w-xl py-8">

              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700">

                <BrainCircuit size={30} />

              </div>

              <h2 className="mt-4 text-center text-xl font-bold">

                What would you like to learn?

              </h2>

              <p className="mt-2 text-center text-sm leading-6 text-slate-500">

                Ask a question, explore a concept, or learn from

                your study materials.

              </p>

              <div className="mt-7 grid gap-3 sm:grid-cols-2">

                {suggestions.map(({ label, icon: Icon }) => (

                  <button

                    key={label}

                    onClick={() =>

                      setQuestion(

                        label === 'Ask questions about my PDF'

                          ? 'I want to ask questions about my study PDF.'

                          : label ===

                              'Give me a step-by-step solution'

                            ? 'Please explain a problem step by step.'

                            : label ===

                                'Help me understand a question'

                              ? 'Help me understand a question and why the answer is correct.'

                              : 'Explain a concept in simple words with an example.',

                      )

                    }

                    className="flex min-h-20 items-start gap-3 rounded-xl border border-slate-200 p-4 text-left text-sm hover:border-indigo-300 hover:bg-indigo-50"

                  >

                    <Icon

                      size={19}

                      className="mt-0.5 shrink-0 text-indigo-600"

                    />

                    <span>{label}</span>

                  </button>

                ))}

              </div>

            </div>

          ) : (

            <div className="mx-auto max-w-3xl space-y-5">

              {messages.map((message, index) => (

                <div

                  key={`${activeId}-${index}`}

                  className={`flex gap-3 ${

                    message.role === 'user'

                      ? 'justify-end'

                      : 'justify-start'

                  }`}

                >

                  {message.role === 'assistant' && (

                    <div className="h-fit rounded-lg bg-indigo-100 p-2 text-indigo-700">

                      <BrainCircuit size={18} />

                    </div>

                  )}

<div className="max-w-[85%] space-y-2">

  {message.attachment && (

    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-800 shadow-sm">

      <FileText size={24} className="shrink-0 text-red-500" />

      <div className="min-w-0">

        <p className="truncate text-sm font-medium">

          {message.attachment.name}

        </p>

        <p className="text-xs text-slate-500">

          PDF · {message.attachment.pages} pages

        </p>

      </div>

    </div>

  )}

  {message.content && (
  <div
    className={`rounded-2xl p-4 text-sm leading-7 ${
      message.role === 'user'
        ? 'whitespace-pre-wrap bg-indigo-600 text-white'
        : 'border border-slate-200 bg-slate-50 text-slate-800'
    }`}
  >
    {message.role === 'assistant' ? (
      <div className="break-words [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:font-semibold [&_p]:mb-3 [&_p:last-child]:mb-0 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_strong]:font-semibold [&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 [&_hr]:my-4 [&_hr]:border-slate-200 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:p-2 [&_td]:border [&_td]:border-slate-300 [&_td]:p-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-slate-900 [&_pre]:p-3 [&_pre]:text-slate-100 [&_code]:rounded [&_code]:bg-slate-200 [&_code]:px-1 [&_code]:py-0.5">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {message.content}
        </ReactMarkdown>
      </div>
    ) : (
      message.content
    )}
  </div>
)}

</div>

                  {message.role === 'user' && (

                    <div className="h-fit rounded-lg bg-slate-100 p-2 text-slate-600">

                      <User size={18} />

                    </div>

                  )}

                </div>

              ))}

              {isActiveChatLoading && (

                <p className="text-sm text-slate-500">

                  Your tutor is thinking…

                </p>

              )}

            </div>

          )}

          {error && (

            <p role="alert" className="mt-4 text-sm text-red-600">

              {error}

            </p>

          )}

        </div>

        <form

          onSubmit={handleSubmit}

          className="border-t border-slate-200 p-4 sm:p-5"

        >

          <div className="mx-auto max-w-3xl rounded-xl border border-slate-300 p-3 focus-within:border-indigo-400">
            {pendingAttachment && (
              <div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <FileText size={24} className="shrink-0 text-red-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{pendingAttachment.name}</p>
                  <p className="text-xs text-slate-500">PDF · {pendingAttachment.pages} pages</p>
                </div>
                <button type="button" onClick={() => setPendingAttachment(null)} className="text-xs text-slate-500 hover:text-red-600" aria-label="Remove attachment">Remove</button>
              </div>
            )}

            <textarea

              value={question}

              onChange={(event) => setQuestion(event.target.value)}

              onKeyDown={(event) => {

                if (

                  event.key === 'Enter' &&

                  !event.shiftKey

                ) {

                  event.preventDefault()

                  event.currentTarget.form?.requestSubmit()

                }

              }}

              placeholder="Ask your tutor a question..."

              rows={2}

              maxLength={4000}

              disabled={isActiveChatLoading}

              className="w-full resize-y bg-transparent text-sm outline-none"

            />

            <div className="mt-2 flex items-center justify-between">

<button

  type="button"

  onClick={() => attachInputRef.current?.click()}

  disabled={documentBusy}

  className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-indigo-600 disabled:opacity-50"

>

  <Paperclip size={16} />

  Attach PDF

</button>

<input

  ref={attachInputRef}

  type="file"

  accept=".pdf,application/pdf"

  className="hidden"

  disabled={documentBusy}

  onChange={(event) => {

    const file = event.currentTarget.files?.[0]

    if (file) {

      void handleDocumentUpload(file)

    }

    event.currentTarget.value = ''

  }}

/>

              <button

                type="submit"

                disabled={isActiveChatLoading || !question.trim()}

                aria-label="Send message"

                className="rounded-lg bg-indigo-600 p-2.5 text-white hover:bg-indigo-700 disabled:opacity-50"

              >

                <Send size={18} />

              </button>

            </div>

          </div>

          <p className="mt-2 text-center text-xs text-slate-400">

            Enter to send · Shift + Enter for a new line

          </p>

        </form>

      </section>

    </div>

  )

}
