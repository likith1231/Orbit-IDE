import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { io, type Socket } from 'socket.io-client';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Files, Search, ChevronRight, ChevronDown, LogOut, Command, Plus, FolderPlus, Trash2, Play, Pencil, Folder, FolderOpen, Zap, Bug, Minus, Settings, GitBranch, Layers, Square, RefreshCw, Rocket, ExternalLink, X, ShieldAlert, FileText, Download, Check, Edit2, MessageSquare, Sparkles, Eye, EyeOff, History, ArrowUp, Bot, Globe, Container, CirclePlay, Wand, MessageSquarePlus, LoaderCircle, CircleCheck, TriangleAlert, Info } from 'lucide-react';
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
import { authHeader, getUser, clearAuth, getToken } from './auth';
import './ide.css';
import { apiFetch, backendUrl, WS_URL } from './lib/apiFetch';
import TerminalPanel, { type TerminalPanelHandle } from './components/TerminalPanel';


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

type ProposedChanges = { writes: { path: string; content: string }[]; deletes: string[] };
type PendingChanges = { changes: ProposedChanges | null; run: string | null; summary: string; debugAttempt?: number };

const WELCOME_MESSAGE = "Hi! I'm **Orbit**, your Claude-powered coding agent. I can see every file in this project.\n\nTry asking:\n\n- *Build a REST API with login*\n- *Why does main.py crash?*\n- *Add tests for utils.js and run them*\n- Select code and press **Ctrl+I** to ask about it\n\nEvery change I propose is shown as a diff for you to accept first.";

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
  md: <SiMarkdown color="#519aba" size={14} />,
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

// Editor preferences survive reloads.
const SETTINGS_KEY = 'orbit_settings';
const savedSettings: Record<string, any> = (() => {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
})();
const pref = <T,>(key: string, fallback: T): T => (savedSettings[key] ?? fallback);

export type ThemeId = 'orbit' | 'midnight' | 'light';
export const THEMES: { id: ThemeId; label: string; swatch: string[] }[] = [
  { id: 'orbit', label: 'Orbit Dark', swatch: ['#0b0c12', '#141623', '#8b7bff'] },
  { id: 'midnight', label: 'Midnight', swatch: ['#000000', '#0d0d0d', '#3b82f6'] },
  { id: 'light', label: 'Daylight', swatch: ['#f5f6fa', '#ffffff', '#5b4cff'] },
];

// Monaco themes that match the app chrome.
function defineMonacoThemes(monaco: any) {
  const common = [
    { token: 'comment', foreground: '6b7394', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c792ea' },
    { token: 'string', foreground: 'a5e075' },
    { token: 'number', foreground: 'f78c6c' },
    { token: 'type', foreground: '82aaff' },
    { token: 'function', foreground: '82aaff' },
    { token: 'variable', foreground: 'e4e6f1' },
    { token: 'delimiter', foreground: '89ddff' },
    { token: 'tag', foreground: 'f07178' },
    { token: 'attribute.name', foreground: 'ffcb6b' },
  ];
  monaco.editor.defineTheme('orbit', {
    base: 'vs-dark', inherit: true, rules: common,
    colors: {
      'editor.background': '#0e0f17', 'editor.foreground': '#e4e6f1', 'editorLineNumber.foreground': '#3a3f58',
      'editorLineNumber.activeForeground': '#a9b0d6', 'editor.lineHighlightBackground': '#161827',
      'editor.selectionBackground': '#8b7bff40', 'editorCursor.foreground': '#a99dff', 'editorIndentGuide.background1': '#1c1f30',
      'editorWidget.background': '#141623', 'editorSuggestWidget.background': '#141623', 'minimap.background': '#0e0f17',
      'scrollbarSlider.background': '#ffffff14', 'scrollbarSlider.hoverBackground': '#ffffff24',
    },
  });
  monaco.editor.defineTheme('midnight', {
    base: 'vs-dark', inherit: true, rules: common,
    colors: {
      'editor.background': '#050505', 'editor.foreground': '#e6e6e6', 'editorLineNumber.foreground': '#333',
      'editorLineNumber.activeForeground': '#aaa', 'editor.lineHighlightBackground': '#111',
      'editor.selectionBackground': '#3b82f640', 'editorCursor.foreground': '#60a5fa', 'minimap.background': '#050505',
      'editorWidget.background': '#111', 'editorSuggestWidget.background': '#111',
    },
  });
  monaco.editor.defineTheme('light', {
    base: 'vs', inherit: true, rules: [],
    colors: { 'editor.background': '#ffffff', 'editor.lineHighlightBackground': '#f4f5fb', 'editorLineNumber.foreground': '#b4b8cc' },
  });
}

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
  newItemIn?: (folderPath: string) => void;
};

interface DebugHistoryEntry {
  attempt: number;
  file: string;
  error: string;
  explanation?: string;
  diff?: string;
  status: 'testing' | 'success' | 'failed';
}


function TreeNode({ node, depth, openFile, activeFile, expanded, toggleExpand, startRename, deleteItem, renamingFile, renameValue, setRenameValue, submitRename, renameInputRef, newItemIn }: TreeNodeProps) {
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
                  {newItemIn && <button className="file-action-btn" title="New file in folder" onClick={e => { e.stopPropagation(); newItemIn(child.fullPath); }}><Plus size={10} /></button>}
                  <button className="file-action-btn" onClick={e => { e.stopPropagation(); startRename(`folder:${child.id}`, child.name); }}><Pencil size={10} /></button>
                  <button className="file-action-btn" onClick={e => { e.stopPropagation(); deleteItem(child.id, child.name, true); }}><Trash2 size={10} /></button>
                </>
              )}
            </div>
            <div className={`tree-children ${isOpen ? 'expanded' : ''}`}>
              {isOpen && <TreeNode node={child} depth={depth + 1} openFile={openFile} activeFile={activeFile}
                expanded={expanded} toggleExpand={toggleExpand} startRename={startRename} deleteItem={deleteItem}
                renamingFile={renamingFile} renameValue={renameValue} setRenameValue={setRenameValue}
                submitRename={submitRename} renameInputRef={renameInputRef} newItemIn={newItemIn} />}
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
  const activeFileRef = useRef<string | null>(null);
  activeFileRef.current = activeFile;
  const openFilesRef = useRef<Record<string, OpenFile>>({});
  openFilesRef.current = openFiles;
  const [lastRunFile, setLastRunFile] = useState<string | null>(null);
  const [dockerStatus, setDockerStatus] = useState<'unknown' | 'checking' | 'running' | 'idle' | 'error'>('unknown');
  const [containers, setContainers] = useState<Array<{ Id: string; Names?: string[]; State: string }>>([]);
  const [activityPanel, setActivityPanel] = useState<'explorer' | 'search' | 'source' | 'debug' | 'docker' | 'extensions' | 'settings'>('explorer');
  const [bottomTab, setBottomTab] = useState<'terminal' | 'problems' | 'output' | 'chaos'>('terminal');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('orbit_model') || 'claude-opus-5-5');
  const [aiModels, setAiModels] = useState<{ id: string; label: string; sub: string }[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [backendIssue, setBackendIssue] = useState<null | 'unreachable' | 'outdated' | 'db' | 'ai'>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [deployState, setDeployState] = useState<'idle' | 'deploying' | 'deployed' | 'error'>('idle');
  const [deployUrl, setDeployUrl] = useState<string>('');
  const [deployContainerId, setDeployContainerId] = useState<string>('');
  const [previewPorts, setPreviewPorts] = useState<Record<string, string>>({});
  const [previewSrc, setPreviewSrc] = useState('');
  const [previewNonce, setPreviewNonce] = useState(0);
  useEffect(() => {
    const urls = Object.values(previewPorts);
    if (!urls.includes(previewSrc)) setPreviewSrc(previewPorts['terminal'] || previewPorts['8080'] || previewPorts['3000'] || urls[0] || '');
  }, [previewPorts, previewSrc]);
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
  const [newProjectTemplate, setNewProjectTemplate] = useState('python');
  const [templates, setTemplates] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    apiFetch('/api/projects/templates').then(r => r.json()).then(d => setTemplates(d.templates || [])).catch(() => {});
  }, []);
  const [fontSize, setFontSize] = useState<number>(pref('fontSize', 14));
  const [codeFont, setCodeFont] = useState<string>(pref('codeFont', CODE_FONTS[0].family));
  const [minimapEnabled, setMinimapEnabled] = useState<boolean>(pref('minimap', true));
  const [wordWrap, setWordWrap] = useState<boolean>(pref('wordWrap', true));
  const [theme, setTheme] = useState<ThemeId>(pref('theme', 'orbit'));
  const [paletteMode, setPaletteMode] = useState<'commands' | 'files'>('commands');
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [mdPreview, setMdPreview] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: 'info' | 'success' | 'error' }[]>([]);
  const toast = useCallback((text: string, kind: 'info' | 'success' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  const [gotoLineOpen, setGotoLineOpen] = useState(false);
  const [gotoLineValue, setGotoLineValue] = useState('');
  const [containerAction, setContainerAction] = useState<string | null>(null);
  const [debugSession, setDebugSession] = useState(false);
  const [extensionStates, setExtensionStates] = useState<Record<string, boolean>>(pref('extensions', { prettier: true, eslint: true, aiAssistant: true }));
  const [projectInsights, setProjectInsights] = useState({ fileCount: 0, lineCount: 0, todoCount: 0, largeFiles: [] as string[] });
  const terminalPanelRef = useRef<TerminalPanelHandle | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const runOutputRef = useRef('');
  const announcedPortsRef = useRef(new Set<string>());
  const stoppedByUserRef = useRef(false);
  const lastRunRef = useRef<{ fileId: string; path: string; language: string } | null>(null);
  const [gitDiff, setGitDiff] = useState<{ path: string; diff: string } | null>(null);
  const [newItemParent, setNewItemParent] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{ role: 'assistant', content: WELCOME_MESSAGE }]);
  const [autoDebugEnabled, setAutoDebugEnabled] = useState<boolean>(pref('autoDebug', true));
  const [runFailure, setRunFailure] = useState<{ code: number; output: string } | null>(null);
  const [debugHistory, setDebugHistory] = useState<DebugHistoryEntry[]>([]);
  const [chatSessions, setChatSessions] = useState<{ id: string, name: string }[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editSessionName, setEditSessionName] = useState('');
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const [aiTab, setAiTab] = useState<'chat' | 'history'>('chat');
  const [showAIPanel, setShowAIPanel] = useState<boolean>(pref('showAI', true));
  const autoDebugAttempts = useRef(0);
  const aiCompleteRef = useRef(false);
  const sendChatRef = useRef<((text?: string, selection?: string) => void) | null>(null);
  const pendingSelectionRef = useRef('');

  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [pendingAIAction, setPendingAIAction] = useState<PendingChanges | null>(null);
  const [reviewFile, setReviewFile] = useState<string | null>(null);
  const [reviewSeq, setReviewSeq] = useState(0);
  // Dispose the diff models of a finished review (they're kept alive while mounted, see DiffEditor).
  const disposeReviewModels = useCallback(() => {
    const m = monacoRef.current;
    m?.editor.getModels().forEach((model: any) => { if (model.uri.toString().includes(`review-${reviewSeq}-`)) setTimeout(() => model.dispose(), 0); });
    setReviewSeq(s => s + 1);
  }, [reviewSeq]);


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

  // Writes a line to the Run tab of the terminal panel.
  const runLog = useCallback((text: string) => terminalPanelRef.current?.writeRun(`${text}\r\n`), []);

  const fetchProjects = useCallback(async () => {
    const res = await apiFetch(`/api/projects`, { headers: authHeader() });
    const data = await res.json();
    setProjects(data.projects || []);
    return data.projects || [];
  }, []);

  const loadProject = useCallback(async (projectId) => {
    const res = await apiFetch(`/api/projects/${projectId}`, { headers: authHeader() });
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
    fetchProjects().then((list) => {
      // Reopen the most recent project instead of landing on an empty screen.
      if (list.length && !project) loadProject(list[0].id);
    });
    // Detect a backend that's unreachable or still running old code.
    apiFetch('/api/health').then(async (r) => {
      const data = await r.json().catch(() => null);
      if (!data || !data.version) setBackendIssue('outdated');
      else if (!data.db) setBackendIssue('db');
      else if (!data.ai) setBackendIssue('ai');
      else setBackendIssue(null);
    }).catch(() => setBackendIssue('unreachable'));
    apiFetch('/api/ai/models').then(r => r.json()).then((data) => {
      setAiEnabled(!!data.enabled);
      setAiModels(data.models || []);
      if (data.models?.length && !data.models.some(m => m.id === localStorage.getItem('orbit_model'))) setSelectedModel(data.models[0].id);
    }).catch(() => setAiEnabled(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { localStorage.setItem('orbit_model', selectedModel); }, [selectedModel]);
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        fontSize, codeFont, minimap: minimapEnabled, wordWrap, theme, extensions: extensionStates, autoDebug: autoDebugEnabled, showAI: showAIPanel,
      }));
    } catch { /* storage unavailable */ }
  }, [fontSize, codeFont, minimapEnabled, wordWrap, theme, extensionStates, autoDebugEnabled, showAIPanel]);

  useEffect(() => {
    document.documentElement.style.setProperty('--code-font', codeFont);
  }, [codeFont]);

  const yRoomRef = useRef<{ room: string; model: any } | null>(null);
  const bindYjs = useCallback((editor: any, _monaco: any, fileId: string) => {
    if (!project) return;
    const model = editor.getModel();
    const roomName = `${project.id}-${fileId}`;
    // Already bound to this file's model (onMount and the activeFile effect both call us).
    if (yRoomRef.current && yRoomRef.current.room === roomName && yRoomRef.current.model === model) return;

    // Tear down the previous binding completely. (Not clearing these refs used to leave the
    // new connection thinking a binding already existed, so it never attached.)
    yBindingRef.current?.destroy();
    yProviderRef.current?.destroy();
    ydocRef.current?.destroy();
    yBindingRef.current = null;
    yProviderRef.current = null;
    ydocRef.current = null;
    yRoomRef.current = null;
    if (!model) return;

    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(`${WS_URL}/yjs`, roomName, ydoc, { params: { token: getToken() || '' } });
    ydocRef.current = ydoc;
    yProviderRef.current = provider;
    yRoomRef.current = { room: roomName, model };
    const ytext = ydoc.getText('monaco');

    // Wait for the initial sync from the server before binding Monaco, so the editor
    // isn't wiped by an initially empty local ytext. 'synced' fires again on reconnect.
    provider.on('synced', (isSynced: boolean) => {
      if (!isSynced || yProviderRef.current !== provider || yBindingRef.current) return;
      if (model.isDisposed?.()) return;
      // A room nobody has opened yet is empty: seed it with what the editor shows.
      if (ytext.length === 0 && model.getValue().length > 0) ytext.insert(0, model.getValue());
      yBindingRef.current = new MonacoBinding(ytext, model, new Set([editor]), provider.awareness);
    });
  }, [project]);

  useEffect(() => {
    if (activeFile && activeFile !== '__preview__' && editorRef.current && monacoRef.current) {
      bindYjs(editorRef.current, monacoRef.current, activeFile);
    }
  }, [activeFile, bindYjs]);

  // One authenticated socket for terminals, program I/O and live file updates.
  useEffect(() => {
    const s = io(backendUrl(''), { auth: { token: getToken() }, transports: ['websocket', 'polling'] });
    socketRef.current = s;
    setSocket(s);
    s.on('connect', () => setSocketConnected(true));
    s.on('disconnect', () => setSocketConnected(false));
    s.on('connect_error', (err) => {
      setSocketConnected(false);
      if (err.message === 'unauthorized') { clearAuth(); navigate('/login'); }
    });
    s.on('sandbox-output', (d: string) => {
      runOutputRef.current = (runOutputRef.current + d).slice(-20000);
    });
    s.on('sandbox-exit', ({ code, error }: { code?: number; error?: string }) => {
      if (error) runLog(`\r\n\x1b[31m✖ Sandbox exited with error: ${error}\x1b[0m`);
      else runLog(`\r\n\x1b[${code === 0 ? '36m✔ Program finished' : `31m✖ Program exited with code ${code}`}\x1b[0m`);
      setIsRunning(false);
      setSandboxId(null);
      if (code && code !== 0 && !stoppedByUserRef.current) setRunFailure({ code, output: runOutputRef.current });
      stoppedByUserRef.current = false;
    });
    s.on('sandbox-ports', (ports: Record<string, string>) => {
      const urls = Object.fromEntries(Object.entries(ports).map(([port, path]) => [port, backendUrl(path)]));
      // Side effects stay outside the state updater (React may call updaters twice).
      const fresh = Object.keys(urls).filter(port => !announcedPortsRef.current.has(port));
      fresh.forEach(port => {
        announcedPortsRef.current.add(port);
        runLog(`\x1b[35m► App is listening on port ${port} — opened in the Preview tab\x1b[0m`);
      });
      setPreviewPorts(urls);
      if (fresh.length) {
        setOpenTabs(t => t.includes('__preview__') ? t : [...t, '__preview__']);
        setActiveFile('__preview__');
      }
    });
    return () => { s.disconnect(); socketRef.current = null; setSocket(null); };
  }, [runLog, navigate]);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await apiFetch(`/api/containers/list`);
        const data = await res.json();
        if (!res.ok) { setDockerStatus('error'); return; }
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
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setPaletteMode('commands'); setPaletteOpen(true); setPaletteQuery(''); setPaletteIndex(0); }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setPaletteMode('files'); setPaletteOpen(true); setPaletteQuery(''); setPaletteIndex(0); }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); setSidebarVisible(v => !v); }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'v' && activeFile && openFiles[activeFile]?.name.endsWith('.md')) { e.preventDefault(); setMdPreview(v => !v); }
      if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); setActivityPanel('explorer'); setShowNewItem('file'); }
      if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); setGotoLineOpen(true); setGotoLineValue(''); }
      if (e.key === 'Escape') { setPaletteOpen(false); setRenamingFile(null); setShowProjectPicker(false); setGotoLineOpen(false); setUserMenuOpen(false); setShowModelMenu(false); }
      if (mod && e.key === 's') { e.preventDefault(); if (activeFile && openFiles[activeFile]) { clearTimeout(saveTimeout.current); saveFile(activeFile, openFiles[activeFile].value, true); } }
      if (mod && e.key.toLowerCase() === 'i' && !e.shiftKey) { e.preventDefault(); setShowAIPanel(true); setTimeout(() => (document.querySelector('.chat-input') as HTMLTextAreaElement | null)?.focus(), 50); }
      if (mod && e.key === 'w') { e.preventDefault(); if (activeFile) closeTab(activeFile, { stopPropagation: () => { } }); }
      if (mod && e.key === '`') { e.preventDefault(); setBottomTab('terminal'); terminalPanelRef.current?.showShell(); }
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
    runLog('\x1b[36m▶ Debugger is ready. Run your file with F5.\x1b[0m');
    setChatMessages(m => [...m, { role: 'assistant', content: 'Debugger ready. Use F5 or the Run button to start a session.' }]);
  };

  const toggleExtension = (key: string) => {
    setExtensionStates(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const runAIOptimizer = () => {
    if (!activeFile || !openFiles[activeFile]) return;
    sendChatMessage(`Optimize ${relPath(openFiles[activeFile])} for readability and performance without changing its behavior.`);
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
      await apiFetch(`/api/containers/${id}/${action}`, { method: 'POST' });
      const res = await apiFetch(`/api/containers/list`);
      const data = await res.json();
      setContainers(data.containers || []);
    } catch {
      runLog(`\x1b[31mFailed to ${action} container.\x1b[0m`);
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

  const saveFile = useCallback(async (fileId: string | null, content: string, format = false) => {
    if (!project || !fileId || fileId === '__preview__') return;
    setSaveStatus('saving');

    let finalContent = content;
    if (format && extensionStates['prettier']) {
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
            if (finalContent !== content) {
              setOpenFiles(f => ({ ...f, [fileId]: { ...f[fileId], value: finalContent } }));
              // Push the formatted text through the editor so Yjs collaborators see it too.
              const model = activeFile === fileId ? editorRef.current?.getModel() : null;
              if (model) model.pushEditOperations([], [{ range: model.getFullModelRange(), text: finalContent }], () => null);
            }
          }
        }
      } catch (e) { console.warn('Prettier formatting failed', e); }
    }

    try {
      const res = await apiFetch(`/api/projects/${project.id}/files/${fileId}`, {
        method: 'PUT', body: JSON.stringify({ content: finalContent }),
      });
      setSaveStatus(res.ok ? 'saved' : 'unsaved');
      if (res.ok) setAllFiles(prev => prev.map(f => (f.id === fileId ? { ...f, content: finalContent } : f)));
    } catch { setSaveStatus('unsaved'); }
  }, [project, extensionStates, allFiles, activeFile]);

  const [gitStatus, setGitStatus] = useState<{ branch: string; files: { status: string; path: string }[] }>({ branch: '', files: [] });
  const [gitLogs, setGitLogs] = useState<any[]>([]);
  const [gitCommitMsg, setGitCommitMsg] = useState('');
  const [isGitLoading, setIsGitLoading] = useState(false);

  const refreshGit = useCallback(async () => {
    if (!project) return;
    try {
      const statusRes = await apiFetch(`/api/projects/${project.id}/git/status`, { headers: authHeader() });
      const statusData = await statusRes.json();
      setGitStatus({ branch: statusData.branch || '', files: statusData.files || [] });

      const logRes = await apiFetch(`/api/projects/${project.id}/git/log`, { headers: authHeader() });
      const logData = await logRes.json();
      setGitLogs(logData.logs || []);
    } catch (e) { console.error('Git error', e); }
  }, [project]);

  const commitGit = async () => {
    if (!project || !gitCommitMsg.trim()) return;
    setIsGitLoading(true);
    try {
      const res = await apiFetch(`/api/projects/${project.id}/git/commit`, {
        method: 'POST', body: JSON.stringify({ message: gitCommitMsg })
      });
      const data = await res.json();
      if (data.nothingToCommit) toast('Nothing to commit — working tree is clean.');
      else if (!data.success) toast(`Commit failed: ${data.error || 'unknown error'}`, 'error');
      else { toast('Committed ✓', 'success'); setGitCommitMsg(''); }
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
    if (extensionStates['eslint'] && project && /\.(m?jsx?|cjs)$/i.test(openFiles[activeFile]?.name || '')) {
      clearTimeout(lintTimeout.current);
      lintTimeout.current = setTimeout(async () => {
        try {
          const res = await apiFetch(`/api/projects/${project.id}/lint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader() },
            body: JSON.stringify({ code: value, fileName: openFiles[activeFile]?.name || 'file.js' })
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

  const refreshTree = useCallback(async (): Promise<FileEntry[] | undefined> => {
    if (!project) return;
    const res = await apiFetch(`/api/projects/${project.id}`);
    if (!res.ok) return;
    const data = await res.json();
    const files: FileEntry[] = data.project.files;
    setAllFiles(files);
    return files;
  }, [project]);

  // The editor is uncontrolled (a controlled `value` drops keystrokes when React lags behind
  // fast typing), so content changed from outside has to be pushed into Monaco's model.
  // The active file is skipped while Yjs is bound: the server already updates it through Yjs.
  const syncModel = useCallback((fileId: string, content: string) => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    if (fileId === activeFileRef.current && yBindingRef.current) return;
    const model = monaco.editor.getModel(monaco.Uri.parse(fileId));
    if (model && model.getValue() !== content) model.setValue(content);
  }, []);

  // Files changed outside the editor (terminal, git, AI): refresh the tree and any open
  // tabs that aren't being edited (the active one is kept in sync by Yjs).
  useEffect(() => {
    if (!socket || !project) return;
    const onChanged = async ({ projectId }: { projectId: string }) => {
      if (projectId !== project.id) return;
      const files = await refreshTree();
      if (!files) return;
      setOpenFiles(prev => {
        const next = { ...prev };
        for (const id of Object.keys(prev)) {
          const fresh = files.find(f => f.id === id);
          if (!fresh) { delete next[id]; continue; }
          if (id !== activeFileRef.current) {
            next[id] = { ...prev[id], value: fresh.content };
            syncModel(id, fresh.content);
          }
        }
        return next;
      });
      setOpenTabs(t => t.filter(id => id === '__preview__' || files.some(f => f.id === id)));
    };
    socket.on('files-changed', onChanged);
    return () => { socket.off('files-changed', onChanged); };
  }, [socket, project, refreshTree, syncModel]);

  const importFromWorkspace = async () => {
    if (!project) return;
    await apiFetch(`/api/projects/${project.id}/workspace/import`, { method: 'POST' });
    await refreshTree();
  };

  const downloadProject = async () => {
    if (!project) return;
    const res = await apiFetch(`/api/projects/${project.id}/download`);
    if (!res.ok) { toast('Download failed.', 'error'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name}.tar.gz`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const stopSandbox = useCallback(async () => {
    if (!sandboxId) return;
    stoppedByUserRef.current = true;
    runLog('\x1b[33m► Stopping program...\x1b[0m');
    try {
      await apiFetch(`/api/run/stop`, { method: 'POST', body: JSON.stringify({ containerId: sandboxId }) });
    } catch (e) {
      console.error(e);
    } finally {
      setIsRunning(false);
      setSandboxId(null);
      setPreviewPorts({});
    }
  }, [sandboxId, runLog]);

  const relPath = (f: { path?: string; name: string }) => (f.path ? `${f.path}/${f.name}` : f.name);

  const runFile = useCallback(async (fileId?: string | null, fromAutoDebug = false) => {
    if (!fromAutoDebug) autoDebugAttempts.current = 0;
    let id = fileId ?? activeFile;
    const hasIndexHtml = allFiles.find(f => f.name === 'index.html' && !f.path);
    const hasPackageJson = allFiles.find(f => f.name === 'package.json' && !f.path);
    if (!id || id === '__preview__') {
      id = lastRunFile || allFiles.find(f => ['server.js', 'app.js', 'index.js', 'main.py', 'app.py'].includes(f.name))?.id || hasIndexHtml?.id;
    }
    // A static site with no package.json is served as a whole from index.html.
    const asHtml = allFiles.find(f => f.id === id)?.name.endsWith('.html') || (hasIndexHtml && !hasPackageJson && !RUNNABLE_LANGS.includes(getLang(allFiles.find(f => f.id === id)?.name)));
    if (asHtml && hasIndexHtml) id = hasIndexHtml.id;
    if (!id || id === '__preview__') return;
    const entry = allFiles.find(x => x.id === id);
    if (!entry || entry.isFolder) return;
    setLastRunFile(id);
    const name = entry.name;
    const language = asHtml ? 'html' : getLang(name);

    if (sandboxId) await stopSandbox();
    stoppedByUserRef.current = false;
    runOutputRef.current = '';
    announcedPortsRef.current = new Set();
    setRunFailure(null);
    lastRunRef.current = { fileId: id, path: relPath(entry), language };

    setIsRunning(true); setBottomTab('terminal'); setPreviewPorts({});
    terminalPanelRef.current?.showRun();
    terminalPanelRef.current?.clearRun();
    runLog(`\x1b[36m▶ Running ${relPath(entry)}...\x1b[0m`);
    try {
      const projectFiles = allFiles.map(f => ({
        name: f.name,
        path: f.path,
        isFolder: f.isFolder,
        content: f.isFolder ? '' : (openFiles[f.id]?.value ?? f.content)
      }));
      const res = await apiFetch(`/api/run`, {
        method: 'POST',
        body: JSON.stringify({ language, fileName: name, filePath: entry.path || '', projectFiles, socketId: socketRef.current?.id }),
      });
      const data = await res.json();
      if (data.containerId) {
        setSandboxId(data.containerId);
        setOpenTabs(t => t.filter(x => x !== '__preview__'));
      } else {
        runLog(`\x1b[31m✖ ${data.error || 'Could not start the program.'}\x1b[0m`);
        setIsRunning(false);
      }
    } catch {
      runLog('\x1b[31m✖ Could not reach the backend to run this file.\x1b[0m');
      setIsRunning(false);
    }
  }, [activeFile, openFiles, allFiles, sandboxId, stopSandbox, lastRunFile, runLog]);

  useEffect(() => {
    const handler = (e) => {
      const mod = navigator.platform.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 'Enter') { e.preventDefault(); runFile(activeFile); }
      if (e.key === 'F5') { e.preventDefault(); debugSession ? runFile(activeFile) : startDebugger(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeFile, debugSession, runFile]);

  // Ask Claude to fix a failed run, using the real program output. The fix is shown for review.
  const autoDebug = async (failure: { code: number; output: string }) => {
    const last = lastRunRef.current;
    if (!project || !last) return;
    const attempt = autoDebugAttempts.current + 1;
    autoDebugAttempts.current = attempt;
    const errorText = failure.output.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').slice(-8000);
    setShowAIPanel(true);
    setAiTab('chat');
    setChatMessages(m => [...m, { role: 'assistant', content: `⚠ \`${last.path}\` exited with code ${failure.code}. Asking Claude for a fix (attempt ${attempt})...` }]);
    setChatLoading(true);
    try {
      const res = await apiFetch(`/api/ai/debug`, {
        method: 'POST',
        body: JSON.stringify({ projectId: project.id, filePath: last.path, language: last.language, code: openFiles[last.fileId]?.value, error: errorText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDebugHistory(h => [...h, { attempt, file: last.path, error: errorText, explanation: data.explanation, status: data.changes ? 'testing' : 'failed' }]);
      if (data.changes) {
        setPendingAIAction({ changes: data.changes, run: last.path, summary: data.explanation || 'Proposed fix', debugAttempt: attempt });
      } else {
        setChatMessages(m => [...m, { role: 'assistant', content: data.explanation || 'Claude could not find a fix.' }]);
      }
    } catch (e: any) {
      setChatMessages(m => [...m, { role: 'assistant', content: `⚠ Auto-debug failed: ${e.message || 'AI backend unavailable.'}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  // A run just failed: offer a fix automatically (up to 3 tries in a row) when auto-debug is on.
  useEffect(() => {
    if (!runFailure) return;
    if (autoDebugEnabled && aiEnabled && autoDebugAttempts.current < 3) {
      const f = runFailure;
      setRunFailure(null);
      autoDebug(f);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFailure]);

  const runChaosTest = async () => {
    const file = openFiles[activeFile];
    if (!file) return;
    setIsChaosRunning(true); setChaosResults(null); setBottomTab('chaos');
    try {
      const res = await apiFetch(`/api/chaos`, {
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
    if (!pendingAIAction || !project) return;
    const { changes, run, debugAttempt } = pendingAIAction;
    setPendingAIAction(null);
    setReviewFile(null);
    disposeReviewModels();
    try {
      if (changes?.writes.length) {
        const items = changes.writes.map(w => {
          const i = w.path.lastIndexOf('/');
          return { name: i === -1 ? w.path : w.path.slice(i + 1), path: i === -1 ? '' : w.path.slice(0, i), isFolder: false, language: getLang(w.path), content: w.content };
        });
        const res = await apiFetch(`/api/projects/${project.id}/scaffold`, { method: 'POST', body: JSON.stringify({ items }) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        const written: FileEntry[] = json.files || [];
        setOpenFiles(f => {
          const next = { ...f };
          written.forEach(file => { next[file.id] = { name: file.name, path: file.path, language: getLang(file.name), value: file.content }; });
          return next;
        });
        written.forEach(file => syncModel(file.id, file.content));
        if (written.length) {
          setOpenTabs(t => [...new Set([...t, ...written.map(w => w.id)])]);
          setActiveFile(written[written.length - 1].id);
        }
      }
      for (const rel of changes?.deletes || []) {
        const target = allFiles.find(f => relPath(f) === rel);
        if (!target) continue;
        await apiFetch(`/api/projects/${project.id}/files/${target.id}`, { method: 'DELETE' });
        setOpenFiles(f => { const n = { ...f }; delete n[target.id]; return n; });
        setOpenTabs(t => t.filter(x => x !== target.id));
        if (activeFile === target.id) setActiveFile(null);
      }
      const files = await refreshTree();
      const parts: string[] = [];
      if (changes?.writes.length) parts.push(`wrote ${changes.writes.length} file${changes.writes.length > 1 ? 's' : ''}`);
      if (changes?.deletes.length) parts.push(`deleted ${changes.deletes.length}`);
      const msg = `✔ Applied: ${parts.join(', ') || 'no file changes'}.`;
      setChatMessages(m => [...m, { role: 'assistant', content: msg }]);
      if (activeSessionId) saveMessageToDb(activeSessionId, 'assistant', msg);
      if (debugAttempt) setDebugHistory(h => h.map(e => e.attempt === debugAttempt && e.status === 'testing' ? { ...e, status: 'success' } : e));
      if (run) {
        const target = (files || allFiles).find(f => relPath(f) === run);
        if (target) setTimeout(() => runFile(target.id, !!debugAttempt), 100);
      }
    } catch (e: any) {
      setChatMessages(m => [...m, { role: 'assistant', content: `⚠ Error applying changes: ${e.message || 'unknown error'}` }]);
    }
  };

  const rejectAIAction = () => {
    if (pendingAIAction?.debugAttempt) setDebugHistory(h => h.map(e => e.attempt === pendingAIAction.debugAttempt ? { ...e, status: 'failed' } : e));
    setPendingAIAction(null);
    setReviewFile(null);
    disposeReviewModels();
    setChatMessages(m => [...m, { role: 'assistant', content: '❌ Changes rejected.' }]);
  };

  const loadChatSessions = useCallback(async () => {
    if (!project) return;
    try {
      const res = await apiFetch(`/api/projects/${project.id}/chats`, { headers: authHeader() });
      if (res.ok) {
        const data = await res.json();
        setChatSessions(data.sessions);
      }
    } catch (e) { console.error('Failed to load chat sessions', e); }
  }, [project]);

  const loadChatMessages = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    try {
      const res = await apiFetch(`/api/chats/${sessionId}/messages`, { headers: authHeader() });
      if (res.ok) {
        const data = await res.json();
        const msgs = data.messages.map((m: any) => ({ role: m.role, content: m.content }));
        setChatMessages(msgs.length ? msgs : [{ role: 'assistant', content: WELCOME_MESSAGE }]);
      }
    } catch (e) { console.error('Failed to load messages', e); }
  }, []);

  const createNewChat = async () => {
    if (!project) return;
    try {
      const res = await apiFetch(`/api/projects/${project.id}/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ name: 'New Chat' })
      });
      if (res.ok) {
        const data = await res.json();
        setChatSessions(prev => [data.session, ...prev]);
        setActiveSessionId(data.session.id);
        setChatMessages([{ role: 'assistant', content: WELCOME_MESSAGE }]);
      }
    } catch (e) { console.error(e); }
  };

  const deleteChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await apiFetch(`/api/chats/${id}`, { method: 'DELETE', headers: authHeader() });
      if (res.ok) {
        setChatSessions(prev => prev.filter(s => s.id !== id));
        if (activeSessionId === id) {
          setActiveSessionId(null);
          setChatMessages([{ role: 'assistant', content: WELCOME_MESSAGE }]);
        }
      }
    } catch (err) { console.error(err); }
  };

  const renameChat = async (id: string, newName: string) => {
    try {
      const res = await apiFetch(`/api/chats/${id}`, {
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
      await apiFetch(`/api/chats/${sessionId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ role, content })
      });
    } catch (e) { }
  };

  // Send a message to Claude. Text streams in; proposed file changes arrive at the end for review.
  const sendChatMessage = async (overrideText?: string, selection?: string) => {
    const userText = (overrideText ?? chatInput).trim();
    if (!userText || chatLoading || !project) return;
    setShowAIPanel(true);
    setAiTab('chat');

    let currentSessionId = activeSessionId;
    if (!currentSessionId) {
      try {
        const res = await apiFetch(`/api/projects/${project.id}/chats`, {
          method: 'POST', body: JSON.stringify({ name: userText.slice(0, 40) + (userText.length > 40 ? '…' : '') })
        });
        if (res.ok) {
          const data = await res.json();
          currentSessionId = data.session.id;
          setActiveSessionId(currentSessionId);
          setChatSessions(prev => [data.session, ...prev]);
        }
      } catch { /* chat still works without history */ }
    }
    const shown = selection ? `${userText}\n\n\`\`\`\n${selection.slice(0, 2000)}${selection.length > 2000 ? '\n…' : ''}\n\`\`\`` : userText;
    if (currentSessionId) saveMessageToDb(currentSessionId, 'user', shown);

    const history = [...chatMessages.filter(m => m.content !== WELCOME_MESSAGE), { role: 'user' as const, content: userText }];
    setChatMessages(m => [...m, { role: 'user', content: shown }, { role: 'assistant', content: '' }]);
    if (overrideText === undefined) setChatInput('');
    setChatLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const setLastAssistant = (fn: (prev: string) => string) => setChatMessages(m => {
      const next = [...m];
      next[next.length - 1] = { role: 'assistant', content: fn(next[next.length - 1].content) };
      return next;
    });

    const activeData = activeFile && activeFile !== '__preview__' ? openFiles[activeFile] : null;
    let finalReply = '';
    try {
      const res = await apiFetch(`/api/ai/chat`, {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          projectId: project.id,
          messages: history,
          activeFile: activeData ? { path: relPath(activeData), content: activeData.value } : null,
          selection: selection || null,
          model: selectedModel,
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = frame.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue;
          const evt = JSON.parse(line.slice(6));
          if (evt.type === 'text') setLastAssistant(prev => prev + evt.text);
          else if (evt.type === 'error') throw new Error(evt.error);
          else if (evt.type === 'done') {
            finalReply = evt.reply;
            setLastAssistant(() => evt.reply);
            if (evt.changes) {
              setPendingAIAction({ changes: evt.changes, run: evt.run, summary: evt.reply });
              setReviewFile(evt.changes.writes[0]?.path || null);
            } else if (evt.run) {
              const target = allFiles.find(f => relPath(f) === evt.run);
              if (target) { openFile(target); setTimeout(() => runFile(target.id), 100); }
            }
          }
        }
      }
      if (currentSessionId && finalReply) saveMessageToDb(currentSessionId, 'assistant', finalReply);
    } catch (e: any) {
      const msg = e.name === 'AbortError' ? '⚠ Generation stopped.' : `⚠ ${e.message || 'Could not reach the AI backend.'}`;
      setLastAssistant(prev => (prev ? `${prev}\n\n${msg}` : msg));
      if (currentSessionId) saveMessageToDb(currentSessionId, 'assistant', msg);
    } finally {
      setChatLoading(false);
      abortControllerRef.current = null;
    }
  };

  // Accepts "name.js", or a path like "src/utils/name.js" (missing folders are created).
  sendChatRef.current = sendChatMessage;
  aiCompleteRef.current = aiEnabled && !!extensionStates.aiAssistant;

  const createItem = async (isFolder: boolean) => {
    const raw = newItemName.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!raw || !project) return;
    const full = newItemParent ? `${newItemParent}/${raw}` : raw;
    const i = full.lastIndexOf('/');
    const name = i === -1 ? full : full.slice(i + 1);
    const path = i === -1 ? '' : full.slice(0, i);
    try {
      const res = await apiFetch(`/api/projects/${project.id}/files`, {
        method: 'POST', body: JSON.stringify({ name, path, isFolder, language: getLang(name) }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Something went wrong', 'error'); return; }
      setNewItemName(''); setShowNewItem(null); setNewItemParent('');
      if (path) setExpanded(prev => { const n = new Set(prev); path.split('/').forEach((_, k, a) => n.add(a.slice(0, k + 1).join('/'))); return n; });
      await refreshTree();
      if (!isFolder) openFile(data.file);
    } catch { /* network error */ }
  };

  const deleteItem = async (id, name, isFolder) => {
    if (!window.confirm(`Delete ${isFolder ? 'folder' : 'file'} "${name}"${isFolder ? ' and everything inside?' : '?'}`)) return;
    await apiFetch(`/api/projects/${project.id}/files/${id}`, { method: 'DELETE', headers: authHeader() });
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
      if (!window.confirm(`Replace every "${searchQuery}" with "${replaceQuery}" in all project files?`)) return;
      const res = await apiFetch(`/api/projects/${project.id}/replace`, {
        method: 'POST',
        body: JSON.stringify({ q: searchQuery, replaceWith: replaceQuery })
      });
      const data = await res.json();
      if (data.success) {
        const files = await refreshTree();
        setOpenFiles(prev => {
          const next = { ...prev };
          for (const id of Object.keys(prev)) { const f = files?.find(x => x.id === id); if (f) { next[id] = { ...prev[id], value: f.content }; syncModel(id, f.content); } }
          return next;
        });
        toast(`Replaced in ${data.count} file${data.count === 1 ? '' : 's'}.`, 'success');
      }
    } catch (e) {
      console.error(e);
    }
  };


  const submitRename = async (id, isFolder) => {
    const newName = renameValue.trim();
    setRenamingFile(null);
    if (!newName) return;
    const res = await apiFetch(`/api/projects/${project.id}/files/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ name: newName }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Something went wrong', 'error'); return; }
    await refreshTree();
    if (!isFolder && openFiles[id]) setOpenFiles(f => ({ ...f, [id]: { ...f[id], name: newName, language: getLang(newName) } }));
  };

  const toggleExpand = (path) => {
    setExpanded(prev => { const next = new Set(prev); next.has(path) ? next.delete(path) : next.add(path); return next; });
  };

  const cloneRepo = async () => {
    const url = window.prompt('Public git repository URL (https://...)', 'https://github.com/');
    if (!url || url === 'https://github.com/') return;
    const res = await apiFetch('/api/projects/clone', { method: 'POST', body: JSON.stringify({ url }) });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Clone failed', 'error'); return; }
    toast(`Cloned ${data.project.name}`, 'success');
    await fetchProjects();
    loadProject(data.project.id);
    setShowProjectPicker(false);
  };

  const createProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    const res = await apiFetch(`/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ name, template: newProjectTemplate }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Could not create project', 'error'); return; }
    setNewProjectName('');
    await fetchProjects();
    loadProject(data.project.id);
    setShowProjectPicker(false);
  };

  const handleDeploy = async () => {
    if (!project) return;
    setDeployState('deploying');
    try {
      const res = await apiFetch(`/api/projects/${project.id}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Deploy failed');
      setDeployUrl(backendUrl(data.path));
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
      await apiFetch(`/api/projects/${project.id}/stop-deploy`, {
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
      const res = await apiFetch(`/api/projects/${id}`, {
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

  // Import a folder from the user's computer (Chrome/Edge File System Access API), including subfolders.
  const openLocalFolder = async () => {
    if (!(window as any).showDirectoryPicker) { toast('Opening local folders needs Chrome or Edge.', 'error'); return; }
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv', '.next']);
      const items: { name: string; path: string; isFolder: boolean; content?: string }[] = [];
      const walk = async (handle: any, path: string) => {
        for await (const entry of handle.values()) {
          if (items.length >= 800) return;
          if (entry.kind === 'directory') {
            if (SKIP.has(entry.name)) continue;
            items.push({ name: entry.name, path, isFolder: true });
            await walk(entry, path ? `${path}/${entry.name}` : entry.name);
          } else {
            const file = await entry.getFile();
            if (file.size > 500_000) continue;
            const text = await file.text();
            if (text.includes('\u0000')) continue; // binary
            items.push({ name: entry.name, path, isFolder: false, content: text });
          }
        }
      };
      toast(`Importing ${dirHandle.name}…`);
      await walk(dirHandle, '');
      const res = await apiFetch(`/api/projects`, { method: 'POST', body: JSON.stringify({ name: dirHandle.name, template: 'empty' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const projectId = data.project.id;
      await apiFetch(`/api/projects/${projectId}/scaffold`, { method: 'POST', body: JSON.stringify({ items }) });
      await fetchProjects();
      loadProject(projectId);
      toast(`Imported ${items.filter(i => !i.isFolder).length} files from ${dirHandle.name}`, 'success');
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast(`Could not open the folder: ${e?.message || 'unknown error'}`, 'error');
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
    { id: 'clone', label: 'Git: Clone Repository into New Project', action: cloneRepo },
    { id: 'download', label: 'Download Project (.tar.gz)', action: downloadProject },
    { id: 'sync', label: 'Sync Files Changed in Terminal', action: importFromWorkspace },
    { id: 'quick-open', label: 'Go to File…', action: () => { setTimeout(() => { setPaletteMode('files'); setPaletteOpen(true); setPaletteQuery(''); }, 0); } },
    { id: 'toggle-ai', label: `${showAIPanel ? 'Hide' : 'Show'} AI Assistant`, action: () => setShowAIPanel(v => !v) },
    { id: 'toggle-sidebar', label: 'Toggle Sidebar', action: () => setSidebarVisible(v => !v) },
    { id: 'new-chat', label: 'AI: New Chat', action: () => { setShowAIPanel(true); createNewChat(); } },
    ...THEMES.map(t => ({ id: `theme-${t.id}`, label: `Theme: ${t.label}`, action: () => setTheme(t.id) })),
    { id: 'md-preview', label: 'Markdown: Toggle Preview', action: () => setMdPreview(v => !v) },
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
    ...projects.map(p => ({ id: `switch-${p.id}`, label: `Switch to project: ${p.name}`, action: () => loadProject(p.id) })),
    { id: 'logout', label: 'Log Out', action: handleLogout },
  ], [allFiles, activeFile, projects, minimapEnabled, wordWrap, showAIPanel]);

  // Ctrl+P lists files (path shown as detail), Ctrl+Shift+P lists commands.
  const fileItems = useMemo(() => allFiles.filter(f => !f.isFolder).map(f => ({
    id: `open-${f.id}`, label: f.name, detail: f.path, icon: f.name, action: () => openFile(f),
  })), [allFiles]);
  const paletteItems: { id: string; label: string; detail?: string; icon?: string; action: () => void }[] = paletteMode === 'files' ? fileItems : commands;
  const fuse = useMemo(() => new Fuse(paletteItems, { keys: ['label', 'detail'], threshold: 0.4 }), [paletteItems]);
  const filteredCommands = (paletteQuery ? fuse.search(paletteQuery).map(r => r.item) : paletteItems).slice(0, 200);
  const runCommand = (cmd) => { cmd.action(); setPaletteOpen(false); };
  const handlePaletteKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteIndex(i => Math.min(i + 1, filteredCommands.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filteredCommands[paletteIndex]) runCommand(filteredCommands[paletteIndex]); }
  };

  const currentSession = chatSessions.find(s => s.id === activeSessionId);
  const runnableFiles = allFiles.filter(f => !f.isFolder && (RUNNABLE_LANGS.includes(getLang(f.name)) || f.name.endsWith('.html')));
  const isMarkdown = !!activeFileData?.name?.toLowerCase().endsWith('.md');
  const monacoTheme = theme;
  const userInitial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();
  const openPalette = (mode: 'commands' | 'files') => { setPaletteMode(mode); setPaletteOpen(true); setPaletteQuery(''); setPaletteIndex(0); };

  const TEMPLATE_META: Record<string, { icon: React.ReactNode; blurb: string }> = {
    python: { icon: <SiPython size={22} color="#3776AB" />, blurb: 'Script with input/output' },
    'node-express': { icon: <SiJavascript size={22} color="#F7DF1E" />, blurb: 'REST API with live preview' },
    flask: { icon: <SiPython size={22} color="#4fb8ff" />, blurb: 'Python web app' },
    'static-site': { icon: <SiHtml5 size={22} color="#E34F26" />, blurb: 'HTML, CSS & JavaScript' },
    cpp: { icon: <SiCplusplus size={22} color="#00599C" />, blurb: 'Compiled C++ program' },
    java: { icon: <FaJava size={22} color="#5382A1" />, blurb: 'Java with Scanner input' },
    blank: { icon: <FileText size={22} />, blurb: 'Start from scratch' },
  };

  const quickCreateProject = async (template: string) => {
    const label = templates.find(t => t.id === template)?.label || 'project';
    const name = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Math.random().toString(36).slice(2, 6)}`;
    const res = await apiFetch(`/api/projects`, { method: 'POST', body: JSON.stringify({ name, template }) });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Could not create project', 'error'); return; }
    await fetchProjects();
    loadProject(data.project.id);
    toast(`Created ${name}`, 'success');
  };

  const handleEditorMount = (editor: any, monaco: any) => {
    editor.onDidChangeCursorPosition((e: any) => setCursorPos({ line: e.position.lineNumber, col: e.position.column }));

                          editorRef.current = editor;
                          monacoRef.current = monaco;
                          bindYjs(editor, monaco, activeFileRef.current);

                          if (!(window as any).__monacoAutocompleteRegistered) {
                            (window as any).__monacoAutocompleteRegistered = true;
                            // Registered once per page, so it reads live settings through refs.
                            monaco.languages.registerInlineCompletionsProvider('*', {
                              provideInlineCompletions: async (model, position, _context, token) => {
                                if (!aiCompleteRef.current) return { items: [] };
                                // Debounce: only ask once typing pauses.
                                await new Promise(r => setTimeout(r, 450));
                                if (token.isCancellationRequested) return { items: [] };
                                const offset = model.getOffsetAt(position);
                                const text = model.getValue();
                                const prefix = text.substring(0, offset);
                                if (!prefix.trim()) return { items: [] };
                                const controller = new AbortController();
                                token.onCancellationRequested(() => controller.abort());
                                try {
                                  const res = await apiFetch(`/api/ai/autocomplete`, {
                                    method: 'POST',
                                    body: JSON.stringify({ prefix, suffix: text.substring(offset), language: model.getLanguageId() }),
                                    signal: controller.signal,
                                  });
                                  const data = await res.json();
                                  if (data.completion && !token.isCancellationRequested) {
                                    return { items: [{ insertText: data.completion, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] };
                                  }
                                } catch { /* cancelled or offline */ }
                                return { items: [] };
                              },
                              freeInlineCompletions: () => { },
                              disposeInlineCompletions: () => { },
                            } as any);
                          }

                          // Right-click / keyboard AI actions on the current selection.
                          const selectionText = () => {
                            const sel = editor.getSelection();
                            const m = editor.getModel();
                            return sel && m ? m.getValueInRange(sel) : '';
                          };
                          const aiAction = (id: string, label: string, prompt: string, keybinding?: number) => editor.addAction({
                            id, label, contextMenuGroupId: '0_orbit_ai', keybindings: keybinding ? [keybinding] : undefined,
                            run: () => {
                              const sel = selectionText();
                              if (prompt) sendChatRef.current?.(prompt, sel || undefined);
                              else {
                                setShowAIPanel(true);
                                pendingSelectionRef.current = sel;
                                setTimeout(() => (document.querySelector('.chat-input') as HTMLTextAreaElement | null)?.focus(), 50);
                              }
                            },
                          });
                          aiAction('orbit.ai.ask', 'Orbit AI: Ask About Selection', '', monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI);
                          aiAction('orbit.ai.explain', 'Orbit AI: Explain Selection', 'Explain what this code does, step by step.');
                          aiAction('orbit.ai.fix', 'Orbit AI: Find & Fix Bugs in Selection', 'Find bugs in this code and fix them in the file.');
                          aiAction('orbit.ai.tests', 'Orbit AI: Write Tests for Selection', 'Write unit tests for this code in an appropriate new test file.');
                          aiAction('orbit.ai.docs', 'Orbit AI: Add Documentation Comments', 'Add clear documentation comments to this code in the file. Do not change behavior.');

                          editor.onDidChangeModelDecorations(() => {
                            const model = editor.getModel();
                            if (!model) return;
                            const markers = monaco.editor.getModelMarkers({ resource: model.uri });
                            setProblems(markers.map(m => ({ file: openFilesRef.current[activeFileRef.current]?.name || '', line: m.startLineNumber, col: m.startColumn, message: m.message, severity: m.severity === 8 ? 'error' : 'warning' })));
                          });
  };

  return (
    <div className="ide-root" data-theme={theme}>
      {/* ───────────── Title bar ───────────── */}
      <header className="titlebar">
        <div className="titlebar-left">
          <div className="brand" title="Orbit IDE">
            <span className="brand-mark" />
            <span className="brand-name">Orbit</span>
          </div>
          <button className="project-switcher" onClick={() => setShowProjectPicker(v => !v)} title="Switch or create project">
            <Folder size={13} /> <span>{project?.name || 'No project'}</span> <ChevronDown size={12} />
          </button>
          {gitStatus.branch && project && (
            <span className="titlebar-branch" title="Current git branch"><GitBranch size={12} /> {gitStatus.branch}</span>
          )}
        </div>

        <button className="command-center" onClick={() => openPalette('files')} title="Go to file (Ctrl+P) · Commands (Ctrl+Shift+P)">
          <Search size={13} />
          <span>{project ? `Search ${project.name}` : 'Search files and commands'}</span>
          <kbd>Ctrl P</kbd>
        </button>

        <div className="titlebar-right">
          <span className={`save-pill ${saveStatus}`} title={saveStatus === 'saved' ? 'All changes saved' : saveStatus === 'saving' ? 'Saving…' : 'Unsaved changes'}>
            {saveStatus === 'saving' ? <LoaderCircle size={12} className="spin" /> : saveStatus === 'unsaved' ? <span className="dot" /> : <Check size={12} />}
            {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving' : 'Unsaved'}
          </span>
          <div className="run-cluster">
            {!isRunning ? (
              <button className="btn btn-run" onClick={() => runFile(activeFile)} disabled={!project || (!canRun && !runnableFiles.length)} title="Run (Ctrl+Enter)">
                <Play size={13} fill="currentColor" /> Run
              </button>
            ) : (
              <>
                <button className="btn btn-danger" onClick={stopSandbox} title="Stop program"><Square size={12} fill="currentColor" /> Stop</button>
                <button className="btn btn-ghost" onClick={() => runFile(activeFile)} title="Restart with latest changes"><RefreshCw size={13} /></button>
              </>
            )}
            <button className="btn btn-ghost" onClick={runChaosTest} disabled={isChaosRunning || !canRun} title="Chaos test: run under memory limits, CPU throttling, kills and network loss">
              {isChaosRunning ? <LoaderCircle size={13} className="spin" /> : <Zap size={13} />} Chaos
            </button>
            {deployState === 'deployed' ? (
              <>
                <a href={deployUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" title="Open deployment"><ExternalLink size={13} /> Live</a>
                <button className="btn btn-ghost" onClick={handleStopDeploy} title="Stop deployment"><Square size={12} /></button>
              </>
            ) : (
              <button className="btn btn-ghost" onClick={handleDeploy} disabled={!project || deployState === 'deploying'} title="Keep this project running with a shareable link">
                {deployState === 'deploying' ? <LoaderCircle size={13} className="spin" /> : <Rocket size={13} />} {deployState === 'deploying' ? 'Deploying' : 'Deploy'}
              </button>
            )}
          </div>
          <button className={`btn btn-icon ${showAIPanel ? 'is-on' : ''}`} onClick={() => setShowAIPanel(v => !v)} title="Toggle AI assistant (Ctrl+I to ask)">
            <Sparkles size={15} />
          </button>
          <div className="menu-anchor">
            <button className="avatar" onClick={() => setUserMenuOpen(v => !v)} title={user?.email || 'Account'}>{userInitial}</button>
            {userMenuOpen && (
              <div className="menu menu-right" onMouseLeave={() => setUserMenuOpen(false)}>
                <div className="menu-header">
                  <div className="menu-title">{user?.name || 'Signed in'}</div>
                  <div className="menu-sub">{user?.email}</div>
                </div>
                <button className="menu-item" onClick={() => { setActivityPanel('settings'); setUserMenuOpen(false); }}><Settings size={14} /> Settings</button>
                <button className="menu-item" onClick={() => { openPalette('commands'); setUserMenuOpen(false); }}><Command size={14} /> Command palette</button>
                <div className="menu-sep" />
                <button className="menu-item danger" onClick={handleLogout}><LogOut size={14} /> Log out</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {backendIssue && !bannerDismissed && (
        <div className={`backend-banner ${backendIssue === 'ai' ? 'warn' : 'error'}`}>
          <TriangleAlert size={14} />
          <span>
            {backendIssue === 'unreachable' && <>Can't reach the backend at <code>{backendUrl('')}</code>. Is it running? (<code>./dev.sh</code>)</>}
            {backendIssue === 'outdated' && <>The backend is running an <b>old version</b>. Restart it with <code>./dev.sh</code> (or <code>npm start</code> in <code>backend/</code>) — the terminal and AI won't work until then.</>}
            {backendIssue === 'db' && <>The backend can't reach its database. Check <code>DATABASE_URL</code> and run <code>npm run doctor</code> in <code>backend/</code>.</>}
            {backendIssue === 'ai' && <>AI is off: add <code>ANTHROPIC_API_KEY=sk-ant-…</code> to <code>backend/.env</code> and restart the backend.</>}
          </span>
          <button className="btn btn-icon btn-sm" onClick={() => setBannerDismissed(true)} title="Dismiss"><X size={14} /></button>
        </div>
      )}

      {showProjectPicker && (
        <>
          <div className="click-catcher" onClick={() => setShowProjectPicker(false)} />
          <div className="project-picker">
            <div className="menu-label">Projects</div>
            <div className="project-list">
              {projects.map(p => (
                <div key={p.id} className={`project-item ${project?.id === p.id ? 'active' : ''}`} onClick={() => { loadProject(p.id); setShowProjectPicker(false); }}>
                  <Folder size={13} />
                  <span className="project-item-name">{p.name}</span>
                  <button className="btn btn-icon btn-sm" onClick={(e) => deleteProject(p.id, e)} title="Delete project"><Trash2 size={13} /></button>
                </div>
              ))}
              {!projects.length && <div className="empty-hint">No projects yet.</div>}
            </div>
            <div className="menu-sep" />
            <div className="menu-label">New project</div>
            <div className="project-new-row">
              <input className="input" autoFocus placeholder="Project name" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createProject()} />
              <button className="btn btn-primary" onClick={createProject} disabled={!newProjectName.trim()}>Create</button>
            </div>
            {templates.length > 0 && (
              <div className="template-chips">
                {templates.map(t => (
                  <button key={t.id} className={`chip ${newProjectTemplate === t.id ? 'is-on' : ''}`} onClick={() => setNewProjectTemplate(t.id)}>
                    {TEMPLATE_META[t.id]?.icon && <span className="chip-icon">{TEMPLATE_META[t.id].icon}</span>} {t.label}
                  </button>
                ))}
              </div>
            )}
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => { setShowProjectPicker(false); cloneRepo(); }}><GitBranch size={14} /> Clone a Git repository…</button>
            <button className="menu-item" onClick={() => { setShowProjectPicker(false); openLocalFolder(); }}><FolderOpen size={14} /> Open a folder from this computer…</button>
          </div>
        </>
      )}

      <div className="ide-body">
        {/* ───────────── Activity bar ───────────── */}
        <nav className="activity-bar">
          {[
            { id: 'explorer', icon: <Files size={20} />, tip: 'Explorer' },
            { id: 'search', icon: <Search size={20} />, tip: 'Search' },
            { id: 'source', icon: <GitBranch size={20} />, tip: 'Source Control', badge: gitStatus.files.length || 0 },
            { id: 'debug', icon: <CirclePlay size={20} />, tip: 'Run & Debug' },
            { id: 'docker', icon: <Container size={20} />, tip: 'Containers' },
            { id: 'extensions', icon: <Layers size={20} />, tip: 'Extensions' },
          ].map(item => (
            <button key={item.id} className={`activity-icon ${activityPanel === item.id && sidebarVisible ? 'active' : ''}`}
              onClick={() => { if (activityPanel === item.id && sidebarVisible) setSidebarVisible(false); else { setActivityPanel(item.id as any); setSidebarVisible(true); } }}
              title={item.tip}>
              {item.icon}
              {!!item.badge && <span className="activity-badge">{item.badge > 99 ? '99+' : item.badge}</span>}
            </button>
          ))}
          <div className="activity-spacer" />
          <button className={`activity-icon ${showAIPanel ? 'active-soft' : ''}`} onClick={() => setShowAIPanel(v => !v)} title="AI assistant"><Bot size={20} /></button>
          <button className={`activity-icon ${activityPanel === 'settings' && sidebarVisible ? 'active' : ''}`} onClick={() => { setActivityPanel('settings'); setSidebarVisible(true); }} title="Settings"><Settings size={20} /></button>
        </nav>

        <PanelGroup direction="horizontal" className="main-panels" autoSaveId="orbit-layout">
          {sidebarVisible && (
            <>
              <Panel id="sidebar" order={1} defaultSize={17} minSize={12} maxSize={32} className="sidebar">
                {/* ── Explorer ── */}
                {activityPanel === 'explorer' && (
                  <>
                    <div className="panel-header">
                      <span className="panel-title">Explorer</span>
                      {project && (
                        <div className="panel-actions">
                          <button className="btn btn-icon btn-sm" onClick={() => { setNewItemParent(''); setShowNewItem(showNewItem === 'file' ? null : 'file'); }} title="New file (Ctrl+N) — type dir/name.js for nested files"><Plus size={15} /></button>
                          <button className="btn btn-icon btn-sm" onClick={() => { setNewItemParent(''); setShowNewItem(showNewItem === 'folder' ? null : 'folder'); }} title="New folder"><FolderPlus size={15} /></button>
                          <button className="btn btn-icon btn-sm" onClick={importFromWorkspace} title="Sync files changed in the terminal"><RefreshCw size={14} /></button>
                          <button className="btn btn-icon btn-sm" onClick={downloadProject} title="Download project (.tar.gz)"><Download size={14} /></button>
                          <button className="btn btn-icon btn-sm" onClick={() => { setExpanded(new Set()); }} title="Collapse folders"><Minus size={14} /></button>
                        </div>
                      )}
                    </div>
                    {!project ? (
                      <div className="empty-state">
                        <FolderOpen size={28} />
                        <p>No project open.</p>
                        <button className="btn btn-primary" onClick={() => setShowProjectPicker(true)}>Open a project</button>
                      </div>
                    ) : (
                      <>
                        {showNewItem && (
                          <div className="new-file-row">
                            {showNewItem === 'folder' ? <FolderPlus size={14} /> : <FileText size={14} />}
                            <input className="input input-sm" autoFocus value={newItemName}
                              onChange={e => setNewItemName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') createItem(showNewItem === 'folder'); if (e.key === 'Escape') setShowNewItem(null); }}
                              onBlur={() => { if (!newItemName.trim()) setShowNewItem(null); }}
                              placeholder={`${newItemParent ? newItemParent + '/' : ''}${showNewItem === 'folder' ? 'folder-name' : 'file.js  or  dir/file.js'}`} />
                          </div>
                        )}
                        <div className="file-tree">
                          <div className="tree-root" onClick={() => setIsRootExpanded(!isRootExpanded)}>
                            {isRootExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            <span>{project.name}</span>
                          </div>
                          {isRootExpanded && (
                            <TreeNode node={tree} depth={0} openFile={openFile} activeFile={activeFile}
                              expanded={expanded} toggleExpand={toggleExpand} startRename={startRename} deleteItem={deleteItem}
                              renamingFile={renamingFile} renameValue={renameValue} setRenameValue={setRenameValue}
                              submitRename={submitRename} renameInputRef={renameInputRef}
                              newItemIn={(folder) => { setNewItemParent(folder); setShowNewItem('file'); setExpanded(prev => new Set(prev).add(folder)); }} />
                          )}
                          {isRootExpanded && !allFiles.length && <div className="empty-hint">Empty project. Create a file with <Plus size={11} />, or ask the AI to build something.</div>}
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* ── Search ── */}
                {activityPanel === 'search' && (
                  <>
                    <div className="panel-header"><span className="panel-title">Search</span></div>
                    <div className="panel-body">
                      <div className="input-with-icon">
                        <Search size={13} />
                        <input className="input" placeholder="Search in project" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} autoFocus />
                      </div>
                      <div className="replace-row">
                        <input className="input" placeholder="Replace" value={replaceQuery} onChange={e => setReplaceQuery(e.target.value)} />
                        <button className="btn btn-ghost btn-sm" onClick={handleReplaceAll} disabled={!searchQuery} title="Replace all">Replace all</button>
                      </div>
                      {searchQuery && <div className="meta-line">{searchResults.length} result{searchResults.length === 1 ? '' : 's'}{searchResults.length >= 80 ? ' (first 80)' : ''}</div>}
                    </div>
                    <div className="search-results">
                      {searchResults.map((r, i) => (
                        <div key={i} className="search-result-row" onClick={() => jumpToSearchResult(r)}>
                          <div className="search-result-file"><span className="file-icon">{fileIcon(r.name)}</span>{r.name}<span className="line-no">:{r.line}</span></div>
                          <div className="search-result-text">{r.text}</div>
                        </div>
                      ))}
                      {searchQuery && !searchResults.length && <div className="empty-hint">No matches.</div>}
                    </div>
                  </>
                )}

                {/* ── Source control ── */}
                {activityPanel === 'source' && (
                  <>
                    <div className="panel-header">
                      <span className="panel-title">Source Control</span>
                      <div className="panel-actions"><button className="btn btn-icon btn-sm" title="Refresh" onClick={refreshGit}><RefreshCw size={14} /></button></div>
                    </div>
                    <div className="panel-body">
                      <textarea className="input commit-input" rows={2} placeholder={`Message (Ctrl+Enter to commit on ${gitStatus.branch || 'main'})`} value={gitCommitMsg}
                        onChange={e => setGitCommitMsg(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitGit(); } }} />
                      <button className="btn btn-primary btn-block" onClick={commitGit} disabled={!gitCommitMsg.trim() || isGitLoading}>
                        {isGitLoading ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />} Commit{gitStatus.files.length ? ` ${gitStatus.files.length} change${gitStatus.files.length > 1 ? 's' : ''}` : ''}
                      </button>
                    </div>
                    <div className="section-title">Changes <span className="count">{gitStatus.files.length}</span></div>
                    <div className="list">
                      {gitStatus.files.map(f => (
                        <div key={f.path} className="list-row" title="Show diff" onClick={async () => {
                          const res = await apiFetch(`/api/projects/${project!.id}/git/diff?path=${encodeURIComponent(f.path)}`);
                          const data = await res.json();
                          setGitDiff({ path: f.path, diff: data.diff || '(new file — no previous version)' });
                        }}>
                          <span className="file-icon">{fileIcon(f.path.split('/').pop())}</span>
                          <span className="list-row-main">{f.path.split('/').pop()}<span className="list-row-sub">{f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}</span></span>
                          <span className={`git-status-badge s-${f.status.replace('?', 'U').replace('?', '')}`}>{f.status === '??' ? 'U' : f.status}</span>
                        </div>
                      ))}
                      {!gitStatus.files.length && <div className="empty-hint">Working tree clean.</div>}
                    </div>
                    <div className="section-title">History</div>
                    <div className="list timeline">
                      {gitLogs.map((log, idx) => (
                        <div key={idx} className="timeline-row">
                          <span className="timeline-dot" />
                          <div>
                            <div className="timeline-title">{log.message}</div>
                            <div className="timeline-sub">{log.hash} · {log.time}</div>
                          </div>
                        </div>
                      ))}
                      {!gitLogs.length && <div className="empty-hint">No commits yet.</div>}
                    </div>
                  </>
                )}

                {/* ── Run & Debug ── */}
                {activityPanel === 'debug' && (
                  <>
                    <div className="panel-header"><span className="panel-title">Run &amp; Debug</span></div>
                    <div className="panel-body">
                      <button className="btn btn-run btn-block" onClick={() => runFile(activeFile)} disabled={!project || isRunning}>
                        <Play size={13} fill="currentColor" /> {isRunning ? 'Running…' : activeFileData && canRun ? `Run ${activeFileData.name}` : 'Run project'}
                      </button>
                      {isRunning && <button className="btn btn-danger btn-block" onClick={stopSandbox}><Square size={12} fill="currentColor" /> Stop</button>}
                    </div>
                    <div className="section-title">Runnable files <span className="count">{runnableFiles.length}</span></div>
                    <div className="list">
                      {runnableFiles.map(f => (
                        <div key={f.id} className={`list-row ${lastRunFile === f.id ? 'is-active' : ''}`} onClick={() => { openFile(f); runFile(f.id); }} title={`Run ${relPath(f)}`}>
                          <span className="file-icon">{fileIcon(f.name)}</span>
                          <span className="list-row-main">{f.name}<span className="list-row-sub">{f.path}</span></span>
                          <Play size={12} className="row-hover-icon" />
                        </div>
                      ))}
                      {!runnableFiles.length && <div className="empty-hint">No runnable files yet.</div>}
                    </div>
                    <div className="section-title">Options</div>
                    <div className="panel-body">
                      <label className="switch-row">
                        <span><b>AI auto-fix</b><small>When a run fails, Claude proposes a fix using the real error.</small></span>
                        <input type="checkbox" className="switch" checked={autoDebugEnabled} onChange={() => setAutoDebugEnabled(v => !v)} />
                      </label>
                      {runFailure && (
                        <button className="btn btn-ghost btn-block" onClick={() => { const f = runFailure; setRunFailure(null); autoDebugAttempts.current = 0; autoDebug(f); }}>
                          <Bug size={13} /> Fix the last failure with AI
                        </button>
                      )}
                      <button className="btn btn-ghost btn-block" onClick={runChaosTest} disabled={isChaosRunning || !canRun}><Zap size={13} /> Chaos-test the active file</button>
                      <div className="meta-line">Programs run in an isolated container (512 MB RAM, 1 CPU, 10 min). Type input for your program in the Run tab of the terminal.</div>
                    </div>
                  </>
                )}

                {/* ── Containers ── */}
                {activityPanel === 'docker' && (
                  <>
                    <div className="panel-header">
                      <span className="panel-title">Containers</span>
                      <span className={`status-chip ${dockerStatus}`}>{dockerStatus === 'error' ? 'Docker offline' : 'Docker online'}</span>
                    </div>
                    <div className="list">
                      {containers.map((c: any) => {
                        const kind = c.Kind || 'container';
                        const label = kind === 'terminal' ? 'Terminal workspace' : kind === 'sandbox' ? 'Program run' : kind === 'deploy' ? 'Deployment' : kind === 'chaos' ? 'Chaos test' : (c.Names?.[0] || '').replace(/^\//, '');
                        return (
                          <div key={c.Id} className="list-row container-row">
                            <span className={`state-dot ${c.State}`} />
                            <span className="list-row-main">{label}<span className="list-row-sub">{c.Image} · {c.Status || c.State}</span></span>
                            <button className="btn btn-ghost btn-sm" onClick={() => toggleContainer(c.Id, c.State)} disabled={containerAction === c.Id || dockerStatus === 'error'}>
                              {containerAction === c.Id ? <LoaderCircle size={12} className="spin" /> : c.State === 'running' ? 'Stop' : 'Start'}
                            </button>
                          </div>
                        );
                      })}
                      {!containers.length && dockerStatus !== 'error' && <div className="empty-hint">Nothing running. Containers appear here when you open a terminal, run code or deploy.</div>}
                      {dockerStatus === 'error' && <div className="empty-hint">The backend can't reach Docker. Start Docker and run <code>npm run doctor</code>.</div>}
                    </div>
                  </>
                )}

                {/* ── Extensions ── */}
                {activityPanel === 'extensions' && (
                  <>
                    <div className="panel-header"><span className="panel-title">Extensions</span></div>
                    <div className="list">
                      {[
                        { key: 'aiAssistant', title: 'Claude Inline Completions', by: 'Orbit', desc: 'Ghost-text suggestions as you type (Tab to accept).', icon: <Sparkles size={18} /> },
                        { key: 'prettier', title: 'Prettier', by: 'prettier.io', desc: 'Formats JS/TS, HTML, CSS, JSON and Markdown when you press Ctrl+S.', icon: <Wand size={18} /> },
                        { key: 'eslint', title: 'ESLint', by: 'eslint.org', desc: 'Live linting for JavaScript files, shown in Problems.', icon: <ShieldAlert size={18} /> },
                      ].map(item => (
                        <label key={item.key} className="ext-card">
                          <span className="ext-icon">{item.icon}</span>
                          <span className="ext-body">
                            <span className="ext-title">{item.title}</span>
                            <span className="ext-by">{item.by}</span>
                            <span className="ext-desc">{item.desc}</span>
                          </span>
                          <input type="checkbox" className="switch" checked={!!extensionStates[item.key]} onChange={() => toggleExtension(item.key)} />
                        </label>
                      ))}
                    </div>
                    <div className="panel-body">
                      <button className="btn btn-ghost btn-block" onClick={runAIOptimizer} disabled={!activeFile || activeFile === '__preview__'}><Sparkles size={13} /> Optimize the active file with AI</button>
                    </div>
                  </>
                )}

                {/* ── Settings ── */}
                {activityPanel === 'settings' && (
                  <>
                    <div className="panel-header"><span className="panel-title">Settings</span></div>
                    <div className="panel-scroll">
                      <div className="section-title">Theme</div>
                      <div className="theme-grid">
                        {THEMES.map(t => (
                          <button key={t.id} className={`theme-card ${theme === t.id ? 'is-on' : ''}`} onClick={() => setTheme(t.id)}>
                            <span className="theme-swatch" style={{ background: t.swatch[0] }}>
                              <span style={{ background: t.swatch[1] }} /><span style={{ background: t.swatch[2] }} />
                            </span>
                            {t.label}
                          </button>
                        ))}
                      </div>
                      <div className="section-title">Editor</div>
                      <div className="panel-body">
                        <div className="field">
                          <span>Font</span>
                          <select className="input" value={codeFont} onChange={e => setCodeFont(e.target.value)}>
                            {CODE_FONTS.map(f => <option key={f.id} value={f.family}>{f.label}</option>)}
                          </select>
                        </div>
                        <div className="field">
                          <span>Font size</span>
                          <div className="stepper">
                            <button className="btn btn-icon btn-sm" onClick={() => setFontSize(f => Math.max(f - 1, 10))}><Minus size={13} /></button>
                            <span>{fontSize}px</span>
                            <button className="btn btn-icon btn-sm" onClick={() => setFontSize(f => Math.min(f + 1, 24))}><Plus size={13} /></button>
                          </div>
                        </div>
                        <label className="switch-row"><span><b>Minimap</b></span><input type="checkbox" className="switch" checked={minimapEnabled} onChange={() => setMinimapEnabled(v => !v)} /></label>
                        <label className="switch-row"><span><b>Word wrap</b></span><input type="checkbox" className="switch" checked={wordWrap} onChange={() => setWordWrap(v => !v)} /></label>
                        <label className="switch-row"><span><b>AI auto-fix failed runs</b></span><input type="checkbox" className="switch" checked={autoDebugEnabled} onChange={() => setAutoDebugEnabled(v => !v)} /></label>
                      </div>
                      <div className="section-title">Keyboard shortcuts</div>
                      <div className="shortcut-list">
                        {[
                          ['Go to file', 'Ctrl P'], ['Command palette', 'Ctrl ⇧ P'], ['Run file', 'Ctrl ↵'], ['Ask AI about selection', 'Ctrl I'],
                          ['Save & format', 'Ctrl S'], ['Toggle sidebar', 'Ctrl B'], ['Terminal', 'Ctrl `'], ['Go to line', 'Ctrl G'],
                          ['New file', 'Ctrl N'], ['Markdown preview', 'Ctrl ⇧ V'],
                        ].map(([label, keys]) => (
                          <div key={label} className="shortcut-row"><span>{label}</span><kbd>{keys}</kbd></div>
                        ))}
                      </div>
                      <div className="section-title">Project</div>
                      <div className="stat-grid">
                        <div className="stat"><b>{allFiles.filter(f => !f.isFolder).length}</b><span>files</span></div>
                        <div className="stat"><b>{projectInsights.lineCount}</b><span>lines open</span></div>
                        <div className="stat"><b>{projectInsights.todoCount}</b><span>TODOs</span></div>
                      </div>
                    </div>
                  </>
                )}
              </Panel>
              <PanelResizeHandle className="resize-handle" />
            </>
          )}

          {/* ───────────── Editor + bottom panel ───────────── */}
          <Panel id="center" order={2} defaultSize={55} minSize={30}>
            {!project ? (
              <div className="welcome">
                <div className="welcome-inner">
                  <div className="welcome-hero">
                    <span className="brand-mark brand-mark-lg" />
                    <div>
                      <h1>Orbit IDE</h1>
                      <p>Code, run and ship from your browser — with Claude as your pair programmer.</p>
                    </div>
                  </div>
                  <div className="welcome-grid">
                    <section>
                      <h2>Start</h2>
                      <button className="welcome-action" onClick={() => setShowProjectPicker(true)}><Plus size={16} /> New project…</button>
                      <button className="welcome-action" onClick={cloneRepo}><GitBranch size={16} /> Clone a Git repository…</button>
                      <button className="welcome-action" onClick={openLocalFolder}><FolderOpen size={16} /> Open a folder…</button>
                      <h2>Recent</h2>
                      {projects.slice(0, 8).map(p => (
                        <button key={p.id} className="welcome-recent" onClick={() => loadProject(p.id)}><Folder size={14} /> {p.name}</button>
                      ))}
                      {!projects.length && <div className="empty-hint">No projects yet.</div>}
                    </section>
                    <section>
                      <h2>Start from a template</h2>
                      <div className="template-grid">
                        {templates.filter(t => t.id !== 'blank').map(t => (
                          <button key={t.id} className="template-card" onClick={() => quickCreateProject(t.id)}>
                            <span className="template-icon">{TEMPLATE_META[t.id]?.icon || <FileText size={22} />}</span>
                            <span className="template-title">{t.label}</span>
                            <span className="template-blurb">{TEMPLATE_META[t.id]?.blurb}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            ) : (
              <PanelGroup direction="vertical" autoSaveId="orbit-editor-split">
                <Panel defaultSize={68} minSize={20} className="editor-column">
                  <div className="tabs-bar">
                    {openTabs.map(id => (
                      <div key={id} className={`tab ${activeFile === id ? 'active' : ''}`} onClick={() => setActiveFile(id)}
                        onMouseDown={e => { if (e.button === 1) { e.preventDefault(); closeTab(id, e); } }}
                        title={id === '__preview__' ? 'Browser preview' : relPath(openFiles[id] || { name: '' })}>
                        {id === '__preview__' ? <><Globe size={13} className="tab-icon" /> Preview</> : <><span className="file-icon">{fileIcon(openFiles[id]?.name || '')}</span> {openFiles[id]?.name}</>}
                        <span className="tab-close" onClick={e => closeTab(id, e)}><X size={12} /></span>
                      </div>
                    ))}
                  </div>
                  <div className="breadcrumb">
                    {activeFile === '__preview__' ? <><Globe size={12} /> Browser preview</> : activeFileData ? (
                      <>
                        <span>{project.name}</span>
                        {(activeFileData.path ? activeFileData.path.split('/') : []).map((seg, i) => <React.Fragment key={i}><ChevronRight size={12} /><span>{seg}</span></React.Fragment>)}
                        <ChevronRight size={12} /><span className="crumb-file">{fileIcon(activeFileData.name)} {activeFileData.name}</span>
                      </>
                    ) : null}
                    <div className="spacer" />
                    {isMarkdown && activeFile !== '__preview__' && (
                      <button className={`btn btn-ghost btn-xs ${mdPreview ? 'is-on' : ''}`} onClick={() => setMdPreview(v => !v)} title="Toggle Markdown preview (Ctrl+Shift+V)">
                        {mdPreview ? <EyeOff size={12} /> : <Eye size={12} />} {mdPreview ? 'Edit' : 'Preview'}
                      </button>
                    )}
                    {Object.keys(previewPorts).length > 0 && activeFile !== '__preview__' && (
                      <button className="btn btn-ghost btn-xs" onClick={() => { if (!openTabs.includes('__preview__')) setOpenTabs([...openTabs, '__preview__']); setActiveFile('__preview__'); }}>
                        <Globe size={12} /> Open preview
                      </button>
                    )}
                  </div>
                  <div className="editor-container">
                    {activeFile === '__preview__' ? (
                      <div className="browser">
                        <div className="browser-bar">
                          <div className="browser-dots"><span /><span /><span /></div>
                          <button className="btn btn-icon btn-sm" title="Reload" onClick={() => setPreviewNonce(n => n + 1)}><RefreshCw size={13} /></button>
                          <select className="browser-url" value={previewSrc} onChange={(e) => setPreviewSrc(e.target.value)}>
                            {Object.entries(previewPorts).map(([port, url]) => (
                              <option key={port} value={url}>{port === 'terminal' ? 'Terminal app' : `localhost:${port}`}</option>
                            ))}
                          </select>
                          <a className="btn btn-icon btn-sm" title="Open in a new tab" href={previewSrc} target="_blank" rel="noreferrer"><ExternalLink size={13} /></a>
                        </div>
                        {previewSrc
                          ? <iframe key={previewNonce} title="App preview" src={previewSrc} className="browser-frame" />
                          : <div className="empty-state"><Globe size={28} /><p>Nothing to preview yet. Run an app that listens on a port.</p></div>}
                      </div>
                    ) : activeFileData && isMarkdown && mdPreview ? (
                      <div className="markdown-preview">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeFileData.value || ''}</ReactMarkdown>
                      </div>
                    ) : activeFileData ? (
                      <Editor height="100%" language={activeLang} theme={monacoTheme}
                        beforeMount={defineMonacoThemes}
                        path={activeFile} defaultValue={activeFileData.value || ''}
                        onChange={updateActiveFileContent}
                        onMount={handleEditorMount}
                        options={{ fontSize, fontFamily: codeFont, fontLigatures: true, minimap: { enabled: minimapEnabled, renderCharacters: false, scale: 1 }, smoothScrolling: true, cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on', padding: { top: 14 }, wordWrap: wordWrap ? 'on' : 'off', scrollBeyondLastLine: false, lineNumbers: 'on', renderLineHighlight: 'all', bracketPairColorization: { enabled: true }, guides: { bracketPairs: true, indentation: true }, inlineSuggest: { enabled: true }, stickyScroll: { enabled: true }, scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 } }}
                      />
                    ) : (
                      <div className="editor-empty">
                        <span className="brand-mark brand-mark-lg muted" />
                        <div className="editor-empty-keys">
                          <div><span>Go to file</span><kbd>Ctrl P</kbd></div>
                          <div><span>Command palette</span><kbd>Ctrl ⇧ P</kbd></div>
                          <div><span>Ask AI</span><kbd>Ctrl I</kbd></div>
                          <div><span>Toggle terminal</span><kbd>Ctrl `</kbd></div>
                        </div>
                      </div>
                    )}
                  </div>
                </Panel>
                <PanelResizeHandle className="resize-handle horizontal" />
                <Panel defaultSize={32} minSize={12} className="bottom-panel">
                  <div className="bottom-tabs">
                    <span className={`bottom-tab ${bottomTab === 'terminal' ? 'active' : ''}`} onClick={() => setBottomTab('terminal')}>Terminal</span>
                    <span className={`bottom-tab ${bottomTab === 'problems' ? 'active' : ''}`} onClick={() => setBottomTab('problems')}>
                      Problems {(errorCount + warnCount) > 0 && <span className={`count-badge ${errorCount ? 'error' : 'warn'}`}>{errorCount + warnCount}</span>}
                    </span>
                    <span className={`bottom-tab ${bottomTab === 'chaos' ? 'active' : ''}`} onClick={() => setBottomTab('chaos')}>
                      Chaos {chaosResults && !chaosResults.error && <span className={`count-badge ${chaosResults.resilienceScore >= 70 ? 'ok' : 'warn'}`}>{chaosResults.resilienceScore}%</span>}
                    </span>
                  </div>
                  {socket && (
                    <TerminalPanel
                      key={project.id}
                      ref={terminalPanelRef}
                      socket={socket}
                      projectId={project.id}
                      fontFamily={codeFont}
                      appearance={theme}
                      visible={bottomTab === 'terminal'}
                      onOpenPreview={(url) => {
                        setPreviewPorts(prev => ({ ...prev, terminal: url }));
                        setOpenTabs(t => t.includes('__preview__') ? t : [...t, '__preview__']);
                        setActiveFile('__preview__');
                      }}
                    />
                  )}
                  {bottomTab === 'problems' && (
                    <div className="problems-host">
                      {!problems.length && <div className="empty-hint"><CircleCheck size={13} /> No problems in the active file.</div>}
                      {problems.map((p, i) => (
                        <div key={i} className={`problem-row ${p.severity}`} onClick={() => { editorRef.current?.revealLineInCenter(p.line); editorRef.current?.setPosition({ lineNumber: p.line, column: p.col }); editorRef.current?.focus(); }}>
                          {p.severity === 'error' ? <X size={13} /> : <TriangleAlert size={13} />}
                          <span className="problem-msg">{p.message}</span>
                          <span className="problem-file">{p.file} [{p.line}, {p.col}]</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {bottomTab === 'chaos' && (
                    <div className="problems-host">
                      {isChaosRunning && <div className="empty-hint"><LoaderCircle size={13} className="spin" /> Running 9 chaos scenarios in parallel…</div>}
                      {chaosResults?.error && <div className="problem-row error">{chaosResults.error}</div>}
                      {chaosResults && !chaosResults.error && (
                        <>
                          <div className="chaos-summary">
                            <div className="chaos-gauge" style={{ ['--score' as any]: chaosResults.resilienceScore }}><span>{chaosResults.resilienceScore}%</span></div>
                            <div>
                              <div className="chaos-title">Resilience score</div>
                              <div className="meta-line">{chaosResults.survived} of {chaosResults.total} scenarios survived</div>
                            </div>
                          </div>
                          {chaosResults.results.map((r, i) => (
                            <div key={i} className={`chaos-row ${r.survived ? 'survived' : 'failed'}`}>
                              <span className={`state-dot ${r.survived ? 'running' : 'exited'}`} />
                              <span className="chaos-scenario">{r.scenario}</span>
                              <span className="chaos-time">{r.elapsed} ms</span>
                              <div className="chaos-output">{r.output.slice(0, 160)}{r.output.length > 160 ? '…' : ''}</div>
                            </div>
                          ))}
                        </>
                      )}
                      {!chaosResults && !isChaosRunning && <div className="empty-hint">Click <b>Chaos</b> in the title bar to stress-test the active file under memory limits, CPU throttling, kills and network loss.</div>}
                    </div>
                  )}
                </Panel>
              </PanelGroup>
            )}
          </Panel>

          {/* ───────────── AI assistant ───────────── */}
          {showAIPanel && (
            <>
              <PanelResizeHandle className="resize-handle" />
              <Panel id="ai" order={3} defaultSize={26} minSize={18} maxSize={45}>
                <div className="ai-panel">
                  <div className="panel-header">
                    <span className="panel-title"><Sparkles size={13} /> Agent</span>
                    <div className="panel-actions">
                      <button className={`btn btn-icon btn-sm ${aiTab === 'history' ? 'is-on' : ''}`} onClick={() => setAiTab(aiTab === 'history' ? 'chat' : 'history')} title="Auto-debug history"><Bug size={14} /></button>
                      <button className={`btn btn-icon btn-sm ${chatSidebarOpen ? 'is-on' : ''}`} onClick={() => setChatSidebarOpen(!chatSidebarOpen)} title="Past chats"><History size={14} /></button>
                      <button className="btn btn-icon btn-sm" onClick={createNewChat} title="New chat"><MessageSquarePlus size={14} /></button>
                      <button className="btn btn-icon btn-sm" onClick={() => setShowAIPanel(false)} title="Close"><X size={14} /></button>
                    </div>
                  </div>

                  {chatSidebarOpen && (
                    <div className="chat-history">
                      <div className="section-title">Past chats</div>
                      <div className="chat-history-list">
                        {chatSessions.map(s => (
                          <div key={s.id} className={`list-row ${activeSessionId === s.id ? 'is-active' : ''}`} onClick={() => { setActiveSessionId(s.id); setChatSidebarOpen(false); }}>
                            <MessageSquare size={13} />
                            {editingSessionId === s.id ? (
                              <input autoFocus className="input input-sm" value={editSessionName} onClick={e => e.stopPropagation()}
                                onChange={e => setEditSessionName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') renameChat(s.id, editSessionName); if (e.key === 'Escape') setEditingSessionId(null); }}
                                onBlur={() => renameChat(s.id, editSessionName)} />
                            ) : (
                              <>
                                <span className="list-row-main">{s.name}</span>
                                <button className="btn btn-icon btn-xs row-hover-icon" onClick={e => { e.stopPropagation(); setEditSessionName(s.name); setEditingSessionId(s.id); }}><Edit2 size={12} /></button>
                                <button className="btn btn-icon btn-xs row-hover-icon" onClick={e => deleteChat(s.id, e)}><Trash2 size={12} /></button>
                              </>
                            )}
                          </div>
                        ))}
                        {!chatSessions.length && <div className="empty-hint">No saved chats yet.</div>}
                      </div>
                    </div>
                  )}

                  {aiTab === 'history' ? (
                    <div className="debug-history-panel">
                      <div className="section-title">Auto-debug history</div>
                      {runFailure && (
                        <button className="btn btn-ghost btn-block" onClick={() => { const f = runFailure; setRunFailure(null); autoDebugAttempts.current = 0; autoDebug(f); }}>
                          <Bug size={13} /> Fix the last failed run with AI
                        </button>
                      )}
                      {debugHistory.length === 0 ? (
                        <div className="empty-hint">When a run fails, Claude's fix attempts show up here.</div>
                      ) : (
                        debugHistory.map((h, i) => (
                          <div key={i} className={`debug-history-item status-${h.status}`}>
                            <div className="debug-history-header">
                              <span className="attempt">Attempt {h.attempt}</span>
                              <span className="file">{h.file}</span>
                              <span className={`status-badge ${h.status}`}>{h.status}</span>
                            </div>
                            <pre className="debug-history-error">{h.error.slice(-1200)}</pre>
                            {h.explanation && <div className="debug-history-explanation">{h.explanation}</div>}
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="chat-messages" ref={chatScrollRef}>
                        {chatMessages.map((m, i) => (
                          <div key={i} className={`chat-msg ${m.role}`}>
                            {m.role === 'assistant' && <div className="chat-author"><span className="agent-avatar"><Sparkles size={11} /></span> Orbit</div>}
                            <div className="chat-bubble">
                              {m.role === 'assistant'
                                ? (m.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown> : <span className="thinking"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /> Thinking</span>)
                                : m.content}
                            </div>
                          </div>
                        ))}
                      </div>

                      {pendingAIAction && (
                        <div className="ai-review-panel">
                          <div className="ai-review-head"><Sparkles size={13} /> Review changes</div>
                          <ul className="ai-review-files">
                            {pendingAIAction.changes?.writes.map(w => {
                              const exists = allFiles.some(f => relPath(f) === w.path);
                              return (
                                <li key={w.path} className={reviewFile === w.path ? 'active' : ''} onClick={() => setReviewFile(w.path)}>
                                  <span className="file-icon">{fileIcon(w.path.split('/').pop())}</span>
                                  <span className="review-path">{w.path}</span>
                                  <span className={`review-badge ${exists ? 'mod' : 'new'}`}>{exists ? 'M' : 'A'}</span>
                                </li>
                              );
                            })}
                            {pendingAIAction.changes?.deletes.map(d => (
                              <li key={d}><span className="file-icon"><Trash2 size={12} /></span><span className="review-path">{d}</span><span className="review-badge del">D</span></li>
                            ))}
                            {pendingAIAction.run && <li><span className="file-icon"><Play size={12} /></span><span className="review-path">then run {pendingAIAction.run}</span></li>}
                          </ul>
                          {reviewFile && pendingAIAction.changes?.writes.some(w => w.path === reviewFile) && (
                            <div className="ai-review-diff">
                              <DiffEditor
                                original={(() => { const f = allFiles.find(x => relPath(x) === reviewFile); return f ? (openFiles[f.id]?.value ?? f.content) : ''; })()}
                                modified={pendingAIAction.changes.writes.find(w => w.path === reviewFile)?.content || ''}
                                language={getLang(reviewFile)}
                                keepCurrentOriginalModel
                                keepCurrentModifiedModel
                                originalModelPath={`review-${reviewSeq}-a/${reviewFile}`}
                                modifiedModelPath={`review-${reviewSeq}-b/${reviewFile}`}
                                theme={monacoTheme}
                                beforeMount={defineMonacoThemes}
                                options={{ readOnly: true, minimap: { enabled: false }, renderSideBySide: false, fontSize: 12, scrollBeyondLastLine: false }}
                              />
                            </div>
                          )}
                          <div className="ai-review-actions">
                            <button onClick={rejectAIAction} className="btn btn-ghost">Reject</button>
                            <button onClick={approveAIAction} className="btn btn-primary"><Check size={13} /> Accept{pendingAIAction.run ? ' & run' : ''}</button>
                          </div>
                        </div>
                      )}

                      <div className="composer">
                        {currentSession && <div className="composer-session"><MessageSquare size={11} /> {currentSession.name}</div>}
                        <div className="composer-box">
                          <textarea className="chat-input" value={chatInput}
                            onChange={e => {
                              setChatInput(e.target.value);
                              e.target.style.height = 'auto';
                              e.target.style.height = Math.min(e.target.scrollHeight, 220) + 'px';
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                if (chatInput.trim()) {
                                  const sel = pendingSelectionRef.current;
                                  pendingSelectionRef.current = '';
                                  sendChatMessage(undefined, sel || undefined);
                                  e.currentTarget.style.height = 'auto';
                                }
                              }
                            }}
                            rows={2}
                            placeholder={aiEnabled ? 'Ask Orbit to build, fix or explain…' : 'AI is not configured on the server (ANTHROPIC_API_KEY)'} />
                          <div className="composer-toolbar">
                            <div className="menu-anchor">
                              <button className="model-pill" onClick={() => setShowModelMenu(!showModelMenu)}>
                                <Sparkles size={11} /> {(aiModels.find(m => m.id === selectedModel)?.label || selectedModel).replace(/^Claude /, '')} <ChevronDown size={11} />
                              </button>
                              {showModelMenu && (
                                <div className="menu menu-up" onMouseLeave={() => setShowModelMenu(false)}>
                                  <div className="menu-label">Model</div>
                                  {aiModels.map(m => (
                                    <button key={m.id} className={`menu-item ${selectedModel === m.id ? 'is-on' : ''}`} onClick={() => { setSelectedModel(m.id); setShowModelMenu(false); }}>
                                      <span className="menu-check">{selectedModel === m.id && <Check size={13} />}</span>
                                      <span><span className="menu-item-title">{m.label}</span><span className="menu-sub">{m.sub}</span></span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <span className="composer-hint">{activeFileData && activeFile !== '__preview__' ? <>Context: <b>{activeFileData.name}</b></> : 'Whole project'}</span>
                            {chatLoading ? (
                              <button className="send-btn stop" onClick={() => abortControllerRef.current?.abort()} title="Stop"><Square size={12} fill="currentColor" /></button>
                            ) : (
                              <button className="send-btn" onClick={() => sendChatMessage()} disabled={!chatInput.trim()} title="Send (Enter)"><ArrowUp size={15} /></button>
                            )}
                          </div>
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

      {/* ───────────── Status bar ───────────── */}
      <footer className="status-bar">
        {gitStatus.branch && project && <span className="status-item" onClick={() => { setActivityPanel('source'); setSidebarVisible(true); }}><GitBranch size={12} /> {gitStatus.branch}{gitStatus.files.length ? '*' : ''}</span>}
        <span className="status-item" onClick={() => setBottomTab('problems')} title="Problems">
          <X size={12} /> {errorCount} <TriangleAlert size={12} /> {warnCount}
        </span>
        {runFailure && (
          <span className="status-item status-alert" onClick={() => { const f = runFailure; setRunFailure(null); autoDebugAttempts.current = 0; autoDebug(f); }} title="Ask Claude to fix the failed run">
            <Bug size={12} /> Run failed — fix with AI
          </span>
        )}
        {isRunning && <span className="status-item"><LoaderCircle size={12} className="spin" /> Running</span>}
        <span className="spacer" />
        {activeFileData && activeFile !== '__preview__' && <span className="status-item" onClick={() => { setGotoLineOpen(true); setGotoLineValue(''); }}>Ln {cursorPos.line}, Col {cursorPos.col}</span>}
        {activeFileData && <span className="status-item">{activeLang}</span>}
        <span className="status-item" title={dockerStatus === 'error' ? 'Docker unreachable' : 'Docker'}><Container size={12} /> {dockerStatus === 'error' ? 'offline' : 'ready'}</span>
        <span className={`status-item ${socketConnected ? '' : 'status-warn'}`} title={socketConnected ? 'Connected to the server' : 'Reconnecting…'}>
          <span className={`conn-dot ${socketConnected ? 'on' : ''}`} /> {socketConnected ? 'Online' : 'Offline'}
        </span>
        <span className="status-item" onClick={() => setShowAIPanel(v => !v)} title="AI assistant">
          <Sparkles size={12} /> {!aiEnabled ? 'AI off' : chatLoading ? 'Claude is thinking…' : (aiModels.find(m => m.id === selectedModel)?.label || 'Claude')}
        </span>
      </footer>

      {/* ───────────── Overlays ───────────── */}
      {gitDiff && (
        <div className="overlay" onClick={() => setGitDiff(null)}>
          <div className="dialog diff-dialog" onClick={e => e.stopPropagation()}>
            <div className="dialog-header"><span><GitBranch size={13} /> {gitDiff.path}</span><button className="btn btn-icon btn-sm" onClick={() => setGitDiff(null)}><X size={14} /></button></div>
            <pre className="diff-body">
              {gitDiff.diff.split('\n').map((line, i) => (
                <div key={i} className={`diff-line ${line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : ''}`}>{line || ' '}</div>
              ))}
            </pre>
          </div>
        </div>
      )}

      {gotoLineOpen && (
        <div className="overlay overlay-top" onClick={() => setGotoLineOpen(false)}>
          <div className="palette" onClick={e => e.stopPropagation()}>
            <input autoFocus className="palette-input" type="number" min={1} value={gotoLineValue} placeholder={`Go to line (1–${editorRef.current?.getModel()?.getLineCount() || '…'})`}
              onChange={e => setGotoLineValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') goToLine(); if (e.key === 'Escape') setGotoLineOpen(false); }} />
          </div>
        </div>
      )}

      {paletteOpen && (
        <div className="overlay overlay-top" onClick={() => setPaletteOpen(false)}>
          <div className="palette" onClick={e => e.stopPropagation()}>
            <div className="palette-input-row">
              {paletteMode === 'commands' ? <span className="palette-prefix">&gt;</span> : <Search size={14} />}
              <input autoFocus className="palette-input" placeholder={paletteMode === 'files' ? 'Search files by name (type > for commands)' : 'Type a command'} value={paletteQuery}
                onChange={e => {
                  const v = e.target.value;
                  if (paletteMode === 'files' && v.startsWith('>')) { setPaletteMode('commands'); setPaletteQuery(v.slice(1)); }
                  else setPaletteQuery(v);
                  setPaletteIndex(0);
                }}
                onKeyDown={e => {
                  if (e.key === 'Backspace' && !paletteQuery && paletteMode === 'commands') { setPaletteMode('files'); return; }
                  handlePaletteKeyDown(e);
                }} />
            </div>
            <div className="palette-list">
              {filteredCommands.map((cmd, i) => (
                <div key={cmd.id} className={`palette-item ${i === paletteIndex ? 'active' : ''}`} onClick={() => runCommand(cmd)} onMouseEnter={() => setPaletteIndex(i)}>
                  {paletteMode === 'files' ? <span className="file-icon">{fileIcon(cmd.label)}</span> : <ChevronRight size={12} className="palette-chevron" />}
                  <span className="palette-label">{cmd.label}</span>
                  {cmd.detail && <span className="palette-detail">{cmd.detail}</span>}
                </div>
              ))}
              {!filteredCommands.length && <div className="empty-hint">{paletteMode === 'files' ? (project ? 'No matching files.' : 'Open a project first.') : 'No matching commands.'}</div>}
            </div>
          </div>
        </div>
      )}

      <div className="toasts">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => setToasts(ts => ts.filter(x => x.id !== t.id))}>
            {t.kind === 'success' ? <CircleCheck size={15} /> : t.kind === 'error' ? <TriangleAlert size={15} /> : <Info size={15} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
