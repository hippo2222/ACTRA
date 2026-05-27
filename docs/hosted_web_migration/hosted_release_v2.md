# Hosted Release v2 Baseline

Этот документ фиксирует, как нужно воспринимать будущий hosted release line ACTRA после legacy desktop-релизов `v1.0.0` и `v1.1.0`.

## Что считается legacy

- GitHub Releases с Windows-артефактами `ACTRA.exe` / `ACTRA-Setup.exe`
- `latest.json` на `gh-pages`
- in-app update check как основной канал доставки новой версии

Все это относится к desktop-линейке и не должно считаться каноническим release-контуром для hosted продукта.

## Что считается будущим hosted release

Hosted release должен описывать не Windows-бинарник, а проверенный deployment baseline:

- очищенная и стабильная ветка `online-hosting`
- пройденный hosted smoke/gate набор
- пройденный launch contract
- отдельный operational acceptance run для домена, reverse proxy, SMTP и backup/restore
- release notes, описывающие изменения hosted runtime, а не desktop installer

## Рекомендуемый формат будущего v2.0.0

- tag: `v2.0.0`
- title: `ACTRA Hosted v2.0.0`
- notes: hosted-first changelog
- artifacts:
  - source archive from Git tag
  - optional deployment bundle / infra notes
  - no requirement for `ACTRA-Setup.exe`

## Автоматический gate перед будущим v2.x

В репозитории должен использоваться workflow:

- [`.github/workflows/hosted-release-gate.yml`](../../.github/workflows/hosted-release-gate.yml)

Он предназначен для `v2.*` tags и manual dispatch и проверяет code-level hosted smoke/gates.

## Что остается вне автоматического gate

Даже после успешного CI gate перед hosted release остаются обязательными ручные проверки:

- production domain wiring
- reverse proxy / HTTPS termination
- real SMTP delivery
- backup and restore drill
- final `/api/ready` verification в production-like окружении

## Политика до v2.0.0

- новые desktop-style releases не публикуются как актуальная линия продукта
- старые `v1.0.0` и `v1.1.0` сохраняются только как исторические legacy releases
- основной фокус поставки - hosted deployment, а не desktop installer
