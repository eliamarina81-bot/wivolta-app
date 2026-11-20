# Auditoria documental de parceiros — Wivolta
Data da revisão: 2026-11-20
Fonte: arquivo "Campanhas - Élia.zip" fornecido pela titular do projeto. Este documento não contém dados pessoais de clientes nem credenciais.

## Conclusão operacional
Os documentos disponíveis comprovam a existência de material comercial e formulários de contratação para vários comercializadores. Não comprovam, por si só, acesso a API, portal de agente, credenciais de submissão ou autorização genérica para a Wivolta executar mudanças de contrato.

A Wivolta deve manter separados:
1. autorização do consumidor para a mudança e tratamento dos seus dados;
2. autorização/credenciação comercial do agente ou canal;
3. acesso técnico ao portal/API/OLMC e respetiva autenticação.

Não executar nem apresentar como automática uma mudança sem confirmação válida do consumidor e canal operacional autorizado.

## Inventário documental

| Comercializador | Documentos relevantes encontrados | O que permitem concluir | Lacunas |
|---|---|---|---|
| EDP | Formulário "Apresentação de Oferta Comercial - Formulário de Autorização"; contrato residencial; gestão de consentimentos; formulário SEPA; tabelas residenciais | O formulário de autorização permite à EDP apresentar uma proposta ao titular. O próprio texto esclarece que não obriga à adesão nem altera o contrato. | Necessário formulário de solicitação/contrato assinado para adesão; confirmar código de agente e canal de submissão. |
| Endesa | Declaração de venda sem SMS (V.10/2026); ficha de inscrição; autorização de contacto; declarações multiponto e canal único para empresas; fichas de campanha de novembro | Existem documentos de venda/contratação e declaração do cliente de que celebrou o contrato. | Confirmar código comercial atribuído, processo de validação e acesso ao backoffice/canal de envio. |
| Galp | Ficha de inscrição; tabelas Casa & Estrada, Negócios, Combina e Segunda Casa; SEPA | Existe ficha de recolha de dados para inscrição e documentação de preços/campanhas. | Confirmar código de vendedor/agente, autorização do canal e procedimento de submissão/acompanhamento. |
| Iberdrola | Ficha de venda Iberdrola; formulários autocopiativos de eletricidade, gás e dual; campanhas e condições | A ficha de venda contém campo Operador e Origem (pré-preenchido com DW), além dos dados técnicos e comerciais da instalação. | A ficha não é prova de credencial técnica nem de autorização independente da Wivolta. Confirmar titularidade do código/origem DW e permissões. |
| MEO Energia | Ficha de inscrição e simulador 2026; documento de alteração de preços de 2025 | Existe ficha de inscrição e simulador. | O documento de preços de 2025 é antigo; validar tabela atual e canal/código de agente. |
| Repsol | Formulário de pedido de contratação doméstica versão 20261015; tarifas Viva e Leve Pro | Existe formulário de contratação doméstica com campos de representante comercial, dados do cliente e ponto de entrega. | Confirmar código de representante e canal de submissão; não foi identificado no ZIP um acesso técnico/API. |

## Observações de conformidade e produto
- A autorização EDP analisada é explicitamente apenas para apresentação de oferta comercial; não equivale a mandato para mudar contrato.
- As fichas de inscrição de Galp, Endesa e MEO incluem recolha de dados e preferências; não devem ser reutilizadas como consentimento universal para marketing de terceiros.
- A ficha Iberdrola contém a indicação de origem "DW". Não substituir por Wivolta nem remover sem confirmação escrita do titular do canal/código.
- Formulários SEPA só devem ser recolhidos quando o cliente escolhe débito direto; tratar IBAN como dado de elevado risco e nunca o guardar em logs.
- O consentimento do cliente para a mudança deve ser específico, informado, demonstrável e ligado ao comercializador/oferta escolhida.
- Os documentos e campanhas têm datas diferentes. Antes de apresentar preço, verificar validade, tarifa, potência, ciclo horário, descontos condicionados, serviços pagos, fidelização e impostos.

## Próximo passo técnico
1. Completar a extração estruturada das tabelas de preços e condições de cada campanha válida.
2. Manter ofertas com dados incompletos como "não comparáveis" em vez de estimar preços.
3. Criar fluxo de adesão por comercializador com estado: rascunho, aguarda consentimento, pronto para submissão, submetido manualmente, confirmado/rejeitado.
4. Só ativar submissão automática após credenciais e autorização formal do canal/API serem confirmadas e testadas.
5. Avaliar onboarding no Portal OLMC/ADENE e documentação MC01, MC02 e MC03 para contactos de agentes, gestão de operadores e web services.

Referências técnicas públicas:
- OLMC eletricidade: https://olmc.adene.pt/atividade/gpmc-eletricidade/
- OLMC gás: https://olmc.adene.pt/atividade/gpmc-gas/
- OLMCA/ADENE: https://olmc.adene.pt/
