import React from 'react';
import './Navbar.css';

export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-container">
        <div className="navbar-brand">
          <span className="navbar-logo">⚡ Orbit IDE</span>
        </div>
        <ul className="navbar-menu">
          <li><a href="#features">Features</a></li>
          <li><a href="#about">About</a></li>
          <li><a href="#pricing">Pricing</a></li>
          <li><a href="#docs">Docs</a></li>
        </ul>
        <div className="navbar-actions">
          <a href="/login" className="navbar-signin">Sign in</a>
        </div>
      </div>
    </nav>
  );
}
