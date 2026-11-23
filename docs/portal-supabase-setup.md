# Ativação segura do portal Wivolta

O portal de cliente está implementado, mas fica **desativado por defeito**. Não recolhe contas nem permite autenticação enquanto a configuração não estiver completa.

## 1. Configuração na Vercel

No projeto `wivolta`, adicionar estas variáveis nos ambientes pretendidos:

| Variável | Valor |
|---|---|
| `SUPABASE_URL` | URL HTTPS do projeto Supabase |
| `SUPABASE_ANON_KEY` | Chave pública/anon do projeto Supabase |
| `WIVOLTA_PORTAL_ENABLED` | `true` |

A chave anon/publishable é uma chave pública e só pode ser usada porque as tabelas têm RLS. **Nunca colocar a chave `service_role` no navegador, no HTML ou nesta configuração pública.**

O endpoint `/api/supabase-config` só devolve URL e chave pública. Se `WIVOLTA_PORTAL_ENABLED` não for exatamente `true`, o portal permanece desligado.

## 2. Aplicar as migrações

No SQL Editor do projeto Supabase, executar pela ordem:

1. `supabase/migrations/001_wivolta_clientes_contratos.sql`
2. `supabase/migrations/002_wivolta_portal_integrity.sql`

A segunda migração reforça a ligação entre contrato e cliente, atualiza automaticamente `updated_at` e restringe a função de aprovação a utilizadores autenticados.

## 3. Criar a conta administrativa

1. Criar primeiro a conta de proprietária em Supabase Authentication.
2. Copiar o UUID dessa conta.
3. No SQL Editor, executar, substituindo o email pelo email exato da conta:

```sql
insert into public.wivolta_staff (user_id)
select id
from auth.users
where email = 'EMAIL_DA_CONTA_ADMIN'
on conflict (user_id) do nothing;
```

A tabela de staff não tem políticas de leitura/escrita para clientes. Não criar uma política pública para ela.

## 4. Como funciona nesta fase

- O cliente pode criar conta, iniciar e terminar sessão.
- O cliente só consegue consultar os seus próprios contratos e alertas, por força das políticas RLS.
- O cliente pode aprovar ou recusar um alerta pendente através da função SQL.
- Os contratos e alertas são criados por um processo administrativo autorizado; o portal público não permite inserir contratos.
- A aprovação no portal regista a decisão. **Não submete por si só uma mudança de comercializador** nem substitui a autorização/formulário exigido pelo comercializador.

## 5. Antes de ativar em produção

- Completar a informação de privacidade com a identidade e contactos legais do responsável pelo tratamento e informação dos prestadores tecnológicos.
- Confirmar as definições de confirmação de email e recuperação de palavra-passe no Supabase Auth.
- Aplicar as duas migrações e testar com duas contas distintas para confirmar o isolamento dos dados.
- Criar um contrato e um alerta de teste; verificar consulta, aprovação e recusa.
- Só depois ativar `WIVOLTA_PORTAL_ENABLED=true` em produção.

## 6. Limites

Esta entrega não configura o projeto Supabase, não aplica migrações remotamente, não cria credenciais nem ativa a produção. Essas ações exigem acesso ao projeto e configuração efetiva das variáveis. A chave `service_role` não é necessária para o portal de cliente descrito acima.
