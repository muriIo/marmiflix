import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Termos de Uso — Fila da Marmita",
  description: "Termos de uso da Fila da Marmita",
};

export default function TermosPage() {
  return (
    <main className="min-h-screen flex justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="rounded-3xl bg-char-800 border border-char-700 p-8 shadow-glow">
          <p className="text-sm uppercase tracking-[0.2em] text-ember-500 font-semibold mb-2">
            Fila da Marmita
          </p>
          <h1 className="text-3xl font-bold text-cream-100 mb-2 leading-tight">Termos de Uso</h1>
          <p className="text-cream-500 text-sm mb-8">Última atualização: 26 de agosto de 2026</p>

          <div className="space-y-6 text-cream-300 leading-relaxed">
            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">1. Sobre o serviço</h2>
              <p>
                A Fila da Marmita é uma ferramenta simples para organizar a vez de aquecer
                marmitas no micro-ondas de um escritório. Não é um produto comercial: é mantida
                por Murilo Cruz para uso por pessoas de um mesmo ambiente de trabalho. Não há
                cadastro de conta, senha ou coleta de dados além do estritamente necessário para
                a fila funcionar — veja a{" "}
                <Link href="/privacidade" className="text-ember-500 underline">
                  Política de Privacidade
                </Link>{" "}
                para detalhes.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">2. Aceitação</h2>
              <p>
                Ao usar a Fila da Marmita — entrar na fila, ativar avisos ou registrar-se na lista
                de espera — você concorda com estes Termos de Uso e com a Política de Privacidade.
                Se não concordar, basta não usar o app.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">3. Como usar</h2>
              <ul className="list-disc list-inside space-y-1">
                <li>Use seu próprio nome (ou um apelido que te identifique para quem está por perto) — não use o nome de outra pessoa sem que ela saiba.</li>
                <li>Não tente furar a fila manipulando o app, criando várias entradas para a mesma pessoa ou automatizando pedidos.</li>
                <li>As notificações push são opcionais e podem ser desativadas a qualquer momento nas configurações do seu navegador.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">
                4. Disponibilidade e responsabilidade
              </h2>
              <p>
                O serviço é oferecido &quot;como está&quot;, sem garantia de disponibilidade
                contínua. Ele pode ficar fora do ar, ter comportamento inesperado ou ser
                descontinuado sem aviso prévio. Ele não substitui bom senso: em caso de dúvida
                sobre a ordem da fila, converse com as pessoas por perto. Murilo Cruz não se
                responsabiliza por atrasos, marmitas frias ou disputas pelo micro-ondas.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">5. Alterações</h2>
              <p>
                Estes termos podem mudar conforme o app evolui. A data de &quot;última
                atualização&quot; no topo desta página indica a versão vigente. O uso continuado
                do app após uma alteração implica concordância com o novo texto.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">6. Contato</h2>
              <p>
                Dúvidas sobre estes termos:{" "}
                <a href="mailto:murilomecr@gmail.com" className="text-ember-500 underline">
                  murilomecr@gmail.com
                </a>
                .
              </p>
            </section>
          </div>

          <Link
            href="/"
            className="inline-block mt-8 text-sm text-cream-500 hover:text-cream-300 underline"
          >
            ← Voltar para a fila
          </Link>
        </div>
      </div>
    </main>
  );
}
