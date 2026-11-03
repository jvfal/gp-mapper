# Login com Discord

Qualquer conta Discord pode entrar. O primeiro login cria um usuario Django comum;
os proximos usam o mesmo ID Discord, mesmo se o nome mudar. Nenhum servidor,
cargo, bot ou convite e exigido. As permissoes existentes dos mapas continuam
valendo. O acesso ao admin exige uma conta staff.

## Configurar no Render

1. Abra https://discord.com/developers/applications e crie uma aplicacao.
2. Em **OAuth2 > Redirects**, cadastre exatamente:

   ```text
   https://gp-mapper.onrender.com/auth/discord/callback/
   ```

3. No servico web do Render, configure as variaveis de ambiente:

   ```env
   DISCORD_CLIENT_ID=ID_DA_APLICACAO
   DISCORD_CLIENT_SECRET=SEGREDO_DA_APLICACAO
   DISCORD_REDIRECT_URI=https://gp-mapper.onrender.com/auth/discord/callback/
   ```

4. Mantenha estas configuracoes do dominio:

   ```env
   DJANGO_ALLOWED_HOSTS=gp-mapper.onrender.com
   DJANGO_CSRF_TRUSTED_ORIGINS=https://gp-mapper.onrender.com
   ```

5. Publique as alteracoes do repositorio e faca o deploy. O botao **Entrar com
   Discord** sera habilitado quando as tres variaveis OAuth estiverem preenchidas.

O segredo fica somente no backend. Nao e necessario adicionar um bot ao servidor.
Os escopos solicitados sao `identify email`. O fluxo usa authorization code e
state vinculado a sessao, valido por dez minutos e consumido uma unica vez.
Tokens OAuth nao sao persistidos. Contas locais nao sao vinculadas automaticamente
por nome ou email. Depois do login, o app usa a mesma sessao Django do mapper e
dos WebSockets. A saida da sessao e um POST protegido por CSRF.

Referencia: https://docs.discord.com/developers/topics/oauth2

## Desenvolvimento local

Cadastre um segundo redirect na mesma aplicacao Discord:

```text
http://127.0.0.1:8000/auth/discord/callback/
```

Use esse mesmo valor em `DISCORD_REDIRECT_URI` no `.env` ou `.env.docker`, junto
com o client ID e secret. Use sempre `127.0.0.1` no navegador ao testar esse
redirect, para manter o cookie de sessao no mesmo host.

## Superusuario inicial

O entrypoint executa `python manage.py bootstrap_superuser` depois das migrations.
Por padrao, cria `dev`, com email `dev@dev.com` e senha inicial `devdev333`.
Se o username ja existir, nao modifica senha, email ou permissoes. Uma conta
existente que nao seja superusuario gera um aviso, sem ser promovida.

Valores podem ser personalizados com `DJANGO_SUPERUSER_USERNAME`,
`DJANGO_SUPERUSER_EMAIL` e `DJANGO_SUPERUSER_PASSWORD`. Para desabilitar a criacao,
configure `BOOTSTRAP_SUPERUSER=False`. Fora do Docker, execute o comando
manualmente apos `python manage.py migrate`.
