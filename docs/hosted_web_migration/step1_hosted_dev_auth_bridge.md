# Step 1 Hosted Dev Auth Bridge

Дата обновления: `2026-04-10`

## Зачем появился этот мост

Во время `Step 1` мы начали переводить web read-path на честную hosted-semantics:

- `Комплексы` и другие library surfaces должны видеть только user-scoped данные;
- hosted routes больше не должны silently подмешивать shared-local объекты;
- backend должен ориентироваться на request-scoped identity, а не на process-wide `current user`.

Но в локальной разработке сейчас есть transitional разрыв:

- hosted auth session ещё не является обязательным и всегда поднятым dev-flow;
- legacy local current user всё ещё существует в `AppContextHeadless`;
- из-за этого hosted routes без auth cookie начинают видеть пользователя как `guest`, и library pages пустеют даже там, где на диске уже есть adoptable local data.

Чтобы не блокировать разработку `Step 1`, введён временный dev-only bridge.

## Что именно делает bridge

- Если runtime = `hosted_web`
- и явно включён env-флаг `ACTRA_HOSTED_DEV_AUTH_BRIDGE=1`
- и запрос идёт с localhost
- и в браузерной hosted session нет auth user

тогда request identity временно берётся из legacy current user (`ctx.user_id`) или из `user_service.get_last_user_id()`.
Если hosted user service уже не хранит `last_user_id`, bridge в локальной разработке может временно прочитать legacy `data/app_state.json:last_user_id`.

## Что bridge НЕ означает

Этот bridge не меняет целевую архитектуру.

Он НЕ означает, что:

- hosted runtime снова может опираться на process-wide current user как на норму;
- production может работать без auth session;
- library/workspace listing может и дальше зависеть от `app_state.json`;
- `guest -> legacy current user` является допустимой постоянной hosted semantics.

Целевая модель остаётся прежней:

- hosted identity = только request-scoped auth session;
- legacy current user = только transitional/dev compatibility.

## Ограничения

- bridge работает только при явном env opt-in;
- bridge ограничен localhost/dev use-case;
- bridge не должен считаться production feature;
- при локальной разработке без Postgres рядом может использоваться отдельный temporary shadow-read fallback для hosted services; он тоже считается временной совместимостью, а не целевой hosted storage model;
- для локальной проверки publish-management без Postgres допустим отдельный temporary shadow-write fallback только для catalog state (`catalog.json`);
- logout не должен считаться полноценной проверкой hosted auth semantics, если bridge включён;
- в API ответах bridge должен быть различим как `auth_source = dev_bridge`.

## Как включается

```powershell
$env:ACTRA_RUNTIME_MODE='hosted_web'
$env:ACTRA_HOSTED_DEV_AUTH_BRIDGE='1'
```

## Когда его нужно удалить

Этот мост должен быть удалён после того, как локальный hosted dev-flow станет достаточно полным, чтобы `Step 1` и следующие web-slices можно было проверять через нормальную auth session без fallback на legacy current user.

Практический критерий удаления:

- локальный login/register flow стабилен;
- основные library/editor pages в hosted runtime поднимаются через request auth без dev fallback;
- `Комплексы`, `Теории` и `editor catalog` больше не требуют legacy current user для разработки и QA.
