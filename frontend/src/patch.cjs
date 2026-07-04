const fs = require('fs');
let code = fs.readFileSync('IDE.tsx', 'utf8');

const badSection = `                          <button className={\`toggle-btn \${active ? 'on' : ''}\`} style={{ width: '100%', justifyContent: 'center', padding: '8px 12px' }} onClick={() => toggleExtension(item.key)}>
                            {active ? 'Disable' : 'Enable'}
                <button className="run-btn" style={{ marginTop: 8 }} onClick={runAIOptimizer} disabled={!activeFile}>
                      <Zap size={12} /> Optimize active file with AI
                    </button>
                  </div>
                </>
              )}
              {activityPanel === 'docker' && (
                <>
                          </div>
                          <button className="toggle-btn" style={{ padding: '6px 10px', fontSize: 12 }}
                            onClick={() => toggleContainer(container.Id, container.State)}
                            disabled={containerAction === container.Id || dockerStatus === 'error'}>
                            {containerAction === container.Id ? '...' : container.State === 'running' ? 'Stop' : 'Start'}
                          </button>
                        </div>
                      ))}
                      {!containers.length && <div className="no-results" style={{ marginTop: 8 }}>No container data available yet.</div>}
                    </div>
                    <div style={{ color: 'var(--vscode-text-dim)', fontSize: 12 }}>
                      Docker integration is a preview panel for container state and quick actions in your development environment.
                    </div>
                  </div>
                </>
              )}
              {activityPanel === 'settings' && (`;

const goodSection = `                          <button className={\`toggle-btn \${active ? 'on' : ''}\`} style={{ width: '100%', justifyContent: 'center', padding: '8px 12px' }} onClick={() => toggleExtension(item.key)}>
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
                    <button className="icon-btn" onClick={fetchDockerStatus} title="Refresh"><RefreshCw size={14} /></button>
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
              {activityPanel === 'database' && (
                <>
                  <div className="sidebar-header"><span className="sidebar-title-text">DATABASE INSPECTOR</span></div>
                  <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <select className="search-input" value={dbType} onChange={e => setDbType(e.target.value as any)}>
                      <option value="sqlite">SQLite</option>
                      <option value="postgres">PostgreSQL</option>
                    </select>
                    <input className="search-input" placeholder={dbType === 'sqlite' ? 'Path to db file or empty for memory' : 'postgresql://user:pass@host/db'} value={dbConnectionString} onChange={e => setDbConnectionString(e.target.value)} />
                    <textarea className="search-input" placeholder="SELECT * FROM table" value={dbQuery} onChange={e => setDbQuery(e.target.value)} rows={3} />
                    <button className="toggle-btn" onClick={handleRunDbQuery} style={{ padding: '6px' }}>Run Query</button>
                    {dbError && <div style={{ color: 'var(--vscode-error)', marginTop: 8 }}>{dbError}</div>}
                  </div>
                  {dbResults && (
                    <div className="db-results" style={{ overflow: 'auto', padding: '8px', fontSize: 11 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #444' }}>
                        <thead>
                          <tr style={{ background: '#333' }}>
                            {dbResults.fields.map(f => <th key={f} style={{ padding: 4, border: '1px solid #444' }}>{f}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {dbResults.rows.map((r, i) => (
                            <tr key={i}>
                              {dbResults.fields.map(f => <td key={f} style={{ padding: 4, border: '1px solid #444' }}>{r[f] !== null ? String(r[f]) : 'NULL'}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!dbResults.rows.length && <div>No rows returned.</div>}
                    </div>
                  )}
                </>
              )}
              {activityPanel === 'settings' && (`;

code = code.replace(badSection, goodSection);
fs.writeFileSync('IDE.tsx', code);
