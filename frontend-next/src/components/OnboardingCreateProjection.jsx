export function OnboardingCreateProjection({
  value,
  seed,
  result,
  busy,
  placeholder,
  submitLabel,
  inputRef,
  onChange,
  onSubmit,
}) {
  const hasResult = Boolean(result);

  function submit(event) {
    event?.preventDefault();
    if (busy || !String(value || "").trim()) return;
    onSubmit?.();
  }

  return (
    <aside
      className={"home-ob-demo home-ob-demo--create-projection" + (hasResult ? " is-result" : " is-prompt")}
      aria-label="创作投射"
    >
      <div className="home-create-projection-head">
        <span className="home-create-projection-kicker t-meta">创作投射</span>
        <h2 className="home-create-projection-title t-kai">{hasResult ? "方向正在成形" : "先放进一个念头"}</h2>
      </div>

      {hasResult ? (
        <div className="home-create-projection-result" aria-live="polite">
          <div className="home-create-projection-block">
            <span className="home-create-projection-label t-meta">你的种子</span>
            <blockquote className="home-create-projection-seed t-read">{seed}</blockquote>
          </div>
          <div className="home-create-projection-thread" aria-hidden="true" />
          <div className="home-create-projection-block">
            <span className="home-create-projection-label t-meta">已生成方向</span>
            <p className="home-create-projection-copy t-read">{result}</p>
          </div>
        </div>
      ) : (
        <form className="home-create-projection-form" onSubmit={submit}>
          <label className="home-create-projection-label t-meta" htmlFor="onboarding-create-seed">
            一句话、一个画面，都可以
          </label>
          <div className="home-create-projection-composer">
            <input
              id="onboarding-create-seed"
              ref={inputRef}
              value={value}
              disabled={busy}
              placeholder={busy ? "执笔人正在接住这个念头…" : placeholder}
              onChange={onChange}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  submit(event);
                }
              }}
            />
            <button type="submit" disabled={busy || !String(value || "").trim()}>
              {busy ? "…" : submitLabel}
            </button>
          </div>
          <p className="home-create-projection-note t-meta">不必先想完整，方向会从这一点慢慢展开。</p>
        </form>
      )}
    </aside>
  );
}
