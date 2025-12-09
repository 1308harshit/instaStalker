import "./App.css";

const highlights = [
  {
    title: "Performance refresh",
    detail: "Caching and asset pipeline tuned for faster page loads.",
  },
  {
    title: "Payments hardening",
    detail: "New safeguards to keep checkout steady during peaks.",
  },
  {
    title: "Better observability",
    detail: "Expanded monitoring so issues are caught before you notice.",
  },
];

const pulses = ["Database tune-up", "API polish", "Realtime alerts"];

function App() {
  return (
    <main className="page">
      <div className="bg-orb orb-a" />
      <div className="bg-orb orb-b" />
      <div className="bg-orb orb-c" />
      <div className="bg-grid" aria-hidden="true" />

      <section className="card">
        <div className="pill">Site refresh in progress</div>
        <h1>
          We&apos;ll be right back.
          <span className="accent"> Promise.</span>
        </h1>
        <p className="lede">
          We&apos;re shipping a maintenance update to make the experience
          smoother, faster, and more reliable. Thanks for holding tight while we
          polish things up.
        </p>

        <div className="status">
          <span className="pulse" aria-hidden="true" />
          <div className="status-copy">
            <strong>Maintenance window active</strong>
            <small>Estimated wrap-up: ~45 minutes</small>
          </div>
          <span className="tag">99.9% uptime target</span>
        </div>

        <div className="meter" role="presentation">
          <div className="meter-fill" />
        </div>

        <div className="chip-row">
          {pulses.map((item) => (
            <span key={item} className="chip">
              {item}
            </span>
          ))}
        </div>

        <div className="cta-row">
          <a className="btn primary" href="">
            Email support
          </a>
          <a
            className="btn ghost"
            href=""
            rel="noreferrer"
          >
            View status
          </a>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="badge">What we&apos;re shipping</span>
            <span className="badge soft">Live monitoring</span>
          </div>
          <div className="panel-grid">
            {highlights.map((item) => (
              <article key={item.title} className="panel-card">
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
        </div>

        
      </section>
    </main>
  );
}

export default App;
