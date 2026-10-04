import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { ArrowRight, Check, ChevronRight, CloudCog, Eye, EyeOff, LockKeyhole, Menu, ShieldCheck, Sparkles, TrendingDown, Zap } from 'lucide-react';
import { api, type SessionUser } from '../lib/api';

type PublicProps = { navigate: (path: string) => void };
type SignInProps = PublicProps & { toast: (title: string, body: string, tone?: 'success' | 'info') => void };
type AuthenticatedSignInProps = SignInProps & { onAuthenticated: (user: SessionUser) => void };
type LandingProps = PublicProps & { toast: SignInProps['toast']; onEnterDemo: () => Promise<void> };

type VerificationUser = Pick<SessionUser, 'name' | 'email'> | null;

export function LandingPage({ navigate, toast, onEnterDemo }: LandingProps) {
  const enterDemo = async () => {
    try {
      await onEnterDemo();
    } catch (error) {
      toast('Demo environment unavailable', error instanceof Error ? error.message : 'The sample environment could not be opened.');
    }
  };
  return (
    <div className="landing-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="SmartSize home">
          <span className="landing-brand-mark"><CloudCog size={19} /></span>
          <span>Smart<span>Size</span></span>
        </a>
        <nav className="landing-links" aria-label="Primary navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#for-teams">For teams</a>
          <a href="#security">Security</a>
        </nav>
        <div className="landing-actions">
          <button className="landing-signin" onClick={() => navigate('/signin')}>Sign in <ArrowRight size={14} /></button>
          <button className="landing-menu" aria-label="Open menu"><Menu size={20} /></button>
        </div>
      </header>

      <main id="main-content">
        <section className="landing-hero">
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <div className="hero-copy">
            <div className="landing-kicker"><span className="pulse-dot" /> Cloud cost intelligence for teams that move with intent</div>
            <h1>Pay for the capacity your cloud <em>actually</em> needs.</h1>
            <p className="hero-lede">SmartSize adds explainable analysis, policy, and human approval around AWS rightsizing recommendations.</p>
            <div className="hero-actions">
              <button className="landing-cta" onClick={() => void enterDemo()}>Explore the demo <ArrowRight size={16} /></button>
              <button className="landing-quiet" onClick={() => navigate('/signin')}>Sign in to workspace <ChevronRight size={15} /></button>
            </div>
            <div className="hero-proof">
              <div className="proof-avatars"><span>AN</span><span>RK</span><span>MP</span></div>
              <span>Designed for FinOps, platform and engineering teams</span>
            </div>
          </div>

          <div className="hero-visual" aria-label="SmartSize dashboard preview">
            <div className="visual-glow" />
            <div className="dashboard-window">
              <div className="window-chrome">
                <span className="chrome-dot red" />
                <span className="chrome-dot yellow" />
                <span className="chrome-dot green" />
                <span className="window-address">right<span>scale</span> / overview</span>
                <span className="window-mode">DEMO</span>
              </div>
              <div className="window-body">
                <div className="window-sidebar">
                  <span className="tiny-logo"><CloudCog size={11} /></span>
                  <span className="tiny-line wide" />
                  <span className="tiny-line" />
                  <span className="tiny-line" />
                  <span className="tiny-line" />
                  <span className="tiny-line" />
                  <span className="tiny-line short" />
                </div>
                <div className="window-content">
                  <div className="window-eyebrow">CLOUD OPTIMIZATION OVERVIEW</div>
                  <div className="window-title">Clarity, before complexity.</div>
                  <div className="window-kpis">
                    <div><small>Potential savings</small><strong>₹69,570</strong><span>Monthly demo estimate</span></div>
                    <div><small>Resources analyzed</small><strong>24</strong><span>Across 4 services</span></div>
                    <div><small>Recommendations</small><strong>10</strong><span>9 awaiting decision</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="signal-strip" aria-label="Platform capabilities">
          <div className="signal-track">
            <span>AWS Compute Optimizer</span><i /> <span>CloudWatch signals</span><i /> <span>Cost Explorer visibility</span><i />
            <span>Explainable recommendations</span><i /> <span>Controlled approvals</span><i /> <span>AWS Compute Optimizer</span>
          </div>
        </div>

        <section className="story-section" id="how-it-works">
          <div className="section-intro">
            <div className="landing-kicker muted"><span className="tiny-rule" /> The intelligent layer between signal and action</div>
            <h2>Less noise. <em>Better decisions.</em></h2>
            <p>SmartSize translates utilization and cost evidence into a decision-ready review process.</p>
          </div>
          <div className="story-grid">
            <StoryCard number="01" title="See clearly" body="A calm, high-signal view of infrastructure, utilization, and cost without spreadsheet archaeology." icon={<Eye size={19} />} />
            <StoryCard number="02" title="Decide confidently" body="Every recommendation includes financial impact, risk, and the context stakeholders need to move faster." icon={<Sparkles size={19} />} accent />
            <StoryCard number="03" title="Act with control" body="Simulate outcomes, review with context, and approve changes through a deliberate workflow." icon={<ShieldCheck size={19} />} />
          </div>
        </section>

        <section className="proof-section" id="for-teams">
          <div className="proof-card">
            <div className="proof-card-kicker">A better conversation about cloud cost</div>
            <div className="proof-quote">“What if the path to lower cloud cost felt less like a fire drill — and more like a <em>well-informed decision</em>?”</div>
            <div className="proof-byline"><span className="proof-line" /> <span>Built for the people who own infrastructure outcomes</span></div>
          </div>
          <div className="proof-stats">
            <div><strong>24</strong><span>sample resources</span></div>
            <div><strong>₹8.35L</strong><span>annualized demo opportunity</span></div>
            <div><strong>85%</strong><span>average demo confidence</span></div>
          </div>
        </section>

        <section className="security-section" id="security">
          <div className="security-copy">
            <div className="landing-kicker muted"><LockKeyhole size={14} /> Trust is part of the interface</div>
            <h2>Confidence, by design.</h2>
            <p>SmartSize keeps a clear audit trail and separates the sample environment from live AWS connectivity.</p>
            <div className="security-list">
              <div><Check size={15} /> Demo-first, while clearly distinguishing simulated and live environment states</div>
              <div><Check size={15} /> Least-privilege access posture for future AWS integrations</div>
              <div><Check size={15} /> Human approval before operational change</div>
            </div>
          </div>
          <div className="security-panel">
            <div className="security-panel-top">
              <span className="landing-brand-mark"><LockKeyhole size={17} /></span>
              <span>SECURITY POSTURE</span>
              <span className="panel-live"><span /> Ready</span>
            </div>
            <div className="security-ring"><div><strong>Verified</strong><span>session-based access</span></div></div>
            <div className="security-foot"><span>Demo environment</span><span>Least-privilege ready</span></div>
          </div>
        </section>

        <section className="final-cta">
          <div className="final-ornament" />
          <div className="landing-kicker"><span className="pulse-dot" /> The next conversation starts here</div>
          <h2>Make every cloud decision<br /><em>worth explaining.</em></h2>
          <p>Explore SmartSize using a sample cloud environment. No AWS account or credentials are required.</p>
          <button className="landing-cta" onClick={() => void enterDemo()}>Explore Demo Environment <ArrowRight size={16} /></button>
        </section>
      </main>

      <footer className="landing-footer">
        <a className="landing-brand" href="/" aria-label="SmartSize home">
          <span className="landing-brand-mark"><CloudCog size={16} /></span>
          <span>Smart<span>Size</span></span>
        </a>
        <span>Intelligent AWS Cloud Cost Optimization</span>
        <span>© 2026 SmartSize</span>
      </footer>
    </div>
  );
}

function StoryCard({ number, title, body, icon, accent }: { number: string; title: string; body: string; icon: ReactNode; accent?: boolean }) {
  return (
    <article className={`story-card ${accent ? 'accent' : ''}`}>
      <div className="story-card-top">
        <span className="story-number">{number}</span>
        <span className="story-icon">{icon}</span>
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      <span className="story-arrow"><ArrowRight size={15} /></span>
    </article>
  );
}

export function SignInPage({ navigate, toast, onAuthenticated }: AuthenticatedSignInProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    void api.authProviders().then(({ google }) => {
      if (active) setGoogleAvailable(google);
    }).catch(() => {
      if (active) setGoogleAvailable(false);
    });
    return () => { active = false; };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const { user } = await api.login({ email, password });
      onAuthenticated(user);
      toast('Welcome back', `You are signed in to SmartSize, ${user.name}.`, 'success');
      navigate('/overview');
    } catch (error) {
      toast('Sign in failed', error instanceof Error ? error.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signin-shell">
      <a className="skip-link" href="#signin-form">Skip to sign in</a>
      <div className="signin-brand-wrap">
        <a className="landing-brand" href="/" aria-label="SmartSize home">
          <span className="landing-brand-mark"><CloudCog size={19} /></span>
          <span>Smart<span>Size</span></span>
        </a>
        <div className="signin-backdrop-copy">
          <div className="landing-kicker"><span className="pulse-dot" /> Intelligent AWS Cloud Cost Optimization</div>
          <h1>Clarity for the<br /><em>cloud-minded.</em></h1>
          <p>Bring your infrastructure, finance and engineering conversations into one decision-ready workspace.</p>
          <div className="signin-mini-proof">
            <span><Zap size={13} /> 24 demo resources</span>
            <span><TrendingDown size={13} /> ₹69,570 monthly opportunity</span>
          </div>
        </div>
        <div className="signin-corner-note"><span className="pulse-dot" /> DEMO ENVIRONMENT</div>
      </div>

      <div className="signin-panel">
        <div className="signin-panel-inner">
          <div className="signin-mobile-brand">
            <a className="landing-brand" href="/">
              <span className="landing-brand-mark"><CloudCog size={17} /></span>
              <span>Right<span>Scale</span></span>
            </a>
          </div>
          <div className="signin-heading">
            <div className="landing-kicker muted">Workspace access</div>
            <h2>Welcome back.</h2>
            <p>Sign in to continue to the SmartSize AWS rightsizing workspace.</p>
          </div>

          <button className="google-btn" type="button" onClick={() => { if (googleAvailable) window.location.assign('/api/auth/google/start'); }} disabled={loading || !googleAvailable} title={googleAvailable ? 'Continue with Google' : 'Google SSO is unavailable until OAuth credentials are configured.'}>
            <span className="google-g">G</span>
            <span>{googleAvailable ? 'Continue with Google' : 'Google sign-in unavailable'}</span>
            <span className="google-arrow"><ArrowRight size={14} /></span>
          </button>

          <div className="or-divider"><span>or continue with email</span></div>

          <form id="signin-form" onSubmit={submit}>
            <label className="signin-label" htmlFor="email">Work email
              <input id="email" className="signin-input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" />
            </label>
            <label className="signin-label" htmlFor="password">Password
              <div className="password-field">
                <input id="password" className="signin-input" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" />
                <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </label>
            <div className="signin-row">
              <label className="remember-box"><input type="checkbox" /><span>Keep me signed in</span></label>
              <button type="button" className="inline-link" onClick={() => navigate('/forgot-password')}>Forgot password?</button>
            </div>
            <button className="signin-submit" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in to workspace'}<ArrowRight size={15} /></button>
          </form>

          <p className="auth-switch">
            New to SmartSize? <button type="button" className="inline-link" onClick={() => navigate('/register')}>Create an account</button>
          </p>
        </div>
      </div>
    </div>
  );
}

export function RegisterPage({ navigate, toast }: SignInProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      toast('Passwords do not match', 'Enter the same value in both password fields.');
      return;
    }
    setLoading(true);
    try {
      const response = await api.register({ name, email, password, confirmPassword });
      if (response.verificationRequired) {
        toast('Account created', response.developmentToken ? `Development verification token: ${response.developmentToken}` : 'Check your email to activate the SmartSize workspace.', 'success');
        navigate('/verify-email');
      } else {
        toast('Account created', 'Sign in to initialize your workspace and choose an environment.', 'success');
        navigate('/signin');
      }
    } catch (error) {
      toast('Registration failed', error instanceof Error ? error.message : 'Unable to create an account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signin-shell compact-shell">
      <div className="signin-panel auth-panel-alone">
        <div className="signin-panel-inner">
          <div className="signin-heading">
            <div className="landing-kicker muted">Create account</div>
            <h2>Start with SmartSize.</h2>
            <p>Set up a verified workspace and connect to a realistic AWS optimization workflow.</p>
          </div>

          <form onSubmit={submit}>
              <label className="signin-label" htmlFor="name">Full name
                <input id="name" className="signin-input" type="text" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Alyssa Morgan" />
              </label>
              <label className="signin-label" htmlFor="register-email">Work email
                <input id="register-email" className="signin-input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" />
              </label>
              <label className="signin-label" htmlFor="register-password">Password
                <div className="password-field">
                  <input id="register-password" className="signin-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" />
                  <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </label>
              <label className="signin-label" htmlFor="confirm-password">Confirm password
                <input id="confirm-password" className="signin-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat your password" />
              </label>
              <button className="signin-submit" type="submit" disabled={loading}>{loading ? 'Creating account…' : 'Create account'}<ArrowRight size={15} /></button>
          </form>
          <p className="auth-switch">
            Already have an account? <button type="button" className="inline-link" onClick={() => navigate('/signin')}>Sign in</button>
          </p>
        </div>
      </div>
    </div>
  );
}

export function VerificationRequiredPage({ user, navigate, toast }: { user: VerificationUser; navigate: (path: string) => void; toast: (title: string, body: string, tone?: 'success' | 'info') => void }) {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const queryToken = new URLSearchParams(window.location.search).get('token');
    if (queryToken) setToken(queryToken);
  }, []);

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      await api.verifyEmail(token.trim());
      toast('Email verified', 'Your SmartSize account is now active. Please sign in.', 'success');
      navigate('/signin');
    } catch (error) {
      toast('Verification failed', error instanceof Error ? error.message : 'The verification token was invalid.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signin-shell compact-shell">
      <div className="signin-panel auth-panel-alone">
        <div className="signin-panel-inner">
          <div className="signin-heading">
            <div className="landing-kicker muted">Verify your email</div>
            <h2>Activate your SmartSize workspace.</h2>
            <p>{user?.name ? `Hi ${user.name},` : 'Your account is created, but email verification is required before access is granted.'} Enter the verification code from your email.</p>
          </div>
          <form onSubmit={verify}>
            <label className="signin-label" htmlFor="verify-token">Verification token
              <input id="verify-token" className="signin-input" type="text" required value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste the activation token" />
            </label>
            <button className="signin-submit" type="submit" disabled={loading}>{loading ? 'Verifying…' : 'Verify email'}<ArrowRight size={15} /></button>
          </form>
          <p className="auth-switch">
            Need a new code? <button type="button" className="inline-link" onClick={() => navigate('/signin')}>Back to sign in</button>
          </p>
        </div>
      </div>
    </div>
  );
}

export function PasswordResetRequestPage({ navigate, toast }: SignInProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const result = await api.requestPasswordReset(email);
      toast('Password reset sent', result.developmentToken ? 'Opening the local development-only reset flow.' : 'If an account exists for that email, a secure reset link has been issued.', 'success');
      navigate(result.developmentToken ? `/reset-password?token=${encodeURIComponent(result.developmentToken)}` : '/signin');
    } catch (error) {
      toast('Reset request failed', error instanceof Error ? error.message : 'Unable to request a reset.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signin-shell compact-shell">
      <div className="signin-panel auth-panel-alone">
        <div className="signin-panel-inner">
          <div className="signin-heading">
            <div className="landing-kicker muted">Reset password</div>
            <h2>Recover access to SmartSize.</h2>
            <p>Enter the email tied to your account and we will generate a secure reset flow.</p>
          </div>
          <form onSubmit={submit}>
            <label className="signin-label" htmlFor="reset-email">Work email
              <input id="reset-email" className="signin-input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" />
            </label>
            <button className="signin-submit" type="submit" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}<ArrowRight size={15} /></button>
          </form>
          <p className="auth-switch">
            Remembered it? <button type="button" className="inline-link" onClick={() => navigate('/signin')}>Sign in</button>
          </p>
        </div>
      </div>
    </div>
  );
}

export function PasswordResetPage({ navigate, toast }: SignInProps) {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const queryToken = new URLSearchParams(window.location.search).get('token');
    if (queryToken) setToken(queryToken);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      toast('Passwords do not match', 'Enter the same value in both password fields.');
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword(token.trim(), password, confirmPassword);
      toast('Password updated', 'Your SmartSize password has been reset successfully.', 'success');
      navigate('/signin');
    } catch (error) {
      toast('Reset failed', error instanceof Error ? error.message : 'Unable to reset the password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signin-shell compact-shell">
      <div className="signin-panel auth-panel-alone">
        <div className="signin-panel-inner">
          <div className="signin-heading">
            <div className="landing-kicker muted">Choose a new password</div>
            <h2>Reset your password.</h2>
            <p>Use the secure token from your email to choose a new password for your SmartSize workspace.</p>
          </div>
          <form onSubmit={submit}>
            <label className="signin-label" htmlFor="reset-token">Reset token
              <input id="reset-token" className="signin-input" type="text" required value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste the reset token" />
            </label>
            <label className="signin-label" htmlFor="new-password">New password
              <div className="password-field">
                <input id="new-password" className="signin-input" type={showPassword ? 'text' : 'password'} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" />
                <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </label>
            <label className="signin-label" htmlFor="confirm-reset-password">Confirm new password
              <input id="confirm-reset-password" className="signin-input" type={showPassword ? 'text' : 'password'} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat the new password" />
            </label>
            <button className="signin-submit" type="submit" disabled={loading}>{loading ? 'Updating…' : 'Update password'}<ArrowRight size={15} /></button>
          </form>
        </div>
      </div>
    </div>
  );
}
