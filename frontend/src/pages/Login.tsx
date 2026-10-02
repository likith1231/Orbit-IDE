import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { saveAuth } from '../auth';
import Navbar from '../components/Navbar';
import Galaxy from '../components/Galaxy';
import './auth-pages.css';
import { apiFetch } from '../lib/apiFetch';


export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch(`/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed.');
        return;
      }
      saveAuth(data.token, data.user);
      navigate('/ide');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page-container">
      <div className="galaxy-bg">
        <Galaxy
          hueShift={240}
          density={1.2}
          glowIntensity={0.5}
          saturation={0.6}
          twinkleIntensity={0.4}
          rotationSpeed={0.05}
          transparent={true}
          mouseRepulsion={true}
          repulsionStrength={2.5}
        />
      </div>
      <Navbar />

      <main className="auth-main">
        <div className="auth-hero">
          <div className="auth-hero-content">
            <h1 className="auth-hero-title">Your AI-Powered Coding Sandbox</h1>
            <p className="auth-hero-subtitle">
              Code, test, and deploy instantly with built-in Docker isolation, AI assistance, and chaos engineering.
            </p>

            <div className="auth-features-grid">
              <div className="auth-feature">
                <span className="feature-icon">⚡</span>
                <h3>Instant Execution</h3>
                <p>Run 15+ languages in isolated containers</p>
              </div>
              <div className="auth-feature">
                <span className="feature-icon">🤖</span>
                <h3>AI Assistant</h3>
                <p>Auto-fix bugs and scaffold entire projects</p>
              </div>
              <div className="auth-feature">
                <span className="feature-icon">💥</span>
                <h3>Chaos Testing</h3>
                <p>Test resilience under extreme conditions</p>
              </div>
            </div>
          </div>

          <div className="auth-form-wrapper">
            <div className="auth-card">
              <div className="auth-card-header">
                <h2>Sign in</h2>
                <p>Welcome back to your workspace</p>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                  />
                </div>

                <div className="form-group">
                  <label>Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                  />
                </div>

                {error && <div className="auth-error">{error}</div>}

                <button type="submit" disabled={loading} className="auth-submit-btn">
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              <div className="auth-footer">
                <p>Don't have an account? <Link to="/signup">Create one</Link></p>
              </div>
            </div>
          </div>
        </div>

        <section className="auth-section-cta">
          <div className="cta-content">
            <h2>Ready to code smarter?</h2>
            <p>Join thousands of developers using Orbit IDE for faster development cycles.</p>
            <Link to="/signup" className="cta-button">Get Started Free</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
