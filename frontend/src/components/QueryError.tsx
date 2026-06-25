interface Props {
  onRetry: () => void;
  message?: string;
}

/** Inline error state for query-gated pages. Drop-in: `if (q.isError) return <QueryError onRetry={q.refetch} />` */
export default function QueryError({ onRetry, message }: Props) {
  return (
    <main className="screen" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="card card-pad" style={{ textAlign: "center", maxWidth: 360 }}>
        <h2 style={{ marginBottom: 10 }}>Couldn't load data</h2>
        <p className="muted" style={{ fontSize: 14, marginBottom: 20 }}>
          {message ?? "Check your connection and try again."}
        </p>
        <button className="btn btn-volt" onClick={onRetry}>Retry</button>
      </div>
    </main>
  );
}
