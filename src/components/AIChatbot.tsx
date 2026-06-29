import React, { useState, useEffect, useRef } from "react";
import { useTable } from "../utils/storage";
import type { User as DbUser, UnitSettings } from "../types";
import { Button, Input, Card, CardHeader, CardTitle, CardBody, Label } from "./ui";
import { formatDateShort, formatTime12h } from "../utils/date";

interface AIChatbotProps {
  user: DbUser;
  unit: UnitSettings;
}

interface Message {
  role: "user" | "model";
  text: string;
}

export function AIChatbot({ user, unit }: AIChatbotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = sessionStorage.getItem("liahona_ai_chat_v1");
    return saved ? JSON.parse(saved) : [];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tempKey, setTempKey] = useState(() => {
    return sessionStorage.getItem("liahona_ai_temp_key") || "";
  });

  const { data: members = [] } = useTable("MEMBERS");
  const { data: planners = [] } = useTable("PLANNERS");
  const { data: assignments = [] } = useTable("ASSIGNMENTS");

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sync messages to sessionStorage
  useEffect(() => {
    sessionStorage.setItem("liahona_ai_chat_v1", JSON.stringify(messages));
  }, [messages]);

  // Sync temp key to sessionStorage
  useEffect(() => {
    sessionStorage.setItem("liahona_ai_temp_key", tempKey);
  }, [tempKey]);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  const activeApiKey = unit.prefs?.gemini_api_key || tempKey;

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    if (!activeApiKey) {
      alert("Please provide a Gemini API Key either in Settings or in the chat panel input.");
      return;
    }

    const newMessages: Message[] = [...messages, { role: "user", text }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      // Build grounding system instructions
      const membersText = members
        .filter((m) => m.active !== false)
        .map((m) => `${m.name} (${m.gender === "M" ? "Male" : "Female"})`)
        .join(", ");

      const plannersText = planners
        .map((p) => {
          const weeksStr = p.weeks
            .map((w, wIdx) => {
              const spks = (w.speakers || []).map((s) => `${s.name} ("${s.topic || 'No topic'}"${s.reference ? `, Ref: ${s.reference}` : ''})`).join(" & ");
              return `Week ${wIdx + 1} (${formatDateShort(w.date)}): Conducting: ${w.conducting_officer || '—'}, Speakers: ${spks || 'None'}`;
            })
            .join("; ");
          return `${p.month}/${p.year} (${p.state}): [${weeksStr}]`;
        })
        .join(" | ");

      const systemInstructionText = 
        `You are "Liahona AI", a helpful, professional assistant for the Sacrament Meeting Planner platform.\n` +
        `You assist the ward/branch bishoprics, clerks, and secretaries coordinate programs, draft agendas, and suggest scriptures or talk ideas.\n` +
        `Here is the live data/context for this congregation (unit):\n` +
        `- Unit Name: ${unit.unit_name || 'Ward'}\n` +
        `- Meeting Venue: ${unit.venue || 'Chapel'}\n` +
        `- Meeting Start Time: ${formatTime12h(unit.meeting_time) || '—'}\n` +
        `- Members list: ${membersText || 'No members registered yet'}\n` +
        `- Active Planners & Speakers: ${plannersText || 'No planners created yet'}\n` +
        `Be extremely concise, warm, spiritually uplifting, and highly structured in your suggestions.\n` +
        `Keep outputs formatted clearly with bullet points. Always stay aligned with the guidelines of The Church of Jesus Christ of Latter-day Saints.\n` +
        `Only suggest members listed above when recommending speakers or prayers.`;

      // Map conversation history to Gemini API format
      const contents = newMessages.map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      }));

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${activeApiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents,
            systemInstruction: {
              parts: [{ text: systemInstructionText }],
            },
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || "Failed to fetch AI response");
      }

      const resJson = await response.json();
      const aiText = resJson.candidates?.[0]?.content?.parts?.[0]?.text || "No response text received.";
      
      setMessages([...newMessages, { role: "model", text: aiText }]);
    } catch (err: any) {
      console.error("[Liahona AI] Error:", err);
      setMessages([...newMessages, { role: "model", text: `⚠️ Error: ${err.message || "An unexpected error occurred."}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    if (window.confirm("Clear current conversation history?")) {
      setMessages([]);
      sessionStorage.removeItem("liahona_ai_chat_v1");
    }
  };

  return (
    <div className="no-print fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* ── Chat Window Card ── */}
      {isOpen && (
        <Card
          className="mb-3 w-[360px] sm:w-[400px] h-[550px] shadow-2xl flex flex-col border border-slate-100 animate-in fade-in slide-in-from-bottom-5 duration-200"
          style={{
            background: "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(16px)",
            borderRadius: "20px",
          }}
        >
          {/* Header */}
          <CardHeader
            className="flex flex-row items-center justify-between p-4 border-b border-slate-100 shrink-0"
            style={{
              background: "linear-gradient(135deg, #003459, #001f35)",
              borderTopLeftRadius: "19px",
              borderTopRightRadius: "19px",
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">✨</span>
              <div>
                <CardTitle className="text-sm font-bold text-white">Liahona AI Assistant</CardTitle>
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[10px] text-white/60 font-medium">Session Active (Temporary History)</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {messages.length > 0 && (
                <button
                  onClick={handleReset}
                  className="p-1 text-white/60 hover:text-white hover:bg-white/10 rounded transition text-xs"
                  title="Clear conversation history"
                >
                  🧹 Clear
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 text-white/65 hover:text-white hover:bg-white/10 rounded transition"
                title="Close chat"
              >
                ✕
              </button>
            </div>
          </CardHeader>

          {/* Messages Body */}
          <CardBody className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {/* Warning Banner if API Key is missing */}
            {!activeApiKey && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800 space-y-2">
                <div className="font-semibold text-[11px]">🔑 Gemini API Key Required</div>
                <div className="text-[10px] leading-normal">
                  Provide your Gemini API key below to enable this chatbot. The key is kept temporarily in memory until you close the tab.
                </div>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="AIzaSy..."
                    value={tempKey}
                    onChange={(e) => setTempKey(e.target.value)}
                    className="h-8 text-[11px] bg-white border-amber-300"
                  />
                </div>
              </div>
            )}

            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-3">
                <span className="text-3xl">✨</span>
                <div className="font-semibold text-slate-600 text-sm">Welcome to Liahona AI</div>
                <p className="text-[11px] leading-relaxed max-w-[260px]">
                  Ask me to draft speakers list, suggest topic scripts, outline talks, or answer handbook rules.
                </p>
                {activeApiKey && (
                  <div className="flex flex-wrap gap-2 justify-center pt-2">
                    <button
                      onClick={() => setInput("Suggest 3 speakers from our members list")}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition text-[10px] font-medium text-slate-600"
                    >
                      🗣️ Suggest Speakers
                    </button>
                    <button
                      onClick={() => setInput("Suggest Easter hymns and talk topics")}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition text-[10px] font-medium text-slate-600"
                    >
                      🎶 Theme Ideas
                    </button>
                  </div>
                )}
              </div>
            ) : (
              messages.map((m, idx) => (
                <div key={idx} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`rounded-2xl px-3 py-2.5 max-w-[85%] leading-relaxed ${
                      m.role === "user"
                        ? "bg-blue-600 text-white rounded-tr-none font-medium"
                        : "bg-slate-100 text-slate-800 rounded-tl-none border border-slate-200/50"
                    }`}
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    {m.text}
                  </div>
                </div>
              ))
            )}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 text-slate-500 rounded-2xl rounded-tl-none px-4 py-3 border border-slate-200/50 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </CardBody>

          {/* Footer Input */}
          <div className="p-3 border-t border-slate-100 shrink-0 bg-slate-50/50 flex gap-2 items-center">
            <textarea
              placeholder={activeApiKey ? "Ask Liahona..." : "Please configure API Key..."}
              disabled={!activeApiKey || loading}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none resize-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 max-h-20"
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || !activeApiKey || loading}
              className="h-9 px-3.5 rounded-xl shrink-0"
            >
              Send
            </Button>
          </div>
        </Card>
      )}

      {/* ── Toggle Button ── */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-xl hover:scale-105 active:scale-95 transition-all duration-150"
        style={{
          background: "linear-gradient(135deg, #00c6fb, #005bea)",
        }}
        title="Liahona AI Chatbot"
      >
        {isOpen ? (
          <span className="text-xl font-bold">✕</span>
        ) : (
          <span className="text-2xl">✨</span>
        )}
      </button>
    </div>
  );
}
