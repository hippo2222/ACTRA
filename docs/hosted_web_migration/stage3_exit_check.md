# Stage 3 Exit Check

Дата фиксации: `2026-04-12`

## Вопрос этапа

Можно ли считать `Stage 3` завершённым по его собственному критерию выхода?

Критерий выхода из [implementation_stages.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/implementation_stages.md):

- `web-runtime не зависит от data/ как от основного production-хранилища`

## Короткий ответ

Не без оговорок. `Stage 3` можно считать в основном завершённым по архитектурному storage-slice, но не как полностью очищенный runtime без transitional shadow/bootstrap поведения.

## Что уже действительно достигнуто

- Hosted runtime получил явный persistence contract и fail-fast проверку env для Postgres/S3.
- Hosted identity, progress, calendar и верхнеуровневые library/workspace metadata уже имеют Postgres-backed source of truth.
- `modules/topics/tasks metadata` в hosted runtime уже идут через Postgres-backed catalog snapshot.
- Для asset/media contract добавлен server-backed asset identity:
  - `asset_id`
  - `asset_url`
- Основные runtime/viewer surfaces и editor preview/upload surfaces уже переведены на dual-contract `path + asset_id/asset_url`.
- Public/runtime image rendering больше не является главным blocker внутри `Stage 3`.

## Что действительно можно считать закрытым

По целевому production path `web-runtime` больше не должен опираться на `data/` как на основной storage:

- identity, progress, calendar и library/workspace metadata уже имеют server-backed source of truth;
- theory body/history уже вынесены в hosted content repository;
- task payload blobs уже вынесены в hosted content repository;
- asset blobs теперь идут через managed server-side blob store под `runtime_state_root/asset_blobs/...`.

Filesystem `data/` в этой модели должен читаться как compatibility shadow и migration bridge, а не как основной production carrier hosted runtime.

## Что всё ещё не совпадает с буквальным критерием выхода

Сейчас важно не приукрашивать состояние:

- hosted image всё ещё копирует `data/` внутрь локального web-окружения через `Dockerfile.hosted`, поэтому shadow остаётся частью реального bootstrap-path, а не только абстрактной миграционной идеей;
- hosted-сервисы по-прежнему содержат задокументированные fallback- или bootstrap-ветки через filesystem compatibility layer, если Postgres недоступен;
- из-за этого формулировка “runtime больше не зависит от `data/`” корректна только как описание целевого primary production path, но не как буквальное описание всего текущего operational поведения.

## Что уже снято этими проходами

- theory metadata уже жили в Postgres-backed metadata repository;
- теперь theory `delta + images list + history snapshots` тоже получили hosted content repository;
- значит отдельный blocker `theory content blobs` в прежнем виде больше не считается незакрытым storage slice.

Важно:

- theory image files всё ещё остаются внутри общего `asset blobs` долга;
- но body/history state теории уже не должны считаться filesystem-only production source.

Дополнительно теперь снят и последний storage blocker:

- asset metadata уже раньше имели hosted identity;
- теперь и asset blobs больше не опираются на `data/` как на source of truth;
- старые asset rows лениво мигрируются в managed blob store с сохранением `asset_id`.

## Что не является blocker для закрытия Stage 3

Это важно, чтобы не расползся scope:

- `Stage 4` lineage/workspace model
- publish/add-to-library backend
- catalog semantics
- UI для каталога и библиотек

Это уже следующие фазы и не должно удерживать `Stage 3`.

## Что является спорным, но не блокирует признание архитектурного среза завершённым

- Отсутствие live Postgres/S3 end-to-end проверки в текущем локальном окружении само по себе не должно держать фазу открытой, если кодовая миграция уже завершена.
- На текущей точке это уже residual verification debt, а не главный архитектурный blocker `Stage 3`.
- Transitional shadow/bootstrap paths тоже не отменяют уже проделанный persistence split, но означают, что operational cleanup ещё не доведён до конца.

## Что остаётся после этого решения

После признания архитектурного storage-slice завершённым остаются уже не core migration blockers этой фазы, а следующие темы:

1. Live operational verification
- Проверка на реальном Postgres / S3-compatible окружении.

2. Transport hardening
- Если понадобится, вынести managed blob store с `runtime_state_root` на настоящий S3/MinIO transport, не меняя прикладную семантику.

3. Shadow/bootstrap cleanup
- Убрать копирование `data/` в hosted image и сузить filesystem fallback-ветки до действительно временного dev-only слоя или полностью их снять.

4. Следующая продуктовая фаза
- `Stage 4` workspace/catalog model, lineage, publish/add-to-library semantics.

## Итоговое решение

- `Stage 3` не стоит описывать как “безусловно полностью закрытый runtime cleanup”
- корректнее считать его `done` по архитектурному storage-slice с открытым transitional operational debt
- буквальная формулировка критерия выхода должна читаться через оговорку: primary production storage path уже вынесен из legacy `data/`, но shadow/bootstrap поведение ещё не убрано полностью

## Следующий правильный шаг

Следующий шаг уже не в переписывании всего `Stage 3`, а в параллельном движении по `Stage 4/5` с отдельной зачисткой shadow/bootstrap debt в runtime и deploy-слое.
