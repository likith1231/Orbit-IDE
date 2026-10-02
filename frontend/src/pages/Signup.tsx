import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { saveAuth } from '../auth';
import Navbar from '../components/Navbar';
import Galaxy from '../components/Galaxy';
import './auth-pages.css';
import { apiFetch } from '../lib/apiFetch';


export default function Signup() {
  const [name, setName] = useState('');
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
      const res = await apiFetch(`/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Signup failed.');
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
            <h1 className="auth-hero-title">Start Coding Smarter Today</h1>
            <p className="auth-hero-subtitle">
              Join a community of developers building with AI-assisted code execution, instant Docker deployment, and advanced chaos testing.
            </p>

            <div className="auth-features-grid">
              <div className="auth-feature">
                <span className="feature-icon">🚀</span>
                <h3>Quick Setup</h3>
                <p>Get started in seconds, no installation needed</p>
              </div>
              <div className="auth-feature">
                <span className="feature-icon">🔒</span>
                <h3>Secure Sandbox</h3>
                <p>Isolated containers protect your system</p>
              </div>
              <div className="auth-feature">
                <span className="feature-icon">∞</span>
                <h3>Unlimited Projects</h3>
                <p>Create and manage unlimited workspaces</p>
              </div>
            </div>
          </div>

          <div className="auth-form-wrapper">
            <div className="auth-card">
              <div className="auth-card-header">
                <h2>Create account</h2>
                <p>Join the Orbit IDE community</p>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label>Full Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Likith Kumar"
                  />
                </div>

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
                    minLength={8}
                    placeholder="At least 8 characters"
                  />
                </div>

                {error && <div className="auth-error">{error}</div>}

                <button type="submit" disabled={loading} className="auth-submit-btn">
                  {loading ? 'Creating account…' : 'Sign up'}
                </button>
              </form>

              <div className="auth-footer">
                <p>Already have an account? <Link to="/login">Sign in</Link></p>
              </div>
            </div>
          </div>
        </div>

        <section className="auth-section-features">
          <div className="features-container">
            <h2>Built for Modern Developers</h2>
            <div className="features-list">
              <div className="feature-item">
                <h4>🧠 AI-Powered Debugging</h4>
                <p>Get intelligent suggestions to fix bugs and optimize code in real-time</p>
              </div>
              <div className="feature-item">
                <h4>📊 Chaos Engineering</h4>
                <p>Stress test your applications and simulate failure scenarios</p>
              </div>
              <div className="feature-item">
                <h4>🌐 Multi-Language Support</h4>
                <p>Code in Python, JavaScript, Java, Go, Rust, and 10+ more languages</p>
              </div>
              <div className="feature-item">
                <h4>⚡ Real-time Collaboration</h4>
                <p>Share your workspace and code with teammates instantly</p>
              </div>
            </div>
          </div>
        </section>

        <section className="auth-section-cta">
          <div className="cta-content">
            <h2>What are you waiting for?</h2>
            <p>Start building your next project with Orbit IDE today.</p>
            <button className="cta-button" onClick={() => window.scrollTo(0, 0)}>
              Get Started Now
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
