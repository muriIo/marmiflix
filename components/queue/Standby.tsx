"use client";

export function Standby({ onReturn }: { onReturn: () => void }) {
  return (
    <div className="rounded-3xl bg-char-800 border border-char-700 p-8 shadow-glow text-center">
      <p className="text-sm uppercase tracking-[0.2em] text-ember-500 font-semibold mb-2">
        Fila da Marmita
      </p>
      <h1 className="text-3xl font-bold text-cream-100 mb-6 leading-tight">
        Você está no saguão. Nos avise quando quiser voltar para a fila.
      </h1>
      <button
        type="button"
        onClick={onReturn}
        className="w-full rounded-xl bg-gradient-to-r from-ember-500 to-amber-500 px-4 py-3 font-semibold text-char-950 transition-opacity"
      >
        Voltar para a fila
      </button>
    </div>
  );
}
