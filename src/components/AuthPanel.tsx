"use client";
import { useState, type FormEvent } from "react";
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
    [error, setError] = useState("");
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
  return (
    <section
      id="auth-screen"
      className="auth-screen"
      aria-label="Lineup sign in"
    >
      <div className="auth-card">
        <Brand />
        <div className="auth-heading">
          <h1>{setup ? "Your lineup starts here." : "Welcome back."}</h1>
          <p>
            {setup
              ? "Create your personal sign-in to keep your follows and release dates together."
              : "Sign in to your releases, wherever you left off."}
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
          />
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            name="password"
            type="password"
            autoComplete={setup ? "new-password" : "current-password"}
            minLength={setup ? 12 : undefined}
            maxLength={256}
            required
            placeholder={setup ? "At least 12 characters" : "Your password"}
          />
          <div className="auth-error" role="alert">
            {error}
          </div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Please wait…" : setup ? "Create my Lineup" : "Sign in"}{" "}
            <span aria-hidden="true">→</span>
          </button>
        </form>
        <p className="auth-note">
          {setup
            ? "One personal account. Your existing library stays with you."
            : "You’ll stay signed in on this device for 30 days."}
        </p>
        <div className="auth-footer">Your next watch, all lined up.</div>
      </div>
    </section>
  );
}
