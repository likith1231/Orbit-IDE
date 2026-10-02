import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Plus, X, Columns2, Trash2, Globe, Play, TerminalSquare, RotateCcw } from 'lucide-react';
import { apiFetch, backendUrl } from '../lib/apiFetch';
import '@xterm/xterm/css/xterm.css';

type Props = {
  socket: Socket | null;
  projectId: string;
  fontFamily: string;
  visible: boolean;
  appearance?: 'orbit' | 'midnight' | 'light';
  onOpenPreview: (url: string) => void;
};

export type TerminalPanelHandle = {
  showRun: () => void;
  writeRun: (text: string) => void;
  clearRun: () => void;
  showShell: () => void;
};

type Tab = { id: string; title: string };
type Instance = { term: Terminal; fit: FitAddon; host: HTMLDivElement; observer: ResizeObserver; alive: boolean; heard: boolean; watchdog?: number };

const ANSI_DARK = {
  black: '#1b1e2b', red: '#ff6b81', green: '#5fd69a', yellow: '#ffd479', blue: '#6aa6ff',
  magenta: '#c792ea', cyan: '#56d4e4', white: '#d5d8e6', brightBlack: '#5a6080', brightRed: '#ff8fa0',
  brightGreen: '#7ee8b0', brightYellow: '#ffe09c', brightBlue: '#8fbcff', brightMagenta: '#d8adf2',
  brightCyan: '#82e3ee', brightWhite: '#ffffff',
};
const TERMINAL_THEMES = {
  orbit: { ...ANSI_DARK, background: '#0c0d14', foreground: '#d7dae8', cursor: '#a99dff', cursorAccent: '#0c0d14', selectionBackground: '#8b7bff44' },
  midnight: { ...ANSI_DARK, background: '#030303', foreground: '#e0e0e0', cursor: '#60a5fa', cursorAccent: '#000', selectionBackground: '#3b82f644' },
  light: {
    background: '#fbfbfd', foreground: '#2a2d3a', cursor: '#5b4cff', cursorAccent: '#fff', selectionBackground: '#5b4cff33',
    black: '#2a2d3a', red: '#d6284b', green: '#1a8a4c', yellow: '#a86b00', blue: '#2f5fd0', magenta: '#8a3fc2', cyan: '#0f7f8f', white: '#9aa0b4',
    brightBlack: '#6b7186', brightRed: '#e8435f', brightGreen: '#23a35d', brightYellow: '#c27d00', brightBlue: '#4174e8', brightMagenta: '#9f55d6', brightCyan: '#15939f', brightWhite: '#2a2d3a',
  },
};
type Appearance = keyof typeof TERMINAL_THEMES;

const RUN_ID = '__run__';
let counter = 0;
const newId = () => `t${Date.now().toString(36)}${(counter++).toString(36)}`;

const withFallbacks = (f: string) => `${f}, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace`;

function createXterm(fontFamily: string, appearance: Appearance) {
  const term = new Terminal({ cursorBlink: true, fontSize: 13, lineHeight: 1.25, fontFamily: withFallbacks(fontFamily), theme: TERMINAL_THEMES[appearance], scrollback: 5000, allowProposedApi: true });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  return { term, fit };
}

const TerminalPanel = forwardRef<TerminalPanelHandle, Props>(function TerminalPanel(
  { socket, projectId, fontFamily, visible, appearance = 'orbit', onOpenPreview }, ref,
) {
  const [tabs, setTabs] = useState<Tab[]>(() => [{ id: newId(), title: 'bash' }]);
  const [active, setActive] = useState<string>(() => tabs[0].id);
  const [splitId, setSplitId] = useState<string | null>(null);
  const [shell, setShell] = useState<'bash' | 'sh'>('bash');
  const [ports, setPorts] = useState<Record<string, string> | null>(null);
  const instances = useRef(new Map<string, Instance>());
  const hosts = useRef(new Map<string, HTMLDivElement | null>());
  const shellRef = useRef(shell);
  shellRef.current = shell;
  // xterm callbacks are created once per terminal; read the socket through a ref so they never go stale.
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const appearanceRef = useRef<Appearance>(appearance);
  appearanceRef.current = appearance;

  const fitAll = useCallback(() => {
    instances.current.forEach((inst) => {
      if (inst.host.offsetParent !== null) { try { inst.fit.fit(); } catch { /* hidden */ } }
    });
  }, []);

  const openSession = useCallback((id: string) => {
    const inst = instances.current.get(id);
    if (!inst || !socketRef.current) return;
    inst.alive = true;
    inst.heard = false;
    inst.term.write('\x1b[90mStarting terminal…\x1b[0m');
    socketRef.current.emit('term:open', { termId: id, projectId, cols: inst.term.cols, rows: inst.term.rows, shell: shellRef.current });
    // If the server never answers, say why instead of showing a blank screen.
    clearTimeout(inst.watchdog);
    inst.watchdog = window.setTimeout(() => {
      if (inst.heard || !inst.alive) return;
      inst.term.writeln('\r\n\x1b[33mThe server did not start a terminal.\x1b[0m');
      inst.term.writeln('\x1b[33mMost likely the backend is still running OLD code. Stop it (Ctrl+C) and start it again\x1b[0m');
      inst.term.writeln('\x1b[33mwith "npm start" in backend/ — its log should say "Terminal: docker". Check with "npm run doctor".\x1b[0m');
      inst.term.writeln('\x1b[90mPress Enter to try again.\x1b[0m');
      inst.alive = false;
    }, 15000);
  }, [projectId]);

  // Create xterm instances as their host divs mount.
  const attach = useCallback((id: string, el: HTMLDivElement | null) => {
    hosts.current.set(id, el);
    if (!el || instances.current.has(id)) return;
    const { term, fit } = createXterm(fontFamily, appearanceRef.current);
    term.open(el);
    const observer = new ResizeObserver(() => { if (el.offsetParent !== null) { try { fit.fit(); } catch { /* ignore */ } } });
    observer.observe(el);
    const inst: Instance = { term, fit, host: el, observer, alive: false, heard: false };
    instances.current.set(id, inst);
    try { fit.fit(); } catch { /* not visible yet */ }

    if (id === RUN_ID) {
      term.writeln('\x1b[90mProgram output appears here. Press Run (Ctrl+Enter) — you can type input for your program in this tab.\x1b[0m');
      term.onData(d => socketRef.current?.emit('sandbox-input', d));
      term.onResize(({ cols, rows }) => socketRef.current?.emit('sandbox-resize', { cols, rows }));
      return;
    }
    term.onData((d) => {
      if (!inst.alive) {
        if (d === '\r') { term.writeln(''); openSession(id); }
        return;
      }
      socketRef.current?.emit('term:input', { termId: id, data: d });
    });
    term.onResize(({ cols, rows }) => { if (inst.alive) socketRef.current?.emit('term:resize', { termId: id, cols, rows }); });
    openSession(id);
  }, [fontFamily, openSession]);

  // Socket events -> terminals.
  useEffect(() => {
    if (!socket) return;
    const onData = ({ termId, data }: { termId: string; data: string }) => {
      const inst = instances.current.get(termId);
      if (!inst) return;
      if (!inst.heard) { inst.heard = true; inst.term.write('\r\x1b[2K'); } // clear "Starting terminal…"
      inst.term.write(data);
    };
    const onReady = ({ termId }: { termId: string }) => {
      const inst = instances.current.get(termId);
      if (inst && !inst.heard) { inst.heard = true; inst.term.write('\r\x1b[2K'); }
    };
    const onExit = ({ termId }: { termId: string }) => {
      const inst = instances.current.get(termId);
      if (!inst) return;
      inst.alive = false;
      inst.term.writeln('\r\n\x1b[90m[process exited — press Enter to start a new shell]\x1b[0m');
    };
    const onSandboxOut = (d: string) => instances.current.get(RUN_ID)?.term.write(d);
    // After a reconnect the server has no sessions for us; start fresh ones.
    const onReconnect = () => {
      instances.current.forEach((inst, id) => {
        if (id === RUN_ID || !inst.alive) return;
        inst.term.writeln('\r\n\x1b[33m[reconnected — new shell]\x1b[0m');
        openSession(id);
      });
    };
    socket.on('term:data', onData);
    socket.on('term:ready', onReady);
    socket.on('term:exit', onExit);
    socket.on('sandbox-output', onSandboxOut);
    socket.io.on('reconnect', onReconnect);
    return () => {
      socket.off('term:data', onData);
      socket.off('term:ready', onReady);
      socket.off('term:exit', onExit);
      socket.off('sandbox-output', onSandboxOut);
      socket.io.off('reconnect', onReconnect);
    };
  }, [socket, openSession]);

  // Dispose everything on unmount (the parent remounts us per project).
  useEffect(() => () => {
    instances.current.forEach((inst, id) => {
      if (id !== RUN_ID) socketRef.current?.emit('term:close', { termId: id });
      inst.observer.disconnect();
      inst.term.dispose();
    });
    instances.current.clear();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => { fitAll(); instances.current.get(active)?.term.focus(); }, 30);
    return () => clearTimeout(t);
  }, [visible, active, splitId, fitAll]);

  useEffect(() => {
    instances.current.forEach(inst => { inst.term.options.theme = TERMINAL_THEMES[appearance]; });
  }, [appearance]);

  // xterm measures glyph width once; re-measure after web fonts finish loading, or the
  // terminal renders with gaps between letters.
  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      instances.current.forEach(inst => {
        inst.term.options.fontFamily = 'monospace';
        inst.term.options.fontFamily = withFallbacks(fontFamily);
      });
      fitAll();
    };
    apply();
    document.fonts?.load(`13px ${fontFamily.split(',')[0]}`).catch(() => {}).finally(apply);
    document.fonts?.ready.then(apply);
    return () => { cancelled = true; };
  }, [fontFamily, fitAll]);

  const addTab = () => {
    const id = newId();
    setTabs(t => [...t, { id, title: shell }]);
    setActive(id);
  };

  const closeTab = (id: string) => {
    const inst = instances.current.get(id);
    socket?.emit('term:close', { termId: id });
    inst?.observer.disconnect();
    inst?.term.dispose();
    instances.current.delete(id);
    if (splitId === id) setSplitId(null);
    setTabs((t) => {
      const next = t.filter(x => x.id !== id);
      if (!next.length) {
        const fresh = { id: newId(), title: shell };
        setActive(fresh.id);
        return [fresh];
      }
      if (active === id) setActive(next[next.length - 1].id);
      return next;
    });
  };

  const toggleSplit = () => {
    if (splitId) { closeTab(splitId); return; }
    const id = newId();
    setTabs(t => [...t, { id, title: `${shell} (split)` }]);
    setSplitId(id);
    if (active === RUN_ID) setActive(tabs[0].id);
  };

  const restartActive = () => {
    const inst = instances.current.get(active);
    if (!inst || active === RUN_ID) return;
    socket?.emit('term:close', { termId: active });
    inst.term.reset();
    openSession(active);
  };

  const clearActive = () => instances.current.get(active)?.term.clear();

  const loadPorts = async () => {
    if (ports) { setPorts(null); return; }
    try {
      const res = await apiFetch(`/api/projects/${projectId}/ports`);
      const data = await res.json();
      setPorts(data.ports || {});
    } catch { setPorts({}); }
  };

  useImperativeHandle(ref, () => ({
    showRun: () => setActive(RUN_ID),
    writeRun: (text: string) => instances.current.get(RUN_ID)?.term.write(text),
    clearRun: () => instances.current.get(RUN_ID)?.term.reset(),
    showShell: () => setActive(a => (a === RUN_ID ? tabs[0]?.id ?? a : a)),
  }), [tabs]);

  const visibleIds = active === RUN_ID ? [RUN_ID] : [active, ...(splitId && splitId !== active ? [splitId] : [])];
  const allIds = [RUN_ID, ...tabs.map(t => t.id)];

  return (
    <div className="terminal-panel" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="terminal-tabs">
        <button className={`terminal-tab ${active === RUN_ID ? 'active' : ''}`} onClick={() => setActive(RUN_ID)} title="Program output and input">
          <Play size={11} /> Run
        </button>
        {tabs.filter(t => t.id !== splitId).map((t, i) => (
          <div key={t.id} className={`terminal-tab ${active === t.id ? 'active' : ''}`} onClick={() => setActive(t.id)}>
            <TerminalSquare size={11} /> {t.title} {i + 1}
            <span className="terminal-tab-close" onClick={e => { e.stopPropagation(); closeTab(t.id); }}><X size={10} /></span>
          </div>
        ))}
        <div className="terminal-toolbar">
          <select className="input input-xs terminal-shell-select" value={shell} onChange={e => setShell(e.target.value as 'bash' | 'sh')} title="Shell for new terminals">
            <option value="bash">bash</option>
            <option value="sh">sh</option>
          </select>
          <button className="btn btn-icon btn-sm" title="New terminal" onClick={addTab}><Plus size={14} /></button>
          <button className={`btn btn-icon btn-sm ${splitId ? 'is-on' : ''}`} title={splitId ? 'Close split' : 'Split terminal'} onClick={toggleSplit}><Columns2 size={14} /></button>
          <button className="btn btn-icon btn-sm" title="Restart shell" onClick={restartActive}><RotateCcw size={13} /></button>
          <button className="btn btn-icon btn-sm" title="Clear" onClick={clearActive}><Trash2 size={13} /></button>
          <div style={{ position: 'relative' }}>
            <button className="btn btn-icon btn-sm" title="Ports served from the terminal (e.g. npm run dev)" onClick={loadPorts}><Globe size={14} /></button>
            {ports && (
              <div className="ports-menu">
                <div className="ports-menu-title">Listening ports</div>
                {Object.keys(ports).length === 0 && <div className="ports-menu-empty">Nothing is listening. Start a server on 0.0.0.0 using port 3000, 4200, 5000, 5173, 8000 or 8080.</div>}
                {Object.entries(ports).map(([port, path]) => (
                  <div key={port} className="ports-menu-row">
                    <span>:{port}</span>
                    <button className="btn btn-primary btn-xs" onClick={() => { onOpenPreview(backendUrl(path)); setPorts(null); }}>Preview</button>
                    <a className="btn btn-ghost btn-xs" href={backendUrl(path)} target="_blank" rel="noreferrer">Open ↗</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="terminal-split">
        {allIds.map(id => (
          <div
            key={id}
            ref={el => attach(id, el)}
            className="terminal-host"
            style={{ display: visibleIds.includes(id) ? 'block' : 'none' }}
            onClick={() => instances.current.get(id)?.term.focus()}
          />
        ))}
      </div>
    </div>
  );
});

export default TerminalPanel;
