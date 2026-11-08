// Data folder override (spec §3.3). Must run before anything reads app.getPath('userData').

/** Points `userData` at `STUDYAT_USER_DATA` when set; returns the effective userData path. */
export function applyUserDataOverride(app: Electron.App, env: NodeJS.ProcessEnv): string {
  const override = env.STUDYAT_USER_DATA;
  if (override) {
    app.setPath('userData', override);
    return override;
  }
  return app.getPath('userData');
}
