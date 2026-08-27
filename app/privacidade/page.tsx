import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de Privacidade — Fila da Marmita",
  description: "Política de privacidade da Fila da Marmita",
};

export default function PrivacidadePage() {
  return (
    <main className="min-h-screen flex justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="rounded-3xl bg-char-800 border border-char-700 p-8 shadow-glow">
          <p className="text-sm uppercase tracking-[0.2em] text-ember-500 font-semibold mb-2">
            Fila da Marmita
          </p>
          <h1 className="text-3xl font-bold text-cream-100 mb-2 leading-tight">
            Política de Privacidade
          </h1>
          <p className="text-cream-500 text-sm mb-8">Última atualização: 26 de agosto de 2026</p>

          <div className="space-y-6 text-cream-300 leading-relaxed">
            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">1. Controlador</h2>
              <p>
                O controlador dos dados pessoais tratados por este app, para os fins da Lei Geral
                de Proteção de Dados (Lei nº 13.709/2018 — LGPD), é Murilo Cruz, pessoa física,
                responsável pelo desenvolvimento e operação da Fila da Marmita. Contato:{" "}
                <a href="mailto:murilomecr@gmail.com" className="text-ember-500 underline">
                  murilomecr@gmail.com
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">
                2. Quais dados coletamos
              </h2>
              <p className="mb-2">A Fila da Marmita não pede cadastro, e-mail ou senha. Os dados tratados são:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>
                  <span className="text-cream-100">Nome:</span> o nome ou apelido que você digita
                  ao entrar na fila, usado apenas para mostrar sua posição e chamar sua vez.
                </li>
                <li>
                  <span className="text-cream-100">Inscrição de notificação push:</span> se você
                  ativar &quot;avisar mesmo se eu fechar a aba&quot;, o navegador gera um endpoint
                  e chaves criptográficas que enviamos ao servidor para poder te notificar quando
                  chegar sua vez ou abrir uma vaga. Isso só acontece se você optar por ativar.
                </li>
                <li>
                  <span className="text-cream-100">Identificador de lista de espera:</span> um id
                  e token aleatórios guardados no localStorage do seu próprio navegador (não é um
                  cookie de rastreamento) para reconhecer seu registro na lista de espera quando a
                  fila está cheia.
                </li>
                <li>
                  <span className="text-cream-100">Endereço IP:</span> usado momentaneamente para
                  limitar tentativas abusivas (rate limiting) e expira automaticamente pouco depois.
                </li>
                <li>
                  <span className="text-cream-100">Dados técnicos de erro (Sentry):</span> se algo
                  quebra, usamos o Sentry para monitorar erros. Isso pode incluir endereço IP,
                  navegador/dispositivo e o conteúdo de requisições feitas ao app no momento do
                  erro (o que, ocasionalmente, pode incluir o nome que você digitou). Usamos isso
                  só para diagnosticar e corrigir falhas técnicas.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">
                3. Por que tratamos esses dados e base legal
              </h2>
              <p>
                Tratamos nome, IP e identificador de lista de espera com base na execução do
                serviço solicitado por você ao usar o app e no legítimo interesse em manter a fila
                funcionando e protegida contra abuso (art. 7º, incisos IV e IX, da LGPD). A
                inscrição de notificação push só é coletada mediante seu consentimento explícito,
                dado ao marcar a opção de aviso (art. 7º, inciso I, da LGPD), e você pode revogá-lo
                a qualquer momento desativando as notificações nas configurações do navegador.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">
                4. Com quem compartilhamos
              </h2>
              <p className="mb-2">
                Não vendemos nem compartilhamos seus dados para fins de publicidade. Usamos os
                seguintes prestadores de serviço (operadores) para fazer o app funcionar:
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>
                  <span className="text-cream-100">Vercel</span> — hospedagem da aplicação.
                </li>
                <li>
                  <span className="text-cream-100">Upstash</span> — banco de dados (Redis) onde a
                  fila fica armazenada enquanto está ativa.
                </li>
                <li>
                  <span className="text-cream-100">Sentry</span> — monitoramento de erros técnicos.
                </li>
                <li>
                  <span className="text-cream-100">
                    Serviço de push do seu navegador (Google, Mozilla, Apple etc.)
                  </span>{" "}
                  — necessário ao próprio funcionamento do padrão Web Push para entregar a
                  notificação; é o mesmo mecanismo usado por qualquer site que envia notificações
                  push, escolhido pelo fabricante do seu navegador, não por nós.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">5. Por quanto tempo guardamos</h2>
              <p>
                Seu nome e sua inscrição de notificação ficam armazenados apenas enquanto você
                está na fila ou na lista de espera, e são removidos automaticamente quando você
                sai da fila, termina seu uso do micro-ondas ou cancela o aviso. O endereço IP usado
                para limitar abusos expira automaticamente em minutos. Dados de erro no Sentry
                seguem o período de retenção padrão do Sentry.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">6. Seus direitos</h2>
              <p className="mb-2">
                Como titular dos dados, você pode, a qualquer momento e nos termos do art. 18 da
                LGPD, solicitar:
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>confirmação de que tratamos seus dados e acesso a eles;</li>
                <li>correção de dados incompletos, inexatos ou desatualizados;</li>
                <li>exclusão dos seus dados;</li>
                <li>revogação do consentimento dado para notificações push;</li>
                <li>informação sobre com quem compartilhamos seus dados.</li>
              </ul>
              <p className="mt-2">
                Você mesmo já pode sair da fila ou da lista de espera diretamente pela interface,
                o que remove seu nome e inscrição imediatamente. Para qualquer outro pedido, entre
                em contato por{" "}
                <a href="mailto:murilomecr@gmail.com" className="text-ember-500 underline">
                  murilomecr@gmail.com
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">7. Segurança</h2>
              <p>
                Não coletamos senhas nem dados sensíveis. Os tokens de sessão usados para autorizar
                ações (como sair da fila) são armazenados em formato hash, e não em texto puro.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">8. Cookies</h2>
              <p>
                O app não usa cookies de rastreamento ou publicidade. O único dado guardado no
                navegador é o identificador de lista de espera, salvo no localStorage e usado
                apenas para reconhecer seu próprio registro.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">9. Crianças e adolescentes</h2>
              <p>
                Este app é destinado a uso por pessoas de um ambiente de trabalho e não é
                direcionado a crianças.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-cream-100 mb-2">10. Alterações desta política</h2>
              <p>
                Esta política pode ser atualizada conforme o app evolui. A data no topo desta
                página indica a versão vigente.
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
