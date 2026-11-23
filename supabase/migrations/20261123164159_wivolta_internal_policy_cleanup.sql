-- Wivolta: consolidar políticas internas para evitar políticas permissivas duplicadas
drop policy if exists "staff consulta comissoes internas" on public.comissoes_internas;
drop policy if exists "staff consulta documentos de adesao" on public.documentos_adesao;
-- As políticas "staff gere ..." continuam a aplicar-se a todas as operações e exigem wivolta_is_staff().
