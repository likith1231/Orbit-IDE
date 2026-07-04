const fs = require('fs');
let code = fs.readFileSync('src/IDE.tsx', 'utf8');

// State insertions
const stateVars = `
  const [chatSessions, setChatSessions] = useState<{ id: string, name: string }[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editSessionName, setEditSessionName] = useState('');
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
`;

code = code.replace("  const [aiTab, setAiTab] = useState<'chat' | 'history'>('chat');", stateVars + "  const [aiTab, setAiTab] = useState<'chat' | 'history'>('chat');");

// Functions
const chatFunctions = `
  const loadChatSessions = useCallback(async () => {
    if (!project) return;
    try {
      const res = await fetch(\`http://localhost:5000/api/projects/\${project.id}/chats\`, { headers: authHeader() });
      if (res.ok) {
        const data = await res.json();
        setChatSessions(data.sessions);
      }
    } catch (e) { console.error('Failed to load chat sessions', e); }
  }, [project]);

  const loadChatMessages = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    try {
      const res = await fetch(\`http://localhost:5000/api/chats/\${sessionId}/messages\`, { headers: authHeader() });
      if (res.ok) {
        const data = await res.json();
        const msgs = data.messages.map((m: any) => ({ role: m.role, content: m.content }));
        setChatMessages(msgs.length ? msgs : [{ role: 'assistant', content: "I'm your AI coding agent.\\n\\nTry:\\n• \\"create a REST API with auth\\"\\n• \\"fix the errors in this file\\"\\n• \\"run this file\\"\\n• \\"explain this code\\"\\n\\nI can create entire multi-file projects in one shot." }]);
      }
    } catch (e) { console.error('Failed to load messages', e); }
  }, []);

  const createNewChat = async () => {
    if (!project) return;
    try {
      const res = await fetch(\`http://localhost:5000/api/projects/\${project.id}/chats\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ name: 'New Chat' })
      });
      if (res.ok) {
        const data = await res.json();
        setChatSessions(prev => [data.session, ...prev]);
        setActiveSessionId(data.session.id);
        setChatMessages([{ role: 'assistant', content: "I'm your AI coding agent.\\n\\nTry:\\n• \\"create a REST API with auth\\"\\n• \\"fix the errors in this file\\"\\n• \\"run this file\\"\\n• \\"explain this code\\"\\n\\nI can create entire multi-file projects in one shot." }]);
      }
    } catch (e) { console.error(e); }
  };

  const deleteChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(\`http://localhost:5000/api/chats/\${id}\`, { method: 'DELETE', headers: authHeader() });
      if (res.ok) {
        setChatSessions(prev => prev.filter(s => s.id !== id));
        if (activeSessionId === id) {
          setActiveSessionId(null);
          setChatMessages([{ role: 'assistant', content: "I'm your AI coding agent.\\n\\nTry:\\n• \\"create a REST API with auth\\"\\n• \\"fix the errors in this file\\"\\n• \\"run this file\\"\\n• \\"explain this code\\"\\n\\nI can create entire multi-file projects in one shot." }]);
        }
      }
    } catch (err) { console.error(err); }
  };

  const renameChat = async (id: string, newName: string) => {
    try {
      const res = await fetch(\`http://localhost:5000/api/chats/\${id}\`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ name: newName })
      });
      if (res.ok) {
        setChatSessions(prev => prev.map(s => s.id === id ? { ...s, name: newName } : s));
      }
    } catch (err) { console.error(err); }
    setEditingSessionId(null);
  };

  useEffect(() => {
    if (project) {
      loadChatSessions();
    }
  }, [project, loadChatSessions]);

  useEffect(() => {
    if (activeSessionId) {
      loadChatMessages(activeSessionId);
    }
  }, [activeSessionId, loadChatMessages]);

`;

code = code.replace("  const sendChatMessage = async () => {", chatFunctions + "  const sendChatMessage = async () => {");

// Modify sendChatMessage
const originalSendChat = `  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userText = chatInput;
    const nextMessages = [...chatMessages, { role: 'user', content: userText }];
    setChatMessages(nextMessages as any); setChatInput(''); setChatLoading(true);
    const fileTree = allFiles.map(f => ({ name: f.name, path: f.path, isFolder: f.isFolder }));
    const activeFileData = openFiles[activeFile];
    try {
      const res = await fetch('http://localhost:5000/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, fileTree, activeFile: activeFileData ? { name: activeFileData.name, path: activeFileData.path, content: activeFileData.value } : null }),
      });`;

const newSendChat = `  const saveMessageToDb = async (sessionId: string, role: string, content: string) => {
    try {
      await fetch(\`http://localhost:5000/api/chats/\${sessionId}/messages\`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ role, content })
      });
    } catch(e) {}
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    
    // Auto-create session if none exists
    let currentSessionId = activeSessionId;
    if (!currentSessionId && project) {
      try {
        const res = await fetch(\`http://localhost:5000/api/projects/\${project.id}/chats\`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ name: chatInput.slice(0, 30) + (chatInput.length > 30 ? '...' : '') })
        });
        if (res.ok) {
          const data = await res.json();
          currentSessionId = data.session.id;
          setActiveSessionId(currentSessionId);
          setChatSessions(prev => [data.session, ...prev]);
        }
      } catch(e) {}
    }

    const userText = chatInput;
    if (currentSessionId) saveMessageToDb(currentSessionId, 'user', userText);

    const nextMessages = [...chatMessages, { role: 'user', content: userText }];
    setChatMessages(nextMessages as any); setChatInput(''); setChatLoading(true);
    
    abortControllerRef.current = new AbortController();

    const fileTree = allFiles.map(f => ({ name: f.name, path: f.path, isFolder: f.isFolder }));
    const activeFileData = activeFile ? openFiles[activeFile] : null;
    try {
      const res = await fetch('http://localhost:5000/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({ messages: nextMessages, fileTree, activeFile: activeFileData ? { name: activeFileData.name, path: activeFileData.path, content: activeFileData.value } : null }),
      });`;

code = code.replace(originalSendChat, newSendChat);

// Modify finally block to save AI response
const finallyBlock = `      } else {
        setChatMessages(m => [...m, { role: 'assistant', content: data.reply || data.error || 'No response.' }]);
      }
    } catch {
      setChatMessages(m => [...m, { role: 'assistant', content: '⚠ Could not reach the AI backend.' }]);
    } finally { setChatLoading(false); }
  };`;

const newFinallyBlock = `      } else {
        const aiMsg = data.reply || data.error || 'No response.';
        setChatMessages(m => [...m, { role: 'assistant', content: aiMsg }]);
        if (currentSessionId) saveMessageToDb(currentSessionId, 'assistant', aiMsg);
      }
    } catch(e: any) {
      if (e.name === 'AbortError') {
        setChatMessages(m => [...m, { role: 'assistant', content: '⚠ Generation stopped by user.' }]);
        if (currentSessionId) saveMessageToDb(currentSessionId, 'assistant', '⚠ Generation stopped by user.');
      } else {
        setChatMessages(m => [...m, { role: 'assistant', content: '⚠ Could not reach the AI backend.' }]);
      }
    } finally { setChatLoading(false); abortControllerRef.current = null; }
  };`;

code = code.replace(finallyBlock, newFinallyBlock);

// UI updates
const oldHeader = `              <div className="sidebar-header">
                <span className="sidebar-title-text">AI ASSISTANT</span>
                <span className="ai-badge">auto</span>
              </div>`;

const newHeader = `              <div className="sidebar-header">
                <span className="sidebar-title-text">AI ASSISTANT</span>
                <div style={{ flex: 1 }} />
                <button className="icon-btn" onClick={() => setChatSidebarOpen(!chatSidebarOpen)} title="Chat History">
                  <Menu size={14} />
                </button>
              </div>`;

code = code.replace(oldHeader, newHeader);

const oldTabs = `              <div className="ai-tabs">
                <button className={\`ai-tab \${aiTab === 'chat' ? 'active' : ''}\`} onClick={() => setAiTab('chat')}>Chat</button>
                <button className={\`ai-tab \${aiTab === 'history' ? 'active' : ''}\`} onClick={() => setAiTab('history')}>Debug History</button>
              </div>`;

const newTabs = `              <div className="ai-tabs">
                <button className={\`ai-tab \${aiTab === 'chat' ? 'active' : ''}\`} onClick={() => setAiTab('chat')}>Chat</button>
                <button className={\`ai-tab \${aiTab === 'history' ? 'active' : ''}\`} onClick={() => setAiTab('history')}>Debug History</button>
              </div>
              {chatSidebarOpen && (
                <div className="chat-history-dropdown">
                  <div className="chat-history-header">
                    <span style={{ fontSize: '11px', fontWeight: 600 }}>PAST CHATS</span>
                    <button className="icon-btn" onClick={createNewChat} title="New Chat"><Plus size={14} /></button>
                  </div>
                  <div className="chat-history-list">
                    {chatSessions.map(s => (
                      <div key={s.id} className={\`chat-session-item \${activeSessionId === s.id ? 'active' : ''}\`} onClick={() => setActiveSessionId(s.id)}>
                        {editingSessionId === s.id ? (
                          <input 
                            autoFocus
                            className="chat-rename-input"
                            value={editSessionName}
                            onChange={e => setEditSessionName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') renameChat(s.id, editSessionName);
                              if (e.key === 'Escape') setEditingSessionId(null);
                            }}
                            onBlur={() => renameChat(s.id, editSessionName)}
                          />
                        ) : (
                          <>
                            <span className="chat-session-name" title={s.name}>{s.name}</span>
                            <div className="chat-session-actions">
                              <button className="icon-btn" onClick={e => { e.stopPropagation(); setEditSessionName(s.name); setEditingSessionId(s.id); }}><Edit2 size={12} /></button>
                              <button className="icon-btn" onClick={e => deleteChat(s.id, e)}><Trash2 size={12} /></button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}`;

code = code.replace(oldTabs, newTabs);

const oldChatLoading = `{chatLoading && (<div className="chat-msg assistant"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></div>)}`;

const newChatLoading = `{chatLoading && (
  <div className="chat-msg assistant" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <div><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></div>
    <button onClick={() => abortControllerRef.current?.abort()} style={{ background: '#333', color: '#fff', border: '1px solid #555', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>
      Stop
    </button>
  </div>
)}`;

code = code.replace(oldChatLoading, newChatLoading);

// Add missing icon imports
const oldImports = `import { Folder, File, Code, Terminal as TerminalIcon, Search, Bug, Play, Settings, ChevronRight, X, ChevronDown, ChevronRight as ChevronRightIcon, Cpu, Zap, Activity, ShieldAlert, GitBranch, Github, FileText, Download, Plus, Check, Trash2, Database, RefreshCw, Send } from 'lucide-react';`;
const newImports = `import { Folder, File, Code, Terminal as TerminalIcon, Search, Bug, Play, Settings, ChevronRight, X, ChevronDown, ChevronRight as ChevronRightIcon, Cpu, Zap, Activity, ShieldAlert, GitBranch, Github, FileText, Download, Plus, Check, Trash2, Database, RefreshCw, Send, Menu, Edit2 } from 'lucide-react';`;
code = code.replace(oldImports, newImports);


fs.writeFileSync('src/IDE.tsx', code);
console.log('IDE.tsx patched');
