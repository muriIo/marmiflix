export function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-3xl bg-char-800 border border-char-700 p-8 shadow-glow text-center"
    >
      <div className="mx-auto mb-6 h-10 w-10 animate-spin rounded-full border-4 border-char-600 border-t-ember-500" />
      <p className="text-cream-300">Conectando à fila...</p>
    </div>
  );
}
