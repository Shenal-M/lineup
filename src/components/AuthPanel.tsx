"use client";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Brand } from "./ui";
import { api, message, type User } from "./types";
export function AuthPanel({
  setup,
  setupKeyRequired,
  onSignedIn,
}: {
  setup: boolean;
  setupKeyRequired: boolean;
  onSignedIn: (user: User) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [showPassword, setShowPassword] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await api<{ user: User }>(
        "auth/" + (setup ? "setup" : "login"),
        "POST",
        Object.fromEntries(data),
      );
      await onSignedIn(result.user);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  const PasswordIcon = showPassword ? EyeOff : Eye;
  return (
    <section
      id="auth-screen"
      className="auth-screen"
      aria-label="Lineup sign in"
    >
      <div className="auth-card">
        <Brand />
        <div className="auth-heading">
          <h1>{setup ? "Create your account." : "Welcome back."}</h1>
          <p>
            {setup
              ? "Set up your sign-in to keep follows and release dates together."
              : "Sign in to pick up where you left off."}
          </p>
        </div>
        <form onSubmit={submit}>
          {setup && setupKeyRequired && (
            <>
              <label htmlFor="setup-key">Setup key</label>
              <input
                id="setup-key"
                name="setupKey"
                type="password"
                autoComplete="off"
                required
                placeholder="From your hosting secrets"
              />
            </>
          )}
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            name="email"
            type="email"
            autoComplete="username"
            required
            placeholder="you@example.com"
            maxLength={254}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "auth-error" : undefined}
          />
          <label htmlFor="auth-password">Password</label>
          <div className="password-field">
            <input
              id="auth-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={setup ? "new-password" : "current-password"}
              minLength={setup ? 12 : undefined}
              maxLength={256}
              required
              placeholder={setup ? "At least 12 characters" : "Your password"}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "auth-error" : undefined}
            />
            <button
              type="button"
              className="icon-button password-toggle"
              aria-label="Show password"
              aria-pressed={showPassword}
              aria-controls="auth-password"
              onClick={() => setShowPassword((v) => !v)}
            >
              <PasswordIcon
                className="icon"
                size={16}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </button>
          </div>
          <div id="auth-error" className="auth-error" role="alert">
            {error && <p>{error}</p>}
          </div>
          <button className="primary" type="submit" disabled={busy}>
            {busy
              ? setup
                ? "Creating account…"
                : "Signing in…"
              : setup
                ? "Create account"
                : "Sign in"}
          </button>
        </form>
        <p className="auth-note">
          {setup
            ? "One personal account. Your existing library stays with you."
            : "You’ll stay signed in on this device for 30 days."}
        </p>
      </div>
    </section>
  );
}
