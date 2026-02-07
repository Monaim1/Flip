"use client"

import { useState, useRef } from "react"
import { ChatInput } from "@/components/chat/chat-input"
import { ChatMessage } from "@/components/chat/chat-message"
import { SuggestedPrompts } from "@/components/chat/suggested-prompts"
import type { Message, ChaosState, AgentStep } from "@/lib/types"
import { validateAPIResponse } from "@/lib/validate"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

const DEFAULT_CHAOS: ChaosState = {
    rotation: 0,
    fontFamily: "Inter",
    animation: null,
    theme: "professional",
}

export function GenUIChat() {
    const [messages, setMessages] = useState<Message[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [currentChaos, setCurrentChaos] = useState<ChaosState>(DEFAULT_CHAOS)
    const [streamingContent, setStreamingContent] = useState("")
    const [streamingSteps, setStreamingSteps] = useState<AgentStep[]>([])
    const abortRef = useRef<AbortController | null>(null)

    const handleSubmit = async (query: string) => {
        const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            content: query,
        }
        setMessages((prev) => [...prev, userMessage])
        setIsLoading(true)
        setStreamingSteps([])
        setStreamingContent("")

        abortRef.current = new AbortController()

        let gotResult = false
        let didFallback = false

        try {
            const response = await fetch(`${API_URL}/api/query/stream`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                },
                body: JSON.stringify({ message: query, currentChaos }),
                signal: abortRef.current.signal,
            })

            if (!response.ok || !response.body) {
                throw new Error("Failed to connect to stream")
            }

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ""
            let currentEvent = ""
            let dataLines: string[] = []

            const dispatchEvent = () => {
                if (!currentEvent || dataLines.length === 0) {
                    currentEvent = ""
                    dataLines = []
                    return
                }
                const dataStr = dataLines.join("\n")
                try {
                    const data = JSON.parse(dataStr)
                    handleSSEEvent(currentEvent, data, query)
                    if (currentEvent === "result") {
                        gotResult = true
                    }
                } catch {
                    // skip malformed JSON
                }
                currentEvent = ""
                dataLines = []
            }

            while (true) {
                const { done, value } = await reader.read()
                if (done) {
                    break
                }

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split("\n")
                buffer = lines.pop() || ""

                for (const rawLine of lines) {
                    const line = rawLine.replace(/\r$/, "")
                    if (line === "") {
                        dispatchEvent()
                        continue
                    }
                    if (line.startsWith("event:")) {
                        currentEvent = line.slice(6).trim()
                    } else if (line.startsWith("data:")) {
                        dataLines.push(line.slice(5).trimStart())
                    }
                }
            }

            if (buffer) {
                const line = buffer.replace(/\r$/, "")
                if (line === "") {
                    dispatchEvent()
                } else if (line.startsWith("event:")) {
                    currentEvent = line.slice(6).trim()
                } else if (line.startsWith("data:")) {
                    dataLines.push(line.slice(5).trimStart())
                }
            }
            dispatchEvent()

            if (!gotResult) {
                didFallback = true
                await handleFallback(query)
            }
        } catch (error) {
            if ((error as Error).name === "AbortError") return
            console.error("Stream error:", error)
            // Fallback to non-streaming endpoint
            if (!didFallback) {
                await handleFallback(query)
            }
        } finally {
            setIsLoading(false)
            setStreamingSteps([])
            setStreamingContent("")
            abortRef.current = null
        }
    }

    const handleSSEEvent = (event: string, data: any, _query: string) => {
        if (event === "step") {
            setStreamingSteps((prev) => [...prev, data as AgentStep])
        } else if (event === "content") {
            setStreamingContent((prev) => prev + (data.delta || ""))
        } else if (event === "result") {
            const { response: validated, errors } = validateAPIResponse(data)

            if (!validated) {
                const errorMessage: Message = {
                    id: (Date.now() + 1).toString(),
                    role: "assistant",
                    content: `The server returned an unexpected response.\n${errors.map((e: string) => `• ${e}`).join("\n")}`,
                }
                setMessages((prev) => [...prev, errorMessage])
                return
            }

            if (validated.dashboardSpec?.chaos) {
                setCurrentChaos((prev) => ({ ...prev, ...validated.dashboardSpec!.chaos }))
            }

            setMessages((prev) => {
                return [
                    ...prev,
                    {
                        id: (Date.now() + 1).toString(),
                        role: "assistant" as const,
                        content: validated.assistantMessage,
                        dashboardSpec: validated.dashboardSpec,
                        suggestedPrompts: validated.suggestedPrompts,
                    },
                ]
            })
        } else if (event === "error") {
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: `Agent error: ${data.detail || "Unknown error"}`,
            }
            setMessages((prev) => [...prev, errorMessage])
        }
    }

    /** Fallback to non-streaming POST /api/query */
    const handleFallback = async (query: string) => {
        try {
            const response = await fetch(`${API_URL}/api/query`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: query, currentChaos }),
            })

            if (!response.ok) throw new Error("Fallback fetch failed")

            const data = await response.json()
            const { response: validated, errors } = validateAPIResponse(data)

            if (!validated) {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: (Date.now() + 1).toString(),
                        role: "assistant",
                        content: `The server returned an unexpected response.\n${errors.map((e: string) => `• ${e}`).join("\n")}`,
                    },
                ])
                return
            }

            if (validated.dashboardSpec?.chaos) {
                setCurrentChaos((prev) => ({ ...prev, ...validated.dashboardSpec!.chaos }))
            }

            setMessages((prev) => [
                ...prev,
                {
                    id: (Date.now() + 1).toString(),
                    role: "assistant",
                    content: validated.assistantMessage,
                    dashboardSpec: validated.dashboardSpec,
                    suggestedPrompts: validated.suggestedPrompts,
                },
            ])
        } catch (error) {
            console.error("Fallback error:", error)
            setMessages((prev) => [
                ...prev,
                {
                    id: (Date.now() + 1).toString(),
                    role: "assistant",
                    content: "I'm sorry, I encountered an error while processing your request. Please ensure the backend server is running.",
                },
            ])
        }
    }

    const handleClearChat = () => {
        if (abortRef.current) abortRef.current.abort()
        setMessages([])
        setCurrentChaos(DEFAULT_CHAOS)
        setStreamingSteps([])
    }

    return (
        <div className="min-h-screen bg-canvas">
            <div className="mx-auto max-w-6xl px-6 py-8">
                {/* Header */}
                <header className="mb-12 flex items-start justify-between">
                    <div>
                        <h1 className="font-serif text-3xl font-medium tracking-tight text-accent italic">FinanceFlip Dashboard</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Ask financial questions in natural language. Powered by DuckDB and Gemini.
                        </p>
                    </div>
                    <button
                        onClick={handleClearChat}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground underline"
                    >
                        Reset Dashboard
                    </button>
                </header>

                {/* Messages */}
                <div className="space-y-12">
                    {messages.map((message) => (
                        <ChatMessage key={message.id} message={message} />
                    ))}

                    {/* Streaming progress indicator */}
                    {isLoading && (
                        <div className="space-y-6">
                            {streamingContent && (
                                <div className="text-sm text-foreground/90 whitespace-pre-wrap animate-in fade-in slide-in-from-bottom-2">
                                    {streamingContent}
                                </div>
                            )}

                            {streamingSteps.length > 0 ? (
                                <div className="space-y-1.5 border-l-2 border-muted pl-4">
                                    {streamingSteps.map((step, i) => (
                                        <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <div className="h-1 w-1 rounded-full bg-blue-400" />
                                            {step.type === "tool_call" ? (
                                                <span>
                                                    Querying <span className="font-mono text-blue-600">{step.tool}</span>...
                                                </span>
                                            ) : (
                                                <span>
                                                    Got results from <span className="font-mono text-green-600">{step.tool}</span>
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <div className="h-1 w-1 animate-pulse rounded-full bg-accent" />
                                        <span className="font-serif italic text-blue-600">Thinking...</span>
                                    </div>
                                </div>
                            ) : (
                                !streamingContent && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                                        <span className="font-serif italic text-blue-600">Generating your dashboard...</span>
                                    </div>
                                )
                            )}
                        </div>
                    )}
                </div>

                {/* Suggested prompts */}
                {messages.length > 0 &&
                    messages[messages.length - 1].role === "assistant" &&
                    messages[messages.length - 1].suggestedPrompts && (
                        <SuggestedPrompts prompts={messages[messages.length - 1].suggestedPrompts!} onSelect={handleSubmit} />
                    )}

                {/* Input */}
                <div className="sticky bottom-6 mt-12">
                    <ChatInput onSubmit={handleSubmit} isLoading={isLoading} />
                </div>
            </div>
        </div>
    )
}
