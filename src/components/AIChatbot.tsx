import { useState, useEffect, useRef } from "react";
import { useTable } from "../utils/storage";
import type { UnitSettings, User } from "../types";
import { Button, Input, Card, CardHeader, CardTitle, CardBody } from "./ui";
import { formatDateShort, formatTime12h } from "../utils/date";

interface AIChatbotProps {
  user: User;
  unit: UnitSettings;
}

interface Message {
  role: "user" | "model";
  text: string;
}

export function AIChatbot({ user, unit }: AIChatbotProps) {
  const chatKey = `ai_chat_${user.user_id}_v1`;
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = sessionStorage.getItem(chatKey);
    return saved ? JSON.parse(saved) : [];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const { data: members = [] } = useTable("MEMBERS");
  const { data: planners = [] } = useTable("PLANNERS");

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sync messages to sessionStorage
  useEffect(() => {
    sessionStorage.setItem(chatKey, JSON.stringify(messages));
  }, [messages, chatKey]);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  const activeApiKey = unit.prefs?.gemini_api_key || "";

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    if (!activeApiKey) {
      alert("Gemini API Key is not configured. Please set the API Key in the Settings page.");
      return;
    }

    const newMessages: Message[] = [...messages, { role: "user", text }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      // Build grounding system instructions
      const membersText = members
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
        `You are "AI Assistant", a specialized AI assistant for a local congregation (Ward or Branch) of The Church of Jesus Christ of Latter-day Saints.\n` +
        `You assist the ward/branch bishoprics, clerks, secretaries, and music coordinators in preparing Sacrament Meeting programs, drafting agendas, suggesting speakers, organizing topics, selecting hymns, and recommending scriptures.\n\n` +
        `CRITICAL LATTER-DAY SAINT BELIEFS & PRACTICES INSTRUCTIONS:\n` +
        `1. DOCTRINE & SCRIPTURES: Always base your suggestions, topics, and references on Latter-day Saint doctrine. Reference the standard works: The Bible (King James Version), The Book of Mormon, Doctrine and Covenants, and the Pearl of Great Price. When suggesting scriptures, choose meaningful, relevant verses from these standard works.\n` +
        `2. TERMINOLOGY: Use correct Church terminology. Refer to leaders as "Bishop", "Bishopric", "Branch President", "Brother", "Sister", "Elder", etc. The main worship service is called the "Sacrament Meeting" (never mass, service outline, or service sacrament). Members belong to a "Ward" or "Branch" (never parish or congregation generically). The congregation is part of a "Stake" or "District".\n` +
        `3. SACRAMENT MEETING FORMAT: The service consists of: Opening Hymn, Opening Prayer (Invocation), Ward Business/Announcements, Sacrament Hymn, Administration of the Sacrament (bread and water), Speakers (usually youth speakers speaking for 3-5 minutes, followed by adult speakers speaking for 10-15 minutes, or a Fast and Testimony Meeting where members bear testimony), Intermediate Hymn or Special Musical Number (optional), Closing Hymn, and Closing Prayer (Benediction).\n` +
        `4. HYMNS: Suggest hymns from the official Latter-day Saint Hymnbook. Hymns should be spiritually edifying, worshipful, and appropriate for sacrament meetings.\n` +
        `5. HANDBOOK ALIGNMENT: Align all guidance with the principles of the General Handbook: Serving in The Church of Jesus Christ of Latter-day Saints. Keep answers respectful, professional, and spiritually uplifting.\n\n` +
        `Here is the live data/context for this congregation (unit):\n` +
        `- Unit Name: ${unit.unit_name || 'Ward'}\n` +
        `- Meeting Venue: ${unit.venue || 'Chapel'}\n` +
        `- Meeting Start Time: ${formatTime12h(unit.meeting_time) || '—'}\n` +
        `- Members list: ${membersText || 'No members registered yet'}\n` +
        `- Active Planners & Speakers: ${plannersText || 'No planners created yet'}\n\n` +
        `OUTPUT FORMATTING GUIDELINES:\n` +
        `- Be warm, concise, respectful, and spiritually encouraging.\n` +
        `- Use clear bullet points and bold text to organize suggestions.\n` +
        `- Only suggest speakers or prayers using members from the live "Members list" provided above. Do not invent names outside this list unless the user explicitly requests a guest speaker.`;

      // Map conversation history to Gemini API format
      const contents = newMessages.map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      }));

      let response = await fetch(
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

      // Automatic fallback to highly stable production model if experimental model is overloaded
      if (response.status === 503 || response.status === 429) {
        console.warn(`[AI Assistant] gemini-2.5-flash returned status ${response.status}. Retrying with stable gemini-1.5-flash...`);
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${activeApiKey}`,
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
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || "Failed to fetch AI response");
      }

      const resJson = await response.json();
      const aiText = resJson.candidates?.[0]?.content?.parts?.[0]?.text || "No response text received.";
      
      setMessages([...newMessages, { role: "model", text: aiText }]);
    } catch (err: any) {
      console.error("[AI Assistant] Error:", err);
      setMessages([...newMessages, { role: "model", text: `⚠️ Error: ${err.message || "An unexpected error occurred."}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    if (window.confirm("Clear current conversation history?")) {
      setMessages([]);
      sessionStorage.removeItem(chatKey);
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
              <span role="img" aria-label="Sparkles" className="text-xl">✨</span>
              <div>
                <CardTitle className="text-sm font-bold text-white">AI Assistant</CardTitle>
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[10px] text-white/60 font-medium">Session Active (AI can make mistakes)</span>
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
                  <span role="img" aria-label="Broom">🧹</span> Clear
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
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-amber-800 space-y-1.5 shadow-sm">
                <div className="font-bold text-[11px] flex items-center gap-1.5">
                  <span role="img" aria-label="Warning">⚠️</span> AI Assistant Disabled
                </div>
                <div className="text-[10px] leading-relaxed text-amber-700">
                  The Gemini API Key is not configured. Please contact your administrator to set up the Gemini API Key in the platform **Settings** page.
                </div>
              </div>
            )}

            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-3">
                <span role="img" aria-label="Sparkles" className="text-3xl">✨</span>
                <div className="font-semibold text-slate-600 text-sm">Welcome to AI Assistant</div>
                <p className="text-[11px] leading-relaxed max-w-[260px]">
                  Ask me to draft speakers list, suggest topic scripts, outline talks, or answer handbook rules.
                </p>
                {activeApiKey && (
                  <div className="flex flex-wrap gap-2 justify-center pt-2">
                    <button
                      onClick={() => setInput("Suggest 3 speakers from our members list")}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition text-[10px] font-medium text-slate-600"
                    >
                      <span role="img" aria-label="Speaking head">🗣️</span> Suggest Speakers
                    </button>
                    <button
                      onClick={() => setInput("Suggest Easter hymns and talk topics")}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition text-[10px] font-medium text-slate-600"
                    >
                      <span role="img" aria-label="Musical notes">🎶</span> Theme Ideas
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
              placeholder={activeApiKey ? "Ask AI Assistant..." : "Please configure API Key..."}
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
              aria-label="Ask AI Assistant"
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
        title="AI Assistant"
      >
        {isOpen ? (
          <span className="text-xl font-bold">✕</span>
        ) : (
          <span role="img" aria-label="Sparkles" className="text-2xl">✨</span>
        )}
      </button>
    </div>
  );
}
