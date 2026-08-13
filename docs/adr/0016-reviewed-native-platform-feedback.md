# ADR 0016: feedback nativo revisado e fail-closed

Status: Accepted

## Context

Uma ação local do ContentLens pode ter um equivalente visível na plataforma,
como "Não tenho interesse". Acionar o controle errado altera recomendações ou
relações da conta e, em várias redes, não há um caminho confiável de desfazer.
Seletores, rótulos e confirmações também mudam sem aviso.

## Decision

O resultado local termina e é persistido antes de qualquer oferta nativa. A
oferta é secundária, opt-in por plataforma e exige uma revisão visível seguida
por um gesto confiável separado. O content script revalida identidade, nó,
superfície, rótulo, visibilidade, estado habilitado e instância da página
imediatamente antes de uma única ativação.

Cada plataforma tem um addendum versionado. Um addendum sem fixture compatível,
confirmação positiva e live smoke datado permanece `unsupported`. Hacker News e
RSS permanecem `unavailable`. A implementação não usa cookie, storage da conta,
token, API privada, endpoint remoto ou técnica contra proteção anti-automação.

`submitted` exige evidência positiva visível vinculada ao mesmo alvo. Timeout,
interrupção, navegação ou resultado ambíguo terminam em `uncertain`, sem retry
automático. Retry manual cria outro `attemptId`, outro gesto e uma referência ao
resultado anterior.

Três falhas de contrato na mesma plataforma, superfície, ação e versão de
adapter em dez minutos abrem um circuito isolado. Passagem de tempo não fecha o
circuito. Somente uma versão nova ou self-test explícito bem-sucedido fecha.

## Consequences

- A ação local continua disponível quando a plataforma muda.
- Nenhuma ação nativa real é habilitada por inferência ou seletor não testado.
- O produto conserva estados incertos em vez de declarar sucesso sem prova.
- A promoção de cada superfície exige evidência manual controlada e datada.
