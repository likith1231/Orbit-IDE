import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { io } from 'socket.io-client';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Files, Search, Boxes, ChevronRight, ChevronDown, LogOut, Send, Command, Plus, FolderPlus, Trash2, Play, Pencil, Folder, FolderOpen, Zap, Bug, Minus, Settings, GitBranch, Layers, Square, RefreshCw, Database, Rocket, ExternalLink, Code, Terminal as TerminalIcon, X, ChevronRight as ChevronRightIcon, Cpu, Activity, ShieldAlert, FileText, Download, Check, Menu, Edit2, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Fuse from 'fuse.js';
import {
  SiJavascript, SiTypescript, SiReact, SiPython,
  SiC, SiCplusplus, SiGo, SiRust, SiRuby,
  SiPhp, SiGnubash, SiLua, SiR, SiMarkdown, SiJson,
  SiCss, SiHtml5
} from 'react-icons/si';
import { FaJava, FaFileAlt } from 'react-icons/fa';
import { TbBrandCSharp } from 'react-icons/tb';
import { authHeader, getUser, clearAuth } from './auth';
import '@xterm/xterm/css/xterm.css';
import './ide.css';
import { apiFetch } from './lib/apiFetch';


type ChatMessage = { role: 'user' | 'assistant'; content: string };

type FileEntry = {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  language: string;
  content: string;
};

type OpenFile = {
  name: string;
  path: string;
  language: string;
  value: string;
};

type ChaosResult = {
  scenario: string;
  output: string;
  elapsed: number;
  survived: boolean;
  killed: boolean;
};

type Project = {
  id: string;
  name: string;
  files: FileEntry[];
};

type FileTreeNode = {
  children: Record<string, FileTreeNode>;
  files: FileEntry[];
  name?: string;
  id?: string;
  fullPath?: string;
};

type Problem = {
  file: string;
  line: number;
  col: number;
  message: string;
  severity: 'error' | 'warning';
};

type SearchResult = {
  id: string;
  name: string;
  line: number;
  text: string;
};

type Command = {
  id: string;
  label: string;
  action: () => void;
};

type ChaosResponse = {
  resilienceScore: number;
  survived: number;
  total: number;
  results: ChaosResult[];
  error?: string;
};

const ICON_MAP: Record<string, React.ReactNode> = {
  js: <SiJavascript color="#F7DF1E" size={14} />,
  jsx: <SiReact color="#61DAFB" size={14} />,
  mjs: <SiJavascript color="#F7DF1E" size={14} />,
  ts: <SiTypescript color="#3178C6" size={14} />,
  tsx: <SiReact color="#61DAFB" size={14} />,
  py: <SiPython color="#3776AB" size={14} />,
  java: <FaJava color="#5382A1" size={14} />,
  c: <SiC color="#A8B9CC" size={14} />,
  h: <SiC color="#A8B9CC" size={14} />,
  cpp: <SiCplusplus color="#00599C" size={14} />,
  cc: <SiCplusplus color="#00599C" size={14} />,
  hpp: <SiCplusplus color="#00599C" size={14} />,
  cs: <TbBrandCSharp color="#239120" size={14} />,
  go: <SiGo color="#00ADD8" size={14} />,
  rs: <SiRust color="#DEA584" size={14} />,
  rb: <SiRuby color="#CC342D" size={14} />,
  php: <SiPhp color="#777BB4" size={14} />,
  sh: <SiGnubash color="#4EAA25" size={14} />,
  pl: <FaFileAlt color="#CBCB41" size={14} />,
  lua: <SiLua color="#2C2D72" size={14} />,
  r: <SiR color="#276DC3" size={14} />,
  md: <SiMarkdown color="#FFFFFF" size={14} />,
  json: <SiJson color="#CBCB41" size={14} />,
  css: <SiCss color="#1572B6" size={14} />,
  html: <SiHtml5 color="#E34F26" size={14} />,
};
function fileIcon(name = '') { return ICON_MAP[name.split('.').pop() || ''] || <FaFileAlt color="#888" size={14} />; }

const LANG_MAP = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', py: 'python', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  cs: 'csharp', go: 'go', rs: 'rust', rb: 'ruby', php: 'php',
  sh: 'bash', pl: 'perl', lua: 'lua', r: 'r',
  md: 'markdown', json: 'json', css: 'css', html: 'html',
};
function getLang(name = '') { return LANG_MAP[name.split('.').pop()] || 'plaintext'; }
const RUNNABLE_LANGS = ['javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'ruby', 'php', 'bash', 'perl', 'lua', 'r'];

const CODE_FONTS = [
  { id: 'jetbrains', label: 'JetBrains Mono', family: "'JetBrains Mono', monospace" },
  { id: 'fira', label: 'Fira Code', family: "'Fira Code', monospace" },
  { id: 'ibm', label: 'IBM Plex Mono', family: "'IBM Plex Mono', monospace" },
  { id: 'source', label: 'Source Code Pro', family: "'Source Code Pro', monospace" },
  { id: 'cascadia', label: 'Cascadia Code', family: "'Cascadia Code', 'Cascadia Mono', monospace" },
];

function buildTree(items: FileEntry[]): FileTreeNode {
  const root: FileTreeNode = { children: {}, files: [] };
  items.forEach((item) => {
    const parts = item.path ? item.path.split('/').filter(Boolean) : [];
    let node = root;
    for (const part of parts) {
      if (!node.children[part]) node.children[part] = { children: {}, files: [], name: part };
      node = node.children[part];
    }
    if (item.isFolder) {
      const fullPath = item.path ? `${item.path}/${item.name}` : item.name;
      if (!node.children[item.name]) node.children[item.name] = { children: {}, files: [], name: item.name, id: item.id, fullPath };
      else { node.children[item.name].id = item.id; node.children[item.name].fullPath = fullPath; }
    } else { node.files.push(item); }
  });
  return root;
}

type TreeNodeProps = {
  node: FileTreeNode;
  depth: number;
  openFile: (file: FileEntry) => void;
  activeFile: string | null;
  expanded: Set<string>;
  toggleExpand: (path?: string) => void;
  startRename: (key: string | null, name?: string) => void;
  deleteItem: (id: string, name: string, isFolder: boolean) => void;
  renamingFile: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  submitRename: (id: string, isFolder: boolean) => void;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
};

interface DebugHistoryEntry {
  attempt: number;
  file: string;
  error: string;
  explanation?: string;
  diff?: string;
  status: 'testing' | 'success' | 'failed';
}


function TreeNode({ node, depth, openFile, activeFile, expanded, toggleExpand, startRename, deleteItem, renamingFile, renameValue, setRenameValue, submitRename, renameInputRef }: TreeNodeProps) {
  return (
    <>
      {Object.entries(node.children || {}).map(([key, child]) => {
        const isOpen = expanded.has(child.fullPath);
        return (
          <React.Fragment key={child.fullPath || key}>
            <div className="file-row folder-item" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggleExpand(child.fullPath)}>
              {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {isOpen ? <FolderOpen size={13} color="#dcb67a" /> : <Folder size={13} color="#dcb67a" />}
              {renamingFile === `folder:${child.id}` ? (
                <input ref={renameInputRef} className="rename-input" value={renameValue} onClick={e => e.stopPropagation()}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitRename(child.id, true); if (e.key === 'Escape') startRename(null); }}
                  onBlur={() => submitRename(child.id, true)} />
              ) : (
                <>
                  <span className="file-name">{child.name}</span>
                  <button className="file-action-btn" onClick={e => { e.stopPropagation(); startRename(`folder:${child.id}`, child.name); }}><Pencil size={10} /></button>
                  <button className="file-action-btn" onClick={e => { e.stopPropagation(); deleteItem(child.id, child.name, true); }}><Trash2 size={10} /></button>
                </>
              )}
            </div>
            <div className={`tree-children ${isOpen ? 'expanded' : ''}`}>
              {isOpen && <TreeNode node={child} depth={depth + 1} openFile={openFile} activeFile={activeFile}
                expanded={expanded} toggleExpand={toggleExpand} startRename={startRename} deleteItem={deleteItem}
                renamingFile={renamingFile} renameValue={renameValue} setRenameValue={setRenameValue}
                submitRename={submitRename} renameInputRef={renameInputRef} />}
            </div>
          </React.Fragment>
        );
      })}
      {(node.files || []).map(f => (
        <div key={f.id} className={`file-row ${activeFile === f.id ? 'active' : ''}`} style={{ paddingLeft: 22 + depth * 14 }} onClick={() => openFile(f)}>
          {renamingFile === `file:${f.id}` ? (
            <input ref={renameInputRef} className="rename-input" value={renameValue} onClick={e => e.stopPropagation()}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitRename(f.id, false); if (e.key === 'Escape') startRename(null); }}
              onBlur={() => submitRename(f.id, false)} />
          ) : (
            <>
              <span className="file-icon-emoji">{fileIcon(f.name)}</span>
              <span className="file-name">{f.name}</span>
              <button className="file-action-btn" onClick={e => { e.stopPropagation(); startRename(`file:${f.id}`, f.name); }}><Pencil size={10} /></button>
              <button className="file-action-btn" onClick={e => { e.stopPropagation(); deleteItem(f.id, f.name, false); }}><Trash2 size={10} /></button>
            </>
          )}
        </div>
      ))}
    </>
  );
}

function computeDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  let diff = '';
  // Super naive line-based diff
  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      diff += `  ${oldLines[i]}\n`;
      i++; j++;
    } else {
      if (i < oldLines.length && !newLines.includes(oldLines[i])) {
        diff += `- ${oldLines[i]}\n`;
        i++;
      } else if (j < newLines.length) {
        diff += `+ ${newLines[j]}\n`;
        j++;
      } else {
        i++; j++;
      }
    }
  }
  return diff;
}

export default function IDE() {
  const navigate = useNavigate();
  const user = getUser();

  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [allFiles, setAllFiles] = useState<FileEntry[]>([]);
  const [openFiles, setOpenFiles] = useState<Record<string, OpenFile>>({});
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [lastRunFile, setLastRunFile] = useState<string | null>(null);
  const [dockerStatus, setDockerStatus] = useState<'unknown' | 'checking' | 'running' | 'idle' | 'error'>('unknown');
  const [containers, setContainers] = useState<Array<{ Id: string; Names?: string[]; State: string }>>([]);
  const [activityPanel, setActivityPanel] = useState<'explorer' | 'search' | 'source' | 'debug' | 'docker' | 'extensions' | 'settings'>('explorer');
  const [bottomTab, setBottomTab] = useState<'terminal' | 'problems' | 'output' | 'chaos'>('terminal');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [runOutput, setRunOutput] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-flash-lite-latest');
  const [isRunning, setIsRunning] = useState(false);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [deployState, setDeployState] = useState<'idle' | 'deploying' | 'deployed' | 'error'>('idle');
  const [deployUrl, setDeployUrl] = useState<string>('');
  const [deployContainerId, setDeployContainerId] = useState<string>('');
  const [previewPorts, setPreviewPorts] = useState<Record<string, string>>({});
  const [isChaosRunning, setIsChaosRunning] = useState(false);
  const [chaosResults, setChaosResults] = useState<ChaosResponse | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [newItemName, setNewItemName] = useState('');
  const [showNewItem, setShowNewItem] = useState<'file' | 'folder' | null>(null);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [isRootExpanded, setIsRootExpanded] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [fontSize, setFontSize] = useState(14);
  const [codeFont, setCodeFont] = useState(CODE_FONTS[0].family);
  const [minimapEnabled, setMinimapEnabled] = useState(true);
  const [wordWrap, setWordWrap] = useState(true);
  const [gotoLineOpen, setGotoLineOpen] = useState(false);
  const [gotoLineValue, setGotoLineValue] = useState('');
  const [containerAction, setContainerAction] = useState<string | null>(null);
  const [debugSession, setDebugSession] = useState(false);
  const [extensionStates, setExtensionStates] = useState<Record<string, boolean>>({ prettier: true, eslint: true, gitlens: false, aiAssistant: true });
  const [projectInsights, setProjectInsights] = useState({ fileCount: 0, lineCount: 0, todoCount: 0, largeFiles: [] as string[] });
  const [terminalMode, setTerminalMode] = useState<'bash' | 'zsh' | 'sh'>('bash');
  const [terminalCommand, setTerminalCommand] = useState('');
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<any>(null);
  const xtermSplitRef = useRef<Terminal | null>(null);
  const fitSplitRef = useRef<any>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<any>(null);
  const [isSplit, setIsSplit] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "I'm your AI coding agent.\n\nTry:\n• \"create a REST API with auth\"\n• \"fix the errors in this file\"\n• \"run this file\"\n• \"explain this code\"\n\nI can create entire multi-file projects in one shot." },
  ]);
  const [autoDebugEnabled, setAutoDebugEnabled] = useState(true);
  const [debugHistory, setDebugHistory] = useState<DebugHistoryEntry[]>([]);
  const [chatSessions, setChatSessions] = useState<{ id: string, name: string }[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editSessionName, setEditSessionName] = useState('');
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const [aiTab, setAiTab] = useState<'chat' | 'history'>('chat');
  const [showAIPanel, setShowAIPanel] = useState(false);
  const autoDebugAttempts = useRef(0);

  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [pendingAIAction, setPendingAIAction] = useState<{
    action: 'apply' | 'scaffold' | 'delete',
    data: any,
    summary: string,
    originalCode?: string,
  } | null>(null);


  const saveTimeout = useRef<number | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const lintTimeout = useRef<any>(null);
  const resizeRef = useRef<any>(null);
  const ydocRef = useRef<any>(null);
  const yProviderRef = useRef<any>(null);
  const yBindingRef = useRef<any>(null);

  const createTerminalInstance = useCallback((container: HTMLDivElement, connectSocket = true) => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: codeFont,
      theme: { background: '#1e1e1e', foreground: '#cccccc', cursor: '#cccccc', selectionBackground: '#264f78' },
    });
    const fit = new FitAddon();
    const webLinks = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(webLinks);
    term.open(container);
    fit.fit();
    if (connectSocket) term.onData(d => socketRef.current?.emit('terminal-input', d));
    const obs = new ResizeObserver(() => fit.fit());
    obs.observe(container);
    return { term, fit, obs };
  }, [codeFont]);

  const fetchProjects = useCallback(async () => {
    const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects`, { headers: authHeader() });
    const data = await res.json();
    setProjects(data.projects || []);
    return data.projects || [];
  }, []);

  const loadProject = useCallback(async (projectId) => {
    const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${projectId}`, { headers: authHeader() });
    const data = await res.json();
    setProject(data.project);
    setAllFiles(data.project.files);
    setOpenFiles({});
    setOpenTabs([]);
    setActiveFile(null);
    const firstFile = data.project.files.find(f => !f.isFolder);
    if (firstFile) {
      setOpenFiles({ [firstFile.id]: { name: firstFile.name, path: firstFile.path, language: getLang(firstFile.name), value: firstFile.content } });
      setOpenTabs([firstFile.id]);
      setActiveFile(firstFile.id);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--code-font', codeFont);
  }, [codeFont]);

  const bindYjs = useCallback((editor: any, monaco: any, fileId: string) => {
    if (!project) return;
    if (yBindingRef.current) yBindingRef.current.destroy();
    if (yProviderRef.current) yProviderRef.current.destroy();
    if (ydocRef.current) ydocRef.current.destroy();

    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    const roomName = `${project.id}-${fileId}`;
    const provider = new WebsocketProvider('ws://localhost:5001', roomName, ydoc);
    yProviderRef.current = provider;

    const ytext = ydoc.getText('monaco');
    const model = editor.getModel();
    if (!model) return;

    // Wait for the initial sync from the server before binding Monaco,
    // so that the editor isn't wiped by an initially empty local ytext.
    provider.on('synced', () => {
      if (!yBindingRef.current) {
        // If the server was completely empty (e.g., new file) but we have local content from Postgres,
        // hydrate the CRDT before binding to prevent wiping the editor.
        if (ytext.length === 0 && model.getValue().length > 0) {
          ytext.insert(0, model.getValue());
        }
        const binding = new MonacoBinding(ytext, model, new Set([editor]), provider.awareness);
        yBindingRef.current = binding;
      }
    });
  }, [project]);

  useEffect(() => {
    if (activeFile && activeFile !== '__preview__' && editorRef.current && monacoRef.current) {
      bindYjs(editorRef.current, monacoRef.current, activeFile);
    }
  }, [activeFile, bindYjs]);

  useEffect(() => {
    if (!terminalRef.current) return;
    socketRef.current = io(import.meta.env.VITE_API_URL || 'http://localhost:5000');

    const primary = createTerminalInstance(terminalRef.current, true);
    xtermRef.current = primary.term;
    fitRef.current = primary.fit;

    socketRef.current.on('terminal-output', d => {
      xtermRef.current?.write(d);
      xtermSplitRef.current?.write(d);
    });
    socketRef.current.on('sandbox-output', d => {
      xtermRef.current?.write(d);
    });
    socketRef.current.on('sandbox-exit', ({ code, error }) => {
      if (error) {
        xtermRef.current?.writeln(`\r\n\x1b[31m✖ Sandbox exited with error: ${error}\x1b[0m`);
      } else {
        xtermRef.current?.writeln(`\r\n\x1b[36m✔ Sandbox finished execution.\x1b[0m`);
      }
      setIsRunning(false);
      setSandboxId(null);
    });
    
    socketRef.current.on('sandbox-ports', (ports: Record<string, string>) => {
      setPreviewPorts(prev => {
        if (JSON.stringify(prev) === JSON.stringify(ports)) return prev;
        xtermRef.current?.writeln(`\r\n\x1b[35m► App listening on mapped ports: ${JSON.stringify(ports)}\x1b[0m`);
        Object.values(ports).forEach((port: any) => {
          xtermRef.current?.writeln(`\x1b[34m► Preview: http://localhost:${port}\x1b[0m`);
        });
        setOpenTabs(t => t.includes('__preview__') ? t : [...t, '__preview__']);
        return ports;
      });
    });

    socketRef.current.on('terminal-ready', ({ shell }) => {
      xtermRef.current?.writeln(`\r\n\x1b[36mConnected to ${shell} shell.\x1b[0m`);
    });
    socketRef.current.on('connect', () => setDockerStatus('checking'));

    xtermRef.current?.writeln('\r\n\x1b[32muser@ai-cloud-ide:~$ \x1b[0m');
    xtermRef.current?.writeln('\x1b[36mTip: press Ctrl+` to open the terminal.\x1b[0m');

    return () => {
      primary?.obs.disconnect();
      socketRef.current?.disconnect();
      primary?.term.dispose();
      xtermSplitRef.current?.dispose();
    };
  }, [createTerminalInstance]);

  // Ensure terminal is resized when tab is opened
  useEffect(() => {
    if (bottomTab === 'terminal') {
      setTimeout(() => {
        fitRef.current?.fit();
        fitSplitRef.current?.fit();
      }, 50);
    }
  }, [bottomTab]);

  const newTerminal = () => {
    if (xtermSplitRef.current) {
      xtermSplitRef.current.dispose();
      xtermSplitRef.current = null;
      setIsSplit(false);
    }
    
    if (!xtermRef.current && terminalRef.current) {
      const primary = createTerminalInstance(terminalRef.current, true);
      xtermRef.current = primary.term;
      fitRef.current = primary.fit;
    }
    
    if (xtermRef.current) {
      xtermRef.current.clear();
      xtermRef.current.writeln('\r\n\x1b[36mNew terminal session started.\x1b[0m');
    }
    socketRef.current?.emit('terminal-restart', { shell: terminalMode });
  };

  // Use effect to create the split terminal after the split container mounts
  useEffect(() => {
    if (!isSplit) {
      // dispose existing split terminal if any
      if (xtermSplitRef.current) {
        xtermSplitRef.current.dispose();
        xtermSplitRef.current = null;
      }
      return;
    }
    const container = splitRef.current;
    if (!container) {
      xtermRef.current?.writeln('\r\n\x1b[31mCould not create split terminal: container not ready.\x1b[0m');
      return;
    }
    const { term, fit, obs } = createTerminalInstance(container, true);
    term.writeln('\r\n\x1b[36mSplit terminal ready — shares session with primary pane.\x1b[0m');
    xtermSplitRef.current = term;
    fitSplitRef.current = fit;
    return () => {
      obs.disconnect();
      xtermSplitRef.current?.dispose();
      xtermSplitRef.current = null;
    };
  }, [isSplit, createTerminalInstance]);

  const splitTerminal = () => {
    setIsSplit(v => !v);
    // message handled in effect
  };

  const killTerminal = () => {
    if (xtermSplitRef.current) {
      xtermSplitRef.current.dispose();
      xtermSplitRef.current = null;
      setIsSplit(false);
      xtermRef.current?.writeln('\r\n\x1b[31mKilled split terminal.\x1b[0m');
      return;
    }
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
      // create a lightweight placeholder so UI doesn't break
      setTimeout(() => newTerminal(), 200);
    }
  };

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/containers/list`);
        const data = await res.json();
        setContainers(data.containers || []);
        setDockerStatus(data.containers?.filter(c => c.State === 'running').length ? 'running' : 'idle');
      } catch { setDockerStatus('error'); }
    };
    poll(); const iv = setInterval(poll, 5000); return () => clearInterval(iv);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      const mod = navigator.platform.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setPaletteOpen(v => !v); setPaletteQuery(''); setPaletteIndex(0); }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setPaletteOpen(true); setPaletteQuery(''); setPaletteIndex(0); }
      if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); setActivityPanel('explorer'); setShowNewItem('file'); }
      if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); setGotoLineOpen(true); setGotoLineValue(''); }
      if (e.key === 'Escape') { setPaletteOpen(false); setRenamingFile(null); setShowProjectPicker(false); setGotoLineOpen(false); }
      if (mod && e.key === 's') { e.preventDefault(); if (activeFile && openFiles[activeFile]) { saveFile(activeFile, openFiles[activeFile].value); } }
      if (mod && e.key === 'w') { e.preventDefault(); if (activeFile) closeTab(activeFile, { stopPropagation: () => { } }); }
      if (mod && e.key === '`') { e.preventDefault(); setBottomTab('terminal'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeFile, openFiles]);

  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages]);

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const results: SearchResult[] = [];
    const q = searchQuery.toLowerCase();
    allFiles.filter(f => !f.isFolder).forEach(file => {
      const content = openFiles[file.id]?.value ?? file.content ?? '';
      content.split('\n').forEach((line, i) => {
        if (line.toLowerCase().includes(q))
          results.push({ id: file.id, name: file.name, line: i + 1, text: line.trim() });
      });
    });
    setSearchResults(results.slice(0, 80));
  }, [searchQuery, openFiles, allFiles]);

  useEffect(() => {
    if (renamingFile && renameInputRef.current) { renameInputRef.current.focus(); renameInputRef.current.select(); }
  }, [renamingFile]);

  useEffect(() => {
    const opened = Object.values(openFiles);
    const lineCount = opened.reduce((total, file) => total + (file.value?.split('\n').length || 0), 0);
    const todoCount = opened.reduce((total, file) => total + (file.value.match(/TODO|FIXME|BUG|HACK/gi)?.length || 0), 0);
    const largeFiles = opened
      .map(file => ({ name: file.name, lines: file.value.split('\n').length }))
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 3)
      .map(file => `${file.name} (${file.lines} lines)`);
    setProjectInsights({ fileCount: opened.length, lineCount, todoCount, largeFiles });
  }, [openFiles]);

  const startDebugger = () => {
    setActivityPanel('debug');
    setBottomTab('terminal');
    setDebugSession(true);
    xtermRef.current?.writeln('\r\n\x1b[36m▶ Debugger is ready. Set breakpoints and run your file.\x1b[0m');
    setChatMessages(m => [...m, { role: 'assistant', content: 'Debugger ready. Use F5 or the Run button to start a session.' }]);
  };

  const toggleExtension = (key: string) => {
    setExtensionStates(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const runAIOptimizer = async () => {
    if (!activeFile || !openFiles[activeFile]) return;
    const file = openFiles[activeFile];
    setChatLoading(true);
    setChatMessages(m => [...m, { role: 'user', content: `Optimize ${file.name} for readability and performance.` }]);
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/ai/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Optimize this ${file.language} file for readability and performance. Return the complete improved file.` }],
          fileTree: allFiles.map(f => ({ name: f.name, path: f.path, isFolder: f.isFolder })),
          activeFile: { name: file.name, path: file.path, content: file.value },
          model: selectedModel
        }),
      });
      const data = await res.json();
      if (data.action === 'apply' && data.code) {
        setOpenFiles(f => ({ ...f, [activeFile]: { ...f[activeFile], value: data.code } }));
        await saveFile(activeFile, data.code);
        setChatMessages(m => [...m, { role: 'assistant', content: `✔ Optimized ${file.name} and applied changes.\n${data.reply || ''}` }]);
      } else {
        setChatMessages(m => [...m, { role: 'assistant', content: data.reply || data.error || 'Optimization complete.' }]);
      }
    } catch {
      setChatMessages(m => [...m, { role: 'assistant', content: '⚠ AI optimizer unavailable — check backend.' }]);
    } finally { setChatLoading(false); }
  };

  const clearTerminal = () => {
    if (xtermRef.current) {
      xtermRef.current.clear();
      xtermRef.current.writeln('\r\n\x1b[36mTerminal cleared. Ready for commands.\x1b[0m');
    }
  };

  const toggleTerminalMode = () => {
    const next = terminalMode === 'bash' ? 'zsh' : terminalMode === 'zsh' ? 'sh' : 'bash';
    setTerminalMode(next);
    socketRef.current?.emit('terminal-restart', { shell: next });
    xtermRef.current?.writeln(`\r\n\x1b[36mRestarting terminal with ${next} shell...\x1b[0m`);
    if (xtermSplitRef.current) xtermSplitRef.current.writeln(`\r\n\x1b[36mRestarting terminal with ${next} shell...\x1b[0m`);
  };

  const executeTerminalCommand = () => {
    const command = terminalCommand.trim();
    if (!command || !xtermRef.current) return;
    xtermRef.current.writeln(`\r\n\x1b[32muser@ai-cloud-ide:~$ \x1b[0m${command}`);
    if (command === 'clear') {
      clearTerminal();
    } else if (command === 'help') {
      xtermRef.current.writeln('Available editor commands: clear, run, open <file>, search <term>, help');
    } else if (command === 'run') {
      runFile(activeFile);
    } else if (command.startsWith('open ')) {
      const name = command.slice(5).trim();
      const target = allFiles.find(f => f.name === name && !f.isFolder);
      if (target) { openFile(target); xtermRef.current.writeln(`Opened ${name}.`); }
      else xtermRef.current.writeln(`File not found: ${name}`);
    } else if (command.startsWith('search ')) {
      const query = command.slice(7).trim();
      setSearchQuery(query); setActivityPanel('search');
      xtermRef.current.writeln(`Searching open files for: ${query}`);
    } else if (command === 'toggle minimap') {
      setMinimapEnabled(v => {
        const next = !v;
        xtermRef.current?.writeln(`Minimap ${next ? 'enabled' : 'disabled'}.`);
        return next;
      });
    } else {
      xtermRef.current.writeln('Unknown command. Type help for editor actions.');
    }
    setTerminalCommand('');
  };

  const handleTerminalCommandKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      executeTerminalCommand();
    }
  };

  const openSettings = () => setActivityPanel('settings');

  const openInsights = () => {
    setActivityPanel('settings');
    setChatMessages(m => [...m, { role: 'assistant', content: 'Opened project insights for a quick overview of code health.' }]);
  };

  const goToLine = () => {
    const line = parseInt(gotoLineValue, 10);
    if (!line || !editorRef.current) return;
    editorRef.current.revealLineInCenter(line);
    editorRef.current.setPosition({ lineNumber: line, column: 1 });
    editorRef.current.focus();
    setGotoLineOpen(false);
    setGotoLineValue('');
  };

  const toggleContainer = async (id: string, state: string) => {
    const action = state === 'running' ? 'stop' : 'start';
    setContainerAction(id);
    try {
      await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/containers/${id}/${action}`, { method: 'POST' });
      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/containers/list`);
      const data = await res.json();
      setContainers(data.containers || []);
    } catch {
      xtermRef.current?.writeln(`\r\n\x1b[31mFailed to ${action} container.\x1b[0m`);
    } finally { setContainerAction(null); }
  };

  const jumpToSearchResult = (result: SearchResult) => {
    const file = allFiles.find(f => f.id === result.id);
    if (file) openFile(file);
    setActiveFile(result.id);
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.revealLineInCenter(result.line);
        editorRef.current.setPosition({ lineNumber: result.line, column: 1 });
        editorRef.current.focus();
      }
    }, 100);
  };

  const openFile = (file: FileEntry) => {
    if (!openFiles[file.id]) {
      setOpenFiles(f => ({ ...f, [file.id]: { name: file.name, path: file.path, language: getLang(file.name), value: file.content } }));
    }
    setActiveFile(file.id);
    if (!openTabs.includes(file.id)) setOpenTabs(t => [...t, file.id]);
  };

  const closeTab = (id: string, e: { stopPropagation?: () => void }) => {
    e.stopPropagation?.();
    const next = openTabs.filter(t => t !== id);
    setOpenTabs(next);
    if (activeFile === id) setActiveFile(next[next.length - 1] || null);
  };

  const saveFile = useCallback(async (fileId: string | null, content: string) => {
    if (!project || !fileId) return;
    setSaveStatus('saving');

    let finalContent = content;
    if (extensionStates['prettier']) {
      try {
        const file = allFiles.find(f => f.id === fileId);
        if (file) {
          const prettier = await import('prettier/standalone');
          let plugins: any[] = [];
          let parser = '';
          const ext = file.name.split('.').pop()?.toLowerCase();

          if (ext === 'js' || ext === 'jsx' || ext === 'ts' || ext === 'tsx') {
            plugins = [await import('prettier/plugins/babel'), await import('prettier/plugins/estree')];
            parser = 'babel';
          } else if (ext === 'html') {
            plugins = [await import('prettier/plugins/html')];
            parser = 'html';
          } else if (ext === 'css') {
            plugins = [await import('prettier/plugins/postcss')];
            parser = 'css';
          } else if (ext === 'json') {
            plugins = [await import('prettier/plugins/babel'), await import('prettier/plugins/estree')];
            parser = 'json';
          } else if (ext === 'md') {
            plugins = [await import('prettier/plugins/markdown')];
            parser = 'markdown';
          }

          if (parser) {
            finalContent = await prettier.format(content, { parser, plugins, singleQuote: true });
            if (finalContent !== content && activeFile === fileId) {
              setOpenFiles(f => ({ ...f, [fileId]: { ...f[fileId], value: finalContent } }));
            }
          }
        }
      } catch (e) { console.warn('Prettier formatting failed', e); }
    }

    try {
      await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/files/${fileId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ content: finalContent }),
      });
      setSaveStatus('saved');
    } catch { setSaveStatus('unsaved'); }
  }, [project, extensionStates, allFiles, activeFile]);

  const [gitStatus, setGitStatus] = useState<string>('');
  const [gitLogs, setGitLogs] = useState<any[]>([]);
  const [gitCommitMsg, setGitCommitMsg] = useState('');
  const [isGitLoading, setIsGitLoading] = useState(false);

  const refreshGit = useCallback(async () => {
    if (!project) return;
    try {
      const statusRes = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/git/status`, { headers: authHeader() });
      const statusData = await statusRes.json();
      setGitStatus(statusData.status || '');

      const logRes = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/git/log`, { headers: authHeader() });
      const logData = await logRes.json();
      setGitLogs(logData.logs || []);
    } catch (e) { console.error('Git error', e); }
  }, [project]);

  const commitGit = async () => {
    if (!project || !gitCommitMsg.trim()) return;
    setIsGitLoading(true);
    try {
      await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/git/commit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ message: gitCommitMsg })
      });
      setGitCommitMsg('');
      await refreshGit();
    } catch (e) { console.error('Commit failed', e); }
    finally { setIsGitLoading(false); }
  };

  useEffect(() => {
    if (activityPanel === 'source') {
      refreshGit();
    }
  }, [activityPanel, refreshGit]);

  const updateActiveFileContent = (value: string) => {
    if (!activeFile) return;
    setOpenFiles(f => ({ ...f, [activeFile]: { ...f[activeFile], value } }));
    setSaveStatus('unsaved');
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => saveFile(activeFile, value), 800);

    // Live Linting
    if (extensionStates['eslint'] && project) {
      clearTimeout(lintTimeout.current);
      lintTimeout.current = setTimeout(async () => {
        try {
          const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/lint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader() },
            body: JSON.stringify({ code: value })
          });
          const data = await res.json();
          const markers = (data.results?.[0]?.messages || []).map((msg: any) => ({
            severity: msg.severity === 2 ? monacoRef.current.MarkerSeverity.Error : monacoRef.current.MarkerSeverity.Warning,
            startLineNumber: msg.line || 1,
            startColumn: msg.column || 1,
            endLineNumber: msg.endLine || msg.line || 1,
            endColumn: msg.endColumn || msg.column || 1,
            message: msg.message,
            source: 'eslint'
          }));
          const model = editorRef.current?.getModel();
          if (model && monacoRef.current) {
            monacoRef.current.editor.setModelMarkers(model, 'eslint', markers);
          }
        } catch (e) {
          console.warn('Linting failed', e);
        }
      }, 1000);
    } else if (!extensionStates['eslint'] && editorRef.current && monacoRef.current) {
      const model = editorRef.current.getModel();
      if (model) monacoRef.current.editor.setModelMarkers(model, 'eslint', []);
    }
  };

  const refreshTree = useCallback(async () => {
    if (!project) return;
    const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}`, { headers: authHeader() });
    const data = await res.json();
    setAllFiles(data.project.files);
  }, [project]);

  const stopSandbox = useCallback(async () => {
    if (!sandboxId) return;
    xtermRef.current?.writeln('\r\n\x1b[33m► Stopping sandbox...\x1b[0m');
    try {
      await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/run/stop`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ containerId: sandboxId })
      });
      xtermRef.current?.writeln('\x1b[33m► Sandbox stopped.\x1b[0m');
    } catch (e) {
      console.error(e);
    } finally {
      setIsRunning(false);
      setSandboxId(null);
      setPreviewPorts({});
    }
  }, [sandboxId]);

  const runFile = useCallback(async (fileId?: string, isAutoRetry = false) => {
    let id = fileId ?? activeFile;
    const hasIndexHtml = allFiles.find(f => f.name === 'index.html');
    const hasPackageJson = allFiles.find(f => f.name === 'package.json');
    if (hasIndexHtml && !hasPackageJson) {
      id = hasIndexHtml.id;
    } else if (id === '__preview__' || !id) {
      id = lastRunFile || hasIndexHtml?.id || allFiles.find(f => f.name === 'server.js' || f.name === 'app.js' || f.name === 'main.py' || !f.isFolder)?.id;
    }
    if (!id || id === '__preview__') return;
    setLastRunFile(id);
    let file = openFiles[id];
    if (!file) {
      const f = allFiles.find(x => x.id === id);
      if (!f) return;
      file = { name: f.name, path: f.path, language: getLang(f.name), value: f.content };
    }

    if (!isAutoRetry) {
      autoDebugAttempts.current = 0;
    }

    // Stop any existing sandbox first
    if (sandboxId) await stopSandbox();

    setIsRunning(true); setBottomTab('terminal'); setPreviewPorts({});
    xtermRef.current?.writeln(`\r\n\x1b[36m▶ Running ${file.name}...\x1b[0m`);
    try {
      const projectFiles = allFiles.map(f => ({
        name: f.name,
        path: f.path,
        isFolder: f.isFolder,
        content: f.isFolder ? '' : (openFiles[f.id]?.value ?? f.content)
      }));

      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: file.value, language: file.language, fileName: file.name, projectFiles, socketId: socketRef.current?.id }),
      });
      const data = await res.json();

      if (data.containerId) {
        setSandboxId(data.containerId);

        if (isAutoRetry) {
          setDebugHistory(h => {
            const next = [...h];
            if (next.length > 0) next[next.length - 1].status = 'success';
            return next;
          });
        }

        // Ports will be populated dynamically via the 'sandbox-ports' websocket event
        // based on active listeners inside the container
        setPreviewPorts({});
        setOpenTabs(t => t.filter(x => x !== '__preview__'));
      } else if (data.error) {
        xtermRef.current?.writeln(`\r\n\x1b[31m✖ Sandbox error: ${data.error}\x1b[0m`);
        setIsRunning(false);

        if (isAutoRetry) {
          setDebugHistory(h => {
            const next = [...h];
            if (next.length > 0) next[next.length - 1].status = 'failed';
            return next;
          });
        }

        const isServerOrRateLimitError = res.status === 429 || res.status >= 500 || data.error.includes('Unsupported language');

        if (autoDebugEnabled && !isServerOrRateLimitError) {
          if (autoDebugAttempts.current < 3) {
            autoDebugAttempts.current += 1;
            autoDebug(file, data.error, autoDebugAttempts.current);
          } else {
            setChatMessages(m => [...m, { role: 'assistant', content: `Auto-debug couldn't fix this after 3 attempts. Here's the last error:\n\n\`\`\`\n${data.error}\n\`\`\`` }]);
            setAiTab('chat');
          }
        }
      }
    } catch {
      xtermRef.current?.writeln('\r\n\x1b[31m✖ Sandbox execution failed to start.\x1b[0m');
      setIsRunning(false);
    }
  }, [activeFile, openFiles, allFiles, sandboxId, stopSandbox, autoDebugEnabled]);

  useEffect(() => {
    const handler = (e) => {
      const mod = navigator.platform.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 'Enter') { e.preventDefault(); runFile(activeFile); }
      if (e.key === 'F5') { e.preventDefault(); debugSession ? runFile(activeFile) : startDebugger(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeFile, debugSession, runFile]);

  const autoDebug = async (file: any, errorOutput: string, attempt: number) => {
    setChatMessages(m => [...m, { role: 'assistant', content: `⚠ Detected an error in ${file.name} (Attempt ${attempt}/3). Asking AI to auto-fix using the real error output...` }]);
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/ai/debug`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: file.value, language: file.language, fileName: file.name, error: errorOutput }),
      });
      const data = await res.json();
      if (data.scaffold) {
        setChatMessages(m => [...m, { role: 'assistant', content: `✔ Auto-fixing by scaffolding dependencies.\n${data.explanation ? '\n' + data.explanation : ''}` }]);
        setDebugHistory(h => [...h, { attempt, file: file.name, error: errorOutput, explanation: data.explanation, status: 'testing' }]);
        await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project?.id}/scaffold`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ items: data.scaffold }),
        });
        await refreshTree();
        runFile(file.id, true);
      } else if (data.fixed) {
        const fileInState = allFiles.find(f => f.name === file.name);
        if (fileInState) {
          const diffText = computeDiff(file.value, data.fixed);
          setDebugHistory(h => [...h, { attempt, file: file.name, error: errorOutput, explanation: data.explanation, diff: diffText, status: 'testing' }]);
          setOpenFiles(f => ({ ...f, [fileInState.id]: { ...f[fileInState.id], value: data.fixed } }));
          await saveFile(fileInState.id, data.fixed);
          setChatMessages(m => [...m, { role: 'assistant', content: `✔ Applied auto-fix for ${file.name}. Re-running to verify...` }]);
          runFile(fileInState.id, true);
        }
      }
    } catch {
      setChatMessages(m => [...m, { role: 'assistant', content: '⚠ Auto-debug failed — AI backend unavailable.' }]);
    }
  };

  const runChaosTest = async () => {
    const file = openFiles[activeFile];
    if (!file) return;
    setIsChaosRunning(true); setChaosResults(null); setBottomTab('chaos');
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/chaos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: file.value, language: file.language, fileName: file.name }),
      });
      const data = await res.json();
      setChaosResults(data);
    } catch {
      setChaosResults({ error: 'Chaos test failed — check the backend.' } as any);
    } finally { setIsChaosRunning(false); }
  };

  const approveAIAction = async () => {
    console.log("Approve clicked", { pendingAIAction, project });
    if (!pendingAIAction) return;
    if (!project) {
      alert("Project is not loaded properly. Please refresh the page.");
      return;
    }
    const { action, data, summary } = pendingAIAction;
    setPendingAIAction(null);
    try {
      if (action === 'scaffold') {
        setChatMessages(m => [...m, { role: 'assistant', content: summary || `Applying ${data.items.length} files...` }]);
        const res2 = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/scaffold`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ items: data.items }),
        });
        const json2 = await res2.json();
        if (json2.files) {
          setOpenFiles(f => {
            const next = { ...f };
            let lastFileId = null;
            const newTabIds: string[] = [];
            json2.files.forEach((file: any) => {
              if (!file.isFolder) {
                next[file.id] = { name: file.name, path: file.path, language: file.language, value: file.content };
                lastFileId = file.id;
                newTabIds.push(file.id);
              }
            });
            if (newTabIds.length > 0) {
              setOpenTabs(t => [...new Set([...t, ...newTabIds])]);
              setTimeout(() => setActiveFile(lastFileId), 50);
            }
            return next;
          });
        }
        await refreshTree();
        setChatMessages(m => [...m, { role: 'assistant', content: `✔ Applied changes to ${data.items.length} files/folders.` }]);
      } else if (action === 'apply') {
        const target = allFiles.find(f => f.name === data.fileName && !f.isFolder);
        if (target) {
          await saveFile(target.id, data.code);
          setChatMessages(m => [...m, { role: 'assistant', content: (summary || 'Applying changes...') + `\n\n✔ Applied to ${data.fileName}.` }]);
        }
      } else if (action === 'delete') {
        setChatMessages(m => [...m, { role: 'assistant', content: summary || `Deleting ${data.items.length} files...` }]);
        for (const filename of data.items) {
          const target = allFiles.find(f => (f.path ? f.path + '/' : '') + f.name === filename || f.name === filename);
          if (target) {
            await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/files/${target.id}`, { method: 'DELETE', headers: authHeader() });
            setOpenFiles(f => { const n = { ...f }; delete n[target.id]; return n; });
            setOpenTabs(t => t.filter(x => x !== target.id));
            if (activeFile === target.id) setActiveFile(null);
          }
        }
        await refreshTree();
        setChatMessages(m => [...m, { role: 'assistant', content: `✔ Deleted ${data.items.length} files/folders.` }]);
      }
    } catch {
      setChatMessages(m => [...m, { role: 'assistant', content: '⚠ Error applying AI changes.' }]);
    }
  };

  const rejectAIAction = () => {
    setPendingAIAction(null);
    setChatMessages(m => [...m, { role: 'assistant', content: '❌ User rejected changes.' }]);
  };

  const loadChatSessions = useCallback(async () => {
    if (!project) return;
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/chats`, { headers: authHeader() });
      if (res.ok) {
        const data = await res.json();
        setChatSessions(data.sessions);
      }
    } catch (e) { console.error('Failed to load chat sessions', e); }
  }, [project]);

  const loadChatMessages = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/chats/${sessionId}/messages`, { headers: authHeader() });
      if (res.ok) {
        const data = await res.json();
        const msgs = data.messages.map((m: any) => ({ role: m.role, content: m.content }));
        setChatMessages(msgs.length ? msgs : [{ role: 'assistant', content: "I'm your AI coding agent.\n\nTry:\n• \"create a REST API with auth\"\n• \"fix the errors in this file\"\n• \"run this file\"\n• \"explain this code\"\n\nI can create entire multi-file projects in one shot." }]);
      }
    } catch (e) { console.error('Failed to load messages', e); }
  }, []);

  const createNewChat = async () => {
    if (!project) return;
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ name: 'New Chat' })
      });
      if (res.ok) {
        const data = await res.json();
        setChatSessions(prev => [data.session, ...prev]);
        setActiveSessionId(data.session.id);
        setChatMessages([{ role: 'assistant', content: "I'm your AI coding agent.\n\nTry:\n• \"create a REST API with auth\"\n• \"fix the errors in this file\"\n• \"run this file\"\n• \"explain this code\"\n\nI can create entire multi-file projects in one shot." }]);
      }
    } catch (e) { console.error(e); }
  };

  const deleteChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/chats/${id}`, { method: 'DELETE', headers: authHeader() });
      if (res.ok) {
        setChatSessions(prev => prev.filter(s => s.id !== id));
        if (activeSessionId === id) {
          setActiveSessionId(null);
          setChatMessages([{ role: 'assistant', content: "I'm your AI coding agent.\n\nTry:\n• \"create a REST API with auth\"\n• \"fix the errors in this file\"\n• \"run this file\"\n• \"explain this code\"\n\nI can create entire multi-file projects in one shot." }]);
        }
      }
    } catch (err) { console.error(err); }
  };

  const renameChat = async (id: string, newName: string) => {
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/chats/${id}`, {
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

  const saveMessageToDb = async (sessionId: string, role: string, content: string) => {
    try {
      await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/chats/${sessionId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ role, content })
      });
    } catch (e) { }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;

    // Auto-create session if none exists
    let currentSessionId = activeSessionId;
    if (!currentSessionId && project) {
      try {
        const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/chats`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ name: chatInput.slice(0, 30) + (chatInput.length > 30 ? '...' : '') })
        });
        if (res.ok) {
          const data = await res.json();
          currentSessionId = data.session.id;
          setActiveSessionId(currentSessionId);
          setChatSessions(prev => [data.session, ...prev]);
        }
      } catch (e) { }
    }

    const userText = chatInput;
    if (currentSessionId) saveMessageToDb(currentSessionId, 'user', userText);

    const nextMessages = [...chatMessages, { role: 'user', content: userText }];
    setChatMessages(nextMessages as any); setChatInput(''); setChatLoading(true);

    abortControllerRef.current = new AbortController();

    const fileTree = allFiles.map(f => ({ name: f.name, path: f.path, isFolder: f.isFolder }));
    const activeFileData = activeFile ? openFiles[activeFile] : null;
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/ai/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({
          messages: nextMessages,
          fileTree,
          activeFile: activeFileData ? { name: activeFileData.name, path: activeFileData.path, content: activeFileData.value } : null,
          model: selectedModel
        }),
      });
      const data = await res.json();
      if (data.action === 'scaffold' && data.items?.length) {
        setPendingAIAction({ action: 'scaffold', data, summary: data.reply });
      } else if (data.action === 'apply' && data.code && data.fileName) {
        const target = allFiles.find(f => f.name === data.fileName && !f.isFolder);
        if (target) {
          const originalCode = openFiles[target.id]?.value || '';
          setPendingAIAction({ action: 'apply', data, summary: data.reply, originalCode });
        } else {
          setChatMessages(m => [...m, { role: 'assistant', content: data.reply || 'Could not find target file.' }]);
        }
      } else if (data.action === 'delete' && data.items?.length) {
        setPendingAIAction({ action: 'delete', data, summary: data.reply });
      } else if (data.action === 'run' && data.fileName) {
        const target = allFiles.find(f => f.name === data.fileName);
        setChatMessages(m => [...m, { role: 'assistant', content: `Running ${data.fileName} — check Terminal tab.` }]);
        if (target) { openFile(target); setTimeout(() => runFile(target.id), 100); }
      } else {
        const aiMsg = data.reply || data.error || 'No response.';
        setChatMessages(m => [...m, { role: 'assistant', content: aiMsg }]);
        if (currentSessionId) saveMessageToDb(currentSessionId, 'assistant', aiMsg);
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setChatMessages(m => [...m, { role: 'assistant', content: '⚠ Generation stopped by user.' }]);
        if (currentSessionId) saveMessageToDb(currentSessionId, 'assistant', '⚠ Generation stopped by user.');
      } else {
        setChatMessages(m => [...m, { role: 'assistant', content: '⚠ Could not reach the AI backend.' }]);
      }
    } finally { setChatLoading(false); abortControllerRef.current = null; }
  };

  const createItem = async (isFolder) => {
    const name = newItemName.trim();
    if (!name || !project) return;
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/files`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ name, path: '', isFolder, language: getLang(name) }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error); return; }
      setNewItemName(''); setShowNewItem(null);
      await refreshTree();
      if (!isFolder) openFile(data.file);
    } catch { }
  };

  const deleteItem = async (id, name, isFolder) => {
    if (!window.confirm(`Delete ${isFolder ? 'folder' : 'file'} "${name}"${isFolder ? ' and everything inside?' : '?'}`)) return;
    await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/files/${id}`, { method: 'DELETE', headers: authHeader() });
    await refreshTree();
    if (!isFolder) {
      setOpenFiles(f => { const n = { ...f }; delete n[id]; return n; });
      setOpenTabs(t => t.filter(x => x !== id));
      if (activeFile === id) setActiveFile(null);
    }
  };

  const startRename = (key, name) => { setRenamingFile(key); setRenameValue(name || ''); };
  const handleReplaceAll = async () => {
    if (!project || !searchQuery) return;
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/replace`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ q: searchQuery, replaceWith: replaceQuery })
      });
      const data = await res.json();
      if (data.success) {
        alert(`Replaced ${data.count} files.`);
        loadProject(project.id);
      }
    } catch (e) {
      console.error(e);
    }
  };


  const submitRename = async (id, isFolder) => {
    const newName = renameValue.trim();
    setRenamingFile(null);
    if (!newName) return;
    const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/files/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ name: newName }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
    await refreshTree();
    if (!isFolder && openFiles[id]) setOpenFiles(f => ({ ...f, [id]: { ...f[id], name: newName, language: getLang(newName) } }));
  };

  const toggleExpand = (path) => {
    setExpanded(prev => { const next = new Set(prev); next.has(path) ? next.delete(path) : next.add(path); return next; });
  };

  const createProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    setNewProjectName('');
    await fetchProjects();
    loadProject(data.project.id);
    setShowProjectPicker(false);
  };

  const handleDeploy = async () => {
    if (!project) return;
    setDeployState('deploying');
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Deploy failed');
      setDeployUrl(data.url);
      setDeployContainerId(data.containerId);
      setDeployState('deployed');
    } catch (e: any) {
      console.error(e);
      setDeployState('error');
    }
  };

  const handleStopDeploy = async () => {
    if (!project || !deployContainerId) return;
    try {
      await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${project.id}/stop-deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ containerId: deployContainerId })
      });
    } catch (e) {
      console.error(e);
    } finally {
      setDeployState('idle');
      setDeployUrl('');
      setDeployContainerId('');
    }
  };

  const deleteProject = async (id: string, e: any) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this project? This cannot be undone.")) return;
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${id}`, {
        method: 'DELETE',
        headers: authHeader()
      });
      if (res.ok) {
        if (project?.id === id) {
          setProject(null);
          setAllFiles([]);
          setOpenFiles({});
          setOpenTabs([]);
          setActiveFile(null);
        }
        await fetchProjects();
      }
    } catch (e) {
      console.error("Failed to delete project", e);
    }
  };

  const openLocalFolder = async () => {
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      const name = dirHandle.name;

      // Create project
      const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      const projectId = data.project.id;

      const newFiles = [];
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const file = await entry.getFile();
          if (file.size > 500000) continue; // Skip files > 500kb
          const text = await file.text();
          let ext = file.name.split('.').pop() || 'txt';
          const langMap: any = { js: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', html: 'html', css: 'css', json: 'json', py: 'python', md: 'markdown' };
          newFiles.push({ name: file.name, path: '', isFolder: false, content: text, language: langMap[ext] || 'plaintext' });
        }
      }

      // Upload files (one by one for simplicity)
      for (const f of newFiles) {
        await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/projects/${projectId}/files`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify(f)
        });
      }

      await fetchProjects();
      loadProject(projectId);
    } catch (e) {
      console.error(e);
      alert("Failed to open local folder (browser may have blocked the request, or no files were selected).");
    }
  };

  const handleLogout = () => { clearAuth(); navigate('/login'); };
  const activeLang = useMemo(() => (activeFile ? openFiles[activeFile]?.language : undefined) || 'plaintext', [openFiles, activeFile]);
  const canRun = RUNNABLE_LANGS.includes(activeLang);
  const tree = useMemo(() => buildTree(allFiles), [allFiles]);
  const activeFileData = activeFile ? openFiles[activeFile] : undefined;
  const errorCount = problems.filter(p => p.severity === 'error').length;
  const warnCount = problems.filter(p => p.severity === 'warning').length;

  const commands = useMemo(() => [
    { id: 'run', label: '▶ Run Active File', action: () => runFile(activeFile) },
    { id: 'chaos', label: '💥 Chaos Test Active File', action: runChaosTest },
    { id: 'new-file', label: '+ New File', action: () => { setActivityPanel('explorer'); setShowNewItem('file'); } },
    { id: 'new-folder', label: '+ New Folder', action: () => { setActivityPanel('explorer'); setShowNewItem('folder'); } },
    { id: 'new-project', label: '+ New Project', action: () => setShowProjectPicker(true) },
    { id: 'toggle-minimap', label: `${minimapEnabled ? 'Hide' : 'Show'} Minimap`, action: () => setMinimapEnabled(v => !v) },
    { id: 'toggle-wrap', label: `${wordWrap ? 'Disable' : 'Enable'} Word Wrap`, action: () => setWordWrap(v => !v) },
    { id: 'font-increase', label: 'Increase Font Size', action: () => setFontSize(f => Math.min(f + 1, 24)) },
    { id: 'font-decrease', label: 'Decrease Font Size', action: () => setFontSize(f => Math.max(f - 1, 10)) },
    { id: 'goto-line', label: 'Go to Line', action: () => { setGotoLineOpen(true); setGotoLineValue(''); } },
    { id: 'insights', label: 'Show Project Insights', action: openInsights },
    { id: 'explorer', label: 'Show Explorer', action: () => setActivityPanel('explorer') },
    { id: 'search-panel', label: 'Search Files', action: () => setActivityPanel('search') },
    { id: 'docker-panel', label: 'Show Docker', action: () => setActivityPanel('docker') },
    { id: 'terminal-tab', label: 'Show Terminal', action: () => setBottomTab('terminal') },
    { id: 'problems-tab', label: 'Show Problems', action: () => setBottomTab('problems') },
    { id: 'chaos-tab', label: 'Show Chaos Results', action: () => setBottomTab('chaos') },
    ...allFiles.filter(f => !f.isFolder).map(f => ({ id: `open-${f.id}`, label: `Open ${f.name}`, action: () => openFile(f) })),
    ...projects.map(p => ({ id: `switch-${p.id}`, label: `Switch to project: ${p.name}`, action: () => loadProject(p.id) })),
    { id: 'logout', label: 'Log Out', action: handleLogout },
  ], [allFiles, activeFile, projects, minimapEnabled, wordWrap]);

  const fuse = useMemo(() => new Fuse(commands, { keys: ['label'], threshold: 0.4 }), [commands]);
  const filteredCommands = paletteQuery ? fuse.search(paletteQuery).map(r => r.item) : commands;
  const runCommand = (cmd) => { cmd.action(); setPaletteOpen(false); };
  const handlePaletteKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteIndex(i => Math.min(i + 1, filteredCommands.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filteredCommands[paletteIndex]) runCommand(filteredCommands[paletteIndex]); }
  };

  const currentSession = chatSessions.find(s => s.id === activeSessionId);

  return (
    <div className="ide-root">
      <header className="titlebar">
        <div className="titlebar-left">
          <span className="logo">⚡ Orbit IDE</span>
          <span className="titlebar-sep">/</span>
          <button className="project-switcher" onClick={() => setShowProjectPicker(v => !v)}>
            {project?.name || '...'} <ChevronDown size={11} />
          </button>
        </div>
        <div className="titlebar-right">
          <button className="palette-hint-btn" onClick={() => setPaletteOpen(true)}><Command size={13} />&nbsp;Commands</button>
          <span className="save-indicator">{saveStatus === 'saving' ? '⏳' : saveStatus === 'unsaved' ? '●' : '✓'} {saveStatus}</span>
          {!isRunning ? (
            <button className="run-btn" onClick={() => runFile(activeFile)} disabled={!canRun} title={!canRun ? `No runner for "${activeLang}"` : 'Run (Ctrl+Enter)'}>
              <Play size={12} /> Run
            </button>
          ) : (
            <>
              <button className="run-btn" style={{ background: 'var(--vscode-error)' }} onClick={stopSandbox} title="Stop Sandbox">
                <Square size={12} /> Stop
              </button>
              <button className="run-btn" style={{ background: 'var(--vscode-accent)', marginLeft: 8 }} onClick={() => runFile(activeFile)} title="Restart Sandbox with latest files">
                <RefreshCw size={12} /> Restart
              </button>
            </>
          )}
          <button className="chaos-btn" onClick={runChaosTest} disabled={isChaosRunning || !canRun} title="Chaos Test — runs your code under memory limits, CPU throttle, kill signals, and network cuts">
            <Zap size={12} /> {isChaosRunning ? 'Testing…' : 'Chaos Test'}
          </button>
          {deployState === 'idle' || deployState === 'error' ? (
            <button className="run-btn" style={{ background: 'var(--vscode-success)' }} onClick={handleDeploy} title="One-Click Deploy">
              <Rocket size={12} /> Deploy
            </button>
          ) : deployState === 'deploying' ? (
            <button className="run-btn" disabled>
              <RefreshCw size={12} className="spin" /> Deploying...
            </button>
          ) : (
            <>
              <a href={deployUrl} target="_blank" rel="noreferrer" className="run-btn" style={{ textDecoration: 'none', background: 'var(--vscode-accent)' }}>
                <ExternalLink size={12} /> {deployUrl}
              </a>
              <button className="run-btn" style={{ background: 'var(--vscode-error)', marginLeft: 8 }} onClick={handleStopDeploy}>
                <Square size={12} /> Stop Deploy
              </button>
            </>
          )}
          <button className="logout-btn" onClick={handleLogout}><LogOut size={16} /></button>
        </div>
      </header>

      {showProjectPicker && (
        <div className="project-picker">
          <div className="project-picker-header">Projects</div>
          {projects.map(p => (
            <div key={p.id} className={`project-item ${project?.id === p.id ? 'active' : ''}`} onClick={() => { loadProject(p.id); setShowProjectPicker(false); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{p.name}</span>
              <button className="icon-btn compact" onClick={(e) => deleteProject(p.id, e)} title="Delete Project"><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="project-new-row">
            <input className="new-file-input" placeholder="New project name..." value={newProjectName} onChange={e => setNewProjectName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createProject()} />
            <button className="icon-btn" onClick={createProject}>+</button>
          </div>
        </div>
      )}

      <div className="ide-body">
        <nav className="activity-bar">
          {[
            { id: 'explorer', icon: <Files size={20} />, tip: 'Explorer' },
            { id: 'search', icon: <Search size={20} />, tip: 'Search' },
            { id: 'source', icon: <GitBranch size={20} />, tip: 'Source Control' },
            { id: 'debug', icon: <Bug size={20} />, tip: 'Debug' },
            { id: 'docker', icon: <Boxes size={20} />, tip: 'Docker' },
            { id: 'extensions', icon: <Layers size={20} />, tip: 'Extensions' },
            { id: 'settings', icon: <Settings size={20} />, tip: 'Settings' },
          ].map(item => (
            <button key={item.id} className={`activity-icon ${activityPanel === item.id ? 'active' : ''}`} onClick={() => setActivityPanel(item.id as any)} title={item.tip}>{item.icon}</button>
          ))}
        </nav>

        <PanelGroup direction="horizontal" className="main-panels" style={{ height: '100%', width: '100%' }}>
          <Panel defaultSize={14} minSize={10} maxSize={26} className="sidebar">
            {!project && activityPanel === 'explorer' ? (
              <>
                <div className="sidebar-header"><span className="sidebar-title-text">EXPLORER</span></div>
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--vscode-text-dim)', fontSize: 13 }}>
                  <p style={{ marginBottom: 16 }}>You have not yet opened a folder.</p>
                  <button className="run-btn" style={{ margin: '0 auto' }} onClick={openLocalFolder}>Open Folder</button>
                </div>
              </>
            ) : activityPanel === 'explorer' && (
              <>
                <div className="sidebar-header">
                  <span className="sidebar-title-text">EXPLORER</span>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button className="icon-btn" onClick={() => setShowNewItem(showNewItem === 'file' ? null : 'file')} title="New File (Ctrl+N)"><Plus size={14} /></button>
                    <button className="icon-btn" onClick={() => setShowNewItem(showNewItem === 'folder' ? null : 'folder')} title="New Folder"><FolderPlus size={14} /></button>
                    <button className="icon-btn" title="Refresh Explorer" onClick={refreshTree}><RefreshCw size={14} /></button>
                    <button className="icon-btn" title="Collapse All Folders" onClick={() => { setExpanded(new Set()); setIsRootExpanded(false); }}><Minus size={14} /></button>
                  </div>
                </div>
                {showNewItem && (
                  <div className="new-file-row">
                    <input className="new-file-input" autoFocus value={newItemName}
                      onChange={e => setNewItemName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') createItem(showNewItem === 'folder'); if (e.key === 'Escape') setShowNewItem(null); }}
                      placeholder={showNewItem === 'folder' ? 'folder-name' : 'filename.js'} />
                    <button className="icon-btn" onClick={() => createItem(showNewItem === 'folder')}>✓</button>
                  </div>
                )}
                <div className="file-tree">
                  <div className="folder-row" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setIsRootExpanded(!isRootExpanded)}>
                    <div style={{ flex: 1, userSelect: 'none' }}>
                      {isRootExpanded ? '▾' : '▸'} {project?.name || 'project'}
                    </div>
                  </div>
                  {isRootExpanded && (
                    <TreeNode node={tree} depth={0} openFile={openFile} activeFile={activeFile}
                      expanded={expanded} toggleExpand={toggleExpand} startRename={startRename} deleteItem={deleteItem}
                      renamingFile={renamingFile} renameValue={renameValue} setRenameValue={setRenameValue}
                      submitRename={submitRename} renameInputRef={renameInputRef} />
                  )}
                </div>
              </>
            )}
            {activityPanel === 'search' && (
              <>
                <div className="sidebar-header"><span className="sidebar-title-text">SEARCH</span></div>
                <div style={{ padding: '8px 12px' }}>
                  <input className="search-input" placeholder="Search all project files..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} autoFocus />
                  <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                    <input className="search-input" placeholder="Replace with..." value={replaceQuery} onChange={e => setReplaceQuery(e.target.value)} />
                    <button className="toggle-btn" onClick={handleReplaceAll} style={{ padding: '4px 8px', fontSize: 11 }}>Replace</button>
                  </div>
                </div>
                <div className="search-results">
                  {searchResults.map((r, i) => (
                    <div key={i} className="search-result-row" onClick={() => jumpToSearchResult(r)}>
                      <div className="search-result-file">{r.name}:{r.line}</div>
                      <div className="search-result-text">{r.text}</div>
                    </div>
                  ))}
                  {searchQuery && !searchResults.length && <div className="no-results">No results in project files.</div>}
                </div>
              </>
            )}
            {activityPanel === 'source' && (
              <>
                <div className="sidebar-header">
                  <span className="sidebar-title-text">SOURCE CONTROL</span>
                  <button className="icon-btn compact" title="Refresh Git" onClick={refreshGit}>↻</button>
                </div>
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="settings-label">Git status</div>
                  {gitStatus ? (
                    <div style={{ padding: 12, background: '#141620', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
                      <pre style={{ color: 'var(--vscode-text)', fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>{gitStatus}</pre>
                    </div>
                  ) : (
                    <div className="no-results" style={{ padding: 12, background: '#141620', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
                      <div style={{ color: 'var(--vscode-text)' }}>No changes to commit.</div>
                      <div style={{ color: 'var(--vscode-text-dim)', marginTop: 6 }}>Your working tree is clean.</div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <input
                      type="text"
                      className="search-input"
                      placeholder="Commit message..."
                      value={gitCommitMsg}
                      onChange={e => setGitCommitMsg(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && commitGit()}
                      style={{ flex: 1 }}
                    />
                    <button className="run-btn" onClick={commitGit} disabled={!gitCommitMsg.trim() || isGitLoading}>
                      {isGitLoading ? '...' : 'Commit'}
                    </button>
                  </div>

                  <div className="settings-label" style={{ marginTop: 12 }}>Recent commits</div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {gitLogs.length > 0 ? gitLogs.map((log, idx) => (
                      <div key={idx} style={{ padding: 10, borderRadius: 8, background: '#10121d', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{log.message}</div>
                        <div style={{ color: 'var(--vscode-text-dim)', fontSize: 11, marginTop: 4 }}>
                          {log.hash} · {log.author} · {log.time}
                        </div>
                      </div>
                    )) : (
                      <div style={{ color: 'var(--vscode-text-dim)', fontSize: 12 }}>No commits found.</div>
                    )}
                  </div>
                </div>
              </>
            )}
            {activityPanel === 'debug' && (
              <>
                <div className="sidebar-header"><span className="sidebar-title-text">DEBUG</span></div>
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="no-results" style={{ padding: 16, background: '#10121d', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
                    <div style={{ color: '#fff', fontWeight: 600, marginBottom: 8 }}>No active debugging sessions</div>
                    <div style={{ color: 'var(--vscode-text-dim)', fontSize: 12 }}>Run a file and use breakpoints to start debugging.</div>
                  </div>
                  <div>
                    <div className="settings-label">Quick actions</div>
                    <button className={`toggle-btn ${debugSession ? 'on' : ''}`} style={{ width: '100%', justifyContent: 'space-between', padding: '8px 12px' }} onClick={startDebugger}>
                      <span>{debugSession ? 'Debugger Active' : 'Start Debugger'}</span>
                      <span style={{ opacity: 0.8 }}>F5</span>
                    </button>
                    <button className="toggle-btn" style={{ width: '100%', justifyContent: 'space-between', padding: '8px 12px', marginTop: 10 }} onClick={() => runFile(activeFile)} disabled={!canRun}>
                      <span>Run with Debugger</span>
                      <span style={{ opacity: 0.8 }}>▶</span>
                    </button>
                  </div>
                </div>
              </>
            )}
            {activityPanel === 'extensions' && (
              <>
                <div className="sidebar-header"><span className="sidebar-title-text">EXTENSIONS</span></div>
                <div style={{ padding: '12px 16px', display: 'grid', gap: 12 }}>
                  {[
                    { key: 'prettier', title: 'Prettier', desc: 'Format files on save and keep style consistent.' },
                    { key: 'eslint', title: 'ESLint', desc: 'Detect syntax and lint errors automatically.' },
                    { key: 'gitlens', title: 'GitLens', desc: 'Inspect commit history and file authorship.' },
                    { key: 'aiAssistant', title: 'AI Assistant', desc: 'Get smart fixes, code suggestions, and optimization tips.' },
                  ].map((item, idx) => {
                    const active = extensionStates[item.key];
                    return (
                      <div key={idx} style={{ padding: 12, borderRadius: 10, background: '#10121d', border: '1px solid rgba(255,255,255,0.06)', display: 'grid', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ color: '#fff', fontWeight: 700 }}>{item.title}</div>
                          <span style={{ color: active ? '#6ee7b7' : 'var(--vscode-text-dim)', fontSize: 11, textTransform: 'uppercase' }}>
                            {active ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                        <div style={{ color: 'var(--vscode-text-dim)', fontSize: 12 }}>{item.desc}</div>
                        <button className={`toggle-btn ${active ? 'on' : ''}`} style={{ width: '100%', justifyContent: 'center', padding: '8px 12px' }} onClick={() => toggleExtension(item.key)}>
                          {active ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    );
                  })}
                  <button className="run-btn" style={{ marginTop: 8 }} onClick={runAIOptimizer} disabled={!activeFile}>
                    <Zap size={12} /> Optimize active file with AI
                  </button>
                </div>
              </>
            )}
            {activityPanel === 'docker' && (
              <>
                <div className="sidebar-header">
                  <span className="sidebar-title-text">DOCKER</span>
                  <div style={{ flex: 1 }} />
                  {/* <button className="icon-btn" onClick={fetchDockerStatus} title="Refresh"><RefreshCw size={14} /></button> */}
                </div>
                <div className="docker-panel">
                  {dockerStatus === 'checking' && <div>Checking Docker connection...</div>}
                  {dockerStatus === 'error' && <div style={{ color: 'var(--vscode-error)' }}>Could not connect to Docker socket. Ensure Docker is running.</div>}
                  {dockerStatus === 'running' && (
                    <div style={{ color: 'var(--vscode-success)', marginBottom: 8 }}>✔ Docker is connected</div>
                  )}
                  {containers.map(container => (
                    <div key={container.Id} className="docker-container-item">
                      <div><Boxes size={14} /> {container.Names?.[0]?.replace(/^\//, '')}</div>
                      <div className="docker-badge">{container.State}</div>
                      <button className="toggle-btn" style={{ padding: '6px 10px', fontSize: 12 }}
                        onClick={() => toggleContainer(container.Id, container.State)}
                        disabled={containerAction === container.Id || dockerStatus === 'error'}>
                        {containerAction === container.Id ? '...' : container.State === 'running' ? 'Stop' : 'Start'}
                      </button>
                    </div>
                  ))}
                  {dockerStatus === 'running' && !containers.length && (
                    <div style={{ opacity: 0.7, marginTop: 8 }}>No active containers</div>
                  )}
                </div>
              </>
            )}

            {activityPanel === 'settings' && (
              <>
                <div className="sidebar-header"><span className="sidebar-title-text">SETTINGS</span></div>
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div className="settings-label">Code Font</div>
                    <select className="font-select" value={codeFont} onChange={e => setCodeFont(e.target.value)}>
                      {CODE_FONTS.map(f => <option key={f.id} value={f.family}>{f.label}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div className="settings-label">Font Size</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button className="icon-btn" onClick={() => setFontSize(f => Math.max(f - 1, 10))}><Minus size={13} /></button>
                      <span style={{ fontSize: 13 }}>{fontSize}px</span>
                      <button className="icon-btn" onClick={() => setFontSize(f => Math.min(f + 1, 24))}><Plus size={13} /></button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div className="settings-label">Minimap</div>
                    <button className={`toggle-btn ${minimapEnabled ? 'on' : ''}`} onClick={() => setMinimapEnabled(v => !v)}>{minimapEnabled ? 'Enabled' : 'Disabled'}</button>
                  </div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div className="settings-label">Word Wrap</div>
                    <button className={`toggle-btn ${wordWrap ? 'on' : ''}`} onClick={() => setWordWrap(v => !v)}>{wordWrap ? 'Enabled' : 'Disabled'}</button>
                  </div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div className="settings-label">Auto-Debug</div>
                    <button className={`toggle-btn ${autoDebugEnabled ? 'on' : ''}`} onClick={() => setAutoDebugEnabled(v => !v)}>{autoDebugEnabled ? 'Enabled' : 'Disabled'}</button>
                  </div>
                  <div style={{ borderTop: '1px solid var(--vscode-border)', paddingTop: 12, display: 'grid', gap: 10 }}>
                    <div className="settings-label">Keyboard Shortcuts</div>
                    <div className="shortcut-list">
                      <div className="shortcut-row"><span>Command Palette</span><kbd>Ctrl+Shift+P</kbd></div>
                      <div className="shortcut-row"><span>Quick Open</span><kbd>Ctrl+P</kbd></div>
                      <div className="shortcut-row"><span>Go to Line</span><kbd>Ctrl+G</kbd></div>
                      <div className="shortcut-row"><span>New File</span><kbd>Ctrl+N</kbd></div>
                      <div className="shortcut-row"><span>Run File</span><kbd>Ctrl+Enter</kbd></div>
                      <div className="shortcut-row"><span>Debug / Run</span><kbd>F5</kbd></div>
                      <div className="shortcut-row"><span>Save</span><kbd>Ctrl+S</kbd></div>
                      <div className="shortcut-row"><span>Terminal</span><kbd>Ctrl+`</kbd></div>
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--vscode-border)', paddingTop: 12, display: 'grid', gap: 10 }}>
                    <div className="settings-label">Project Insights</div>
                    <div style={{ color: 'var(--vscode-text)', fontSize: 13 }}>Files open: {projectInsights.fileCount}</div>
                    <div style={{ color: 'var(--vscode-text)', fontSize: 13 }}>Total lines: {projectInsights.lineCount}</div>
                    <div style={{ color: 'var(--vscode-text)', fontSize: 13 }}>TODO / FIXME notes: {projectInsights.todoCount}</div>
                    {projectInsights.largeFiles.length > 0 && (
                      <div style={{ color: 'var(--vscode-text-dim)', fontSize: 12 }}>
                        Large files: {projectInsights.largeFiles.join(', ')}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <button className="run-btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setActivityPanel('search')}>
                      <Search size={12} /> Review search & code health
                    </button>
                    <button className="run-btn" style={{ width: '100%', justifyContent: 'center' }} onClick={runAIOptimizer} disabled={!activeFile}>
                      <Zap size={12} /> AI Optimize Current File
                    </button>
                  </div>
                </div>
              </>
            )}
          </Panel>
          <PanelResizeHandle className="resize-handle" />

          <Panel defaultSize={56} minSize={30}>
            {!project ? (
              <div className="welcome-screen" style={{ padding: '10%', height: '100%', overflowY: 'auto', background: '#1e1e1e', color: '#cccccc' }}>
                <h1 style={{ fontSize: 36, fontWeight: 300, color: '#ffffff', marginBottom: 4 }}>Orbit IDE</h1>
                <p style={{ fontSize: 18, color: '#888', marginBottom: 40 }}>Editing evolved</p>

                <div style={{ display: 'flex', gap: 60, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 250, maxWidth: 400 }}>
                    <h2 style={{ fontSize: 13, textTransform: 'uppercase', color: '#ccc', marginBottom: 16 }}>Start</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <button className="welcome-link" onClick={() => setShowProjectPicker(true)}><Plus size={16} /> New Project...</button>
                      <button className="welcome-link" onClick={openLocalFolder}><FolderOpen size={16} /> Open Folder...</button>
                      <button className="welcome-link" onClick={() => window.open('https://github.com/new', '_blank')}><GitBranch size={16} /> Clone Git Repository...</button>
                    </div>

                    <h2 style={{ fontSize: 13, textTransform: 'uppercase', color: '#ccc', marginTop: 32, marginBottom: 16 }}>Recent</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {projects.map(p => (
                        <div key={p.id} className="welcome-recent-item" onClick={() => loadProject(p.id)}>
                          <span style={{ color: 'var(--vscode-accent)', fontSize: 13, cursor: 'pointer' }}>{p.name}</span>
                          <span style={{ color: '#666', fontSize: 11, marginLeft: 8 }}>/projects/{p.name}</span>
                        </div>
                      ))}
                      {projects.length === 0 && <span style={{ color: '#666', fontSize: 13 }}>No recent projects.</span>}
                    </div>
                  </div>

                  <div style={{ flex: 1, minWidth: 250 }}>
                    <h2 style={{ fontSize: 13, textTransform: 'uppercase', color: '#ccc', marginBottom: 16 }}>Walkthroughs</h2>
                    <div className="welcome-walkthrough" onClick={() => alert('Welcome to Orbit IDE! Stay tuned for interactive tutorials.')}>
                      <div className="icon-box" style={{ background: 'var(--vscode-accent)', color: '#fff', padding: 8, borderRadius: 4 }}><Rocket size={20} /></div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 14, color: '#fff', fontWeight: 500 }}>Get Started with Orbit IDE</h3>
                        <p style={{ margin: 0, fontSize: 12, color: '#888', marginTop: 4 }}>Customize your editor, learn the basics, and start coding.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <PanelGroup direction="vertical">
                <Panel defaultSize={70} minSize={20} style={{ display: 'flex', flexDirection: 'column' }}>
                  <div className="tabs-bar">
                    {openTabs.map(id => (
                      <div key={id} className={`tab ${activeFile === id ? 'active' : ''}`} onClick={() => setActiveFile(id)}>
                        {id === '__preview__' ? (
                          <><span className="file-icon-emoji">🌐</span> Preview</>
                        ) : (
                          <><span className="file-icon-emoji">{fileIcon(openFiles[id]?.name || '')}</span> {openFiles[id]?.name}</>
                        )}
                        <span className="tab-close" onClick={e => closeTab(id, e)}>✕</span>
                      </div>
                    ))}
                  </div>
                  <div className="breadcrumb">
                    <span>{project?.name}</span><ChevronRight size={12} />
                    <span>{activeFileData?.path ? activeFileData.path + '/' : ''}{activeFileData?.name}</span>
                    <div style={{ flex: 1 }} />
                    {Object.keys(previewPorts).length > 0 && (
                      <button className={`toggle-btn ${activeFile === '__preview__' ? 'on' : ''}`} style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => {
                        if (!openTabs.includes('__preview__')) setOpenTabs([...openTabs, '__preview__']);
                        setActiveFile('__preview__');
                      }}>
                        Browser Preview
                      </button>
                    )}
                  </div>
                  <div className="editor-container" style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                    {activeFile === '__preview__' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
                        <div style={{ padding: '6px 12px', background: '#f1f1f1', borderBottom: '1px solid #ddd', display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: '#333', fontSize: 12, fontWeight: 600 }}>Browser Preview</span>
                          <select
                            style={{ fontSize: 11, padding: '2px 4px', border: '1px solid #ccc', borderRadius: 4, flex: 1 }}
                            onChange={(e) => {
                              const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
                              if (iframe) iframe.src = e.target.value;
                            }}
                          >
                            {Object.entries(previewPorts).map(([internal, mapped]) => (
                              <option key={internal} value={`http://localhost:${mapped}`} selected={internal === '8080/tcp'}>Port {internal} (→ {mapped})</option>
                            ))}
                          </select>
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555' }} onClick={() => {
                            const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
                            if (iframe) iframe.src = iframe.src;
                          }}>↻</button>
                        </div>
                        <iframe
                          id="preview-iframe"
                          src={`http://localhost:${previewPorts['8080/tcp'] || previewPorts['3000/tcp'] || Object.values(previewPorts)[0]}`}
                          style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
                        />
                      </div>
                    ) : activeFileData ? (
                      <Editor height="calc(100% - 10px)" language={activeLang} theme="vs-dark"
                        path={activeFile} value={activeFileData.value || ''}
                        onChange={updateActiveFileContent}
                        onMount={(editor, monaco) => {
                          editorRef.current = editor;
                          monacoRef.current = monaco;
                          bindYjs(editor, monaco, activeFile);

                          if (!(window as any).__monacoAutocompleteRegistered) {
                            (window as any).__monacoAutocompleteRegistered = true;
                            monaco.languages.registerInlineCompletionsProvider('*', {
                              provideInlineCompletions: async (model, position, context, token) => {
                                const line = position.lineNumber;
                                const col = position.column;
                                const text = model.getValue();
                                const offset = model.getOffsetAt(position);
                                const prefix = text.substring(0, offset);
                                const suffix = text.substring(offset);

                                try {
                                  const res = await apiFetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/ai/autocomplete`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ prefix, suffix, language: model.getLanguageId() }),
                                    signal: token.isCancellationRequested ? undefined : (new AbortController()).signal
                                  });
                                  const data = await res.json();
                                  if (data.completion) {
                                    return {
                                      items: [{
                                        insertText: data.completion,
                                        range: new monaco.Range(line, col, line, col)
                                      }]
                                    };
                                  }
                                } catch (e) { }
                                return { items: [] };
                              },
                              freeInlineCompletions: (completions) => { }
                            });
                          }

                          editor.onDidChangeModelDecorations(() => {
                            const model = editor.getModel();
                            if (!model) return;
                            const markers = monaco.editor.getModelMarkers({ resource: model.uri });
                            setProblems(markers.map(m => ({ file: activeFileData.name, line: m.startLineNumber, col: m.startColumn, message: m.message, severity: m.severity === 8 ? 'error' : 'warning' })));
                          });
                        }}
                        options={{ fontSize, fontFamily: codeFont, fontLigatures: true, minimap: { enabled: minimapEnabled }, smoothScrolling: true, cursorBlinking: 'smooth', padding: { top: 12 }, wordWrap: wordWrap ? 'on' : 'off', scrollBeyondLastLine: false, lineNumbers: 'on', renderLineHighlight: 'all', bracketPairColorization: { enabled: true }, inlineSuggest: { enabled: true } }}
                      />
                    ) : (
                      <div className="editor-empty">
                        <div style={{ fontSize: 48 }}>⚡</div>
                        <div style={{ fontSize: 20, marginTop: 12, color: '#fff' }}>Orbit IDE</div>
                        <div style={{ fontSize: 12, marginTop: 8, color: 'var(--vscode-text-dim)' }}>Open or create a file to start coding</div>
                        <div style={{ fontSize: 11, marginTop: 16, color: '#555' }}>Ctrl+Shift+P — Command Palette</div>
                      </div>
                    )}
                  </div>
                </Panel>
                <PanelResizeHandle className="resize-handle horizontal" />
                <Panel defaultSize={30} minSize={15}>
                  <div className="bottom-tabs">
                    <span className={`bottom-tab ${bottomTab === 'terminal' ? 'active' : ''}`} onClick={() => setBottomTab('terminal')}>TERMINAL</span>
                    <span className={`bottom-tab ${bottomTab === 'problems' ? 'active' : ''}`} onClick={() => setBottomTab('problems')}>
                      PROBLEMS {(errorCount > 0 || warnCount > 0) && <span className="problem-badge" style={{ background: errorCount > 0 ? '#f44336' : '#e3b341' }}>{errorCount + warnCount}</span>}
                    </span>
                    <span className={`bottom-tab ${bottomTab === 'output' ? 'active' : ''}`} onClick={() => setBottomTab('output')}>OUTPUT</span>
                    <span className={`bottom-tab ${bottomTab === 'chaos' ? 'active' : ''}`} onClick={() => setBottomTab('chaos')}>
                      CHAOS {chaosResults && <span className="problem-badge" style={{ background: chaosResults.resilienceScore >= 70 ? '#2ea043' : '#e3b341' }}>{chaosResults.resilienceScore}%</span>}
                    </span>
                  </div>
                  <div className="terminal-panel" style={{ display: bottomTab === 'terminal' ? 'flex' : 'none' }}>
                    <div className="terminal-command-row">
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button className="icon-btn" title="New Terminal" onClick={newTerminal}>New</button>
                        <button className="icon-btn" title="Split Terminal" onClick={splitTerminal}>{isSplit ? 'Unsplit' : 'Split'}</button>
                        <button className="icon-btn" title="Kill Terminal" onClick={killTerminal}>Kill</button>
                        <button className="icon-btn" title="Clear Terminal" onClick={clearTerminal}>Clear</button>
                        <button className="icon-btn" title="Switch shell" onClick={toggleTerminalMode}>Mode: {terminalMode}</button>
                      </div>
                      <input
                        className="terminal-command-input"
                        value={terminalCommand}
                        onChange={e => setTerminalCommand(e.target.value)}
                        onKeyDown={handleTerminalCommandKeyDown}
                        placeholder="Run commands: help, run, open app.js, search foo, toggle minimap"
                      />
                      <button className="icon-btn" title="Execute command" onClick={executeTerminalCommand}>Run</button>
                    </div>
                    <div className="terminal-split" style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0, overflow: 'hidden' }}>
                      <div ref={terminalRef} className="terminal-host" style={{ flex: 1, overflow: 'hidden', minHeight: 0 }} />
                      {isSplit && <div ref={splitRef} className="terminal-host" style={{ flex: 1, overflow: 'hidden', minHeight: 0 }} />}
                    </div>
                  </div>
                  {bottomTab === 'problems' && (
                    <div className="problems-host">
                      {!problems.length && <div style={{ color: 'var(--vscode-text-dim)' }}>✓ No problems detected.</div>}
                      {problems.map((p, i) => (
                        <div key={i} className={`problem-row ${p.severity}`}>
                          <span>{p.severity === 'error' ? '✖' : '⚠'}</span>
                          <span className="problem-file">{p.file}:{p.line}:{p.col}</span>
                          <span>{p.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {bottomTab === 'output' && <div className="problems-host">{runOutput || 'No output yet.'}</div>}
                  {bottomTab === 'chaos' && (
                    <div className="problems-host">
                      {isChaosRunning && <div style={{ color: 'var(--vscode-text-dim)' }}>⏳ Running chaos scenarios in parallel...</div>}
                      {chaosResults?.error && <div style={{ color: '#f44336' }}>{chaosResults.error}</div>}
                      {chaosResults && !chaosResults.error && (
                        <>
                          <div className="chaos-score" style={{ color: chaosResults.resilienceScore >= 70 ? '#4caf50' : chaosResults.resilienceScore >= 40 ? '#e3b341' : '#f44336' }}>
                            Resilience Score: {chaosResults.resilienceScore}% ({chaosResults.survived}/{chaosResults.total} scenarios survived)
                          </div>
                          {chaosResults.results.map((r, i) => (
                            <div key={i} className={`chaos-row ${r.survived ? 'survived' : r.killed ? 'killed' : 'failed'}`}>
                              <span className="chaos-icon">{r.survived ? '✅' : r.killed ? '💀' : '❌'}</span>
                              <span className="chaos-scenario">{r.scenario}</span>
                              <span className="chaos-time">{r.elapsed}ms</span>
                              <div className="chaos-output">{r.output.slice(0, 120)}{r.output.length > 120 ? '...' : ''}</div>
                            </div>
                          ))}
                        </>
                      )}
                      {!chaosResults && !isChaosRunning && <div style={{ color: 'var(--vscode-text-dim)' }}>Click "Chaos Test" to stress-test your code under real failure conditions.</div>}
                    </div>
                  )}
                </Panel>
              </PanelGroup>
            )}
          </Panel>

          {showAIPanel && (
            <>
              <PanelResizeHandle className="resize-handle" />
              <Panel defaultSize={30} minSize={20} maxSize={45}>
                <div className="ai-chat-panel">
                  <div className="sidebar-header">
                    <span className="sidebar-title-text">AI ASSISTANT</span>
                    <div style={{ flex: 1 }} />
                    <button className="icon-btn" onClick={() => setChatSidebarOpen(!chatSidebarOpen)} title="Chat History" style={{ marginLeft: 4 }}>
                      <Menu size={14} />
                    </button>
                  </div>
                  <div className="ai-tabs">
                    <button className={`ai-tab ${aiTab === 'chat' ? 'active' : ''}`} onClick={() => setAiTab('chat')}>Chat</button>
                    <button className={`ai-tab ${aiTab === 'history' ? 'active' : ''}`} onClick={() => setAiTab('history')}>Debug History</button>
                  </div>
                  {chatSidebarOpen && (
                    <div className="chat-history-dropdown">
                      <div className="chat-history-header">
                        <span style={{ fontSize: '11px', fontWeight: 600 }}>PAST CHATS</span>
                        <button className="icon-btn" onClick={createNewChat} title="New Chat"><Plus size={14} /></button>
                      </div>
                      <div className="chat-history-list">
                        {chatSessions.map(s => (
                          <div key={s.id} className={`chat-session-item ${activeSessionId === s.id ? 'active' : ''}`} onClick={() => setActiveSessionId(s.id)}>
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
                  )}

                  {aiTab === 'history' ? (
                    <div className="debug-history-panel">
                      {debugHistory.length === 0 ? (
                        <div className="debug-history-empty">No auto-debug cycles yet.</div>
                      ) : (
                        debugHistory.map((h, i) => (
                          <div key={i} className={`debug-history-item status-${h.status}`}>
                            <div className="debug-history-header">
                              <span className="attempt">Attempt {h.attempt} / 3</span>
                              <span className="file">{h.file}</span>
                              <span className={`status-badge ${h.status}`}>{h.status}</span>
                            </div>
                            <div className="debug-history-error">
                              <strong>Error:</strong>
                              <pre>{h.error}</pre>
                            </div>
                            {h.explanation && (
                              <div className="debug-history-explanation">
                                <strong>AI Reasoning:</strong>
                                <p>{h.explanation}</p>
                              </div>
                            )}
                            {h.diff && (
                              <div className="debug-history-diff">
                                <strong>Code Changes:</strong>
                                <pre>
                                  {h.diff.split('\n').map((line, idx) => (
                                    <div key={idx} className={`diff-line ${line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : ''}`}>
                                      {line}
                                    </div>
                                  ))}
                                </pre>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="chat-messages" ref={chatScrollRef}>
                        {chatMessages.map((m, i) => (
                          <div key={i} className={`chat-msg ${m.role}`}>
                            {m.role === 'assistant' ? (
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                            ) : (
                              m.content
                            )}
                          </div>
                        ))}
                        {chatLoading && (
                          <div className="chat-msg assistant" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></div>
                            <button onClick={() => abortControllerRef.current?.abort()} style={{ background: '#333', color: '#fff', border: '1px solid #555', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>
                              Stop
                            </button>
                          </div>
                        )}
                      </div>
                      {pendingAIAction && (
                        <div className="ai-review-panel">
                          <h4>Review Pending Action</h4>
                          <p><strong>Summary:</strong> {pendingAIAction.summary}</p>
                          <div className="ai-review-content">
                            {pendingAIAction.action === 'scaffold' && (
                              <ul>{pendingAIAction.data.items.map((f: any, i: number) => <li key={i}>{f.path ? f.path + '/' : ''}{f.name}</li>)}</ul>
                            )}
                            {pendingAIAction.action === 'delete' && (
                              <ul>{pendingAIAction.data.items.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
                            )}
                            {pendingAIAction.action === 'apply' && (
                              <div style={{ height: '200px' }}>
                                <DiffEditor
                                  original={pendingAIAction.originalCode}
                                  modified={pendingAIAction.data.code}
                                  language={getLang(pendingAIAction.data.fileName)}
                                  options={{ readOnly: true, minimap: { enabled: false } }}
                                />
                              </div>
                            )}
                          </div>
                          <div className="ai-review-actions">
                            <button onClick={rejectAIAction} style={{ background: '#e74c3c', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>Reject</button>
                            <button onClick={approveAIAction} style={{ background: '#2ecc71', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', marginLeft: '8px' }}>Approve</button>
                          </div>
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px' }}>
                        {currentSession && (
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ color: 'var(--vscode-accent)', fontSize: 11, fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{currentSession.name}</span>
                            <button className="icon-btn" onClick={() => {
                              setEditingSessionId(currentSession.id);
                              setEditSessionName(currentSession.name);
                              setChatSidebarOpen(true);
                            }} title="Edit Chat Name" style={{ marginLeft: 6 }}>
                              <Edit2 size={12} />
                            </button>
                          </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--vscode-input)', borderRadius: '24px', padding: '8px 16px', gap: '8px' }}>
                          <textarea className="chat-input" value={chatInput}
                            onChange={e => {
                              setChatInput(e.target.value);
                              e.target.style.height = 'auto';
                              e.target.style.height = Math.min(e.target.scrollHeight, 300) + 'px';
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                if (chatInput.trim()) {
                                  sendChatMessage();
                                  e.currentTarget.style.height = 'auto';
                                }
                              }
                            }}
                            rows={1}
                            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'inherit', resize: 'none', padding: '0', fontSize: '13px', alignSelf: 'center', maxHeight: '150px' }}
                            placeholder="Ask the AI..." />

                          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <button className="icon-btn" onClick={() => setShowModelMenu(!showModelMenu)} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', background: 'var(--vscode-bg)', padding: '4px 10px', borderRadius: '16px', color: 'var(--vscode-text-dim)' }}>
                              <span>{selectedModel.includes('pro') ? 'Pro' : selectedModel.includes('qwen') ? 'Ollama' : 'Flash'}</span>
                              <ChevronDown size={12} />
                            </button>

                            {showModelMenu && (
                              <div style={{ position: 'absolute', bottom: 'calc(100% + 10px)', right: 0, background: '#1e1e24', border: '1px solid #333', borderRadius: '12px', padding: '8px 0', width: '220px', zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column' }}>
                                {[
                                  { id: 'gemini-flash-lite-latest', title: 'Gemini', sub: 'Fastest answers' },
                                  { id: 'qwen2.5-coder:7b', title: 'Ollama (Qwen)', sub: 'Local processing' }
                                ].map(m => (
                                  <div key={m.id} onClick={() => { setSelectedModel(m.id); setShowModelMenu(false); }} style={{ padding: '8px 16px', cursor: 'pointer', background: selectedModel === m.id ? 'rgba(255,255,255,0.05)' : 'transparent', display: 'flex', alignItems: 'center' }}>
                                    <div style={{ width: '20px' }}>{selectedModel === m.id && <Check size={12} color="var(--vscode-accent)" />}</div>
                                    <div>
                                      <div style={{ fontSize: '12px', color: '#fff', fontWeight: selectedModel === m.id ? 'bold' : 'normal' }}>{m.title}</div>
                                      <div style={{ fontSize: '11px', color: '#aaa' }}>{m.sub}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <button className="icon-btn" onClick={sendChatMessage} disabled={chatLoading || !chatInput.trim()} style={{ color: (chatInput.trim() && !chatLoading) ? 'var(--vscode-accent)' : 'inherit' }}>
                            <Send size={16} />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>

      <footer className="status-bar">
        <span className={`docker-dot ${dockerStatus}`}>🐳 {dockerStatus}</span>
        <span className="health-badge" title="Project insights" onClick={openInsights}>
          📊 {projectInsights.fileCount} files · {projectInsights.todoCount} TODOs
        </span>
        {chaosResults && !chaosResults.error && (
          <span className="health-badge" title="Chaos resilience score" onClick={() => setBottomTab('chaos')}>
            💥 {chaosResults.resilienceScore}% resilient
          </span>
        )}
        <span className="spacer" />
        {errorCount > 0 && <span style={{ color: '#f48771' }}>✖ {errorCount} error{errorCount > 1 ? 's' : ''}</span>}
        {warnCount > 0 && <span style={{ color: '#e3b341' }}>⚠ {warnCount} warning{warnCount > 1 ? 's' : ''}</span>}
        {errorCount === 0 && warnCount === 0 && <span style={{ color: '#4caf50' }}>✓ No errors</span>}
        <span>{activeLang}</span>
        <span>UTF-8</span>
        <button className="status-btn" onClick={() => setFontSize(f => Math.max(f - 1, 10))}><Minus size={10} /></button>
        <span>{fontSize}px</span>
        <button className="status-btn" onClick={() => setFontSize(f => Math.min(f + 1, 24))}><Plus size={10} /></button>
        <button className="status-btn" onClick={() => setShowAIPanel(!showAIPanel)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: showAIPanel ? 'var(--vscode-accent)' : 'transparent', color: showAIPanel ? '#fff' : 'inherit' }}>
          <MessageSquare size={12} /> {showAIPanel ? 'Hide AI' : 'Show AI'}
        </button>
        <span className={chatLoading ? 'ai-status ai-status--thinking' : 'ai-status'}>{chatLoading ? 'AI: thinking…' : 'AI: ready'}</span>
      </footer>

      {gotoLineOpen && (
        <div className="goto-overlay" onClick={() => setGotoLineOpen(false)}>
          <div className="goto-box" onClick={e => e.stopPropagation()}>
            <label>Go to Line (Ctrl+G)</label>
            <input autoFocus type="number" min={1} value={gotoLineValue} placeholder="Line number..."
              onChange={e => setGotoLineValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') goToLine(); if (e.key === 'Escape') setGotoLineOpen(false); }} />
          </div>
        </div>
      )}

      {paletteOpen && (
        <div className="palette-overlay" onClick={() => setPaletteOpen(false)}>
          <div className="palette-box" onClick={e => e.stopPropagation()}>
            <input autoFocus className="palette-input" placeholder="Type a command, filename, or project..." value={paletteQuery}
              onChange={e => { setPaletteQuery(e.target.value); setPaletteIndex(0); }} onKeyDown={handlePaletteKeyDown} />
            <div className="palette-list">
              {filteredCommands.map((cmd, i) => (
                <div key={cmd.id} className={`palette-item ${i === paletteIndex ? 'active' : ''}`} onClick={() => runCommand(cmd)} onMouseEnter={() => setPaletteIndex(i)}>{cmd.label}</div>
              ))}
              {!filteredCommands.length && <div className="palette-empty">No matching commands.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
